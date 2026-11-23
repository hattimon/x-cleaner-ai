import type { Prisma, PrismaClient, ScanJob, Profile, XAccount } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { activeJobStates } from '../shared/contracts.js';
import type { DataStatus, Evaluation, PostSample } from '../shared/contracts.js';
import type { AIProvider } from './ai-providers.js';
import { AppError } from './config.js';
import { classify, classifyWithoutPreferences, decisionConfidence, isProtected } from './classification.js';
import { audit, json, lock, ownedAccount, settingsOf } from './db.js';
import { cacheCutoff, metricsFor, samples, scanView } from './profiles.js';
import { nextScheduled } from './scheduler.js';
import type { XProvider } from './x-provider.js';

const leaseMs = 90000;
const pageSize = 50;
type WorkerJob = ScanJob & { account: XAccount };
type FetchProvider = (account: XAccount) => XProvider;
type AssertScan = (account: XAccount) => Promise<void>;
type ProfileSample = {
  posts: PostSample[]; status: DataStatus; statusReason: string | null; sampleLimit: number; lastCheckedAt: Date | null;
  lastActivity: Date | null; lastPostAt: Date | null; lastReplyAt: Date | null;
};

export class Scanner {
  private timer?: NodeJS.Timeout;
  private pending?: Promise<boolean>;
  private stopped = true;
  private nextMaintenance = 0;
  constructor(private db: PrismaClient, private provider: FetchProvider, private assertScan: AssertScan, private ai: AIProvider,
    private reportError: (code: string) => void = () => {}) {}

  async start(userId: string, id: string, reason: 'MANUAL' | 'SCHEDULED' | 'MCP', forceRefresh = false) {
    return this.db.$transaction(async tx => {
      await lock(tx, 'account:' + id);
      const current = await ownedAccount(tx, userId, id);
      if (reason === 'SCHEDULED') {
        if (!current.nextScanAt || current.nextScanAt > new Date()) return null;
        const opts = settingsOf(current);
        const eligible = current.mode === 'LIVE' && Boolean(current.encrypted) && current.connectionError !== 'x_unauthorized' && opts.scheduleEnabled && opts.liveReadsEnabled;
        const nextScanAt = eligible ? nextScheduled(opts.scheduleTime, opts.timeZone) : null;
        await tx.xAccount.update({ where: { id }, data: { nextScanAt } });
        if (!eligible) return null;
      }
      await this.assertScan(current);
      const active = await tx.scanJob.findFirst({ where: { accountId: id, state: { in: [...activeJobStates] } } });
      if (active) return scanView(active);
      if (await tx.cleanupOperation.count({ where: { batch: { accountId: id }, state: 'IN_PROGRESS' } })) {
        if (reason === 'SCHEDULED') return null;
        throw new AppError(409, 'write_in_progress', 'Poczekaj na zakończenie operacji czyszczenia.');
      }
      const offline = current.mode === 'ARCHIVE';
      let job = await tx.scanJob.create({ data: {
        accountId: id, reason, forceRefresh: !offline && forceRefresh, phase: offline ? 'PROFILES' : 'FOLLOWING',
      } });
      if (offline) {
        const seen = await tx.$executeRaw`INSERT INTO "ScanItem" ("scanId", "profileId") SELECT ${job.id}, id FROM "Profile"
          WHERE "accountId" = ${id} AND following`;
        job = await tx.scanJob.update({ where: { id: job.id }, data: { seen } });
      }
      await audit(tx, userId, id, 'scan.created', offline ? 'Zlecono przeliczenie danych archiwum.' : 'Zlecono skanowanie listy X.');
      return scanView(job);
    });
  }

  async control(userId: string, id: string, jobId: string, action: 'pause' | 'resume' | 'cancel') {
    return this.db.$transaction(async tx => {
      await lock(tx, 'account:' + id);
      const account = await ownedAccount(tx, userId, id);
      // Claim and control lock the same job row. A claim can never overwrite a control.
      await tx.$queryRaw`SELECT id FROM "ScanJob" WHERE id = ${jobId} AND "accountId" = ${id} FOR UPDATE`;
      const job = await tx.scanJob.findFirst({ where: { id: jobId, accountId: id } });
      if (!job) throw new AppError(404, 'scan_missing', 'Zadanie jest niedostępne.');
      if (action === 'pause' && job.state === 'PAUSED' || action === 'resume' && ['QUEUED', 'RUNNING', 'WAITING'].includes(job.state)
        || action === 'cancel' && job.state === 'CANCELLED') return scanView(job);
      if (!activeJobStates.some(state => state === job.state)) throw new AppError(409, 'scan_finished', 'Zadanie zostało już zakończone.');
      if (action === 'resume') await this.assertScan(account);
      const pause = action === 'pause';
      const resume = action === 'resume';
      const availableAt = new Date(Math.max(Date.now(), job.leaseUntil?.getTime() ?? 0, job.availableAt.getTime()));
      const updated = await tx.scanJob.update({ where: { id: jobId }, data: {
        state: pause ? 'PAUSED' : resume ? 'QUEUED' : 'CANCELLED',
        finishedAt: action === 'cancel' ? new Date() : null,
        ...(!pause ? { leaseUntil: null, leaseId: null } : {}),
        availableAt, message: pause ? 'Wstrzymano przez użytkownika.' : resume ? null : 'Anulowano przez użytkownika.',
      } });
      await audit(tx, userId, id, 'scan.' + action, pause ? 'Wstrzymano zadanie skanowania.' : resume ? 'Wznowiono zadanie skanowania.' : 'Anulowano zadanie skanowania.');
      return scanView(updated);
    });
  }

  private async claim() {
    const now = new Date();
    const lease = new Date(now.getTime() + leaseMs);
    const claimId = randomUUID();
    const picked = await this.db.$queryRaw<{ id: string }[]>`
      WITH next_job AS (
        SELECT id FROM "ScanJob"
        WHERE (state IN ('QUEUED','WAITING') AND "availableAt" <= ${now})
           OR (state = 'RUNNING' AND "leaseUntil" <= ${now})
        ORDER BY "availableAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "ScanJob" j SET state = 'RUNNING', "leaseId" = ${claimId}, "leaseUntil" = ${lease}, "startedAt" = COALESCE(j."startedAt", ${now})
      FROM next_job n WHERE j.id = n.id RETURNING j.id`;
    if (!picked[0]) return null;
    return this.db.scanJob.findFirst({ where: { id: picked[0].id, leaseId: claimId, state: 'RUNNING' }, include: { account: true } });
  }

  private async commit(job: ScanJob, change: (tx: Prisma.TransactionClient, account: XAccount) => Promise<void>) {
    return this.db.$transaction(async tx => {
      await lock(tx, 'account:' + job.accountId);
      const [active] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ScanJob"
        WHERE id = ${job.id} AND state = 'RUNNING' AND "leaseId" = ${job.leaseId} FOR UPDATE`;
      if (!active) return;
      await change(tx, await tx.xAccount.findUniqueOrThrow({ where: { id: job.accountId } }));
    }, { timeout: 18000 });
  }

  private async collect(job: WorkerJob) {
    const data = await this.provider(job.account).following(job.account.xId, job.cursor, pageSize);
    if (data.next && data.next === job.cursor) throw new AppError(502, 'x_cursor', 'X zwrócił powtórzony znacznik strony.');
    await this.commit(job, async (tx, account) => {
      const ids: string[] = [];
      for (const profile of data.profiles) {
        const row = await tx.profile.upsert({
          where: { accountId_xId: { accountId: account.id, xId: profile.xId } },
          create: { ...profile, accountId: account.id },
          update: { ...profile, following: true }, select: { id: true },
        });
        ids.push(row.id);
      }
      const added = ids.length ? (await tx.scanItem.createMany({
        data: ids.map(profileId => ({ profileId, scanId: job.id })), skipDuplicates: true,
      })).count : 0;
      if (!data.next) {
        await tx.profile.updateMany({
          where: { accountId: account.id, following: true, scanItems: { none: { scanId: job.id } } }, data: { following: false },
        });
        await tx.xAccount.update({ where: { id: account.id }, data: { followingCount: job.seen + added } });
      }
      await tx.scanJob.update({ where: { id: job.id }, data: {
        phase: data.next ? 'FOLLOWING' : 'PROFILES', cursor: data.next, pages: { increment: 1 }, seen: { increment: added },
        state: 'QUEUED', leaseId: null, leaseUntil: null, attempts: 0, availableAt: new Date(), message: null,
      } });
    });
  }

  private async sample(job: WorkerJob, row: Profile): Promise<ProfileSample> {
    const options = settingsOf(job.account);
    const cached = row.lastCheckedAt && row.lastCheckedAt >= cacheCutoff(job.account) && row.sampleLimit >= options.postsPerProfile
      && ['scanned', 'partial', 'unavailable'].includes(row.status);
    if (!job.forceRefresh && cached && !row.private) return {
      posts: samples(row.posts), status: row.status, statusReason: row.statusReason, sampleLimit: row.sampleLimit,
      lastCheckedAt: row.lastCheckedAt, lastActivity: row.lastActivity, lastPostAt: row.lastPostAt, lastReplyAt: row.lastReplyAt,
    };
    let posts: PostSample[] = [];
    let status: DataStatus = 'unavailable';
    let statusReason = row.private ? 'Konto prywatne. Publiczna próbka jest niedostępna.'
      : job.account.mode === 'ARCHIVE' ? 'Archiwum obserwowanych zawiera identyfikatory. Brak postów tych profili.' : 'X nie zwrócił dostępnych postów.';
    if (job.account.mode === 'LIVE' && !row.private) {
      try {
        const timeline = await this.provider(job.account).timeline(row.xId, options.postsPerProfile);
        posts = timeline.posts;
        status = timeline.partial ? 'partial' : posts.length ? 'scanned' : 'unavailable';
        statusReason = timeline.partial ? 'X zwrócił niekompletną próbkę.' : status === 'scanned' ? '' : statusReason;
      } catch (error) {
        if (!(error instanceof AppError) || !['x_forbidden', 'x_unavailable'].includes(error.code)) throw error;
        statusReason = error.message;
      }
    }
    const last = (kind?: PostSample['kind']) => {
      const stamp = posts.reduce((latest, item) => (!kind || item.kind === kind) && item.at > latest ? item.at : latest, '');
      return stamp ? new Date(stamp) : null;
    };
    return {
      posts, status, statusReason: statusReason || null, sampleLimit: options.postsPerProfile, lastCheckedAt: new Date(),
      lastActivity: last(), lastPostAt: last('post'), lastReplyAt: last('reply'),
    };
  }

  private async classifyOne(job: WorkerJob) {
    const item = await this.db.scanItem.findFirst({ where: { scanId: job.id, analyzedAt: null }, orderBy: { profileId: 'asc' }, include: { profile: true } });
    if (!item) {
      await this.commit(job, async (tx, account) => {
        const snapshot = await metricsFor(tx, account);
        await tx.scanJob.update({ where: { id: job.id }, data: { state: 'COMPLETED', finishedAt: new Date(), leaseId: null, leaseUntil: null, message: null, summary: json(snapshot) } });
        await audit(tx, account.userId, account.id, 'scan.completed', `Zakończono analizę ${job.processed} profili.`);
      });
      return;
    }
    const row = item.profile;
    const options = settingsOf(job.account);
    let data: ProfileSample;
    try { data = await this.sample(job, row); }
    catch (error) {
      return this.handleFailure(job, error, row.id);
    }
    const input = { ...data, username: row.username, preference: row.preference, private: row.private, live: job.account.mode === 'LIVE' };
    const rules = classifyWithoutPreferences(input, options);
    let assessment: Evaluation = rules;
    const needsAi = options.aiProvider !== 'manual' && !input.preference && !isProtected(row.username, null, options) && input.live && data.status === 'scanned'
      && (rules.decision === 'UNFOLLOW_CANDIDATE' || rules.decision === 'REVIEW' && rules.spam_score >= 20);
    if (needsAi && job.reason !== 'MCP' && (job.reason !== 'SCHEDULED' || options.aiScheduled)) {
      try { assessment = await this.ai.classify(job.account.userId, job.accountId, options.aiModel, rules, input, decisionConfidence(options)); }
      catch (error) {
        const message = error instanceof AppError ? error.message : 'Ocena AI chwilowo niedostępna.';
        assessment = { ...rules, aiStatus: 'pending', reasons: [...rules.reasons, message] };
      }
    } else if (needsAi) {
      assessment = { ...rules, aiStatus: 'pending' };
    }
    await this.commit(job, async (tx, account) => {
      const current = await tx.profile.findUniqueOrThrow({ where: { id: row.id } });
      const currentSettings = settingsOf(account);
      if (JSON.stringify(job.account.settings) !== JSON.stringify(account.settings)) assessment = classifyWithoutPreferences(input, currentSettings);
      const annotated = current.preference || isProtected(current.username, null, currentSettings)
        ? classify({ ...input, preference: current.preference }, currentSettings) : assessment;
      await tx.profile.update({ where: { id: row.id }, data: {
        ...data, posts: json(data.posts), decision: assessment.decision, assessment: json(assessment),
        activity: assessment.activity, confidence: assessment.confidence, spamScore: assessment.spam_score,
      } });
      await tx.scanItem.update({
        where: { scanId_profileId: { scanId: job.id, profileId: row.id } }, data: { analyzedAt: new Date(), evaluation: json(annotated) },
      });
      await tx.scanJob.update({ where: { id: job.id }, data: {
        processed: { increment: 1 }, state: 'QUEUED', leaseId: null, leaseUntil: null, attempts: 0, availableAt: new Date(), message: null,
      } });
    });
  }

  private async handleFailure(job: WorkerJob, error: unknown, profileId?: string) {
    const trusted = error instanceof AppError;
    const retry = trusted && (error.status === 429 || error.status >= 500 && job.attempts < 4);
    const message = trusted ? error.message : 'Wystąpił błąd podczas zapisywania postępu skanowania.';
    const wait = trusted && error.retryAt ? error.retryAt : new Date(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(job.attempts, 8)));
    await this.commit(job, async (tx, account) => {
      if (profileId) await tx.profile.update({ where: { id: profileId }, data: {
        status: trusted && error.status === 429 ? 'rate_limited' : 'failed', statusReason: message,
      } });
      await tx.scanJob.update({ where: { id: job.id }, data: {
        state: retry ? 'WAITING' : 'FAILED', availableAt: wait, attempts: { increment: 1 }, finishedAt: retry ? null : new Date(),
        leaseId: null, leaseUntil: null, message,
      } });
      if (!retry || job.attempts === 0) await audit(tx, account.userId, account.id, retry ? 'scan.waiting' : 'scan.failed', message);
    });
  }

  async tick() {
    if (Date.now() >= this.nextMaintenance) {
      this.nextMaintenance = Date.now() + 60000;
      await this.maintain();
    }
    const job = await this.claim();
    if (!job) return false;
    try {
      await this.assertScan(job.account);
      if (job.phase === 'FOLLOWING') await this.collect(job);
      else await this.classifyOne(job);
    } catch (error) {
      this.reportError(error instanceof AppError ? error.code : 'scan_internal');
      await this.handleFailure(job, error);
    }
    return true;
  }

  private async maintain() {
    const now = new Date();
    const due = await this.db.xAccount.findMany({ where: { nextScanAt: { lte: now } }, take: 25 });
    for (const account of due) await this.start(account.userId, account.id, 'SCHEDULED').catch(() => this.reportError('schedule'));
    await this.db.$transaction([
      this.db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.oAuthAttempt.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.db.cleanupOperation.updateMany({
        where: { state: 'IN_PROGRESS', updatedAt: { lt: new Date(Date.now() - 120000) } },
        data: { state: 'UNCERTAIN', result: { message: 'Przerwano operację. Sprawdź stan na X przed następną próbą.' } },
      }),
      this.db.cleanupBatch.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) }, operations: { every: { state: 'PREPARED' } } },
      }),
    ]);
    const accounts = await this.db.xAccount.findMany({ select: { id: true, settings: true } });
    for (const account of accounts) {
      const cutoff = new Date(Date.now() - settingsOf(account).retentionDays * 86400000);
      await this.db.$transaction([
        this.db.scanJob.deleteMany({ where: { accountId: account.id, finishedAt: { lt: cutoff } } }),
        this.db.profile.updateMany({ where: { accountId: account.id, lastCheckedAt: { lt: cutoff }, status: { not: 'stale' } }, data: { posts: [], status: 'stale' } }),
      ]);
    }
  }

  run() {
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      this.pending = this.tick().catch(() => { this.reportError('scheduler_internal'); return false; });
      void this.pending.then(active => {
        if (!this.stopped) this.timer = setTimeout(loop, active ? 70 : 650);
      });
    };
    loop();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
  }
}
