import { z } from 'zod';
import type { PostSample } from '../shared/contracts.js';
import type { Config } from './config.js';
import { AppError } from './config.js';

const authOrigin = 'https://x.com/i/oauth2/authorize';
const api = 'https://api.x.com/2';
const userId = z.string().regex(/^\d{1,24}$/);
const dateField = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const userFields = 'id,name,username,profile_image_url,description,url,public_metrics,created_at,protected,verified,verified_type';
const xUser = z.object({
  id: userId, username: z.string().max(32).regex(/^[A-Za-z0-9_]+$/), name: z.string().max(120),
  description: z.string().max(1000).optional(), url: z.string().max(2000).optional(),
  profile_image_url: z.string().max(2000).optional(), created_at: dateField.optional(),
  protected: z.boolean().optional(), verified: z.boolean().optional(), verified_type: z.string().optional(),
  public_metrics: z.object({ followers_count: z.number().int().nonnegative(), following_count: z.number().int().nonnegative() }).optional(),
});
const xPost = z.object({
  id: userId, text: z.string().transform(s => s.slice(0, 4000)), created_at: dateField,
  referenced_tweets: z.array(z.object({ type: z.string(), id: userId })).optional(),
});
const xErrorBody = z.object({ type: z.string().optional(), title: z.string().optional() }).passthrough();
const tokensSchema = z.object({
  access_token: z.string().min(10).max(12000), refresh_token: z.string().min(10).max(12000).optional(),
  token_type: z.string().refine(v => v.toLowerCase() === 'bearer'), expires_in: z.number().int().positive(), scope: z.string().optional(),
});
export type OAuthTokens = z.infer<typeof tokensSchema>;
export type XProfile = {
  xId: string; username: string; name: string; bio: string; website: string | null;
  avatarUrl: string | null; openedAt: Date | null; followers: number | null; follows: number | null;
  verified: boolean; private: boolean;
};
export type Timeline = { posts: PostSample[]; partial: boolean };
export type WriteResult = { following: boolean; pendingFollow: boolean };
export interface XProvider {
  following(id: string, cursor: string | null, limit: number): Promise<{ profiles: XProfile[]; next: string | null }>;
  timeline(id: string, size: number): Promise<Timeline>;
  write(source: string, target: string, direction: 'FOLLOW' | 'UNFOLLOW'): Promise<WriteResult>;
}

export function xScopes(write: boolean) {
  return ['tweet.read', 'users.read', 'follows.read', 'offline.access', ...(write ? ['follows.write'] : [])];
}
export const xCallback = (config: Config) => config.PUBLIC_ORIGIN + '/api/integrations/x/callback';

export function xAuthorization(config: Config, state: string, challenge: string) {
  const url = new URL(authOrigin);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: config.X_CLIENT_ID, redirect_uri: xCallback(config),
    scope: xScopes(config.X_ENABLE_WRITE).join(' '), state, code_challenge: challenge, code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

function retryTime(headers: Headers) {
  const reset = Number(headers.get('x-rate-limit-reset'));
  const retry = headers.get('retry-after');
  const hint = retry ? (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry)) : 0;
  return new Date(Math.max(Date.now() + (reset || hint ? 1000 : 60000), reset * 1000 || 0, Number.isFinite(hint) ? hint : 0));
}

function xFailure(status: number, headers: Headers, body: unknown) {
  const problem = xErrorBody.safeParse(body);
  const description = problem.success ? (problem.data.type ?? '') + ' ' + (problem.data.title ?? '') : '';
  if (status === 429) return new AppError(429, 'x_rate_limit', 'X API ograniczył liczbę wywołań. Zadanie zostanie wznowione.', retryTime(headers));
  if (status === 401) return new AppError(401, 'x_unauthorized', 'Wymagane ponowne połączenie konta X.');
  if (status === 402 || /credit|usage.cap/i.test(description)) return new AppError(402, 'x_credits', 'Konsola X nie udostępniła kredytów dla tej operacji.');
  if (status === 403) return new AppError(403, 'x_forbidden', 'X API odmówił uprawnienia do tej operacji.');
  if (status === 404) return new AppError(404, 'x_unavailable', 'Zasób jest niedostępny w X API.');
  if (status >= 500) return new AppError(503, 'x_upstream', 'Tymczasowy błąd X API.');
  return new AppError(422, 'x_rejected', 'X API odrzucił żądanie. Sprawdź ustawienia aplikacji w konsoli X.');
}

async function fetchX(fetcher: typeof fetch, path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetcher(api + path, { ...init, signal: AbortSignal.timeout(10000), redirect: 'error' });
  } catch {
    throw new AppError(503, 'x_network', 'Nie udało się uzyskać odpowiedzi z X API.');
  }
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) throw xFailure(response.status, response.headers, value);
  return value;
}

async function exchange(config: Config, values: Record<string, string>, fetcher: typeof fetch) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(config.X_CLIENT_ID + ':' + config.X_CLIENT_SECRET).toString('base64');
  const data = await fetchX(fetcher, '/oauth2/token', {
    method: 'POST', headers, body: new URLSearchParams({ ...values, client_id: config.X_CLIENT_ID }),
  });
  const tokens = tokensSchema.safeParse(data);
  if (!tokens.success) throw new AppError(502, 'x_token_format', 'X zwrócił niepełną odpowiedź OAuth.');
  return tokens.data;
}

export const exchangeXCode = (config: Config, code: string, verifier: string, fetcher = fetch) => exchange(config, {
  grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: xCallback(config),
}, fetcher);
export const refreshX = (config: Config, token: string, fetcher = fetch) =>
  exchange(config, { grant_type: 'refresh_token', refresh_token: token }, fetcher);

export async function revokeX(config: Config, token: string, type: 'access_token' | 'refresh_token', fetcher = fetch) {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(config.X_CLIENT_ID + ':' + config.X_CLIENT_SECRET).toString('base64');
  await fetchX(fetcher, '/oauth2/revoke', {
    method: 'POST', headers, body: new URLSearchParams({ token, token_type_hint: type, client_id: config.X_CLIENT_ID }),
  });
}

function safeUrl(value: string | undefined, hosts?: string[]) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (hosts && !hosts.includes(url.hostname))) return null;
    return url.href;
  } catch { return null; }
}

function mapUser(raw: z.infer<typeof xUser>): XProfile {
  return {
    xId: raw.id, username: raw.username, name: raw.name, bio: raw.description ?? '',
    avatarUrl: safeUrl(raw.profile_image_url, ['pbs.twimg.com']), website: safeUrl(raw.url), openedAt: raw.created_at ?? null,
    followers: raw.public_metrics?.followers_count ?? null, follows: raw.public_metrics?.following_count ?? null,
    verified: Boolean(raw.verified) || ['blue', 'government', 'business'].includes(raw.verified_type ?? ''),
    private: Boolean(raw.protected),
  };
}

function checked<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new AppError(502, 'x_response_format', 'Odpowiedź X API nie zawiera wymaganych danych.');
  return result.data;
}

export class LiveXProvider implements XProvider {
  constructor(private readonly token: string, private readonly fetcher = fetch) {}
  private call(path: string, init: RequestInit = {}) {
    return fetchX(this.fetcher, path, { ...init, headers: { Authorization: 'Bearer ' + this.token, ...init.headers } });
  }
  async me() {
    const raw = await this.call('/users/me?' + new URLSearchParams({ 'user.fields': userFields }));
    return mapUser(checked(z.object({ data: xUser }), raw).data);
  }
  async following(id: string, cursor: string | null, limit: number) {
    const params = new URLSearchParams({ 'user.fields': userFields, max_results: String(limit) });
    if (cursor) params.set('pagination_token', cursor);
    const raw = await this.call('/users/' + userId.parse(id) + '/following?' + params);
    const value = checked(z.object({
      data: z.array(xUser).optional(), errors: z.array(z.unknown()).optional(),
      meta: z.object({ result_count: z.number().int().nonnegative(), next_token: z.string().min(1).max(1500).optional() }),
    }), raw);
    if (value.errors?.length || (value.data?.length ?? 0) !== value.meta.result_count) {
      throw new AppError(502, 'x_partial_page', 'X zwrócił niepełną stronę obserwowanych. Zachowano poprzedni stan listy.');
    }
    return { profiles: (value.data ?? []).map(mapUser), next: value.meta.next_token ?? null };
  }
  async timeline(id: string, size: number): Promise<Timeline> {
    const params = new URLSearchParams({
      'tweet.fields': 'created_at,referenced_tweets', max_results: String(size), exclude: 'retweets',
    });
    const raw = await this.call('/users/' + userId.parse(id) + '/tweets?' + params);
    const value = checked(z.object({
      data: z.array(xPost).optional(), errors: z.array(z.unknown()).optional(),
      meta: z.object({ result_count: z.number().int().nonnegative() }).optional(),
    }), raw);
    if (!value.meta && !value.errors?.length && !value.data) throw new AppError(502, 'x_timeline_format', 'X zwrócił niepełną próbkę postów.');
    const posts = (value.data ?? []).map(post => ({
      id: post.id, text: post.text, at: post.created_at.toISOString(),
      kind: post.referenced_tweets?.some(ref => ref.type === 'replied_to') ? 'reply' as const : 'post' as const,
    }));
    return { posts, partial: Boolean(value.errors?.length) || (value.meta !== undefined && value.meta.result_count !== posts.length) };
  }
  async write(source: string, target: string, direction: 'FOLLOW' | 'UNFOLLOW') {
    const base = '/users/' + userId.parse(source) + '/following';
    const raw = direction === 'FOLLOW'
      ? await this.call(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_user_id: userId.parse(target) }) })
      : await this.call(base + '/' + userId.parse(target), { method: 'DELETE' });
    const { data } = checked(z.object({ data: z.object({ following: z.boolean(), pending_follow: z.boolean().optional() }) }), raw);
    return { following: data.following, pendingFollow: Boolean(data.pending_follow) };
  }
}
