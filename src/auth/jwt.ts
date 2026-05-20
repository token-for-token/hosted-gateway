import jwt from 'jsonwebtoken';
import Elysia from 'elysia';
import { prisma } from '../db';
import { env } from '../env';
import type { UserRole } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  role: UserRole;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET_KEY, { expiresIn: '7d' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET_KEY) as JwtPayload;
}

function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

/**
 * Elysia plugin: resolves the authenticated user from a JWT or API key.
 * Throws 401 on missing or invalid credentials. Mirrors
 * cipherdolls/core/src/auth/jwt.ts (Bearer → JWT, then API-key fallback).
 */
export const jwtGuard = new Elysia({ name: 'jwtGuard' }).derive(
  { as: 'scoped' },
  async ({ headers, set }) => {
    const token = extractBearer(headers.authorization);
    if (!token) {
      set.status = 401;
      throw new Error('Missing authorization token');
    }

    // Try JWT first
    try {
      const payload = verifyToken(token);
      return { user: payload };
    } catch {
      // not a valid JWT — fall through
    }

    // Try API key (matches against the raw `t4t-live-<uuid>` value)
    const stripped = token.startsWith('t4t-live-') ? token.slice('t4t-live-'.length) : token;
    const apiKey = await prisma.apiKey.findUnique({
      where: { key: stripped },
      include: { user: true },
    });

    if (!apiKey) {
      set.status = 401;
      throw new Error('Invalid authorization token');
    }

    // Touch lastUsedAt; fire-and-forget.
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    return {
      user: {
        userId: apiKey.user.id,
        role: apiKey.user.role,
        email: apiKey.user.email,
      } satisfies JwtPayload,
    };
  },
);
