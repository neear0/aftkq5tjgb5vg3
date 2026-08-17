/* ULTRA PEPTIDY — frontend interakcie. Vanilla, ~2.5 kB min.
   Všetko je progressive enhancement: bez JS stránka funguje. */
(() => {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1) Specular sheen sledujúci kurzor ────────────────────────────────
     Jeden delegovaný listener na dokumente, rAF throttle, passive.
     Na touch zariadeniach sa vôbec nenaviaže. */
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let queued = false, last = null;
    const paint = () => {
      queued = false;
      if (!last) return;
      const el = last.target.closest && last.target.closest('.sheen');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (((last.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (((last.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
    };
    document.addEventListener('pointermove', (e) => {
      last = e;
      if (!queued) { queued = true; requestAnimationFrame(paint); }
    }, { passive: true });
  }

  /* ── 2) Množstevný stepper so živým prepočtom 3+ KS ──────────────────── */
  document.querySelectorAll('[data-qty]').forEach((box) => {
    const input = box.querySelector('input');
    const unit1 = parseFloat(box.dataset.price1);
    const unit3 = parseFloat(box.dataset.price3 || box.dataset.price1);
    const minQ  = parseInt(box.dataset.tierQty || '3', 10);
    const outs  = document.querySelectorAll('[data-total]');
    const saves = document.querySelectorAll('[data-save]');

    const render = () => {
      const q = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1));
      input.value = q;
      const unit  = q >= minQ ? unit3 : unit1;
      const total = unit * q;
      const saved = (unit1 - unit) * q;
      const eur = (n) => n.toFixed(2).replace('.', ',') + ' €';
      outs.forEach((o) => { o.textContent = eur(total); });
      saves.forEach((s) => {
        s.hidden = saved <= 0;
        s.textContent = saved > 0 ? `Ušetríš ${eur(saved)} pri ${q} ks` : '';
      });
      box.querySelectorAll('.price-row').forEach((row) => {
        row.classList.toggle('is-active', row.classList.contains('price-row--tier') === (q >= minQ));
      });
    };

    box.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]');
      if (!step) return;
      input.value = (parseInt(input.value, 10) || 1) + parseInt(step.dataset.step, 10);
      render();
    });
    input.addEventListener('input', render);
    render();
  });

  /* ── 3) Taby (ARIA korektné, klávesnica funguje) ─────────────────────── */
  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    };
    list.addEventListener('click', (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab) select(tab);
    });
    list.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (next < 0) return;
      e.preventDefault();
      const t = tabs[(next + tabs.length) % tabs.length];
      t.focus(); select(t);
    });
  });

  /* ── 4) Sticky mobile CTA — objaví sa, keď hlavné CTA odscrolluje ────── */
  const bar    = document.querySelector('.mobile-cta');
  const anchor = document.querySelector('[data-cta-anchor]');
  if (bar && anchor && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      ([entry]) => bar.classList.toggle('is-visible', !entry.isIntersecting),
      { rootMargin: '-72px 0px 0px 0px' }
    ).observe(anchor);
  }

  /* ── 5) Age gate — v produkcii NAVIAC server-side cookie + audit v DB ── */
  const gate = document.querySelector('.agegate');
  if (gate) {
    const KEY = 'up_ruo_ack_v1';
    let ack = null;
    try { ack = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (ack) {
      gate.hidden = true;
    } else {
      gate.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      gate.querySelector('[data-gate-accept]')?.addEventListener('click', () => {
        try { localStorage.setItem(KEY, new Date().toISOString()); } catch { /* ignore */ }
        gate.hidden = true;
        document.documentElement.style.overflow = '';
        /* produkcia: fetch('/module/up_agegate/accept', {method:'POST'}) → audit */
      });
      gate.querySelector('[data-gate-decline]')?.addEventListener('click', () => {
        location.href = 'https://www.google.com';
      });
    }
  }

})();
