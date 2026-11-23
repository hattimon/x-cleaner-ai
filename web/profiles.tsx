import { phrase, tr } from './i18n.js';
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Bookmark, Check, ChevronLeft, ChevronRight, ExternalLink, Filter, ListChecks, Search, Shield, Sparkles, Trash2 } from 'lucide-react';
import type { Account, Cleanup, ProfileEntry, ProfileQuery } from '../shared/contracts.js';
import { dataStatuses, decisions } from '../shared/contracts.js';
import { api } from './api.js';
import { Badge, Button, DecisionBadge, Dialog, Empty, ErrorBanner, Load, Panel, ProfileIdentity } from './ui.js';
import { Header } from './dashboard.js';
import { number, pl, recency, when } from './locale.js';
import type { Run } from './account-views.js';
import { useDragSelection } from './drag-selection.js';

const labels: Record<ProfileQuery['view'], [string, string]> = {
  all: ['Obserwowane profile', 'Przeszukuj listę i sprawdzaj dowody dla poszczególnych profili.'],
  candidate: ['Do usunięcia', 'Przejrzyj dowody i przygotuj podgląd zmian.'],
  kept: ['Do zachowania', 'Wartościowe i chronione konta na Twojej liście.'],
  review: ['Weryfikacja AI', 'Profile wymagające sprawdzenia i analizy z brakującymi danymi.'],
  unfollowed: ['Dawniej obserwowane', 'Profile, które zniknęły z listy lub zostały usunięte.'],
};

export function ProfilesView({ account, view, showProfile, prepare, run }: {
  account: Account; view: ProfileQuery['view']; showProfile: (id: string) => void; prepare: (ids: string[], direction?: Cleanup['direction']) => Promise<void>; run: Run;
}) {
  const [q, search] = useState('');
  const deferred = useDeferredValue(q);
  const [decision, setDecision] = useState<ProfileQuery['decision']>();
  const [status, setStatus] = useState<ProfileQuery['status']>();
  const [sort, setSort] = useState<ProfileQuery['sort']>('confidence');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const filters = { q: deferred.trim(), view, decision, status, sort, page, pageSize };
  const rows = useQuery({ queryKey: ['profiles', account.id, filters], queryFn: () => api.profiles(account.id, filters) });
  const visible = rows.data?.items ?? [];
  const drag = useDragSelection(visible.map(row => row.id), selected, setSelected, () => { revision.current++; });
  const total = rows.data?.total ?? 0;
  const selectedOnPage = visible.filter(row => selected.has(row.id)).length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allPage = visible.length > 0 && selectedOnPage === visible.length;
  useEffect(() => { if (headerCheckbox.current) headerCheckbox.current.indeterminate = selectedOnPage > 0 && !allPage; }, [selectedOnPage, allPage]);
  useEffect(() => { if (rows.data && page > pages) setPage(pages); }, [rows.data, page, pages]);
  const restart = () => { revision.current++; setPage(1); setSelected(new Set()); };
  const pageSelect = () => setSelected(previous => {
    const set = new Set(previous);
    for (const row of visible) allPage ? set.delete(row.id) : set.add(row.id);
    return set;
  });
  const selectAll = async () => {
    const started = revision.current;
    setBusy(true);
    const result = await run(() => api.selection(account.id, filters));
    if (result && revision.current === started) setSelected(new Set(result.ids));
    setBusy(false);
  };
  const bulkReview = async () => {
    setBusy(true);
    const result = await run(async () => api.bulkPreference(account.id, [...selected], 'REVIEW'));
    if (result) { setSelected(new Set()); await rows.refetch(); }
    setBusy(false);
  };
  return <>
    <Header title={tr(labels[view][0])} text={tr(labels[view][1])} />
    <Panel title={tr("Profile")} right={<small className="muted">{number.format(total)} {tr("wyników")}</small>} className="profiles-panel">
      <div className="filter-row">
        <label className="search-field"><Search size={17} /><input value={q} aria-label={tr("Szukaj profilu")} placeholder={tr("Szukaj nazwy, @loginu lub ID")} onChange={event => { search(event.target.value); restart(); }} /></label>
        <label className="filter-field"><Filter size={16} /><select aria-label={tr("Filtr rekomendacji")} value={decision ?? ''} onChange={event => { setDecision((event.target.value || undefined) as ProfileQuery['decision']); restart(); }}>
          <option value="">{tr("Każda rekomendacja")}</option>{decisions.map(value => <option key={value} value={value}>{tr(pl.decision[value])}</option>)}
        </select></label>
        <select aria-label={tr("Filtr stanu danych")} value={status ?? ''} onChange={event => { setStatus((event.target.value || undefined) as ProfileQuery['status']); restart(); }}>
          <option value="">{tr("Każdy stan danych")}</option>{dataStatuses.map(value => <option key={value} value={value}>{tr(pl.data[value])}</option>)}
        </select>
        <select aria-label={tr("Sortowanie")} value={sort} onChange={event => { setSort(event.target.value as ProfileQuery['sort']); setPage(1); }}>
          <option value="confidence">{tr("Pewność")}</option><option value="spam">{tr("Sygnały spamu")}</option><option value="oldest">{tr("Najstarsza aktywność")}</option>
          <option value="latest">{tr("Najnowsza aktywność")}</option><option value="name">{tr("Nazwa")}</option>
        </select>
      </div>
      <div className="selection-bar">
        <span className="selection-count"><ListChecks size={17} /><strong aria-live="polite">{tr("Zaznaczono") + " "}{number.format(selected.size)}</strong></span>
        <Button disabled={!visible.length || busy} onClick={pageSelect}>{allPage ? tr("Odznacz stronę") : tr("Zaznacz stronę")}</Button>
        <Button disabled={!total || busy || q !== deferred} onClick={() => void selectAll()}>{tr("Zaznacz wszystkie wyniki")}</Button>
        <Button tone="quiet" disabled={!selected.size} onClick={() => { revision.current++; setSelected(new Set()); }}>{tr("Wyczyść zaznaczenie")}</Button>
      </div>
      {visible.length > 1 && <small className="selection-hint">{tr('Przeciągnij od pola wyboru, aby zaznaczyć lub odznaczyć zakres.')}</small>}
      {visible.length > 0 && view !== 'unfollowed' && <div className="selection-actions">
        {view === 'candidate' && account.mode === 'LIVE' && <Button tone="primary" icon={<Trash2 size={16} />} disabled={busy || !selected.size} onClick={async () => {
          setBusy(true); await prepare([...selected]); setBusy(false);
        }}>{tr("Podgląd unfollow")}</Button>}
        <Button icon={<Bookmark size={16} />} disabled={busy || !selected.size} onClick={() => void bulkReview()}>{tr("Przenieś do weryfikacji")}</Button>
      </div>}
      {rows.isPending ? <Load /> : rows.error ? <ErrorBanner error={rows.error} retry={() => void rows.refetch()} /> : visible.length ? <>
        <div className="table-scroll"><table className="profiles-table">
          <thead><tr>
            <th><input ref={headerCheckbox} type="checkbox" aria-label={tr("Zaznacz profile na stronie")} checked={allPage} onChange={pageSelect} /></th>
            <th scope="col">{tr("Konto")}</th><th scope="col">{tr("Ostatnia aktywność")}</th><th scope="col">{tr("Pewność")}</th><th scope="col">{tr("Rekomendacja")}</th><th scope="col"><span className="sr-only">{tr("Działania")}</span></th>
          </tr></thead>
          <tbody>{visible.map(item => <ProfileRow key={item.id} item={item} show={() => showProfile(item.id)} checked={selected.has(item.id)} drag={drag} toggle={() => {
            revision.current++;
            setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; });
          }} />)}</tbody>
        </table></div>
        <div className="pagination"><small>{phrase(`Strona ${page} z ${pages}`, `Page ${page} of ${pages}`)} · {number.format(total)} {tr("wyników")}</small><div className="row-actions">
          <select aria-label={phrase('Profili na stronie', 'Profiles per page')} className="page-size" value={pageSize} onChange={event => {setPageSize(Number(event.target.value)); setPage(1);}}>
            {[10, 25, 50, 100].map(value => <option value={value} key={value}>{value}</option>)}
          </select>
          <Button className="icon-only" aria-label={tr("Poprzednia strona")} icon={<ChevronLeft size={18} />} disabled={page <= 1} onClick={() => setPage(page - 1)} />
          <Button className="icon-only" aria-label={tr("Następna strona")} icon={<ChevronRight size={18} />} disabled={page >= pages} onClick={() => setPage(page + 1)} />
        </div></div>
      </> : <Empty title={tr("Brak profili w tym widoku")} text={q || status || decision ? tr("Zmień filtry lub wpisz inną nazwę.") : tr("Wyniki pojawią się, gdy będzie dostępny pasujący profil.")} />}
    </Panel>
    {view === 'all' && <div className="row-actions exports"><a className="button button--secondary" href={api.report(account.id, 'csv')}><ArrowDownToLine size={17} /> CSV</a><a className="button button--secondary" href={api.report(account.id, 'json')}><ArrowDownToLine size={17} /> JSON</a></div>}
  </>;
}

function ProfileRow({ item, checked, toggle, show, drag }: {
  item: ProfileEntry; checked: boolean; toggle: () => void; show: () => void; drag: ReturnType<typeof useDragSelection>;
}) {
  return <tr className={checked ? 'selected' : ''} data-selection-row={item.id}>
    <td><label className="selection-target" onPointerDown={event => drag.begin(event, item.id)} onPointerMove={drag.move}
      onPointerUp={drag.end} onPointerCancel={drag.stop} onLostPointerCapture={drag.stop} onClickCapture={event => {
        if (drag.suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
      }}><input type="checkbox" aria-label={phrase('Zaznacz ', 'Select ') + item.name} checked={checked} onChange={toggle} /></label></td>
    <td><button className="profile-button" onClick={show} aria-label={tr("Szczegóły ") + item.name}><ProfileIdentity item={item} /></button>
      {item.decision === 'UNFOLLOW_CANDIDATE' && item.assessment && <small className="table-reason">{tr(item.assessment.reasons[0])}</small>}</td>
    <td data-label={tr("Aktywność")}><span title={when(item.lastActivity)}>{recency(item.lastActivity)}</span>{item.status !== 'scanned' && <small className="table-reason">{tr(pl.data[item.status])}</small>}</td>
    <td data-label={tr("Pewność")}>{item.assessment || item.preference ? item.confidence + '%' : '—'}</td>
    <td data-label={tr("Decyzja")}><DecisionBadge value={item.decision} /></td>
    <td>{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="external" aria-label={tr("Otwórz profil ") + item.name + ' na X'}><ExternalLink size={17} /></a>}</td>
  </tr>;
}

const scores = [
  ['inactivity_score', 'Nieaktywność'], ['spam_score', 'Sygnały spamu'], ['quality_score', 'Jakość treści'],
  ['relationship_score', 'Ręczna ochrona relacji'], ['data_completeness', 'Kompletność danych'],
] as const;

export function ProfileDialog({ account, id, onClose, run, openCleanup, openAssistant }: {
  account: Account; id: string; onClose: () => void; run: Run; openCleanup: (ids: string[], direction?: Cleanup['direction']) => Promise<void>; openAssistant: (id: string) => void;
}) {
  const data = useQuery({ queryKey: ['profile', account.id, id], queryFn: () => api.profile(account.id, id) });
  const item = data.data;
  const [busy, setBusy] = useState(false);
  const prefer = async (value: Parameters<typeof api.preference>[2]) => {
    setBusy(true);
    await run(() => api.preference(account.id, id, value), tr("Zapisano decyzję właściciela."));
    setBusy(false);
  };
  return <Dialog drawer title={tr("Szczegóły profilu")} onClose={onClose}>
    {data.isPending ? <Load /> : data.error ? <ErrorBanner error={data.error} retry={() => void data.refetch()} /> : item && <div className="stack">
      <div className="profile-banner"><ProfileIdentity item={item}/><DecisionBadge value={item.decision} /></div>
      <div className="row-actions">{item.url && <a className="button button--secondary" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />{tr("Otwórz w X")}</a>}
        {item.private && <Badge color="purple">{tr("Prywatne")}</Badge>}</div>
      {item.bio && <p className="profile-bio">{item.bio}</p>}
      {item.website && <a href={item.website} target="_blank" rel="noreferrer" className="text-link">{tr("Strona profilu") + " "}<ExternalLink size={14} /></a>}
      <dl className="detail-metrics">
        <div><dt>{tr("Obserwujący")}</dt><dd>{item.followers === null ? '—' : number.format(item.followers)}</dd></div>
        <div><dt>{tr("Obserwuje")}</dt><dd>{item.follows === null ? '—' : number.format(item.follows)}</dd></div>
        <div><dt>{tr("Utworzenie konta")}</dt><dd>{when(item.openedAt)}</dd></div>
        <div><dt>{tr("Ostatni dostępny post")}</dt><dd>{when(item.lastPostAt)}</dd></div>
        <div><dt>{tr("Ostatnia dostępna odpowiedź")}</dt><dd>{when(item.lastReplyAt)}</dd></div>
        <div><dt>{tr("Stan danych")}</dt><dd>{tr(pl.data[item.status])}</dd></div>
      </dl>
      {item.statusReason && !item.assessment?.evidence.some(entry => entry.summary === item.statusReason) && <p className="muted">{tr(item.statusReason)}</p>}
      {item.assessment && <Panel title={tr("Ocena i dowody")} right={<Badge color="blue">{item.confidence}% pewności</Badge>}>
        <div className="section-content stack">
          <ul className="evidence">{item.assessment.reasons.map((reason, i) => <li key={i}>{tr(reason)}</li>)}</ul>
          <dl className="scores">{scores.map(([name, label]) => <div key={name}><dt>{tr(label)}</dt><dd><progress aria-label={tr(label)} max={100} value={item.assessment?.[name] ?? 0} />{item.assessment?.[name]}/100</dd></div>)}</dl>
          <ul className="evidence">{item.assessment.evidence.map((evidence, i) => <li key={i}>{tr(evidence.summary)} {evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">{tr("Źródło") + " "}<ExternalLink size={13} /></a>}</li>)}</ul>
          <small className="muted">{item.assessment.model ?? tr("Reguły lokalne")} · {item.assessment.model_or_rules_version} · {when(item.assessment.evaluated_at)}</small>
        </div>
      </Panel>}
      <Panel title={tr("Decyzja właściciela")}>
        <div className="section-content row-actions">
          <Button icon={<Check size={16} />} disabled={busy} onClick={() => void prefer('KEEP')}>{tr("Zachowaj")}</Button>
          <Button icon={<Search size={16} />} disabled={busy} onClick={() => void prefer('REVIEW')}>{tr("Do weryfikacji")}</Button>
          <Button icon={<Shield size={16} />} disabled={busy} onClick={() => void prefer('PROTECT')}>{tr("Chroń")}</Button>
          <Button disabled={busy} onClick={() => void prefer('EXCLUDE')}>Wyklucz</Button>
          {item.preference && <Button tone="quiet" disabled={busy} onClick={() => void prefer(null)}>{tr("Usuń ręczną decyzję")}</Button>}
          {account.mode === 'LIVE' && (item.decision === 'UNFOLLOW_CANDIDATE' || !item.following) &&
            <Button tone="danger" disabled={busy} onClick={() => void openCleanup([id], item.following ? 'UNFOLLOW' : 'FOLLOW')}>{item.following ? tr("Podgląd unfollow") : tr("Sprawdź możliwość ponownego follow")}</Button>}
          <Button icon={<Sparkles size={16} />} onClick={() => openAssistant(id)}>{tr("Zapytaj asystenta")}</Button>
        </div>
      </Panel>
      {item.posts.length > 0 && <Panel title={tr("Dostępne posty i odpowiedzi")}><div className="event-list">
        {item.posts.map(post => <div key={post.id}><small>{post.kind === 'reply' ? tr("Odpowiedź") : 'Post'} · {when(post.at)}</small><span>{post.text}</span>
          {/^[0-9]+$/.test(post.id) && <a className="text-link" href={'https://x.com/i/web/status/' + post.id} target="_blank" rel="noreferrer">{tr("Zobacz na X") + " "}<ExternalLink size={13} /></a>}</div>)}
      </div></Panel>}
      {item.history.length > 0 && <Panel title={tr("Historia analiz")}><div className="event-list">
        {item.history.map((event, index) => <div key={index}><DecisionBadge value={event.decision} /><small>{when(event.evaluated_at)} · {event.provider} {event.model ?? ''}</small></div>)}
      </div></Panel>}
    </div>}
  </Dialog>;
}

export function CleanupDialog({ account, initial, writeReady, onClose, run }: { account: Account; initial: Cleanup; writeReady: boolean; onClose: () => void; run: Run }) {
  const [current, setCurrent] = useState(initial);
  const [page, setPage] = useState(1);
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<Cleanup['items'][number]>();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<unknown>();
  const action = current.direction === 'UNFOLLOW' ? tr("Przestań obserwować") : tr("Obserwuj ponownie");
  const switchPage = async (target: number) => {
    setWorking(true);
    const result = await run(() => api.cleanup(account.id, current.id, target));
    if (result) { setCurrent(result); setPage(target); }
    setWorking(false);
  };
  const apply = async () => {
    if (!confirm || !checked || working) return;
    setWorking(true); setError(undefined);
    const result = await run(() => api.confirm(account.id, current, confirm).catch(failure => { setError(failure); throw failure; }));
    if (result) {
      setConfirm(undefined); setChecked(false);
      setCurrent(page === 1 ? result : await api.cleanup(account.id, current.id, page).catch(() => result));
    }
    setWorking(false);
  };
  return <Dialog title={confirm ? tr("Potwierdź zmianę w X") : tr("Podgląd operacji LIVE")} onClose={onClose}>
    {confirm ? <div className="stack">
      <h3>{action} @{confirm.username}?</h3>
      <p>{tr("X może naliczyć opłatę za zapis.") + " "}{current.direction === 'FOLLOW' ? tr("Konto prywatne może wymagać ponownej akceptacji.") : tr("Ponowne follow wymaga osobnej operacji.")}</p>
      <label className="check"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{tr("Potwierdzam zmianę dla tego profilu.")}</label>
      {Boolean(error) && <ErrorBanner error={error} />}
      <div className="dialog-actions"><Button icon={<ArrowLeft size={16} />} onClick={() => { setConfirm(undefined); setChecked(false); }}>{tr("Wróć")}</Button>
        <Button tone="danger" onClick={() => void apply()} disabled={!checked || working}>{working ? tr("Oczekiwanie na X…") : action}</Button></div>
    </div> : <div className="stack">
      <p><strong>{number.format(current.total)} profili</strong>{tr("w podglądzie. Potwierdzaj każdy profil osobno.")}</p>
      {!writeReady && <p className="muted">{tr("Zapis wymaga połączonego konta, zakresu follows.write i włączenia zapisu X w konfiguracji serwera.")}</p>}
      <div className="preview-list">{current.items.map(item => <div key={item.id}>
        <span><strong>{item.name}</strong><small>@{item.username}</small>{item.result?.message && <small>{tr(item.result.message)}</small>}</span>
        <Badge color={item.state === 'SUCCEEDED' ? 'green' : item.state === 'FAILED' || item.state === 'UNCERTAIN' ? 'red' : 'neutral'}>{tr(pl.operation[item.state])}</Badge>
        {item.state === 'PREPARED' && <Button disabled={!writeReady || working} onClick={() => setConfirm(item)}>{tr("Sprawdź") + " "}<ArrowRight size={14} /></Button>}
      </div>)}</div>
      {current.total > 100 && <div className="pagination"><small>{tr("Strona") + " "}{page} z {Math.ceil(current.total / 100)}</small><div className="row-actions">
        <Button aria-label={tr("Poprzednia strona podglądu")} icon={<ChevronLeft size={16} />} disabled={page === 1 || working} onClick={() => void switchPage(page - 1)} />
        <Button aria-label={tr("Następna strona podglądu")} icon={<ChevronRight size={16} />} disabled={page * 100 >= current.total || working} onClick={() => void switchPage(page + 1)} />
      </div></div>}
      <div className="dialog-actions"><Button onClick={onClose}>{tr("Zamknij podgląd")}</Button></div>
    </div>}
  </Dialog>;
}
