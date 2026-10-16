/* Menú móvil y tablet · compartido por todas las páginas con .site-header.
   Botón con aria-expanded; cierra al elegir un enlace, con Escape, al tocar
   fuera del menú y al pasar a escritorio. */
(function () {
  'use strict';

  var header = document.querySelector('.site-header');
  var nav = header && header.querySelector('.site-header__nav');
  var btn = header && header.querySelector('.site-header__toggle');

  if (header && nav && btn) {
    // En celular el botón «Precalificar» del header vive dentro del panel.
    var cta = header.querySelector('.site-header__actions a');
    if (cta && !nav.querySelector('.site-header__nav-cta')) {
      var copy = cta.cloneNode(true);
      copy.classList.add('site-header__nav-cta');
      nav.appendChild(copy);
    }

    var setOpen = function (open, returnFocus) {
      header.classList.toggle('is-menu-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
      if (!open && returnFocus) btn.focus();
    };
    var isOpen = function () { return btn.getAttribute('aria-expanded') === 'true'; };

    btn.addEventListener('click', function () { setOpen(!isOpen()); });
    nav.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) setOpen(false, true);
    });
    document.addEventListener('click', function (e) {
      if (isOpen() && !header.contains(e.target)) setOpen(false);
    });
    var desktop = window.matchMedia('(min-width: 1024px)');
    var onChange = function () { if (desktop.matches && isOpen()) setOpen(false); };
    if (desktop.addEventListener) desktop.addEventListener('change', onChange);
    else if (desktop.addListener) desktop.addListener(onChange);
  }

  // Los botones flotantes (WhatsApp y agente) no deben tapar las métricas
  // del hero: se ocultan solo mientras se encimarían con ellas.
  var proof = document.querySelector('.hero__proof');
  if (proof) {
    var fabs = function () {
      return Array.prototype.slice.call(document.querySelectorAll('.fab-whatsapp, #agent-cisa-fab'));
    };
    var ticking = false;
    var check = function () {
      ticking = false;
      var b = proof.getBoundingClientRect();
      fabs().forEach(function (fab) {
        var a = fab.getBoundingClientRect();
        var pad = 8;
        var overlap = !(a.right + pad < b.left || a.left - pad > b.right ||
                        a.bottom + pad < b.top || a.top - pad > b.bottom);
        fab.classList.toggle('is-tucked', overlap);
      });
    };
    var schedule = function () {
      if (!ticking) { ticking = true; window.requestAnimationFrame(check); }
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    schedule();
  }
})();
