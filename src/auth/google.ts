import { OAuth2Client } from 'google-auth-library';
import { env } from '../env';

const client = new OAuth2Client();

export interface GoogleProfile {
  sub: string;       // Google's stable user id
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

/**
 * Verifies a Google ID token (from the One Tap / Sign in with Google flow on
 * the client) and returns the verified profile. Throws on invalid token.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured');
  }
  const ticket = await client.verifyIdToken({
    idToken,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error('Google id token missing required claims');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
  };
}
