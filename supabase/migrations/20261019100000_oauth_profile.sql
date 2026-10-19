-- Профиль для пользователей, пришедших через Google.
--
-- Регистрация по почте кладёт имя в user_metadata.display_name (его задаёт наша форма).
-- Google присылает имя в full_name / name и ссылку на аватар в avatar_url / picture.
-- Без этой миграции у вошедших через Google имя в профиле было бы пустым.

alter table profiles add column if not exists avatar_url text
  check (avatar_url is null or (avatar_url ~ '^https://' and length(avatar_url) <= 500));

alter table profiles add column if not exists auth_provider text not null default 'email';

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  expense_names text[] := array['Продукты','Транспорт','Еда вне дома','Дом/связь','Развлечения','Покупки','Мед/спорт','Кредит'];
  source_names  text[] := array['Зарплата','Подработка','Прочее'];
  avatar text := coalesce(meta ->> 'avatar_url', meta ->> 'picture');
  i integer;
begin
  insert into profiles (id, display_name, avatar_url, auth_provider)
  values (
    new.id,
    -- Имя обрезаем: провайдер не обязан присылать короткое, а профиль показывается в шапке.
    left(nullif(btrim(coalesce(meta ->> 'display_name', meta ->> 'full_name', meta ->> 'name', '')), ''), 100),
    -- Только https и разумной длины: ссылку потом подставят в <img>, и javascript:
    -- или гигантская строка здесь не нужны.
    case when avatar ~ '^https://' and length(avatar) <= 500 then avatar end,
    coalesce(new.raw_app_meta_data ->> 'provider', 'email')
  );

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
