# Vendored from t4t-container

These files are copied verbatim from
[`token-for-token/t4t`](https://github.com/token-for-token/t4t) at commit
**`f525b8bf93349dcaef2e234a6ad9e49871dcf12d`** (path:
`container/src/lib/*.ts`, `container/src/modes/gateway/{models,selector}.ts`).

The hosted gateway is a hosted multi-tenant frontend that uses the same chain
+ Swarm + PSS protocol. We reuse the engine code as a library; rewriting it
would invite drift, and a separate npm package is premature.

## Files vendored

```
src/t4t/lib/
├── abi.ts            # ProviderRegistry + JobEscrow + ERC20 ABIs
├── bzz-price.ts      # CoinGecko USD price (cosmetic display only)
├── chain.ts          # viem clients + read/write wrappers (postJob, claimJob, …)
├── crypto.ts         # ECIES (payload encryption)
├── envelope.ts       # PSS envelope sign/verify, topic derivation, dedup
├── keys.ts           # PSS keypair generation (secp256k1)
├── logger.ts         # ⚠️ LOCAL EDIT — re-exports project logger (see below)
├── stamps.ts         # operator-managed postage batch helpers
├── swarm.ts          # bee-js wrapper (chunks + PssTransport)
├── types.ts          # shared chain types
└── wallet.ts         # BIP39 / private-key helpers
src/t4t/modes/gateway/
├── models.ts         # ModelDiscovery (LRU-cached registry scan)
└── selector.ts       # selectProvider() — stateless, filters by model+price+rep
```

The `modes/gateway/` depth mirrors the upstream `container/src/modes/gateway/`
layout so the internal `import {…} from '../../lib/chain'` paths keep working
verbatim. **Don't flatten this** — it's the difference between zero edits to
vendored files and a maintenance burden on every sync.

## Files deliberately NOT vendored

| Source path | Reason |
|---|---|
| `lib/onboarding.ts`, `modes/gateway/admin.ts`, `modes/gateway/server.ts` | Replaced by Elysia signup + dashboard + routes. |
| `lib/jobs-db.ts` | Replaced by Prisma `GatewayJob` + `userId` tenant attribution. |
| `lib/job-index.ts` | Replaced by Postgres-backed `src/chain/jobIndex.ts`. |
| `lib/config.ts` | Replaced by `src/env.ts` + per-tenant rows. |
| `lib/admin-html.ts`, `lib/admin-stamps.ts` | Single-operator admin UI. |
| `lib/inference.ts` | Provider-side (not used by gateway). |
| `modes/gateway/index.ts` | `handleChat` is refactored into `src/gateway/handleChat.ts`. |

## Drift policy

- **No edits** to vendored files. The one explicit exception is `lib/logger.ts`
  (re-exports the project logger so vendored code shares the same pino
  instance). Any further required change must be filed upstream first.
- Re-sync upstream every two weeks:

  ```bash
  diff -ru ../t4t/container/src/lib/        src/t4t/lib/
  diff -ru ../t4t/container/src/modes/gateway/{models,selector}.ts \
           src/t4t/gateway/{models,selector}.ts
  ```

  Bump the SHA at the top of this file when re-syncing.
- If upstream renames or restructures these files, mirror the change here in the
  same commit that updates the SHA.
