// ==UserScript==
// @name         Biketerra - Riderlist replacement HUD
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  HUD with dynamic lap tracking, lap distance, and lapped rider detection
// @author       You
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- Spectate function ---
    window.spectateRiderById = function(riderId) {
        if (!window.gameManager) return;
        if (!riderId) return;
        const cleanedRider = window.hackedRiders.find(r => r.riderId == riderId);
        const fn = window.gameManager.setFocalRider;
        if (typeof fn === 'function') {
            fn.call(window.gameManager, riderId);
            console.log(`📡 Spectating: ${cleanedRider?.name || "Unknown"} (ID: ${riderId})`);
        }
    };

    // --- Hide original list ---
    function hideOriginalRiderList() {
        const original = document.querySelector('.riders-main');
        if (original) original.style.display = 'none';
        else setTimeout(hideOriginalRiderList, 500);
    }
    hideOriginalRiderList();

    // --- HUD Container ---
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        width: 20vw;
        min-width: 350px;
        background: rgba(0,0,0,0.5);
        color: #00ffcc;
        font-family: "Overpass", sans-serif;
        font-size: 12px;
        padding: 10px;
        z-index: 1;
        border-radius: 8px;
        max-height: 65vh;
        overflow-y: auto;
    `;
    container.innerHTML = `
        <span id="status-light" style="color:red;">●</span>
        <table style="width:100%; border-collapse:collapse;">
            <thead>
                <tr style="text-align:left; color:#fff;">
                    <th>Name</th>
                    <th>Power</th>
                    <th>Speed</th>
                    <th>W/kg</th>
                    <th>Gap</th>
                    <th>Dist</th>
                    <th>Lap</th>
                </tr>
            </thead>
            <tbody id="rider-table-body">
                <tr><td colspan="7" style="text-align:center; color:#888;">Waiting for breakpoint...</td></tr>
            </tbody>
        </table>
    `;
    document.body.appendChild(container);

    const tbody = document.getElementById('rider-table-body');
    const statusLight = document.getElementById('status-light');

    // --- Lap tracking ---
    window.__lapTracker = window.__lapTracker || {};
    const LAP_THRESHOLD = 1000; // distance drop to detect lap reset

    setInterval(() => {
        if (!window.hackedRiders) {
            statusLight.innerText = "●";
            statusLight.style.color = "orange";
            return;
        }

        let riders = [...window.hackedRiders];

        // Update laps dynamically
        let leaderLap = 0;
        riders.forEach(r => {
            const dist = r.dist;
            const id = r.riderId;

            if (!window.__lapTracker[id]) {
                window.__lapTracker[id] = { lap: 1, lastDist: dist };
            }

            const tracker = window.__lapTracker[id];

            if (dist < tracker.lastDist - LAP_THRESHOLD) {
                tracker.lap++;
            }

            tracker.lastDist = dist;
            r.lap = tracker.lap;
            r.lapDistance = dist >= 0 ? dist : (tracker.lastDist + dist + LAP_THRESHOLD);

            if (tracker.lap > leaderLap) leaderLap = tracker.lap;
        });

        // Sort by lap DESC, lapDistance DESC
        riders.sort((a, b) => {
            if (b.lap !== a.lap) return b.lap - a.lap;
            return b.lapDistance - a.lapDistance;
        });

        statusLight.innerText = "●";
        statusLight.style.color = "#00ff00";

        // --- Build table ---
        let html = '';
        riders.forEach(r => {
            const name = r.name || "Unknown";
            const dist = r.lapDistance.toFixed(2);
            const speed = (r.speed * 3.6).toFixed(1);
            const power = Math.round(r.power);
            const wkg = r.wkg.toFixed(1);

            // Compute Gap
            let gapText;
            if (r.lap < leaderLap) gapText = `+${leaderLap - r.lap} Lap${leaderLap - r.lap > 1 ? "s" : ""}`;
            else {
                const gapMeters = r.lapDistance - riders[0].lapDistance;
                if (gapMeters === 0) gapText = "0m";
                else gapText = `${Math.round(gapMeters)}m`;
            }

            // Color W/kg
            let wkgColor = '#fff';
            if (r.wkg >= 10.0) wkgColor = '#ff4444';
            else if (r.wkg >= 3.5) wkgColor = '#ffcc00';

            const rowStyle = r.isMe
                ? "border-bottom:1px solid #333; background:rgba(255,98,98,0.8); cursor:default;"
                : "border-bottom:1px solid #333; cursor:pointer;";

            html += `
                <tr style="${rowStyle}" onclick="window.spectateRiderById(${r.riderId || 0})">
                    <td style="padding:4px; color:#fff;">${name}</td>
                    <td style="padding:4px;color:#fff; font-family:Overpass Mono, monospace;">${power}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;">${speed}</td>
                    <td style="padding:4px;color:${wkgColor}; font-weight:bold; font-family:Overpass Mono, monospace;">${wkg}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;">${gapText}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;">${dist}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;">${r.lap}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

    }, 500);

})();
