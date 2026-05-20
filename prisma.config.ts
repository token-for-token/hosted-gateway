// Prisma 7 config. Replaces the old `datasource.url` field in
// prisma/schema.prisma and the `package.json#prisma` key. See
// https://pris.ly/d/config-datasource.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: 'bun run prisma/seed/index.ts',
  },
});
