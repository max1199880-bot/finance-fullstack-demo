-- Row Level Security: каждый видит и меняет только свои строки.
-- Политики действуют и для PostgREST, и для нашей Edge Function: она ходит в базу
-- с токеном пользователя, поэтому прав у неё ровно столько же, сколько у него.
-- Ключ service_role в браузер не попадает и в функции не используется.

alter table profiles             enable row level security;
alter table categories           enable row level security;
alter table income_sources       enable row level security;
alter table accounts             enable row level security;
alter table account_balances     enable row level security;
alter table asset_lots           enable row level security;
alter table transactions         enable row level security;
alter table budget_plan_month    enable row level security;
alter table budget_plan_global   enable row level security;
alter table net_worth_snapshots  enable row level security;
alter table feedback             enable row level security;

-- Профиль: свой читаем и правим, создаёт его триггер регистрации, удалять нельзя.
create policy profiles_select on profiles for select using (id = (select auth.uid()));
create policy profiles_update on profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Таблицы со своим user_id: одна политика на все действия.
-- using — какие строки видно; with check — какие можно записать, чтобы нельзя было
-- вписать чужой user_id и «подарить» строку другому пользователю.
do $$
declare t text;
begin
  foreach t in array array[
    'categories', 'income_sources', 'accounts', 'transactions',
    'budget_plan_month', 'budget_plan_global', 'net_worth_snapshots', 'feedback'
  ]
  loop
    execute format(
      'create policy %1$s_own on %1$s for all
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Таблицы без своего user_id: право наследуется от счёта-владельца.
create policy account_balances_own on account_balances for all
  using (exists (select 1 from accounts a where a.id = account_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from accounts a where a.id = account_id and a.user_id = (select auth.uid())));

create policy asset_lots_own on asset_lots for all
  using (exists (select 1 from accounts a where a.id = account_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from accounts a where a.id = account_id and a.user_id = (select auth.uid())));

-- Анонимной роли доступ к данным не нужен: без входа приложение показывает только экран входа.
revoke all on all tables in schema public from anon;
