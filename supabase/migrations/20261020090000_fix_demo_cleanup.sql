-- Исправление ночной уборки демо (инцидент 20.10.2026).
--
-- Что случилось. Уборка удаляла всё, что создано позже «момента наполнения», а этим моментом
-- считалось время создания профиля. Но профиль создаёт триггер регистрации ДО того, как
-- скрипт наполнения кладёт данные. В первую же ночь (20.10, 00:00 UTC) уборка удалила все
-- демо-данные: категории, счета и 160 операций. /health при этом оставался зелёным —
-- база и сервис входа работали, пустым было только содержимое.
--
-- Исправление. Момент наполнения — явная отметка app_metadata.seeded_at, которую скрипт
-- seed:demo ставит ПОСЛЕ записи всех данных. Нет отметки — уборка ничего не удаляет:
-- лучше не убрать мусор, чем стереть демо.

create or replace function cleanup_demo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_seeded_at timestamptz;
  v_tx int; v_bal int; v_acc int; v_cat int; v_src int;
begin
  select u.id, (u.raw_app_meta_data ->> 'seeded_at')::timestamptz
    into v_user, v_seeded_at
    from auth.users u
   where coalesce((u.raw_app_meta_data ->> 'demo')::boolean, false)
   limit 1;

  if v_user is null then
    return jsonb_build_object('skipped', 'нет демо-пользователя');
  end if;
  if v_seeded_at is null then
    return jsonb_build_object('skipped', 'нет отметки seeded_at — уборка не знает, что считать исходными данными');
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

  return jsonb_build_object('seeded_at', v_seeded_at, 'transactions', v_tx, 'balances', v_bal,
                            'accounts', v_acc, 'categories', v_cat, 'income_sources', v_src);
end;
$$;

revoke all on function cleanup_demo() from public, anon, authenticated;

-- Отметку ставит сама база, по своим часам. Первая версия исправления ставила её часами
-- машины, запускающей скрипт, — и тест показал, что этого мало: часы базы спешили на ~60 мс,
-- строки получали created_at «позже» отметки, и уборка снова удаляла всё. Сравнивать можно
-- только время из одного источника.
create or replace function mark_demo_seeded(p_user uuid) returns timestamptz
language plpgsql security definer set search_path = public, auth as $$
declare
  v_at timestamptz := clock_timestamp();
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('demo', true, 'seeded_at', v_at)
   where id = p_user;
  return v_at;
end;
$$;

revoke all on function mark_demo_seeded(uuid) from public, anon, authenticated;
grant execute on function mark_demo_seeded(uuid) to service_role;
