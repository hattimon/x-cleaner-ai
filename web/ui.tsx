import { phrase, setLanguage, tr, useLanguage } from './i18n.js';
import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertCircle, BadgeCheck, CheckCircle2, CircleDashed, Radar, X } from 'lucide-react';
import type { Account, Decision, ProfileEntry } from '../shared/contracts.js';
import { pl } from './locale.js';

export function Button({ children, icon, tone = 'secondary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode; tone?: 'secondary' | 'primary' | 'quiet' | 'danger';
}) {
  return <button type={type} className={`button button--${tone} ${className}`} {...props}>{icon}{children}</button>;
}
export function Brand() {
  return <div className="brand"><span className="brand-mark"><Radar size={24} /></span><strong>X-Cleaner <span>AI</span></strong></div>;
}
export function LanguageSwitch() {
  const language = useLanguage();
  return <div className="language-switch" role="group" aria-label={phrase('Język interfejsu', 'Interface language')}>
    <button type="button" aria-label="English" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
    <button type="button" aria-label="Polski" lang="pl" aria-pressed={language === 'pl'} onClick={() => setLanguage('pl')}>PL</button>
  </div>;
}
export function Panel({ title, icon, right, children, className = '' }: { title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={'panel ' + className}>
    <header className="panel-heading"><h2>{icon}{tr(title)}</h2>{right}</header>
    {children}
  </section>;
}
export function Avatar({ item, size = 34 }: { item: Pick<ProfileEntry | Account, 'name' | 'username' | 'avatarUrl'>; size?: number }) {
  const [failed, setFailed] = useState(false);
  const values = ['#234460', '#373060', '#24483c', '#5c4221', '#513042', '#314852'];
  const color = values[[...item.username].reduce((sum, value) => sum + value.charCodeAt(0), 0) % values.length];
  const initials = item.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'X';
  return <span className="avatar" style={{ width: size, height: size, backgroundColor: color }} aria-hidden="true">
    {item.avatarUrl && !failed ? <img src={item.avatarUrl} alt="" loading="lazy" onError={() => setFailed(true)} /> : initials}
  </span>;
}
export function ProfileIdentity({ item, showHandle = true }: { item: Pick<ProfileEntry | Account, 'name' | 'username' | 'avatarUrl' | 'verified'>; showHandle?: boolean }) {
  return <span className="identity"><Avatar item={item} /><span className="identity-text"><strong>{item.name}{item.verified && <BadgeCheck size={14} className="accent" aria-label={tr("Zweryfikowane")} />}</strong>
    {showHandle && <small>{/^\d+$/.test(item.username) ? 'ID ' : '@'}{item.username}</small>}</span></span>;
}
export function Badge({ children, color = 'neutral' }: { children: ReactNode; color?: string }) {
  return <span className={'badge badge--' + color}>{children}</span>;
}
export const decisionColor: Record<Decision, string> = { KEEP: 'green', REVIEW: 'yellow', UNKNOWN: 'neutral', PROTECTED: 'purple', UNFOLLOW_CANDIDATE: 'red' };
export function DecisionBadge({ value }: { value: Decision }) { return <Badge color={decisionColor[value]}>{tr(pl.decision[value])}</Badge>; }
export function Empty({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="empty"><span className="empty-icon">{icon ?? <CircleDashed size={22} />}</span><strong>{tr(title)}</strong>{text && <p>{tr(text)}</p>}{action}</div>;
}
export function Load({ label = tr("Wczytywanie") }: { label?: string }) {
  return <div className="loading" aria-label={tr(label)} aria-busy="true"><span /><span /><span /></div>;
}
export function ErrorBanner({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="error-banner" role="alert"><AlertCircle size={18} /><span>{tr(error instanceof Error ? error.message : String(error))}</span>{retry && <Button onClick={retry}>{tr("Ponów")}</Button>}</div>;
}
export function Toast({ message, error, clear }: { message: string; error: boolean; clear: () => void }) {
  return <div className={`toast ${error ? 'toast--error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{tr(message)}</span>
    <Button tone="quiet" className="icon-only" aria-label={tr("Zamknij komunikat")} icon={<X size={16} />} onClick={clear} /></div>;
}
export function Dialog({ title, onClose, children, drawer = false }: { title: string; onClose: () => void; children: ReactNode; drawer?: boolean }) {
  const element = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = element.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={element} className={drawer ? 'dialog drawer' : 'dialog'} aria-label={tr(title)} onCancel={onClose} onClick={event => {
    if (event.target === event.currentTarget) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }
  }}>
    <header className="dialog-header"><h2>{tr(title)}</h2><Button onClick={onClose} tone="quiet" className="icon-only" icon={<X size={20} />} aria-label={tr("Zamknij")} /></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}

export type Notify = (message: string, error?: boolean) => void;
