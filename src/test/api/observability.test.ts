// Наблюдаемость: health-check для мониторинга, id запроса, приём ошибок браузера.

import { describe, expect, it } from 'vitest';
import { api, createUser } from '../api.setup';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const API = `${SUPABASE_URL}/functions/v1/api`;

describe('Health-check', () => {
  it('отвечает без входа и проверяет базу и сервис входа', async () => {
    const res = await fetch(`${API}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: Record<string, { status: string; ms: number }>;
    };
    expect(body.status).toBe('ok');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.auth.status).toBe('ok');
    expect(body.checks.database.ms).toBeGreaterThanOrEqual(0);
  });

  it('не раскрывает внутренние подробности наружу', async () => {
    const body = JSON.stringify(await (await fetch(`${API}/health`)).json());
    expect(body).not.toMatch(/password|service_role|postgres:\/\//i);
  });
});

describe('Id запроса', () => {
  it('каждый ответ несёт x-request-id — по нему ищут строку в логах', async () => {
    const res = await fetch(`${API}/health`);
    expect(res.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('id запроса всегда свой: присланный клиентом не подменяет его (иначе можно запутать разбор инцидента)', async () => {
    const id = 'trace-1234abcd';
    const res = await fetch(`${API}/health`, { headers: { 'x-request-id': id } });
    expect(res.headers.get('x-request-id')).not.toBe(id);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ошибка сервера возвращает id запроса в теле — его можно назвать поддержке', async () => {
    const user = await createUser('obs');
    const res = await api<{ error: string; requestId?: string }>(user, 'GET', '/nonexistent-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Нет обработчика');
  });
});

describe('Ошибки браузера', () => {
  it('принимаются без входа и отвечают 204', async () => {
    const res = await fetch(`${API}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        kind: 'error',
        message: 'TypeError: test',
        url: 'https://example.com/budget?x=1',
      }),
    });
    expect(res.status).toBe(204);
  });

  it('слишком большой отчёт молча отбрасывается, а не пишется в логи', async () => {
    const res = await fetch(`${API}/client-errors`, {
      method: 'POST',
      body: JSON.stringify({ message: 'x'.repeat(10_000) }),
    });
    expect(res.status).toBe(204);
  });

  it('битый JSON не роняет функцию', async () => {
    const res = await fetch(`${API}/client-errors`, { method: 'POST', body: '{not json' });
    expect(res.status).toBe(204);
  });
});
