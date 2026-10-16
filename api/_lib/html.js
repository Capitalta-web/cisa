// api/_lib/html.js
// Sanitizado y reemplazo de nodos marcados con data-edit.
// Usa parse5 (parser HTML conforme al estándar) con offsets de código fuente
// para tocar SOLO el contenido del nodo marcado y dejar intacto el resto del archivo.
'use strict';
const { parse, parseFragment } = require('parse5');

const MAX_LEN = 4000; // caracteres de HTML sanitizado por campo
const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'a', 'br', 'span']);
const VOID = new Set(['br']);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

// Solo http(s), mailto, tel, anclas y rutas relativas sin esquema.
function safeHref(href) {
  const h = String(href || '').trim();
  if (!h || h.length > 500) return null;
  if (/[\u0000-\u001f\s]/.test(h.replace(/ /g, ''))) return null;
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // javascript:, data:, vbscript:, etc.
  if (h.startsWith('//')) return null;
  return h; // relativa: /x, x.html, #ancla, ?q
}

function safeClass(c) {
  const v = String(c || '').trim();
  return /^[A-Za-z0-9_\- ]{1,100}$/.test(v) ? v : null;
}

function attr(node, name) {
  const a = (node.attrs || []).find((x) => x.name === name);
  return a ? a.value : null;
}

// Convierte HTML arbitrario del navegador en HTML seguro:
// texto + <b>/<strong>/<i>/<em>/<br>, <a href> seguro y <span class> (para
// conservar los acentos tipográficos existentes como <span class="accent">).
// Todo lo demás se descarta conservando su texto.
function sanitize(input) {
  const frag = parseFragment(String(input == null ? '' : input));
  let out = '';
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.nodeName === '#text') out += esc(n.value);
      else if (n.nodeName === '#comment') continue;
      else if (n.tagName === 'script' || n.tagName === 'style' || n.tagName === 'template') continue;
      else if (ALLOWED.has(n.tagName)) {
        const t = n.tagName;
        let attrs = '';
        if (t === 'a') {
          const h = safeHref(attr(n, 'href'));
          if (h) attrs += ` href="${escAttr(h)}"`;
          if (h && /^https?:/i.test(h)) attrs += ' target="_blank" rel="noopener noreferrer"';
        } else if (t === 'span') {
          const c = safeClass(attr(n, 'class'));
          if (!c) { walk(n.childNodes || []); continue; }
          attrs += ` class="${escAttr(c)}"`;
        }
        if (VOID.has(t)) { out += `<${t}>`; continue; }
        out += `<${t}${attrs}>`;
        walk(n.childNodes || []);
        out += `</${t}>`;
      } else if (n.tagName === 'div' || n.tagName === 'p') {
        // contenteditable mete <div>/<p> al dar Enter: lo convertimos en <br>.
        if (out && !out.endsWith('<br>')) out += '<br>';
        walk(n.childNodes || []);
      } else {
        walk(n.childNodes || []);
      }
    }
  };
  walk(frag.childNodes);
  out = out.replace(/(<br>)+$/, '');
  if (out.length > MAX_LEN) throw new HttpError(413, `Texto demasiado largo (máx. ${MAX_LEN})`);
  return out;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function walkElements(node, fn) {
  for (const c of node.childNodes || []) {
    if (c.tagName) fn(c);
    walkElements(c.tagName === 'template' ? c.content : c, fn);
  }
}

function parseDoc(html) {
  return parse(html, { sourceCodeLocationInfo: true });
}

// Devuelve { id: count } de todos los data-edit del documento.
function listIds(html) {
  const counts = {};
  walkElements(parseDoc(html), (el) => {
    const id = attr(el, 'data-edit');
    if (id) counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

// Reemplaza el contenido interno de TODOS los nodos con data-edit === id
// (normalmente uno; los globales pueden repetirse, p. ej. menú de escritorio).
// Retorna { html, replaced }.
function replaceNode(html, id, newInner) {
  const doc = parseDoc(html);
  const targets = [];
  walkElements(doc, (el) => { if (attr(el, 'data-edit') === id) targets.push(el); });
  if (!targets.length) return { html, replaced: 0 };
  for (const el of targets) {
    const loc = el.sourceCodeLocation;
    if (!loc || !loc.startTag || !loc.endTag) throw new HttpError(422, `Nodo ${id} sin etiqueta de cierre`);
    let nested = false;
    walkElements(el, (d) => { if (attr(d, 'data-edit')) nested = true; });
    if (nested) throw new HttpError(422, `Nodo ${id} contiene otros nodos editables`);
  }
  // Reemplazar de atrás hacia adelante para no invalidar offsets.
  targets.sort((a, b) => b.sourceCodeLocation.startTag.endOffset - a.sourceCodeLocation.startTag.endOffset);
  let out = html;
  for (const el of targets) {
    const s = el.sourceCodeLocation.startTag.endOffset;
    const e = el.sourceCodeLocation.endTag.startOffset;
    out = out.slice(0, s) + newInner + out.slice(e);
  }
  return { html: out, replaced: targets.length };
}

// Verifica que el documento resultante siga parseando con la misma estructura
// de nodos editables, y que cada nodo editado contenga exactamente lo pedido.
function validate(before, after, edits) {
  const a = listIds(before);
  const b = listIds(after);
  const ka = Object.keys(a).sort().join('|');
  const kb = Object.keys(b).sort().join('|');
  if (ka !== kb) throw new HttpError(422, 'El cambio alteró la estructura de nodos editables');
  for (const k of Object.keys(a)) if (a[k] !== b[k]) throw new HttpError(422, `Conteo distinto para ${k}`);
  const doc = parseDoc(after);
  walkElements(doc, (el) => {
    const id = attr(el, 'data-edit');
    if (!id || !(id in edits)) return;
    const loc = el.sourceCodeLocation;
    const inner = after.slice(loc.startTag.endOffset, loc.endTag.startOffset);
    if (inner !== edits[id]) throw new HttpError(422, `El nodo ${id} no quedó como se esperaba`);
  });
  return true;
}

// Aplica un conjunto de cambios { id: htmlSanitizado } a un documento.
function applyEdits(html, edits) {
  let out = html;
  const applied = [];
  for (const [id, inner] of Object.entries(edits)) {
    const r = replaceNode(out, id, inner);
    if (r.replaced) { out = r.html; applied.push(id); }
  }
  if (applied.length) {
    const sub = {};
    for (const id of applied) sub[id] = edits[id];
    validate(html, out, sub);
  }
  return { html: out, applied };
}

module.exports = { sanitize, safeHref, replaceNode, listIds, validate, applyEdits, HttpError, MAX_LEN };
