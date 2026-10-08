-- Схема данных «Финансы»: личный учёт денег (операции, бюджет, капитал).
-- Перенос модели действующего приложения (Prisma → Postgres) с правками под Supabase:
--   • идентификатор пользователя = auth.users.id (таблица profiles 1:1), вместо telegram_user_id;
--   • имена в snake_case — так их ждут PostgREST и SQL-функции;
--   • деньги — numeric(14,2): точная десятичная арифметика, без ошибок float.
-- Все таблицы закрыты RLS (см. 20261008090100_rls.sql).

-- ── Типы ────────────────────────────────────────────────────────────────────
create type category_type as enum ('expense', 'income');

create type account_type as enum (
  'cash',           -- наличные
  'bank',           -- счёт в банке
  'investment',     -- инвестиции
  'other_asset',    -- прочее имущество
  'credit',         -- кредит: баланс = остаток долга, вычитается из Net Worth
  'credit_buffer'   -- подушка под платежи по кредиту; деньги ещё свои
);

create type transaction_type as enum (
  'income',
  'expense',
  'transfer_to_investment',
  'transfer_between_accounts',
  'credit_payment',    -- платёж по кредиту: делится на тело (principal) и проценты
  'asset_revaluation'  -- переоценка актива без движения денег
);

-- ── Пользователь ────────────────────────────────────────────────────────────
-- Строка создаётся триггером при регистрации в Supabase Auth (см. 20261008090200_seed_fns.sql).
create table profiles (
  id                   uuid primary key references auth.users (id) on delete cascade,
  display_name         text,
  currency             text        not null default 'RUB',
  -- День начала месячного периода: у пользователя может быть «месяц с 10-го».
  month_start_day      smallint    not null default 1 check (month_start_day between 1 and 28),
  timezone             text        not null default 'Europe/Moscow',
  reminders_enabled    boolean     not null default false,
  onboarding_completed boolean     not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ── Справочники ─────────────────────────────────────────────────────────────
create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  name       text not null,
  type       category_type not null,
  is_active  boolean not null default true,
  "order"    integer not null default 0,  -- порядок на экране, меньше — выше
  emoji      text,
  created_at timestamptz not null default now(),
  unique (user_id, name, type)
);
create index categories_user_idx on categories (user_id, type, is_active, "order");

create table income_sources (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  emoji      text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
create index income_sources_user_idx on income_sources (user_id, is_active);

-- ── Счета, активы, кредиты ──────────────────────────────────────────────────
create table accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  name           text not null,
  type           account_type not null,
  is_active      boolean not null default true,
  -- Себестоимость актива: нужна, чтобы посчитать прибыль при продаже.
  purchase_price numeric(14,2),
  -- Поля кредита (null у остальных типов).
  credit_rate             numeric(7,4),   -- годовая ставка, %
  credit_term_months      integer,
  credit_original_amount  numeric(14,2),
  credit_start_date       date,
  credit_payment_day      smallint check (credit_payment_day between 1 and 28),
  linked_credit_account_id uuid references accounts (id) on delete set null,
  -- Классификация по Кийосаки: актив работает на тебя, пассив требует трат.
  liability      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (user_id, name),
  -- Кредит без ставки и срока посчитать нельзя — запрещаем такую строку сразу.
  constraint credit_fields_required check (
    type <> 'credit'
    or (credit_rate is not null and credit_term_months is not null and credit_original_amount is not null)
  )
);
create index accounts_user_idx on accounts (user_id, type, is_active);

-- История остатков: по одной строке на изменение, последняя по дате — текущий остаток.
create table account_balances (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id) on delete cascade,
  date       timestamptz not null default now(),
  balance    numeric(14,2) not null
);
create index account_balances_idx on account_balances (account_id, date desc);

-- Партии товара для перепродажи: продажа списывает партии по FIFO.
create table asset_lots (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references accounts (id) on delete cascade,
  quantity           integer not null check (quantity > 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  unit_cost          numeric(14,2) not null,
  purchased_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  constraint remaining_not_above_quantity check (remaining_quantity <= quantity)
);
create index asset_lots_fifo_idx on asset_lots (account_id, purchased_at);

-- ── Операции ────────────────────────────────────────────────────────────────
create table transactions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles (id) on delete cascade,
  date             timestamptz not null,
  amount           numeric(14,2) not null check (amount >= 0),
  type             transaction_type not null,
  category_id      uuid references categories (id) on delete set null,
  income_source_id uuid references income_sources (id) on delete set null,
  from_account_id  uuid references accounts (id) on delete set null,
  to_account_id    uuid references accounts (id) on delete set null,
  -- Расход можно привязать к активу: «вложено в этот предмет» = покупка + траты.
  linked_asset_id  uuid references accounts (id) on delete set null,
  -- Для платежа по кредиту: из чего состоит сумма. principal_part + interest_part = amount.
  principal_part   numeric(14,2),
  interest_part    numeric(14,2),
  comment          text,
  -- Ключ идемпотентности от клиента: повтор (двойное нажатие, ретрай, офлайн-очередь)
  -- несёт тот же ключ, и уникальный индекс делает вторую запись пустой операцией.
  client_tx_id     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, client_tx_id),
  constraint credit_parts_sum check (
    principal_part is null
    or interest_part is null
    or principal_part + interest_part = amount
  )
);
create index transactions_user_date_idx on transactions (user_id, date desc);
create index transactions_user_type_date_idx on transactions (user_id, type, date desc);
create index transactions_user_category_idx on transactions (user_id, category_id);
create index transactions_linked_asset_idx on transactions (linked_asset_id);

-- ── Бюджет ──────────────────────────────────────────────────────────────────
-- Месяц хранится строкой 'YYYY-MM': так его задаёт пользователь и так приходит с фронта.
create table budget_plan_month (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  month          text not null check (month ~ '^\d{4}-\d{2}$'),
  category_id    uuid not null references categories (id) on delete cascade,
  planned_amount numeric(14,2) not null check (planned_amount >= 0),
  unique (user_id, month, category_id)
);

create table budget_plan_global (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references profiles (id) on delete cascade,
  month                  text not null check (month ~ '^\d{4}-\d{2}$'),
  planned_total_expenses numeric(14,2),
  planned_total_income   numeric(14,2),
  planned_investments    numeric(14,2),
  unique (user_id, month)
);

-- ── Снимки капитала и обратная связь ────────────────────────────────────────
create table net_worth_snapshots (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles (id) on delete cascade,
  date              timestamptz not null default now(),
  total_cash        numeric(14,2) not null,
  total_investments numeric(14,2) not null,
  total_net_worth   numeric(14,2) not null
);
create index net_worth_user_date_idx on net_worth_snapshots (user_id, date desc);

create table feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  message    text not null check (length(btrim(message)) > 0),
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
create index feedback_created_idx on feedback (resolved, created_at desc);

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();
create trigger transactions_touch before update on transactions
  for each row execute function touch_updated_at();
