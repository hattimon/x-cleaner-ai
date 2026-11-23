import { z } from 'zod';

export const decisions = ['KEEP', 'REVIEW', 'UNFOLLOW_CANDIDATE', 'PROTECTED', 'UNKNOWN'] as const;
export const dataStatuses = ['scanned', 'partial', 'unavailable', 'rate_limited', 'stale', 'failed'] as const;
export const modes = ['LIVE', 'ARCHIVE'] as const;
export const preferences = ['KEEP', 'REVIEW', 'PROTECT', 'EXCLUDE'] as const;
export const jobStates = ['QUEUED', 'RUNNING', 'WAITING', 'PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED'] as const;
export const operationStates = ['PREPARED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'UNCERTAIN', 'SKIPPED'] as const;
export const activeJobStates = ['QUEUED', 'RUNNING', 'WAITING', 'PAUSED'] as const;
export const activities = ['recent', 'occasional', 'inactive', 'unknown'] as const;
export const actions = ['UNFOLLOW', 'FOLLOW'] as const;
export const apiProviders = ['openai', 'anthropic', 'gemini'] as const;
export type ApiProvider = typeof apiProviders[number];
export type Mode = typeof modes[number];
export type Decision = typeof decisions[number];
export type Preference = typeof preferences[number];
export type DataStatus = typeof dataStatuses[number];
export type JobState = typeof jobStates[number];
export type OperationState = typeof operationStates[number];
export type Activity = typeof activities[number];

const score = z.number().int().min(0).max(100);
const handleList = z.array(z.string().trim().toLowerCase().transform(s => s.replace(/^@/, '')).pipe(z.string().regex(/^[a-z0-9_]{1,32}$/))).max(1000);
const zone = z.string().max(80).refine(v => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; }
  catch { return false; }
}, 'Użyj prawidłowej strefy IANA, np. Europe/Warsaw.');

export const settingsSchema = z.object({
  inactivityDays: z.number().int().min(14).max(1095).default(180),
  aggression: z.enum(['Conservative', 'Balanced', 'Aggressive']).default('Balanced'),
  candidateConfidence: score.min(55).default(73),
  spamThreshold: score.min(40).default(68),
  qualityThreshold: score.min(10).default(48),
  postsPerProfile: z.number().int().min(5).max(30).default(8),
  cacheHours: z.number().int().min(1).max(720).default(48),
  retentionDays: z.number().int().min(7).max(365).default(30),
  scheduleEnabled: z.boolean().default(false),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('03:00'),
  timeZone: zone.default('Europe/Warsaw'),
  aiProvider: z.enum(['manual', 'chatgpt', ...apiProviders]).default('manual'),
  aiModel: z.string().max(100).default(''),
  aiPaidConsent: z.boolean().default(false),
  aiScheduled: z.boolean().default(false),
  aiDailyRequests: z.number().int().min(0).max(1000).default(20),
  liveReadsEnabled: z.boolean().default(false),
  xDailyRequests: z.number().int().min(1).max(10000).default(120),
  xDailyBudgetCents: z.number().int().min(1).max(100000).default(500),
  whitelist: handleList.default([]),
  exclusions: handleList.default([]),
  notifications: z.boolean().default(true),
}).strict();
export type Settings = z.output<typeof settingsSchema>;

export const postSchema = z.object({
  id: z.string().max(80),
  text: z.string().max(4000),
  at: z.iso.datetime(),
  kind: z.enum(['post', 'reply']),
});
export type PostSample = z.infer<typeof postSchema>;

export const evidenceSchema = z.object({
  kind: z.enum(['activity', 'spam', 'quality', 'relationship', 'availability']),
  summary: z.string(),
  postId: z.string().optional(),
  url: z.url().optional(),
});
export const evaluationSchema = z.object({
  decision: z.enum(decisions),
  confidence: score,
  inactivity_score: score,
  spam_score: score,
  quality_score: score,
  relationship_score: score,
  data_completeness: score,
  reasons: z.array(z.string()).min(1),
  evidence: z.array(evidenceSchema),
  model_or_rules_version: z.string(),
  evaluated_at: z.iso.datetime(),
  activity: z.enum(activities),
  provider: z.enum(['manual', 'mock', 'chatgpt', ...apiProviders]),
  model: z.string().nullable(),
  aiStatus: z.enum(['not_needed', 'evaluated', 'pending']),
});
export type Evaluation = z.infer<typeof evaluationSchema>;

export const profileQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  view: z.enum(['all', 'candidate', 'kept', 'review', 'unfollowed']).default('all'),
  decision: z.enum(decisions).optional(),
  status: z.enum(dataStatuses).optional(),
  sort: z.enum(['confidence', 'name', 'oldest', 'latest', 'spam']).default('confidence'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
export type ProfileQuery = z.infer<typeof profileQuerySchema>;

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type Account = {
  id: string; xId: string; mode: Mode; username: string; name: string; avatarUrl: string | null;
  verified: boolean; followingCount: number | null; scopes: string[]; connected: boolean;
  connectionError: string | null; settings: Settings; nextScanAt: string | null;
};
export type ProfileEntry = {
  id: string; xId: string; username: string; name: string; bio: string; avatarUrl: string | null;
  url: string | null; website: string | null; openedAt: string | null; followers: number | null;
  follows: number | null; verified: boolean; private: boolean; following: boolean;
  lastActivity: string | null; lastPostAt: string | null; lastReplyAt: string | null;
  lastCheckedAt: string | null; activity: Activity; status: DataStatus; statusReason: string | null;
  decision: Decision; confidence: number; preference: Preference | null; assessment: Evaluation | null;
};
export type ProfileDetail = ProfileEntry & { posts: PostSample[]; history: Evaluation[] };
export type ScanMetrics = {
  following: number; analyzed: number; active: number; occasional: number; inactive: number;
  spam: number; review: number; candidates: number; protected: number; unfollowed: number; coverage: number;
  decisions: Record<Decision, number>; buckets: number[];
};
export type Scan = {
  id: string; state: JobState; phase: 'FOLLOWING' | 'PROFILES'; reason: string;
  seen: number; processed: number; pages: number; availableAt: string; message: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null; summary: ScanMetrics | null;
};
export type Audit = { id: string; kind: string; message: string; createdAt: string };
export type Dashboard = {
  metrics: ScanMetrics; scans: Scan[]; audit: Audit[]; candidates: ProfileEntry[];
  comparison: { at: string; metrics: ScanMetrics }[];
  cleanup: { day: string; unfollow: number; follow: number }[];
};
export type Cleanup = {
  id: string; mode: Mode; direction: typeof actions[number]; expiresAt: string; total: number;
  items: { id: string; profileId: string; username: string; name: string; state: OperationState; result: { message?: string; following?: boolean; pendingFollow?: boolean } | null }[];
};
export type CleanupHistory = {
  id: string; direction: Cleanup['direction']; total: number; createdAt: string; expiresAt: string;
  results: Cleanup['items'];
};
export type AccessState = 'missing' | 'unverified' | 'available' | 'denied' | 'limited' | 'offline';
export type Integrations = {
  x: { configured: boolean; writeEnabled: boolean; callback: string; operations: { key: string; status: AccessState; detail: string }[] };
  chat: { enabled: boolean; connected: boolean; planUsage: boolean; displayName: string | null; scopes: string[]; error: string | null; lastUsage: unknown; callbackAvailable: boolean };
  mcp: { enabled: boolean; keys: { id: string; canPrepare: boolean; expiresAt: string }[] };
  apiProviders: Record<ApiProvider, boolean>;
};
export type ModelChoice = { id: string; label: string };
export type AssistantReply = {
  answer: string; provider: 'manual' | 'chatgpt' | ApiProvider; model: string | null;
  profiles: { id: string; username: string; reason: string }[];
};
