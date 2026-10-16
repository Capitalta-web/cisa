// api/auth.js
// Login con usuario y contraseña para el editor en vivo.
//   POST /api/auth?accion=entrar  {usuario, contrasena} -> cookie de sesión HttpOnly (8 h)
//   GET  /api/auth?accion=sesion                       -> {ok, usuario}
//   POST /api/auth?accion=salir                        -> borra la sesión
// Variables: EDITOR_SESSION_SECRET, EDITOR_USERS (hashes scrypt; ver EDITOR.md)
'use strict';
const S = require('./_lib/session');
const RL = require('./_lib/ratelimit');

const IP_LIMIT = 20;        // intentos de login por IP / 15 min
const USER_LOCK_AFTER = 5;  // fallos por usuario antes de bloquear 15 min
const WINDOW = 900;
const GENERIC = 'Usuario o contraseña incorrectos.';

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 4096) throw Object.assign(new Error('payload'), { status: 413 }); }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const accion = url.searchParams.get('accion');
  try {
    if (accion === 'sesion' && req.method === 'GET') {
      const s = S.getSession(req);
      return json(res, 200, s ? { ok: true, usuario: s.sub, exp: s.exp } : { ok: false });
    }

    if (accion === 'entrar' && req.method === 'POST') {
      if (!S.sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido' });
      const ip = RL.clientIp(req);
      if (!(await RL.hit('login-ip:' + ip, IP_LIMIT, WINDOW))) return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      const body = await readJson(req);
      const usuario = String(body.usuario || '').trim().toLowerCase().slice(0, 60);
      const failKey = 'login-fail:' + usuario;
      const fails = await RL.count(failKey);
      if (fails >= USER_LOCK_AFTER) {
        // Bloqueo: misma respuesta genérica de "demasiados intentos", sin verificar la contraseña.
        return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      }
      const user = S.checkCredentials(usuario, body.contrasena);
      if (!user) {
        await RL.hit(failKey, 1e9, WINDOW);
        await sleep(Math.min(250 * 2 ** fails, 4000)); // backoff progresivo
        console.warn('[editor] login fallido', JSON.stringify(usuario), ip);
        return json(res, 401, { error: GENERIC });
      }
      await RL.reset(failKey);
      res.setHeader('Set-Cookie', S.sessionCookies(S.newSessionToken(user)));
      console.log('[editor] sesión iniciada', user, ip);
      return json(res, 200, { ok: true, usuario: user });
    }

    if (accion === 'salir' && req.method === 'POST') {
      if (!S.sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido' });
      res.setHeader('Set-Cookie', S.clearCookies());
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Acción no válida' });
  } catch (e) {
    console.error('[editor/auth]', e.message);
    return json(res, e.status || 500, { error: e.status && e.status < 500 ? e.message : 'Error del servidor' });
  }
};
module.exports.USER_LOCK_AFTER = USER_LOCK_AFTER;
