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

  const eur = (n) => n.toFixed(2).replace('.', ',') + ' €';

  /* ── 2) Množstevný stepper so živým prepočtom 3+ KS ────────────────────
     Ceny sa čítajú z datasetu pri KAŽDOM prekreslení, nie raz pri inicializácii —
     prepínač gramáže ich mení za behu. */
  const boxes = [...document.querySelectorAll('[data-qty]')];
  const renderBox = (box) => {
    const input = box.querySelector('input[type="number"]');
    if (!input) return;
    const unit1 = parseFloat(box.dataset.price1);
    const unit3 = parseFloat(box.dataset.price3 || box.dataset.price1);
    const minQ = parseInt(box.dataset.tierQty || '3', 10);

    const q = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1));
    if (String(q) !== input.value) input.value = q;

    const unit = q >= minQ ? unit3 : unit1;
    const saved = (unit1 - unit) * q;

    document.querySelectorAll('[data-total]').forEach((o) => { o.textContent = eur(unit * q); });
    document.querySelectorAll('[data-save]').forEach((s) => {
      s.hidden = saved <= 0;
      s.textContent = saved > 0 ? `Ušetríš ${eur(saved)} pri ${q} ks` : '';
    });
    box.querySelectorAll('.price-row').forEach((row) => {
      row.classList.toggle('is-active', row.classList.contains('price-row--tier') === (q >= minQ));
    });
  };

  boxes.forEach((box) => {
    const input = box.querySelector('input[type="number"]');
    if (!input) return;
    box.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]');
      if (!step) return;
      input.value = (parseInt(input.value, 10) || 1) + parseInt(step.dataset.step, 10);
      renderBox(box);
    });
    input.addEventListener('input', () => renderBox(box));
    renderBox(box);
  });

  /* ── 2b) Prepínač gramáže aktívnej látky ───────────────────────────────
     Tá istá látka v inej sile je iná skladová jednotka, nie iný produkt.
     Voľba prepíše cenu, šaržu, čistotu, sklad aj katalógové číslo — všetky
     hodnoty nesie samotný <input> v data atribútoch, nič sa nedopytuje. */
  const strengths = document.querySelector('[data-strengths]');
  if (strengths) {
    const box = document.querySelector('[data-qty]');
    const p1El = document.querySelector('[data-price-1]');
    const p3El = document.querySelector('[data-price-3]');
    const mgEl = document.querySelector('[data-chip-mg]');
    const batchEl = document.querySelector('[data-batch]');
    const purityEl = document.querySelector('[data-purity]');
    const stockEl = document.querySelector('[data-stock-pill]');
    const mctaEl = document.querySelector('.mobile-cta__price');
    const titleEls = document.querySelectorAll('[data-mcta-title]');

    const apply = (input) => {
      const d = input.dataset;
      const price = parseFloat(d.price);
      const tier = d.tier ? parseFloat(d.tier) : null;

      if (box) {
        box.dataset.price1 = String(price);
        box.dataset.price3 = String(tier ?? price);
      }
      if (p1El) p1El.textContent = eur(price);
      if (p3El) {
        p3El.textContent = tier !== null ? eur(tier) : '–';
        p3El.style.color = tier !== null ? '' : 'var(--up-text-mute)';
      }
      if (mgEl) mgEl.textContent = d.mg || '';
      if (batchEl) batchEl.textContent = d.batch || '—';
      if (purityEl) purityEl.textContent = d.purity || '';
      if (stockEl) {
        stockEl.className = 'stock-pill' + (d.stockCls ? ' ' + d.stockCls : '');
        stockEl.setAttribute('data-stock-pill', '');
        stockEl.textContent = d.stockLabel || '';
      }
      if (mctaEl) mctaEl.textContent = eur(price);
      titleEls.forEach((t) => { t.textContent = d.mg ? `${t.dataset.mctaTitle} ${d.mg}` : t.dataset.mctaTitle; });

      // zvýrazni riadok vybranej gramáže v prehľade skladových jednotiek
      document.querySelectorAll('[data-spec-ref]').forEach((tr) => {
        tr.classList.toggle('is-active', tr.getAttribute('data-spec-ref') === d.ref);
      });

      if (box) renderBox(box);
    };

    strengths.addEventListener('change', (e) => {
      const input = e.target.closest('input[type="radio"]');
      if (input && input.checked) apply(input);
    });

    const checked = strengths.querySelector('input:checked');
    if (checked) apply(checked);
  }

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

  /* ── 5) Cenník v pop-upe ───────────────────────────────────────────────
     <dialog> kvôli natívnemu focus trapu a zatváraniu Escapom. Zatvárame
     s krátkou animáciou, preto close() až po jej skončení. */
  const cennik = document.getElementById('cennik-modal');
  if (cennik && typeof cennik.showModal === 'function') {
    const gridBtns = document.querySelectorAll('[data-view-grid]');
    const listBtns = document.querySelectorAll('[data-open-cennik]');
    const setPressed = (open) => {
      gridBtns.forEach((b) => b.setAttribute('aria-pressed', String(!open)));
      listBtns.forEach((b) => { if (b.hasAttribute('aria-pressed')) b.setAttribute('aria-pressed', String(open)); });
    };

    const close = () => {
      if (!cennik.open) return;
      cennik.classList.add('is-closing');
      const done = () => { cennik.classList.remove('is-closing'); cennik.close(); };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
      cennik.addEventListener('animationend', done, { once: true });
      setTimeout(done, 260); // poistka, keby animationend neprišiel
    };

    listBtns.forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      if (!cennik.open) { cennik.showModal(); setPressed(true); }
    }));
    gridBtns.forEach((b) => b.addEventListener('click', close));
    cennik.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', close));

    // klik mimo obsahu zavrie; <dialog> hlási klik na seba pri kliku do backdropu
    cennik.addEventListener('click', (e) => { if (e.target === cennik) close(); });
    cennik.addEventListener('close', () => setPressed(false));
  }

  /* ── 6) Age gate — v produkcii NAVIAC server-side cookie + audit v DB ── */
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
