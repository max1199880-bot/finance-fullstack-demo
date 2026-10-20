// Тесты настоящих экранов прода (Home, Budget, Add) поверх демо-сервера.
// Элементы ищем по ролям и тексту — так, как их видит пользователь.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoStore } from '../demo/store';
import { balanceOf } from '../demo/ledger';
import { Route, Routes } from 'react-router-dom';
import { AuthGate } from '../components/AuthGate';
import {
  freezeClock,
  installTestServer,
  norm,
  renderScreen,
  testQueryClient,
  type Network,
} from '../test/harness';
import { IncomeSourceList } from '../components/IncomeSourceList';
import { AddPage } from './Add';
import { AnalyticsPage } from './Analytics';
import { BudgetPage } from './Budget';
import { CapitalPage } from './Capital';
import { CategoryEditorPage } from './CategoryEditor';
import { HomePage } from './Home';
import { SettingsPage } from './Settings';

let store: DemoStore;
let network: Network;

afterEach(() => {
  // Тесты «Нет сети» выключают onlineManager — вернём, чтобы не влиять на соседей.
  onlineManager.setOnline(true);
});

beforeEach(() => {
  freezeClock();
  network = { down: false };
  store = installTestServer(network);
});

describe('Главная', () => {
  it('позитивный сценарий: «Расход за месяц», план/остаток и капитал из демо-данных', async () => {
    const onGoTo = vi.fn();
    renderScreen(<HomePage onGoTo={onGoTo} />);

    const hero = await screen.findByText(/Расход за сен 2026/);
    const card = hero.closest('button') as HTMLElement;
    expect(norm(card.textContent)).toContain('69 870,74 ₽');
    expect(norm(card.textContent)).toMatch(/План\s*94 500 ₽/);
    expect(norm(card.textContent)).toMatch(/Остаток\s*24 629,26 ₽/);
    expect(screen.getByText('💵 Деньги')).toBeInTheDocument();

    // Карточка расхода ведёт в бюджет — навигация отдаётся наверх через onGoTo, как в проде.
    await userEvent.setup().click(card);
    expect(onGoTo).toHaveBeenCalledWith('budget');
  });

  it('пока сервер не ответил — скелетон, а не пустой экран', () => {
    network.down = true;
    const { container } = renderScreen(<HomePage onGoTo={vi.fn()} />);
    expect(screen.queryByText(/Расход за/)).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('сервер недоступен и кеша нет — экран ошибки с «Повторить», а не вечный скелетон', async () => {
    network.down = true;
    renderScreen(<HomePage onGoTo={vi.fn()} />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.getByText(/Нет связи с сервером/)).toBeInTheDocument();

    // Сеть вернулась — «Повторить» загружает данные без перезапуска приложения.
    network.down = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(/Расход за сен 2026/)).toBeInTheDocument();
  });
});

describe('Вход в PWA (AuthGate)', () => {
  // Вход теперь держит Supabase Auth: сессия лежит в браузере, а не проверяется
  // запросом на каждый старт. Поэтому приложение открывается и без сети, а
  // просроченный токен отсекает сервер — ответ 401 гасит сессию (см. lib/api.ts).
  function renderGate() {
    renderScreen(
      <Routes>
        <Route element={<AuthGate />}>
          <Route path="/" element={<div>Приложение</div>} />
        </Route>
        <Route path="/login" element={<div>Экран входа</div>} />
      </Routes>,
      testQueryClient(),
    );
  }

  it('с сохранённой сессией приложение открывается сразу', async () => {
    renderGate();
    expect(await screen.findByText('Приложение')).toBeInTheDocument();
  });

  it('нет сети — приложение всё равно открывается: сессия лежит в браузере', async () => {
    network.down = true;
    renderGate();
    expect(await screen.findByText('Приложение')).toBeInTheDocument();
    expect(screen.queryByText('Экран входа')).not.toBeInTheDocument();
  });

  it('без сессии показывается экран входа', async () => {
    const { supabase } = await import('../lib/supabase');
    const empty = vi
      .spyOn(supabase.auth, 'getSession')
      .mockResolvedValue({ data: { session: null }, error: null } as Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >);
    renderGate();
    expect(await screen.findByText('Экран входа')).toBeInTheDocument();
    empty.mockRestore();
  });

  it.each([401, 403])(
    'сервер отклонил токен (%i) — приложение сообщает об этом, а не молчит',
    async (status) => {
      network.authStatus = status;
      const { api, isAuthError } = await import('../lib/api');
      await expect(api.authMe()).rejects.toSatisfy((e: unknown) => isAuthError(e));
    },
  );

  it('ответ 401 гасит сессию, чтобы приложение вернулось на экран входа', async () => {
    network.authStatus = 401;
    const { supabase } = await import('../lib/supabase');
    const { api } = await import('../lib/api');
    const signOut = vi.spyOn(supabase.auth, 'signOut');

    await api.authMe().catch(() => {});
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    signOut.mockRestore();
  });
});

describe('Бюджет', () => {
  it('перерасход наверху: «Транспорт» 121% идёт первой строкой', async () => {
    renderScreen(<BudgetPage />);
    const first = await screen.findByText('Транспорт');
    const row = first.closest('button') ?? (first.parentElement as HTMLElement);
    expect(norm(row.textContent)).toContain('121%');
    const names = screen
      .getAllByText(/^(Транспорт|Дом\/связь|Еда вне дома|Продукты)$/)
      .map((el) => el.textContent);
    expect(names.slice(0, 3)).toEqual(['Транспорт', 'Дом/связь', 'Еда вне дома']);
  });
});

describe('Добавить операцию', () => {
  async function goToAmount(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /Продукты/ }));
    await user.click(await screen.findByRole('button', { name: /Тинькофф/ }));
    for (const digit of ['4', '5', '0']) await user.click(screen.getByRole('button', { name: digit }));
  }

  it('позитивный сценарий: категория → счёт → сумма → «Сохранить»; баланс счёта уменьшился', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const before = balanceOf(store.db, 'acc-tinkoff');
    renderScreen(<AddPage onDone={onDone} />);

    await goToAmount(user);
    expect(norm(screen.getByText(/^450/).textContent)).toBe('450 ₽');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const saved = store.db.transactions.at(-1);
    expect(saved).toMatchObject({
      type: 'expense',
      amount: 45_000,
      categoryId: 'cat-0',
      fromAccountId: 'acc-tinkoff',
    });
    expect(balanceOf(store.db, 'acc-tinkoff')).toBe(before - 45_000);
  });

  it('кнопка «Сохранить» неактивна, пока сумма нулевая', async () => {
    const user = userEvent.setup();
    renderScreen(<AddPage onDone={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: /Продукты/ }));
    await user.click(await screen.findByRole('button', { name: /Тинькофф/ }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '0' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('ошибка сети при сохранении: пользователь видит «Не удалось сохранить», форма не закрывается', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const count = store.db.transactions.length;
    renderScreen(<AddPage onDone={onDone} />);

    await goToAmount(user);
    network.down = true;
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Не удалось сохранить: Failed to fetch'));
    expect(onDone).not.toHaveBeenCalled();
    expect(store.db.transactions.length).toBe(count);
    // Сумма осталась на экране — можно повторить, когда сеть вернётся.
    expect(within(document.body).getByText(/^450/)).toBeInTheDocument();
  });
});

// Один и тот же сценарий на каждом экране: сервер недоступен и кеша нет → заглушка с
// «Повторить» (а не вечный скелетон и не ложное «пусто»), сеть вернулась → данные.
describe('Ошибки загрузки на экранах', () => {
  const recovers: { name: string; ui: () => React.ReactElement; error: string; ok: RegExp | string }[] = [
    { name: 'Бюджет', ui: () => <BudgetPage />, error: 'Не удалось загрузить данные', ok: 'Транспорт' },
    { name: 'Капитал', ui: () => <CapitalPage />, error: 'Не удалось загрузить данные', ok: /Деньги|Банки/ },
    {
      name: 'Аналитика',
      ui: () => <AnalyticsPage />,
      error: 'Не удалось загрузить данные',
      ok: 'Куда ушли деньги',
    },
    { name: 'Настройки', ui: () => <SettingsPage />, error: 'Не удалось загрузить данные', ok: 'Профиль' },
    {
      name: 'Категории',
      ui: () => <CategoryEditorPage onBack={vi.fn()} />,
      error: 'Не удалось загрузить данные',
      ok: /Категории расходов/,
    },
    {
      name: 'Источники дохода',
      ui: () => <IncomeSourceList />,
      error: 'Не удалось загрузить данные',
      ok: /Новый источник/,
    },
  ];

  it.each(recovers)('$name: ошибка с «Повторить», после возврата сети данные загружаются', async (c) => {
    network.down = true;
    renderScreen(c.ui());
    expect(await screen.findByText(c.error)).toBeInTheDocument();
    expect(screen.getByText(/Нет связи с сервером/)).toBeInTheDocument();

    network.down = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }));
    expect((await screen.findAllByText(c.ok))[0]).toBeInTheDocument();
    expect(screen.queryByText(c.error)).not.toBeInTheDocument();
  });

  it('Источники дохода: пока список не загружен — не «Нет источников»', async () => {
    network.down = true;
    const { container } = renderScreen(<IncomeSourceList />);
    expect(screen.queryByText(/Нет источников/)).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    await screen.findByText('Не удалось загрузить данные');
    expect(screen.queryByText(/Нет источников/)).not.toBeInTheDocument();
  });

  it('Аналитика: упали не все блоки — ошибка только в своём блоке, остальные на месте', async () => {
    const { handleApiRequest } = await import('../demo/server');
    const failing = '/analytics/by-category';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = new URL(String(input), 'http://localhost');
      if (raw.pathname.endsWith(failing)) throw new TypeError('Failed to fetch');
      const path = raw.pathname.replace('/functions/v1/api', '/api');
      return handleApiRequest(
        store,
        init?.method ?? 'GET',
        new URL(`${path}${raw.search}`, 'http://localhost'),
        init?.body,
      );
    });
    renderScreen(<AnalyticsPage />);
    // «Куда ушли деньги» и «Топ категорий» живут на одном запросе — у каждого своя заглушка.
    expect(await screen.findAllByRole('button', { name: 'Повторить' })).toHaveLength(2);
    expect(screen.getByText('Расходы по дням')).toBeInTheDocument();
    expect(screen.getByText(/Расход$/)).toBeInTheDocument();
  });

  it('нет сети и нет кеша — «Нет сети» вместо скелетона, данные появляются сами при возврате связи', async () => {
    onlineManager.setOnline(false);
    renderScreen(<BudgetPage />);
    expect(await screen.findByText('Нет сети')).toBeInTheDocument();

    onlineManager.setOnline(true);
    expect(await screen.findByText('Транспорт')).toBeInTheDocument();
  });

  it('данные уже есть, а фоновое обновление упало — экран остаётся с данными', async () => {
    const client = testQueryClient();
    renderScreen(<BudgetPage />, client);
    expect(await screen.findByText('Транспорт')).toBeInTheDocument();

    network.down = true;
    await client.refetchQueries({ queryKey: ['budget'] });
    expect(client.getQueryState(['budget', 'current'])?.status).toBe('error');
    expect(screen.getByText('Транспорт')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить данные')).not.toBeInTheDocument();
  });

  it('Добавить: справочник категорий не загрузился — заглушка вместо пустого пикера', async () => {
    network.down = true;
    renderScreen(<AddPage onDone={vi.fn()} />);
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();

    network.down = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: /Продукты/ })).toBeInTheDocument();
  });

  it('Главная, «История операций»: ошибка запроса — не «Операций нет», «Повторить» возвращает список', async () => {
    const user = userEvent.setup();
    renderScreen(<HomePage onGoTo={vi.fn()} />);
    await screen.findByText(/Расход за сен 2026/);

    network.down = true;
    await user.click(screen.getByRole('button', { name: /Все/ }));
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.queryByText('Операций нет')).not.toBeInTheDocument();

    network.down = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText('Не удалось загрузить данные')).not.toBeInTheDocument());
    expect(screen.queryByText('Операций нет')).not.toBeInTheDocument();
  });
});

describe('История операций: поиск, категория, «Показать ещё»', () => {
  /** Адреса запросов к списку операций — по ним видно, что именно ушло на сервер. */
  function spyOnTransactionRequests(): string[] {
    const urls: string[] = [];
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/transactions?')) urls.push(url);
      return real(input, init);
    });
    return urls;
  }

  async function openHistory(user: ReturnType<typeof userEvent.setup>) {
    renderScreen(<HomePage onGoTo={vi.fn()} />);
    await screen.findByText(/Расход за сен 2026/);
    await user.click(screen.getByRole('button', { name: /Все/ }));
    await screen.findByRole('textbox', { name: 'Поиск операций' });
  }

  // Строки операций в шторке (у них tabindex=0); строки Главной за шторкой не считаем.
  const rows = () =>
    within(screen.getByRole('dialog'))
      .queryAllByRole('button')
      .filter((el) => el.getAttribute('tabindex') === '0');

  it('поиск идёт на сервер с паузой: быстрый набор — один запрос, список сужается, «✕» возвращает всё', async () => {
    const user = userEvent.setup();
    const urls = spyOnTransactionRequests();
    await openHistory(user);
    await waitFor(() => expect(rows().length).toBeGreaterThan(2));
    const before = rows().length;
    urls.length = 0;

    await user.type(screen.getByRole('textbox', { name: 'Поиск операций' }), 'такси');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(
      rows()
        .map((r) => r.textContent)
        .join(' '),
    ).toMatch(/Такси до офиса/);
    // Пять букв набраны подряд — на сервер ушёл один запрос с полным словом, а не пять.
    expect(urls.filter((u) => u.includes('q='))).toHaveLength(1);
    expect(urls.at(-1)).toContain('q=%D1%82%D0%B0%D0%BA%D1%81%D0%B8');

    await user.click(screen.getByRole('button', { name: 'Очистить поиск' }));
    expect(screen.getByRole('textbox', { name: 'Поиск операций' })).toHaveValue('');
    await waitFor(() => expect(rows()).toHaveLength(before));
  });

  it('поиск находит и по названию категории', async () => {
    const user = userEvent.setup();
    await openHistory(user);
    await user.type(screen.getByRole('textbox', { name: 'Поиск операций' }), 'транспорт');
    // В сентябре у «Транспорта» три расхода: два с комментарием «Такси…» и один без.
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('фильтр по категории уходит на сервер как categoryId', async () => {
    const user = userEvent.setup();
    const urls = spyOnTransactionRequests();
    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Расходы' }));
    // Чип категории — кнопка без tabindex; строки операций с тем же словом отсекаем по нему.
    const chip = (name: RegExp) =>
      within(screen.getByRole('dialog'))
        .getAllByRole('button', { name })
        .find((el) => el.getAttribute('tabindex') === null);
    await waitFor(() => expect(chip(/Транспорт/)).toBeDefined());
    await user.click(chip(/Транспорт/)!);

    await waitFor(() => expect(urls.at(-1)).toContain('categoryId=cat-1'));
    await waitFor(() => expect(rows()).toHaveLength(3));
    // Чипы категорий остаются на месте: выбор не схлопывает их до одной выбранной.
    expect(chip(/Продукты/)).toBeDefined();
  });

  it('ничего не найдено — подсказка и «Сбросить фильтры» возвращает список', async () => {
    const user = userEvent.setup();
    await openHistory(user);
    await waitFor(() => expect(rows().length).toBeGreaterThan(2));
    const before = rows().length;

    await user.type(screen.getByRole('textbox', { name: 'Поиск операций' }), 'zzzzzz');
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument();
    expect(screen.getByText(/сбросить фильтры/)).toBeInTheDocument();
    expect(screen.queryByText('Операций нет')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(screen.getByRole('textbox', { name: 'Поиск операций' })).toHaveValue('');
    await waitFor(() => expect(rows()).toHaveLength(before));
  });

  it('«Показать ещё» подгружает следующую страницу по offset, пока список не закончится', async () => {
    const user = userEvent.setup();
    const urls = spyOnTransactionRequests();
    await openHistory(user);
    await user.click(screen.getByRole('button', { name: 'Всё' }));

    const total = store.db.transactions.length;
    expect(total).toBeGreaterThan(100);
    expect(await screen.findByText('Показано 100')).toBeInTheDocument();
    expect(rows()).toHaveLength(100);

    await user.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText(`${total} операций`)).toBeInTheDocument();
    expect(rows()).toHaveLength(total);
    expect(urls.at(-1)).toContain('offset=100');
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  it('ошибка поиска — заглушка с «Повторить», а не «Операций нет»', async () => {
    const user = userEvent.setup();
    await openHistory(user);
    await waitFor(() => expect(rows().length).toBeGreaterThan(2));

    network.down = true;
    await user.type(screen.getByRole('textbox', { name: 'Поиск операций' }), 'кино');
    expect(await screen.findByText('Не удалось загрузить данные')).toBeInTheDocument();
    expect(screen.queryByText(/Ничего не найдено|Операций нет/)).not.toBeInTheDocument();

    network.down = false;
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('демо-сервер повторяет контракт: слишком длинный q и мусорный categoryId — 400', async () => {
    const { handleApiRequest } = await import('../demo/server');
    const get = (qs: string) =>
      handleApiRequest(store, 'GET', new URL(`http://localhost/api/transactions?${qs}`), undefined);
    expect((await get(`q=${'я'.repeat(101)}`)).status).toBe(400);
    expect((await get('categoryId=a,b')).status).toBe(400);
    expect((await get('q=%25')).status).toBe(200);
    expect(await (await get('q=%25')).json()).toEqual([]);
  });
});
