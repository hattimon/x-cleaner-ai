import { useSyncExternalStore } from 'react';
import { english } from './strings.en.js';

export type Language = 'en' | 'pl';
const key = 'xc-language';
let current: Language = localStorage.getItem(key) === 'pl' ? 'pl' : 'en';
const listeners = new Set<() => void>();
document.documentElement.lang = current;
const subscribe = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getLanguage = () => current;
export const useLanguage = () => useSyncExternalStore(subscribe, getLanguage);
export function setLanguage(language: Language) {
  if (current === language) return;
  current = language;
  document.documentElement.lang = language;
  localStorage.setItem(key, language);
  listeners.forEach(callback => callback());
}

export function tr(text: string): string {
  if (current === 'pl') return text;
  if (Object.hasOwn(english, text)) return english[text];
  if (Object.hasOwn(english, text.trim())) return english[text.trim()];
  return text
    .replace(/^Zaimportowano (\d+) obserwowanych z archiwum X\.$/, 'Imported $1 followed accounts from the X archive.')
    .replace(/^Zakończono analizę (\d+) profili\.$/, 'Completed analysis of $1 profiles.')
    .replace(/^Ostatnia potwierdzona aktywność: (\d+) dni temu\.$/, 'Last confirmed activity was $1 days ago.')
    .replace(/^Liczba powtórzonych tekstów w próbce: (\d+)\.$/, 'Repeated texts in the sample: $1.')
    .replace(/^Zapisano decyzję właściciela dla (.+)\.$/, 'Saved your decision for $1.')
    .replace(/^Połączono konto X @(.+)\.$/, 'Connected X account @$1.');
}
export const phrase = (pl: string, en: string) => current === 'pl' ? pl : en;
