// ==UserScript==
// @name         Biketerra ASCII Mini-map
// @namespace    http://tampermonkey.net/
// @version      2.5.0
// @description  ASCII ego-centred mini-map with fixed white curbs and helmet colors
// @match         https://biketerra.com/ride*
// @match         https://biketerra.com/spectate/*
// @exclude       https://biketerra.com/dashboard
// @grant        none
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  let lastEgoPos = null;
  let smoothHeading = 0;

  const REFRESH_MS    = 100;
  const PANEL_W       = 320;
  const PANEL_H       = 450;
  const MAX_VIEW_DIST = 25;
  const GRID_W = 55;
  const GRID_H = 60;

  let routePts = null;

  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch(...args);
    const url = args[0] instanceof Request ? args[0].url : args[0];
    if (url.includes('__data.json') && !routePts) {
      try {
        const j = await res.clone().json();
        tryParseRoute(j);
      } catch {}
    }
    return res;
  };

  function tryParseRoute(json) {
    try {
      const d = json?.nodes?.[1]?.data;
      if (!d) return;
      let nodeRefs = null;
      for (let i = 0; i < 50; i++) {
        const obj = d[i];
        if (obj?.nodes != null) {
          const arr = d[obj.nodes];
          if (Array.isArray(arr) && arr.length > 100) {
            nodeRefs = arr;
            break;
          }
        }
      }
      if (!nodeRefs) return;
      routePts = nodeRefs.map(ref => {
        const t = d[ref];
        return { rx: d[t[0]] / 100, rz: d[t[2]] / 100 };
      }).filter(p => typeof p.rx === 'number');
    } catch {}
  }

  const style = document.createElement('style');
  style.textContent = `
    #bt-overlay {
      position: fixed;
      left: 20px;
      top: 20px;
      width: ${PANEL_W}px;
      background: rgba(0,0,0,0.85);
      border-radius: 12px;
      font-family: monospace;
      z-index: 1;
      display: flex;
      flex-direction: column;
      border: 1px solid rgba(255,255,255,0.1);
    }
    #bt-ascii {
      font-size: 10px;
      line-height: 8px;
      padding: 10px;
      white-space: pre;
      color: #FFF;
      background: transparent;
    }
    #bt-table {
      font-size: 11px;
      width: 100%;
      border-top: 1px solid rgba(255,255,255,0.1);
      color: #FFF;
    }
    #bt-table td { padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'bt-overlay';
  panel.innerHTML = `<pre id="bt-ascii"></pre><table id="bt-table"><tbody id="bt-tbody"></tbody></table>`;
  document.body.appendChild(panel);

  function getRiderHelmetColor(id, isMe = false) {
    try {
      const hr = window.hackedRiders ?? [];
      const entry = isMe ? hr.find(x => x.isMe) : hr.find(x => x.riderId == id);
      return entry?.helmet || (isMe ? '#FFF' : '#00ffcc');
    } catch { return '#00ffcc'; }
  }

  function getEgo() {
    const gm = window.gameManager;
    const p = gm?.ego?.position ?? gm?.focalRider?.position;
    return p ? { x: p.x, y: p.y, z: p.z } : null;
  }

  function getHumans() {
    const gm = window.gameManager;
    if (!gm?.humans) return [];
    return Object.entries(gm.humans).map(([id, h]) => ({
      id,
      label: (window.hackedRiders?.find(x => x.riderId == id)?.name) || id,
      x: h.position?.x,
      y: h.position?.y,
      z: h.position?.z,
      color: getRiderHelmetColor(id)
    })).filter(r => r.x != null);
  }

  function drawAscii(ego, humans) {
    const el = document.getElementById('bt-ascii');
    if (!ego) { el.textContent = 'Waiting for data...'; return; }

    if (lastEgoPos) {
      const dx = ego.x - lastEgoPos.x;
      const dz = ego.z - lastEgoPos.z;
      if (Math.sqrt(dx*dx + dz*dz) > 0.05) {
        const raw = Math.atan2(dx, -dz);
        let delta = raw - smoothHeading;
        while (delta >  Math.PI) delta -= 2*Math.PI;
        while (delta < -Math.PI) delta += 2*Math.PI;
        smoothHeading += delta * 0.2;
      }
    }
    lastEgoPos = { x: ego.x, z: ego.z };

    // Initialize grid with white color as default
    const grid = Array.from({ length: GRID_H }, () =>
      Array.from({ length: GRID_W }, () => ({ char: ' ', color: '#FFF' }))
    );

    const cx = Math.floor(GRID_W / 2);
    const cy = Math.floor(GRID_H / 2);
    const baseScale = Math.min(GRID_W, GRID_H) / (2 * MAX_VIEW_DIST);
    const scaleX = baseScale * 4;
    const scaleY = baseScale;

    const toGrid = (wx, wz) => {
      let dx = wx - ego.x;
      let dz = wz - ego.z;
      const cos = Math.cos(-smoothHeading), sin = Math.sin(-smoothHeading);
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { gx: Math.round(cx + rx * scaleX), gy: Math.round(cy + rz * scaleY) };
    };

    // --- Route Logic ---
    if (routePts && routePts.length > 1) {
      const STEP = 0.5;
      const ROAD_WIDTH = 3.5;
      for (let i = 0; i < routePts.length - 1; i++) {
        const p1 = routePts[i], p2 = routePts[i + 1];
        const dx = p2.rx - p1.rx, dz = p2.rz - p1.rz;
        const dist = Math.sqrt(dx * dx + dz * dz);
if (dist < 0.001) continue;

        // Vector logic for curbs
        const nx = (-dz / dist) * ROAD_WIDTH;
        const nz = (dx / dist) * ROAD_WIDTH;

        const angle = Math.atan2(dx, -dz) - smoothHeading;
        const normAngle = Math.atan2(Math.sin(angle), Math.cos(angle));
        const absDeg = Math.abs((normAngle * 180) / Math.PI);

        let curbChar = '|';
        if (absDeg > 22.5 && absDeg < 67.5) curbChar = normAngle > 0 ? '/' : '\\';
        else if (absDeg >= 67.5 && absDeg <= 112.5) curbChar = '_';
        else if (absDeg > 112.5 && absDeg < 157.5) curbChar = normAngle > 0 ? '\\' : '/';

        const steps = Math.max(1, Math.floor(dist / STEP));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const cX = p1.rx + dx * t;
          const cZ = p1.rz + dz * t;

          const l = toGrid(cX + nx, cZ + nz);
          const r = toGrid(cX - nx, cZ - nz);
          const mid = toGrid(cX, cZ);

          if (l.gx >= 0 && l.gx < GRID_W && l.gy >= 0 && l.gy < GRID_H) grid[l.gy][l.gx].char = curbChar;
          if (r.gx >= 0 && r.gx < GRID_W && r.gy >= 0 && r.gy < GRID_H) grid[r.gy][r.gx].char = curbChar;
          if (mid.gx >= 0 && mid.gx < GRID_W && mid.gy >= 0 && mid.gy < GRID_H) {
            if (grid[mid.gy][mid.gx].char === ' ') grid[mid.gy][mid.gx].char = '.';
          }
        }
      }
    }

    // --- Rider Logic ---
    humans.forEach(r => {
      const { gx, gy } = toGrid(r.x, r.z);
      if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
        grid[gy][gx] = { char: r.label[0].toUpperCase(), color: r.color };
      }
    });

    // --- Ego Logic ---
    grid[cy][cx] = { char: '@', color: getRiderHelmetColor(null, true) };

    // --- Render ---
    let finalHtml = "";
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const cell = grid[y][x];
        if (cell.color !== '#FFF') {
          finalHtml += `<span style="color:${cell.color}">${cell.char}</span>`;
        } else {
          finalHtml += cell.char;
        }
      }
      finalHtml += "\n";
    }
    el.innerHTML = finalHtml;
  }

  function updateTable(ego, humans) {
    const tbody = document.getElementById('bt-tbody');
    tbody.innerHTML = humans.map(r => {
      const dx = ego ? (r.x - ego.x).toFixed(1) : '-';
      const dz = ego ? (r.z - ego.z).toFixed(1) : '-';
      return `<tr><td style="color:${r.color}">${r.label}</td><td style="color:#00ffcc">${dx}</td><td style="color:#00ffcc">${dz}</td></tr>`;
    }).join('');
  }

  function tick() {
    const ego = getEgo();
    const humans = getHumans();
    drawAscii(ego, humans);
    updateTable(ego, humans);
  }

  setInterval(tick, REFRESH_MS);
})();
