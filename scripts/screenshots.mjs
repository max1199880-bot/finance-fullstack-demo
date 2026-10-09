// Скриншоты работающего приложения для отчёта: вход, экраны, запрос к API.
// Снимает прод по умолчанию — то, что увидит проверяющий.
//
// Запуск:  npm run screenshots
// Локально: BASE_URL=http://localhost:5173 npm run screenshots

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'https://finance-fullstack-demo.vercel.app';
// fileURLToPath, а не .pathname: кириллица в пути проекта иначе превращается в %D0%94…
const out = (rel) => fileURLToPath(new URL(`../docs/screenshots/${rel}`, import.meta.url));

const PAGES = [
  { path: '/', name: 'home', ready: 'Расход за' },
  { path: '/budget', name: 'budget', ready: 'КАТЕГОРИИ' },
  { path: '/capital', name: 'capital', ready: 'Net Worth' },
  { path: '/analytics', name: 'analytics', ready: 'Расход' },
  { path: '/add', name: 'add', ready: 'Выберите категорию' },
];

await mkdir(out(''), { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
});
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`JS: ${e.message}`));
page.on('response', (r) => {
  if (r.url().includes('/functions/v1/api/') && r.status() >= 400) {
    problems.push(`API ${r.status()}: ${new URL(r.url()).pathname}`);
  }
});

// 1. Экран входа — его видит любой, кто открыл ссылку.
await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Посмотреть демо' }).waitFor();
await page.screenshot({ path: out('login.png') });

// 2. Вход в демо: сессию выдаёт Supabase Auth, дальше все запросы идут с токеном.
await page.getByRole('button', { name: 'Посмотреть демо' }).click();
await page.getByText('Расход за').first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);

for (const p of PAGES) {
  await page.goto(`${BASE}${p.path}`);
  await page.getByText(p.ready, { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: out(`${p.name}.png`) });
}

console.log(`Скриншотов: ${PAGES.length + 1}. Папка: docs/screenshots/ (адрес: ${BASE})`);
if (problems.length) {
  console.log('Проблемы:');
  for (const p of [...new Set(problems)]) console.log(' •', p);
  process.exitCode = 1;
} else {
  console.log('Ошибок JS и ответов 4xx/5xx от API не было.');
}

await browser.close();
