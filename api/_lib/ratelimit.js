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

// Marca un id como usado (enlace mágico de un solo uso). Solo con Upstash.
async function once(id, ttlSec) {
  if (!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)) {
    if (mem.has('once:' + id)) return false;
    mem.set('once:' + id, { n: 1, reset: Date.now() + ttlSec * 1000 });
    return true;
  }
  const res = await upstash([['SET', `cisa-editor:once:${id}`, '1', 'NX', 'EX', String(ttlSec)]]);
  return res[0].result === 'OK';
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

module.exports = { hit, once, clientIp };
