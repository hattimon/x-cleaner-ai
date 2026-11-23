import type { DataStatus, Decision, JobState, OperationState } from '../shared/contracts.js';
import { getLanguage, phrase } from './i18n.js';

export const pl = {
  decision: {
    KEEP: 'Zachowaj', REVIEW: 'Do weryfikacji', UNFOLLOW_CANDIDATE: 'Kandydat', PROTECTED: 'Chronione', UNKNOWN: 'Brak danych',
  } satisfies Record<Decision, string>,
  data: {
    scanned: 'Przeanalizowano', partial: 'Niepełne dane', unavailable: 'Brak danych', rate_limited: 'Limit X API', stale: 'Dane wygasły', failed: 'Błąd odczytu',
  } satisfies Record<DataStatus, string>,
  job: {
    QUEUED: 'W kolejce', RUNNING: 'W trakcie', WAITING: 'Oczekuje', PAUSED: 'Wstrzymane', CANCELLED: 'Anulowano',
    COMPLETED: 'Ukończono', FAILED: 'Błąd',
  } satisfies Record<JobState, string>,
  operation: {
    PREPARED: 'Do potwierdzenia', IN_PROGRESS: 'W toku', SUCCEEDED: 'X potwierdził', FAILED: 'Błąd',
    UNCERTAIN: 'Wynik niepewny', SKIPPED: 'Pominięto',
  } satisfies Record<OperationState, string>,
  activity: { recent: 'Aktywne', occasional: 'Sporadyczne', inactive: 'Nieaktywne', unknown: 'Brak dowodu' },
};
const formats = { pl: new Intl.NumberFormat('pl-PL'), en: new Intl.NumberFormat('en-US') };
export const number = { format: (value: number) => formats[getLanguage()].format(value) };
export function when(value: string | null | undefined, zone = 'Europe/Warsaw') {
  if (!value) return '—';
  return new Intl.DateTimeFormat(getLanguage() === 'pl' ? 'pl-PL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value));
}
export function recency(value: string | null) {
  if (!value) return phrase('Brak danych', 'No data');
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000));
  if (!days) return phrase('Dzisiaj', 'Today');
  if (days === 1) return phrase('Wczoraj', 'Yesterday');
  return phrase(days + ' dni temu', days + ' days ago');
}
