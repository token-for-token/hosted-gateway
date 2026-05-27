import Elysia from 'elysia';
import { Bee } from '@ethersphere/bee-js';
import { jwtGuard } from '../auth/jwt';
import { env } from '../env';
import { logger } from '../logger';

const bee = new Bee(env.BEE_API_URL);

function settled<T, U>(p: Promise<T>, map: (v: T) => U): Promise<U | null> {
  return p.then(map).catch((err) => {
    logger.warn({ err: (err as Error).message }, 'bee stats field failed');
    return null;
  });
}

export const beeRoutes = new Elysia({ prefix: '/bee' })
  .use(jwtGuard)
  .get('/stats', async () => {
    const [health, addresses, topology, wallet, stamps, chain] = await Promise.all([
      settled(bee.getHealth(), (h) => ({
        status: h.status,
        version: h.version,
        apiVersion: h.apiVersion,
      })),
      settled(bee.getNodeAddresses(), (a) => ({
        overlay: a.overlay.toString(),
        ethereum: a.ethereum.toString(),
        publicKey: a.publicKey.toString(),
        pssPublicKey: a.pssPublicKey.toString(),
        underlay: a.underlay,
      })),
      settled(bee.getTopology(), (t) => ({
        connected: t.connected,
        population: t.population,
        depth: t.depth,
        reachability: t.reachability,
        networkAvailability: t.networkAvailability,
      })),
      settled(bee.getWalletBalance(), (w) => ({
        bzz: w.bzzBalance.toDecimalString(),
        xdai: w.nativeTokenBalance.toDecimalString(),
        walletAddress: w.walletAddress,
        chainID: w.chainID,
      })),
      settled(bee.getAllPostageBatch(), (batches) =>
        batches.map((b) => ({
          batchID: b.batchID.toString(),
          label: b.label,
          depth: b.depth,
          amount: b.amount,
          usable: b.usable,
          usageText: b.usageText,
          durationDays: b.duration.toDays(),
        })),
      ),
      settled(bee.getChainState(), (c) => ({
        block: c.block,
        chainTip: c.chainTip,
        currentPrice: c.currentPrice,
      })),
    ]);

    return { health, addresses, topology, wallet, stamps, chain };
  });
