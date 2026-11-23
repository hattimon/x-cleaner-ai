import { phrase, tr } from './i18n.js';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleStop, Clock3, History, Pause, Play, Search, Send, Sparkles } from 'lucide-react';
import type { Account, AssistantReply, Dashboard } from '../shared/contracts.js';
import { api } from './api.js';
import { Badge, Button, Empty, ErrorBanner, Load, Panel } from './ui.js';
import { Header, isActive, Progress } from './dashboard.js';
import { pl, when } from './locale.js';
import type { Navigate, Run } from './account-views.js';
import { ProfilesView } from './profiles.js';

export function ScanView({ account, data, run, start }: { account: Account; data?: Dashboard; run: Run; start: (force?: boolean) => void }) {
  const [force, setForce] = useState(false);
  return <>
    <Header title={tr("Skanowanie")} text={account.mode === 'ARCHIVE' ? tr("Przelicz reguły na zapisanych lokalnie danych.") : tr("Pobieraj kolejne strony obserwowanych i analizuj dostępne publikacje.")}
      actions={<Button icon={<Play size={17} />} tone="primary" onClick={() => start(force)}>{account.mode === 'LIVE' ? tr("Nowe skanowanie") : tr("Przelicz reguły")}</Button>} />
    {account.mode === 'LIVE' && <label className="check"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} />{tr("Odśwież także posty zapisane w cache. Zwiększa liczbę odczytów X.")}</label>}
    <Panel title={tr("Zadania skanowania")} icon={<Search size={18} />}>
      {!data ? <Load /> : data.scans.length ? <div className="scan-list">{data.scans.map(scan => <section key={scan.id} className="scan-item">
        <div className="rail-line"><strong>{scan.reason === 'SCHEDULED' ? tr("Skan zaplanowany") : scan.reason === 'MCP' ? tr("Skan z MCP") : tr("Zadanie ręczne")}</strong>
          <Badge color={scan.state === 'COMPLETED' ? 'green' : scan.state === 'FAILED' ? 'red' : isActive(scan) ? 'blue' : 'neutral'}>{tr(pl.job[scan.state])}</Badge></div>
        <small>{when(scan.createdAt, account.settings.timeZone)} · {scan.pages} str. · {scan.processed} / {scan.seen} profili</small>
        <Progress scan={scan} />
        {scan.message && <p className="muted">{tr(scan.message)}{scan.state === 'WAITING' ? ' Najwcześniej ' + when(scan.availableAt, account.settings.timeZone) : ''}</p>}
        {isActive(scan) && <div className="row-actions">
          {scan.state === 'PAUSED' ? <Button icon={<Play size={16} />} onClick={() => void run(() => api.scanControl(account.id, scan.id, 'resume'), tr("Wznowiono zadanie."))}>{tr("Wznów")}</Button>
            : <Button icon={<Pause size={16} />} onClick={() => void run(() => api.scanControl(account.id, scan.id, 'pause'), tr("Wstrzymano zadanie."))}>{tr("Wstrzymaj")}</Button>}
          <Button icon={<CircleStop size={16} />} onClick={() => void run(() => api.scanControl(account.id, scan.id, 'cancel'), tr("Anulowano zadanie."))}>{tr("Anuluj zadanie")}</Button>
        </div>}
      </section>)}</div> : <Empty title={tr("Brak zadań skanowania")} text={tr("Uruchom pierwsze zadanie przyciskiem u góry.")} />}
    </Panel>
    <Panel title={tr("Następny skan")} icon={<Clock3 size={18} />}><div className="section-content">{account.nextScanAt ? when(account.nextScanAt, account.settings.timeZone) : tr("Harmonogram jest wyłączony.")}</div></Panel>
  </>;
}

export function HistoryView({ account, showProfile, prepare, showBatch, run, navigate, archived }: {
  account: Account; showProfile: (id: string) => void; prepare: (ids: string[], direction?: 'FOLLOW' | 'UNFOLLOW') => Promise<void>;
  showBatch: (id: string) => void; run: Run; navigate: Navigate; archived: boolean;
}) {
  const data = useQuery({ queryKey: ['history', account.id], queryFn: () => api.history(account.id), enabled: !archived });
  const operations = useQuery({ queryKey: ['cleanup', account.id], queryFn: () => api.cleanupHistory(account.id), enabled: !archived && account.mode === 'LIVE' });
  if (archived) return <><Button onClick={() => navigate('/historia')}>{tr("Wróć do dziennika")}</Button><ProfilesView account={account} view="unfollowed" showProfile={showProfile} prepare={prepare} run={run} /></>;
  return <>
    <Header title={tr("Historia")} text={tr("Dziennik połączeń, zadań i decyzji właściciela.")} actions={<Button onClick={() => navigate('/historia/profile')}>{tr("Dawniej obserwowane")}</Button>} />
    {account.mode === 'LIVE' && <Panel title={tr("Podglądy i operacje X")}>
      {operations.error ? <ErrorBanner error={operations.error} retry={() => void operations.refetch()} /> : operations.isPending ? <Load /> : operations.data?.length ?
        <div className="scan-list">{operations.data.map(batch => <section className="scan-item" key={batch.id}>
          <div className="rail-line"><strong>{batch.direction} · {batch.total} profili</strong><Button onClick={() => showBatch(batch.id)}>{tr("Otwórz podgląd")}</Button></div>
          <small>{when(batch.createdAt, account.settings.timeZone)}{Date.parse(batch.expiresAt) <= Date.now() ? ' · Podgląd wygasł' : ''}</small>
          {batch.results.map(item => <div key={item.id} className="rail-line"><span>@{item.username} {item.result?.message && <small>· {tr(item.result.message)}</small>}</span><Badge>{tr(pl.operation[item.state])}</Badge></div>)}
        </section>)}</div> : <Empty title={tr("Brak przygotowanych operacji")} />}
    </Panel>}
    <Panel title={tr("Dziennik zdarzeń")} icon={<History size={18} />}>
      {data.isPending ? <Load /> : data.error ? <ErrorBanner error={data.error} retry={() => void data.refetch()} /> : data.data?.length ?
        <div className="event-list full">{data.data.map(event => <div key={event.id}><span>{tr(event.message)}</span><small>{when(event.createdAt, account.settings.timeZone)}</small></div>)}</div>
        : <Empty title={tr("Brak zdarzeń dla tego konta")} />}
    </Panel>
  </>;
}

const examples = [
  'Które konta są najmniej aktywne?', 'Przeanalizuj 20 podejrzanych profili', 'Porównaj ostatnie dwa skanowania', 'Zaproponuj plan czyszczenia',
];
export function AssistantView({ account, profileId, modelReady, showProfile }: { account: Account; profileId?: string; modelReady: boolean; showProfile: (id: string) => void }) {
  const [messages, setMessages] = useState<{ question: string; result?: AssistantReply }[]>([]);
  const [question, setQuestion] = useState(profileId ? tr("Dlaczego profil uzyskał taką rekomendację?") : '');
  const [useModel, setUseModel] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>();
  const ask = async (input: string) => {
    const trimmed = input.trim();
    if (trimmed.length < 2 || working) return;
    setWorking(true); setError(undefined);
    try {
      const result = await api.assistant(account.id, trimmed, useModel, profileId);
      setMessages(previous => [...previous, { question: trimmed, result }]); setQuestion('');
    } catch (failure) { setError(failure); }
    finally { setWorking(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void ask(question); };
  return <>
    <Header title="AI Assistant" text={tr('Pytaj o zapisane analizy, dowody i przebieg skanowania.')} />
    <Panel title={tr("Rozmowa o koncie")} icon={<Sparkles size={18} />} right={<Badge color={useModel ? 'blue' : 'neutral'}>{useModel ? account.settings.aiModel : tr("Reguły lokalne")}</Badge>}>
      <div className="section-content stack">
        {!profileId && <div className="example-questions">{examples.map(example => <button disabled={working} key={example} onClick={() => void ask(tr(example))}>{tr(example)}</button>)}</div>}
        <div className="chat-log" aria-live="polite">
          {messages.map((message, index) => <div key={index} className="chat-turn">
            <p className="question">{message.question}</p><div className="answer"><p>{message.result?.answer && tr(message.result.answer)}</p>
              <small className="muted">{message.result?.model ?? tr("Reguły lokalne")}</small>
              {message.result?.profiles.map(profile => <Button tone="quiet" key={profile.id} onClick={() => showProfile(profile.id)}>{/^\d+$/.test(profile.username) ? 'ID ' : '@'}{profile.username}</Button>)}</div>
          </div>)}
          {working && <Load label={tr("Przetwarzanie pytania")} />}
        </div>
        {Boolean(error) && <ErrorBanner error={error} />}
        <form className="form-stack" onSubmit={submit}>
          <label>{tr("Twoje pytanie")}<textarea value={question} onChange={event => setQuestion(event.target.value)} minLength={2} maxLength={1200} rows={3} required placeholder={tr("Np. które profile wymagają sprawdzenia?")} /></label>
          <div className="rail-line">
            <label className="check"><input type="checkbox" checked={useModel && modelReady} disabled={!modelReady || working} onChange={event => setUseModel(event.target.checked)} />{phrase('Użyj wybranego modelu AI', 'Use the selected AI model')}</label>
            <Button tone="primary" type="submit" disabled={question.trim().length < 2 || working} icon={<Send size={16} />}>{tr("Wyślij")}</Button>
          </div>
        </form>
      </div>
    </Panel>
  </>;
}
