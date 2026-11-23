import type { PrismaClient, XAccount } from '@prisma/client';
import { z } from 'zod';
import type { AssistantReply, ProfileEntry } from '../shared/contracts.js';
import type { AiProviders } from './external-ai.js';
import { audit, json, settingsOf } from './db.js';
import { dashboard, detailProfile, listProfiles } from './profiles.js';
import { AppError } from './config.js';

const assistantOutput = z.object({
  answer: z.string().min(1).max(2200),
  profileIds: z.array(z.string()).max(20),
}).strict();

export async function askAssistant(db: PrismaClient, ai: AiProviders, account: XAccount, values: { question: string; useModel: boolean; profileId?: string; language: 'en' | 'pl' }) {
  const text = values.question.toLocaleLowerCase('pl');
  const localized = (pl: string, en: string) => values.language === 'pl' ? pl : en;
  const requested = Number(/\b([1-9][0-9]?)\b/.exec(text)?.[1] ?? 5);
  const size = Math.min(20, requested);
  const spam = /spam|podejrz|oszust|suspicious|scam/.test(text);
  const inactive = /aktywn|ostatni.*post|least active|inactive|activity/.test(text);
  const compare = /porówn|roznic|różnic|dwa skan|compare|last.*scans/.test(text);
  const [overview, matches, exact] = await Promise.all([
    dashboard(db, account),
    listProfiles(db, account, { q: '', view: spam ? 'candidate' : 'all', sort: spam ? 'spam' : inactive ? 'oldest' : 'confidence', page: 1, pageSize: size }),
    values.profileId ? detailProfile(db, account, values.profileId) : Promise.resolve(null),
  ]);
  let rows: ProfileEntry[] = exact ? [exact] : matches.items;
  if (!exact && inactive && !spam) rows = rows.filter(item => item.lastActivity && item.activity !== 'unknown');
  if (spam && !exact) rows = rows.filter(item => (item.assessment?.spam_score ?? 0) >= settingsOf(account).spamThreshold);
  const { metrics, comparison } = overview;
  let answer: string;
  if (exact) answer = exact.assessment?.reasons[0] || localized('Ten profil oczekuje na analizę. Bieżące źródło nie zawiera wystarczających danych do oceny.', 'This profile is awaiting analysis. The current source does not have enough evidence to assess it.');
  else if (compare) {
    const [a, b] = comparison.slice(-2);
    answer = b
      ? localized(`Dwa ostatnie skany obejmowały odpowiednio ${a.metrics.following} i ${b.metrics.following} kont. Potwierdzona nieaktywność: ${a.metrics.inactive} → ${b.metrics.inactive}. Kandydaci: ${a.metrics.candidates} → ${b.metrics.candidates}.`,
        `The last two scans covered ${a.metrics.following} and ${b.metrics.following} accounts. Confirmed inactivity changed from ${a.metrics.inactive} to ${b.metrics.inactive}. Unfollow candidates changed from ${a.metrics.candidates} to ${b.metrics.candidates}.`)
      : localized('Do porównania potrzebne są dwa ukończone skany.', 'Complete two scans to compare their results.');
    rows = [];
  } else if (spam || inactive) answer = rows.length
    ? localized(`Znaleziono ${rows.length} profili w zestawieniu. Otwórz dowód i sprawdź kontekst przed zmianą listy obserwowanych.`,
      `Found ${rows.length} matching profiles. Review the evidence and context before changing your following list.`)
    : localized('Brakuje profili spełniających warunki na podstawie dostępnych dowodów.', 'The available evidence did not identify any matching profiles.');
  else {
    answer = localized(`Na liście jest ${metrics.following} kont. Analiza objęła ${metrics.analyzed}. Do ręcznej weryfikacji: ${metrics.review}. Aktualni kandydaci: ${metrics.candidates}. Najpierw przejrzyj dowody, zapisz ochronę istotnych kont i oceń każdą zmianę osobno.`,
      `You follow ${metrics.following} accounts. ${metrics.analyzed} have been analyzed, ${metrics.review} need review and ${metrics.candidates} are current candidates. Check the evidence, protect important accounts and review each change individually.`);
    rows = overview.candidates;
  }
  let provider: AssistantReply['provider'] = 'manual';
  let model: string | null = null;
  if (values.useModel) {
    const opts = settingsOf(account);
    if (opts.aiProvider === 'manual') throw new AppError(409, 'ai_off', 'Wybierz dostawcę i model w ustawieniach tego konta.');
    const response = await ai.structured(account.userId, account.id, 'assistant', assistantOutput, {
      question: values.question, language: values.language, metrics, comparison: comparison.slice(-2),
      profiles: rows.map(row => ({ id: row.id, decision: row.decision, activity: row.activity,
        dataCompleteness: row.assessment?.data_completeness, spamScore: row.assessment?.spam_score,
        evidence: row.assessment?.evidence.filter(item => item.kind === 'activity' || item.kind === 'spam').map(item => item.kind) })),
    });
    answer = response.answer;
    rows = rows.filter(row => response.profileIds.includes(row.id));
    provider = opts.aiProvider;
    model = opts.aiModel;
  } else {
    await audit(db, account.userId, account.id, 'assistant.read', 'Użyto lokalnego asystenta danych.', json({ provider, model }));
  }
  return { answer, provider, model, profiles: rows.map(row => ({
    id: row.id, username: row.username, reason: row.assessment?.reasons[0] ?? 'Oczekuje na analizę.',
  })) } satisfies AssistantReply;
}
