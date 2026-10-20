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
