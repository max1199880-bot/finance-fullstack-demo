-- Функции базы: регистрация пользователя, остатки счетов и проводка операций.
--
-- Почему проводка живёт в базе, а не в коде API: операция меняет сразу несколько строк
-- (сама операция + остатки двух счетов + партии товара). В базе это одна транзакция:
-- либо применилось всё, либо ничего. Из кода пришлось бы делать несколько запросов,
-- и обрыв связи посередине оставил бы остатки расходящимися с операциями.

-- ── Регистрация: профиль и стартовый набор ──────────────────────────────────
-- Набор категорий, источников и счетов — тот же, что получает новый пользователь
-- действующего приложения. Без него новый аккаунт открывается пустым экраном.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  expense_names text[] := array['Продукты','Транспорт','Еда вне дома','Дом/связь','Развлечения','Покупки','Мед/спорт','Кредит'];
  source_names  text[] := array['Зарплата','Подработка','Прочее'];
  i integer;
begin
  insert into profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''));

  for i in 1 .. array_length(expense_names, 1) loop
    insert into categories (user_id, name, type, "order") values (new.id, expense_names[i], 'expense', i - 1);
  end loop;

  for i in 1 .. array_length(source_names, 1) loop
    insert into income_sources (user_id, name) values (new.id, source_names[i]);
  end loop;

  insert into accounts (user_id, name, type) values
    (new.id, 'Наличные', 'cash'),
    (new.id, 'Банк', 'bank');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Остаток счёта ───────────────────────────────────────────────────────────
-- Остаток — последняя по дате запись в истории. Так остаток и его история всегда
-- согласованы: одна запись и показывает текущее значение, и остаётся в графике.
create or replace function account_balance(p_account_id uuid) returns numeric
language sql stable security invoker as $$
  select coalesce(
    (select balance from account_balances
      where account_id = p_account_id
      order by date desc, id desc
      limit 1), 0);
$$;

-- Сдвинуть остаток счёта на delta, записав новую точку истории.
create or replace function bump_balance(p_account_id uuid, p_delta numeric, p_date timestamptz)
returns void language sql security invoker as $$
  insert into account_balances (account_id, date, balance)
  values (p_account_id, p_date, account_balance(p_account_id) + p_delta);
$$;

-- ── Проводка операции ───────────────────────────────────────────────────────
-- Единая точка записи: любая операция приложения проходит здесь.
-- Возвращает id записанной операции. Повтор с тем же client_tx_id ничего не пишет
-- и возвращает id уже сохранённой операции — так двойное нажатие и повтор из
-- офлайн-очереди не создают дубль.
create or replace function post_transaction(
  p_type             transaction_type,
  p_amount           numeric,
  p_date             timestamptz default now(),
  p_category_id      uuid default null,
  p_income_source_id uuid default null,
  p_from_account_id  uuid default null,
  p_to_account_id    uuid default null,
  p_linked_asset_id  uuid default null,
  p_principal_part   numeric default null,
  p_interest_part    numeric default null,
  p_comment          text default null,
  p_client_tx_id     text default null
) returns uuid
language plpgsql security invoker as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'AMOUNT_INVALID' using errcode = '22023';
  end if;

  -- Идемпотентность: повтор узнаём по ключу клиента и отдаём прежнюю операцию.
  if p_client_tx_id is not null then
    select id into v_id from transactions
     where user_id = v_user_id and client_tx_id = p_client_tx_id;
    if found then
      return v_id;
    end if;
  end if;

  insert into transactions (
    user_id, date, amount, type, category_id, income_source_id,
    from_account_id, to_account_id, linked_asset_id,
    principal_part, interest_part, comment, client_tx_id
  ) values (
    v_user_id, coalesce(p_date, now()), p_amount, p_type, p_category_id, p_income_source_id,
    p_from_account_id, p_to_account_id, p_linked_asset_id,
    p_principal_part, p_interest_part, nullif(btrim(coalesce(p_comment, '')), ''), p_client_tx_id
  )
  returning id into v_id;

  -- Деньги уходят со счёта-источника и приходят на счёт-получатель.
  -- Для кредита «приход» — это уменьшение долга, поэтому телу платежа соответствует
  -- отрицательная дельта: остаток долга на кредитном счёте убывает.
  if p_from_account_id is not null then
    perform bump_balance(p_from_account_id, -p_amount, coalesce(p_date, now()));
  end if;

  if p_to_account_id is not null then
    if p_type = 'credit_payment' then
      perform bump_balance(p_to_account_id, -coalesce(p_principal_part, p_amount), coalesce(p_date, now()));
    else
      perform bump_balance(p_to_account_id, p_amount, coalesce(p_date, now()));
    end if;
  end if;

  return v_id;
end;
$$;

-- ── Платёж по кредиту: сколько пойдёт в проценты, сколько в тело ────────────
-- Проценты за месяц = остаток долга × годовая ставка / 12. Остальное гасит тело.
create or replace function split_credit_payment(p_account_id uuid, p_amount numeric)
returns table (principal_part numeric, interest_part numeric)
language plpgsql stable security invoker as $$
declare
  v_debt numeric;
  v_rate numeric;
  v_interest numeric;
begin
  select account_balance(p_account_id), credit_rate into v_debt, v_rate
    from accounts where id = p_account_id;

  v_interest := round(coalesce(v_debt, 0) * coalesce(v_rate, 0) / 100 / 12, 2);
  -- Платёж меньше процентов: весь уходит в проценты, долг не уменьшается.
  if p_amount <= v_interest then
    return query select 0::numeric, p_amount;
  end if;
  -- Платёж больше остатка долга: лишнее не списываем, тело гасим ровно до нуля.
  if p_amount - v_interest > v_debt then
    return query select v_debt, p_amount - v_debt;
  end if;
  return query select p_amount - v_interest, v_interest;
end;
$$;
