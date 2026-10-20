// Наполнение демо-аккаунта вымышленными данными: полгода операций, счета, кредит, планы.
//
// Данные берутся тем же генератором, что и в прошлой версии демо (src/demo/seed.ts) —
// поэтому цифры на экранах совпадают с тем, на чём писались тесты. Генератор на
// TypeScript, поэтому перед запуском он собирается esbuild в один js-файл.
//
// Запуск: npm run seed:demo   (нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env.local)
//
// Служебный ключ используется только здесь, на машине разработчика: он обходит RLS,
// чтобы записать данные за демо-пользователя. В приложение этот ключ не попадает.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = (name, fallback) => process.env[name] ?? fallback;

const URL_ = env('SUPABASE_URL', env('VITE_SUPABASE_URL', 'http://127.0.0.1:54321'));
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const EMAIL = env('DEMO_EMAIL', 'demo@example.com');
const PASSWORD = env('VITE_DEMO_PASSWORD', 'demo-password-2026');

if (!SERVICE_KEY) {
  console.error('Нет SUPABASE_SERVICE_ROLE_KEY. Скопируйте .env.example в .env.local и заполните.');
  process.exit(1);
}

// ── 1. Собираем генератор демо-данных ───────────────────────────────────────
const tmp = `${root}.tmp-seed`;
mkdirSync(tmp, { recursive: true });
execFileSync(
  `${root}node_modules/.bin/esbuild`,
  [`${root}src/demo/seed.ts`, '--bundle', '--format=esm', '--platform=node', `--outfile=${tmp}/seed.mjs`],
  { stdio: 'inherit' },
);
const { createSeed } = await import(`${tmp}/seed.mjs`);
const db = createSeed();

// ── 2. Демо-пользователь ────────────────────────────────────────────────────
const admin = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });

const existing = await admin.auth.admin.listUsers({ perPage: 1000 });
const found = existing.data?.users.find((u) => u.email === EMAIL);
if (found) {
  // Пересоздаём целиком: демо должно открываться в одном и том же состоянии,
  // что бы в нём ни нажимали посетители. Каскады в схеме уносят все его строки.
  await admin.auth.admin.deleteUser(found.id);
}
const created = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { display_name: 'Демо' },
  // Пометка демо — в app_metadata: её меняет только сервер, а база по ней запрещает
  // удаление данных и смену пароля (миграция security_hardening).
  app_metadata: { demo: true },
});
if (created.error) throw created.error;
const userId = created.data.user.id;

// Триггер регистрации уже создал стартовый набор — он нам не нужен, вместо него
// кладём полный набор из генератора.
await admin.from('categories').delete().eq('user_id', userId);
await admin.from('income_sources').delete().eq('user_id', userId);
await admin.from('accounts').delete().eq('user_id', userId);

await admin
  .from('profiles')
  .update({
    onboarding_completed: true,
    month_start_day: db.user.monthStartDay,
  })
  .eq('id', userId);

// ── 3. Перенос данных ───────────────────────────────────────────────────────
const money = (kopecks) => {
  // Защита от опечатки в имени поля: NaN Postgres принимает в numeric молча,
  // и потом «план» на экране выглядит пустым без единой ошибки.
  if (!Number.isFinite(kopecks)) throw new Error(`Не сумма: ${kopecks}`);
  return (Math.round(kopecks) / 100).toFixed(2);
};
const ids = new Map(); // id генератора ('cat-0', 'acc-sber') → uuid в базе
const uuid = (key) => {
  if (!ids.has(key)) ids.set(key, randomUUID());
  return ids.get(key);
};

const insert = async (table, rows) => {
  if (!rows.length) return 0;
  // Пачками: одним запросом на тысячу строк вместо строки за запрос.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
};

const counts = {};

counts.categories = await insert(
  'categories',
  db.categories.map((c) => ({
    id: uuid(c.id),
    user_id: userId,
    name: c.name,
    type: c.type,
    is_active: c.isActive,
    order: c.order,
    emoji: c.emoji ?? null,
  })),
);

counts.income_sources = await insert(
  'income_sources',
  db.incomeSources.map((s) => ({
    id: uuid(s.id),
    user_id: userId,
    name: s.name,
    is_active: s.isActive,
    emoji: s.emoji ?? null,
  })),
);

// Кредит в генераторе лежит отдельной записью, а в базе это поля счёта того же id.
const creditByAccount = new Map((db.credits ?? []).map((c) => [c.id, c]));
counts.accounts = await insert(
  'accounts',
  db.accounts.map((a) => {
    const credit = creditByAccount.get(a.id);
    return {
      id: uuid(a.id),
      user_id: userId,
      name: a.name,
      type: a.type,
      is_active: a.isActive,
      purchase_price: a.purchasePrice != null ? money(a.purchasePrice) : null,
      liability: a.liability ?? false,
      credit_rate: credit ? String(credit.rate) : null,
      credit_term_months: credit ? credit.termMonths : null,
      credit_original_amount: credit ? money(credit.originalAmount) : null,
      credit_start_date: credit ? new Date(credit.startDate).toISOString().slice(0, 10) : null,
      credit_payment_day: credit ? (credit.paymentDay ?? null) : null,
    };
  }),
);

counts.account_balances = await insert(
  'account_balances',
  db.snapshots.map((b) => ({
    account_id: uuid(b.accountId),
    date: new Date(b.date).toISOString(),
    balance: money(b.balance),
  })),
);

counts.transactions = await insert(
  'transactions',
  db.transactions.map((t) => ({
    id: uuid(t.id),
    user_id: userId,
    date: new Date(t.date).toISOString(),
    amount: money(t.amount),
    type: t.type,
    category_id: t.categoryId ? uuid(t.categoryId) : null,
    income_source_id: t.incomeSourceId ? uuid(t.incomeSourceId) : null,
    from_account_id: t.fromAccountId ? uuid(t.fromAccountId) : null,
    to_account_id: t.toAccountId ? uuid(t.toAccountId) : null,
    linked_asset_id: t.linkedAssetId ? uuid(t.linkedAssetId) : null,
    principal_part: t.principalPart != null ? money(t.principalPart) : null,
    interest_part: t.interestPart != null ? money(t.interestPart) : null,
    comment: t.comment ?? null,
  })),
);

counts.feedback = await insert(
  'feedback',
  (db.feedback ?? []).map((f) => ({
    user_id: userId,
    message: f.message,
    created_at: new Date(f.createdAt).toISOString(),
  })),
);

counts.budget_plan_month = await insert(
  'budget_plan_month',
  (db.categoryPlans ?? []).map((p) => ({
    user_id: userId,
    month: p.month,
    category_id: uuid(p.categoryId),
    planned_amount: money(p.amount),
  })),
);

counts.budget_plan_global = await insert(
  'budget_plan_global',
  (db.globalPlans ?? []).map((p) => ({
    user_id: userId,
    month: p.month,
    planned_total_expenses: p.plannedTotalExpenses != null ? money(p.plannedTotalExpenses) : null,
    planned_total_income: p.plannedTotalIncome != null ? money(p.plannedTotalIncome) : null,
    planned_investments: p.plannedInvestments != null ? money(p.plannedInvestments) : null,
  })),
);

rmSync(tmp, { recursive: true, force: true });

// Отметка «наполнение закончено» — ПОСЛЕ записи всех данных и по часам самой базы.
// По ней ночная уборка (cleanup_demo) отличает исходные данные от добавленных посетителями.
// Часы этой машины не годятся: даже расхождение в десятки миллисекунд делало строки
// «новее» отметки, и уборка стирала демо целиком (инцидент 20.10.2026).
const mark = await admin.rpc('mark_demo_seeded', { p_user: userId });
if (mark.error) throw new Error(`Отметка seeded_at не поставлена: ${mark.error.message}`);

console.log(`Демо-аккаунт ${EMAIL} готов (id ${userId}).`);
for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`);
