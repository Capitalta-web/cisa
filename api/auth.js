// api/auth.js
// Login por enlace mágico para el editor en vivo.
//   POST /api/auth?accion=solicitar  {email}   -> envía enlace (si el correo está permitido)
//   GET  /api/auth?accion=verificar&t=...&r=/ruta -> crea sesión (cookie HttpOnly) y redirige
//   GET  /api/auth?accion=sesion                -> {ok, email}
//   POST /api/auth?accion=salir                 -> borra la sesión
// Variables: EDITOR_SESSION_SECRET, EDITOR_ALLOWED_EMAILS, RESEND_API_KEY, EDITOR_EMAIL_FROM
'use strict';
const S = require('./_lib/session');
const RL = require('./_lib/ratelimit');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function safeReturn(r) {
  const v = String(r || '/');
  return /^\/(?!\/)[^\s\\]*$/.test(v) && v.length < 300 ? v : '/';
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 4096) throw Object.assign(new Error('payload'), { status: 413 }); }
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function sendMail(to, link) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EDITOR_EMAIL_FROM;
  if (!key || !from) throw Object.assign(new Error('Correo no configurado (RESEND_API_KEY / EDITOR_EMAIL_FROM)'), { status: 500 });
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [to],
      subject: 'Tu enlace para editar grupocisa',
      text: `Entra al editor con este enlace (vence en 15 minutos, un solo uso):\n\n${link}\n\nSi no lo pediste, ignora este correo.`,
    }),
  });
  if (!r.ok) throw Object.assign(new Error('No se pudo enviar el correo: ' + r.status), { status: 502 });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const accion = url.searchParams.get('accion');
  try {
    if (accion === 'sesion' && req.method === 'GET') {
      const s = S.getSession(req);
      return json(res, 200, s ? { ok: true, email: s.sub, exp: s.exp } : { ok: false });
    }

    if (accion === 'solicitar' && req.method === 'POST') {
      if (!S.sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido' });
      const ip = RL.clientIp(req);
      if (!(await RL.hit('login-ip:' + ip, 5, 900))) return json(res, 429, { error: 'Demasiados intentos, espera 15 minutos' });
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
      const ret = safeReturn(body.r);
      // Misma respuesta exista o no el correo (no revelar la lista permitida).
      if (S.isAllowed(email) && (await RL.hit('login-mail:' + email, 3, 900))) {
        const link = `https://${req.headers.host}/api/auth?accion=verificar&t=${encodeURIComponent(S.newLinkToken(email))}&r=${encodeURIComponent(ret)}`;
        await sendMail(email, link);
        console.log('[editor] enlace enviado', email);
      }
      return json(res, 200, { ok: true, mensaje: 'Si el correo está autorizado, te llegará un enlace.' });
    }

    if (accion === 'verificar' && req.method === 'GET') {
      const p = S.verify(url.searchParams.get('t'), 'link');
      if (!p || !(await RL.once(p.jti, S.LINK_TTL))) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('Enlace inválido, vencido o ya usado. Pide uno nuevo.');
      }
      res.setHeader('Set-Cookie', S.sessionCookies(S.newSessionToken(p.sub)));
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 302;
      res.setHeader('Location', safeReturn(url.searchParams.get('r')));
      console.log('[editor] sesión iniciada', p.sub);
      return res.end();
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
module.exports.safeReturn = safeReturn;
