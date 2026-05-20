import Elysia from 'elysia';
import { prisma } from '../db';
import { jwtGuard } from '../auth/jwt';

export const usersRoutes = new Elysia({ prefix: '/users' })
  .use(jwtGuard)
  .get('/me', async ({ user }) => {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        authProvider: true,
        country: true,
        createdAt: true,
      },
    });
    return row;
  });
