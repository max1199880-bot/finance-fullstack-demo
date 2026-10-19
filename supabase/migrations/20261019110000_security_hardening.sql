-- Исправления по аудиту безопасности (security_audit.md). Номера находок — в комментариях.

-- ── B-3. Гонка в остатках ───────────────────────────────────────────────────
-- Текущий остаток — последняя ЗАПИСАННАЯ строка журнала, а не последняя по дате.
-- Дата строки — момент начала запроса, а не записи: запрос, начавшийся раньше, но
-- дождавшийся блокировки позже, писал строку с более ранней датой, и выбор «по дате»
-- терял его изменение. Порядковый номер растёт строго в порядке записи. Дата остаётся
-- для истории и графиков капитала.
alter table account_balances add column seq bigint generated always as identity;
create index account_balances_seq_idx on account_balances (account_id, seq desc);

create or replace function account_balance(p_account_id uuid) returns numeric
language sql stable security invoker as $$
  select coalesce(
    (select balance from account_balances
      where account_id = p_account_id
      order by seq desc
      limit 1), 0);
$$;

-- bump_balance читал последний остаток и дописывал новый без блокировки. Восемь
-- параллельных доходов по 100 ₽ давали +300 вместо +800: каждый читал одно и то же
-- старое значение. Такое случается и без злого умысла — при досылке офлайн-очереди.
-- Блокировка строки счёта выстраивает сдвиги одного счёта в очередь; разные счета
-- друг друга не ждут.
-- FOR NO KEY UPDATE, а не FOR UPDATE: он не конфликтует с блокировкой внешнего ключа,
-- которую берёт вставка операции, ссылающейся на этот счёт. С FOR UPDATE два параллельных
-- запроса ловили взаимную блокировку — это нашёл регрессионный тест по логу с request_id.
create or replace function bump_balance(p_account_id uuid, p_delta numeric, p_date timestamptz)
returns void language plpgsql security invoker as $$
begin
  perform 1 from accounts where id = p_account_id for no key update;
  insert into account_balances (account_id, date, balance)
  values (p_account_id, p_date, account_balance(p_account_id) + p_delta);
end;
$$;

-- Проводка операции блокирует свои счета заранее и в порядке id (см. комментарий внутри).
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

  -- Счета операции блокируются ДО вставки и всегда в порядке id. Иначе два запроса
  -- взаимно блокировали друг друга: вставка операции берёт у счёта лёгкую блокировку
  -- внешнего ключа, а последующая блокировка для пересчёта остатка требовала её
  -- повысить — и оба ждали друг друга (deadlock). Порядок id нужен для встречных
  -- переводов: X→Y и Y→X иначе захватили бы счета в разном порядке.
  perform 1 from accounts
   where id in (p_from_account_id, p_to_account_id)
   order by id
   for no key update;

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

-- ── B-5. Длина текстовых полей ───────────────────────────────────────────────
-- Ограничения в базе, а не только в API: через PostgREST таблицы доступны напрямую,
-- и проверка в коде функции там не работает. Без них 3 МБ комментария занимали
-- квоту бесплатной базы, а имя такой длины роняло запрос с 500.
alter table transactions   add constraint comment_len      check (char_length(comment) <= 500);
alter table categories     add constraint name_len         check (char_length(name) between 1 and 60);
alter table categories     add constraint emoji_len        check (char_length(emoji) <= 16);
alter table income_sources add constraint name_len         check (char_length(name) between 1 and 60);
alter table income_sources add constraint emoji_len        check (char_length(emoji) <= 16);
alter table accounts       add constraint name_len         check (char_length(name) between 1 and 60);
alter table feedback       add constraint message_len      check (char_length(message) <= 2000);
alter table profiles       add constraint display_name_len check (char_length(display_name) <= 100);
-- B-9: ставка кредита в процентах годовых — в разумных пределах.
alter table accounts       add constraint credit_rate_range check (credit_rate is null or credit_rate between 0 and 999);

-- ── B-6. Ссылки только на свои строки ───────────────────────────────────────
-- Политики проверяли user_id самой строки, но не того, на что она ссылается: можно было
-- записать свою операцию с чужим счётом или категорией. Данные чужого человека при этом
-- не читались, но целостность нарушалась, и по ответу можно было узнать, существует ли
-- чужой id. Проверки выполняются с правами пользователя, поэтому чужая строка для них
-- просто не видна.
create or replace function owns_account(p_id uuid) returns boolean
language sql stable security invoker as $$
  select p_id is null or exists (select 1 from accounts where id = p_id);
$$;

create or replace function owns_category(p_id uuid) returns boolean
language sql stable security invoker as $$
  select p_id is null or exists (select 1 from categories where id = p_id);
$$;

create or replace function owns_income_source(p_id uuid) returns boolean
language sql stable security invoker as $$
  select p_id is null or exists (select 1 from income_sources where id = p_id);
$$;

-- Ограничительные (restrictive) политики добавляются к разрешающим через И:
-- строка должна пройти и проверку владельца, и проверку ссылок.
create policy transactions_refs_own_ins on transactions as restrictive for insert to authenticated
  with check (owns_category(category_id) and owns_income_source(income_source_id)
              and owns_account(from_account_id) and owns_account(to_account_id) and owns_account(linked_asset_id));
create policy transactions_refs_own_upd on transactions as restrictive for update to authenticated
  using (true)
  with check (owns_category(category_id) and owns_income_source(income_source_id)
              and owns_account(from_account_id) and owns_account(to_account_id) and owns_account(linked_asset_id));

create policy budget_refs_own_ins on budget_plan_month as restrictive for insert to authenticated
  with check (owns_category(category_id));
create policy budget_refs_own_upd on budget_plan_month as restrictive for update to authenticated
  using (true) with check (owns_category(category_id));

create policy accounts_refs_own_ins on accounts as restrictive for insert to authenticated
  with check (owns_account(linked_credit_account_id));
create policy accounts_refs_own_upd on accounts as restrictive for update to authenticated
  using (true) with check (owns_account(linked_credit_account_id));

-- ── B-13. Проверки в платеже по кредиту ─────────────────────────────────────
-- Функцию можно вызвать напрямую через /rest/v1/rpc, минуя проверки API. Чужие данные
-- она не задевает (RLS), но свои позволяла испортить отрицательным телом платежа.
create or replace function pay_credit(
  p_credit_account_id uuid,
  p_from_account_id   uuid,
  p_category_id       uuid,
  p_amount            numeric,
  p_principal         numeric,
  p_interest          numeric,
  p_date              timestamptz default now(),
  p_comment           text default null,
  p_client_tx_id      text default null
) returns uuid
language plpgsql security invoker as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 or p_principal < 0 or p_interest < 0
     or p_principal + p_interest <> p_amount then
    raise exception 'AMOUNT_INVALID' using errcode = '22023';
  end if;
  if not exists (select 1 from accounts where id = p_credit_account_id and type = 'credit') then
    raise exception 'CREDIT_NOT_FOUND' using errcode = '22023';
  end if;

  -- Те же правила блокировки, что в post_transaction: оба счёта заранее и в порядке id.
  perform 1 from accounts
   where id in (p_from_account_id, p_credit_account_id)
   order by id
   for no key update;

  if p_client_tx_id is not null then
    select id into v_id from transactions where user_id = v_user_id and client_tx_id = p_client_tx_id;
    if found then
      return v_id;
    end if;
  end if;

  insert into transactions (
    user_id, date, amount, type, category_id,
    from_account_id, to_account_id, principal_part, interest_part, comment, client_tx_id
  ) values (
    v_user_id, coalesce(p_date, now()), p_amount, 'expense', p_category_id,
    p_from_account_id, p_credit_account_id, p_principal, p_interest, p_comment, p_client_tx_id
  )
  returning id into v_id;

  perform bump_balance(p_from_account_id, -p_amount, coalesce(p_date, now()));
  perform bump_balance(p_credit_account_id, -p_principal, coalesce(p_date, now()) + interval '1 millisecond');
  return v_id;
end;
$$;

-- ── B-14. Профиль: менять можно только настройки ────────────────────────────
-- Политика разрешала обновлять профиль целиком, то есть и служебные поля
-- (способ входа, аватар). Теперь через PostgREST доступны только пользовательские настройки.
revoke update on profiles from authenticated;
grant update (month_start_day, reminders_enabled, onboarding_completed, timezone, currency, display_name)
  on profiles to authenticated;

-- ── B-1, B-2. Общий демо-аккаунт ────────────────────────────────────────────
-- Демо открыт всем по кнопке, поэтому один посетитель мог испортить его для остальных:
-- сменить пароль (и закрыть демо всем) или стереть счета purge-запросами.
-- Демо-пользователь помечен app_metadata.demo = true (ставит скрипт seed:demo);
-- эта пометка есть в его JWT и менять её может только сервер.

create or replace function is_demo() returns boolean
language sql stable security invoker as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'demo')::boolean, false);
$$;

-- Удаление в демо запрещено на уровне базы (API отвечает понятным 403 раньше,
-- это второй рубеж — на случай прямого запроса к PostgREST).
do $$
declare t text;
begin
  foreach t in array array['transactions', 'accounts', 'categories', 'income_sources', 'account_balances', 'asset_lots']
  loop
    execute format(
      'create policy %1$s_demo_no_delete on %1$s as restrictive for delete to authenticated using (not is_demo())', t);
  end loop;
end;
$$;

-- Пароль и почту демо-пользователя сменить нельзя: ни самому посетителю через Auth,
-- ни через админский API. Остальные обновления (время входа, токены) Auth делает
-- сам — их не трогаем. Чтобы сменить пароль демо, администратор сначала снимает
-- пометку demo.
-- Функция выполняется с правами того, кто обновляет строку (security invoker), и права
-- на неё у public не отзываются: обновления auth.users делает роль сервиса входа, и без
-- права на эту функцию у неё перестал бы работать любой вход.
create or replace function protect_demo_credentials() returns trigger
language plpgsql security invoker set search_path = public, auth as $$
begin
  if coalesce((old.raw_app_meta_data ->> 'demo')::boolean, false)
     and coalesce((new.raw_app_meta_data ->> 'demo')::boolean, false)
     and (new.encrypted_password is distinct from old.encrypted_password
          or new.email is distinct from old.email) then
    raise exception 'Пароль и почту демо-аккаунта изменить нельзя' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger protect_demo_credentials
  before update on auth.users
  for each row execute function protect_demo_credentials();

-- Ночная уборка демо: удаляет всё, что посетители добавили после наполнения.
-- Остатки хранятся журналом, поэтому достаточно удалить записи позже момента наполнения —
-- балансы сами возвращаются к исходным. Правки старых строк уборка не откатывает;
-- полностью восстановить демо можно командой npm run seed:demo.
create or replace function cleanup_demo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_seeded_at timestamptz;
  v_tx int; v_bal int; v_acc int; v_cat int; v_src int;
begin
  select u.id, p.created_at into v_user, v_seeded_at
    from auth.users u join profiles p on p.id = u.id
   where coalesce((u.raw_app_meta_data ->> 'demo')::boolean, false)
   limit 1;
  if v_user is null then
    return jsonb_build_object('skipped', 'нет демо-пользователя');
  end if;

  delete from transactions where user_id = v_user and created_at > v_seeded_at;
  get diagnostics v_tx = row_count;
  delete from account_balances b using accounts a
   where b.account_id = a.id and a.user_id = v_user and b.date > v_seeded_at;
  get diagnostics v_bal = row_count;
  delete from accounts where user_id = v_user and created_at > v_seeded_at;
  get diagnostics v_acc = row_count;
  delete from categories where user_id = v_user and created_at > v_seeded_at;
  get diagnostics v_cat = row_count;
  delete from income_sources where user_id = v_user and created_at > v_seeded_at;
  get diagnostics v_src = row_count;
  delete from feedback where user_id = v_user and created_at > v_seeded_at;

  return jsonb_build_object('transactions', v_tx, 'balances', v_bal, 'accounts', v_acc,
                            'categories', v_cat, 'income_sources', v_src);
end;
$$;

revoke all on function cleanup_demo() from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;
select cron.schedule('demo-cleanup', '0 0 * * *', 'select public.cleanup_demo()'); -- 03:00 МСК
