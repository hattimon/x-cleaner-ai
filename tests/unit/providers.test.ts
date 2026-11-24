import { expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AppError, readConfig } from '../../server/config.js';
import { digest, Vault } from '../../server/security.js';
import { chatAuthorization, collectSse } from '../../server/ai-providers.js';
import { LiveXProvider, xAuthorization } from '../../server/x-provider.js';
import { apiRequest } from '../../server/external-ai.js';

const cfg = readConfig({ DATABASE_URL: 'postgresql://test', TOKEN_KEY: randomBytes(32).toString('base64url'), X_CLIENT_ID: 'unit-test-client' });
const event = (type: string, data: object) => 'data: ' + JSON.stringify({ type, ...data }) + '\r\n\r\n';
const sse = (value: string) => new Response(value, { headers: { 'Content-Type': 'text/event-stream' } });

it('szyfruje token z izolacją rekordu i wykrywa błędny kontekst', () => {
  const vault = new Vault(cfg.TOKEN_KEY);
  const data = { refresh_token: 'very-sensitive-test-token' };
  const encoded = vault.seal(data, 'one');
  expect(encoded).not.toContain(data.refresh_token);
  expect(vault.open(encoded, 'one')).toEqual(data);
  expect(() => vault.open(encoded, 'two')).toThrow();
});

it('buduje oficjalne autoryzacje z PKCE oraz dynamicznym klientem ChatGPT', () => {
  const challenge = digest('example');
  const x = new URL(xAuthorization(cfg, 'state', challenge));
  expect(x.origin).toBe('https://x.com');
  expect(x.searchParams.get('scope')).not.toContain('follows.write');
  expect(x.searchParams.get('code_challenge_method')).toBe('S256');
  const hostId = 'urn:uuid:54204f2f-8756-4352-a8cc-1363e3aca949';
  const chat = new URL(chatAuthorization(cfg, hostId, { state: 'state', nonce: 'nonce', verifier: 'verifier', challenge }));
  expect(chat.searchParams.get('client_id')).toBe('dynamic_agent_client');
  expect(chat.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3180/api/integrations/chatgpt/callback');
  expect(chat.searchParams.get('ext_agent_host_id')).toBe(hostId);
  expect(chat.searchParams.get('scope')).toContain('chatgpt.tokens.use.direct');
  expect(new URL(chatAuthorization(cfg, hostId, { state: 'state', nonce: 'nonce', verifier: 'verifier', challenge, clientId: 'oaiapp_test' })).searchParams.get('agent_name_hint')).toBeNull();
});

it('czyta ukończony strumień SSE z rzeczywistymi polami zużycia i wykrywa przerwanie', async () => {
  const frame = event('response.output_text.delta', { delta: '{"answer":' }) + event('response.output_text.delta', { delta: '"ok"}' });
  const end = event('response.completed', { response: { usage: { input_tokens: 12, output_tokens: 4 } } });
  await expect(collectSse(sse(frame + end))).resolves.toEqual({ text: '{"answer":"ok"}', usage: { input_tokens: 12, output_tokens: 4 } });
  await expect(collectSse(sse(frame))).rejects.toMatchObject({ code: 'chat_stream_incomplete' });
  await expect(collectSse(sse(event('response.failed', { response: { error: { code: 'usage_limit' } } })))).rejects.toMatchObject({ code: 'chat_limit' });
});

it('X oddziela odpowiedzi od postów i uwzględnia reset rate limitu', async () => {
  const callback = vi.fn<typeof fetch>();
  callback.mockResolvedValueOnce(Response.json({ data: [
    { id: '1', text: 'Pierwszy', created_at: '2026-11-23T01:00:00Z' },
    { id: '2', text: 'Odpowiedź', created_at: '2026-11-23T02:00:00Z', referenced_tweets: [{ id: '1', type: 'replied_to' }] },
  ], meta: { result_count: 2 } }));
  callback.mockResolvedValueOnce(Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  const provider = new LiveXProvider('token-for-unit-test', callback);
  await expect(provider.timeline('123', 8)).resolves.toMatchObject({ posts: [{ kind: 'post' }, { kind: 'reply' }], partial: false });
  expect(String(callback.mock.calls[0][0])).toContain('exclude=retweets');
  const thrown = await provider.following('234', null, 50).catch(error => error as AppError);
  expect(thrown).toMatchObject({ status: 429, code: 'x_rate_limit' });
  expect((thrown as AppError).retryAt!.getTime()).toBeGreaterThan(Date.now() + 110000);
});

it('buduje oficjalne żądania OpenAI, Anthropic i Gemini z oddzielną autoryzacją', () => {
  const schema = { type: 'object', properties: {}, additionalProperties: false };
  const args = ['fixture-key', 'fixture-model', 'System', schema, '{}'] as const;
  expect(apiRequest('openai', ...args)).toMatchObject({ url: 'https://api.openai.com/v1/responses', headers: { Authorization: 'Bearer fixture-key' }, body: { store: false } });
  expect(apiRequest('anthropic', ...args)).toMatchObject({ url: 'https://api.anthropic.com/v1/messages', headers: { 'x-api-key': 'fixture-key' }, body: { output_config: { format: { schema } } } });
  expect(apiRequest('gemini', ...args)).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/models/fixture-model:generateContent', headers: { 'x-goog-api-key': 'fixture-key' }, body: { generationConfig: { responseJsonSchema: schema } } });
});
