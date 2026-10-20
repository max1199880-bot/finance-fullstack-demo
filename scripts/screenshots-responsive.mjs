// Скриншоты экранов на трёх ширинах — телефон, планшет, десктоп — после входа в демо.
// Проверяет адаптивность глазами и заодно ловит горизонтальную прокрутку.
//
// Запуск:  node scripts/screenshots-responsive.mjs [BASE_URL] [OUT_DIR]
//          по умолчанию прод и docs/screenshots/responsive

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'https://finance-fullstack-demo.vercel.app';
const OUT = resolve(process.argv[3] ?? 'docs/screenshots/responsive');

const WIDTHS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];
const PAGES = [
  { path: '/', name: 'home' },
  { path: '/budget', name: 'budget' },
  { path: '/capital', name: 'capital' },
  { path: '/analytics', name: 'analytics' },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const w of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: w.width, height: w.height },
    deviceScaleFactor: 2,
    isMobile: w.mobile,
    hasTouch: w.mobile,
    locale: 'ru-RU',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Посмотреть демо' }).click();
  await page.waitForURL(`${BASE}/`);
  for (const p of PAGES) {
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) problems.push(`${w.name} ${p.path}: горизонтальная прокрутка ${overflow}px`);
    await page.screenshot({ path: `${OUT}/${w.name}-${p.name}.png` });
    console.log('✓', w.name, p.path);
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? `Проблемы:\n${problems.join('\n')}` : 'Горизонтальной прокрутки нет');
