import crypto from 'crypto';

let token: string | null = null;

export function initAuthToken(): string {
  const envToken = process.env.ZEUS_AUTH_TOKEN;
  if (envToken) {
    token = envToken;
    console.log('[Zeus] Auth token loaded from ZEUS_AUTH_TOKEN');
  } else {
    token = crypto.randomBytes(16).toString('hex');
    console.log(`[Zeus] Auth token auto-generated: ${token}`);
  }
  return token;
}

export function getAuthToken(): string {
  if (!token) {
    throw new Error('Auth token not initialized — call initAuthToken() first');
  }
  return token;
}

export function validateToken(candidate: string): boolean {
  if (!token) return false;

  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
