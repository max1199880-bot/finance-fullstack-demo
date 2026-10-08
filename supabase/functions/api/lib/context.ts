// Контекст запроса: кто спрашивает и чем он ходит в базу.
//
// Ключевой приём безопасности: клиент базы создаётся с токеном самого пользователя,
// а не с ключом администратора. Поэтому любые ошибки в коде API не дают доступа
// к чужим строкам — их отсекает RLS на уровне Postgres. Ключ service_role в этой
// функции не используется вообще.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';
import { HttpError, unauthorized } from './http.ts';

export interface Profile {
  id: string;
  display_name: string | null;
  currency: string;
  month_start_day: number;
  timezone: string;
  reminders_enabled: boolean;
  onboarding_completed: boolean;
}

export interface Ctx {
  req: Request;
  url: URL;
  origin: string | null;
  params: Record<string, string>;
  userId: string;
  db: SupabaseClient;
  /** Профиль загружается один раз на запрос: он нужен почти везде (день начала месяца). */
  profile(): Promise<Profile>;
}

export async function buildContext(
  req: Request,
  url: URL,
  params: Record<string, string>,
): Promise<Ctx> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw unauthorized();

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw unauthorized();

  let cached: Profile | null = null;
  return {
    req,
    url,
    origin: req.headers.get('Origin'),
    params,
    userId: data.user.id,
    db,
    async profile() {
      if (cached) return cached;
      const { data: p, error: e } = await db
        .from('profiles')
        .select('id, display_name, currency, month_start_day, timezone, reminders_enabled, onboarding_completed')
        .eq('id', data.user!.id)
        .single();
      if (e || !p) throw new HttpError(500, 'Профиль пользователя не найден');
      cached = p as Profile;
      return cached;
    },
  };
}
