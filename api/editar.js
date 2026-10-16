// api/editar.js
// Recibe cambios del editor en vivo y abre un PR en GitHub (vía GitHub App).
//   POST /api/editar  {pagina: "/desarrollos/itzae.html", cambios: [{id, html}], nota?}
// - Requiere sesión válida (cookie firmada) y Origin del mismo sitio.
// - Sanitiza cada texto (solo texto + b/strong/i/em/br, <a href> seguro y <span class>).
// - Reemplaza SOLO el contenido del nodo con ese data-edit usando parse5 y valida el resultado.
// - Los ids "global.*" se aplican en todos los .html que los contengan (menú/footer).
// - Nunca escribe en main: crea la rama edicion/<fecha>-<usuario> y un PR.
'use strict';
const S = require('./_lib/session');
const RL = require('./_lib/ratelimit');
const H = require('./_lib/html');
const GH = require('./_lib/github');

const MAX_BODY = 64 * 1024;
const MAX_CHANGES = 60;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/;

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') {
    if (JSON.stringify(req.body).length > MAX_BODY) throw new H.HttpError(413, 'Petición demasiado grande');
    return req.body;
  }
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > MAX_BODY) throw new H.HttpError(413, 'Petición demasiado grande'); }
  try { return JSON.parse(raw); } catch { throw new H.HttpError(400, 'JSON inválido'); }
}

// "/", "/desarrollos/itzae", "/desarrollos/itzae.html" -> "desarrollos/itzae.html"
function normalizePage(p) {
  let v = String(p || '').split(/[?#]/)[0].replace(/^\/+/, '');
  if (!v || v.endsWith('/')) v += 'index.html';
  if (!v.endsWith('.html')) v += '.html';
  if (v.includes('..') || !/^[a-z0-9/_.-]+$/i.test(v)) throw new H.HttpError(400, 'Página inválida');
  return v;
}

// Valida y sanitiza el payload. Exportada para pruebas.
function prepare(body) {
  const pagina = normalizePage(body && body.pagina);
  const cambios = Array.isArray(body && body.cambios) ? body.cambios : [];
  if (!cambios.length) throw new H.HttpError(400, 'Sin cambios');
  if (cambios.length > MAX_CHANGES) throw new H.HttpError(413, `Máximo ${MAX_CHANGES} cambios por envío`);
  const local = {}; const global = {};
  for (const c of cambios) {
    const id = String(c && c.id || '');
    if (!ID_RE.test(id)) throw new H.HttpError(400, `id inválido: ${id.slice(0, 40)}`);
    if (typeof c.html !== 'string' || c.html.length > H.MAX_LEN * 2) throw new H.HttpError(413, `Texto inválido o muy largo en ${id}`);
    const clean = H.sanitize(c.html);
    if (!clean.replace(/<[^>]*>/g, '').trim()) throw new H.HttpError(400, `El texto de ${id} quedó vacío`);
    (id.startsWith('global.') ? global : local)[id] = clean;
  }
  const nota = String(body.nota || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500);
  return { pagina, local, global, nota };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido' });
  try {
    if (!S.sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'Se espera JSON' });
    const sess = S.getSession(req);
    if (!sess) return json(res, 401, { error: 'Sesión vencida, vuelve a entrar' });
    const user = sess.sub;
    if (!(await RL.hit('edit-user:' + user, 10, 3600)) || !(await RL.hit('edit-ip:' + RL.clientIp(req), 20, 3600))) {
      return json(res, 429, { error: 'Límite de envíos alcanzado (10 por hora). Intenta más tarde.' });
    }

    const { pagina, local, global, nota } = prepare(await readJson(req));
    const gh = await GH.client();
    const baseSha = await gh.baseSha();
    const files = await gh.listHtml(baseSha);
    const page = files.find((f) => f.path === pagina);
    if (!page) throw new H.HttpError(404, 'Página no encontrada en el repositorio');

    const changed = new Map(); // path -> contenido nuevo
    const pageHtml = await gh.readBlob(page.sha);
    const r1 = H.applyEdits(pageHtml, { ...local, ...global });
    const missing = Object.keys(local).filter((id) => !r1.applied.includes(id));
    if (missing.length) throw new H.HttpError(409, `Estos textos ya no existen en main: ${missing.join(', ')}`);
    if (r1.html !== pageHtml) changed.set(pagina, r1.html);

    if (Object.keys(global).length) {
      for (const f of files) {
        if (f.path === pagina) continue;
        const src = await gh.readBlob(f.sha);
        if (!Object.keys(global).some((id) => src.includes(`data-edit="${id}"`))) continue;
        const r = H.applyEdits(src, global);
        if (r.html !== src) changed.set(f.path, r.html);
      }
    }
    if (!changed.size) return json(res, 200, { ok: true, sinCambios: true, mensaje: 'No hubo diferencias contra main.' });

    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
    const who = user.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'editor';
    const branch = `edicion/${stamp}-${who}-${Math.random().toString(36).slice(2, 6)}`;
    const ids = [...Object.keys(local), ...Object.keys(global)];
    const body = [
      `Edición de textos desde el editor en vivo.`,
      '',
      `- **Quién:** ${user}`,
      `- **Cuándo:** ${new Date().toISOString()}`,
      `- **Página:** \`${pagina}\``,
      `- **Textos:** ${ids.map((i) => '`' + i + '`').join(', ')}`,
      `- **Archivos:** ${[...changed.keys()].map((p) => '`' + p + '`').join(', ')}`,
      nota ? `\n> ${nota}` : '',
      '',
      'Revisa la vista previa de Vercel de este PR antes de hacer merge. El merge publica en producción.',
    ].join('\n');
    const pr = await gh.openPr({
      branch,
      parentSha: baseSha,
      files: [...changed].map(([path, content]) => ({ path, content })),
      message: `Editor en vivo: ${ids.length} texto(s) en ${pagina}\n\nPor: ${user}`,
      title: `Edición de textos: ${pagina} (${user})`,
      body,
    });
    console.log('[editor] PR', pr.html_url, user, pagina, ids.join(','));
    return json(res, 200, { ok: true, pr: pr.html_url, rama: branch, archivos: [...changed.keys()] });
  } catch (e) {
    console.error('[editor/editar]', e.message);
    return json(res, e.status || 500, { error: e.status && e.status < 500 ? e.message : 'Error del servidor: ' + (e.status === 502 ? 'GitHub no respondió como se esperaba' : 'revisa la configuración') });
  }
};
module.exports.prepare = prepare;
module.exports.normalizePage = normalizePage;
