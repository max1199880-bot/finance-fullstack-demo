// Вымышленные демо-данные: полгода истории одного условного пользователя.
// Состав категорий, источников и счетов — стартовый набор, который сервер прода создаёт
// новому пользователю; суммы и операции придуманы. Реальных данных здесь нет (правило X2).
//
// История не записывается готовыми балансами, а «проводится» через applyTx — так же, как
// живые операции. Поэтому балансы, история счетов и график капитала сходятся сами собой.

import { annuity, applyTx, balanceOf, monthKey, setBalance, splitPayment } from './ledger';
import type { Kopecks } from './money';
import type { Category, DemoDb, IncomeSource, Transaction } from './types';

const R = (rub: number): Kopecks => Math.round(rub * 100);

// Стартовый набор категорий прода (порядок 0..7, emoji null — иконку подбирает приложение по имени).
const EXPENSE = [
  'Продукты',
  'Транспорт',
  'Еда вне дома',
  'Дом/связь',
  'Развлечения',
  'Покупки',
  'Мед/спорт',
  'Кредит',
];
const SOURCES = ['Зарплата', 'Подработка', 'Прочее'];

const ids = {
  cat: (name: string) => `cat-${EXPENSE.indexOf(name)}`,
  src: (name: string) => `src-${SOURCES.indexOf(name)}`,
  sber: 'acc-sber',
  tinkoff: 'acc-tinkoff',
  cash: 'acc-cash',
  invest: 'acc-invest',
  car: 'acc-car',
  loan: 'acc-loan',
};

/** Лимиты текущего месяца, ₽. Подобраны так, чтобы бюджет сразу показывал все статусы. */
const PLANS_RUB: Record<string, number> = {
  Продукты: 24_000,
  Транспорт: 4_000, // 4 850 ₽ → 121% → перерасход
  'Еда вне дома': 6_500, // 6 100 ₽ → 94% → предупреждение
  'Дом/связь': 40_000,
  Развлечения: 6_000,
  'Мед/спорт': 3_000,
  Кредит: 11_000,
};

type Expense = [day: number, category: string, rub: number, account: string, comment?: string];

// Расходы месяца: day — день месяца. В текущем месяце берутся только прошедшие дни.
const MONTH_EXPENSES: Expense[] = [
  [1, 'Дом/связь', 38_000, ids.sber, 'Аренда'],
  [2, 'Продукты', 2_180, ids.cash],
  [3, 'Еда вне дома', 1_650, ids.tinkoff],
  [4, 'Транспорт', 2_760, ids.tinkoff, 'Такси'],
  [6, 'Продукты', 3_560, ids.tinkoff],
  [7, 'Дом/связь', 690, ids.tinkoff, 'Мобильная связь'],
  [8, 'Еда вне дома', 2_110, ids.tinkoff],
  [9, 'Мед/спорт', 890, ids.tinkoff, 'Аптека'],
  [11, 'Развлечения', 1_200, ids.tinkoff, 'Кино'],
  [12, 'Продукты', 1_320, ids.cash],
  [14, 'Еда вне дома', 1_000, ids.cash],
  [16, 'Транспорт', 1_450, ids.tinkoff],
  [18, 'Продукты', 2_180, ids.tinkoff],
  [19, 'Еда вне дома', 890, ids.tinkoff, 'Обед'],
  [21, 'Транспорт', 640, ids.tinkoff, 'Такси до офиса'],
  [22, 'Еда вне дома', 450, ids.tinkoff, 'Капучино'],
  [24, 'Продукты', 2_940, ids.tinkoff],
  [26, 'Покупки', 3_490, ids.tinkoff, 'Кроссовки'],
  [27, 'Еда вне дома', 1_300, ids.tinkoff],
  [28, 'Развлечения', 2_400, ids.tinkoff],
];

/** Прошлые месяцы немного отличаются от текущего — чтобы на графиках была динамика. */
const PAST_FACTOR = [0.92, 1.08, 0.86, 1.12, 1.0];

const CREDIT = { originalAmount: R(250_000), rate: 16.9, termMonths: 36, paymentDay: 15 };

export function createSeed(now: Date = new Date()): DemoDb {
  const categories: Category[] = [
    ...EXPENSE.map((name, order) => ({
      id: ids.cat(name),
      name,
      type: 'expense' as const,
      isActive: true,
      order,
      emoji: null,
    })),
  ];
  const incomeSources: IncomeSource[] = SOURCES.map((name) => ({
    id: ids.src(name),
    name,
    emoji: null,
    isActive: true,
  }));

  const firstMonth = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const creditStart = new Date(firstMonth.getFullYear(), firstMonth.getMonth(), CREDIT.paymentDay - 14);
  const start = new Date(firstMonth.getTime() - 86_400_000).toISOString();

  const db: DemoDb = {
    version: 2,
    user: {
      id: 'demo-user',
      firstName: 'Демо',
      telegramUserId: '0',
      currency: 'RUB',
      monthStartDay: 1,
      timezone: 'Europe/Moscow',
      remindersEnabled: true,
      onboardingCompleted: true,
    },
    categories,
    incomeSources,
    accounts: [
      { id: ids.sber, name: 'Сбербанк', type: 'bank', isActive: true },
      { id: ids.tinkoff, name: 'Тинькофф', type: 'bank', isActive: true },
      { id: ids.cash, name: 'Наличные', type: 'cash', isActive: true },
      { id: ids.invest, name: 'Инвестиции', type: 'investment', isActive: true },
      {
        id: ids.car,
        name: 'Автомобиль',
        type: 'other_asset',
        isActive: true,
        purchasePrice: R(1_150_000),
        liability: false,
      },
      { id: ids.loan, name: 'Потребкредит', type: 'credit', isActive: true },
    ],
    snapshots: [],
    transactions: [],
    credits: [{ id: ids.loan, ...CREDIT, startDate: creditStart.toISOString() }],
    categoryPlans: [],
    globalPlans: [],
    feedback: [],
    nextId: 1,
  };

  // Стартовые остатки — за день до начала истории.
  setBalance(db, ids.sber, R(64_000), start);
  setBalance(db, ids.tinkoff, R(28_500), start);
  setBalance(db, ids.cash, R(9_000), start);
  setBalance(db, ids.invest, R(100_000), start);
  setBalance(db, ids.car, R(1_150_000), start);
  setBalance(db, ids.loan, CREDIT.originalAmount, creditStart.toISOString());

  const events: Array<{ at: Date; run: () => void }> = [];
  const tx = (
    partial: Omit<
      Transaction,
      'id' | 'categoryId' | 'incomeSourceId' | 'fromAccountId' | 'toAccountId' | 'comment'
    > &
      Partial<Transaction>,
  ): Transaction => ({
    categoryId: null,
    incomeSourceId: null,
    fromAccountId: null,
    toAccountId: null,
    comment: null,
    ...partial,
    id: `tx-${db.nextId++}`,
  });
  const book = (t: Transaction) => {
    db.transactions.push(t);
    applyTx(db, t);
  };

  for (let i = 0; i < 6; i++) {
    const y = firstMonth.getFullYear();
    const m = firstMonth.getMonth() + i;
    const isCurrent = i === 5;
    const factor = isCurrent ? 1 : (PAST_FACTOR[i] ?? 1);
    // В текущем месяце — только наступившие дни: будущих операций в демо нет.
    const at = (day: number, hour: number) => new Date(y, m, day, hour, (day * 7) % 60);
    const past = (d: Date) => d.getTime() <= now.getTime();

    const income: Array<[number, string, number, string, string?]> = [
      [5, 'Зарплата', 45_000, ids.sber, 'Аванс'],
      [20, 'Зарплата', 45_000, ids.sber],
      [12, 'Подработка', i % 2 === 0 ? 12_000 : 8_500, ids.tinkoff, 'Вёрстка лендинга'],
      [25, 'Прочее', 1_240, ids.tinkoff, 'Кэшбэк'],
    ];
    for (const [day, src, rub, acc, comment] of income) {
      const d = at(day, 10);
      if (past(d))
        events.push({
          at: d,
          run: () =>
            book(
              tx({
                date: d.toISOString(),
                type: 'income',
                amount: R(rub),
                incomeSourceId: ids.src(src),
                toAccountId: acc,
                comment: comment ?? null,
              }),
            ),
        });
    }

    for (const [day, cat, rub, acc, comment] of MONTH_EXPENSES) {
      const d = at(day, 9 + (day % 11));
      // Аренда и связь не «плавают», остальное умножаем на коэффициент месяца.
      const amount = cat === 'Дом/связь' ? rub : Math.round(rub * factor);
      if (past(d))
        events.push({
          at: d,
          run: () =>
            book(
              tx({
                date: d.toISOString(),
                type: 'expense',
                amount: R(amount),
                categoryId: ids.cat(cat),
                fromAccountId: acc,
                comment: comment ?? null,
              }),
            ),
        });
    }

    // Внутренние переводы: зарплата приходит на один счёт, а тратится с карты и наличными.
    // Без них остатки «Тинькофф» и «Наличных» уходили в минус (найдено дымовым прогоном).
    const transfers: Array<[number, string, number, string]> = [
      [5, ids.tinkoff, 25_000, 'Перевод на карту'],
      [10, ids.cash, 5_000, 'Снятие наличных'],
    ];
    for (const [day, to, rub, comment] of transfers) {
      const d = at(day, 18);
      if (past(d))
        events.push({
          at: d,
          run: () =>
            book(
              tx({
                date: d.toISOString(),
                type: 'transfer_between_accounts',
                amount: R(rub),
                fromAccountId: ids.sber,
                toAccountId: to,
                comment,
              }),
            ),
        });
    }

    const invest = at(6, 12);
    if (past(invest))
      events.push({
        at: invest,
        run: () =>
          book(
            tx({
              date: invest.toISOString(),
              type: 'transfer_to_investment',
              amount: R(10_000),
              fromAccountId: ids.sber,
              toAccountId: ids.invest,
              comment: 'Пополнение брокерского счёта',
            }),
          ),
      });

    // Платёж по кредиту — через ту же раскладку «проценты / тело», что и в проде.
    const pay = at(CREDIT.paymentDay, 11);
    if (pay > creditStart && past(pay)) {
      events.push({
        at: pay,
        run: () => {
          const debt = balanceOf(db, ids.loan);
          const amount = annuity(CREDIT.originalAmount, CREDIT.rate, CREDIT.termMonths);
          const { interest, principal } = splitPayment(debt, CREDIT.rate, amount);
          book(
            tx({
              date: pay.toISOString(),
              type: 'expense',
              amount,
              categoryId: ids.cat('Кредит'),
              fromAccountId: ids.sber,
              toAccountId: ids.loan,
              principalPart: principal,
              interestPart: interest,
              comment: 'Платёж по кредиту: Потребкредит',
            }),
          );
        },
      });
    }
  }

  // Переоценка автомобиля два месяца назад: рыночная цена упала.
  const reval = new Date(now.getFullYear(), now.getMonth() - 2, 10, 15);
  events.push({
    at: reval,
    run: () => {
      const prev = balanceOf(db, ids.car);
      const next = R(1_070_000);
      setBalance(db, ids.car, next, reval.toISOString());
      book(
        tx({
          date: reval.toISOString(),
          type: 'asset_revaluation',
          amount: prev - next,
          fromAccountId: ids.car,
          comment: 'Переоценка: Автомобиль',
        }),
      );
    },
  });

  events.sort((a, b) => a.at.getTime() - b.at.getTime()).forEach((e) => e.run());

  // Бюджет текущего месяца: лимиты по категориям + глобальные планы доходов и инвестиций.
  const month = monthKey(now);
  db.categoryPlans = Object.entries(PLANS_RUB).map(([name, rub]) => ({
    month,
    categoryId: ids.cat(name),
    amount: R(rub),
  }));
  db.globalPlans = [{ month, plannedTotalIncome: R(100_000), plannedInvestments: R(10_000) }];

  return db;
}
