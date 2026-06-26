/* ============================================================
   LiveFresh - native neighborhood map module
   Rebuilt from the shop dataset (window.LF_DATA):
     • 206 retail hubs  = LF Stores (Simon malls)  → in-store · pickup · delivery
     • 12 fulfillment hubs = Produce Markets        → D2C delivery / microfulfillment
   Offline geocoder: LF_DATA.zips_full (41k ZIPs) + LF_DATA.cities
   ============================================================ */
(function () {
  const D = window.LF_DATA;
  const mapEl = document.getElementById('lf-map');
  if (!D || !mapEl) return;

  const $ = id => document.getElementById(id);
  const RADIUS_MI = 20;
  const money = n => '$' + n.toFixed(2);
  const haversineMi = (la1, lo1, la2, lo2) => {
    const R = 3958.756, toRad = d => d * Math.PI / 180;
    const dLat = toRad(la2 - la1), dLon = toRad(lo2 - lo1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  const STORE_COLOR = '#3C9A3D', HUB_COLOR = '#F5A623', YOU_COLOR = '#E94F37';

  // ── State (default: Orange County / Irvine - LF's home market) ──
  let userLat = 33.6846, userLon = -117.8265, userArea = 'Irvine, CA';
  let activeChannel = 'all';   // all | retail | fulfillment
  let activeCat = 'fruits';
  let nearbyHubs = [];

  let map = null, hubLayer = null, radiusLayer = null, youMarker = null, hasMap = false;

  // tiny state-name → code map for "city, state" search
  const STATE_NAMES = { 'california':'CA','new york':'NY','florida':'FL','illinois':'IL','texas':'TX','arizona':'AZ','washington':'WA','georgia':'GA','michigan':'MI','massachusetts':'MA','pennsylvania':'PA','maryland':'MD','north carolina':'NC','nevada':'NV','oregon':'OR','colorado':'CO','new jersey':'NJ','virginia':'VA','ohio':'OH' };

  /* ---------- map ---------- */
  function initMap() {
    if (typeof L === 'undefined') {
      mapEl.innerHTML = '<div class="lf-nomap">🌐 Map needs an internet connection to load tiles.<br>Once online, the live map appears here.</div>';
      // still render the data-driven side panels
      recompute(); renderAll();
      return;
    }
    hasMap = true;
    map = L.map(mapEl, { scrollWheelZoom: false, zoomControl: true }).setView([userLat, userLon], 10);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap · © CARTO', maxZoom: 18
    }).addTo(map);
    radiusLayer = L.layerGroup().addTo(map);
    hubLayer = L.layerGroup().addTo(map);
    youMarker = L.marker([userLat, userLon], { draggable: true, title: 'Drag me to compare your area' }).addTo(map);
    youMarker.on('dragend', e => {
      const p = e.target.getLatLng();
      setUser(p.lat, p.lng, 'Selected area', false);
    });
    setUser(userLat, userLon, userArea, false);
    // recompute size after the section's reveal transition / any layout shift
    setTimeout(() => map.invalidateSize(), 800);
    window.addEventListener('resize', () => map.invalidateSize());
  }

  function plotHubs() {
    if (!hasMap) return;
    hubLayer.clearLayers();
    visibleHubs().forEach(h => {
      const inRange = haversineMi(userLat, userLon, h.lat, h.lon) <= RADIUS_MI;
      const color = h.type === 'retail' ? STORE_COLOR : HUB_COLOR;
      const m = L.circleMarker([h.lat, h.lon], {
        radius: h.type === 'fulfillment' ? 8 : 6,
        color: '#fff', weight: 1.5, fillColor: color, fillOpacity: inRange ? 1 : 0.35
      });
      const tag = h.type === 'retail'
        ? '🏬 In-store · Pickup · Delivery'
        : '🚚 D2C delivery · Microfulfillment';
      m.bindPopup('<b>' + h.name + '</b><br><span style="color:#777">' + h.addr + '</span><br>' + tag);
      hubLayer.addLayer(m);
    });
  }

  function drawRadius() {
    if (!hasMap) return;
    radiusLayer.clearLayers();
    L.circle([userLat, userLon], {
      radius: RADIUS_MI * 1609.34, color: '#F5A623', weight: 1.5,
      dashArray: '5 7', fillColor: '#A3D65C', fillOpacity: 0.08
    }).addTo(radiusLayer);
    L.circleMarker([userLat, userLon], { radius: 7, color: '#fff', weight: 2, fillColor: YOU_COLOR, fillOpacity: 1 }).addTo(radiusLayer);
  }

  /* ---------- data ---------- */
  function visibleHubs() {
    return D.hubs.filter(h => activeChannel === 'all' ? true : h.type === activeChannel);
  }

  function recompute() {
    nearbyHubs = visibleHubs()
      .map(h => Object.assign({}, h, { dist: haversineMi(userLat, userLon, h.lat, h.lon) }))
      .filter(h => h.dist <= RADIUS_MI)
      .sort((a, b) => a.dist - b.dist);
  }

  // cheapest price for a product across nearby hubs (honoring deals)
  function bestPrice(p) {
    let best = Infinity, bestHub = null, deal = null;
    nearbyHubs.forEach(h => {
      const hp = D.hub_prices[h.id];
      if (!hp) return;
      const base = hp[p.id];
      if (base == null) return;
      const hd = (D.hub_deals[h.id] || []).find(d => d.pid === p.id);
      const eff = hd ? hd.disc : base;
      if (eff < best) { best = eff; bestHub = h; deal = hd || null; }
    });
    return best === Infinity ? null : { price: best, hub: bestHub, deal };
  }

  function setUser(lat, lon, area, pan) {
    userLat = lat; userLon = lon; if (area) userArea = area;
    if (hasMap) {
      youMarker.setLatLng([lat, lon]);
      if (pan !== false) map.flyTo([lat, lon], Math.max(map.getZoom(), 10), { duration: 0.6 });
    }
    recompute(); renderAll();
  }

  /* ---------- render ---------- */
  function renderAll() { drawRadius(); plotHubs(); renderStatus(); renderHubs(); renderProducts(); }

  function renderStatus() {
    const stores = nearbyHubs.filter(h => h.type === 'retail').length;
    const hubs = nearbyHubs.filter(h => h.type === 'fulfillment').length;
    const items = nearbyHubs.length ? D.products.length : 0;
    $('lf-status').innerHTML =
      'Showing <b>' + userArea + '</b> &nbsp;·&nbsp; <b>' + stores + '</b> stores &nbsp;·&nbsp; <b>' + hubs +
      '</b> fulfillment hubs &nbsp;·&nbsp; <b>' + items + '</b> items within ' + RADIUS_MI + ' mi';
  }

  function renderHubs() {
    const wrap = $('lf-hubs');
    if (!nearbyHubs.length) {
      wrap.innerHTML = '<div class="lf-empty">No LiveFresh locations within ' + RADIUS_MI + ' miles here - try a major metro like Los Angeles, New York, or Chicago.</div>';
      return;
    }
    wrap.innerHTML = '<div class="lf-hubs-title">Nearest to you</div><div class="lf-hubs-row">' +
      nearbyHubs.slice(0, 6).map(h => {
        const isStore = h.type === 'retail';
        const short = h.name.replace('LF Retail Shop @ ', '').replace('LF Fulfillment Hub @ ', '');
        return '<div class="lf-hub ' + (isStore ? 'store' : 'hub') + '">' +
          '<div class="lf-hub-top"><span class="lf-hub-ic">' + (isStore ? '🏬' : '🚚') + '</span>' +
          '<span class="lf-hub-dist">' + h.dist.toFixed(1) + ' mi</span></div>' +
          '<div class="lf-hub-name">' + short + '</div>' +
          '<div class="lf-hub-tag">' + (isStore ? 'In-store · Pickup · Delivery' : 'D2C delivery · Microfulfillment') + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  const STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>';
  const LEAF = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75C7 8 17 8 17 8z"/></svg>';
  function freshTier(days) {
    if (days <= 2) return { t: 'just-in', label: days <= 1 ? 'Picked yesterday' : 'Picked 2 days ago' };
    if (days <= 5) return { t: 'fresh', label: days + ' days from harvest' };
    if (days <= 10) return { t: 'good', label: days + ' days from harvest' };
    return { t: 'stored', label: days + ' days · cold-stored' };
  }
  function renderProducts() {
    const wrap = $('lf-products');
    if (!nearbyHubs.length) {
      wrap.innerHTML = '<div class="lf-empty">Pick a location with LiveFresh coverage to see live prices.</div>';
      return;
    }
    const items = D.products.filter(p => p.cat === activeCat).slice(0, 8);
    let html = '';
    items.forEach(p => {
      const bp = bestPrice(p);
      if (!bp) return;
      const shortHub = bp.hub.name.replace('LF Retail Shop @ ', '').replace('LF Fulfillment Hub @ ', '');
      const orig = bp.deal ? '<span class="lf-prod-orig">' + money(bp.deal.orig) + '</span>' : '';
      const rev = D.reviews[p.id];
      const rate = rev ? '<button class="lf-rate" data-pid="' + p.id + '" title="See reviews">' + STAR + ' ' + rev.rating.toFixed(1) + ' <span class="c">(' + rev.count.toLocaleString() + ')</span></button>' : '';
      const f = D.freshness[p.id] || {};
      const ft = freshTier(f.days || 0);
      const fromCity = (f.origin || p.source || '').split(',')[0];
      const fresh = '<button class="lf-fresh ' + ft.t + '" data-pid="' + p.id + '" title="See harvest timeline">' + LEAF + '<span>' + ft.label + '</span><span class="from">· from ' + fromCity + '</span></button>';
      const delta = bp.price - (p.base != null ? p.base : bp.price);
      let chg = Math.abs(delta) < 0.05 ? '<span class="lf-change flat">no change</span>'
        : (delta < 0 ? '<span class="lf-change down">▼ ' + money(Math.abs(delta)) + '</span>'
                     : '<span class="lf-change up">▲ ' + money(delta) + '</span>');
      html += '<div class="lf-prod">' +
        '<div class="lf-prod-head"><span class="lf-prod-name">' + p.name + '</span>' + rate + '</div>' +
        '<div class="lf-prod-sub">' + p.unit + '</div>' +
        fresh +
        '<div class="lf-prod-foot"><span class="lf-pricegrp"><span class="lf-prod-price">' + money(bp.price) + ' ' + orig + '</span>' + chg + '</span>' +
        '<span class="lf-prod-hub">' + (bp.hub.type === 'retail' ? '🏬 ' : '🚚 ') + shortHub + '</span></div>' +
        '</div>';
    });
    wrap.innerHTML = html || '<div class="lf-empty">No items in this category nearby.</div>';
  }

  /* ---------- product detail: harvest timeline + reviews ---------- */
  const RDC_BY_REGION = { CA:'LA Wholesale Produce Market', WA:'Seattle Wholesale Growers Market', OR:'Portland Wholesale Produce Market', AZ:'Phoenix Wholesale Market', TX:'Dallas Farmers Market', FL:'Miami Produce Center', GA:'Atlanta State Farmers Market', IL:'Chicago Intl Produce Market', NY:'Hunts Point Terminal Market', PA:'Philadelphia Wholesale Produce Market', MA:'New England Produce Center', NC:'Atlanta State Farmers Market', ID:'Seattle Wholesale Growers Market', CO:'Dallas Farmers Market', MN:'Chicago Intl Produce Market', OH:'Chicago Intl Produce Market', MX:'Pharr Intl Bridge → US Distribution' };
  let popEl = null, popOv = null;
  function ensurePop() {
    if (popEl) return;
    popOv = document.createElement('div'); popOv.className = 'lf-pop-overlay';
    popEl = document.createElement('div'); popEl.className = 'lf-pop'; popEl.setAttribute('role', 'dialog');
    document.body.appendChild(popOv); document.body.appendChild(popEl);
    popOv.addEventListener('click', closeDetail);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
  }
  function dayLabel(daysAgo) {
    if (daysAgo <= 0) return 'Today';
    if (daysAgo === 1) return 'Yesterday';
    if (daysAgo === 2) return '2 days ago';
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function openDetail(pid) {
    ensurePop();
    const p = D.products.find(x => x.id === pid) || D.products[pid];
    const f = D.freshness[pid] || { days: 0, origin: p.source || '' };
    const rev = D.reviews[pid];
    const ft = freshTier(f.days || 0);
    const bp = bestPrice(p);
    const hubShort = bp ? bp.hub.name.replace(/^LF (Retail Shop|Fulfillment Hub) @ /, '') : 'a nearby hub';
    const hubLabel = bp ? (bp.hub.type === 'retail' ? 'LF Store' : 'Fulfillment Hub') : '';
    const stM = (f.origin || '').match(/([A-Z]{2})\s*$/);
    const rdc = RDC_BY_REGION[stM ? stM[1] : 'CA'] || 'LA Wholesale Produce Market';
    const rdcHour = (3 + (pid % 4)) + ':30 AM';
    const stocked = (f.hub_hour || 7) + ':00 AM';
    const rdcDays = f.rdc_days_ago != null ? f.rdc_days_ago : Math.max(0, (f.days || 1) - 1);
    let revHtml = '';
    if (rev) {
      revHtml = '<div class="lf-pop-rev"><div class="lf-pop-rev-head">' + STAR + ' ' + rev.rating.toFixed(1) +
        ' <span class="c">(' + rev.count.toLocaleString() + ' reviews)</span></div>' +
        rev.samples.slice(0, 2).map(s => '<div class="lf-pop-rev-item">“' + s[1] + '” <span>- ' + s[0] + '</span></div>').join('') + '</div>';
    }
    const tierMsg = (ft.t === 'just-in' ? ft.label : (f.days || 0) + ' day' + ((f.days === 1) ? '' : 's') + ' from harvest');
    popEl.innerHTML =
      '<div class="lf-pop-head"><div class="lf-pop-title">' + p.name + '</div><button class="lf-pop-close" aria-label="Close">×</button></div>' +
      '<div class="lf-pop-tier ' + ft.t + '">' + tierMsg + '</div>' +
      '<div class="lf-timeline">' +
        '<div class="lf-step"><div class="lf-step-when">' + dayLabel(f.days) + ' · Picked</div><div class="lf-step-where">' + (f.origin || p.source) + '</div><div class="lf-step-detail">Harvested at the source farm</div></div>' +
        '<div class="lf-step"><div class="lf-step-when">' + dayLabel(rdcDays) + ' · ' + rdcHour + ' · At the market</div><div class="lf-step-where">' + rdc + '</div><div class="lf-step-detail">Cold-chain transfer to the wholesale produce market</div></div>' +
        '<div class="lf-step current"><div class="lf-step-when">Today · ' + stocked + ' · Stocked here</div><div class="lf-step-where">' + ((bp && bp.hub.type === 'retail') ? hubShort : (hubLabel ? hubLabel + ' · ' + hubShort : hubShort)) + '</div><div class="lf-step-detail">' + (bp ? 'Now ' + money(bp.price) + ' · ready for delivery or pickup' : 'ready for delivery or pickup') + '</div></div>' +
      '</div>' + revHtml +
      '<div class="lf-pop-foot"><b>LiveFresh tracks each item end-to-end</b> - from the source farm to your door, we show you exactly where it came from.</div>';
    popEl.querySelector('.lf-pop-close').addEventListener('click', closeDetail);
    popOv.classList.add('open'); popEl.classList.add('open');
    // centre it
    const w = Math.min(340, window.innerWidth - 28);
    popEl.style.width = w + 'px';
    popEl.style.left = Math.round((window.innerWidth - w) / 2) + 'px';
    const h = popEl.offsetHeight;
    popEl.style.top = Math.max(14, Math.round((window.innerHeight - h) / 2)) + 'px';
  }
  function closeDetail() { if (popEl) { popEl.classList.remove('open'); popOv.classList.remove('open'); } }

  /* ---------- search / geocode ---------- */
  function parseQuery(raw) {
    const q = raw.trim().toLowerCase();
    if (!q) return { zip: '', city: '', state: '' };
    if (/^\d{1,5}$/.test(q)) return { zip: q, city: '', state: '' };
    if (q.includes(',')) {
      const [c, s] = q.split(',').map(x => x.trim());
      let st = '';
      if ((s || '').length === 2) st = s.toUpperCase();
      else if (STATE_NAMES[s]) st = STATE_NAMES[s];
      return { zip: '', city: c || '', state: st };
    }
    if (STATE_NAMES[q]) return { zip: '', city: '', state: STATE_NAMES[q] };
    return { zip: '', city: q, state: '' };
  }

  function suggestions(query) {
    const p = parseQuery(query), out = [];
    if (p.zip) {
      if (p.zip.length === 5) {
        const r = D.zips_full[p.zip];
        if (r) out.push({ label: p.zip, sub: r[2] + ', ' + r[3], lat: r[0], lon: r[1], area: r[2] + ', ' + r[3] });
      } else {
        let n = 0;
        for (const z in D.zips_full) {
          if (z.startsWith(p.zip)) {
            const r = D.zips_full[z];
            out.push({ label: z, sub: r[2] + ', ' + r[3], lat: r[0], lon: r[1], area: r[2] + ', ' + r[3] });
            if (++n >= 6) break;
          }
        }
      }
    } else {
      const cq = p.city, sq = p.state;
      D.cities.filter(c => (!cq || c.n.toLowerCase().includes(cq)) && (!sq || c.s === sq))
        .sort((a, b) => {
          if (!cq) return a.n.localeCompare(b.n);
          const as = a.n.toLowerCase().startsWith(cq) ? 0 : 1, bs = b.n.toLowerCase().startsWith(cq) ? 0 : 1;
          return as - bs || a.n.localeCompare(b.n);
        }).slice(0, 6)
        .forEach(c => out.push({ label: c.n + ', ' + c.s, sub: 'City', lat: c.lat, lon: c.lon, area: c.n + ', ' + c.s }));
    }
    return out;
  }

  function positionSuggest() {
    const dd = $('lf-suggest'); if (!dd || !dd.classList.contains('open')) return;
    const r = $('lf-search').getBoundingClientRect();
    dd.style.left = r.left + 'px';
    dd.style.top = (r.bottom + 8) + 'px';
    dd.style.width = r.width + 'px';
  }
  function renderSuggest(q) {
    const dd = $('lf-suggest');
    if (!q) { dd.classList.remove('open'); dd.innerHTML = ''; $('lf-clear').style.display = 'none'; return; }
    $('lf-clear').style.display = 'flex';
    const res = suggestions(q);
    if (!res.length) { dd.classList.remove('open'); dd.innerHTML = ''; return; }
    dd.innerHTML = res.map((r, i) =>
      '<button class="lf-sg" data-i="' + i + '"><span class="lf-sg-label">' + r.label + '</span><span class="lf-sg-sub">' + r.sub + '</span></button>'
    ).join('');
    dd.classList.add('open');
    dd._results = res;
    positionSuggest();
  }

  /* ---------- wiring ---------- */
  function wire() {
    const input = $('lf-search'), dd = $('lf-suggest'), clear = $('lf-clear');
    input.addEventListener('input', e => renderSuggest(e.target.value));
    input.addEventListener('focus', e => { if (e.target.value) renderSuggest(e.target.value); });
    dd.addEventListener('click', e => {
      const b = e.target.closest('.lf-sg'); if (!b) return;
      const r = dd._results[+b.dataset.i];
      input.value = r.label; dd.classList.remove('open');
      setUser(r.lat, r.lon, r.area, true);
    });
    clear.addEventListener('click', () => { input.value = ''; renderSuggest(''); input.focus(); });
    document.addEventListener('click', e => { if (!e.target.closest('.lf-search')) dd.classList.remove('open'); });
    window.addEventListener('scroll', positionSuggest, true);
    window.addEventListener('resize', positionSuggest);

    // product card → open harvest timeline / reviews popover
    const plist = $('lf-products');
    if (plist) plist.addEventListener('click', e => {
      const t = e.target.closest('.lf-fresh, .lf-rate');
      if (t) openDetail(+t.dataset.pid);
    });

    // "Use my location" - geolocation
    const locate = $('lf-locate');
    if (locate) locate.addEventListener('click', () => {
      if (!navigator.geolocation) { input.placeholder = 'Location not supported - type a city or ZIP'; return; }
      const label = locate.innerHTML;
      locate.classList.add('busy'); locate.textContent = 'Locating…';
      const done = () => { locate.classList.remove('busy'); locate.innerHTML = label; };
      navigator.geolocation.getCurrentPosition(
        pos => { dd.classList.remove('open'); input.value = ''; setUser(pos.coords.latitude, pos.coords.longitude, 'Your location', true); done(); },
        ()  => { done(); input.placeholder = 'Couldn’t get location - type a city or ZIP'; },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });

    document.querySelectorAll('#lf-channels button').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('#lf-channels button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeChannel = btn.dataset.ch;
      recompute(); renderAll();
    }));
    document.querySelectorAll('#lf-cats button').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('#lf-cats button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCat = btn.dataset.cat;
      renderProducts();
    }));
  }

  // boot when section is first revealed (defer heavy map until needed)
  function boot() { wire(); initMap(); }
  if ('IntersectionObserver' in window) {
    const sec = document.getElementById('shop');
    const io = new IntersectionObserver((ents) => {
      ents.forEach(en => { if (en.isIntersecting) { io.disconnect(); boot(); } });
    }, { rootMargin: '300px' });
    io.observe(sec);
  } else { boot(); }
})();
