// api/_lib/session.js
// Tokens firmados con HMAC-SHA256 (sin base de datos): enlace mágico y cookie de sesión.
'use strict';
const crypto = require('crypto');

const SESSION_COOKIE = 'cisa_sess';
const FLAG_COOKIE = 'cisa_ed'; // NO es secreta: solo le dice al loader que cargue editor.js
const SESSION_TTL = 8 * 60 * 60; // 8 h
const LINK_TTL = 15 * 60; // 15 min

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
  if (!isAllowed(p.sub)) return null; // quitar un correo de la lista revoca su sesión
  return p;
}

function allowlist() {
  return String(process.env.EDITOR_ALLOWED_EMAILS || '')
    .split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
function isAllowed(email) {
  return typeof email === 'string' && allowlist().includes(email.trim().toLowerCase());
}

function newLinkToken(email) {
  return sign({ typ: 'link', sub: email.toLowerCase(), jti: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + LINK_TTL });
}
function newSessionToken(email) {
  return sign({ typ: 'sess', sub: email.toLowerCase(), exp: Math.floor(Date.now() / 1000) + SESSION_TTL });
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
  sign, verify, isAllowed, allowlist, newLinkToken, newSessionToken, getSession,
  sessionCookies, clearCookies, parseCookies, sameOrigin, LINK_TTL, SESSION_TTL,
};
