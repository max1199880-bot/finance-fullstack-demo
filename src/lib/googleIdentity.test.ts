// Nonce защищает вход через Google от повторного использования перехваченного ID-токена:
// Google кладёт в токен хеш, а Supabase сверяет его с хешем исходного значения.
// Если хеш посчитан не так, как у Supabase (SHA-256, hex), не войдёт никто.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNonce } from './googleIdentity';

describe('nonce для входа через Google', () => {
  it('хеш — SHA-256 исходного значения в hex, как проверяет Supabase', async () => {
    const { raw, hashed } = await createNonce();
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('каждый раз новый', async () => {
    const a = await createNonce();
    const b = await createNonce();
    expect(a.raw).not.toBe(b.raw);
  });
});
