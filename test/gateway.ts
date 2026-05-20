/**
 * Chat-completion end-to-end. This is the heaviest spec — requires the full
 * gateway profile (anvil fork + Bee + a registered t4t-provider + mock-ollama)
 * AND a funded operator wallet on the fork.
 *
 * If the upstream prerequisites (provider registration, xBZZ funding) haven't
 * been set up the test surfaces the actual failure mode — `no provider matches
 * model`, 503 on gateway-context boot, etc. — rather than green-washing.
 */
import { describe, it, expect } from 'bun:test';
import {
  api,
  get,
  post,
  auth,
  signupEmail,
  verifyEmail,
  createApiKey,
  waitForQueuesEmpty,
} from './helpers';

export function describeGateway(): void {
  describe('chat completions (e2e)', () => {

    it('signs Carol up + verifies + mints an API key', async () => {
      const email = `carol-${Date.now()}@hosted.test`;
      const signup = await signupEmail(email, 'a-strong-password-1234');
      await verifyEmail(signup.verificationToken);
      await waitForQueuesEmpty();
      const { id, key } = await createApiKey(signup.jwt, 'carol-key');
      auth.carol = {
        email,
        password: 'a-strong-password-1234',
        jwt: signup.jwt,
        userId: signup.userId,
        apiKey: key,
        apiKeyId: id,
      };
    });

    it('GET /v1/models lists the catalogue (may be empty until a provider registers)', async () => {
      const { status, body } = await get('/v1/models', auth.carol.apiKey);
      // Auth alone gets us a 200; whether the catalogue is empty depends on
      // whether the t4t-provider container had time to register before this
      // request fired.
      expect(status).toBe(200);
      expect(body).toHaveProperty('object', 'list');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST /v1/chat/completions returns a 200 with assistant content (mock-ollama)', async () => {
      // The mock-ollama always returns "pong (mock-ollama)" regardless of
      // input, so this assertion only verifies the route + on-chain settle
      // path, not LLM quality.
      const { status, body } = await post(
        '/v1/chat/completions',
        {
          model: 'qwen2.5:0.5b',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 32,
        },
        auth.carol.apiKey,
      );

      if (status !== 200) {
        // Surface the upstream error so we know what to fix: provider not
        // registered, gateway context boot failed, insufficient balance, etc.
        console.error(`chat completion failed: status=${status} body=${JSON.stringify(body)}`);
      }

      expect(status).toBe(200);
      expect(body).toHaveProperty('choices');
      expect(body.choices[0]?.message?.content).toMatch(/pong/);
    });

    it("debits Carol's balance after the JobClaimed watcher settles", async () => {
      // The on-chain claimJob fires from the provider after delivering. Our
      // worker's claimWatcher tails JobClaimed events and runs settleXbzz.
      // Poll for up to 30s.
      const deadline = Date.now() + 30_000;
      let balance = 50n * 10n ** 18n;
      while (Date.now() < deadline) {
        const { body } = await get('/accounts/me', auth.carol.jwt!);
        balance = BigInt(body.balanceXbzzWei);
        if (balance < 50n * 10n ** 18n) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      expect(balance).toBeLessThan(50n * 10n ** 18n);

      const ledger = await get('/accounts/me/ledger', auth.carol.jwt!);
      const settle = ledger.body.find((e: any) => e.kind === 'settle');
      expect(settle).toBeDefined();
      expect(BigInt(settle.deltaXbzzWei)).toBeLessThan(0n);
    });
  });
}
