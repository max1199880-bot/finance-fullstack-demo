// Автоматическая проверка адаптивности и скриншоты для отчёта.
// Обходит экраны приложения на четырёх ширинах в двух темах, сохраняет PNG в docs/screenshots
// и проверяет признаки сломанной вёрстки: горизонтальную прокрутку и элементы за краем экрана.
// Отдельно снимает состояния: загрузка, ввод суммы, ошибка сохранения, офлайн.
//
// Запуск (при работающем `npm run dev`):  npm run screenshots
// Другой адрес:                           BASE_URL=http://localhost:5173 npm run screenshots

import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5174';
const OUT = new URL('../docs/screenshots/', import.meta.url);
// fileURLToPath, а не .pathname: .pathname отдаёт путь в URL-кодировке, и при кириллице/пробелах
// в пути проекта файлы уезжали в папку «%D0%94%D0%97%20…» (баг первого прогона).
const out = (rel) => fileURLToPath(new URL(rel, OUT));

const VIEWPORTS = [
  { name: 'small', width: 320, height: 640, isMobile: true },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
  { name: 'tablet', width: 768, height: 1024, isMobile: true },
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
];
const THEMES = ['light', 'dark'];
const PAGES = [
  { path: '/', name: 'home', ready: 'Расход за' },
  { path: '/add', name: 'add', ready: 'Выберите категорию' },
  { path: '/budget', name: 'budget', ready: 'Категории' },
  { path: '/capital', name: 'capital', ready: 'Net Worth' },
  { path: '/analytics', name: 'analytics', ready: 'Расходы по дням' },
  { path: '/settings', name: 'settings', ready: 'Профиль' },
];

/** Горизонтальная прокрутка и элементы, вылезающие за правый край, — главные признаки поломки. */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // Ленты с горизонтальной прокруткой (overflow-x-auto) — норма: их содержимое и должно уходить за край.
        return r.width > 0 && r.right > vw + 1 && !el.closest('[class*="overflow-x-auto"]');
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} «${(el.textContent ?? '').trim().slice(0, 30)}»`);
    return { overflow, offenders };
  });
}

const browser = await chromium.launch();
const problems = [];
const notes = [];
let shots = 0;

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      colorScheme: theme,
      locale: 'ru-RU',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mkdir(out(`${vp.name}/`), { recursive: true });
    for (const p of PAGES) {
      await page.goto(`${BASE}${p.path}?latency=0`);
      await page.getByText(p.ready, { exact: false }).first().waitFor();
      await page.waitForTimeout(250);
      const { overflow, offenders } = await layoutProblems(page);
      if (overflow > 0 || offenders.length) problems.push(`${vp.name}/${theme}${p.path}: прокрутка ${overflow}px; за краем: ${offenders.join(', ') || '—'}`);
      // Снимаем видимую область, а не всю страницу: при fullPage фиксированный таб-бар рисуется
      // посреди длинного скриншота и выглядит как баг вёрстки, хотя в приложении он внизу.
      // Всю высоту страницы проверяет layoutProblems выше.
      await page.screenshot({ path: out(`${vp.name}/${theme}-${p.name}.png`) });
      shots++;
    }
    if (errors.length) problems.push(`${vp.name}/${theme}: ошибки JS — ${errors.join(' | ')}`);
    await context.close();
  }
}

// ── состояния ───────────────────────────────────────────────────────────────
await mkdir(out('states/'), { recursive: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light', locale: 'ru-RU' });
const page = await ctx.newPage();

// 1) Загрузка: медленная сеть — видно скелетон.
await page.goto(`${BASE}/?latency=4000&reset=1`);
await page.waitForTimeout(600);
await page.screenshot({ path: out('states/loading-skeleton.png') });
shots++;

// 2) Добавление операции: категория → счёт → сумма.
await page.goto(`${BASE}/add?latency=0`);
await page.getByRole('button', { name: /Продукты/ }).click();
await page.getByRole('button', { name: /Тинькофф/ }).click();
for (const digit of ['1', '2', '5', '0']) await page.getByRole('button', { name: digit, exact: true }).click();
await page.screenshot({ path: out('states/add-amount.png') });
shots++;

// 3) Ошибка сохранения: сервер недоступен в момент отправки — прод показывает диалог, форма остаётся.
await page.evaluate(() => {
  const real = window.fetch;
  window.fetch = (input, init) => (String(input).startsWith('/api/') ? Promise.reject(new TypeError('Failed to fetch')) : real(input, init));
});
const dialogPromise = page.waitForEvent('dialog');
await page.getByRole('button', { name: 'Сохранить' }).click();
const dialog = await dialogPromise;
notes.push(`ошибка сохранения → диалог прода «${dialog.message()}», введённая сумма осталась на экране`);
await dialog.dismiss();
await page.waitForTimeout(200);
await page.screenshot({ path: out('states/save-error-form-kept.png') });
shots++;

// 4) Офлайн: баннер прода «Без сети» поверх закешированных данных.
await page.goto(`${BASE}/?latency=0`);
await page.getByText('Расход за').waitFor();
await ctx.setOffline(true);
await page.waitForTimeout(500);
await page.screenshot({ path: out('states/offline-banner.png') });
shots++;
await ctx.setOffline(false);
await ctx.close();
await browser.close();

console.log(`Скриншотов: ${shots}. Папка: docs/screenshots/`);
for (const n of notes) console.log(' ·', n);
if (problems.length) {
  console.log(`\nНайдено проблем: ${problems.length}`);
  for (const p of problems) console.log(' •', p);
  process.exitCode = 1;
} else {
  console.log('Проблем вёрстки не найдено: ни горизонтальной прокрутки, ни элементов за краем, ни ошибок JS — на 4 ширинах × 2 темах.');
}
