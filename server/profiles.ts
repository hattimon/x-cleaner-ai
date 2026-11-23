import { Prisma } from '@prisma/client';
import type { Profile, PrismaClient, XAccount, ScanJob } from '@prisma/client';
import { decisions, evaluationSchema, postSchema, activities } from '../shared/contracts.js';
import type { Audit, Dashboard, Decision, Preference, ProfileDetail, ProfileEntry, ProfileQuery, Scan, ScanMetrics } from '../shared/contracts.js';
import { z } from 'zod';
import { AppError } from './config.js';
import { audit, iso, json, lock, ownedAccount, settingsOf } from './db.js';
import type { Db } from './db.js';
import { classifyWithoutPreferences, isProtected } from './classification.js';

export const cacheCutoff = (account: XAccount) => new Date(Date.now() - settingsOf(account).cacheHours * 3600000);
export const samples = (value: Prisma.JsonValue) => z.array(postSchema).safeParse(value).data ?? [];
export const evaluation = (value: Prisma.JsonValue) => evaluationSchema.safeParse(value).data ?? null;
const decisionOf = (profile: Profile, account: XAccount): Decision => {
  if (isProtected(profile.username, profile.preference, settingsOf(account))) return 'PROTECTED';
  if (profile.preference === 'KEEP' || profile.preference === 'REVIEW') return profile.preference;
  if (profile.decision === 'PROTECTED') return 'REVIEW';
  if (profile.status !== 'scanned' || !profile.lastCheckedAt || profile.lastCheckedAt < cacheCutoff(account)) {
    return profile.decision === 'UNFOLLOW_CANDIDATE' ? 'REVIEW' : profile.decision;
  }
  return profile.decision;
};

export function profileView(profile: Profile, account: XAccount): ProfileEntry {
  const checked = profile.status === 'scanned' && profile.lastCheckedAt && profile.lastCheckedAt < cacheCutoff(account);
  const decision = decisionOf(profile, account);
  let assessment = evaluation(profile.assessment);
  if (assessment && (profile.preference || decision === 'PROTECTED')) {
    const reason = decision === 'PROTECTED' ? 'Profil jest chroniony przez właściciela.' : 'Uwzględniono ręczną decyzję właściciela.';
    assessment = {
      ...assessment, decision, confidence: 100,
      relationship_score: decision === 'PROTECTED' ? 100 : profile.preference === 'KEEP' ? 90 : 0,
      reasons: [reason, ...assessment.reasons],
      evidence: [{ kind: 'relationship', summary: reason }, ...assessment.evidence],
    };
  }
  return {
    id: profile.id, xId: profile.xId, username: profile.username, name: profile.name, bio: profile.bio,
    avatarUrl: profile.avatarUrl, website: profile.website, openedAt: iso(profile.openedAt), followers: profile.followers,
    follows: profile.follows, verified: profile.verified, private: profile.private, following: profile.following,
    lastActivity: iso(profile.lastActivity), lastPostAt: iso(profile.lastPostAt), lastReplyAt: iso(profile.lastReplyAt), lastCheckedAt: iso(profile.lastCheckedAt),
    url: /^\d{1,24}$/.test(profile.xId) ? 'https://x.com/i/user/' + profile.xId : null,
    activity: activities.find(value => value === profile.activity) ?? 'unknown',
    status: checked ? 'stale' : profile.status, statusReason: checked ? 'Minęła ważność danych w pamięci podręcznej.' : profile.statusReason,
    decision, confidence: decision === 'PROTECTED' || profile.preference ? 100 : profile.confidence, preference: profile.preference, assessment,
  };
}

function conditions(account: XAccount) {
  const { whitelist, exclusions } = settingsOf(account);
  const handles = [...new Set([...whitelist, ...exclusions])];
  const special: Prisma.ProfileWhereInput = {
    OR: [{ preference: { in: ['PROTECT', 'EXCLUDE'] } }, ...(handles.length ? [{ username: { in: handles, mode: 'insensitive' as const } }] : [])],
  };
  const other: Prisma.ProfileWhereInput = {
    AND: [
      { OR: [{ preference: null }, { preference: { in: ['KEEP', 'REVIEW'] } }] },
      ...(handles.length ? [{ username: { notIn: handles, mode: 'insensitive' as const } }] : []),
    ],
  };
  const stale: Prisma.ProfileWhereInput = { OR: [{ status: 'stale' }, { status: 'scanned', lastCheckedAt: { lt: cacheCutoff(account) } }] };
  const fresh: Prisma.ProfileWhereInput = { status: 'scanned', lastCheckedAt: { gte: cacheCutoff(account) } };
  const potential: Prisma.ProfileWhereInput = { decision: 'UNFOLLOW_CANDIDATE', preference: null, AND: [other, fresh] };
  const decisionsWhere: Record<Decision, Prisma.ProfileWhereInput> = {
    PROTECTED: special,
    KEEP: { AND: [other, { OR: [{ preference: 'KEEP' }, { preference: null, decision: 'KEEP' }] }] },
    REVIEW: { AND: [other, { OR: [{ preference: 'REVIEW' }, { preference: null, decision: { in: ['REVIEW', 'PROTECTED'] } }, { preference: null, decision: 'UNFOLLOW_CANDIDATE', OR: [{ NOT: fresh }, { lastCheckedAt: null }] }] }] },
    UNKNOWN: { decision: 'UNKNOWN', preference: null, AND: [other] },
    UNFOLLOW_CANDIDATE: potential,
  };
  return { stale, decisionsWhere };
}

export function profileWhere(account: XAccount, query: ProfileQuery): Prisma.ProfileWhereInput {
  const { stale, decisionsWhere } = conditions(account);
  const where: Prisma.ProfileWhereInput[] = [{ accountId: account.id, following: query.view !== 'unfollowed' }];
  if (query.q) where.push({ OR: [{ username: { contains: query.q.replace(/^@/, ''), mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }] });
  if (query.view === 'candidate') where.push(decisionsWhere.UNFOLLOW_CANDIDATE);
  if (query.view === 'kept') where.push({ OR: [decisionsWhere.KEEP, decisionsWhere.PROTECTED] });
  if (query.view === 'review') where.push({ OR: [decisionsWhere.REVIEW, decisionsWhere.UNKNOWN, { assessment: { path: ['aiStatus'], equals: 'pending' } }] });
  if (query.decision) where.push(decisionsWhere[query.decision]);
  if (query.status === 'stale') where.push(stale);
  else if (query.status) where.push({ status: query.status, ...(query.status === 'scanned' ? { NOT: stale } : {}) });
  return { AND: where };
}

const orderBy: Record<ProfileQuery['sort'], Prisma.ProfileOrderByWithRelationInput[]> = {
  confidence: [{ confidence: 'desc' }, { spamScore: 'desc' }, { id: 'asc' }],
  name: [{ name: 'asc' }, { id: 'asc' }],
  oldest: [{ lastActivity: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  latest: [{ lastActivity: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
  spam: [{ spamScore: 'desc' }, { confidence: 'desc' }, { id: 'asc' }],
};

export async function listProfiles(db: Db, account: XAccount, query: ProfileQuery) {
  const where = profileWhere(account, query);
  const [profiles, total] = await Promise.all([
    db.profile.findMany({ where, orderBy: orderBy[query.sort], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    db.profile.count({ where }),
  ]);
  return { items: profiles.map(profile => profileView(profile, account)), total, page: query.page, pageSize: query.pageSize };
}

export async function detailProfile(db: Db, account: XAccount, id: string): Promise<ProfileDetail> {
  const profile = await db.profile.findFirst({ where: { id, accountId: account.id }, include: {
    scanItems: { where: { analyzedAt: { not: null } }, orderBy: { analyzedAt: 'desc' }, take: 12, select: { evaluation: true } },
  } });
  if (!profile) throw new AppError(404, 'profile_missing', 'Profil jest niedostępny.');
  return { ...profileView(profile, account), posts: samples(profile.posts), history: profile.scanItems.flatMap(item => evaluation(item.evaluation) ?? []) };
}

export async function setPreference(db: PrismaClient, userId: string, accountId: string, profileId: string, preference: Preference | null) {
  return db.$transaction(async tx => {
    await lock(tx, 'account:' + accountId);
    const account = await ownedAccount(tx, userId, accountId);
    const row = await tx.profile.findFirst({ where: { id: profileId, accountId } });
    if (!row) throw new AppError(404, 'profile_missing', 'Profil jest niedostępny.');
    if (await tx.cleanupOperation.count({ where: { profileId, state: 'IN_PROGRESS' } })) throw new AppError(409, 'write_in_progress', 'Poczekaj na wynik tej operacji.');
    const existing = evaluation(row.assessment);
    const assessment = classifyWithoutPreferences({
      username: row.username, private: row.private, preference, posts: samples(row.posts), status: profileView(row, account).status,
      statusReason: row.statusReason, lastActivity: row.lastActivity, live: account.mode === 'LIVE',
    }, settingsOf(account));
    const updated = await tx.profile.update({ where: { id: profileId }, data: {
      preference, decision: assessment.decision, confidence: assessment.confidence, spamScore: assessment.spam_score,
      activity: assessment.activity, assessment: json(assessment),
    } });
    const previous = existing?.decision ?? row.decision;
    await audit(tx, userId, accountId, 'profile.preference', `Zapisano decyzję właściciela dla ${row.name}.`, json({ profileId, preference, previous }));
    return profileView(updated, account);
  });
}

type MetricRow = { following: number; analyzed: number; active: number; occasional: number; inactive: number; spam: number; recentWeek: number; recentMonth: number; recentQuarter: number; recentHalf: number; older: number; unknownDates: number };
export async function metricsFor(db: Db, account: XAccount): Promise<ScanMetrics> {
  const scope = { accountId: account.id, following: true };
  const where = conditions(account).decisionsWhere;
  const [groups, activity, unfollowed] = await Promise.all([
    Promise.all(decisions.map(async decision => [decision, await db.profile.count({ where: { AND: [scope, where[decision]] } })] as const)),
    db.$queryRaw<MetricRow[]>`SELECT count(*)::int AS following,
      count(*) FILTER (WHERE "assessment" IS NOT NULL)::int AS analyzed,
      count(*) FILTER (WHERE activity = 'recent')::int AS active,
      count(*) FILTER (WHERE activity = 'occasional')::int AS occasional,
      count(*) FILTER (WHERE activity = 'inactive')::int AS inactive,
      count(*) FILTER (WHERE "spamScore" >= ${settingsOf(account).spamThreshold})::int AS spam,
      count(*) FILTER (WHERE "lastActivity" >= now() - interval '7 days')::int AS "recentWeek",
      count(*) FILTER (WHERE "lastActivity" < now() - interval '7 days' AND "lastActivity" >= now() - interval '30 days')::int AS "recentMonth",
      count(*) FILTER (WHERE "lastActivity" < now() - interval '30 days' AND "lastActivity" >= now() - interval '90 days')::int AS "recentQuarter",
      count(*) FILTER (WHERE "lastActivity" < now() - interval '90 days' AND "lastActivity" >= now() - interval '180 days')::int AS "recentHalf",
      count(*) FILTER (WHERE "lastActivity" < now() - interval '180 days')::int AS older,
      count(*) FILTER (WHERE "lastActivity" IS NULL)::int AS "unknownDates"
      FROM "Profile" WHERE "accountId" = ${account.id} AND following`,
    db.cleanupOperation.count({ where: { batch: { accountId: account.id, direction: 'UNFOLLOW' }, state: 'SUCCEEDED' } }),
  ]);
  const counted = Object.fromEntries(groups) as ScanMetrics['decisions'];
  const row = activity[0];
  const following = Math.max(row.following, account.followingCount ?? 0);
  return {
    following, analyzed: row.analyzed, active: row.active, occasional: row.occasional, inactive: row.inactive, spam: row.spam,
    review: counted.REVIEW + counted.UNKNOWN, candidates: counted.UNFOLLOW_CANDIDATE, protected: counted.PROTECTED, unfollowed,
    decisions: counted, coverage: following ? Math.round(100 * row.analyzed / following) : 0,
    buckets: [row.recentWeek, row.recentMonth, row.recentQuarter, row.recentHalf, row.older, row.unknownDates],
  };
}

export const scanView = (scan: ScanJob): Scan => ({
  id: scan.id, state: scan.state, phase: scan.phase, reason: scan.reason, seen: scan.seen, processed: scan.processed, pages: scan.pages,
  availableAt: scan.availableAt.toISOString(), createdAt: scan.createdAt.toISOString(), startedAt: iso(scan.startedAt),
  finishedAt: iso(scan.finishedAt), message: scan.message, summary: scan.summary as ScanMetrics | null,
});
export async function auditHistory(db: Db, account: XAccount, limit = 80): Promise<Audit[]> {
  const data = await db.auditEvent.findMany({
    where: { userId: account.userId, OR: [{ accountId: account.id }, { accountId: null }] },
    orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, kind: true, message: true, createdAt: true },
  });
  return data.map(event => ({ ...event, createdAt: event.createdAt.toISOString() }));
}

export async function dashboard(db: Db, account: XAccount): Promise<Dashboard> {
  const [metrics, scans, events, candidates, trends, cleanup] = await Promise.all([
    metricsFor(db, account),
    db.scanJob.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'desc' }, take: 12 }),
    auditHistory(db, account, 8),
    listProfiles(db, account, { view: 'candidate', q: '', sort: 'confidence', page: 1, pageSize: 4 }),
    db.scanJob.findMany({ where: { accountId: account.id, state: 'COMPLETED', summary: { not: Prisma.DbNull } }, orderBy: { finishedAt: 'desc' }, take: 14 }),
    db.$queryRaw<Dashboard['cleanup']>`SELECT to_char(o."updatedAt", 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE b.direction = 'UNFOLLOW')::int AS unfollow,
      count(*) FILTER (WHERE b.direction = 'FOLLOW')::int AS follow
      FROM "CleanupOperation" o JOIN "CleanupBatch" b ON o."batchId" = b.id
      WHERE b."accountId" = ${account.id} AND o.state = 'SUCCEEDED'
      GROUP BY day ORDER BY day DESC LIMIT 14`,
  ]);
  return {
    metrics, scans: scans.map(scanView), audit: events, candidates: candidates.items,
    comparison: trends.reverse().map(row => ({ at: row.finishedAt!.toISOString(), metrics: row.summary as ScanMetrics })),
    cleanup: cleanup.reverse(),
  };
}

export async function report(db: Db, account: XAccount) {
  const rows = await db.profile.findMany({
    where: { accountId: account.id },
    orderBy: { id: 'asc' },
    select: { xId: true, username: true, following: true, status: true, decision: true, preference: true, lastActivity: true, lastCheckedAt: true, activity: true, confidence: true, spamScore: true, assessment: true },
  });
  return {
    version: 1, source: account.mode, accountXId: account.xId, exportedAt: new Date().toISOString(),
    profiles: rows.map(row => {
      const safeAssessment = evaluation(row.assessment);
      const decision = decisionOf(row as Profile, account);
      return {
        xUserId: row.xId, following: row.following, status: row.status === 'scanned' && row.lastCheckedAt && row.lastCheckedAt < cacheCutoff(account) ? 'stale' : row.status,
        decision, activity: row.activity, lastActivity: iso(row.lastActivity), confidence: decision === 'PROTECTED' || row.preference ? 100 : row.confidence,
        spamScore: row.spamScore, provider: safeAssessment?.provider ?? null, model: safeAssessment?.model ?? null,
        reasons: safeAssessment?.reasons ?? [],
      };
    }),
  };
}

export function csvReport(profiles: Awaited<ReturnType<typeof report>>['profiles']) {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    return '"' + (/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
  };
  const header = ['x_user_id', 'following', 'status', 'decision', 'activity', 'last_activity', 'confidence', 'spam_score', 'provider', 'model', 'reasons'];
  return [header.join(','), ...profiles.map(row => [
    row.xUserId, row.following, row.status, row.decision, row.activity, row.lastActivity, row.confidence, row.spamScore,
    row.provider, row.model, row.reasons.join(' | '),
  ].map(cell).join(','))].join('\r\n') + '\r\n';
}
