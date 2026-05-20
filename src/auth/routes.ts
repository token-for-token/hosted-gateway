import Elysia, { t } from 'elysia';
import argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { prisma, model } from '../db';
import { signToken } from './jwt';
import { verifyGoogleIdToken } from './google';
import { logger } from '../logger';

const ECHO_VERIFICATION_TOKEN = process.env.NODE_ENV !== 'production';

export const authRoutes = new Elysia({ prefix: '/auth' })
  .post(
    '/google',
    async ({ body, set }) => {
      const profile = await verifyGoogleIdToken(body.idToken).catch((err) => {
        logger.warn({ err: err.message }, 'google id token verification failed');
        set.status = 401;
        throw new Error('Invalid Google id token');
      });

      // Upsert user
      let user = await prisma.user.findUnique({ where: { googleSub: profile.sub } });
      if (!user) {
        // Use model.user.create so the user.created queue job fires (which
        // triggers wallet/account creation + welcome grant).
        user = await model.user.create({
          data: {
            email: profile.email,
            emailVerified: profile.emailVerified,
            authProvider: 'google',
            googleSub: profile.sub,
          },
        });
      }

      return {
        token: signToken({ userId: user.id, role: user.role, email: user.email }),
        user: { id: user.id, email: user.email, role: user.role },
      };
    },
    {
      body: t.Object({ idToken: t.String() }),
    },
  )

  .post(
    '/email/signup',
    async ({ body, set }) => {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) {
        set.status = 409;
        throw new Error('Email already registered');
      }
      const passwordHash = await argon2.hash(body.password);
      const verificationToken = randomBytes(32).toString('hex');
      const user = await model.user.create({
        data: {
          email: body.email,
          emailVerified: false,
          authProvider: 'email',
          passwordHash,
          verificationToken,
        },
      });

      // TODO Phase 1.5: real outbound mailer. In dev/test we echo the token
      // back so the client (or test harness) can finish the flow synchronously.
      logger.info(
        { userId: user.id, echoed: ECHO_VERIFICATION_TOKEN },
        'email signup — verification token issued',
      );

      return {
        token: signToken({ userId: user.id, role: user.role, email: user.email }),
        user: { id: user.id, email: user.email, role: user.role, emailVerified: false },
        verificationToken: ECHO_VERIFICATION_TOKEN ? verificationToken : undefined,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
      }),
    },
  )

  .post(
    '/email/verify',
    async ({ body, set }) => {
      const user = await prisma.user.findUnique({
        where: { verificationToken: body.token },
      });
      if (!user) {
        set.status = 400;
        throw new Error('Invalid or expired verification token');
      }
      if (user.emailVerified) {
        return { ok: true, alreadyVerified: true };
      }
      // Flip via model.user.update so the user.updated job fires; the accounts
      // processor watches the `emailVerified` field and credits the welcome
      // grant when it flips false → true.
      await model.user.update(
        {
          where: { id: user.id },
          data: { emailVerified: true, verificationToken: null },
        },
        user,
      );
      return { ok: true };
    },
    { body: t.Object({ token: t.String() }) },
  )

  .post(
    '/email/login',
    async ({ body, set }) => {
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user || !user.passwordHash) {
        set.status = 401;
        throw new Error('Invalid credentials');
      }
      const ok = await argon2.verify(user.passwordHash, body.password);
      if (!ok) {
        set.status = 401;
        throw new Error('Invalid credentials');
      }
      return {
        token: signToken({ userId: user.id, role: user.role, email: user.email }),
        user: { id: user.id, email: user.email, role: user.role, emailVerified: user.emailVerified },
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String(),
      }),
    },
  );
