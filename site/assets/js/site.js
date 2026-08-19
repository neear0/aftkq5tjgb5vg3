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

  /* ── Jazyk a cesty ─────────────────────────────────────────────────────
     Skript je pre obe mutácie ten istý súbor; čo sa líši, nesie <html>
     v data atribútoch, ktoré tam vypísal generátor. Vďaka tomu nevzniká
     druhá kópia skriptu, ktorá by sa časom rozišla s prvou. */
  const CFG      = document.documentElement.dataset;
  const LANG     = CFG.locale === 'en' ? 'en' : 'sk';
  const ASSETS   = CFG.assets || 'assets/';
  const PRODUCT  = CFG.productPrefix || 'produkt-';
  const DEC      = LANG === 'en' ? '.' : ',';

  const eur = (n) => n.toFixed(2).replace('.', DEC) + ' €';

  const DICT = {
    sk: {
      save:      (amount, q) => `Ušetríš ${amount} pri ${q} ks`,
      added:     '✓ Pridané do košíka',
      each:      'ks',
      tierPrice: 'množstevná cena',
      toTier:    (n, price) => `Pridaj ${n} ks a cena za kus klesne na ${price}.`,
      qtyDown:   'Znížiť množstvo',
      qtyUp:     'Zvýšiť množstvo',
      qty:       'Množstvo',
      remove:    (name) => `Odstrániť ${name}`,
      confirm:   'Naozaj vyprázdniť košík?',
      mailSubject: (n) => `Objednávka z webu — ${n} ks`,
      order: {
        head:     'OBJEDNÁVKA — ULTRA PEPTIDY',
        perUnit:  '/ks',
        tierNote: '(množstevná cena)',
        items:    'Položiek',
        discount: 'Množstevná zľava',
        total:    'Celkom s DPH',
        shipping: 'Doprava sa doúčtuje podľa zvoleného spôsobu.',
        ack:      ['Potvrdzujem, že mám 18 rokov alebo viac a že položky',
                   'nadobúdam výhradne na laboratórne a výskumné použitie.'],
        fields:   ['Meno a priezvisko: ', 'Adresa doručenia:  ', 'Telefón:           ',
                   'IČO / DIČ (ak fakturujete na firmu): '],
      },
    },
    en: {
      save:      (amount, q) => `You save ${amount} on ${q} units`,
      added:     '✓ Added to cart',
      each:      'unit',
      tierPrice: 'volume price',
      toTier:    (n, price) => `Add ${n} more and the unit price drops to ${price}.`,
      qtyDown:   'Decrease quantity',
      qtyUp:     'Increase quantity',
      qty:       'Quantity',
      remove:    (name) => `Remove ${name}`,
      confirm:   'Really empty the cart?',
      mailSubject: (n) => `Order from the website — ${n} units`,
      order: {
        head:     'ORDER — ULTRA PEPTIDY',
        perUnit:  '/unit',
        tierNote: '(volume price)',
        items:    'Items',
        discount: 'Volume discount',
        total:    'Total incl. VAT',
        shipping: 'Shipping is charged separately according to the method chosen.',
        ack:      ['I confirm that I am 18 years of age or older and that I am acquiring',
                   'the items strictly for laboratory and research use.'],
        fields:   ['Full name:        ', 'Delivery address: ', 'Phone:            ',
                   'Company ID / VAT ID (if invoicing a company): '],
      },
    },
  };
  const S = DICT[LANG];

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
      s.textContent = saved > 0 ? S.save(eur(saved), q) : '';
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
        // ref a mg musia ísť s cenou, inak by sa do košíka pridala iná gramáž
        box.dataset.ref = d.ref || box.dataset.ref;
        box.dataset.mg = d.mg || "";
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

    // odkaz 'katalog.html#cennik' zo stranok bez modalu otvori cennik po prichode
    if (location.hash === '#cennik') { cennik.showModal(); setPressed(true); }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     KOŠÍK
     Klientský, v localStorage. Na statickom hostingu nič iné nie je možné —
     a je to úmyselné: objednávka sa dokončí e-mailom, kým nebude e-shop.
     Množstevná cena sa počíta na položku, nie na celú objednávku.
     ═══════════════════════════════════════════════════════════════════════ */
  const CART_KEY = 'up_cart_v1';
  const TIER_QTY = 3;

  const cartRead = () => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((i) => i && i.ref && i.qty > 0) : [];
    } catch { return []; }
  };
  const cartWrite = (items) => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch { /* private mode */ }
    document.dispatchEvent(new CustomEvent('up:cart'));
  };

  /** Jednotková cena položky pri danom množstve. */
  const unitOf = (i) => (i.tier != null && i.qty >= TIER_QTY ? i.tier : i.price);
  const cartTotals = (items) => items.reduce((t, i) => {
    t.count += i.qty;
    t.total += unitOf(i) * i.qty;
    t.full  += i.price * i.qty;
    return t;
  }, { count: 0, total: 0, full: 0 });

  /* ── odznak v hlavičke ─────────────────────────────────────────────────── */
  const paintBadge = () => {
    const n = cartTotals(cartRead()).count;
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  };
  document.addEventListener('up:cart', paintBadge);
  paintBadge();

  /* ── pridanie do košíka z produktovej stránky ──────────────────────────── */
  document.querySelectorAll('[data-add-to-cart]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = document.querySelector('[data-qty]');
      if (!box) return;
      const qtyInput = box.querySelector('input[type="number"]');
      const qty = Math.max(1, Math.min(99, parseInt(qtyInput?.value, 10) || 1));
      const d = box.dataset;

      const items = cartRead();
      const found = items.find((i) => i.ref === d.ref);
      if (found) found.qty = Math.min(99, found.qty + qty);
      else items.push({
        ref: d.ref,
        slug: d.slug,
        name: d.name,
        mg: d.mg || '',
        price: parseFloat(d.price1),
        tier: d.price3 && d.price3 !== d.price1 ? parseFloat(d.price3) : null,
        qty,
      });
      cartWrite(items);

      // krátke potvrdenie na tlačidle namiesto vyskakovacieho okna
      const label = btn.textContent;
      btn.textContent = S.added;
      btn.disabled = true;
      setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1400);
    });
  });

  /* ── stránka košíka ────────────────────────────────────────────────────── */
  const cartPage = document.querySelector('[data-cart-page]');
  if (cartPage) {
    const $ = (sel) => cartPage.querySelector(sel);
    const itemsEl = $('[data-cart-items]');
    const emptyEl = $('[data-cart-empty]');
    const bodyEl = $('[data-cart-body]');
    const clearBtn = $('[data-cart-clear]');
    const ORDER_MAIL = 'objednavky@ultrapeptidy.sk';

    const summaryText = (items, t) => {
      const o = S.order;
      const lines = [o.head, ''];
      for (const i of items) {
        const u = unitOf(i);
        lines.push(
          `${i.qty}× ${i.name}${i.mg ? ' ' + i.mg : ''}  [${i.ref}]` +
          `\n     ${eur(u)}${o.perUnit}${u !== i.price ? ' ' + o.tierNote : ''} = ${eur(u * i.qty)}`
        );
      }
      lines.push('', `${o.items}: ${t.count}`);
      if (t.full > t.total) lines.push(`${o.discount}: −${eur(t.full - t.total)}`);
      lines.push(`${o.total}: ${eur(t.total)}`, '', o.shipping, '', ...o.ack, '', ...o.fields);
      return lines.join('\n');
    };

    const render = () => {
      const items = cartRead();
      const t = cartTotals(items);
      const has = items.length > 0;

      if (emptyEl) emptyEl.hidden = has;
      if (bodyEl) bodyEl.hidden = !has;
      if (clearBtn) clearBtn.hidden = !has;
      if (!has) { if (itemsEl) itemsEl.innerHTML = ''; return; }

      itemsEl.innerHTML = items.map((i) => {
        const u = unitOf(i);
        const tierOn = u !== i.price;
        const toTier = i.tier != null && i.qty < TIER_QTY ? TIER_QTY - i.qty : 0;
        return `
        <article class="cart-item" data-ref="${i.ref}">
          <a class="cart-item__fig" href="${PRODUCT}${i.slug}.html" aria-label="${i.name}">
            <span class="vial" style="--vial-w:52px">
              <img class="vial__photo" src="${ASSETS}img/vial.jpg" alt="" width="306" height="812" loading="lazy" decoding="async">
            </span>
          </a>
          <div class="cart-item__main">
            <h3><a href="${PRODUCT}${i.slug}.html">${i.name}</a>${i.mg ? ` <span class="chip">${i.mg}</span>` : ''}</h3>
            <p class="cart-item__ref">${i.ref}</p>
            <p class="cart-item__unit${tierOn ? ' is-tier' : ''}">
              ${eur(u)} / ${S.each}${tierOn ? ' · ' + S.tierPrice : ''}
            </p>
            ${toTier > 0 ? `<p class="cart-item__hint">${S.toTier(toTier, eur(i.tier))}</p>` : ''}
          </div>
          <div class="cart-item__qty">
            <div class="qty-stepper">
              <button type="button" data-cart-step="-1" aria-label="${S.qtyDown}">−</button>
              <input type="number" value="${i.qty}" min="1" max="99" aria-label="${S.qty}">
              <button type="button" data-cart-step="1" aria-label="${S.qtyUp}">+</button>
            </div>
            <button class="cart-item__del" data-cart-remove aria-label="${S.remove(i.name)}">
              <svg width="16" height="16" fill="none" stroke="currentColor"><use href="#i-trash"/></svg>
            </button>
          </div>
          <p class="cart-item__sum">${eur(u * i.qty)}</p>
        </article>`;
      }).join('');

      $('[data-cart-subcount]').textContent = String(t.count);
      $('[data-cart-subtotal]').textContent = eur(t.full);
      $('[data-cart-total]').textContent = eur(t.total);
      const saveRow = $('[data-cart-saverow]');
      if (saveRow) {
        const saved = t.full - t.total;
        saveRow.hidden = saved <= 0;
        if (saved > 0) $('[data-cart-saved]').textContent = '−' + eur(saved);
      }

      const text = summaryText(items, t);
      const ta = $('[data-cart-summary]');
      if (ta) ta.value = text;
      const mail = $('[data-cart-mail]');
      if (mail) {
        mail.href = `mailto:${ORDER_MAIL}` +
          `?subject=${encodeURIComponent(S.mailSubject(t.count))}` +
          `&body=${encodeURIComponent(text)}`;
      }
    };

    itemsEl?.addEventListener('click', (e) => {
      const row = e.target.closest('[data-ref]');
      if (!row) return;
      const items = cartRead();
      const i = items.find((x) => x.ref === row.dataset.ref);
      if (!i) return;

      if (e.target.closest('[data-cart-remove]')) {
        cartWrite(items.filter((x) => x.ref !== i.ref));
        return;
      }
      const step = e.target.closest('[data-cart-step]');
      if (step) {
        i.qty = Math.max(1, Math.min(99, i.qty + parseInt(step.dataset.cartStep, 10)));
        cartWrite(items);
      }
    });

    itemsEl?.addEventListener('change', (e) => {
      const input = e.target.closest('input[type="number"]');
      const row = e.target.closest('[data-ref]');
      if (!input || !row) return;
      const items = cartRead();
      const i = items.find((x) => x.ref === row.dataset.ref);
      if (!i) return;
      i.qty = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1));
      cartWrite(items);
    });

    clearBtn?.addEventListener('click', () => {
      if (confirm(S.confirm)) cartWrite([]);
    });

    $('[data-cart-copy]')?.addEventListener('click', async () => {
      const ta = $('[data-cart-summary]');
      if (!ta) return;
      try { await navigator.clipboard.writeText(ta.value); }
      catch { ta.select(); document.execCommand('copy'); }
      const msg = $('[data-cart-copied]');
      if (msg) { msg.hidden = false; setTimeout(() => { msg.hidden = true; }, 2500); }
    });

    document.addEventListener('up:cart', render);
    render();
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
