-- Текущие остатки нескольких счетов одним запросом.
--
-- Раньше API забирал из базы историю остатков нужных счетов и оставлял в коде по одной
-- последней строке. Объём такого ответа растёт с каждой операцией, а сверх 1000 строк
-- PostgREST его обрезает. Здесь на каждый счёт — одно обращение к индексу
-- (account_id, seq desc) за верхней строкой, сколько бы истории ни накопилось.
--
-- Первая версия делала то же через DISTINCT ON — и на 30 000 строк истории оказалась
-- медленнее старого подхода: DISTINCT ON просматривает всю историю счёта, а не берёт
-- верхнюю строку индекса. Замер — в integration_documentation.md, раздел «Оптимизация».
create or replace function current_balances(p_account_ids uuid[])
returns table (account_id uuid, balance numeric)
language sql stable security invoker as $$
  select ids.id,
         (select b.balance from account_balances b
           where b.account_id = ids.id
           order by b.seq desc
           limit 1)
    from unnest(p_account_ids) as ids(id);
$$;
