// ==UserScript==
// @name          Biketerra Universal Logger [3m gap, working KEEP]
// @namespace     https://biketerra.com/
// @version       8.15.2
// @description   FTMS/BC Logger. Full 8.14.1 + Social Follow (Target Selection, 3m Gap, Configurable Power Gate & Grace Period). Fixed: graph AVGs, power gate follow logic.
// @author        You
// @match         https://biketerra.com/ride*
// @exclude       https://biketerra.com/dashboard
// @run-at        document-idle
// @grant         GM_xmlhttpRequest
// @grant         unsafeWindow
// @grant         GM_setValue
// @grant         GM_getValue
// @connect       intervals.icu
// @connect       www.strava.com
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // --- 1. USER CONFIGURATION & CREDENTIALS ---
  // ==========================================
  const INTERVALS_ID = 'INTERVALS_ID';
  const INTERVALS_API_KEY = 'INTERVALS_API';
  const STRAVA_CLIENT_ID = 'STRAVA_ID';
  const STRAVA_CLIENT_SECRET = 'STRAVA_CLIENT_SECRET';
  const STRAVA_REFRESH_TOKEN = 'STRAVA_REFRESH_TOKEN';

  // FALLBACK ZONES (Overwritten by API upon successful load)
  let ROWING_FTP   = 293;
  let CYCLING_FTP  = 311;
  let THRESHOLD_HR = 173;
  let MAX_HR       = 190;
  // ==========================================

  const FTMS_SERVICE     = '00001826-0000-1000-8000-00805f9b34fb';
  const ROWING_DATA_CHAR = '00002ad1-0000-1000-8000-00805f9b34fb';

  let sportMode = GM_getValue('lastSportMode', 'ROW');
  let targetGameSpeed = 0; let simulatedCycles = 0;
  let bikeChannel = null; let lastLapCount = 0; let lapStartIdx = 0;
  let lapList = []; let recording = false; let recordStart = null;
  let recordTicks = []; let tickInterval = null;

  let device = null; let char = null;
  let minimised = false; let routeName = null; let routeLength = null;

  // --- SOCIAL FOLLOW STATE ---
  let followModeActive = false;
  let targetRiderId = null;
  let targetRiderName = "None";
  let lastRiderList = [];
  let powerGate = GM_getValue('powerGateSetting', 100);
  let dropGraceTimer = null;
  let graceActive = false; // FIX: renamed from inGracePeriod, clearer boolean

  const live = {
    cadence: 0, strokes: 0, cycles: 0, dist: 0,
    watts: 0, hr: 0, lat: null, lng: null, alt: null,
    routePct: null, hasData: false, speed: 0,
    avgCadence: 0, avgWatts: 0, avgHr: 0, avgSpeed: 0, heartRateAvg: 0
  };

  // Graphing & Session Max State
  const GRAPH_MAX_PTS = 120; // 2 minutes of history
  const graphData = { watts: [], hr: [], speed: [], cadence: [], split: [], alt: [] };
  let uiTickInterval = null;
  let sessionMaxWatts = 0;
  let sessionMaxHr = 0;
  let sessionMaxSpeed = 0;
  let sessionMaxCadence = 0;
  let sessionMinSplit = 9999;
  let sessionMaxAlt = -9999;
  let sessionMinAlt = 9999;

  // --- 2. DYNAMIC UI ---
  const STYLE = `
    #universal-overlay {
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      background: rgba(15,15,15,0.88); border: 0.5px solid rgba(255,255,255,0.15);
      border-radius: 12px; padding: 12px 16px; width: 280px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff; user-select: none; backdrop-filter: blur(4px);
    }
    #universal-overlay.minimised #uni-body,
    #universal-overlay.minimised #uni-graphs,
    #universal-overlay.minimised #uni-footer { display: none; }
    #universal-overlay.minimised { width: auto; }

    #uni-header { margin-bottom: 10px; cursor: grab; }
    #uni-title-row { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 500; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; }
    #uni-mode-row { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; padding-top: 4px; border-top: 0.5px solid rgba(255,255,255,0.1); }
    #uni-sport-toggle { font-size: 11px; color: rgba(255,255,255,0.6); display: flex; gap: 4px; }
    .sport-opt { cursor: pointer; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.05); }
    .sport-opt.active { background: #5DCAA5; color: #000; font-weight: 600; }
    #uni-status { display: flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(255,255,255,0.45); }
    #uni-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.3); }
    #uni-dot.connected { background: #5DCAA5; }
    #uni-dot.recording { background: #E24B4A; }
    #uni-route-status { font-size: 10px; color: rgba(255,255,255,0.35); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 0.5px solid rgba(255,255,255,0.1); padding-bottom: 4px; }

    #uni-body { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .uni-cell { background: rgba(255,255,255,0.06); border-radius: 8px; padding: 6px 8px; }
    .uni-label { font-size: 9px; color: rgba(255,255,255,0.45); margin-bottom: 2px; text-transform: uppercase; }
    .uni-value { font-size: 18px; font-weight: 500; color: #fff; line-height: 1.1; }
    .uni-unit  { font-size: 9px; color: rgba(255,255,255,0.35); }

    /* GARMIN STYLE GRAPH CONTAINERS */
    #uni-graphs { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
    .garmin-box { position: relative; width: 100%; height: 56px; background: rgba(255,255,255,0.04); border-radius: 6px; overflow: hidden; border: 0.5px solid rgba(255,255,255,0.1); }
    .garmin-canvas { position: absolute; bottom: 0; left: 0; width: 100%; height: 100%; z-index: 1; }
    .garmin-overlay { position: absolute; top: 0; left: 0; width: 100%; padding: 4px 6px; z-index: 2; display: flex; justify-content: space-between; align-items: flex-start; pointer-events: none; }
    .garmin-left { display: flex; align-items: flex-end; gap: 4px; }
    .garmin-icon { width: 14px; height: 14px; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.8)); margin-bottom: 2px; }
    .garmin-current { font-size: 22px; font-weight: 700; color: #fff; line-height: 1; text-shadow: 1px 1px 4px rgba(0,0,0,0.9); }
    .garmin-unit { font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 1px; text-shadow: 1px 1px 2px rgba(0,0,0,0.8); text-transform: lowercase; }
    .garmin-right { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; margin-top: 1px; }
    .garmin-stat { font-size: 9px; font-weight: 700; color: rgba(255,255,255,0.8); text-shadow: 1px 1px 3px rgba(0,0,0,0.9); }

    #uni-footer { margin-top: 8px; display: flex; gap: 6px; justify-content: flex-end; align-items: center; }
    #uni-rec-time { font-size: 10px; color: rgba(255,255,255,0.4); flex: 1; font-variant-numeric: tabular-nums; }
    .uni-btn { font-size: 10px; border-radius: 6px; padding: 3px 8px; cursor: pointer; border: 0.5px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
    .uni-btn:hover:not(:disabled) { background: rgba(255,255,255,0.14); color: #fff; }
    .uni-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .uni-btn.accent { background: rgba(93,202,165,0.2); border-color: #5DCAA5; color: #5DCAA5; }
    .uni-btn.danger { background: rgba(226,75,74,0.2); border-color: #E24B4A; color: #E24B4A; }
    #bike-read-only-tag { font-size: 9px; color: rgba(255,255,255,0.3); font-weight: normal; margin-left: 4px;}
  `;

  function buildOverlay() {
    const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
    const el = document.createElement('div'); el.id = 'universal-overlay';

    const connBtnHTML = sportMode === 'ROW' ? '<button class="uni-btn" id="uni-btn-connect">Connect</button>' : '';
    const readOnlyTag = sportMode === 'BIKE' ? '<span id="bike-read-only-tag">(Read-Only)</span>' : '';

    const distUnit = sportMode === 'ROW' ? 'm' : 'km';
    const countLabel = sportMode === 'ROW' ? 'STROKES' : 'CYCLES';
    const cadUnit = sportMode === 'ROW' ? 'spm' : 'rpm';
    const speedUnit = sportMode === 'ROW' ? 'm/s' : 'km/h';

    const g5Html = sportMode === 'ROW' ? `
        <div class="garmin-box">
          <canvas id="cvs-split" class="garmin-canvas" width="248" height="56"></canvas>
          <div class="garmin-overlay">
            <div class="garmin-left">
              <svg class="garmin-icon" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <div class="garmin-current" id="gv-split-cur">--:--</div><span class="garmin-unit">/500m</span>
            </div>
            <div class="garmin-right">
              <div class="garmin-stat">AVG <span id="gv-split-avg">--:--</span></div>
              <div class="garmin-stat">BEST <span id="gv-split-max">--:--</span></div>
            </div>
          </div>
        </div>
    ` : `
        <div class="garmin-box">
          <canvas id="cvs-alt" class="garmin-canvas" width="248" height="56"></canvas>
          <div class="garmin-overlay">
            <div class="garmin-left">
              <svg class="garmin-icon" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><polyline points="3 17 9 11 13 15 21 7"/></svg>
              <div class="garmin-current" id="gv-alt-cur">--</div><span class="garmin-unit">m</span>
            </div>
            <div class="garmin-right">
              <div class="garmin-stat">MIN <span id="gv-alt-min">--</span></div>
              <div class="garmin-stat">MAX <span id="gv-alt-max">--</span></div>
            </div>
          </div>
        </div>
    `;

    el.innerHTML = `
      <div id="uni-header">
        <div id="uni-title-row">Biketerra Master Logger ${readOnlyTag}</div>
        <div id="uni-mode-row">
            <div id="uni-status"><div id="uni-dot"></div><span id="uni-status-text">WAITING...</span></div>
            <div id="uni-sport-toggle">SPORT: <span class="sport-opt" id="toggle-row">ROW 🚣</span> | <span class="sport-opt" id="toggle-bike">BIKE 🚴</span></div>
        </div>
      </div>
      <div id="uni-route-status">No route loaded</div>

      <div id="uni-body">
        <div class="uni-cell"><div class="uni-label">DISTANCE</div><div class="uni-value" id="uv-dist">--</div><div class="uni-unit">${distUnit}</div></div>

        <div class="uni-cell">
          <div class="uni-label">ROUTE</div>
          <div class="uni-value"><span id="uv-pct">--</span><span style="font-size:12px; margin-left:1px; color:rgba(255,255,255,0.4);">%</span></div>
          <div class="uni-unit" id="uv-gps" style="margin-top:2px; font-variant-numeric: tabular-nums;">--</div>
        </div>

        <div class="uni-cell"><div class="uni-label">LAPS</div><div class="uni-value" id="uv-laps">0</div><div class="uni-unit">count</div></div>
        <div class="uni-cell"><div class="uni-label">${countLabel}</div><div class="uni-value" id="uv-count">0</div><div class="uni-unit">total</div></div>
      </div>

      <div id="uni-graphs">

        <div class="garmin-box">
          <canvas id="cvs-watts" class="garmin-canvas" width="248" height="56"></canvas>
          <div class="garmin-overlay">
            <div class="garmin-left">
              <svg class="garmin-icon" viewBox="0 0 24 24" fill="none" stroke="#A855F7" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <div class="garmin-current" id="gv-watts-cur">--</div><span class="garmin-unit">W</span>
            </div>
            <div class="garmin-right">
              <div class="garmin-stat">AVG <span id="gv-watts-avg">--</span></div>
              <div class="garmin-stat">MAX <span id="gv-watts-max">--</span></div>
            </div>
          </div>
        </div>

        <div class="garmin-box">
          <canvas id="cvs-hr" class="garmin-canvas" width="248" height="56"></canvas>
          <div class="garmin-overlay">
            <div class="garmin-left">
              <svg class="garmin-icon" viewBox="0 0 24 24" fill="#EF4444"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              <div class="garmin-current" id="gv-hr-cur">--</div><span class="garmin-unit">bpm</span>
            </div>
            <div class="garmin-right">
              <div class="garmin-stat">AVG <span id="gv-hr-avg">--</span></div>
              <div class="garmin-stat">MAX <span id="gv-hr-max">--</span></div>
            </div>
          </div>
        </div>

        <div class="garmin-box">
          <canvas id="cvs-speed" class="garmin-canvas" width="248" height="56"></canvas>
          <div class="garmin-overlay">
            <div class="garmin-left">
              <svg class="garmin-icon" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 17.5a10 10 0 1 1 20 0"/>
                <path d="M12 17.5L15 10"/>
                <circle cx="12" cy="17.5" r="1" fill="#3B82F6"/>
              </svg>
              <div class="garmin-current" id="gv-speed-cur">--</div><span class="garmin-unit">${speedUnit}</span>
            </div>
            <div class="garmin-right">
              <div class="garmin-stat">AVG <span id="gv-speed-avg">--</span></div>
              <div class="garmin-stat">MAX <span id="gv-speed-max">--</span></div>
            </div>
          </div>
        </div>

        <div class="garmin-box">
          <canvas id="cvs-cadence" class="garmin-canvas" width="248" height="56"></canvas>
          <div class="garmin-overlay">
            <div class="garmin-left">
              <svg class="garmin-icon" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
              <div class="garmin-current" id="gv-cad-cur">--</div><span class="garmin-unit">${cadUnit}</span>
            </div>
            <div class="garmin-right">
              <div class="garmin-stat">AVG <span id="gv-cad-avg">--</span></div>
              <div class="garmin-stat">MAX <span id="gv-cad-max">--</span></div>
            </div>
          </div>
        </div>

        ${g5Html}

      </div>

      <div id="uni-footer">
          <span id="uni-rec-time"></span>
${sportMode === 'ROW' ? '<button class="uni-btn" id="uni-btn-follow" style="margin-right:4px;">Follow: OFF</button>' : ''}          ${connBtnHTML}
          <button class="uni-btn accent" id="uni-btn-rec" disabled>Record</button>
<button class="uni-btn" id="uni-btn-min">—</button>
</div>
<div id="uni-social-row" style="display:none; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 0.5px solid rgba(255,255,255,0.1);">
  <div class="uni-cell" style="display:flex; flex-direction:column; justify-content:center; align-items:center; padding: 4px;">
      <div class="uni-label">POWER GATE</div>
      <div style="display:flex; align-items:center; gap:6px;">
          <button class="uni-btn" id="gate-down" style="padding:1px 6px;">-</button>
          <span id="gate-val" style="font-size:13px; font-weight:600; min-width:35px; text-align:center;">${powerGate}W</span>
          <button class="uni-btn" id="gate-up" style="padding:1px 6px;">+</button>
      </div>
  </div>
  <div class="uni-cell" style="display:flex; flex-direction:column; justify-content:center; align-items:center; cursor:pointer; padding: 4px;" id="uni-cell-target">
      <div class="uni-label">FOLLOW TARGET</div>
      <div id="uni-target-name-display" style="font-size:12px; font-weight:600; color:#5DCAA5; text-align:center;">None</div>
  </div>
</div>      </div>
    `;
    document.body.appendChild(el);

    // --- FOLLOW UI LOGIC ---
    if (sportMode === 'ROW') {
      const followBtn = document.getElementById('uni-btn-follow');
      const socialRow = document.getElementById('uni-social-row');
      const targetCell = document.getElementById('uni-cell-target');
      const targetDisplay = document.getElementById('uni-target-name-display');

      followBtn.onclick = () => {
        followModeActive = !followModeActive;
        followBtn.textContent = `Follow: ${followModeActive ? 'ON' : 'OFF'}`;
        followBtn.classList.toggle('accent', followModeActive);
        socialRow.style.display = followModeActive ? 'grid' : 'none';
      };

      targetCell.onclick = () => {
        if (lastRiderList.length === 0) return;
        const currentIndex = lastRiderList.findIndex(r => r.id === targetRiderId);
        const nextRider = lastRiderList[(currentIndex + 1) % lastRiderList.length];
        targetRiderId = nextRider.id;
        targetRiderName = nextRider.name;
        targetDisplay.textContent = targetRiderName.split(' ')[0];
      };

      document.getElementById('gate-up').onclick = () => {
        powerGate += 10;
        document.getElementById('gate-val').textContent = `${powerGate}W`;
        GM_setValue('powerGateSetting', powerGate);
      };
      document.getElementById('gate-down').onclick = () => {
        powerGate = Math.max(0, powerGate - 10);
        document.getElementById('gate-val').textContent = `${powerGate}W`;
        GM_setValue('powerGateSetting', powerGate);
      };
    }

    document.getElementById('uni-btn-rec').addEventListener('click', onRecordClick);
    document.getElementById('uni-btn-min').addEventListener('click', toggleMinimise);
    makeDraggable(el, document.getElementById('uni-header'));

    document.getElementById('toggle-row').addEventListener('click', () => changeSportMode('ROW'));
    document.getElementById('toggle-bike').addEventListener('click', () => changeSportMode('BIKE'));
    document.getElementById(`toggle-${sportMode.toLowerCase()}`).classList.add('active');

    if (sportMode === 'ROW') {
      document.getElementById('uni-btn-connect').addEventListener('click', onConnectClick);
      document.getElementById('uni-status-text').textContent = 'FTMS DISCONNECTED';
      startSpeedSyncLoop();
    } else {
      document.getElementById('uni-status-text').textContent = 'WAITING FOR DATA...';
    }

    startUiTickLoop();
    fetchAthleteZonesFromIntervals();
  }

  // --- 2.5 API SYNC FUNCTION ---
  function fetchAthleteZonesFromIntervals() {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://intervals.icu/api/v1/athlete/${INTERVALS_ID}`,
      headers: { "Authorization": "Basic " + btoa("API_KEY:" + INTERVALS_API_KEY) },
      onload: function(r) {
        if (r.status >= 200 && r.status < 300) {
          try {
            const data = JSON.parse(r.responseText);
            if (data.ftp) CYCLING_FTP = data.ftp;
            if (data.lthr) THRESHOLD_HR = data.lthr;
            if (data.max_hr) MAX_HR = data.max_hr;

            if (data.sportSettings && Array.isArray(data.sportSettings)) {
              const ride = data.sportSettings.find(s => s.id === 'Ride' || s.id === 'VirtualRide') || data.sportSettings[0];
              const row = data.sportSettings.find(s => s.id === 'Rowing' || s.id === 'VirtualRow') || data.sportSettings[3];
              if (ride && sportMode === 'BIKE') {
                CYCLING_FTP = ride.indoor_ftp || ride.ftp || CYCLING_FTP;
                THRESHOLD_HR = ride.lthr || THRESHOLD_HR;
                MAX_HR = ride.max_hr || MAX_HR;
              }
              if (row && sportMode === 'ROW') {
                ROWING_FTP = row.indoor_ftp || row.ftp || ROWING_FTP;
                THRESHOLD_HR = row.lthr || THRESHOLD_HR;
                MAX_HR = row.max_hr || MAX_HR;
              }
            }
            console.log(`[Biketerra] Synced Intervals.icu Zones`);
          } catch (e) { console.error(e); }
        }
      }
    });
  }

  function changeSportMode(newMode) {
    if (sportMode === newMode) return;
    GM_setValue('lastSportMode', newMode); location.reload();
  }

  function makeDraggable(el, handle) {
    let ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', e => { if (e.target.classList.contains('sport-opt')) return; dragging = true; const r = el.getBoundingClientRect(); ox = e.clientX - r.left; oy = e.clientY - r.top; e.preventDefault(); });
    document.addEventListener('mousemove', e => { if (!dragging) return; el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.left = (e.clientX - ox) + 'px'; el.style.top = (e.clientY - oy) + 'px'; });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function setRecordingStatus(rec) {
    const dot = document.getElementById('uni-dot'); const btn = document.getElementById('uni-btn-rec'); const txt = document.getElementById('uni-status-text');
    if (rec) {
      dot.className = 'recording'; txt.textContent = 'RECORDING ACTIVE';
      btn.textContent = 'Stop + Save'; btn.className = 'uni-btn danger';
    } else {
      btn.textContent = 'Record'; btn.className = 'uni-btn accent'; document.getElementById('uni-rec-time').textContent = '';
      if (sportMode === 'ROW') {
        dot.className = (device?.gatt.connected) ? 'connected' : '';
        txt.textContent = (device?.gatt.connected) ? 'FTMS CONNECTED' : 'FTMS DISCONNECTED';
      } else {
        dot.className = 'connected'; txt.textContent = 'BC CONNECTED';
      }
    }
  }

  function formatSplitSec(s) {
    if (!s || s <= 0 || !isFinite(s) || s > 3600) return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  // --- 3. GRAPHING ENGINE ---
  function startUiTickLoop() {
    if (uiTickInterval) clearInterval(uiTickInterval);
    uiTickInterval = setInterval(() => {
      if (!live.hasData || minimised) return;

      const currentWatts = live.watts || 0;
      const currentHr = live.hr || 0;
      const currentSpeed = live.speed || 0;
      const currentCadence = live.cadence || 0;

      graphData.watts.push(currentWatts);
      graphData.hr.push(currentHr);
      graphData.speed.push(currentSpeed);
      graphData.cadence.push(currentCadence);

      if (currentWatts > sessionMaxWatts) sessionMaxWatts = currentWatts;
      if (currentHr > sessionMaxHr) sessionMaxHr = currentHr;
      if (currentSpeed > sessionMaxSpeed) sessionMaxSpeed = currentSpeed;
      if (currentCadence > sessionMaxCadence) sessionMaxCadence = currentCadence;

      if (graphData.watts.length > GRAPH_MAX_PTS) graphData.watts.shift();
      if (graphData.hr.length > GRAPH_MAX_PTS) graphData.hr.shift();
      if (graphData.speed.length > GRAPH_MAX_PTS) graphData.speed.shift();
      if (graphData.cadence.length > GRAPH_MAX_PTS) graphData.cadence.shift();

      document.getElementById('gv-watts-cur').textContent = Math.round(currentWatts);
      document.getElementById('gv-hr-cur').textContent = Math.round(currentHr);

      const spdMult = sportMode === 'ROW' ? 1 : 3.6;
      document.getElementById('gv-speed-cur').textContent = (currentSpeed * spdMult).toFixed(1);
      document.getElementById('gv-cad-cur').textContent = Math.round(currentCadence);

      document.getElementById('gv-watts-max').textContent = Math.round(sessionMaxWatts);
      document.getElementById('gv-hr-max').textContent = Math.round(sessionMaxHr);
      document.getElementById('gv-speed-max').textContent = (sessionMaxSpeed * spdMult).toFixed(1);
      document.getElementById('gv-cad-max').textContent = Math.round(sessionMaxCadence);

      // --- FIX: Compute AVGs from recordTicks for ROW (exclude zeros per metric) ---
      let displayAvgWatts, displayAvgHr, displayAvgSpeed, displayAvgCadence;

      if (sportMode === 'ROW' && recordTicks.length > 0) {
        const wattsArr   = recordTicks.map(t => t.power).filter(v => v > 0);
        const hrArr      = recordTicks.map(t => t.hr).filter(v => v > 0);
        const speedArr   = recordTicks.map(t => t.speed).filter(v => v > 0);
        const cadenceArr = recordTicks.map(t => t.cadence).filter(v => v > 0);

        displayAvgWatts   = wattsArr.length   ? wattsArr.reduce((a, b) => a + b, 0)   / wattsArr.length   : 0;
        displayAvgHr      = hrArr.length      ? hrArr.reduce((a, b) => a + b, 0)      / hrArr.length      : 0;
        displayAvgSpeed   = speedArr.length   ? speedArr.reduce((a, b) => a + b, 0)   / speedArr.length   : 0;
        displayAvgCadence = cadenceArr.length ? cadenceArr.reduce((a, b) => a + b, 0) / cadenceArr.length : 0;
      } else {
        // BIKE mode — averages come from BroadcastChannel live object
        displayAvgWatts   = live.avgWatts   || 0;
        displayAvgHr      = live.heartRateAvg || live.avgHr || 0;
        displayAvgSpeed   = live.avgSpeed   || 0;
        displayAvgCadence = live.avgCadence || 0;
      }

      document.getElementById('gv-watts-avg').textContent  = Math.round(displayAvgWatts);
      document.getElementById('gv-hr-avg').textContent     = Math.round(displayAvgHr);
      document.getElementById('gv-speed-avg').textContent  = (displayAvgSpeed * spdMult).toFixed(1);
      document.getElementById('gv-cad-avg').textContent    = Math.round(displayAvgCadence);

      if (sportMode === 'ROW') {
        const currentSplitSec = live.speed > 0 ? 500 / live.speed : 0;
        graphData.split.push(currentSplitSec);
        if (currentSplitSec > 0 && currentSplitSec < sessionMinSplit) sessionMinSplit = currentSplitSec;
        if (graphData.split.length > GRAPH_MAX_PTS) graphData.split.shift();

        document.getElementById('gv-split-cur').textContent = formatSplitSec(currentSplitSec);
        // FIX: split avg also uses non-zero speed from recordTicks
        document.getElementById('gv-split-avg').textContent = formatSplitSec(displayAvgSpeed > 0 ? 500 / displayAvgSpeed : 0);
        document.getElementById('gv-split-max').textContent = sessionMinSplit === 9999 ? '--:--' : formatSplitSec(sessionMinSplit);

        const validSplits = graphData.split.filter(s => s > 0 && s < 3600);
        const maxSplitScale = validSplits.length ? Math.max(150, ...validSplits) : 150;
        const minSplitScale = validSplits.length ? Math.min(90, ...validSplits) : 90;
        drawGraph('cvs-split', graphData.split, minSplitScale - 10, maxSplitScale + 10, 'split');

      } else {
        const currentAlt = live.alt !== null ? live.alt : 0;
        if (live.alt !== null) {
          graphData.alt.push(currentAlt);
          if (currentAlt > sessionMaxAlt) sessionMaxAlt = currentAlt;
          if (currentAlt < sessionMinAlt) sessionMinAlt = currentAlt;
          if (graphData.alt.length > GRAPH_MAX_PTS) graphData.alt.shift();
        }

        document.getElementById('gv-alt-cur').textContent = Math.round(currentAlt);
        document.getElementById('gv-alt-min').textContent = sessionMinAlt === 9999 ? '--' : Math.round(sessionMinAlt);
        document.getElementById('gv-alt-max').textContent = sessionMaxAlt === -9999 ? '--' : Math.round(sessionMaxAlt);

        const validAlts = graphData.alt;
        let maxAltScale = 10;
        let minAltScale = 0;
        if (validAlts.length > 0) {
          const cMax = Math.max(...validAlts);
          const cMin = Math.min(...validAlts);
          const spread = cMax - cMin;
          if (spread < 20) {
            const mid = (cMax + cMin) / 2;
            maxAltScale = mid + 10;
            minAltScale = mid - 10;
          } else {
            maxAltScale = cMax + (spread * 0.1);
            minAltScale = cMin - (spread * 0.1);
          }
        }
        drawGraph('cvs-alt', graphData.alt, minAltScale, maxAltScale, 'alt');
      }

      const ftp = sportMode === 'ROW' ? ROWING_FTP : CYCLING_FTP;
      const powerGraphMax = Math.max(ftp * 1.5, ...graphData.watts);
      drawGraph('cvs-watts', graphData.watts, 0, powerGraphMax, 'power', ftp);

      const hrGraphMax = Math.max(MAX_HR, ...graphData.hr);
      const minHrScale = Math.min(60, ...graphData.hr.filter(h => h > 0));
      drawGraph('cvs-hr', graphData.hr, minHrScale - 5, hrGraphMax + 5, 'hr');

      const maxSpeedScale = Math.max(sportMode === 'ROW' ? 5 : 12, ...graphData.speed);
      drawGraph('cvs-speed', graphData.speed, 0, maxSpeedScale, 'speed');

      const maxCadScale = Math.max(sportMode === 'ROW' ? 40 : 120, ...graphData.cadence);
      drawGraph('cvs-cadence', graphData.cadence, 0, maxCadScale, 'cadence');

    }, 1000);
  }

  function drawGraph(canvasId, data, minScale, maxScale, type, activeFTP = null) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;

    const range = maxScale - minScale || 1;
    const step = w / (GRAPH_MAX_PTS - 1);

    if (type === 'hr' || type === 'power') {
      for (let i = 0; i < data.length; i++) {
        const val = data[i];
        const x = w - ((data.length - 1 - i) * step);
        const boundedVal = Math.max(minScale, Math.min(maxScale, val));
        const y = h - (((boundedVal - minScale) / range) * h);
        ctx.fillStyle = getZoneColor(val, type, activeFTP);
        ctx.fillRect(x, y, Math.max(1.5, step), h - y);
      }
    } else {
      let grad = ctx.createLinearGradient(0, h, 0, 0);
      if (type === 'speed') { grad.addColorStop(0, 'rgba(100, 100, 100, 0.5)'); grad.addColorStop(1, 'rgba(96, 165, 250, 0.9)'); }
      else if (type === 'cadence') { grad.addColorStop(0, 'rgba(100, 100, 100, 0.5)'); grad.addColorStop(1, 'rgba(251, 191, 36, 0.9)'); }
      else if (type === 'split') { grad.addColorStop(0, 'rgba(100, 100, 100, 0.5)'); grad.addColorStop(1, 'rgba(34, 211, 238, 0.9)'); }
      else if (type === 'alt') { grad.addColorStop(0, 'rgba(100, 100, 100, 0.5)'); grad.addColorStop(1, 'rgba(52, 211, 153, 0.9)'); }
      ctx.beginPath();
      ctx.moveTo(w - ((data.length - 1) * step), h);
      for (let i = 0; i < data.length; i++) {
        const x = w - ((data.length - 1 - i) * step);
        let val = data[i];
        let y;
        if (type === 'split') {
          if (val <= 0 || val > 3600) { y = h; }
          else {
            let boundedVal = Math.max(minScale, Math.min(maxScale, val));
            y = ((boundedVal - minScale) / range) * h;
          }
        } else {
          let boundedVal = Math.max(minScale, Math.min(maxScale, val));
          y = h - (((boundedVal - minScale) / range) * h);
        }
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = w - ((data.length - 1 - i) * step);
      let val = data[i];
      let y;
      if (type === 'split') {
        if (val <= 0 || val > 3600) { y = h; }
        else {
          let boundedVal = Math.max(minScale, Math.min(maxScale, val));
          y = ((boundedVal - minScale) / range) * h;
        }
      } else {
        let boundedVal = Math.max(minScale, Math.min(maxScale, val));
        y = h - (((boundedVal - minScale) / range) * h);
      }
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.stroke();
  }

  function getZoneColor(val, type, activeFTP) {
    if (type === 'hr') {
      if (val >= THRESHOLD_HR * 1.06) return '#504861';
      if (val >= THRESHOLD_HR * 1.03) return '#6633CC';
      if (val >= THRESHOLD_HR * 1.00) return '#DD0447';
      if (val >= THRESHOLD_HR * 0.94) return '#FF7F0E';
      if (val >= THRESHOLD_HR * 0.90) return '#FFCB0E';
      if (val >= THRESHOLD_HR * 0.81) return '#009E00';
      return '#009E80';
    } else {
      if (val >= activeFTP * 1.51) return '#504861';
      if (val >= activeFTP * 1.21) return '#6633CC';
      if (val >= activeFTP * 1.06) return '#DD0447';
      if (val >= activeFTP * 0.91) return '#FF7F0E';
      if (val >= activeFTP * 0.76) return '#FFCB0E';
      if (val >= activeFTP * 0.56) return '#009E00';
      return '#009E80';
    }
  }

  function formatDistUni(d) { return sportMode === 'BIKE' ? (d/1000).toFixed(2) : Math.round(d); }

  function updateDisplay() {
    document.getElementById('uv-dist').textContent = formatDistUni(live.dist);
    document.getElementById('uv-pct').textContent = live.routePct !== null ? live.routePct.toFixed(1) : '--';
    document.getElementById('uv-gps').textContent = live.lat !== null ? `${live.lat.toFixed(4)}, ${live.lng.toFixed(4)}` : '--';
    document.getElementById('uv-laps').textContent = lapList.length;
    document.getElementById('uv-count').textContent = sportMode === 'ROW' ? (live.strokes || 0) : (live.cycles || 0);
  }

  // --- 4. FTMS ROWING SPECIFIC ---
  function setFtmsConnectionStatus(connected) {
    if (sportMode !== 'ROW') return;
    document.getElementById('uni-dot').classList.toggle('connected', connected);
    document.getElementById('uni-status-text').textContent = connected ? 'FTMS CONNECTED' : 'FTMS DISCONNECTED';
    document.getElementById('uni-btn-connect').textContent  = connected ? 'Disconnect' : 'Connect';
    if (!recording) document.getElementById('uni-btn-rec').disabled = !connected;
  }
  async function onConnectClick() { if (device && device.gatt.connected) disconnect(); else await connectFtmsBluetooth(); }
  async function connectFtmsBluetooth() {
    if (!navigator.bluetooth) { alert('Web Bluetooth requires Chrome/Edge.'); return; }
    try {
      device = await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS_SERVICE] }] });
      device.addEventListener('gattserverdisconnected', onFtmsDisconnected);
      const server = await device.gatt.connect();
      const charRow = await (await server.getPrimaryService(FTMS_SERVICE)).getCharacteristic(ROWING_DATA_CHAR);
      charRow.addEventListener('characteristicvaluechanged', onFtmsRowingData);
      await charRow.startNotifications();
      setFtmsConnectionStatus(true);
    } catch (err) { console.error('FTMS error:', err); setFtmsConnectionStatus(false); }
  }
  function disconnect() { if (device?.gatt.connected) device.gatt.disconnect(); device = null; setFtmsConnectionStatus(false); if (recording) stopRecording(); }
  function onFtmsDisconnected() { setFtmsConnectionStatus(false); if (recording) stopRecording(); }

  function onFtmsRowingData(event) {
    if (sportMode !== 'ROW') return;
    const data = event.target.value; if (data.byteLength < 5) return; live.hasData = true;
    const flags = data.getUint16(0, true); let o = 2;
    live.cadence = data.getUint8(o) / 2; o += 1; live.strokes = data.getUint16(o, true); o += 2;
    if (flags & 0x0004) { live.dist = data.getUint8(o) | (data.getUint8(o+1) << 8) | (data.getUint8(o+2) << 16); o += 3; }
    if (flags & 0x0008) { live.split = data.getUint16(o, true); o += 2; }
    if (flags & 0x0010) { o += 2; }
    if (flags & 0x0020) { live.watts = data.getInt16(o, true); o += 2; }
    live.speed = (live.split && live.split > 0) ? 500 / live.split : 0;

    // Only sync game speed from live data when not in active follow mode
    if (!followModeActive || !targetRiderId || !recording) {
      targetGameSpeed = live.speed;
    }
    updateDisplay();
  }

  // --- 5. BIKE SPECIFIC ---
  function simulateCyclingMetrics() { if (recording) { simulatedCycles += (live.cadence / 60); live.cycles = Math.floor(simulatedCycles); } }
  function closeBikeChannel() { if (bikeChannel) { bikeChannel.close(); bikeChannel = null; } }
  async function loadRouteDataOnNav() { closeBikeChannel(); setTimeout(loadRouteFromPage, 500); }

  async function loadRouteFromPage() {
    const url = new URL(location.href);
    if (!bikeChannel) { try { bikeChannel = new BroadcastChannel('biketerra-ride'); bikeChannel.onmessage = onBikeMessage; } catch (e) { console.warn('BroadcastChannel failed:', e); } }
    if (url.pathname.startsWith('/spectate')) { if (!minimised) toggleMinimise(); setRouteStatus('Spectating — overlay minimised'); return; }
    const eventId = url.searchParams.get('event');
    if (eventId) {
      setRouteStatus(`Loading event ${eventId}…`);
      try {
        const res = await fetch(`${url.origin}/events/${eventId}`, { credentials: 'include' });
        if (res.ok) {
          const html = await res.text(); const matches = [...html.matchAll(/<title>([^<]+?)\s*-\s*Biketerra<\/title>/gi)];
          const validTitles = matches.map(m => m[1].trim()).filter(t => t !== 'Ride virtually, anywhere');
          routeName = validTitles.length > 0 ? validTitles[validTitles.length - 1] : `Event ${eventId}`;
        }
      } catch (_) { routeName = `Event ${eventId}`; }
      setRouteStatus(`Event: ${routeName} | waiting for GPS…`); return;
    }
    const routeId = url.searchParams.get('route');
    if (routeId && url.pathname.includes('/ride')) { const title = document.title || ''; const match = title.match(/^Ride - (.+?) - Biketerra$/); routeName = match ? match[1] : null; setRouteStatus(routeName ? `Route: ${routeName} | waiting for GPS…` : 'Waiting for ride…'); return; }
    setRouteStatus('Navigate to a ride or event');
  }

  function onBikeMessage(event) {
    const ego = event.data?.ego; if (!ego) return;
    const riders = event.data?.riders || [];
    lastRiderList = riders;

    if (ego.lat != null) live.lat = ego.lat; if (ego.lng != null) live.lng = ego.lng;
    if (ego.elevation != null) live.alt = ego.elevation;
    if (ego.heartRate != null && ego.heartRate > 0) live.hr = ego.heartRate;
    if (ego.heartRateAvg != null && ego.heartRateAvg > 0) live.heartRateAvg = ego.heartRateAvg;

    if (ego.lapCount != null && ego.lapCount !== lastLapCount && recording) {
      lapList.push({ startIdx: lapStartIdx, endIdx: recordTicks.length, startTime: lapStartIdx === 0 ? recordStart : recordTicks[lapStartIdx].timestamp, endTime: new Date(), lapNum: lastLapCount + 1, });
      lapStartIdx = recordTicks.length; lastLapCount = ego.lapCount;
    }
    if (sportMode === 'BIKE') {
      live.hasData = true; document.getElementById('uni-btn-rec').disabled = false;
      document.getElementById('uni-dot').className = 'connected'; document.getElementById('uni-status-text').textContent = 'BC DATA ACTIVE';
      live.cadence = ego.cadence || 0; live.avgCadence = ego.cadenceAvg || 0;
      live.watts = ego.power || 0; live.avgWatts = ego.powerAvg || 0;
      live.speed = ego.speed || 0; live.avgSpeed = ego.speedAvg || 0; live.dist = ego.distance || 0;
      targetGameSpeed = live.speed;
    }

if (sportMode === 'ROW' && followModeActive && targetRiderId && recording) {
  const isOverGate = (live.watts >= powerGate);

  // Only follow if you're above the power gate
  const shouldFollow = isOverGate;

  console.log("Follow mode:", followModeActive, "Watts:", live.watts, "Power gate:", powerGate, "Should follow:", shouldFollow, "Target speed:", targetGameSpeed);

  if (shouldFollow) {
    const tr = riders.find(r => r.id === targetRiderId);
    if (tr && tr.speed !== undefined && tr.gap !== undefined) {
      // Ensure gap is reasonable (e.g., 0-10 meters)
      const gap = Math.max(0, Math.min(10, tr.gap));
      targetGameSpeed = Math.max(0, tr.speed + ((gap - 3.0) * 0.15));
      document.getElementById('uni-status-text').style.opacity = "1";
    } else {
      // Fallback to your own speed if target data is invalid
      targetGameSpeed = live.speed;
    }
  } else {
    // If not following, use your own speed
    targetGameSpeed = live.speed;
  }
} else {
  // If not in follow mode, use your own speed
  targetGameSpeed = live.speed;
}
    if (ego.distance != null && ego.distanceRemaining != null) {
      const currentLapIndex = ego.lapCount || 0; const totalAccDistance = ego.distance + ego.distanceRemaining;
      if (totalAccDistance > 0) {
        const singleLapLength = totalAccDistance / (currentLapIndex + 1); const currentLapDistance = ego.distance - (currentLapIndex * singleLapLength);
        routeLength = singleLapLength; live.routePct = Math.min(100, Math.max(0, (currentLapDistance / singleLapLength) * 100));
      }
    }
    const nameStr = routeName ? routeName : 'route'; const distForRoute = sportMode === 'ROW' ? routeLength : (routeLength/1000);
    const unitForRoute = sportMode === 'ROW' ? 'm' : 'km'; const distStr = distForRoute ? ` ${distForRoute.toFixed( sportMode === 'ROW' ? 0 : 2)}${unitForRoute}` : '';
    const pctStr = live.routePct != null ? ` ${live.routePct.toFixed(1)}%` : '';
    setRouteStatus(`${nameStr}${distStr}${pctStr}`);

    updateDisplay();
  }

  function updateGameBreakpointStatus() {
    const el = document.getElementById('uni-route-status'); if (!el || sportMode !== 'ROW') return;
    const base = el.textContent.split(' | ')[0]; const gm = unsafeWindow.gameManager; const isEngineRunning = !!(gm?.ego?.entity?.state);
    const suffix = isEngineRunning ? ` | game speed sync: ACTIVE` : ` | game speed sync: BP MISSING`; el.textContent = base + suffix;
  }

  function setRouteStatus(msg) { const el = document.getElementById('uni-route-status'); if (el) el.textContent = msg; }
  function toggleMinimise() { minimised = !minimised; document.getElementById('universal-overlay').classList.toggle('minimised', minimised); document.getElementById('uni-btn-min').textContent = minimised ? '+' : '—'; }

  // --- 6. RECORDING ---
  function onRecordClick() { if (recording) stopRecording(); else startRecording(); }
  function startRecording() {
    recording = true; recordStart = new Date(); recordTicks = [];
    lastLapCount = 0; lapStartIdx = 0; lapList = []; simulatedCycles = 0;
    setRecordingStatus(true);
    tickInterval = setInterval(() => {
      if (sportMode === 'BIKE') simulateCyclingMetrics();
      const count = sportMode === 'ROW' ? (live.strokes || 0) : (live.cycles || 0);
      recordTicks.push({ timestamp: new Date(), lat: live.lat, lng: live.lng, alt: live.alt, hr: live.hr || 0, power: Math.round(live.watts || 0), cadence: Math.round(live.cadence || 0), dist: live.dist || 0, speed: live.speed || 0, count: count });
      const elapsed = Math.floor((Date.now() - recordStart) / 1000);
      document.getElementById('uni-rec-time').textContent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
      if (sportMode === 'ROW') updateGameBreakpointStatus();
    }, 1000);
  }

  function stopRecording() {
    clearInterval(tickInterval); tickInterval = null; recording = false; setRecordingStatus(false);
    let fitBuffer = null;
    try { if (recordTicks.length > 0) { fitBuffer = encodeFIT(recordTicks, recordStart); downloadFIT(fitBuffer, recordStart); } } catch (e) { console.error("FIT error:", e); }
    try { showSummaryModal(fitBuffer); } catch (e) { console.error("Modal error:", e); }
  }

  // --- 7. MODAL ---
  function showSummaryModal(fitBuffer) {
    let bg = document.getElementById('uni-summary-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'uni-summary-bg'; bg.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); z-index: 9999999; display: none; align-items: center; justify-content: center; overflow-y: auto; padding: 20px;"; document.body.appendChild(bg); }
    const n = recordTicks.length || 1; const elapsedS = Math.floor((Date.now() - recordStart) / 1000);
    const mm = String(Math.floor(elapsedS / 60)).padStart(2, '0'); const ss = String(elapsedS % 60).padStart(2, '0');
    const totalDistRaw = recordTicks.length ? recordTicks[n-1].dist : 0; const distStr = sportMode === 'ROW' ? `${Math.round(totalDistRaw)} m` : `${(totalDistRaw/1000).toFixed(2)} km`;

    // FIX: exclude zeros from all averages in summary modal
    const wattsArr   = recordTicks.map(t => t.power).filter(v => v > 0);
    const cadArr     = recordTicks.map(t => t.cadence).filter(v => v > 0);
    const speedArr   = recordTicks.map(t => t.speed).filter(v => v > 0);
    const hrArr      = recordTicks.map(t => t.hr).filter(v => v > 0);

    const avgWatts   = wattsArr.length   ? Math.round(wattsArr.reduce((a, b) => a + b, 0)   / wattsArr.length)   : 0;
    const avgCadence = cadArr.length     ? Math.round(cadArr.reduce((a, b) => a + b, 0)     / cadArr.length)     : 0;
    const avgSpeed   = speedArr.length   ? speedArr.reduce((a, b) => a + b, 0) / speedArr.length                 : 0;
    const avgHr      = hrArr.length      ? Math.round(hrArr.reduce((a, b) => a + b, 0)      / hrArr.length)      : 0;

    let speedRowStr = ""; if (sportMode === 'ROW') { const split = avgSpeed > 0 ? 500/avgSpeed : 0; speedRowStr = `${Math.floor(split/60)}:${String(Math.floor(split%60)).padStart(2, '0')} <span style="font-size:11px;color:#888;">/500m avg</span>`; } else { speedRowStr = `${(avgSpeed * 3.6).toFixed(1)} <span style="font-size:11px;color:#888;">km/h avg</span>`; }
    const startCount = recordTicks[0].count; const endCount = recordTicks[n-1].count; let totalCount = endCount - startCount; const countLabel = sportMode === 'ROW' ? 'Strokes' : 'Cycles';
    const mapHTML = generateMapSvgHTML();
    const dualStat = (lbl, val, unt) => `<div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;"><div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; margin-bottom: 2px;">${lbl}</div><div style="font-size: 20px; font-weight: 600;">${val} <span style="font-size:11px;color:#888;">${unt}</span></div></div>`;
    bg.innerHTML = `<div id="uni-summary-box" style="background: #1A1A1A; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; padding: 24px; width: 400px; max-width: 90vw; font-family: -apple-system, sans-serif; color: #fff; box-shadow: 0 20px 40px rgba(0,0,0,0.8);"><div style="font-size: 11px; color: #aaa; text-align: center; margin-bottom: 2px;">${sportMode} WORKOUT</div><div id="sum-title" style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #5DCAA5; text-align: center;">${routeName || 'Workout Complete'}</div>${mapHTML}<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;"><div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; text-align: center;"><div style="font-size: 11px; color: rgba(255,255,255,0.45); text-transform: uppercase;">Time</div><div style="font-size: 24px; font-weight: 600; margin: 4px 0 2px 0;">${mm}:${ss}</div></div><div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; text-align: center;"><div style="font-size: 11px; color: rgba(255,255,255,0.45); text-transform: uppercase;">Distance</div><div style="font-size: 24px; font-weight: 600; margin: 4px 0 2px 0;">${distStr}</div></div></div><div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">${dualStat('Power', avgWatts, 'W avg')}${dualStat('Cadence', avgCadence, sportMode === 'ROW'?'SPM':'RPM')}${dualStat('Heart Rate', avgHr, 'BPM avg')}<div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;"><div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; margin-bottom: 2px;">Speed</div><div style="font-size: 20px; font-weight: 600;">${speedRowStr}</div></div><div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;"><div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; margin-bottom: 2px;">${countLabel}</div><div style="font-size: 20px; font-weight: 600;">${Math.round(totalCount)}</div></div><div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;"><div style="font-size: 10px; color: rgba(255,255,255,0.45); text-transform: uppercase; margin-bottom: 2px;">Laps</div><div style="font-size: 20px; font-weight: 600;">${lapList.length}</div></div></div><div style="display: flex; gap: 8px;"><button id="uni-summary-close" style="flex: 1; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; border: none; font-weight: 600; font-size: 12px; cursor: pointer;">Close</button><button id="uni-summary-upload" style="flex: 1.5; padding: 10px; border-radius: 8px; background: #5DCAA5; color: #000; border: none; font-weight: 600; font-size: 12px; cursor: pointer;">Intervals.icu</button><button id="uni-summary-strava" style="flex: 1.5; padding: 10px; border-radius: 8px; background: rgba(252, 76, 2, 0.2); color: #FC4C02; border: 1px solid #FC4C02; font-weight: 600; font-size: 12px; cursor: pointer;">Strava</button></div></div>`;
    document.getElementById('uni-summary-close').addEventListener('click', () => { bg.style.display = 'none'; });
    const upBtn = document.getElementById('uni-summary-upload'); const newUpBtn = upBtn.cloneNode(true); upBtn.parentNode.replaceChild(newUpBtn, upBtn);
    newUpBtn.addEventListener('click', () => { if (fitBuffer) uploadToIntervals(fitBuffer, recordStart, newUpBtn); });
    const stravaBtn = document.getElementById('uni-summary-strava'); const newStravaBtn = stravaBtn.cloneNode(true); stravaBtn.parentNode.replaceChild(newStravaBtn, stravaBtn);
    newStravaBtn.addEventListener('click', () => { if (fitBuffer) uploadToStrava(fitBuffer, recordStart, newStravaBtn); });
    bg.style.display = 'flex';
  }

  function generateMapSvgHTML() {
    const gpsTicks = recordTicks.filter(t => t.lat != null && t.lng != null); if (gpsTicks.length < 3) return "";
    const minLat = Math.min(...gpsTicks.map(t => t.lat)), maxLat = Math.max(...gpsTicks.map(t => t.lat)), minLng = Math.min(...gpsTicks.map(t => t.lng)), maxLng = Math.max(...gpsTicks.map(t => t.lng));
    const latRange = (maxLat - minLat) || 0.0001, lngRange = (maxLng - minLng) || 0.0001, w = 360, h = 140, pad = 15;
    const scale = Math.min((w - pad * 2) / lngRange, (h - pad * 2) / latRange); const cx = (w - lngRange * scale) / 2, cy = (h - latRange * scale) / 2;
    const pts = gpsTicks.map(t => `${(cx + (t.lng - minLng) * scale).toFixed(1)},${(h - cy - (t.lat - minLat) * scale).toFixed(1)}`);
    return `<div style="margin-bottom: 16px;"><svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: ${h}px; background: rgba(0,0,0,0.25); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);"><path d="M${pts.join(' L')}" fill="none" stroke="#5DCAA5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  }

  // --- 8. UPLOAD ---
  function uploadToIntervals(fitBuffer, startTime, btnElement) {
    btnElement.textContent = "Uploading..."; btnElement.disabled = true; const sportPrefix = sportMode === 'ROW' ? 'rowing' : 'cycling';
    const filename = `${sportPrefix}_${startTime.toISOString().slice(0,19).replace(/[T:]/g, '-')}.fit`;
    const formData = new FormData(); formData.append('file', new Blob([fitBuffer]), filename);
    GM_xmlhttpRequest({ method: "POST", url: `https://intervals.icu/api/v1/athlete/${INTERVALS_ID}/activities`, headers: { "Authorization": "Basic " + btoa("API_KEY:" + INTERVALS_API_KEY) }, data: formData, onload: function(r) { if (r.status >= 200 && r.status < 300) { btnElement.textContent = "Uploaded!"; btnElement.style.background = "#4CAF50"; } else { btnElement.textContent = "Error"; } } });
  }

  function uploadToStrava(fitBuffer, startTime, btnElement) {
    btnElement.textContent = "Auth..."; btnElement.disabled = true;
    GM_xmlhttpRequest({
      method: "POST", url: `https://www.strava.com/oauth/token?client_id=${STRAVA_CLIENT_ID}&client_secret=${STRAVA_CLIENT_SECRET}&grant_type=refresh_token&refresh_token=${STRAVA_REFRESH_TOKEN}`,
      onload: function(r) {
        try {
          const accessToken = JSON.parse(r.responseText).access_token; const formData = new FormData();
          formData.append('file', new Blob([fitBuffer]), `workout_${startTime.getTime()}.fit`);
          const sportPrefix = sportMode === 'ROW' ? 'Rowterra' : 'Biketerra'; formData.append('name', routeName ? `${sportPrefix} - ${routeName}` : 'Virtual Workout'); formData.append('data_type', 'fit');
          GM_xmlhttpRequest({ method: "POST", url: "https://www.strava.com/api/v3/uploads", headers: { "Authorization": `Bearer ${accessToken}` }, data: formData, onload: function(ur) { if (ur.status >= 200 && ur.status < 300) { btnElement.textContent = "Uploaded!"; btnElement.style.background = "#FC4C02"; } else { btnElement.textContent = "Error"; } } });
        } catch(e) { btnElement.textContent = "Auth Error"; }
      }
    });
  }

  // --- 9. FIT ENCODER ---
  function encodeFIT(ticks, startTime) {
    const FIT_EPOCH = 631065600; const toFT = d => Math.round(d.getTime() / 1000) - FIT_EPOCH; const toSC = deg => deg !== null ? Math.round(deg * 11930465) : 0x7FFFFFFF;
    const msgs = [];
    function defMsg(l, g, f) { const b = new Uint8Array(6 + f.length * 3); b[0] = 0x40 | l; b[3] = g & 0xFF; b[4] = (g >> 8) & 0xFF; b[5] = f.length; for (let i=0; i<f.length; i++) { b[6+i*3] = f[i][0]; b[7+i*3] = f[i][1]; b[8+i*3] = f[i][2]; } return b; }
    function dataMsg(l, vals) { const ab = new ArrayBuffer(1 + vals.reduce((s, v) => s + v.size, 0)); const dv = new DataView(ab); dv.setUint8(0, l & 0x0F); let o = 1; for (const v of vals) { if (v.size === 1) dv.setUint8(o, v.val); else if (v.size === 2) dv.setUint16(o, v.val, true); else if (v.size === 4) dv.setUint32(o, v.val, true); o += v.size; } return new Uint8Array(ab); }
    const u8 = val => ({ size: 1, val }), u16 = val => ({ size: 2, val: Math.min(65535, Math.max(0, Math.round(val))) }), u32 = val => ({ size: 4, val: Math.max(0, Math.round(val)) }), s32 = val => ({ size: 4, val: val < 0 ? val + 0x100000000 : val });
    msgs.push(defMsg(0, 0, [[0,2,0x84],[1,2,0x84],[2,2,0x84],[4,4,0x86]])); msgs.push(dataMsg(0, [u16(4), u16(255), u16(1), u32(toFT(startTime))]));
    msgs.push(defMsg(1, 20, [[253,4,0x86],[0,4,0x85],[1,4,0x85],[2,2,0x84],[3,1,0x02],[4,1,0x02],[5,4,0x86],[6,2,0x84],[7,2,0x84],[19,4,0x86],[73,4,0x86]]));
    for (const t of ticks) msgs.push(dataMsg(1, [u32(toFT(t.timestamp)), s32(toSC(t.lat)), s32(toSC(t.lng)), u16(t.alt !== null ? t.alt * 5 + 500 : 0xFFFF), u8(t.hr), u8(t.cadence), u32(t.dist * 100), u16(t.speed * 1000), u16(t.power), u32(t.count), u32(t.speed * 1000)]));
    const lastT = ticks[ticks.length - 1], maxP = Math.max(...ticks.map(t => t.power), 0), avgP = Math.round(ticks.reduce((s,t)=>s+t.power,0)/ticks.length);
    const hrT = ticks.filter(t=>t.hr>0); const avgH = hrT.length ? Math.round(hrT.reduce((s,t)=>s+t.hr,0)/hrT.length) : 0, maxH = Math.max(...ticks.map(t=>t.hr), 0);
    const fitSportId = sportMode === 'ROW' ? 15 : 2;
    msgs.push(defMsg(2, 19, [[253,4,0x86],[2,4,0x86],[7,4,0x86],[8,4,0x86],[9,4,0x86],[10,4,0x86],[15,1,0x02],[16,1,0x02],[19,2,0x84],[25,1,0x02],[26,1,0x02]]));
    const allLaps = [...lapList, { startIdx: lapStartIdx, endIdx: ticks.length, startTime: lapStartIdx === 0 ? startTime : ticks[lapStartIdx]?.timestamp || startTime, endTime: lastT.timestamp }];
    for (const lap of allLaps) {
      const slice = ticks.slice(lap.startIdx, lap.endIdx); if (slice.length < 1) continue;
      const lapDurS = Math.max(1, Math.round((lap.endTime - lap.startTime)/1000)); const lSliceHr = slice.filter(t => t.hr > 0); const lAvgH = lSliceHr.length ? Math.round(lSliceHr.reduce((s,t)=>s+t.hr,0)/lSliceHr.length) : 0;
      const lMaxH = Math.max(...slice.map(t=>t.hr), 0); const lAvgP = Math.round(slice.reduce((s,t)=>s+t.power,0)/slice.length); const lapDist = Math.round((slice[slice.length-1].dist - slice[0].dist) * 100); const lapCount = slice[slice.length-1].count - slice[0].count;
      msgs.push(dataMsg(2, [u32(toFT(lap.endTime)), u32(toFT(lap.startTime)), u32(lapDurS*1000), u32(lapDurS*1000), u32(lapDist), u32(lapCount > 0 ? lapCount : 0), u8(lAvgH), u8(lMaxH), u16(lAvgP), u8(fitSportId), u8(58)]));
    }
    const durS = Math.round((lastT.timestamp - startTime)/1000);
    msgs.push(defMsg(3, 18, [[253,4,0x86],[0,2,0x84],[1,1,0x02],[2,4,0x86],[5,1,0x02],[6,1,0x02],[7,4,0x86],[8,4,0x86],[9,4,0x86],[11,4,0x86],[14,1,0x02],[15,1,0x02],[20,2,0x84],[21,2,0x84],[25,2,0x84]]));
    msgs.push(dataMsg(3, [u32(toFT(lastT.timestamp)), u16(8), u8(1), u32(toFT(startTime)), u8(fitSportId), u8(58), u32(durS*1000), u32(durS*1000), u32(lastT.dist*100), u32(lastT.count), u8(avgH), u8(maxH), u16(avgP), u16(maxP), u16(allLaps.length)]));
    msgs.push(defMsg(4, 34, [[253,4,0x86],[0,4,0x86],[1,2,0x84],[2,1,0x02],[3,1,0x02],[4,1,0x02]])); msgs.push(dataMsg(4, [u32(toFT(lastT.timestamp)), u32(durS*1000), u16(1), u8(0), u8(26), u8(1)]));
    const activityNameStr = (routeName ? (sportMode === 'ROW' ? 'Rowterra' : 'Biketerra') + ' - ' + routeName : 'Virtual Workout').slice(0, 15); const nameEnc = new TextEncoder().encode(activityNameStr + '\0');
    msgs.push(defMsg(5, 26, [[254, 2, 0x84], [8, nameEnc.length, 0x07]])); const wDat = new ArrayBuffer(1 + 2 + nameEnc.length); const wDv = new DataView(wDat); wDv.setUint8(0, 5); wDv.setUint16(1, 0, true); for(let i=0; i<nameEnc.length; i++) wDv.setUint8(3+i, nameEnc[i]); msgs.push(new Uint8Array(wDat));
    const totalDataLen = msgs.reduce((s, m) => s + m.length, 0); const buf = new Uint8Array(12 + totalDataLen + 2); const dv = new DataView(buf.buffer); buf[0] = 12; buf[1] = 0x10; dv.setUint16(2, 2132, true); dv.setUint32(4, totalDataLen, true); buf[8] = 0x2E; buf[9] = 0x46; buf[10] = 0x49; buf[11] = 0x54; let pos = 12; for (const m of msgs) { buf.set(m, pos); pos += m.length; } dv.setUint16(pos, fitCRC(buf, 0, pos), true); return buf;
  }
  function fitCRC(data, start, end) { const T = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400]; let crc = 0; for (let i = start; i < end; i++) { const byte = data[i]; let tmp = T[crc & 0x0F]; crc = (crc >> 4) & 0x0FFF; crc ^= tmp ^ T[byte & 0x0F]; tmp = T[crc & 0x0F]; crc = (crc >> 4) & 0x0FFF; crc ^= tmp ^ T[(byte >> 4) & 0x0F]; } return crc; }
  function downloadFIT(buf, startTime) { const url = URL.createObjectURL(new Blob([buf])); const a = document.createElement('a'); a.href = url; const sportPrefix = sportMode === 'ROW' ? 'rowing' : 'cycling'; a.download = `${sportPrefix}_${startTime.toISOString()}.fit`; document.body.appendChild(a); a.click(); document.body.removeChild(a); }

  // --- 10. SPEED SYNC ---
  let speedSyncActive = false; let internalGameSpeed = 0;
  function startSpeedSyncLoop() {
    if (speedSyncActive || sportMode !== 'ROW') return; speedSyncActive = true; let lastTime = performance.now();
// Inside the startSpeedSyncLoop function:
function updateSpeed(time) {
  if (!speedSyncActive) return;
  requestAnimationFrame(updateSpeed);
  const dt = (time - lastTime) / 1000;
  lastTime = time;
  if (dt > 0.1 || dt <= 0) return;

  try {
    const gm = (unsafeWindow.gameManager);
    if (gm && gm.ego && gm.ego.entity && gm.ego.entity.state) {
      const diff = targetGameSpeed - internalGameSpeed;
      const maxDelta = 3.0 * dt;
      if (Math.abs(diff) <= maxDelta) {
        internalGameSpeed = targetGameSpeed;
      } else {
        internalGameSpeed += Math.sign(diff) * maxDelta;
      }
      gm.ego.entity.state.speed = internalGameSpeed;
    }
  } catch (_) {}
}
      requestAnimationFrame(updateSpeed);
  }

  (function watchNavigation() { let lastHref = location.href; setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; loadRouteDataOnNav(); } }, 1000); })();
  function init() { if (document.getElementById('universal-overlay')) return; buildOverlay(); setTimeout(loadRouteFromPage, 2000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
