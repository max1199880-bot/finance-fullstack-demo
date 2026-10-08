// Дымовой прогон: открывает все экраны приложения в headless Chromium и падает, если есть
// ошибки JS, ошибки в консоли или ответы демо-сервера 4xx/5xx.
// Запуск при работающем `npm run dev`:  npm run smoke   (другой адрес — BASE_URL=…)

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5174';
const PATHS = ['/', '/add', '/budget', '/capital', '/analytics', '/settings', '/settings/categories', '/settings/income-sources'];
const verbose = process.argv.includes('--verbose');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
const page = await ctx.newPage();
const errors = [];
const warnings = [];
page.on('pageerror', (e) => errors.push(`JS: ${e.message}`));
// Предупреждения React («Warning: …») видны только в dev-сборке и не ломают работу —
// собираем их отдельно, чтобы не путать с настоящими ошибками.
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (text.startsWith('Warning:')) warnings.push(text.split('\n')[0].replace(/%s/g, '…'));
  else errors.push(`console: ${text}`);
});
page.on('response', (r) => r.url().includes('/api/') && r.status() >= 400 && errors.push(`API ${r.status()} ${new URL(r.url()).pathname}`));

for (const path of PATHS) {
  await page.goto(`${BASE}${path}?latency=0`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim();
  console.log(`✓ ${path.padEnd(26)} ${verbose ? text.slice(0, 220) : `${text.length} символов текста`}`);
}
await browser.close();

const uniqueWarnings = [...new Set(warnings)];
if (uniqueWarnings.length) console.log(`\nПредупреждения React (${uniqueWarnings.length}, не ошибки):\n${uniqueWarnings.map((w) => ' • ' + w).join('\n')}`);

const unique = [...new Set(errors)];
if (unique.length) {
  console.log(`\nОшибки (${unique.length}):\n${unique.map((e) => ' • ' + e).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nОшибок нет: ни JS-исключений, ни ошибок консоли, ни ответов API 4xx/5xx.');
}
