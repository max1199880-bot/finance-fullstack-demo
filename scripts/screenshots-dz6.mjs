// Скриншоты к ДЗ 6: пайплайны, инцидент мониторинга, health и экран входа.
// Снимает только публичные страницы, без входа в аккаунты.
//
// Запуск:  node scripts/screenshots-dz6.mjs <id запуска CI> <номер issue инцидента>

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = 'https://github.com/max1199880-bot/finance-fullstack-demo';
const APP = 'https://finance-fullstack-demo.vercel.app';
const HEALTH = 'https://ckckfoghvbkwivagrgoo.supabase.co/functions/v1/api/health';
const [ciRun, incident] = process.argv.slice(2);
if (!ciRun || !incident) throw new Error('Нужны аргументы: <id запуска CI> <номер issue>');

const out = (rel) => fileURLToPath(new URL(`../docs/screenshots/dz6/${rel}`, import.meta.url));
await mkdir(out(''), { recursive: true });

const browser = await chromium.launch();
const desktop = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  colorScheme: 'light',
});

async function shot(ctx, url, name, { wait, fullPage = false } = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  if (wait) await page.getByText(wait).locator('visible=true').first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: out(`${name}.png`), fullPage });
  await page.close();
  console.log('✓', name);
}

await shot(desktop, `${REPO}/actions`, 'actions', { wait: 'workflow runs' });
await shot(desktop, `${REPO}/actions/runs/${ciRun}`, 'ci-run', { wait: 'Линтер' });
await shot(desktop, `${REPO}/issues/${incident}`, 'incident-issue', { wait: 'incident' });
// Health — живой ответ, но с отступами: сырой JSON в браузере — одна строка на весь экран.
{
  const res = await fetch(HEALTH);
  const body = JSON.stringify(await res.json(), null, 2);
  const page = await desktop.newPage({ viewport: { width: 760, height: 200 } });
  await page.setContent(
    `<body style="font:15px/1.5 ui-monospace,Menlo,monospace;margin:24px;color:#1f2328">` +
      `<div style="color:#59636e">GET ${HEALTH}</div>` +
      `<div style="margin:6px 0 12px"><b>HTTP ${res.status}</b></div>` +
      `<pre style="margin:0;padding:16px;background:#f6f8fa;border-radius:8px"></pre></body>`,
  );
  await page.locator('pre').evaluate((el, text) => (el.textContent = text), body);
  await page.screenshot({ path: out('health.png'), fullPage: true });
  await page.close();
  console.log('✓ health');
}

const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ru-RU',
  colorScheme: 'dark',
});
// Кнопку Google рисует сам Google во фрейме — ждём фрейм, а не текст.
{
  const page = await mobile.newPage();
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('iframe[src*="accounts.google.com/gsi/button"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out('login-google.png') });
  await page.close();
  console.log('✓ login-google');
}

await browser.close();
