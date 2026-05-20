// Phase 1 has no seed data — accounts are created on signup.
// Placeholder for future Config table (e.g. operator metadata) or test fixtures.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('No seed data to insert in v1.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
