import { tr, useLanguage } from './i18n.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowUpRight, Bookmark, ChevronDown, Clock3, Copy, House, LayoutGrid, Link2, ListChecks, LogOut, Menu, MessageSquareText, Radar, ScanSearch, Settings2, ShieldCheck, Sparkles, Trash2, UsersRound, X } from 'lucide-react';
import type { Account, Cleanup, ProfileQuery } from '../shared/contracts.js';
import { api, setCsrf } from './api.js';
import type { Session } from './api.js';
import { AccountsView, ArchiveDialog, IntegrationsLoading, IntegrationsView, PasswordPanel, SettingsView } from './account-views.js';
import type { Run } from './account-views.js';
import { DashboardView, Header, isActive, RightRail } from './dashboard.js';
import { CleanupDialog, ProfileDialog, ProfilesView } from './profiles.js';
import { AssistantView, HistoryView, ScanView } from './work-views.js';
import { Badge, Brand, Button, ErrorBanner, LanguageSwitch, Load, Panel, Toast } from './ui.js';
import '@fontsource-variable/geist';
import './styles.css';

const navigation = [
  ['/', 'Dashboard', LayoutGrid], ['/konta', 'Konta X', UsersRound], ['/profile', 'Obserwowane', ListChecks],
  ['/skanowanie', 'Skanowanie', ScanSearch], ['/do-usuniecia', 'Do usunięcia', Trash2],
  ['/do-zachowania', 'Do zachowania', Bookmark], ['/weryfikacja', 'Weryfikacja AI', Sparkles],
  ['/historia', 'Historia', Clock3], ['/asystent', 'AI Assistant', MessageSquareText],
  ['/integracje', 'Integracje', Link2], ['/ustawienia', 'Ustawienia', Settings2],
] as const;
const profilePaths: Partial<Record<string, ProfileQuery['view']>> = {
  '/profile': 'all', '/do-usuniecia': 'candidate', '/do-zachowania': 'kept', '/weryfikacja': 'review',
};
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 800, refetchOnWindowFocus: true } } });

const resetCommand = 'docker compose exec backend node dist/server/account-cli.js reset-password';
const dccResetCommand = 'docker exec x-cleaner-ai node /app/dist/server/account-cli.js reset-password';

function Login({ message, onSession }: { message?: string; onSession: (session: Session) => void }) {
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true); setError(undefined);
    try { onSession(await api.login({ username: String(data.get('username')), password: String(data.get('password')) })); }
    catch (failure) { setError(failure); }
    finally { setPending(false); }
  }
  return <main className="login-screen">
    <div className="login-box"><div className="login-brand"><Brand /><LanguageSwitch /></div><div className="login-divider" />
      <h1>{tr("Zaloguj się")}</h1>
      <p>{tr(message ?? 'Otwórz panel swoich obserwowanych kont.')}</p>
      <form className="form-stack" onSubmit={submit}>
        <label>{tr("Nazwa użytkownika")}<input name="username" autoComplete="username" minLength={3} maxLength={40} required /></label>
        <label>{tr("Hasło")}<input name="password" type="password" autoComplete="current-password" minLength={1} maxLength={256} required /></label>
        {Boolean(error) && <ErrorBanner error={error} />}
        <Button tone="primary" type="submit" disabled={pending}>{pending ? tr("Logowanie…") : tr("Zaloguj się")}</Button>
      </form>
      <details className="login-recovery">
        <summary>{tr("Pierwsze logowanie lub reset hasła") + " "}<ChevronDown size={16} /></summary>
        <div className="stack">
          <p>{tr("Login i hasło startowe znajdziesz w logu") + " "}<code>initial_credentials</code>{tr("usługi backend.")}</p>
          <code className="command">docker compose logs backend</code>
          <p>{tr("Aby wygenerować nowe hasło, uruchom w katalogu aplikacji poniższe polecenie.")}</p>
          <code className="command">{resetCommand}</code>
          <Button icon={<Copy size={15} />} onClick={() => void navigator.clipboard?.writeText(resetCommand).then(() => setCopied(true)).catch(() => setCopied(false))}>{copied ? tr("Skopiowano") : tr("Skopiuj polecenie resetu")}</Button>
          <p>Docker Control Center</p>
          <code className="command">{dccResetCommand}</code>
        </div>
      </details>
    </div>
  </main>;
}

function Workspace({ username, initialPassword, logout, onPasswordChanged }: { username: string; initialPassword: boolean; logout: () => Promise<void>; onPasswordChanged: () => void }) {
  const qc = useQueryClient();
  const [path, setPath] = useState(location.pathname);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selected, setSelected] = useState(() => localStorage.getItem('xc-account'));
  const [archive, setArchive] = useState(false);
  const [profile, setProfile] = useState<string>();
  const [assistantProfile, setAssistantProfile] = useState<string>();
  const [cleanup, setCleanup] = useState<Cleanup>();
  const [toast, setToast] = useState<{ message: string; error: boolean }>();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const visibleAccounts = accounts.data ?? [];
  const account = visibleAccounts.find(item => item.id === selected) ?? visibleAccounts[0];
  const id = account?.id;
  const data = useQuery({
    queryKey: ['dashboard', id], queryFn: () => api.dashboard(id!), enabled: Boolean(id),
    refetchInterval: query => query.state.data?.scans.some(isActive) ? 1250 : 10000,
  });
  const integrations = useQuery({ queryKey: ['integrations', id], queryFn: () => api.integrations(id), refetchInterval: 15000 });
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  const refresh = useCallback(() => qc.invalidateQueries({ predicate: query => query.queryKey[0] !== 'session' && query.queryKey[0] !== 'models' }), [qc]);
  const run: Run = useCallback(async (work, message) => {
    try { const response = await work(); void refresh(); if (message) notify(message); return response; }
    catch (error) { void refresh(); notify(error instanceof Error ? error.message : tr("Nie udało się wykonać operacji."), true); return undefined; }
  }, [refresh, notify]);

  const navigate = useCallback((next: string) => {
    if (location.pathname !== next || location.search) history.pushState(null, '', next);
    if (next !== '/asystent') setAssistantProfile(undefined);
    setPath(next);
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }, []);
  const select = useCallback((next: string) => {
    setSelected(next); localStorage.setItem('xc-account', next); setProfile(undefined); setCleanup(undefined); setAssistantProfile(undefined);
  }, []);
  const addAccount = (newAccount: Account) => {
    qc.setQueryData<Account[]>(['accounts'], prior => [...(prior ?? []).filter(item => item.id !== newAccount.id), newAccount]);
    select(newAccount.id); navigate('/'); void refresh();
  };
  const consumed = useRef(false);
  useEffect(() => {
    const back = () => { setPath(location.pathname); setMobileMenu(false); };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    if (consumed.current || path !== '/integracje') return;
    const params = new URLSearchParams(location.search);
    const receipt = params.get('complete');
    const event = params.get('event');
    if (!receipt && !event) return;
    consumed.current = true;
    history.replaceState(null, '', path);
    if (receipt) void run(() => api.finishChat(receipt), tr("Zapisano połączenie ChatGPT."));
    if (event) {
      const events: Record<string, string> = {
        x_connected: tr("Połączono konto X. Włącz odczyty i ustaw limit skanowania."),
        x_cancelled: tr("Przerwano autoryzację X."),
        x_credits: tr("X API odmówił odczytu z powodu kredytów."),
        x_forbidden: tr("X API odmówił dostępu do tożsamości."),
        oauth_state: tr("Sesja OAuth jest nieprawidłowa lub wygasła."),
      };
      notify(events[event] ?? tr("Połączenie X nie zostało ukończone."), event !== 'x_connected');
      if (event === 'x_connected') {
        void api.accounts().then(items => {
          const latest = [...items].reverse().find(item => item.connected);
          if (latest) select(latest.id);
          qc.setQueryData(['accounts'], items);
        }).catch(() => {});
      }
    }
  }, [path, run, notify, qc, select]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.error ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const start = async (force = false) => {
    if (!account) return;
    if (account.mode === 'LIVE' && !account.settings.liveReadsEnabled) {
      navigate('/ustawienia'); notify(tr("Włącz odczyty X API i ustaw limit skanowania.")); return;
    }
    const result = await run(() => api.startScan(account.id, force), tr("Zadanie jest w kolejce."));
    if (result) navigate('/skanowanie');
  };
  const prepare = async (ids: string[], direction: Cleanup['direction'] = 'UNFOLLOW') => {
    if (!id) return;
    const batch = await run(() => api.prepare(id, ids, direction));
    if (batch) { setProfile(undefined); setCleanup(batch); }
  };
  const showBatch = async (batchId: string) => {
    if (!id) return;
    const batch = await run(() => api.cleanup(id, batchId, 1));
    if (batch) setCleanup(batch);
  };
  const askWithProfile = (profileId: string) => { setProfile(undefined); setAssistantProfile(profileId); navigate('/asystent'); };
  const setupAction = () => setArchive(true);

  let view;
  if (path === '/konta') view = <AccountsView accounts={visibleAccounts} current={account} onSelect={select} openArchive={setupAction} navigate={navigate} run={run} />;
  else if (path === '/integracje') view = integrations.error ? <ErrorBanner error={integrations.error} retry={() => void integrations.refetch()} /> : integrations.data ?
    <IntegrationsView key={id ?? 'none'} account={account} data={integrations.data} navigate={navigate} run={run} openArchive={setupAction} /> : <IntegrationsLoading />;
  else if (path === '/ustawienia') {
    const security = <PasswordPanel initialized={initialPassword} changed={onPasswordChanged} />;
    view = account ? <SettingsView key={id} account={account} integrations={integrations.data} run={run} notify={notify} security={security} />
      : <><Header title={tr("Ustawienia")} text={tr("Zarządzaj dostępem do lokalnego panelu.")} />{security}</>;
  }
  else if (accounts.isPending) view = <Load />;
  else if (accounts.error) view = <ErrorBanner error={accounts.error} retry={() => void accounts.refetch()} />;
  else if (!account) view = <>
    <Header title={path === '/' ? tr("Przegląd obserwowanych") : navigation.find(([href]) => path.startsWith(href) && href !== '/')?.[1] ?? tr("Przegląd obserwowanych")}
      text={tr("Przejrzyj aktywność, dowody i rekomendacje dla własnej listy.")} />
    <section className="onboarding">
      <div className="onboarding-head"><div className="onboarding-icon"><Radar size={29} /></div>
        <h2>{tr("Dodaj swoją listę obserwowanych")}</h2><p>{tr("Połącz X, aby analizować publiczne posty, albo zaimportuj listę z pobranego archiwum.")}</p></div>
      <div className="onboarding-options">
        <button onClick={() => navigate('/integracje')}><Link2 size={22} className="accent" /><span><strong>{tr("Połącz konto X")}</strong><small>{tr("Aktualne dane i skanowanie przez oficjalne X API.")}</small></span><ArrowUpRight size={17} /></button>
        <button onClick={setupAction}><Archive size={22} className="accent" /><span><strong>{tr("Importuj archiwum")}</strong><small>{tr("Przegląd, ręczna ocena i eksport bez kosztów API.")}</small></span><ArrowUpRight size={17} /></button>
      </div>
    </section>
  </>;
  else if (profilePaths[path]) view = <ProfilesView key={account.id + path} account={account} view={profilePaths[path]!} showProfile={setProfile} prepare={prepare} run={run} />;
  else if (path === '/skanowanie') view = data.error ? <ErrorBanner error={data.error} retry={() => void data.refetch()} /> : <ScanView key={id} account={account} data={data.data} run={run} start={force => void start(force)} />;
  else if (path.startsWith('/historia')) view = <HistoryView account={account} showProfile={setProfile} prepare={prepare} showBatch={batch => void showBatch(batch)} run={run} navigate={navigate} archived={path === '/historia/profile'} />;
  else if (path === '/asystent') {
    const { aiProvider, aiPaidConsent } = account.settings;
    const modelReady = aiProvider === 'chatgpt' ? integrations.data?.chat.planUsage === true
      : aiProvider !== 'manual' && aiPaidConsent && integrations.data?.apiProviders[aiProvider] === true;
    view = <AssistantView key={id + (assistantProfile ?? '')} account={account} profileId={assistantProfile} modelReady={modelReady} showProfile={setProfile} />;
  }
  else view = data.error ? <ErrorBanner error={data.error} retry={() => void data.refetch()} /> : data.data ?
      <DashboardView account={account} data={data.data} navigate={navigate} scan={() => void start()} showProfile={setProfile} />
      : <><Header title={tr("Przegląd obserwowanych")} /><Load /></>;

  const activeTitle = navigation.find(([href]) => (href === '/' ? path === '/' : path.startsWith(href)))?.[1] ?? 'Dashboard';
  return <div className="workspace">
    <a href="#main" className="skip-link">{tr("Przejdź do treści")}</a>
    <aside className={'sidebar' + (mobileMenu ? ' sidebar-open' : '')}>
      <div className="sidebar-brand"><Brand /><Button className="mobile-only icon-only" tone="quiet" icon={<X size={20} />} aria-label={tr("Zamknij menu")} onClick={() => setMobileMenu(false)} /></div>
      <nav aria-label={tr("Menu główne")}>{navigation.map(([href, label, Icon]) => {
        const current = href === '/' ? path === '/' : path.startsWith(href);
        return <a key={href} href={href} aria-current={current ? 'page' : undefined} title={tr(label)} onClick={event => {
          if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(href); }
        }}><Icon size={19} strokeWidth={1.8} /><span>{tr(label)}</span></a>;
      })}</nav>
      <div className="sidebar-footer"><div className="local-user"><span><ShieldCheck size={18} /></span><div><strong>{username}</strong><small>{tr("Konto lokalne")}</small></div></div>
        <Button tone="quiet" className="icon-only" aria-label={tr("Wyloguj")} icon={<LogOut size={18} />} onClick={() => void logout().catch(error => notify(error.message, true))} /></div>
    </aside>
    {mobileMenu && <button className="nav-scrim" aria-label={tr("Zamknij menu boczne")} onClick={() => setMobileMenu(false)} />}
    <div className="app-area">
      <header className="topbar">
        <div className="top-left"><Button tone="quiet" className="mobile-only icon-only" aria-label={tr("Otwórz menu")} aria-expanded={mobileMenu} icon={<Menu size={22} />} onClick={() => setMobileMenu(true)} />
          <House size={16} /><span className="breadcrumb">{tr("Panel główny")}</span><span className="muted">/</span><strong>{tr(activeTitle)}</strong></div>
        <div className="top-right"><Badge color={account?.mode === 'LIVE' ? 'blue' : account ? 'purple' : 'neutral'}>{account?.mode === 'LIVE' ? 'LIVE' : account ? tr("Archiwum X") : tr("Lokalnie")}</Badge><LanguageSwitch /></div>
      </header>
      <div className="main-grid">
        <main id="main" className="main-content">{view}</main>
        <RightRail account={account} accounts={visibleAccounts} data={data.data} integrations={integrations.data} onSelect={select} navigate={navigate} />
      </div>
    </div>
    {archive && <ArchiveDialog onClose={() => setArchive(false)} added={addAccount} notify={notify} />}
    {account && profile && <ProfileDialog key={profile} account={account} id={profile} onClose={() => setProfile(undefined)} run={run} openCleanup={prepare} openAssistant={askWithProfile} />}
    {account && cleanup && <CleanupDialog key={cleanup.id} account={account} initial={cleanup} writeReady={account.connected && integrations.data?.x.writeEnabled === true && account.scopes.includes('follows.write')}
      onClose={() => setCleanup(undefined)} run={run} />}
    {toast && <Toast {...toast} clear={() => setToast(undefined)} />}
  </div>;
}

function App() {
  useLanguage();
  const qc = useQueryClient();
  const [message, setMessage] = useState<string>();
  const session = useQuery({ queryKey: ['session'], queryFn: api.session, staleTime: Infinity });
  useEffect(() => {
    const fail = () => void qc.invalidateQueries({ queryKey: ['session'] });
    window.addEventListener('xc-signed-out', fail);
    return () => window.removeEventListener('xc-signed-out', fail);
  }, [qc]);
  const login = (value: Session) => { setMessage(undefined); qc.setQueryData(['session'], value); };
  const clear = () => {
    setCsrf();
    qc.removeQueries({ predicate: query => query.queryKey[0] !== 'session' });
    qc.setQueryData<Session>(['session'], { user: null, csrf: null });
  };
  const logout = async () => { await api.logout(); clear(); };
  if (session.isPending) return <main className="login-screen"><Load /></main>;
  if (session.error) return <main className="login-screen"><Panel title="X-Cleaner AI"><ErrorBanner error={session.error} retry={() => void session.refetch()} /></Panel></main>;
  if (!session.data?.user) return <Login message={message} onSession={login} />;
  return <Workspace username={session.data.user.username} initialPassword={session.data.user.initialPassword} logout={logout}
    onPasswordChanged={() => { setMessage(tr("Hasło zostało zmienione. Zaloguj się nowym hasłem.")); clear(); }} />;
}

createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
