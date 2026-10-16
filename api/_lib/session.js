// api/_lib/session.js
// Tokens firmados con HMAC-SHA256 (sin base de datos): cookie de sesión; contraseñas con scrypt.
'use strict';
const crypto = require('crypto');

const SESSION_COOKIE = 'cisa_sess';
const FLAG_COOKIE = 'cisa_ed'; // NO es secreta: solo le dice al loader que cargue editor.js
const SESSION_TTL = 8 * 60 * 60; // 8 h

function secret() {
  const s = process.env.EDITOR_SESSION_SECRET;
  if (!s || s.length < 32) throw Object.assign(new Error('EDITOR_SESSION_SECRET no configurado (mín. 32 caracteres)'), { status: 500 });
  return s;
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${mac}`;
}

function verify(token, expectedType) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const good = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(mac); const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p.typ !== expectedType || typeof p.exp !== 'number' || p.exp < Date.now() / 1000) return null;
  if (!isAllowed(p.sub)) return null; // quitar un usuario de EDITOR_USERS revoca su sesión
  return p;
}

// EDITOR_USERS="usuario:scrypt$N$r$p$salt_b64$hash_b64,otro:scrypt$..."
// (generar con: npm run hash-password -- <usuario>)
const USER_RE = /^[a-z0-9._-]{2,40}$/;
function users() {
  const out = {};
  String(process.env.EDITOR_USERS || '').split(/[,\s]+/).filter(Boolean).forEach((entry) => {
    const i = entry.indexOf(':');
    if (i < 1) return;
    const u = entry.slice(0, i).toLowerCase();
    if (USER_RE.test(u)) out[u] = entry.slice(i + 1);
  });
  return out;
}
function isAllowed(user) {
  return typeof user === 'string' && Object.prototype.hasOwnProperty.call(users(), user.trim().toLowerCase());
}

const SCRYPT_DEFAULT = { N: 32768, r: 8, p: 1 };
function hashPassword(password, opts = SCRYPT_DEFAULT) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password).normalize('NFKC'), salt, 32, { N: opts.N, r: opts.r, p: opts.p, maxmem: 256 * opts.N * opts.r });
  return `scrypt$${opts.N}$${opts.r}$${opts.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
// Hash ficticio para gastar el mismo tiempo cuando el usuario no existe.
let DUMMY;
function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  let N, r, p, salt, hash;
  if (parts.length === 6 && parts[0] === 'scrypt') {
    [N, r, p] = parts.slice(1, 4).map(Number);
    salt = Buffer.from(parts[4], 'base64'); hash = Buffer.from(parts[5], 'base64');
  }
  const valid = N >= 16384 && N <= 1048576 && (N & (N - 1)) === 0 && r >= 1 && r <= 32 && p >= 1 && p <= 4 && salt && salt.length >= 16 && hash && hash.length >= 32;
  if (!valid) {
    DUMMY = DUMMY || hashPassword('x');
    verifyPassword(password, DUMMY);
    return false;
  }
  if (typeof password !== 'string' || password.length > 256) return false;
  const got = crypto.scryptSync(password.normalize('NFKC'), salt, hash.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  return crypto.timingSafeEqual(got, hash);
}
// Devuelve el usuario normalizado si las credenciales son válidas; si no, null.
function checkCredentials(user, password) {
  const u = String(user || '').trim().toLowerCase();
  const stored = USER_RE.test(u) ? users()[u] : undefined;
  const ok = verifyPassword(String(password == null ? '' : password), stored);
  return ok && stored ? u : null;
}

function newSessionToken(user) {
  return sign({ typ: 'sess', sub: String(user).toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function getSession(req) {
  return verify(parseCookies(req)[SESSION_COOKIE], 'sess');
}

function sessionCookies(token) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return [
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure}`,
    `${FLAG_COOKIE}=1; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL}${secure}`,
  ];
}
function clearCookies() {
  return [`${SESSION_COOKIE}=; Path=/; Max-Age=0`, `${FLAG_COOKIE}=; Path=/; Max-Age=0`];
}

// Defensa CSRF para POST: el Origin debe coincidir con el host.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

module.exports = {
  sign, verify, isAllowed, users, hashPassword, verifyPassword, checkCredentials, newSessionToken, getSession,
  sessionCookies, clearCookies, parseCookies, sameOrigin, SESSION_TTL,
};
