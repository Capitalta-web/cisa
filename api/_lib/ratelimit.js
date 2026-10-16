// api/_lib/ratelimit.js
// Límite de peticiones. Si existen UPSTASH_REDIS_REST_URL/TOKEN usa Upstash (global);
// si no, cae a un contador en memoria por instancia (mejor esfuerzo).
'use strict';
const mem = new Map();

async function upstash(cmds) {
  const r = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('upstash ' + r.status);
  return r.json();
}

// true = permitido
async function hit(key, limit, windowSec) {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const k = `cisa-editor:rl:${key}`;
      const res = await upstash([['INCR', k], ['EXPIRE', k, String(windowSec), 'NX']]);
      return Number(res[0].result) <= limit;
    } catch (e) { console.warn('[ratelimit] upstash falló, usando memoria', e.message); }
  }
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.reset < now) { mem.set(key, { n: 1, reset: now + windowSec * 1000 }); return true; }
  e.n += 1;
  return e.n <= limit;
}

// Contador de fallos (bloqueo tras N intentos). count() lee sin incrementar.
async function count(key) {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try { const r = await upstash([['GET', `cisa-editor:rl:${key}`]]); return Number(r[0].result) || 0; } catch (e) { /* memoria */ }
  }
  const e = mem.get(key);
  return e && e.reset >= Date.now() ? e.n : 0;
}
async function reset(key) {
  mem.delete(key);
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try { await upstash([['DEL', `cisa-editor:rl:${key}`]]); } catch (e) { /* ignore */ }
  }
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

module.exports = { hit, count, reset, clientIp };
