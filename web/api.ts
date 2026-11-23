import type { Account, ApiProvider, Dashboard, Integrations, ProfileDetail, ProfileEntry, ProfileQuery, Page, Scan, Cleanup, CleanupHistory, Preference, ModelChoice, Settings, AssistantReply, Audit } from '../shared/contracts.js';
import { getLanguage } from './i18n.js';

export type Session = { user: { id: string; username: string; initialPassword: boolean } | null; csrf: string | null };
export type SettingsData = { version: 1; settings: Settings; usage: { xRequests: number; xMilliUsd: number; aiRequests: number } | null };
let csrf = '';
export function setCsrf(value?: string | null) { csrf = value ?? ''; }

export class ClientError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ClientError(0, 'network', 'Nie można połączyć się z lokalnym serwerem.');
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && value.code === 'login_required') window.dispatchEvent(new Event('xc-signed-out'));
    throw new ClientError(response.status, value.code ?? 'request', value.message ?? 'Serwer nie ukończył operacji.');
  }
  return value as T;
}

function query(params: Partial<ProfileQuery>) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) values.set(key, String(value));
  return values.toString();
}
const account = (id: string) => '/accounts/' + encodeURIComponent(id);
export const api = {
  session: () => request<Session>('/session').then(data => { setCsrf(data.csrf); return data; }),
  login: (params: { username: string; password: string }) => request<Session>('/session/login', 'POST', params)
    .then(data => { setCsrf(data.csrf); return data; }),
  logout: () => request('/session/logout', 'POST').then(() => setCsrf()),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/session/password', 'POST', { currentPassword, newPassword }).then(() => setCsrf()),
  changeUsername: (username: string, currentPassword: string) =>
    request<{ username: string }>('/session/username', 'POST', { username, currentPassword }),
  accounts: () => request<Account[]>('/accounts'),
  archive: (accountData: string, following: string[]) => request<Account>('/accounts/archive', 'POST', { account: accountData, following }),
  disconnect: (id: string) => request<{ revoked: boolean }>(account(id) + '/disconnect', 'POST'),
  dashboard: (id: string) => request<Dashboard>(account(id) + '/dashboard'),
  history: (id: string) => request<Audit[]>(account(id) + '/history'),
  profiles: (id: string, filters: Partial<ProfileQuery>) => request<Page<ProfileEntry>>(account(id) + '/profiles?' + query(filters)),
  selection: (id: string, filters: Partial<ProfileQuery>) => request<{ ids: string[] }>(account(id) + '/profiles/selection?' + query(filters)),
  profile: (id: string, profileId: string) => request<ProfileDetail>(account(id) + '/profiles/' + profileId),
  preference: (id: string, profileId: string, preference: Preference | null) => request<ProfileEntry>(account(id) + '/profiles/' + profileId + '/preference', 'PUT', { preference }),
  bulkPreference: (id: string, ids: string[], preference: Preference) => request<{ count: number }>(account(id) + '/profiles/preferences', 'POST', { ids, preference }),
  startScan: (id: string, forceRefresh = false) => request<Scan>(account(id) + '/scans', 'POST', { forceRefresh }),
  scanControl: (id: string, scanId: string, action: 'pause' | 'resume' | 'cancel') => request<Scan>(account(id) + '/scans/' + scanId, 'POST', { action }),
  prepare: (id: string, ids: string[], direction: Cleanup['direction'] = 'UNFOLLOW') => request<Cleanup>(account(id) + '/cleanup', 'POST', { ids, direction }),
  cleanup: (id: string, batchId: string, page: number) => request<Cleanup>(account(id) + '/cleanup/' + batchId + '?page=' + page),
  cleanupHistory: (id: string) => request<CleanupHistory[]>(account(id) + '/cleanup'),
  confirm: (id: string, batch: Cleanup, operation: Cleanup['items'][number]) => request<Cleanup>(account(id) + '/cleanup/' + batch.id, 'POST', { operationId: operation.id, confirm: batch.direction, username: operation.username }),
  integrations: (id?: string) => request<Integrations>('/integrations' + (id ? '?accountId=' + id : '')),
  saveXClient: (client: { clientId: string; clientSecret?: string; writeEnabled: boolean }) =>
    request('/integrations/x/client', 'PUT', client),
  startX: () => request<{ url: string }>('/integrations/x/start', 'POST', { acceptCosts: true }),
  startChat: () => request<{ url: string }>('/integrations/chatgpt/start', 'POST', {}),
  finishChat: (receipt: string) => request<Integrations['chat']>('/integrations/chatgpt/finish', 'POST', { receipt }),
  disconnectChat: (forget = false) => request<{ revoked: boolean }>('/integrations/chatgpt/disconnect', 'POST', { forget }),
  models: () => request<ModelChoice[]>('/integrations/chatgpt/models'),
  saveApiKey: (provider: ApiProvider, key: string) => request('/integrations/keys/' + provider, 'PUT', { key }),
  removeApiKey: (provider: ApiProvider) => request('/integrations/keys/' + provider, 'DELETE'),
  settings: (id: string) => request<SettingsData>(account(id) + '/settings'),
  saveSettings: (id: string, settings: Settings) => request<Account>(account(id) + '/settings', 'PUT', settings),
  report: (id: string, format: 'csv' | 'json') => '/api' + account(id) + '/report/' + format,
  assistant: (id: string, question: string, useModel: boolean, profileId?: string) => request<AssistantReply>(account(id) + '/assistant', 'POST', { question, useModel, profileId, language: getLanguage() }),
  addMcp: (id: string, canPrepare: boolean) => request<{ token: string; expiresAt: string }>(account(id) + '/mcp', 'POST', { canPrepare }),
  revokeMcp: (id: string, key: string) => request(account(id) + '/mcp/' + key, 'DELETE'),
};
