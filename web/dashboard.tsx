import { tr } from './i18n.js';
import { Activity, ArrowDownToLine, ArrowRight, CalendarClock, ChartNoAxesCombined, CheckCircle2, Clock3, ListFilter, Play, Radar, Search, ShieldCheck, Sparkles, Trash2, TriangleAlert, UserRound, UsersRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { activeJobStates, decisions } from '../shared/contracts.js';
import type { Account, Dashboard, Integrations, Scan } from '../shared/contracts.js';
import { Badge, Button, Empty, Panel, ProfileIdentity } from './ui.js';
import { number, pl, recency, when } from './locale.js';
import { api } from './api.js';

const colors = { KEEP: '#00ba7c', REVIEW: '#ffd400', UNFOLLOW_CANDIDATE: '#f45b64', PROTECTED: '#a78bfa', UNKNOWN: '#687783' };
const bins = ['≤7 dni', '8–30', '31–90', '91–180', '>180', 'Brak'];
export const isActive = (scan: Scan) => activeJobStates.some(state => state === scan.state);

export function Progress({ scan }: { scan: Scan }) {
  const reaching = scan.phase === 'FOLLOWING' && isActive(scan);
  const completion = scan.state === 'COMPLETED' ? 100 : scan.seen ? Math.round(scan.processed / scan.seen * 100) : 0;
  return <div className="progress-row">
    <progress aria-label={tr("Postęp skanowania")} max={100} value={reaching ? undefined : completion} className={scan.state === 'COMPLETED' ? 'complete' : ''} />
    <span>{reaching ? scan.pages + ' str.' : completion + '%'}</span>
  </div>;
}

function Metric({ title, value, foot, icon, color }: { title: string; value: number; foot: string; icon: ReactNode; color: string }) {
  return <div className="metric"><div className="metric-title"><span className={color}>{icon}</span>{title}</div><strong>{number.format(value)}</strong><small>{foot}</small></div>;
}

function Donut({ metrics }: { metrics: Dashboard['metrics'] }) {
  const total = decisions.reduce((sum, key) => sum + metrics.decisions[key], 0);
  let offset = 0;
  const values = decisions.filter(key => metrics.decisions[key]).map(key => {
    const from = offset;
    offset += metrics.decisions[key] / total * 100;
    return `${colors[key]} ${from}% ${offset}%`;
  });
  return <div className="donut-layout">
    <div className="donut" aria-hidden="true" style={{ background: values.length ? 'conic-gradient(' + values.join(',') + ')' : 'var(--elevated)' }}>
      <div><strong>{number.format(total)}</strong><small>{tr("profili na liście")}</small></div>
    </div>
    <ul className="chart-legend">{decisions.map(key => <li key={key}><i style={{ backgroundColor: colors[key] }} /><span>{tr(pl.decision[key])}</span><strong>{number.format(metrics.decisions[key])}</strong></li>)}</ul>
  </div>;
}

function Bars({ values, labels, label, alternate }: { values: number[]; labels: string[]; label: string; alternate?: number[] }) {
  if (!values.length) return <div className="chart-empty">{tr("Brak zapisanych pomiarów.")}</div>;
  const max = Math.max(1, ...values, ...(alternate ?? []));
  return <div className="bar-chart" role="img" aria-label={label + '. ' + labels.map((name, i) => `${name}: ${values[i]}${alternate ? '/' + alternate[i] : ''}`).join(', ')}>
    <div className="y-labels" aria-hidden="true"><span>{number.format(max)}</span><span>{number.format(Math.floor(max / 2))}</span><span>0</span></div>
    <div className="bar-surface" aria-hidden="true">
      <div className="bars">{values.map((value, index) => <div key={index} className="bar-column" title={labels[index] + ': ' + value}>
        <div className="bar" data-zero={value === 0} style={{ height: 100 * value / max + '%' }} />{alternate && <div className="bar bar-alt" data-zero={alternate[index] === 0} style={{ height: 100 * alternate[index] / max + '%' }} />}
      </div>)}</div>
      <div className="x-labels">{labels.map((value, index) => <span key={index}>{value}</span>)}</div>
    </div>
  </div>;
}

export function Header({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) {
  return <div className="page-header"><div><h1>{tr(title)}</h1>{text && <p>{tr(text)}</p>}</div>{actions && <div className="header-actions">{actions}</div>}</div>;
}

export function DashboardView({ account, data, scan, showProfile, navigate }: {
  account: Account; data: Dashboard; scan: () => void; showProfile: (id: string) => void; navigate: (path: string) => void;
}) {
  const { metrics, scans, comparison, cleanup } = data;
  const previous = comparison.at(-2)?.metrics.following;
  const trend = previous === undefined ? null : metrics.following - previous;
  const last = scans.find(job => job.state === 'COMPLETED');
  return <>
    <Header title={tr("Przegląd obserwowanych")} text={tr("Aktywność, jakość i rekomendacje dla Twojej listy.")}
      actions={<><Button tone="primary" icon={<Play size={17} />} onClick={scan}>{account.mode === 'LIVE' ? tr("Nowe skanowanie") : tr("Przelicz reguły")}</Button>
        <details className="export-menu"><summary className="button button--secondary"><ArrowDownToLine size={17} />{tr("Eksportuj")}</summary>
          <div><a href={api.report(account.id, 'csv')}>{tr("Raport CSV")}</a><a href={api.report(account.id, 'json')}>{tr("Raport JSON")}</a></div>
        </details></>} />
    <section className="metrics" aria-label="Statystyki">
      <Metric title={tr("Obserwowane")} value={metrics.following} foot={trend === null ? tr("Na liście konta") : (trend > 0 ? '+' : '') + trend + ' od poprzedniego skanu'} color="accent" icon={<UsersRound size={18} />} />
      <Metric title={tr("Przeanalizowane")} value={metrics.analyzed} foot={metrics.coverage + '% pokrycia listy'} color="green" icon={<Search size={18} />} />
      <Metric title={tr("Do weryfikacji")} value={metrics.review} foot="W tym profile bez danych" color="yellow" icon={<TriangleAlert size={18} />} />
      <Metric title={tr("Do usunięcia")} value={metrics.candidates} foot={tr("Aktualne rekomendacje")} color="red" icon={<Trash2 size={18} />} />
    </section>
    <section className="chart-grid">
      <Panel title={tr("Struktura kont")} className="chart-panel" right={<ChartNoAxesCombined size={17} className="muted" />}><Donut metrics={metrics} /></Panel>
      <Panel title={tr("Ostatnia aktywność")} className="chart-panel" right={<Activity size={17} className="muted" />}>
        <Bars values={metrics.buckets} labels={bins.map(tr)} label={tr("Ostatnia potwierdzona aktywność")} />
      </Panel>
    </section>
    <Panel title={tr("Kandydaci do usunięcia")} right={<Button tone="quiet" icon={<ArrowRight size={15} />} onClick={() => navigate('/do-usuniecia')}>{tr("Pokaż wszystkie")}</Button>}>
      {data.candidates.length ? <div className="compact-list">{data.candidates.map(row => <button key={row.id} onClick={() => showProfile(row.id)}>
        <ProfileIdentity item={row} /><span title={when(row.lastActivity)}>{recency(row.lastActivity)}</span>
        <span><strong>{row.assessment?.spam_score ?? '—'}</strong><small>{tr("Sygnały spamu")}</small></span><ArrowRight size={16} />
      </button>)}</div> : <Empty icon={<ListFilter size={22} />} title={tr("Brak aktualnych kandydatów")} text={account.mode === 'ARCHIVE' ? tr("Lista z archiwum zawiera identyfikatory. Ocena aktywności wymaga postów z X API.") : tr("Rekomendacje pojawią się po analizie dostępnych postów.")} />}
    </Panel>
    <section className="mini-metrics" aria-label={tr("Dodatkowe statystyki")}>
      {[[tr("Aktywne"), metrics.active], [tr("Nieaktywne"), metrics.inactive], [tr("Podejrzenie spamu"), metrics.spam], [tr("Chronione"), metrics.protected], ['Unfollow', metrics.unfollowed]].map(([label, value]) =>
        <div key={label}><small>{tr(String(label))}</small><strong>{number.format(Number(value))}</strong></div>)}
    </section>
    <section className="chart-grid history-charts">
      <Panel title={tr("Trend obserwowanych")}><Bars values={comparison.map(value => value.metrics.following)} labels={comparison.map(value => value.at.slice(5, 10))} label={tr("Liczba obserwowanych w kolejnych skanach")} /></Panel>
      <Panel title={tr("Trend nieaktywności")}><Bars values={comparison.map(value => value.metrics.inactive)} labels={comparison.map(value => value.at.slice(5, 10))} label={tr("Liczba nieaktywnych w kolejnych skanach")} /></Panel>
      <Panel title={tr("Porównanie skanów")} right={<small className="muted">{tr("Kandydaci / weryfikacja")}</small>}><Bars values={comparison.slice(-7).map(value => value.metrics.candidates)} alternate={comparison.slice(-7).map(value => value.metrics.review)} labels={comparison.slice(-7).map(value => value.at.slice(5, 10))} label={tr("Kandydaci i profile do weryfikacji")} /></Panel>
      <Panel title={tr("Historia czyszczenia")} right={<small className="muted">Unfollow / follow</small>}><Bars values={cleanup.slice(-7).map(value => value.unfollow)} alternate={cleanup.slice(-7).map(value => value.follow)} labels={cleanup.slice(-7).map(value => value.day.slice(5))} label={tr("Wykonane operacje unfollow i follow")} /></Panel>
    </section>
    {last && <div className="footnote"><CheckCircle2 size={15} />{tr("Ostatni ukończony skan") + " "}{when(last.finishedAt, account.settings.timeZone)}</div>}
  </>;
}

export function RightRail({ account, accounts, data, integrations, onSelect, navigate }: {
  account?: Account; accounts: Account[]; data?: Dashboard; integrations?: Integrations; onSelect: (id: string) => void; navigate: (path: string) => void;
}) {
  const scan = data?.scans[0];
  return <aside className="rail" aria-label={tr("Status aplikacji")}>
    <Panel title={tr("Aktywne konto")} icon={<UserRound size={17} />}>
      <div className="rail-content">{account ? <>
        <ProfileIdentity item={account} />
        {accounts.length > 1 && <select value={account.id} onChange={event => onSelect(event.target.value)} aria-label={tr("Przełącz aktywne konto")}>
          {accounts.map(option => <option key={option.id} value={option.id}>{option.name} · {option.mode === 'LIVE' ? 'LIVE' : tr("Archiwum")}</option>)}
        </select>}
      </> : <Button icon={<UsersRound size={15} />} onClick={() => navigate('/konta')}>{tr("Dodaj konto")}</Button>}</div>
    </Panel>
    <Panel title={tr("Status integracji")} icon={<ShieldCheck size={17} />}>
      <div className="status-list">
        <div><Radar size={18} /><span><strong>X API</strong><small><i className={account?.connected ? 'dot green' : 'dot'} />{account?.connected ? tr("Połączono") : tr("Rozłączone")}</small></span></div>
        <div><Sparkles size={18} /><span><strong>ChatGPT Plan Usage</strong><small><i className={integrations?.chat.planUsage ? 'dot green' : 'dot'} />{integrations?.chat.planUsage ? tr("Autoryzowano plan") : tr("Tryb regułowy")}</small></span></div>
        <Button tone="quiet" onClick={() => navigate('/integracje')}>{tr("Zobacz integracje") + " "}<ArrowRight size={14} /></Button>
      </div>
    </Panel>
    <Panel title={tr("Ostatnie skanowanie")} icon={<Search size={17} />}>
      <div className="rail-content">{scan ? <>
        <div className="rail-line"><strong>{tr(pl.job[scan.state])}</strong><Badge color={scan.state === 'COMPLETED' ? 'green' : isActive(scan) ? 'blue' : 'neutral'}>{scan.processed}/{scan.seen}</Badge></div>
        <Progress scan={scan} /><small>{when(scan.finishedAt ?? scan.startedAt ?? scan.createdAt, account?.settings.timeZone)}</small>
        {account?.settings.notifications && scan.message && <p className="muted">{tr(scan.message)}</p>}
      </> : <span className="muted">{tr("Brak historii.")}</span>}</div>
    </Panel>
    <Panel title={tr("Harmonogram")} icon={<CalendarClock size={17} />}>
      <div className="rail-content"><small>{account?.nextScanAt ? when(account.nextScanAt, account.settings.timeZone) : tr("Automatyczne skany są wyłączone.")}</small>
        {account && <Button tone="quiet" onClick={() => navigate('/ustawienia')}>{tr("Ustawienia") + " "}<ArrowRight size={14} /></Button>}
      </div>
    </Panel>
    {account?.settings.notifications && data?.audit.length ? <Panel title={tr("Ostatnia aktywność")} icon={<Clock3 size={17} />}>
      <div className="event-list">{data.audit.slice(0, 3).map(event => <div key={event.id}><span>{tr(event.message)}</span><small>{when(event.createdAt, account.settings.timeZone)}</small></div>)}</div>
    </Panel> : null}
  </aside>;
}
