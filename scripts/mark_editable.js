#!/usr/bin/env node
// scripts/mark_editable.js
// Marca con data-edit="<id estable>" los textos editables de todas las páginas
// e inyecta el loader mínimo del editor. Idempotente: no remarca lo ya marcado,
// así que los ids existentes NUNCA cambian (se pueden volver a correr tras agregar contenido).
//   node scripts/mark_editable.js            -> aplica
//   node scripts/mark_editable.js --check    -> solo reporta
'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('parse5');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const SKIP_DIRS = new Set(['node_modules', '.git', '.impeccable', 'agente-cisa', 'docs', 'preview', 'scripts', 'tests', 'blog']);
const BLOCK = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'figcaption', 'blockquote', 'dt', 'dd', 'summary', 'button', 'a', 'label', 'th', 'td']);
const INLINE = new Set(['b', 'strong', 'i', 'em', 'br', 'span', 'a']);
const NOPE = new Set(['script', 'style', 'svg', 'noscript', 'template', 'head', 'select', 'textarea', 'iframe']);

const LOADER = '<script>/*cisa-editor-loader*/(function(){try{if(/(?:^|; )cisa_ed=1/.test(document.cookie)||/[?&]editar=1(?:&|$)/.test(location.search)){var s=document.createElement("script");s.src="/assets/editor.js";s.defer=true;document.head.appendChild(s)}}catch(e){}})();</script>';

const attr = (n, k) => { const a = (n.attrs || []).find((x) => x.name === k); return a ? a.value : null; };
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const text = (n) => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(text).join('');

// ¿Su contenido es solo texto + inline seguro (lo que el sanitizer del servidor conserva)?
function leafish(n) {
  for (const c of n.childNodes || []) {
    if (c.nodeName === '#text' || c.nodeName === '#comment') continue;
    if (!c.tagName || !INLINE.has(c.tagName)) return false;
    const names = (c.attrs || []).map((a) => a.name);
    const ok = c.tagName === 'a' ? names.every((x) => ['href', 'target', 'rel'].includes(x))
      : c.tagName === 'span' ? names.every((x) => x === 'class') : names.length === 0;
    if (!ok || !leafish(c)) return false;
  }
  return true;
}
function soleChildA(n) {
  const els = (n.childNodes || []).filter((c) => c.tagName || (c.nodeName === '#text' && c.value.trim()));
  return els.length === 1 && els[0].tagName === 'a';
}

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) files(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
  }
  return out;
}

function markFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const page = rel.replace(/\.html$/, '').replace(/\//g, '-').replace(/^_/, '');
  const doc = parse(src, { sourceCodeLocationInfo: true });
  const used = new Set();
  const inserts = []; // {offset, str}
  // ids ya existentes cuentan como usados (idempotencia)
  (function collect(n) { for (const c of n.childNodes || []) { const v = c.tagName && attr(c, 'data-edit'); if (v) used.add(v); collect(c); } })(doc);
  const counters = {};
  let marked = 0;

  function uniq(base) { let id = base; let k = 2; while (used.has(id)) id = `${base}-${k++}`; used.add(id); return id; }

  function visit(n, ctx) {
    for (const c of n.childNodes || []) {
      if (!c.tagName) continue;
      if (NOPE.has(c.tagName)) continue;
      let cx = ctx;
      const cls = attr(c, 'class') || '';
      if (c.tagName === 'header' && /\bsite-header\b/.test(cls)) cx = { ...ctx, global: 'header' };
      else if (c.tagName === 'footer' && /\bfooter\b/.test(cls)) cx = { ...ctx, global: 'footer' };
      else if (c.tagName === 'nav' && !ctx.global && /\bsite-nav|mobile|drawer\b/.test(cls)) cx = { ...ctx, global: 'header' };
      if (c.tagName === 'section' || c.tagName === 'article') {
        const s = attr(c, 'id') || attr(c, 'aria-labelledby') || (cls.split(/\s+/)[0] || '');
        if (s) cx = { ...cx, section: slug(s.replace(/-title$/, '')) };
      }
      if (attr(c, 'data-edit')) continue; // ya marcado: no tocar ni descender
      const isA = c.tagName === 'a';
      const candidate = BLOCK.has(c.tagName) && !c.attrs.some((a) => a.name === 'contenteditable') &&
        (!isA || cx.global || /\bbtn\b/.test(cls) || n.tagName === 'li' || cx.aOk) &&
        leafish(c) && text(c).trim().length > 0 && c.sourceCodeLocation && c.sourceCodeLocation.endTag &&
        !(soleChildA(c) && c.tagName !== 'a');
      if (candidate) {
        let id;
        if (cx.global) id = uniq(`global.${cx.global}.${slug(text(c))}`);
        else {
          const key = `${cx.section}.${c.tagName}`;
          counters[key] = (counters[key] || 0) + 1;
          id = uniq(`${page}.${cx.section}.${c.tagName}-${counters[key]}`);
        }
        const st = c.sourceCodeLocation.startTag;
        inserts.push({ offset: st.startOffset + 1 + c.tagName.length, str: ` data-edit="${id}"` });
        marked++;
        continue; // no descender: los nodos editables nunca se anidan
      }
      visit(c, { ...cx, aOk: soleChildA(c) });
    }
  }
  visit(doc, { section: 'main', global: null });

  let out = src;
  inserts.sort((a, b) => b.offset - a.offset).forEach((i) => { out = out.slice(0, i.offset) + i.str + out.slice(i.offset); });
  let loader = false;
  if (!out.includes('cisa-editor-loader') && /<\/head>/i.test(out)) { out = out.replace(/<\/head>/i, `${LOADER}\n</head>`); loader = true; }
  if (!CHECK && out !== src) fs.writeFileSync(file, out);
  return { rel, marked, total: used.size, loader };
}

const results = files(ROOT).sort().map(markFile);
for (const r of results) console.log(`${r.rel.padEnd(70)} +${String(r.marked).padStart(3)}  total ${r.total}${r.loader ? '  +loader' : ''}`);
console.log(`\n${results.length} páginas, ${results.reduce((a, r) => a + r.marked, 0)} nodos marcados${CHECK ? ' (solo revisión)' : ''}`);
