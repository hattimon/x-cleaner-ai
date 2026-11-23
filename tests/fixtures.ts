import type { PostSample } from '../shared/contracts.js';
import type { ClassificationInput } from '../server/classification.js';

export const today = new Date('2026-11-23T10:00:00Z');
const at = (days: number) => new Date(today.getTime() - days * 86400000).toISOString();
const items = (entries: string[], days: number, kind: PostSample['kind'] = 'post'): PostSample[] =>
  entries.map((text, i) => ({ id: String(100 + i), text, kind, at: at(days + i) }));
const profile = (username: string, posts: PostSample[], patch: Partial<ClassificationInput> = {}): ClassificationInput => ({
  username, posts, lastActivity: posts.length ? new Date(posts[0].at) : null, status: 'scanned',
  private: false, live: true, preference: null, ...patch,
});
const other = ['Krótka aktualizacja', 'Dopisek do wczoraj', 'Nowe zdjęcia w albumie', 'Kilka słów na koniec'];
const substantial = [
  'Analiza i metodologia są jawne. Warto odtworzyć eksperyment na drugim zbiorze, ponieważ dane z pierwszego tygodnia mają wysoką wariancję.',
  'Źródło danych i porównanie dwóch kwartałów wraz z kosztami wejściowymi. Sugeruję rozbić wyniki na wszystkie obserwowane grupy.',
];
const critique = [
  'Projekt rozczarowuje, ponieważ metodologia pomija połowę kosztów. Proponuję publikować dane źródłowe i zweryfikować wnioski na dwóch zbiorach.',
  'Wyniki projektu są słabe. Jednak z danych można oszacować wariancję, która wskazuje na potrzebę kolejnego niezależnego eksperymentu.',
];
export const examples = {
  valuable: profile('research', items(substantial, 1)),
  dormant: profile('inactive', items(other, 380)),
  spam: profile('repeated', items(Array<string>(6).fill('Giveaway. Reply YES and drop your wallet address. https://bit.ly/sample'), 4)),
  critique: profile('critical', items(critique, 3)),
  incomplete: profile('incomplete', items(other, 490), { status: 'partial' }),
  unavailable: profile('unavailable', [], { status: 'unavailable' }),
  private: profile('private_account', [], { status: 'unavailable', private: true }),
  cryptoSpam: profile('shill', items(['Presale guaranteed profit, buy now', 'No risk guaranteed returns today', '100x presale guaranteed gains', 'Last chance, buy now, no risk'], 2)),
  replies: profile('replies_only', items(critique, 1, 'reply')),
};

export function archiveFiles(size = 24) {
  return {
    account: 'window.YTD.account.part0 = ' + JSON.stringify([{ account: { accountId: '999001', username: 'kontotestowe', accountDisplayName: 'Konto testowe' } }]),
    following: [0, 1].map(part => 'window.YTD.following.part' + part + ' = ' + JSON.stringify(Array.from({
      length: part ? Math.max(0, size - Math.ceil(size / 2)) : Math.ceil(size / 2),
    }, (_, i) => ({ following: { accountId: String(700000 + i + (part ? Math.ceil(size / 2) : 0)) } })))),
  };
}
