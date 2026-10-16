/* assets/editor.js — Editor en vivo de Grupo CISA.
 * Solo lo descarga el loader inline de cada página cuando existe la cookie
 * cisa_ed=1 (puesta al iniciar sesión) o con ?editar=1. Los visitantes normales
 * nunca lo cargan. La sesión real es una cookie HttpOnly que valida el servidor.
 */
(function () {
  'use strict';
  if (window.__cisaEditor) return;
  window.__cisaEditor = true;

  var API_AUTH = '/api/auth';
  var API_EDIT = '/api/editar';
  var DRAFT_KEY = 'cisa-editor-borrador:' + location.pathname;
  var originals = {};
  var bar, statusEl, sendBtn;

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var CSS = [
    '.cisa-ed-bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);background:#111;color:#fff;font:14px/1.3 system-ui,sans-serif;padding:10px 12px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)}',
    '.cisa-ed-bar button,.cisa-ed-bar input{font:inherit;border-radius:8px;border:0;padding:8px 12px}',
    '.cisa-ed-bar button{cursor:pointer;background:#333;color:#fff}.cisa-ed-bar button.pri{background:#1f8a4c}.cisa-ed-bar button:disabled{opacity:.5;cursor:default}',
    '.cisa-ed-bar input{background:#fff;color:#111;min-width:220px}.cisa-ed-bar a{color:#8fe3b0}',
    '[data-edit].cisa-ed-on{outline:1px dashed rgba(31,138,76,.6);outline-offset:2px;cursor:text}',
    '[data-edit].cisa-ed-on:hover,[data-edit].cisa-ed-on:focus{outline:2px solid #1f8a4c}',
    '[data-edit].cisa-ed-changed{outline:2px solid #e0a100 !important;background:rgba(224,161,0,.08)}'
  ].join('');

  function mountBar() {
    document.head.appendChild(el('style', {}, CSS));
    bar = el('div', { class: 'cisa-ed-bar', role: 'region', 'aria-label': 'Editor de textos' });
    document.body.appendChild(bar);
  }

  function api(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.__status = r.status; return j; });
    });
  }

  /* ---------- Login ---------- */
  function showLogin() {
    mountBar();
    bar.innerHTML = '<span>Editor CISA</span><input type="email" placeholder="tu correo autorizado" autocomplete="email"><button class="pri">Enviarme enlace</button><button data-x>✕</button>';
    var input = bar.querySelector('input');
    bar.querySelector('[data-x]').onclick = function () { bar.remove(); };
    bar.querySelector('.pri').onclick = function () {
      var b = this; b.disabled = true;
      api(API_AUTH + '?accion=solicitar', { method: 'POST', body: JSON.stringify({ email: input.value, r: location.pathname }) })
        .then(function (j) { bar.innerHTML = '<span>' + esc(j.mensaje || j.error || 'Listo') + '</span>'; })
        .catch(function () { b.disabled = false; });
    };
  }

  /* ---------- Edición ---------- */
  function nodes() { return Array.prototype.slice.call(document.querySelectorAll('[data-edit]')); }

  function changes() {
    var seen = {}, out = [];
    nodes().forEach(function (n) {
      var id = n.getAttribute('data-edit');
      if (seen[id]) return; seen[id] = 1;
      if (n.innerHTML !== originals[id]) out.push({ id: id, html: n.innerHTML });
    });
    return out;
  }

  function refresh() {
    var c = changes();
    var ids = {}; c.forEach(function (x) { ids[x.id] = 1; });
    nodes().forEach(function (n) { n.classList.toggle('cisa-ed-changed', !!ids[n.getAttribute('data-edit')]); });
    statusEl.textContent = c.length ? c.length + ' cambio(s) sin enviar' : 'Sin cambios';
    sendBtn.disabled = !c.length;
    try { c.length ? localStorage.setItem(DRAFT_KEY, JSON.stringify(c)) : localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  function sync(src) { // mismo id repetido en la página (p. ej. menú duplicado)
    var id = src.getAttribute('data-edit');
    nodes().forEach(function (n) { if (n !== src && n.getAttribute('data-edit') === id) n.innerHTML = src.innerHTML; });
  }

  function enable(session) {
    nodes().forEach(function (n) {
      var id = n.getAttribute('data-edit');
      if (!(id in originals)) originals[id] = n.innerHTML;
      n.setAttribute('contenteditable', 'true');
      n.setAttribute('spellcheck', 'true');
      n.classList.add('cisa-ed-on');
    });

    // No navegar al hacer clic en ligas/botones mientras se edita.
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.cisa-ed-on')) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    // Pegar siempre como texto plano.
    document.addEventListener('paste', function (e) {
      if (!e.target.closest || !e.target.closest('.cisa-ed-on')) return;
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, t);
    }, true);
    // Enter no crea bloques nuevos (Shift+Enter = salto de línea en párrafos).
    document.addEventListener('keydown', function (e) {
      var n = e.target.closest && e.target.closest('.cisa-ed-on');
      if (!n || e.key !== 'Enter') return;
      e.preventDefault();
      if (e.shiftKey && /^(P|LI|BLOCKQUOTE|DD|TD)$/.test(n.tagName)) document.execCommand('insertLineBreak');
    }, true);
    document.addEventListener('input', function (e) {
      var n = e.target.closest && e.target.closest('.cisa-ed-on');
      if (n) { sync(n); refresh(); }
    }, true);

    mountBar();
    bar.innerHTML = '<span title="' + esc(session.email) + '">✎ Editando</span><span data-s></span>' +
      '<input data-nota placeholder="Nota para revisión (opcional)" maxlength="500">' +
      '<button class="pri" data-send>Enviar a revisión</button><button data-undo>Descartar</button><button data-out>Salir</button>';
    statusEl = bar.querySelector('[data-s]');
    sendBtn = bar.querySelector('[data-send]');
    bar.querySelector('[data-undo]').onclick = function () {
      if (!confirm('¿Descartar todos los cambios de esta página?')) return;
      nodes().forEach(function (n) { n.innerHTML = originals[n.getAttribute('data-edit')]; });
      refresh();
    };
    bar.querySelector('[data-out]').onclick = function () {
      api(API_AUTH + '?accion=salir', { method: 'POST' }).then(function () { location.href = location.pathname; });
    };
    sendBtn.onclick = send;

    // Restaurar borrador local, si existe.
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
      if (d.length && confirm('Hay ' + d.length + ' cambio(s) guardados en este navegador. ¿Recuperarlos?')) {
        d.forEach(function (c) { nodes().forEach(function (n) { if (n.getAttribute('data-edit') === c.id) n.innerHTML = c.html; }); });
      }
    } catch (e) {}
    refresh();
    window.addEventListener('beforeunload', function (e) { if (changes().length) { e.preventDefault(); e.returnValue = ''; } });
  }

  function send() {
    var c = changes();
    if (!c.length) return;
    sendBtn.disabled = true;
    statusEl.textContent = 'Enviando…';
    api(API_EDIT, { method: 'POST', body: JSON.stringify({ pagina: location.pathname, cambios: c, nota: bar.querySelector('[data-nota]').value }) })
      .then(function (j) {
        if (j.ok) {
          c.forEach(function (x) { originals[x.id] = x.html; });
          try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
          refresh();
          statusEl.innerHTML = j.pr ? 'Enviado ✔ <a href="' + esc(j.pr) + '" target="_blank" rel="noopener">ver PR</a>' : esc(j.mensaje || 'Sin diferencias');
        } else {
          statusEl.textContent = j.error || 'Error al enviar';
          sendBtn.disabled = false;
          if (j.__status === 401) setTimeout(showLoginAgain, 1200);
        }
      })
      .catch(function () { statusEl.textContent = 'Sin conexión; tus cambios siguen guardados aquí.'; sendBtn.disabled = false; });
  }
  function showLoginAgain() { if (bar) bar.remove(); showLogin(); }

  function start() {
    api(API_AUTH + '?accion=sesion').then(function (s) {
      if (s.ok) enable(s);
      else if (/[?&]editar=1(&|$)/.test(location.search)) showLogin();
      else document.cookie = 'cisa_ed=; Path=/; Max-Age=0'; // bandera vieja: no volver a cargar
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
