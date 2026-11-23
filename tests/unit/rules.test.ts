import { describe, expect, it } from 'vitest';
import { settingsSchema } from '../../shared/contracts.js';
import { aiAssessmentSchema, classify, reconcile } from '../../server/classification.js';
import { nextScheduled } from '../../server/scheduler.js';
import { parseArchive } from '../../server/x-accounts.js';
import { examples, today, archiveFiles } from '../fixtures.js';

const settings = settingsSchema.parse({});
const evalProfile = (key: keyof typeof examples) => classify(examples[key], settings, today);

describe('klasyfikacja oparta na dowodach', () => {
  it('zachowuje wartościowe konto, konstruktywną krytykę i profile aktywne przez odpowiedzi', () => {
    for (const name of ['valuable', 'critique', 'replies'] as const) {
      const evaluation = evalProfile(name);
      expect(evaluation.decision).toBe('KEEP');
      expect(evaluation.activity).toBe('recent');
    }
  });
  it('wykrywa nieaktywność, powtarzalny spam i podejrzane obietnice zysków', () => {
    expect(evalProfile('dormant')).toMatchObject({ decision: 'UNFOLLOW_CANDIDATE', activity: 'inactive' });
    expect(evalProfile('spam')).toMatchObject({ decision: 'UNFOLLOW_CANDIDATE', activity: 'recent' });
    expect(evalProfile('cryptoSpam').decision).toBe('UNFOLLOW_CANDIDATE');
  });
  it('zachowuje niepewność przy niepełnych, prywatnych i nieudostępnionych danych', () => {
    expect(evalProfile('incomplete')).toMatchObject({ decision: 'REVIEW', activity: 'unknown' });
    for (const key of ['private', 'unavailable'] as const) expect(evalProfile(key)).toMatchObject({ decision: 'UNKNOWN', inactivity_score: 0, activity: 'unknown' });
  });
  it('stosuje whitelistę i ręczne wykluczenie przed analizą spamu w każdym trybie', () => {
    for (const aggression of ['Conservative', 'Balanced', 'Aggressive'] as const) {
      expect(classify(examples.spam, settingsSchema.parse({ aggression, whitelist: ['@Repeated'] }), today).decision).toBe('PROTECTED');
      expect(classify({ ...examples.spam, preference: 'EXCLUDE' }, { ...settings, aggression }, today).decision).toBe('PROTECTED');
    }
  });
  it('waliduje strukturę AI, dopuszcza wyłącznie istniejące dowody i kieruje konflikt do weryfikacji', () => {
    const rules = evalProfile('spam');
    const suggestion = { spam: 10, quality: 90, confidence: 86, constructive: true, postIds: ['100'], rationale: 'Wymaga ostrożnej oceny.' };
    expect(reconcile(rules, aiAssessmentSchema.parse(suggestion), examples.spam.posts, 'mock', 'test-model', true)).toMatchObject({ decision: 'REVIEW', aiStatus: 'evaluated' });
    expect(reconcile(rules, { ...suggestion, postIds: ['999'] }, examples.spam.posts, 'mock', 'test-model', true).aiStatus).toBe('pending');
    expect(aiAssessmentSchema.safeParse({ ...suggestion, confidence: 200 }).success).toBe(false);
  });
});

describe('archiwum i harmonogram', () => {
  const files = archiveFiles();
  it('czyta obie części listy, także jeśli podano je w innej kolejności', () => {
    expect(parseArchive(files.account, [...files.following].reverse()).ids).toHaveLength(24);
  });
  it('odrzuca brak pierwszej części i dodatkowy kod JavaScript', () => {
    expect(() => parseArchive(files.account, files.following.slice(1))).toThrow();
    expect(() => parseArchive(files.account, [files.following[0] + '; alert(1)'])).toThrow();
  });
  it('stosuje czas lokalny i przechodzi przez zmianę czasu letniego', () => {
    expect(nextScheduled('03:00', 'Europe/Warsaw', new Date('2026-03-28T23:59:00Z')).toISOString()).toBe('2026-03-29T01:00:00.000Z');
    expect(nextScheduled('03:00', 'Europe/Warsaw', new Date('2026-11-23T02:01:00Z')).toISOString()).toBe('2026-11-24T02:00:00.000Z');
    expect(nextScheduled('02:30', 'Europe/Warsaw', new Date('2026-10-25T00:32:00Z')).toISOString()).toBe('2026-10-26T01:30:00.000Z');
  });
});
