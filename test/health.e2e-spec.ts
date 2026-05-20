import { describe, test, expect } from 'bun:test';
import { api } from './helpers';

describe('health', () => {
  test('GET /health returns ok', async () => {
    const res = await api('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
