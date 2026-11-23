import { z } from 'zod';
import type { Activity, ApiProvider, DataStatus, Evaluation, PostSample, Preference, Settings } from '../shared/contracts.js';

export const classifierVersion = 'rules-1.0';
const dayMs = 86400000;
const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
const bait = /\b(reply yes|comment yes|drop your wallet|airdrop|giveaway|follow for follow|dm for|repost to win|like and repost|podaj portfel|zostaw portfel|polub i udostępnij)\b/i;
const financialBait = /\b(guaranteed (profit|returns?)|100x|1000x|no risk|guaranteed gains|pewny zysk|gwarantowan[ey] (zysk|zwrot)|bez ryzyka)\b/i;
const pressure = /\b(presale|przedsprzedaż|pump|buy now|last chance|kup teraz|ostatnia szansa)\b/i;
const suspiciousUrl = /https?:\/\/(?:bit\.ly|t\.co|tinyurl\.com|cutt\.ly)\//i;
const evidenceLanguage = /\b(dane|metodologia|analiza|źródło|wnioski|hipoteza|porównanie|dataset|methodolog\w*|evidence|analysis|source|benchmark|documentacja|dokumentacja|eksperyment)\b/i;
const argumentLanguage = /\b(ponieważ|wskazuje|dlatego|jednak|przykład|sugeruję|proponuję|warto|alternatyw\w*|because|however|recommend|suggest|evidence|whereas)\b/i;
const normal = (text: string) => text.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const modelScore = z.number().int().min(0).max(100);

export const aiAssessmentSchema = z.object({
  spam: modelScore,
  quality: modelScore,
  confidence: modelScore,
  constructive: z.boolean(),
  postIds: z.array(z.string()).max(5),
  rationale: z.string().max(550),
}).strict();
export type AiAssessment = z.infer<typeof aiAssessmentSchema>;
export type ClassificationInput = {
  username: string;
  preference: Preference | null;
  posts: PostSample[];
  lastActivity: Date | null;
  status: DataStatus;
  statusReason?: string | null;
  private: boolean;
  live: boolean;
};

export const isProtected = (username: string, preference: Preference | null, settings: Settings) =>
  preference === 'PROTECT' || preference === 'EXCLUDE' || settings.whitelist.includes(username.toLowerCase()) || settings.exclusions.includes(username.toLowerCase());

const modeDelta = { Conservative: 10, Balanced: 0, Aggressive: -10 };
export const decisionConfidence = (settings: Settings) => Math.min(100, Math.max(60, settings.candidateConfidence + modeDelta[settings.aggression]));
export const classifyWithoutPreferences = (input: ClassificationInput, settings: Settings, now = new Date()) =>
  classify({ ...input, preference: null }, { ...settings, whitelist: [], exclusions: [] }, now);

export function classify(input: ClassificationInput, settings: Settings, now = new Date()): Evaluation {
  const { posts, lastActivity } = input;
  const days = lastActivity ? Math.max(0, Math.floor((now.getTime() - lastActivity.getTime()) / dayMs)) : null;
  const reliable = input.status === 'scanned' && !input.private && days !== null && posts.length > 0;
  const activity: Activity = !reliable ? 'unknown' : days! >= settings.inactivityDays ? 'inactive' : days! >= Math.ceil(settings.inactivityDays / 3) ? 'occasional' : 'recent';
  const normalized = posts.map(post => normal(post.text)).filter(text => text.length > 15);
  const repeats = normalized.length - new Set(normalized).size;
  const baitPosts = posts.filter(post => bait.test(post.text));
  const suspectPosts = posts.filter(post => financialBait.test(post.text));
  const promoPosts = posts.filter(post => pressure.test(post.text));
  const constructive = posts.filter(post => argumentLanguage.test(post.text) && (evidenceLanguage.test(post.text) || post.text.length >= 125));
  const analytical = posts.filter(post => evidenceLanguage.test(post.text) && post.text.length >= 75);
  const linkBait = posts.filter(post => (bait.test(post.text) || pressure.test(post.text)) && suspiciousUrl.test(post.text));
  const spam = clamp(repeats * 23 + baitPosts.length * 17 + suspectPosts.length * 39 + promoPosts.length * 10 + linkBait.length * 4);
  const quality = posts.length ? clamp(35 + (constructive.length > 0 ? 26 : 0) + analytical.length * 10 - spam * .32) : 0;
  const completeness = reliable ? Math.min(100, 73 + posts.length * 5) : posts.length ? 40 : 15;
  const relationship = isProtected(input.username, input.preference, settings) ? 100 : input.preference === 'KEEP' ? 90 : 0;
  const evidence: Evaluation['evidence'] = [];
  const postEvidence = (post: PostSample, kind: 'activity' | 'spam' | 'quality', summary: string) => ({
    kind, summary, postId: post.id,
    ...(input.live && /^\d+$/.test(post.id) ? { url: 'https://x.com/i/web/status/' + post.id } : {}),
  });
  if (reliable && days !== null) {
    const last = posts.reduce((latest, post) => post.at > latest.at ? post : latest);
    evidence.push(postEvidence(last, 'activity', `Ostatnia potwierdzona aktywność: ${days} dni temu.`));
  } else {
    evidence.push({ kind: 'availability', summary: input.statusReason ?? (input.private ? 'Konto prywatne. Próbka publiczna jest niedostępna.' : 'Brak pełnej próbki aktywności.') });
  }
  if (repeats > 0) evidence.push({ kind: 'spam', summary: `Liczba powtórzonych tekstów w próbce: ${repeats}.` });
  if (suspectPosts[0]) evidence.push(postEvidence(suspectPosts[0], 'spam', 'Próbka zawiera obietnicę łatwego lub gwarantowanego zysku.'));
  if (baitPosts[0]) evidence.push(postEvidence(baitPosts[0], 'spam', 'Prośba o sztuczną interakcję lub ujawnienie adresu portfela.'));
  if (constructive[0]) evidence.push(postEvidence(constructive[0], 'quality', 'Wypowiedź zawiera argument lub propozycję rozwiązania.'));
  if (relationship >= 90) evidence.push({ kind: 'relationship', summary: 'Uwzględniono ręczną preferencję właściciela.' });

  const confThreshold = decisionConfidence(settings);
  const spamThreshold = Math.min(100, Math.max(45, settings.spamThreshold + modeDelta[settings.aggression]));
  const stronglyInactive = reliable && days! >= settings.inactivityDays * (settings.aggression === 'Conservative' ? 1.7 : 1);
  const confidence = reliable ? clamp(65 + posts.length * 4 + (spam > 75 || stronglyInactive ? 15 : 0)) : posts.length ? 45 : 25;
  let decision: Evaluation['decision'];
  let reason: string;
  if (relationship === 100) { decision = 'PROTECTED'; reason = 'Profil objęty ochroną właściciela.'; }
  else if (input.preference === 'KEEP') { decision = 'KEEP'; reason = 'Ręczna decyzja o zachowaniu profilu.'; }
  else if (input.preference === 'REVIEW') { decision = 'REVIEW'; reason = 'Profil przekazano do ręcznej weryfikacji.'; }
  else if (!reliable) { decision = posts.length ? 'REVIEW' : 'UNKNOWN'; reason = 'Dostępne dane nie pozwalają wiarygodnie ocenić aktywności.'; }
  else if (constructive.length && spam < spamThreshold) { decision = 'KEEP'; reason = 'Próbka zawiera konstruktywne argumenty lub krytykę.'; }
  else if (confidence >= confThreshold && (spam >= spamThreshold || (stronglyInactive && quality < settings.qualityThreshold))) {
    decision = 'UNFOLLOW_CANDIDATE';
    reason = spam >= spamThreshold ? 'W próbce wykryto silne sygnały spamu lub promocji wysokiego ryzyka.' : 'Potwierdzona aktywność jest starsza od ustalonego progu i próbka ma niski wynik jakości.';
  } else if (activity === 'recent' && quality >= settings.qualityThreshold && spam < spamThreshold / 2) {
    decision = 'KEEP'; reason = 'Niedawna aktywność i merytoryczne treści w dostępnej próbce.';
  } else { decision = 'REVIEW'; reason = 'Sygnały wymagają oceny właściciela.'; }
  return {
    decision, confidence: relationship >= 90 ? 100 : confidence, inactivity_score: reliable ? clamp(days! / settings.inactivityDays * 85) : 0,
    spam_score: spam, quality_score: quality, relationship_score: relationship, data_completeness: completeness,
    reasons: [reason], evidence, model_or_rules_version: classifierVersion, evaluated_at: now.toISOString(),
    activity, provider: 'manual', model: null, aiStatus: 'not_needed',
  };
}

export function reconcile(rules: Evaluation, assessment: AiAssessment, posts: PostSample[], provider: 'mock' | 'chatgpt' | ApiProvider, model: string, live: boolean, minimumConfidence = 73): Evaluation {
  const identified = assessment.postIds.filter(id => posts.some(post => post.id === id));
  const grounded = assessment.confidence >= 65 && identified.length > 0 && identified.length === assessment.postIds.length;
  if (!grounded) return { ...rules, aiStatus: 'pending', reasons: [...rules.reasons, 'Ocena AI nie zawierała wystarczających dowodów z próbki.'] };
  const decision = rules.decision === 'UNFOLLOW_CANDIDATE' && (assessment.confidence < minimumConfidence || assessment.constructive || (rules.activity !== 'inactive' && assessment.spam < 50))
    ? 'REVIEW' : rules.decision;
  return {
    ...rules, decision, provider, model, aiStatus: 'evaluated',
    model_or_rules_version: classifierVersion + '+classification-1',
    confidence: Math.min(rules.confidence, assessment.confidence),
    reasons: [...rules.reasons, 'Ocena AI: ' + assessment.rationale],
    evidence: [...rules.evidence, ...[...new Set(identified)].map(id => ({
      kind: 'quality' as const, summary: 'Post wskazany przez model podczas oceny próbki.', postId: id,
      ...(live && /^\d+$/.test(id) ? { url: 'https://x.com/i/web/status/' + id } : {}),
    }))],
  };
}
