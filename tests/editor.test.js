'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.env.EDITOR_SESSION_SECRET = 'x'.repeat(40);
const S0 = require('../api/_lib/session');
process.env.EDITOR_USERS = `ana:${S0.hashPassword('clave-de-prueba-123', { N: 16384, r: 8, p: 1 })},alberto:${S0.hashPassword('otra-clave-segura-456', { N: 16384, r: 8, p: 1 })}`;
const H = require('../api/_lib/html');
const S = require('../api/_lib/session');
const { prepare, normalizePage } = require('../api/editar');
const auth = require('../api/auth');

test('sanitize: quita scripts, atributos y etiquetas no permitidas', () => {
  assert.equal(H.sanitize('Hola <script>alert(1)</script><b onclick="x">mundo</b>'), 'Hola <b>mundo</b>');
  assert.equal(H.sanitize('<img src=x onerror=alert(1)>texto'), 'texto');
  assert.equal(H.sanitize('<div style="x">uno</div><div>dos</div>'), 'uno<br>dos');
  assert.equal(H.sanitize('a < b & c'), 'a &lt; b &amp; c');
  assert.equal(H.sanitize('<span class="accent" style="color:red">x</span>'), '<span class="accent">x</span>');
  assert.equal(H.sanitize('<span class="a&quot;b">x</span>'), 'x');
});

test('sanitize: href seguro', () => {
  assert.equal(H.sanitize('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(H.sanitize('<a href=" JaVaScRiPt:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(H.sanitize('<a href="data:text/html,hi">x</a>'), '<a>x</a>');
  assert.equal(H.sanitize('<a href="//evil.com">x</a>'), '<a>x</a>');
  assert.equal(H.sanitize('<a href="su-terreno.html#a">x</a>'), '<a href="su-terreno.html#a">x</a>');
  assert.equal(H.sanitize('<a href="https://wa.me/1">x</a>'), '<a href="https://wa.me/1" target="_blank" rel="noopener noreferrer">x</a>');
  assert.equal(H.safeHref('mailto:a@b.c'), 'mailto:a@b.c');
});

test('sanitize: límite de longitud', () => {
  assert.throws(() => H.sanitize('a'.repeat(H.MAX_LEN + 1)), /largo/);
});

const DOC = `<!doctype html><html><head><title>t</title></head><body>
<header class="site-header"><a data-edit="global.header.obra" href="d.html">Obra</a></header>
<main><h1 data-edit="p.hero.h1-1" class="x">Vender <span class="accent">es</span> una operación</h1>
<p data-edit="p.hero.p-1">Texto &amp; original</p><img src="a.png"><p>sin marcar</p></main>
<footer><a data-edit="global.header.obra" href="d.html">Obra</a></footer></body></html>`;

test('replaceNode: solo cambia el contenido del nodo, el resto queda idéntico', () => {
  const r = H.applyEdits(DOC, { 'p.hero.p-1': 'Nuevo <b>texto</b>' });
  assert.deepEqual(r.applied, ['p.hero.p-1']);
  assert.equal(r.html, DOC.replace('Texto &amp; original', 'Nuevo <b>texto</b>'));
});

test('replaceNode: id global reemplaza todas sus apariciones', () => {
  const r = H.replaceNode(DOC, 'global.header.obra', 'Proyectos');
  assert.equal(r.replaced, 2);
  assert.equal((r.html.match(/>Proyectos</g) || []).length, 2);
});

test('replaceNode: id inexistente no cambia nada', () => {
  assert.equal(H.applyEdits(DOC, { 'no.existe': 'x' }).html, DOC);
});

test('validate: rechaza inyección que rompe estructura', () => {
  // HTML sin sanitizar que intenta cerrar el nodo e inyectar otro data-edit
  assert.throws(() => H.applyEdits(DOC, { 'p.hero.p-1': 'x</p><p data-edit="p.hero.h1-1">y' }), /estructura|Conteo|esperaba/);
  assert.throws(() => H.applyEdits(DOC, { 'p.hero.p-1': '</p><script>alert(1)</script><p>' }), /esperaba/);
});

test('prepare: valida payload, separa globales y sanitiza', () => {
  const p = prepare({ pagina: '/desarrollos/itzae', cambios: [{ id: 'a.b', html: '<i>hola</i><script>x</script>' }, { id: 'global.footer.x', html: 'Pie' }] });
  assert.equal(p.pagina, 'desarrollos/itzae.html');
  assert.deepEqual(p.local, { 'a.b': '<i>hola</i>' });
  assert.deepEqual(p.global, { 'global.footer.x': 'Pie' });
  assert.throws(() => prepare({ pagina: '/', cambios: [] }), /Sin cambios/);
  assert.throws(() => prepare({ pagina: '/', cambios: [{ id: 'A"B', html: 'x' }] }), /id inválido/);
  assert.throws(() => prepare({ pagina: '/', cambios: [{ id: 'a', html: '<b></b>' }] }), /vacío/);
  assert.throws(() => normalizePage('/../.env'), /inválida/);
  assert.equal(normalizePage('/'), 'index.html');
});

test('sesión: firma, expiración, usuarios de EDITOR_USERS', () => {
  assert.ok(S.isAllowed('ALBERTO'));
  assert.ok(!S.isAllowed('otro'));
  const t = S.newSessionToken('ana');
  assert.equal(S.verify(t, 'sess').sub, 'ana');
  assert.equal(S.verify(t, 'link'), null);
  assert.equal(S.verify(t.slice(0, -2) + 'xx', 'sess'), null);
  assert.equal(S.verify(S.sign({ typ: 'sess', sub: 'ana', exp: 1 }), 'sess'), null);
  assert.equal(S.verify(S.sign({ typ: 'sess', sub: 'intruso', exp: 9e9 }), 'sess'), null);
});

test('contraseñas: scrypt, verificación y rechazo', () => {
  const h = S.hashPassword('mi clave larga 1', { N: 16384, r: 8, p: 1 });
  assert.match(h, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(h, S.hashPassword('mi clave larga 1', { N: 16384, r: 8, p: 1 })); // sal aleatoria
  assert.ok(S.verifyPassword('mi clave larga 1', h));
  assert.ok(!S.verifyPassword('mi clave larga 2', h));
  assert.ok(!S.verifyPassword('x', 'plaintext'));
  assert.ok(!S.verifyPassword('x', 'scrypt$2$1$1$AAAA$AAAA')); // parámetros débiles
  assert.equal(S.checkCredentials(' Ana ', 'clave-de-prueba-123'), 'ana');
  assert.equal(S.checkCredentials('ana', 'mala'), null);
  assert.equal(S.checkCredentials('nadie', 'clave-de-prueba-123'), null);
  assert.equal(S.checkCredentials('', ''), null);
});

function call(handler, { method = 'GET', url, body, headers = {} }) {
  return new Promise((resolve) => {
    const { Readable } = require('stream');
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method, url, headers: { host: 'sitio.test', origin: 'https://sitio.test', 'x-forwarded-for': headers.ip || '1.1.1.1', ...headers }, socket: {} });
    const h = {};
    const res = { statusCode: 200, setHeader: (k, v) => { h[k.toLowerCase()] = v; }, end: (b) => resolve({ status: res.statusCode, headers: h, body: b ? JSON.parse(b) : null }) };
    handler(req, res);
  });
}

test('api/auth: login correcto, error genérico, Origin y bloqueo por usuario', async () => {
  const ok = await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: 'ana', contrasena: 'clave-de-prueba-123' } });
  assert.equal(ok.status, 200);
  const cookies = ok.headers['set-cookie'].join(';');
  assert.match(cookies, /cisa_sess=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800/);
  const sess = await call(auth, { url: '/api/auth?accion=sesion', headers: { cookie: ok.headers['set-cookie'][0].split(';')[0] } });
  assert.deepEqual([sess.body.ok, sess.body.usuario], [true, 'ana']);

  const bad1 = await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: 'nadie', contrasena: 'x' }, headers: { ip: '2.2.2.2' } });
  const bad2 = await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: 'ana', contrasena: 'x' }, headers: { ip: '2.2.2.3' } });
  assert.equal(bad1.status, 401); assert.equal(bad2.status, 401);
  assert.equal(bad1.body.error, bad2.body.error); // no revela si el usuario existe

  const cross = await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: {}, headers: { origin: 'https://evil.test' } });
  assert.equal(cross.status, 403);

  for (let i = 1; i < auth.USER_LOCK_AFTER; i++) {
    await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: 'alberto', contrasena: 'mala' }, headers: { ip: `3.3.3.${i}` } });
  }
  await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: 'alberto', contrasena: 'mala' }, headers: { ip: '3.3.3.9' } });
  const locked = await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: 'alberto', contrasena: 'otra-clave-segura-456' }, headers: { ip: '3.3.4.1' } });
  assert.equal(locked.status, 429); // ni con la contraseña correcta, mientras dure el bloqueo
});

test('api/auth: límite por IP', async () => {
  let last;
  for (let i = 0; i < 21; i++) last = await call(auth, { method: 'POST', url: '/api/auth?accion=entrar', body: { usuario: `u${i}`, contrasena: 'x' }, headers: { ip: '9.9.9.9' } });
  assert.equal(last.status, 429);
});

test('páginas reales: todos los nodos marcados se pueden editar ida y vuelta', () => {
  const root = path.resolve(__dirname, '..');
  const pages = ['index.html', 'desarrollos/itzae.html', 'su-terreno.html', 'contenido/01-heredar-terreno-entre-hermanos.html'];
  for (const pg of pages) {
    const src = fs.readFileSync(path.join(root, pg), 'utf8');
    const ids = Object.keys(H.listIds(src));
    assert.ok(ids.length > 20, pg);
    for (const id of ids) {
      const r = H.applyEdits(src, { [id]: 'Prueba <b>ok</b>' });
      assert.deepEqual(r.applied, [id], `${pg} ${id}`);
    }
  }
});

test('todas las páginas tienen loader y ids únicos (salvo globales)', () => {
  const root = path.resolve(__dirname, '..');
  const { execSync } = require('child_process');
  const files = execSync('git ls-files "*.html"', { cwd: root }).toString().trim().split('\n').filter((f) => !/^(docs|agente-cisa|preview|blog)\//.test(f));
  assert.equal(files.length, 28);
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(src.includes('cisa-editor-loader'), f);
    for (const [id, n] of Object.entries(H.listIds(src))) if (!id.startsWith('global.')) assert.equal(n, 1, `${f} ${id}`);
  }
});
