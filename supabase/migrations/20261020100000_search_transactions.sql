-- Поиск операций по тексту: комментарий операции ИЛИ название её категории/источника дохода.
--
-- Почему функция, а не фильтр PostgREST. Условие «по комментарию или по названию связанной
-- записи» нельзя выразить без .or(), а в строку .or() попадал бы текст пользователя:
-- запятая, скобка или кавычка в нём ломают разбор фильтра (и открывают лазейку для чужих
-- условий). Текст ищется здесь, как обычный параметр функции, — в синтаксис запроса он не
-- попадает. Остальные фильтры (период, тип, счёт, порядок, постраничность) API навешивает
-- сверху на результат функции, так что offset/limit работают в базе, а не в коде.
--
-- security invoker: функция выполняется с правами вызывающего, поэтому RLS на операциях,
-- категориях и источниках отсекает чужие строки так же, как при обычном чтении таблицы.
--
-- Подстановочные знаки в тексте экранируются: искать «50%» значит искать «50%», а не «50».
create or replace function search_transactions(p_query text)
returns setof transactions
language sql stable security invoker as $$
  select t.*
    from transactions t
   cross join lateral (
     select '%' || regexp_replace(p_query, '([\\%_])', '\\\1', 'g') || '%' as pattern
   ) q
   where t.comment ilike q.pattern
      or exists (select 1 from categories c where c.id = t.category_id and c.name ilike q.pattern)
      or exists (select 1 from income_sources s where s.id = t.income_source_id and s.name ilike q.pattern);
$$;
