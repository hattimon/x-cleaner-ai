import { phrase, tr } from './i18n.js';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArrowUpRight, CloudCog, Download, KeyRound, Link2, Plus, ShieldCheck, Sparkles, Upload, UsersRound } from 'lucide-react';
import type { Account, Integrations, Settings } from '../shared/contracts.js';
import { apiProviders, settingsSchema } from '../shared/contracts.js';
import { api } from './api.js';
import { Badge, Button, Dialog, Empty, ErrorBanner, Load, Panel, ProfileIdentity } from './ui.js';
import type { Notify } from './ui.js';
import { Header } from './dashboard.js';
import { when } from './locale.js';

export type Run = <T>(work: () => Promise<T>, message?: string) => Promise<T | undefined>;
export type Navigate = (path: string) => void;

export function PasswordPanel({ initialized, changed }: { initialized: boolean; changed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = String(data.get('newPassword'));
    if (next !== data.get('confirmedPassword')) { setError(tr("Wpisz to samo nowe hasło w obu polach.")); return; }
    setError(undefined);
    setBusy(true);
    try { await api.changePassword(String(data.get('currentPassword')), next); changed(); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  return <Panel title={tr("Bezpieczeństwo konta lokalnego")} icon={<KeyRound size={18} />}>
    <form className="section-content form-stack" onSubmit={submit}>
      {initialized && <p className="muted">{tr("Korzystasz z wygenerowanego hasła. Tutaj możesz zastąpić je własnym.")}</p>}
      <label>{tr("Obecne hasło")}<input name="currentPassword" type="password" autoComplete="current-password" maxLength={256} required /></label>
      <div className="form-grid">
        <label>{tr("Nowe hasło")}<input name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /><small className="muted">{tr("Co najmniej 12 znaków.")}</small></label>
        <label>{tr("Powtórz nowe hasło")}<input name="confirmedPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required /></label>
      </div>
      {Boolean(error) && <ErrorBanner error={error} />}
      <div className="row-actions"><Button type="submit" tone="primary" disabled={busy}>{busy ? tr("Zapisywanie…") : tr("Zmień hasło")}</Button>
        <small className="muted">{tr("Zmiana kończy wszystkie dotychczasowe sesje.")}</small></div>
    </form>
  </Panel>;
}

export function ArchiveDialog({ onClose, added, notify }: { onClose: () => void; added: (account: Account) => void; notify: Notify }) {
  const [ownerFile, setOwnerFile] = useState<File>();
  const [parts, setParts] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ownerFile || !parts.length) return;
    if (ownerFile.size + parts.reduce((total, file) => total + file.size, 0) > 7000000) { setError(tr("Pliki przekraczają łączny limit 7 MB.")); return; }
    setBusy(true);
    setError(undefined);
    try {
      const [identity, following] = await Promise.all([ownerFile.text(), Promise.all(parts.map(file => file.text()))]);
      const account = await api.archive(identity, following);
      added(account);
      notify(tr("Zaimportowano listę z archiwum X."));
      onClose();
    } catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }
  return <Dialog title={tr("Import z archiwum X")} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <p>{tr("Pobierz archiwum swojego konta z ustawień X. Po rozpakowaniu wybierz pliki z katalogu") + " "}<code>data</code>.</p>
      <label>{tr("Tożsamość konta") + " "}<span>account.js</span><input type="file" accept=".js,.json" required onChange={event => setOwnerFile(event.target.files?.[0])} /></label>
      <label>{tr("Lista obserwowanych") + " "}<span>{tr("following.js i ewentualne pozostałe części")}</span><input type="file" accept=".js,.json" required multiple onChange={event => setParts(Array.from(event.target.files ?? []))} /></label>
      <small className="muted">{tr("Archiwum umożliwia przegląd obserwowanych, ręczną ocenę i eksport. Do analizy postów potrzebny jest odczyt X API.")}</small>
      {Boolean(error) && <ErrorBanner error={error} />}
      <div className="dialog-actions"><Button onClick={onClose}>{tr("Anuluj")}</Button><Button tone="primary" type="submit" disabled={busy} icon={<Archive size={17} />}>{busy ? tr("Importowanie…") : tr("Importuj archiwum")}</Button></div>
    </form>
  </Dialog>;
}

export function AccountsView({ accounts, current, onSelect, openArchive, navigate, run }: {
  accounts: Account[]; current?: Account; onSelect: (id: string) => void; openArchive: () => void; navigate: Navigate; run: Run;
}) {
  const [disconnecting, setDisconnecting] = useState<Account>();
  const [pending, setPending] = useState(false);
  return <>
    <Header title={tr("Konta X")} text={tr("Zarządzaj własnymi kontami i importowanymi listami.")} actions={<Button tone="primary" icon={<Archive size={17} />} onClick={openArchive}>{tr("Importuj archiwum")}</Button>} />
    <Panel title={tr("Źródła danych")} icon={<UsersRound size={18} />}>
      {!accounts.length ? <Empty title={tr("Brak dodanych kont")} text={tr("Podłącz konto przez oficjalne OAuth X albo zaimportuj pliki z archiwum.")} action={<Button onClick={() => navigate('/integracje')} icon={<Link2 size={17} />}>{tr("Skonfiguruj X API")}</Button>} />
        : <div className="account-list">{accounts.map(account => <div className="account-row" key={account.id}>
          <ProfileIdentity item={account} /><Badge color={account.mode === 'LIVE' ? 'blue' : 'purple'}>{account.mode === 'LIVE' ? 'LIVE' : tr("Archiwum")}</Badge>
          <span className="muted">{account.mode === 'LIVE' ? account.connected ? tr("Połączone") : tr("Rozłączone") : tr("Dane lokalne")}</span>
          <div className="row-actions">{current?.id === account.id ? <Badge color="green">{tr("Aktywne")}</Badge> : <Button onClick={() => onSelect(account.id)}>{tr("Ustaw aktywne")}</Button>}
            {account.connected && <Button onClick={() => setDisconnecting(account)}>{tr("Rozłącz")}</Button>}</div>
        </div>)}</div>}
    </Panel>
    {accounts.length > 0 && <Button onClick={() => navigate('/integracje')} icon={<Plus size={17} />}>{tr("Dodaj połączenie X")}</Button>}
    {disconnecting && <Dialog title={tr("Rozłącz konto X")} onClose={() => setDisconnecting(undefined)}>
      <p>Zakończyć połączenie z @{disconnecting.username}? Trwające skanowanie tego konta zostanie anulowane.</p>
      <div className="dialog-actions"><Button onClick={() => setDisconnecting(undefined)}>{tr("Anuluj")}</Button><Button tone="danger" disabled={pending} onClick={async () => {
        setPending(true);
        await run(async () => {
          const { revoked } = await api.disconnect(disconnecting.id);
          setDisconnecting(undefined);
          if (!revoked) throw new Error(tr("Odłączono lokalnie. Cofnij dostęp także w ustawieniach X."));
        }, tr("Rozłączono konto X."));
        setPending(false);
      }}>{tr("Rozłącz konto")}</Button></div>
    </Dialog>}
  </>;
}

const statusLabel = { available: 'Dostępne', denied: 'Odmowa X', limited: 'Limit', offline: 'Archiwum', missing: 'Brak uprawnienia', unverified: 'Do potwierdzenia' };
const apiNames = { openai: 'OpenAI API', anthropic: 'Anthropic Claude API', gemini: 'Google Gemini API' };
const keyNames = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY' };
const chatErrors: Record<string, string> = {
  chat_no_scope: 'Brak przyznanej zgody na korzystanie z planu.',
  chat_reauthorize: 'Połącz ponownie konto ChatGPT.',
  chat_limit: 'Osiągnięto limit planu ChatGPT.',
  chat_plan_unavailable: 'Plan lub uprawnienia nie udostępniły operacji.',
};
export function IntegrationsView({ account, data, run, navigate, openArchive }: { account?: Account; data: Integrations; run: Run; navigate: Navigate; openArchive: () => void }) {
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [canPrepare, setCanPrepare] = useState(false);
  const [key, setKey] = useState<string>();
  const [working, setWorking] = useState(false);
  const { chat, x, mcp } = data;
  const models = useQuery({ queryKey: ['models'], queryFn: api.models, enabled: false });
  const signIn = async (start: () => Promise<{ url: string }>) => {
    setWorking(true);
    const result = await run(start);
    if (result) location.assign(result.url);
    else setWorking(false);
  };
  return <>
    <Header title={tr("Integracje")} text={tr("Stan połączeń, zakresy dostępu i rozliczenia.")} />
    <Panel title="X API v2" icon={<CloudCog size={18} />} right={<Badge color={account?.connected ? 'green' : 'neutral'}>{account?.connected ? tr("Połączono") : x.configured ? tr("Gotowe do połączenia") : tr("Wymaga konfiguracji")}</Badge>}>
      <div className="section-content stack">
        {!x.configured && <p>Ustaw <code>X_CLIENT_ID</code> w pliku <code>.env</code>. W konsoli X zarejestruj poniższy adres przekierowania.</p>}
        <div className="copy-field"><span>{tr("Adres przekierowania")}</span><code>{x.callback}</code></div>
        <p className="muted">{tr("X pobiera opłaty za odczyty i zapisy według zużycia. Połączenie wykonuje odczyt tożsamości. Limit skanowania ustawisz osobno dla każdego konta.")}</p>
        {x.configured && <label className="check"><input type="checkbox" checked={acceptCosts} onChange={event => setAcceptCosts(event.target.checked)} />{tr("Akceptuję koszt odczytu tożsamości w X API.")}</label>}
        <div className="row-actions"><Button tone="primary" icon={<Link2 size={17} />} disabled={!x.configured || !acceptCosts || working} onClick={() => void signIn(api.startX)}>{tr("Połącz konto X")}</Button>
          <Button icon={<Archive size={17} />} onClick={openArchive}>{tr("Importuj archiwum")}</Button></div>
        <div className="diagnostics">{x.operations.map(op => <div key={op.key}><span><strong>{tr(op.key)}</strong><small>{tr(op.detail)}</small></span><Badge color={op.status === 'available' ? 'green' : op.status === 'limited' ? 'yellow' : 'neutral'}>{tr(statusLabel[op.status])}</Badge></div>)}</div>
        <small className="muted">{tr("Zapis LIVE w konfiguracji serwera:") + " "}{x.writeEnabled ? tr("włączony") : tr("wyłączony")}.</small>
      </div>
    </Panel>
    <Panel title="ChatGPT Plan Usage" icon={<Sparkles size={18} />} right={<Badge color={chat.planUsage ? 'green' : 'neutral'}>{chat.planUsage ? tr("Autoryzowano plan") : chat.connected ? tr("Tylko tożsamość") : tr("Rozłączone")}</Badge>}>
      <div className="section-content stack">
        <p>{chat.planUsage ? tr("Analizy wykorzystują dostępny limit połączonego planu ChatGPT.") : tr("Oficjalne logowanie sprawdza uprawnienia i modele dostępne dla Twojego konta. Do pracy lokalnej dostępne są reguły.")}</p>
        {chat.displayName && <div className="copy-field"><span>{tr("Rejestracja ChatGPT")}</span><strong>{chat.displayName}</strong></div>}
        {Boolean(chat.lastUsage) && <small className="muted">{tr("Ostatnie zużycie planu:") + " "}{formatUsage(chat.lastUsage)}</small>}
        {chat.scopes.length > 0 && <small className="muted">Uprawnienia: {chat.scopes.join(', ')}</small>}
        {chat.error && <ErrorBanner error={chatErrors[chat.error] ?? tr("Wymagana weryfikacja uprawnień ChatGPT.")} />}
        {!chat.enabled && <p className="muted">{tr("Aby uruchomić integrację, ustaw ENABLE_CHATGPT_PLAN=true.")}</p>}
        {chat.enabled && !chat.callbackAvailable && <p className="muted">{tr("Do autoryzacji otwórz aplikację przez skonfigurowany adres loopback.")}</p>}
        <div className="row-actions">
          <Button data-oai-siwc-button="" icon={<Sparkles size={17} />} disabled={!chat.enabled || !chat.callbackAvailable || working} onClick={() => void signIn(api.startChat)}>Continue with ChatGPT</Button>
          {chat.connected && <Button onClick={() => void run(async () => {
            const response = await api.disconnectChat();
            if (!response.revoked) throw new Error(tr("Sesja zakończona lokalnie. Cofnij dostęp również w ustawieniach ChatGPT."));
            return response;
          }, tr("Rozłączono ChatGPT."))}>{tr("Rozłącz")}</Button>}
          {!chat.connected && chat.displayName && <Button onClick={() => void run(() => api.disconnectChat(true), tr("Usunięto zapisaną rejestrację."))}>{tr("Usuń rejestrację")}</Button>}
          {chat.planUsage && <Button onClick={() => void models.refetch()} disabled={models.isFetching}>{tr("Sprawdź dostępne modele")}</Button>}
        </div>
        {models.error && <ErrorBanner error={models.error} />}
        {models.data && <ul className="model-list">{models.data.map(model => <li key={model.id}>{model.label}</li>)}</ul>}
        {account && chat.planUsage && <Button tone="quiet" icon={<ArrowUpRight size={16} />} onClick={() => navigate('/ustawienia')}>{tr("Wybierz model w ustawieniach")}</Button>}
      </div>
    </Panel>
    <Panel title={phrase('Dostawcy AI przez API', 'AI API providers')} icon={<KeyRound size={18} />}>
      <div className="section-content stack">
        <p>{phrase('Opcjonalne klucze ustaw w .env i odtwórz backend. Wybierz dostawcę, model i zgodę na rozliczanie dla danego konta.', 'Set optional API keys in .env and recreate the backend. Choose a provider, model and billing consent per account.')}</p>
        <div className="diagnostics">{apiProviders.map(provider => <div key={provider}>
          <span><strong>{apiNames[provider]}</strong><small><code>{keyNames[provider]}</code></small></span>
          <Badge color={data.apiProviders[provider] ? 'green' : 'neutral'}>{data.apiProviders[provider] ? phrase('Klucz skonfigurowany', 'Key configured') : phrase('Brak klucza', 'No key')}</Badge>
        </div>)}</div>
      </div>
    </Panel>
    <Panel title={tr("MCP lokalny")} icon={<KeyRound size={18} />} right={<Badge>{mcp.enabled ? tr("Dostęp przez stdio") : tr("Wyłączono")}</Badge>}>
      <div className="section-content stack">
        <p>{mcp.enabled ? tr("Klucz ogranicza dostęp do bieżącego konta. Połączenie działa w lokalnym kliencie MCP.") : tr("Opcjonalny moduł dla lokalnych klientów. Włącz go przez MCP_ENABLED=true w konfiguracji Compose.")}</p>
        {mcp.enabled && account && <>
          <label className="check"><input type="checkbox" checked={canPrepare} onChange={event => setCanPrepare(event.target.checked)} />{tr("Pozwól zlecać analizy i przygotowywać podglądy.")}</label>
          <Button icon={<KeyRound size={16} />} onClick={async () => { const response = await run(() => api.addMcp(account.id, canPrepare)); if (response) setKey(response.token); }}>{tr("Utwórz klucz MCP")}</Button>
          {key && <div className="copy-field"><span>{tr("Skopiuj klucz. Jest widoczny do opuszczenia ekranu.")}</span><input readOnly value={key} aria-label={tr("Klucz MCP")} onFocus={event => event.currentTarget.select()} /></div>}
          {mcp.keys.map(item => <div className="rail-line" key={item.id}><span>{item.canPrepare ? tr("Odczyt i przygotowanie") : tr("Odczyt")} · {when(item.expiresAt)}</span>
            <Button onClick={() => { setKey(undefined); void run(() => api.revokeMcp(account.id, item.id), tr("Cofnięto dostęp MCP.")); }}>{tr("Cofnij klucz")}</Button></div>)}
        </>}
      </div>
    </Panel>
  </>;
}

function formatUsage(source: unknown) {
  if (!source || typeof source !== 'object') return '—';
  const data = source as { model?: string; at?: string; input_tokens?: number; output_tokens?: number };
  return [data.model, data.at ? when(data.at) : undefined,
    data.input_tokens !== undefined ? `${data.input_tokens} wejściowe / ${data.output_tokens ?? 0} wyjściowe tokeny` : undefined].filter(Boolean).join(' · ');
}

const fields = [
  ['inactivityDays', 'Próg nieaktywności (dni)', 14, 1095],
  ['candidateConfidence', 'Minimalna pewność rekomendacji', 55, 100],
  ['spamThreshold', 'Próg sygnałów spamu', 40, 100],
  ['qualityThreshold', 'Próg jakości', 10, 100],
  ['postsPerProfile', 'Próbka postów na profil', 5, 30],
  ['cacheHours', 'Ważność cache (godziny)', 1, 720],
  ['retentionDays', 'Retencja analiz i postów (dni)', 7, 365],
] as const;

function downloadSettings(options: Settings) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, settings: options }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'x-cleaner-settings.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SettingsView({ account, integrations, run, notify, security }: { account: Account; integrations?: Integrations; run: Run; notify: Notify; security: ReactNode }) {
  const [form, setForm] = useState(account.settings);
  const [whitelist, setWhitelist] = useState(account.settings.whitelist.join('\n'));
  const [exclusions, setExclusions] = useState(account.settings.exclusions.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const canUseModels = integrations?.chat.planUsage === true && form.aiProvider === 'chatgpt';
  const external = apiProviders.find(provider => provider === form.aiProvider);
  const models = useQuery({ queryKey: ['models'], queryFn: api.models, enabled: canUseModels, retry: false });
  const usage = useQuery({ queryKey: ['settings', account.id], queryFn: () => api.settings(account.id) });
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm(prev => ({ ...prev, [key]: value }));
  const list = (value: string) => value.split(/[\n,\s]+/).map(item => item.trim()).filter(Boolean);
  const read = () => settingsSchema.parse({ ...form, whitelist: list(whitelist), exclusions: list(exclusions) });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      const settings = read();
      setBusy(true);
      await run(() => api.saveSettings(account.id, settings), tr("Zapisano ustawienia konta."));
    } catch { setError(tr("Sprawdź progi, strefę czasową i format wpisów na listach ochrony.")); }
    finally { setBusy(false); }
  };
  return <>
    <Header title={tr("Ustawienia")} text={tr("Reguły i limity konta @") + account.username + '.'} />
    {security}
    <form className="stack" onSubmit={save}>
      <Panel title={tr("Klasyfikacja i retencja")} icon={<ShieldCheck size={18} />}>
        <div className="section-content form-grid">
          <label>{tr("Tryb klasyfikacji")}<select value={form.aggression} onChange={event => set('aggression', event.target.value as Settings['aggression'])}>
            <option value="Conservative">{tr("Ostrożny")}</option><option value="Balanced">{tr("Zrównoważony")}</option><option value="Aggressive">{tr("Rozszerzony")}</option>
          </select></label>
          {fields.map(([key, label, min, max]) => <label key={key}>{tr(label)}<input type="number" value={form[key]} min={min} max={max} required onChange={event => set(key, Number(event.target.value))} /></label>)}
        </div>
      </Panel>
      <Panel title={tr("Odczyty i harmonogram X")}>
        <div className="section-content stack">
          {account.mode === 'ARCHIVE' ? <p className="muted">{tr("Harmonogram odświeżania wymaga podłączonego konta X API.")}</p> : <>
            <label className="check"><input type="checkbox" checked={form.liveReadsEnabled} onChange={event => setForm(prev => ({ ...prev, liveReadsEnabled: event.target.checked, scheduleEnabled: event.target.checked && prev.scheduleEnabled }))} />{tr("Zgadzam się na odczyty rozliczane przez X API.")}</label>
            <label className="check"><input type="checkbox" checked={form.scheduleEnabled} disabled={!form.liveReadsEnabled} onChange={event => set('scheduleEnabled', event.target.checked)} />{tr("Włącz codzienny skan.")}</label>
            <div className="form-grid">
              <label>{tr("Godzina")}<input type="time" value={form.scheduleTime} required onChange={event => set('scheduleTime', event.target.value)} /></label>
              <label>{tr("Strefa czasowa")}<input value={form.timeZone} required maxLength={80} onChange={event => set('timeZone', event.target.value)} /></label>
              <label>{tr("Dzienny limit wywołań X")}<input type="number" value={form.xDailyRequests} min={1} max={10000} required onChange={event => set('xDailyRequests', Number(event.target.value))} /></label>
              <label>{tr("Dzienny szacowany budżet X (centy USD)")}<input type="number" value={form.xDailyBudgetCents} min={1} max={100000} required onChange={event => set('xDailyBudgetCents', Number(event.target.value))} /></label>
            </div>
            <small className="muted">{tr("Dziś:") + " "}{usage.data?.usage?.xRequests ?? 0}{tr("wywołań, rezerwa") + " "}{((usage.data?.usage?.xMilliUsd ?? 0) / 1000).toFixed(3)}{tr("USD. Rozliczenie znajduje się w konsoli X.")}</small>
          </>}
          <label className="check"><input type="checkbox" checked={form.notifications} onChange={event => set('notifications', event.target.checked)} />{tr("Pokaż alerty i ostatnie zdarzenia w panelu.")}</label>
        </div>
      </Panel>
      <Panel title={tr("Dostawca AI")} icon={<Sparkles size={18} />}>
        <div className="section-content stack">
          <div className="form-grid">
            <label>{tr("Dostawca")}<select value={form.aiProvider} onChange={event => setForm(previous => ({
              ...previous, aiProvider: event.target.value as Settings['aiProvider'], aiModel: '', aiPaidConsent: false, aiScheduled: false,
            }))}>
              <option value="manual">{tr("Reguły lokalne · bezpłatnie")}</option>
              <option value="chatgpt" disabled={!integrations?.chat.planUsage && form.aiProvider !== 'chatgpt'}>ChatGPT Plan Usage</option>
              {apiProviders.map(provider => <option key={provider} value={provider} disabled={!integrations?.apiProviders[provider] && form.aiProvider !== provider}>{apiNames[provider]}</option>)}
            </select></label>
            <label>{tr("Wybrany model")}{external ? <input required maxLength={100} value={form.aiModel} onChange={event => set('aiModel', event.target.value)}
              placeholder={phrase('Identyfikator modelu z konsoli dostawcy', 'Model ID from your provider console')} /> : <select value={form.aiModel} disabled={form.aiProvider !== 'chatgpt' || !models.data?.length} onChange={event => set('aiModel', event.target.value)}>
              <option value="">{tr("Wybierz model")}</option>
              {form.aiModel && !models.data?.some(model => model.id === form.aiModel) && <option value={form.aiModel}>{form.aiModel}</option>}
              {models.data?.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>}</label>
            <label>{tr("Dzienny limit wywołań AI")}<input type="number" value={form.aiDailyRequests} min={0} max={1000} required onChange={event => set('aiDailyRequests', Number(event.target.value))} /></label>
          </div>
          {models.error && <ErrorBanner error={models.error} />}
          {external && <label className="check"><input type="checkbox" required checked={form.aiPaidConsent} onChange={event => set('aiPaidConsent', event.target.checked)} />
            {phrase('Akceptuję rozliczenia dostawcy za użycie API.', 'I accept the provider’s API usage charges.')}</label>}
          <label className="check"><input type="checkbox" checked={form.aiScheduled} disabled={form.aiProvider === 'manual' || account.mode !== 'LIVE'} onChange={event => set('aiScheduled', event.target.checked)} />{tr("Używaj AI również przy zaplanowanym skanie.")}</label>
          <small className="muted">{tr("Dziś:") + " "}{usage.data?.usage?.aiRequests ?? 0}{tr("wywołań. Do modelu trafiają wnioski lokalnych reguł i identyfikatory źródeł.")}</small>
        </div>
      </Panel>
      <Panel title={tr("Ochrona kont")}>
        <div className="section-content form-grid">
          <label>{tr("Biała lista")}<span>Nazwy użytkowników, po jednej w wierszu.</span><textarea value={whitelist} onChange={event => setWhitelist(event.target.value)} rows={4} /></label>
          <label>{tr("Ręczne wykluczenia")}<span>Nazwy lub ID dla list z archiwum.</span><textarea value={exclusions} onChange={event => setExclusions(event.target.value)} rows={4} /></label>
        </div>
      </Panel>
      {Boolean(error) && <ErrorBanner error={error} />}
      <div className="header-actions">
        <Button type="submit" tone="primary" disabled={busy}>{busy ? tr("Zapisywanie…") : tr("Zapisz ustawienia")}</Button>
        <Button icon={<Download size={16} />} onClick={() => { try { downloadSettings(read()); } catch { notify(tr("Popraw błędne ustawienia przed eksportem."), true); } }}>{tr("Eksportuj konfigurację")}</Button>
        <label className="button button--secondary file-button"><Upload size={16} />{tr("Importuj konfigurację")}<input type="file" accept=".json" onChange={async event => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          try {
            if (file.size > 250000) throw new Error();
            const value = JSON.parse(await file.text());
            if (value.version !== 1) throw new Error();
            const settings = settingsSchema.parse(value.settings);
            setForm(settings); setWhitelist(settings.whitelist.join('\n')); setExclusions(settings.exclusions.join('\n'));
            notify(tr("Wczytano konfigurację. Zapisz ustawienia, aby ją zastosować."));
          } catch { notify(tr("Plik ma nieobsługiwany format konfiguracji."), true); }
        }} /></label>
      </div>
    </form>
  </>;
}

export function IntegrationsLoading() { return <><Header title={tr("Integracje")} /><Load /></>; }
