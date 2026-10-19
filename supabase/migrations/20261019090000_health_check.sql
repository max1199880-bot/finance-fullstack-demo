-- Проверка живости базы для мониторинга.
--
-- Вызывается без входа (роль anon), поэтому функция ничего не читает из таблиц
-- и не принимает аргументов: она отвечает только на вопрос «база принимает запросы».
-- Время ответа самой базы тоже полезно мониторингу — по нему видно деградацию раньше,
-- чем ошибки.
create or replace function health_check() returns jsonb
language sql stable security invoker as $$
  select jsonb_build_object('db_time', now(), 'version', current_setting('server_version_num')::int);
$$;

revoke all on function health_check() from public;
grant execute on function health_check() to anon, authenticated;
