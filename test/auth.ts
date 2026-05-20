/**
 * Sequential auth + profile + API key flow against the running hosted-gateway
 * stack. Mirrors cipherdolls/core/test/auth.ts shape: one `describeAuth()` that
 * exercises each persona end-to-end, with state shared across `it()` blocks
 * via module-level `let` bindings.
 *
 * What this covers:
 *   - Email + password signup (with verification token echoed back in dev/test).
 *   - Email verification → account activation → 50 xBZZ welcome grant credited.
 *   - JWT-authed /users/me and /accounts/me reads.
 *   - API key creation, listing, JWT-or-key auth interchange, deletion.
 *   - /api-keys returns the persona's keys only.
 *   - Login round-trip returns a fresh JWT for the same user.
 */
import { describe, it, expect } from 'bun:test';
import {
  api,
  get,
  post,
  del,
  auth,
  signupEmail,
  verifyEmail,
  loginEmail,
  createApiKey,
  waitForQueuesEmpty,
} from './helpers';

const WELCOME_XBZZ_WEI = (50n * 10n ** 18n).toString();

export function describeAuth(): void {
  describe('auth + profile + api-keys (e2e)', () => {

    /* ── Alice: full signup → verify → welcome grant ────────────── */

    it('signs up Alice via email/password', async () => {
      const email = `alice-${Date.now()}@hosted.test`;
      const password = 'correct-horse-battery-staple';
      const { jwt, userId, verificationToken } = await signupEmail(email, password);
      expect(jwt).toBeTruthy();
      expect(userId).toBeTruthy();
      expect(verificationToken).toBeTruthy();
      auth.alice = { email, password, jwt, userId };
      (auth.alice as any).verificationToken = verificationToken;
    });

    it('Alice can read /users/me with the issued JWT (email unverified)', async () => {
      const { status, body } = await get('/users/me', auth.alice.jwt!);
      expect(status).toBe(200);
      expect(body).toMatchObject({
        id: auth.alice.userId,
        email: auth.alice.email,
        role: 'USER',
        emailVerified: false,
        authProvider: 'email',
      });
    });

    it('Alice has no welcome grant yet (account pending email verify)', async () => {
      await waitForQueuesEmpty();
      const { status, body } = await get('/accounts/me', auth.alice.jwt!);
      expect(status).toBe(200);
      expect(body.balanceXbzzWei).toBe('0');
      expect(body.reservedXbzzWei).toBe('0');
    });

    it('Alice verifies her email → balance credited with 50 xBZZ', async () => {
      const token = (auth.alice as any).verificationToken as string;
      await verifyEmail(token);
      await waitForQueuesEmpty();

      const { status, body } = await get('/accounts/me', auth.alice.jwt!);
      expect(status).toBe(200);
      expect(body.balanceXbzzWei).toBe(WELCOME_XBZZ_WEI);
      expect(body.reservedXbzzWei).toBe('0');
      expect(body.availableXbzzWei).toBe(WELCOME_XBZZ_WEI);

      const me = await get('/users/me', auth.alice.jwt!);
      expect(me.body.emailVerified).toBe(true);
    });

    it('Alice can list her ledger and see the welcomeGrant row', async () => {
      const { status, body } = await get('/accounts/me/ledger', auth.alice.jwt!);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].kind).toBe('welcomeGrant');
      expect(body[0].deltaXbzzWei).toBe(WELCOME_XBZZ_WEI);
    });

    /* ── API keys ─────────────────────────────────────────────── */

    it('Alice creates an API key', async () => {
      const { id, key } = await createApiKey(auth.alice.jwt!, 'alice-key');
      expect(id).toBeTruthy();
      expect(key.startsWith('t4t-live-')).toBe(true);
      auth.alice.apiKey = key;
      auth.alice.apiKeyId = id;
    });

    it('Alice can read /users/me with her API key (no JWT)', async () => {
      const { status, body } = await get('/users/me', auth.alice.apiKey);
      expect(status).toBe(200);
      expect(body.id).toBe(auth.alice.userId);
    });

    it('Alice lists /api-keys and sees only her key', async () => {
      const { status, body } = await get('/api-keys', auth.alice.jwt!);
      expect(status).toBe(200);
      expect(body.length).toBe(1);
      expect(body[0].id).toBe(auth.alice.apiKeyId);
      expect(body[0].name).toBe('alice-key');
      // Secret value is never echoed after creation.
      expect(body[0].key).toBeUndefined();
    });

    /* ── Bob: isolation ───────────────────────────────────────── */

    it('Bob signs up, verifies, and gets his own welcome grant', async () => {
      const email = `bob-${Date.now()}@hosted.test`;
      const password = 'tr0ub4dor&3';
      const signup = await signupEmail(email, password);
      await verifyEmail(signup.verificationToken);
      await waitForQueuesEmpty();
      const { id: apiKeyId, key: apiKey } = await createApiKey(signup.jwt, 'bob-key');
      auth.bob = {
        email,
        password,
        jwt: signup.jwt,
        userId: signup.userId,
        apiKey,
        apiKeyId,
      };

      const accountRes = await get('/accounts/me', signup.jwt);
      expect(accountRes.body.balanceXbzzWei).toBe(WELCOME_XBZZ_WEI);
    });

    it("Bob cannot see Alice's API keys", async () => {
      const { status, body } = await get('/api-keys', auth.bob.jwt!);
      expect(status).toBe(200);
      expect(body.length).toBe(1);
      expect(body[0].id).toBe(auth.bob.apiKeyId);
    });

    it("Bob cannot delete Alice's API key", async () => {
      const { status } = await del(`/api-keys/${auth.alice.apiKeyId}`, auth.bob.jwt!);
      expect(status).toBe(404);
    });

    /* ── Login round-trip ─────────────────────────────────────── */

    it('Alice logs in with email + password and gets a fresh JWT', async () => {
      const { jwt, userId } = await loginEmail(auth.alice.email!, auth.alice.password!);
      expect(userId).toBe(auth.alice.userId);
      // The new JWT still resolves to the same user.
      const { status, body } = await get('/users/me', jwt);
      expect(status).toBe(200);
      expect(body.id).toBe(auth.alice.userId);
    });

    it('login with wrong password is rejected', async () => {
      const { status } = await post('/auth/email/login', {
        email: auth.alice.email,
        password: 'WRONG',
      });
      expect(status).toBe(401);
    });

    it('signup with an existing email is rejected (409)', async () => {
      const { status } = await post('/auth/email/signup', {
        email: auth.alice.email,
        password: 'another-password-123',
      });
      expect(status).toBe(409);
    });

    /* ── Unauthed access ──────────────────────────────────────── */

    it('rejects /users/me with no token (401)', async () => {
      const { status } = await api('GET', '/users/me');
      expect(status).toBe(401);
    });

    it('rejects /accounts/me with garbage token (401)', async () => {
      const { status } = await get('/accounts/me', 'not-a-real-token');
      expect(status).toBe(401);
    });

    /* ── Key deletion ─────────────────────────────────────────── */

    it('Alice can delete her API key, and it stops working', async () => {
      const del1 = await del(`/api-keys/${auth.alice.apiKeyId}`, auth.alice.jwt!);
      expect(del1.status).toBe(200);

      const meAfter = await get('/users/me', auth.alice.apiKey);
      expect(meAfter.status).toBe(401);

      // JWT still works — we only revoked the key.
      const meJwt = await get('/users/me', auth.alice.jwt!);
      expect(meJwt.status).toBe(200);
    });
  });
}
