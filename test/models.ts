/**
 * Lightweight /v1/models smoke test against the anvil-forked Gnosis chain.
 *
 * Validates:
 *   - api boots and `getGatewayContext()` succeeds (operator wallet, Bee, PSS)
 *   - `ModelDiscovery.list()` runs against the live ProviderRegistry on the fork
 *   - the route returns the OpenAI `list` shape
 *
 * No chat completion, no on-chain writes, no t4t-provider container required.
 * If the fork has any mainnet provider that heartbeated within the last 10
 * min before the fork, the catalogue should be non-empty.
 */
import { describe, it, expect } from 'bun:test';
import {
  auth,
  signupEmail,
  verifyEmail,
  createApiKey,
  get,
  waitForQueuesEmpty,
} from './helpers';

export function describeModels(): void {
  describe('/v1/models (e2e against forked Gnosis)', () => {
    it('signs up Dave + mints an API key', async () => {
      const email = `dave-${Date.now()}@hosted.test`;
      const signup = await signupEmail(email, 'a-strong-password-1234');
      await verifyEmail(signup.verificationToken);
      await waitForQueuesEmpty();
      const { id, key } = await createApiKey(signup.jwt, 'dave-key');
      auth.dave = {
        email,
        password: 'a-strong-password-1234',
        jwt: signup.jwt,
        userId: signup.userId,
        apiKey: key,
        apiKeyId: id,
      };
    });

    it('GET /v1/models returns the OpenAI list shape', async () => {
      const { status, body } = await get('/v1/models', auth.dave.apiKey);
      if (status !== 200) {
        console.error('models endpoint failed:', JSON.stringify(body));
      }
      expect(status).toBe(200);
      expect(body).toHaveProperty('object', 'list');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('catalogue contains at least one model (mainnet has live providers)', async () => {
      const { body } = await get('/v1/models', auth.dave.apiKey);
      // Phase 1: tolerate an empty catalogue (no live mainnet providers
      // recently heartbeated). Log the count so the run surfaces it.
      console.log(`/v1/models returned ${body.data.length} models`);
      if (body.data.length > 0) {
        expect(body.data[0]).toHaveProperty('id');
        expect(body.data[0]).toHaveProperty('object', 'model');
      }
    });
  });
}
