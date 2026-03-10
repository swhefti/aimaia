import { cookies } from 'next/headers';
import * as crypto from 'crypto';

const ADMIN_SECRET = process.env['ADMIN_SECRET'] ?? '';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

interface TokenPayload {
  email: string;
  exp: number;
}

function sign(payload: TokenPayload): string {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token: string): TokenPayload | null {
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as TokenPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createAdminToken(email: string): string {
  return sign({ email, exp: Date.now() + TOKEN_TTL_MS });
}

export function verifyAdminSession(): TokenPayload | null {
  const cookieStore = cookies();
  const token = cookieStore.get('admin_session')?.value;
  if (!token) return null;
  return verify(token);
}

export function isValidAdminEmail(email: string): boolean {
  return email === 'shefti@gmail.com';
}
