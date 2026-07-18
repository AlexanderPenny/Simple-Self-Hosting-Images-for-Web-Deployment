import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { q } from './db.js';

/* ------------------------------------------------------------------ *
 * Password hashing (scrypt, from Node's standard library)
 * Stored format: scrypt$N$r$p$<salt b64>$<key b64>
 * ------------------------------------------------------------------ */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Burn roughly the same CPU when the username does not exist, so response
// timing does not reveal which usernames are real.
const DUMMY_HASH = hashPassword(crypto.randomBytes(32).toString('hex'));
export function dummyVerify(password) {
  verifyPassword(password, DUMMY_HASH);
}

/* ------------------------------------------------------------------ *
 * Client IP resolution.
 *
 * Behind Cloudflare Tunnel the chain is:
 *   visitor -> Cloudflare edge -> cloudflared -> Caddy -> this app
 *
 * Every hop after the edge is local, so req.socket.remoteAddress is always
 * 127.0.0.1 and is useless for banning. Cloudflare sets CF-Connecting-IP at
 * the edge and overwrites any value the client supplied, which makes it the
 * one trustworthy source -- so long as the origin cannot be reached except
 * through the tunnel.
 * ------------------------------------------------------------------ */

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

function looksLikeIp(value) {
  if (typeof value !== 'string' || value.length > 45) return false;
  const v = value.trim();
  if (IPV4.test(v)) return v.split('.').every((o) => Number(o) <= 255);
  return v.includes(':') && IPV6.test(v);
}

export function clientIp(req) {
  if (config.trustCloudflare) {
    const cf = req.get('cf-connecting-ip');
    if (looksLikeIp(cf)) return cf.trim();
  }
  // Express has already applied `trust proxy` to produce req.ip.
  if (looksLikeIp(req.ip)) return req.ip;
  const stripped = String(req.ip || '').replace(/^::ffff:/, '');
  return looksLikeIp(stripped) ? stripped : '0.0.0.0';
}

/* ------------------------------------------------------------------ *
 * Auth logging — this file is what fail2ban watches.
 * ------------------------------------------------------------------ */

const authLog = fs.createWriteStream(config.authLogPath, { flags: 'a' });

function logAuth(event, ip, fields = {}) {
  const parts = [new Date().toISOString(), event, `ip=${ip}`];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(`${k}=${JSON.stringify(String(v))}`);
  }
  authLog.write(parts.join(' ') + '\n');
}

export const authEvents = {
  failed: (ip, username, reason) => logAuth('LOGIN_FAILED', ip, { user: username, reason }),
  success: (ip, username) => logAuth('LOGIN_OK', ip, { user: username }),
  throttled: (ip, username) => logAuth('LOGIN_THROTTLED', ip, { user: username }),
  forbidden: (ip, path) => logAuth('ADMIN_FORBIDDEN', ip, { path }),
};

/* ------------------------------------------------------------------ *
 * Sessions — server-side, stored in SQLite, opaque random cookie ID.
 * ------------------------------------------------------------------ */

export const SESSION_COOKIE = 'apimg_sid';

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function makeCookieValue(id) {
  return `${id}.${sign(id)}`;
}

function readCookieValue(raw) {
  if (typeof raw !== 'string') return null;
  const idx = raw.lastIndexOf('.');
  if (idx < 1) return null;
  const id = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = sign(id);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export function createSession(res, user, req) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  q.insertSession.run(
    id, user.id, now, now + config.sessionMaxAgeMs,
    clientIp(req), String(req.get('user-agent') || '').slice(0, 255)
  );
  res.cookie(SESSION_COOKIE, makeCookieValue(id), {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/images',
    maxAge: config.sessionMaxAgeMs,
  });
  return id;
}

export function destroySession(req, res) {
  const id = readCookieValue(req.cookies?.[SESSION_COOKIE]);
  if (id) q.deleteSession.run(id);
  res.clearCookie(SESSION_COOKIE, { path: '/images' });
}

export function currentUser(req) {
  const id = readCookieValue(req.cookies?.[SESSION_COOKIE]);
  if (!id) return null;
  const session = q.sessionById.get(id);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    q.deleteSession.run(id);
    return null;
  }
  const user = q.userById.get(session.user_id);
  if (!user || user.disabled) return null;
  return user;
}

/* ------------------------------------------------------------------ *
 * CSRF — double-submit token bound to the session cookie.
 * ------------------------------------------------------------------ */

export function csrfToken(req) {
  const sid = readCookieValue(req.cookies?.[SESSION_COOKIE]) || 'anonymous';
  return crypto.createHmac('sha256', config.sessionSecret).update(`csrf:${sid}`).digest('base64url');
}

export function checkCsrf(req) {
  const sent = req.body?._csrf || req.get('x-csrf-token') || '';
  const expected = csrfToken(req);
  const a = Buffer.from(String(sent));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * In-process login throttle. fail2ban is the real defence; this just
 * keeps a burst from costing a lot of scrypt CPU before the ban lands.
 * ------------------------------------------------------------------ */

const attempts = new Map();

export function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > config.loginWindowMs) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= config.loginMaxAttempts;
}

export function recordAttempt(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.first > config.loginWindowMs) {
    attempts.set(ip, { first: now, count: 1 });
  } else {
    rec.count += 1;
  }
}

export function clearAttempts(ip) {
  attempts.delete(ip);
}

setInterval(() => {
  const cutoff = Date.now() - config.loginWindowMs;
  for (const [ip, rec] of attempts) if (rec.first < cutoff) attempts.delete(ip);
}, 5 * 60 * 1000).unref();

/* ------------------------------------------------------------------ *
 * Route guard
 * ------------------------------------------------------------------ */

export function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    if (req.method !== 'GET') {
      authEvents.forbidden(clientIp(req), req.originalUrl);
      return res.status(403).json({ error: 'Not signed in.' });
    }
    return res.redirect('/images');
  }
  req.user = user;
  next();
}
