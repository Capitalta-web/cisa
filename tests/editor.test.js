'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
process.env.EDITOR_SESSION_SECRET = 'x'.repeat(40);
process.env.EDITOR_ALLOWED_EMAILS = 'ana@cisa.mx, Alberto@ejemplo.com';
const H = require('../api/_lib/html');
const S = require('../api/_lib/session');
const { prepare, normalizePage } = require('../api/editar');
const { safeReturn } = require('../api/auth');

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

test('sesión: firma, expiración, lista permitida', () => {
  assert.ok(S.isAllowed('ALBERTO@ejemplo.com'));
  assert.ok(!S.isAllowed('otro@x.com'));
  const t = S.newSessionToken('ana@cisa.mx');
  assert.equal(S.verify(t, 'sess').sub, 'ana@cisa.mx');
  assert.equal(S.verify(t, 'link'), null);
  assert.equal(S.verify(t.slice(0, -2) + 'xx', 'sess'), null);
  assert.equal(S.verify(S.sign({ typ: 'sess', sub: 'ana@cisa.mx', exp: 1 }), 'sess'), null);
  assert.equal(S.verify(S.sign({ typ: 'sess', sub: 'intruso@x.com', exp: 9e9 }), 'sess'), null);
  assert.equal(safeReturn('//evil.com'), '/');
  assert.equal(safeReturn('/desarrollos/itzae.html'), '/desarrollos/itzae.html');
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
