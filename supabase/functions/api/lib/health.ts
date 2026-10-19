// Проверка состояния для мониторинга: API, база и сервис входа.
//
// Ответ 200 — всё работает, 503 — что-то из зависимостей лежит. Мониторинг смотрит
// на код ответа, человек — на тело: в нём видно, что именно сломалось и сколько
// заняла каждая проверка. Данные пользователей здесь не затрагиваются, поэтому
// эндпоинт открыт без входа.

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

type CheckResult = { status: 'ok' | 'down'; ms: number; error?: string };

/** Проверка с ограничением по времени: зависшая зависимость не должна вешать сам health. */
async function timed(fn: () => Promise<void>, timeoutMs = 3000): Promise<CheckResult> {
  const started = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`таймаут ${timeoutMs} мс`)), timeoutMs)),
    ]);
    return { status: 'ok', ms: Date.now() - started };
  } catch (e) {
    return { status: 'down', ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * body — публичная часть: статус и время каждой проверки. Тексты ошибок (в них бывают
 * имена хостов и подробности базы) отдаются отдельно в errors — только для лога, наружу
 * не уходят: health открыт без входа, а мониторинг публикует ответ в публичном issue.
 */
export async function healthReport(): Promise<{
  httpStatus: number;
  body: Record<string, unknown>;
  errors: Record<string, string>;
}> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db = createClient(url, anon, { auth: { persistSession: false } });

  const [database, auth] = await Promise.all([
    timed(async () => {
      const { error } = await db.rpc('health_check');
      if (error) throw new Error(error.message);
    }),
    timed(async () => {
      const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await res.body?.cancel();
    }),
  ]);

  const healthy = database.status === 'ok' && auth.status === 'ok';
  const publicView = ({ status, ms }: CheckResult) => ({ status, ms });
  const errors = Object.fromEntries(
    Object.entries({ database, auth })
      .filter(([, c]) => c.error)
      .map(([name, c]) => [name, c.error!]),
  );
  return {
    httpStatus: healthy ? 200 : 503,
    errors,
    body: {
      status: healthy ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      // Версия выкладки: по ней видно, какой коммит сейчас на проде.
      version: Deno.env.get('APP_VERSION') ?? 'dev',
      checks: { database: publicView(database), auth: publicView(auth) },
    },
  };
}
