# Hosted T4T Gateway

Multi-tenant frontend for the [Token4Token](https://github.com/token-for-token/t4t) inference network. Users sign up with Google / email, get 50 free virtual xBZZ, and call OpenAI-compatible endpoints without touching a wallet, Bee node, or Gnosis RPC.

**Custody model:** one operator wallet handles all on-chain transactions and Swarm operations. Tenants are off-chain ledger entries denominated in xBZZ. Providers see one on-chain client address (the operator's), not per-tenant addresses.

See [docs in t4t/](https://github.com/token-for-token/t4t/blob/main/docs/proposal-centralized-gateway.md) for the wider design context.

## Stack

- Bun + Elysia (HTTP)
- viem (Gnosis Chain bindings) — shared with `t4t-container`
- bee-js (Swarm) — shared with `t4t-container`
- Prisma + Postgres (multi-tenant ledger)
- BullMQ + Redis (queues + distributed locks + operator-wallet nonce)

The gateway engine code (provider selection, chain I/O, PSS routing, ECIES envelope) is vendored from [`t4t/container/src/`](../t4t/container/src) into `src/t4t/`. See [src/t4t/VENDORED.md](src/t4t/VENDORED.md) for the drift policy.

## Quick start

```bash
cp .env.example .env
# fill in OPERATOR_PRIVATE_KEY, REGISTRY/ESCROW/XBZZ addresses, JWT_SECRET_KEY

docker compose up -d postgres redis bee
bun install
bunx prisma migrate deploy
bun run dev:api
# in another shell:
bun run dev:worker
```

## Layout

```
src/
  api.ts               # Elysia HTTP entry
  worker.ts            # BullMQ workers + claim watcher
  db.ts                # model.<entity> CUD wrappers (write + enqueue)
  env.ts               # zod-validated process.env
  auth/                # JWT, Google OAuth, email signup
  users/, accounts/, apiKeys/, pricing/, gateway/, chain/
  queue/               # connection, registry, lock, processor base, service
  t4t/                 # VENDORED from t4t-container
prisma/schema.prisma
test/                  # E2E specs
```
