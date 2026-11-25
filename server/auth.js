// Admin authentication: scrypt password hashes, HMAC-signed session cookie,
// and a simple login rate limit. No extra dependencies.
import crypto from 'node:crypto';
import { Admin } from './models.js';

const COOKIE = 'admin_session';
const SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours
const isProd = process.env.NODE_ENV === 'production';

let SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET is not set: using a random one, so admins are signed out whenever the server restarts.');
}

// ---- Passwords ------------------------------------------------------------------
const scrypt = (pw, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
});

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'));
  const expected = Buffer.from(hash, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

// ---- Session token: "<adminId>.<version>.<expiresMs>.<hmac>" ----------------------
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function createToken(admin) {
  const payload = `${admin._id}.${admin.sessionVersion}.${Date.now() + SESSION_MS}`;
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  const [id, version, exp, sig] = parts;
  const expected = Buffer.from(sign(`${id}.${version}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (Number(exp) < Date.now()) return null;
  return { id, version: Number(version) };
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=')).filter((p) => p[0])
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

export function setSessionCookie(res, admin) {
  res.cookie(COOKIE, createToken(admin), {
    httpOnly: true, sameSite: 'strict', secure: isProd, maxAge: SESSION_MS, path: '/api/admin',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: isProd, path: '/api/admin' });
}

// Express middleware: loads req.admin or answers 401.
export async function requireAdmin(req, res, next) {
  try {
    const session = readToken(parseCookies(req.headers.cookie)[COOKIE]);
    const admin = session && /^[a-f0-9]{24}$/.test(session.id) ? await Admin.findById(session.id).lean() : null;
    if (!admin || admin.sessionVersion !== session.version) {
      return res.status(401).json({ error: 'Please sign in' });
    }
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}

// ---- Login rate limit: 8 failed attempts per IP per 15 minutes --------------------
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;

export function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) return true;
  return a.count < MAX_FAILS;
}
export function recordLoginFailure(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) attempts.set(ip, { count: 1, reset: Date.now() + WINDOW_MS });
  else a.count += 1;
}
export function clearLoginFailures(ip) {
  attempts.delete(ip);
}
