-- Платёж по кредиту одной транзакцией базы.
--
-- Зачем отдельная функция, а не общая post_transaction: платёж записывается типом
-- «расход» (иначе он выпадет из расходов месяца и из плана/факта категории «Кредит»),
-- а для расхода общая функция начисляет сумму на счёт-получатель — то есть увеличила бы
-- долг на весь платёж. Здесь движение прописано явно: со счёта уходит весь платёж,
-- долг уменьшается только на тело. Раньше это делалось тремя запросами из кода, и обрыв
-- связи посередине мог оставить остаток долга расходящимся с операцией.
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

  -- Повтор (двойное нажатие, ретрай, офлайн-очередь) возвращает прежний платёж.
  if p_client_tx_id is not null then
    select id into v_id from transactions
     where user_id = v_user_id and client_tx_id = p_client_tx_id;
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
  -- Второй сдвиг на миллисекунду позже: остаток читается как последняя запись по дате,
  -- и при одинаковых отметках времени порядок двух записей был бы неопределённым.
  perform bump_balance(p_credit_account_id, -p_principal, coalesce(p_date, now()) + interval '1 millisecond');

  return v_id;
end;
$$;
