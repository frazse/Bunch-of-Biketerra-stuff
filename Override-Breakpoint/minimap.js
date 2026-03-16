// ==UserScript==
// @name         Biketerra Live Rider Positions
// @namespace    http://tampermonkey.net/
// @version      1.6.0
// @description  Ego-centred mini-map with route overlay and full-route overview
// @author       You
// @match         https://biketerra.com/ride*
// @match         https://biketerra.com/spectate/*
// @exclude       https://biketerra.com/dashboard
// @grant        none
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ──────────────────────────────────────────────────────────────
  const REFRESH_MS    = 100;
  const DOT_RADIUS    = 4;
  const PANEL_W       = 320;
  const PANEL_H       = 320;
  const MAP_MARGIN    = 20;
  const MAX_VIEW_DIST = 50;   // metres shown from ego to edge in normal mode
  const ROAD_WIDTH_M  = 8;    // visual road width in metres — adjust to taste

  // ─── State ───────────────────────────────────────────────────────────────
  let zoomedOut       = false;
  let lastRouteOffset = null;  // { offX, offZ }
  let lastEgoPos      = null;  // { x, z } for heading calculation
  let smoothHeading   = 0;     // radians, travel direction
  let routePts        = null;
  let routeBounds     = null;
  let routeCum        = null;
  let routeLen        = 0;

  // ─── Fetch / XHR intercept ───────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = async function (resource, options) {
    const url  = resource instanceof Request ? resource.url : resource;
    const resp = await _origFetch(resource, options);
    if (url && url.includes('/__data.json') && !routePts) {
      try { const j = await resp.clone().json(); tryParseRoute(j); } catch (_) {}
    }
    return resp;
  };

  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._btUrl = url;
    return _origOpen.apply(this, arguments);
  };
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this._btUrl && this._btUrl.includes('/__data.json')) {
      this.addEventListener('load', () => {
        if (routePts) return;
        try { tryParseRoute(JSON.parse(this.responseText)); } catch (_) {}
      });
    }
    return _origSend.apply(this, arguments);
  };

  // ─── Proactive route fetch from event or route ID in page URL ───────────
  function fetchRouteFromUrl() {
    const params  = new URLSearchParams(window.location.search);
    const eventId = params.get('event');
    const routeId = params.get('route');
    const spectateMatch = window.location.pathname.match(/^\/spectate\/(\d+)/);
    let url;
    if (spectateMatch) {
      url = `${window.location.origin}/spectate/${spectateMatch[1]}/__data.json?x-sveltekit-invalidated=11`;
    } else if (eventId) {
      url = `${window.location.origin}/ride/__data.json?event=${eventId}&x-sveltekit-invalidated=11`;
    } else if (routeId) {
      url = `${window.location.origin}/ride/__data.json?route=${routeId}&x-sveltekit-invalidated=11`;
    } else {
      return;
    }
    _origFetch(url)
      .then(r => r.json())
      .then(j => { if (!routePts) tryParseRoute(j); })
      .catch(() => {});
  }
  fetchRouteFromUrl();

  // ─── Route parsing ───────────────────────────────────────────────────────
  function tryParseRoute(json) {
    try {
      const routeNode = json?.nodes?.[1];
      if (!routeNode?.data) return;
      const d = routeNode.data;

      let nodeRefs = null;
      for (let i = 0; i < Math.min(d.length, 50); i++) {
        const obj = d[i];
        if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.nodes != null) {
          const candidate = d[obj.nodes];
          if (Array.isArray(candidate) && candidate.length > 100) {
            nodeRefs = candidate;
            console.log(`[BT Mini-map] Found nodeRefs at d[${i}].nodes → d[${obj.nodes}], length=${nodeRefs.length}`);
            break;
          }
        }
      }
      if (!nodeRefs) { console.warn('[BT Mini-map] nodeRefs not found'); return; }

      for (let i = 0; i < Math.min(5, nodeRefs.length); i++) {
        const ref = nodeRefs[i];
        const tuple = d[ref];
        console.log(`[BT Mini-map] ref[${i}]=${ref}, tuple=`, JSON.stringify(tuple),
          tuple && Array.isArray(tuple) ? `→ values: ${tuple.slice(0,3).map(idx => d[idx])}` : '');
      }

      const pts = [];
      for (const ref of nodeRefs) {
        const tuple = d[ref];
        if (!Array.isArray(tuple) || tuple.length < 3) continue;
        const x = d[tuple[0]];
        const z = d[tuple[2]];
        if (typeof x !== 'number' || typeof z !== 'number') continue;
        pts.push({ rx: x / 100, rz: z / 100 });
      }

      console.log(`[BT Mini-map] Decoded ${pts.length} game-space points`);
      if (pts.length < 10) return;

      routePts = pts;

      routeCum = new Array(routePts.length).fill(0);
      for (let i = 1; i < routePts.length; i++) {
        const dx = routePts[i].rx - routePts[i-1].rx;
        const dz = routePts[i].rz - routePts[i-1].rz;
        routeCum[i] = routeCum[i-1] + Math.sqrt(dx*dx + dz*dz);
      }
      routeLen = routeCum[routeCum.length - 1];

      const rxs = routePts.map(p => p.rx);
      const rzs = routePts.map(p => p.rz);
      const minX = Math.min(...rxs), maxX = Math.max(...rxs);
      const minZ = Math.min(...rzs), maxZ = Math.max(...rzs);
      routeBounds = {
        cx: (minX + maxX) / 2,
        cz: (minZ + maxZ) / 2,
        halfSpan: Math.max(maxX - minX, maxZ - minZ) / 2 || 1,
      };

      lastRouteOffset = null;
      console.log(`[BT Mini-map] Route parsed: ${routePts.length} pts, ${(routeLen/1000).toFixed(2)} km`);
    } catch (e) {
      console.warn('[BT Mini-map] Route parse error:', e);
    }
  }

  // ─── Route point at distance ──────────────────────────────────────────────
  function routePointAtDist(distMetres) {
    if (!routePts || !routeCum) return null;
    const d = ((distMetres % routeLen) + routeLen) % routeLen;
    let lo = 0, hi = routeCum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (routeCum[mid] <= d) lo = mid; else hi = mid;
    }
    const t = (d - routeCum[lo]) / (routeCum[hi] - routeCum[lo] || 1);
    return {
      rx: routePts[lo].rx + (routePts[hi].rx - routePts[lo].rx) * t,
      rz: routePts[lo].rz + (routePts[hi].rz - routePts[lo].rz) * t,
    };
  }

  // ─── Styles ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Overpass:wght@300;400;600&family=Overpass+Mono&display=swap');

    #bt-overlay {
      position: fixed;
      bottom: 20px;
      left: 20px;
      width: ${PANEL_W}px;
      background: rgba(0,0,0,0.5);
      border-radius: 8px;
      font-family: "Overpass", sans-serif;
      font-size: 12px;
      color: #00ffcc;
      z-index: 99999;
      user-select: none;
      overflow: hidden;
      resize: both;
      min-width: 240px;
      min-height: 180px;
      display: flex;
      flex-direction: column;
    }
    #bt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      cursor: move;
      flex-shrink: 0;
    }
    #bt-title {
      font-size: 11px;
      font-weight: 600;
      color: #fff;
      letter-spacing: 1px;
      text-transform: uppercase;
      flex: 1;
    }
    #bt-count { font-size: 10px; color: rgba(255,255,255,0.4); margin-right: 6px; }
    #bt-canvas-wrap { position: relative; width: 100%; flex-shrink: 0; }
    #bt-canvas { display: block; width: 100%; }
    #bt-table-wrap {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }
    #bt-table-wrap::-webkit-scrollbar { width: 8px; }
    #bt-table-wrap::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
    #bt-table-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.3); border-radius: 4px; }
    #bt-table-wrap::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.5); }
    #bt-table-wrap { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.3) rgba(0,0,0,0.2); }
    #bt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    #bt-table thead { position: sticky; top: 0; background: rgba(0,0,0,0.5); z-index: 11; }
    #bt-table thead th {
      padding: 2px 8px; text-align: left;
      color: #fff; font-weight: normal;
    }
    #bt-table tbody tr { border-bottom: 1px solid rgba(255,255,255,0.05); }
    #bt-table tbody tr:hover { background: rgba(255,255,255,0.05); }
    #bt-table tbody tr.bt-ego { outline: 2px solid #FF6262; outline-offset: -2px; box-shadow: 0 0 4px #FF6262; }
    #bt-table tbody td { padding: 3px 8px; color: rgba(255,255,255,0.75); white-space: nowrap; font-family: "Overpass Mono", monospace; }
    #bt-table tbody td.bt-name { color: #fff; font-family: "Overpass", sans-serif; font-size: 13px; }
    #bt-table tbody td.bt-self { color: #fff; font-family: "Overpass", sans-serif; font-size: 13px; }
    .bt-btn {
      background: rgba(255,255,255,0);
      border: none;
      color: #fff;
      font-family: "Overpass", sans-serif;
      font-size: 14px;
      padding: 0;
      margin-left: 4px;
      cursor: pointer;
      line-height: 1;
    }
    .bt-btn:hover { color: #00ffcc; }
    .bt-btn.active { color: #00ffcc; }
  `;
  document.head.appendChild(style);

  // ─── Panel HTML ──────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'bt-overlay';
  panel.innerHTML = `
    <div id="bt-header">
      <span id="bt-title">Mini-map</span>
      <span id="bt-count">—</span>
      <button id="bt-zoom" class="bt-btn" title="Toggle route overview">⤢</button>
      <button id="bt-toggle" class="bt-btn" title="Hide/show">🗊</button>
    </div>
    <div id="bt-canvas-wrap">
      <canvas id="bt-canvas" width="${PANEL_W}" height="${PANEL_H}"></canvas>
    </div>
    <div id="bt-table-wrap">
      <table id="bt-table">
        <thead><tr><th>Name</th><th>ΔX</th><th>ΔY</th><th>ΔZ</th><th>Dist</th></tr></thead>
        <tbody id="bt-tbody"></tbody>
      </table>
    </div>
  `;
  document.body.appendChild(panel);

  // ─── Drag ────────────────────────────────────────────────────────────────
  const header = document.getElementById('bt-header');
  let dragging = false, ox = 0, oy = 0;
  header.addEventListener('mousedown', e => {
    dragging = true;
    ox = e.clientX - panel.getBoundingClientRect().left;
    oy = e.clientY - panel.getBoundingClientRect().top;
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.right  = 'auto'; panel.style.bottom = 'auto';
    panel.style.left   = (e.clientX - ox) + 'px';
    panel.style.top    = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => dragging = false);

  // ─── Buttons ─────────────────────────────────────────────────────────────
  const toggleBtn  = document.getElementById('bt-toggle');
  const zoomBtn    = document.getElementById('bt-zoom');
  const canvasWrap = document.getElementById('bt-canvas-wrap');
  const tableWrap  = document.getElementById('bt-table-wrap');

  let collapsed = false;
  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    canvasWrap.style.display = collapsed ? 'none' : '';
    tableWrap.style.display  = collapsed ? 'none' : '';
    toggleBtn.textContent    = collapsed ? '🗉' : '🗊';
  });

  zoomBtn.addEventListener('click', () => {
    zoomedOut = !zoomedOut;
    zoomBtn.classList.toggle('active', zoomedOut);
    zoomBtn.textContent = zoomedOut ? '⤡' : '⤢';
  });

  // ─── Canvas helpers ───────────────────────────────────────────────────────
  const canvas = document.getElementById('bt-canvas');
  const ctx    = canvas.getContext('2d');

  function fmt(v) { return typeof v === 'number' ? v.toFixed(1) : '—'; }

  function getEgo() {
    try {
      const gm = window.gameManager;
      if (!gm) return null;
      const p = gm.ego?.position ?? gm.focalRider?.position;
      if (!p) return null;
      return { x: p.x, y: p.y, z: p.z };
    } catch { return null; }
  }

  function getHumans() {
    try {
      const gm = window.gameManager;
      if (!gm) return [];
      const hr = window.hackedRiders ?? [];
      const egoId = gm.ego?.athleteId ?? gm.focalRider?.athleteId ?? gm.focalRider?.id ?? hr[0]?.riderId;
      const humans = gm.humans;
      if (!humans) return [];
      return Object.entries(humans).map(([id, h]) => {
        const p = h?.position;
        if (!p) return null;
        const hrEntry = hr.find(x => x.riderId == id);
        const label = hrEntry?.name ?? id;
        return { id, label, x: p.x, y: p.y, z: p.z };
      }).filter(r => r && r.id != egoId);
    } catch { return []; }
  }

  function isSpectating() {
    try {
      const gm = window.gameManager;
      return !!gm && !gm.ego && !!gm.focalRider;
    } catch { return false; }
  }

  function getEgoLabel() {
    if (!isSpectating()) return 'YOU';
    try {
      const hr = window.hackedRiders ?? [];
      // hackedRiders marks the focal rider with isMe:true — use that first
      const meEntry = hr.find(x => x.isMe);
      if (meEntry?.name) return meEntry.name;
      // Fallback: match by athleteId/id
      const gm = window.gameManager;
      const id = gm.focalRider?.athleteId ?? gm.focalRider?.id;
      const hrEntry = hr.find(x => x.riderId == id);
      return hrEntry?.name ?? String(id) ?? 'YOU';
    } catch { return 'YOU'; }
  }

  function getEgoDist() {
    try {
      const hr = window.hackedRiders, gm = window.gameManager;
      if (!hr || !gm) return null;
      const myId = gm.ego?.athleteId ?? gm.focalRider?.athleteId ?? gm.focalRider?.id ?? hr[0]?.riderId;
      const r = hr.find(x => x.riderId == myId);
      return r ? r.dist : null;
    } catch { return null; }
  }

  function getHumanDist(id) {
    try {
      const hr = window.hackedRiders;
      if (!hr) return null;
      const r = hr.find(x => x.riderId == id);
      return r ? r.dist : null;
    } catch { return null; }
  }

  // ─── Rider colours from helmet ───────────────────────────────────────────
  function getRiderColor(id) {
    try {
      const hr = window.hackedRiders ?? [];
      const entry = hr.find(x => x.riderId == id);
      return entry?.helmet || '#ff6b35';
    } catch { return '#ff6b35'; }
  }

  function getEgoColor() {
    try {
      const hr = window.hackedRiders ?? [];
      const entry = hr.find(x => x.isMe);
      return entry?.helmet || '#00ddb4';
    } catch { return '#00ddb4'; }
  }

  // Helper: hex or rgb string → "r,g,b"
  function colorToRGB(hex) {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return `${(n>>16)&255},${(n>>8)&255},${n&255}`;
    }
    // fallback for rgb(...) strings already
    const m2 = hex.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m2) return `${m2[1]},${m2[2]},${m2[3]}`;
    return '255,107,53';
  }

  // ─── Draw ─────────────────────────────────────────────────────────────────
  function drawMap(ego, humans) {
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    ctx.clearRect(0, 0, W, H);

    const halfCanvas = Math.min(W, H) / 2 - MAP_MARGIN;

    if (!ego) {
      ctx.fillStyle = 'rgba(0,220,180,0.25)';
      ctx.font = '11px Share Tech Mono';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for game data…', cx, cy);
      return;
    }

    // ════════════════════════════════════════════════════════════════════
    //  OVERVIEW MODE
    // ════════════════════════════════════════════════════════════════════
    if (zoomedOut && routePts && routeBounds) {
      const { cx: rcx, cz: rcz, halfSpan } = routeBounds;
      const scale = halfCanvas / halfSpan;

      // FIX: use + for sy (same convention as normal mode's gToS)
      const rToS = (rx, rz) => ({
        sx: cx + (rx - rcx) * scale,
        sy: cy + (rz - rcz) * scale,
      });

      // Full route line
      ctx.beginPath();
      routePts.forEach((p, i) => {
        const { sx, sy } = rToS(p.rx, p.rz);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = 'rgba(0,220,180,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Start (green) / end (red) markers
      const { sx: ssx, sy: ssy } = rToS(routePts[0].rx, routePts[0].rz);
      ctx.fillStyle = '#00ff88';
      ctx.beginPath(); ctx.arc(ssx, ssy, 5, 0, Math.PI*2); ctx.fill();

      const { sx: esx, sy: esy } = rToS(routePts[routePts.length-1].rx, routePts[routePts.length-1].rz);
      ctx.fillStyle = '#ff4444';
      ctx.beginPath(); ctx.arc(esx, esy, 5, 0, Math.PI*2); ctx.fill();

      // Other riders by route distance
      humans.forEach(r => {
        const dist = getHumanDist(r.id);
        if (dist === null) return;
        const pt = routePointAtDist(dist);
        if (!pt) return;
        const { sx, sy } = rToS(pt.rx, pt.rz);
        if (!isFinite(sx) || !isFinite(sy)) return;
        const rColor = getRiderColor(r.id);
        const rRGB   = colorToRGB(rColor);
        const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 8);
        grd.addColorStop(0, `rgba(${rRGB},0.35)`);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rColor;
        ctx.beginPath(); ctx.arc(sx, sy, DOT_RADIUS, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = rColor;
        ctx.font = '9px overpass'; ctx.textAlign = 'center';
        ctx.fillText(r.label, sx, sy - DOT_RADIUS - 2);
      });

      // YOU by route distance
      const egoDist = getEgoDist();
      if (egoDist !== null) {
        const pt = routePointAtDist(egoDist);
        if (pt) {
          const { sx: eSx, sy: eSy } = rToS(pt.rx, pt.rz);
          if (isFinite(eSx) && isFinite(eSy)) {
            const eColor = getEgoColor();
            const eRGB   = colorToRGB(eColor);
            const grd = ctx.createRadialGradient(eSx, eSy, 0, eSx, eSy, 8);
            grd.addColorStop(0, `rgba(${eRGB},0.45)`);
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(eSx, eSy, 14, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = eColor;
            ctx.beginPath(); ctx.arc(eSx, eSy, DOT_RADIUS, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = eColor;
            ctx.font = '9px overpass'; ctx.textAlign = 'center';
            ctx.fillText(getEgoLabel(), eSx, eSy - DOT_RADIUS - 4);
          }
        }
      }

      return;
    }

    // ════════════════════════════════════════════════════════════════════
    //  NORMAL MODE  — ego-centred, heading-up
    // ════════════════════════════════════════════════════════════════════
    const scale = halfCanvas / MAX_VIEW_DIST;

    // Track heading from ego movement
    if (lastEgoPos) {
      const dx = ego.x - lastEgoPos.x;
      const dz = ego.z - lastEgoPos.z;
      if (Math.sqrt(dx*dx + dz*dz) > 0.05) {
        const raw = Math.atan2(dx, -dz);
        let delta = raw - smoothHeading;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        smoothHeading += delta * 0.15;
      }
    }
    lastEgoPos = { x: ego.x, z: ego.z };

    // Game-space → screen (ego at centre, Z flipped, pre-rotation coords)
    const gToS = (wx, wz) => ({
      sx: cx + (wx - ego.x) * scale,
      sy: cy + (wz - ego.z) * scale,
    });

    // Rotate world so heading points up
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-smoothHeading);
    ctx.translate(-cx, -cy);

    // ── Route ────────────────────────────────────────────────────────────
    if (routePts && routePts.length > 1) {
      lastRouteOffset = { offX: 0, offZ: 0 };
      const { offX, offZ } = lastRouteOffset;
      ctx.beginPath();
      let started = false;
      routePts.forEach(p => {
        const { sx, sy } = gToS(p.rx + offX, p.rz + offZ);
        if (!started) { ctx.moveTo(sx, sy); started = true; }
        else ctx.lineTo(sx, sy);
      });
      ctx.strokeStyle = 'rgba(0,220,180,0.25)';
      ctx.lineWidth = Math.max(2, ROAD_WIDTH_M * scale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // ── Other riders ─────────────────────────────────────────────────────
    const riderScreenPos = [];
    humans.forEach(r => {
      if (typeof r.x !== 'number') return;
      const { sx, sy } = gToS(r.x, r.z);
      if (!isFinite(sx) || !isFinite(sy)) return;

      const inBounds = sx > -20 && sx < W+20 && sy > -20 && sy < H+20;
      if (!inBounds) {
        const angle = Math.atan2(sy - cy, sx - cx);
        const edgeX = cx + Math.cos(angle) * (halfCanvas + MAP_MARGIN - 4);
        const edgeY = cy + Math.sin(angle) * (halfCanvas + MAP_MARGIN - 4);
        ctx.save();
        ctx.translate(edgeX, edgeY); ctx.rotate(angle);
        const eaColor = getRiderColor(r.id);
        const eaRGB   = colorToRGB(eaColor);
        ctx.fillStyle = `rgba(${eaRGB},0.7)`;
        ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(-4,-4); ctx.lineTo(-4,4); ctx.closePath(); ctx.fill();
        ctx.restore();
        return;
      }

      const rColor = getRiderColor(r.id);
      const rRGB   = colorToRGB(rColor);
      const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 10);
      grd.addColorStop(0, `rgba(${rRGB},0.3)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = rColor; ctx.beginPath(); ctx.arc(sx, sy, DOT_RADIUS, 0, Math.PI*2); ctx.fill();

      riderScreenPos.push({ label: r.label, color: rColor, sx, sy });
    });

    // ── YOU glow ─────────────────────────────────────────────────────────
    const myColor = getEgoColor();
    const myRGB   = colorToRGB(myColor);
    const egoGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
    egoGrd.addColorStop(0, `rgba(${myRGB},0.4)`);
    egoGrd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = egoGrd; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI*2); ctx.fill();

    ctx.restore();

    // ── Rider labels ──────────────────────────────────────────────────────
    riderScreenPos.forEach(({ label, color, sx, sy }) => {
      const cos = Math.cos(-smoothHeading), sin = Math.sin(-smoothHeading);
      const rx = cx + cos * (sx - cx) - sin * (sy - cy);
      const ry = cy + sin * (sx - cx) + cos * (sy - cy);
      ctx.fillStyle = color;
      ctx.font = '9px overpass'; ctx.textAlign = 'center';
      ctx.fillText(label, rx, ry - DOT_RADIUS - 4);
    });

    // ── YOU arrow ────────────────────────────────────────────────────────
    ctx.fillStyle = myColor;
    ctx.beginPath();
    ctx.moveTo(cx,     cy - 11);
    ctx.lineTo(cx - 6, cy + 5);
    ctx.lineTo(cx,     cy + 2);
    ctx.lineTo(cx + 6, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = myColor; ctx.font = '9px overpass'; ctx.textAlign = 'center';
    ctx.fillText(getEgoLabel(), cx, cy + 22);

  }

  // ─── Table ───────────────────────────────────────────────────────────────
  function updateTable(ego, humans) {
    const tbody = document.getElementById('bt-tbody');
    const count = document.getElementById('bt-count');
    const total = humans.length + (ego ? 1 : 0);
    count.textContent = `${total} rider${total !== 1 ? 's' : ''}`;

    const withDist = humans.map(r => {
      if (!ego || typeof r.x !== 'number') return { ...r, dx:0, dy:0, dz:0, dist:null };
      const dx = r.x - ego.x, dy = r.y - ego.y, dz = r.z - ego.z;
      return { ...r, dx, dy, dz, dist: Math.sqrt(dx*dx + dy*dy + dz*dz) };
    }).sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));

    const egoRow = ego
      ? `<tr class="bt-ego"><td class="bt-self">▶ ${getEgoLabel()}</td><td>0.0</td><td>0.0</td><td>0.0</td><td>—</td></tr>`
      : '';

    tbody.innerHTML = egoRow + withDist.map(r => `
      <tr>
        <td class="bt-name">${r.label}</td>
        <td>${fmt(r.dx)}</td><td>${fmt(r.dy)}</td><td>${fmt(r.dz)}</td>
        <td>${r.dist !== null ? r.dist.toFixed(1) : '—'}</td>
      </tr>`).join('');
  }

  // ─── Main loop ───────────────────────────────────────────────────────────
  function tick() {
    const ego    = getEgo();
    const humans = getHumans();
    drawMap(ego, humans);
    updateTable(ego, humans);
  }

  setInterval(tick, REFRESH_MS);
  tick();

})();
