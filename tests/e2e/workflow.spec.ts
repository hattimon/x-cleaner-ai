import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { archiveFiles } from '../fixtures.js';

const username = process.env.XC_E2E_USER ?? '';
const password = process.env.XC_E2E_PASSWORD ?? '';
const evidence = join(tmpdir(), 'x-cleaner-qa');

test.beforeEach(async ({ page }, info) => {
  if (!info.title.startsWith('English default')) await page.addInitScript(() => {
    if (!localStorage.getItem('xc-language')) localStorage.setItem('xc-language', 'pl');
  });
});

test('English default and saved Polish preference', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Polski' }).click();
  await expect(page.getByRole('heading', { name: 'Zaloguj się' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Polski' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

async function signIn(page: Page, current = password) {
  if (!password || !username || process.env.APP_PORT !== '3182') throw new Error('Uruchom testy przez scripts/test-browser.ps1.');
  await page.goto('/');
  await page.getByLabel('Nazwa użytkownika', { exact: true }).fill(username);
  await page.getByLabel('Hasło', { exact: true }).fill(current);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Przegląd obserwowanych' })).toBeVisible();
}

test('import, reguły, zaznaczenie profili, ochrona, eksport i historia', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
  await signIn(page);
  await expect(page).toHaveTitle('X-Cleaner AI');
  await page.getByRole('link', { name: 'Konta X', exact: true }).click();
  await page.getByRole('button', { name: 'Importuj archiwum', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Import z archiwum X' });
  const files = archiveFiles();
  const file = (name: string, source: string) => ({ name, mimeType: 'application/javascript', buffer: Buffer.from(source) });
  await modal.getByLabel(/Tożsamość konta/).setInputFiles(file('account.js', files.account));
  await modal.getByLabel(/Lista obserwowanych/).setInputFiles(files.following.map((source, index) => file(`following-${index}.js`, source)));
  await modal.getByRole('button', { name: 'Importuj archiwum' }).click();
  await expect(page.getByText('Zaimportowano listę z archiwum X.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Struktura kont' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Statystyki', exact: true })).toContainText('24');
  await page.getByRole('button', { name: 'Przelicz reguły', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Skanowanie', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Zadania skanowania' })).toBeVisible();
  await expect(page.getByText('24 / 24 profili').first()).toBeVisible({ timeout: 18000 });

  const navigation = page.getByRole('navigation', { name: 'Menu główne' });
  await navigation.getByRole('link', { name: 'Obserwowane', exact: true }).click();
  await expect(page.getByText('Strona 1 z 3 · 24 wyników')).toBeVisible();
  await page.getByRole('button', { name: 'Zaznacz stronę', exact: true }).click();
  await expect(page.getByText('Zaznaczono 10', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zaznacz wszystkie wyniki' }).click();
  await expect(page.getByText('Zaznaczono 24', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Następna strona' }).click();
  await expect(page.getByText('Strona 2 z 3 · 24 wyników')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Zaznacz profile na stronie' })).toBeChecked();
  await page.getByRole('button', { name: 'Wyczyść zaznaczenie' }).click();
  await expect(page.getByText('Zaznaczono 0', { exact: true })).toBeVisible();
  const boxes = page.locator('tbody input[type=checkbox]');
  await boxes.nth(0).check();
  await expect(page.getByText('Zaznaczono 1', { exact: true })).toBeVisible();
  await boxes.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Zaznaczono 0', { exact: true })).toBeVisible();
  const drag = async (from: number, to: number) => {
    const first = (await boxes.nth(from).boundingBox())!;
    const last = (await boxes.nth(to).boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  await drag(0, 2);
  await expect(page.getByText('Zaznaczono 3', { exact: true })).toBeVisible();
  await drag(5, 7);
  await expect(page.getByText('Zaznaczono 6', { exact: true })).toBeVisible();
  await expect(boxes.nth(4)).not.toBeChecked();
  await drag(1, 2);
  await expect(page.getByText('Zaznaczono 4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Wyczyść zaznaczenie' }).click();
  await page.getByRole('searchbox', { name: 'Szukaj profilu' }).or(page.getByRole('textbox', { name: 'Szukaj profilu' })).fill('700004');
  await expect(page.getByText('Strona 1 z 1 · 1 wyników')).toBeVisible();
  await page.getByRole('button', { name: 'Szczegóły Konto 700004' }).click();
  const detail = page.getByRole('dialog', { name: 'Szczegóły profilu' });
  await expect(detail).toContainText('Brak postów tych profili');
  await detail.getByRole('button', { name: 'Chroń', exact: true }).click();
  await expect(detail.locator('.profile-banner').getByText('Chronione', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await navigation.getByRole('link', { name: 'Do zachowania' }).click();
  await expect(page.getByRole('button', { name: 'Szczegóły Konto 700004' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Historia', exact: true }).click();
  await expect(page.getByRole('main').getByText(/Zakończono analizę 24 profili/).first()).toBeVisible();
  await expect(page.getByRole('main').getByText(/Zapisano decyzję właściciela dla Konto 700004/).first()).toBeVisible();
  await navigation.getByRole('link', { name: 'Obserwowane', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'CSV', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('x-cleaner-report.csv');
  expect(await readFile((await download.path())!, 'utf8')).toContain('700004');
  await navigation.getByRole('link', { name: 'AI Assistant' }).click();
  await page.getByRole('button', { name: 'Porównaj ostatnie dwa skanowania' }).click();
  await expect(page.getByText(/Do porównania potrzebne|Dwa ostatnie skany/)).toBeVisible();
  await navigation.getByRole('link', { name: 'Integracje', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with ChatGPT' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Połącz konto X', exact: true })).toBeDisabled();
  await navigation.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Struktura kont' })).toBeVisible();
  if (process.env.XC_EVIDENCE === '1') {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, 'dashboard.png'), animations: 'disabled' });
  }
  expect(errors).toEqual([]);
});

test('mobile 390 px, menu klawiaturowe i odczyt wcześniej zapisanej listy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Struktura kont' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  if (process.env.XC_EVIDENCE === '1') await page.screenshot({ path: join(evidence, 'mobile.png'), animations: 'disabled' });
  const menu = page.getByRole('button', { name: 'Otwórz menu' });
  await menu.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Menu główne' })).toBeVisible();
  await page.getByRole('link', { name: 'Do zachowania', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Szczegóły Konto 700004' })).toBeVisible();
  await page.getByRole('button', { name: 'Szczegóły Konto 700004' }).click();
  const modal = page.getByRole('dialog', { name: 'Szczegóły profilu' });
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('polecenie resetu na ekranie logowania i zmiana hasła z ustawień', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Pierwsze logowanie lub reset hasła', { exact: true }).click();
  await expect(page.getByText('docker compose exec backend node dist/server/account-cli.js reset-password', { exact: true })).toBeVisible();
  if (process.env.XC_EVIDENCE === '1') await page.screenshot({ path: join(evidence, 'login-reset.png'), animations: 'disabled' });
  await signIn(page);
  await page.getByRole('link', { name: 'Ustawienia', exact: true }).click();
  const form = page.getByRole('heading', { name: 'Bezpieczeństwo konta lokalnego' }).locator('xpath=../..');
  const rotated = randomBytes(24).toString('base64url');
  await form.getByLabel('Obecne hasło', { exact: true }).fill(password);
  await form.getByLabel(/^Nowe hasło/).fill(rotated);
  await form.getByLabel('Powtórz nowe hasło', { exact: true }).fill(rotated);
  await form.getByRole('button', { name: 'Zmień hasło' }).click();
  await expect(page.getByText('Hasło zostało zmienione. Zaloguj się nowym hasłem.')).toBeVisible();
  await expect((await page.request.get('/api/accounts')).status()).toBe(401);
  await signIn(page, rotated);
});
