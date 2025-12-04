// ==UserScript==
// @name         Biketerra - Riderlist replacement HUD
// @namespace    http://tampermonkey.net/
// @version      11.0
// @description  FINAL: HUD with accurate metrics, dynamic lap tracking, and spectate functionality (URL aware).
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
        // Only run if the URL contains '/spectate' AND gameManager is exposed
        if (!window.location.href.includes('/spectate') || !window.gameManager) {
             // We do nothing if not in spectate mode or if the data source is missing
             return;
        }

        if (!riderId || riderId === 0) {
            console.warn("Spectate failed: Invalid or null Rider ID.");
            return;
        }

        const cleanedRider = window.hackedRiders.find(r => r.riderId == riderId);

        // --- FINAL FUNCTION CALL ---
        // We use the most probable minified function: 'B' (which takes the ID).
        const spectateFn = window.gameManager.B;

        if (typeof spectateFn === 'function') {
            // Call the function, passing the Rider ID (r.athleteId)
            spectateFn.call(window.gameManager, riderId);
            console.log(`📡 Spectating: ${cleanedRider?.name || "Unknown"} (ID: ${riderId})`);
        } else {
            // This is the error message if 'B' is the wrong letter
            console.error("❌ Spectate function (B) not found. Check console for correct letter.");
        }
    };

    // --- Hide original list ---
    function hideOriginalRiderList() {
        // Hides the element that contains the original rider list
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
                    <th style="padding:2px;">Name</th>
                    <th style="padding:2px;">Power</th>
                    <th style="padding:2px;">Speed</th>
                    <th style="padding:2px;">W/kg</th>
                    <th style="padding:2px;">Gap</th>
                    <th style="padding:2px;">Dist</th>
                    <th style="padding:2px;">Lap</th>
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

    // --- Lap tracking state ---
    window.__lapTracker = window.__lapTracker || {};
    const LAP_THRESHOLD = 1000; // distance drop to detect lap reset

    setInterval(() => {
        if (!window.hackedRiders) {
            statusLight.innerText = "●";
            statusLight.style.color = "orange";
            return;
        }

        let riders = [...window.hackedRiders];
        let leaderLap = 0;

        // Update laps dynamically
        riders.forEach(r => {
            const dist = r.dist;
            const id = r.riderId;

            if (!window.__lapTracker[id]) {
                window.__lapTracker[id] = { lap: 1, lastDist: dist };
            }

            const tracker = window.__lapTracker[id];

            // If distance suddenly drops, assume a lap finished
            if (dist < tracker.lastDist - LAP_THRESHOLD) {
                tracker.lap++;
            }

            tracker.lastDist = dist;
            r.lap = tracker.lap;
            // Calculate distance into current lap (or use total dist if it's not a loop)
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
        const currentLeaderDist = riders[0]?.lapDistance || 0;

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
                // Gap is relative to the current leader on the same lap
                const gapMeters = r.lapDistance - currentLeaderDist;
                if (gapMeters === 0) gapText = "0m";
                else gapText = `${Math.round(gapMeters)}m`;
            }

            // Color W/kg
            let wkgColor = '#fff';
            if (r.wkg >= 10.0) wkgColor = '#ff4444';
            else if (r.wkg >= 3.5) wkgColor = '#ffcc00';

// --- Helmet Color Cascade Logic (FINAL & SAFE) ---
const helmetColor =
    r.entity?.design?.helmet_color ||   // ✅ Local live 3D rider (YOU + nearby riders)
    r.config?.design?.helmet_color ||   // ✅ Network config fallback
    '#444444';                          // ✅ Hard fallback

// Convert HEX → RGBA for readable transparent background
let bgColor = helmetColor;

if (helmetColor.startsWith('#') && helmetColor.length === 7) {
    const rC = parseInt(helmetColor.slice(1, 3), 16);
    const gC = parseInt(helmetColor.slice(3, 5), 16);
    const bC = parseInt(helmetColor.slice(5, 7), 16);
    bgColor = `rgba(${rC}, ${gC}, ${bC}, 0.6)`;
}

const rowStyle = `
    border-bottom: 1px solid #333;
    background: ${bgColor};
    cursor: ${r.isMe ? "default" : "pointer"};
`;


            html += `
                <tr style="${rowStyle}" onclick="window.spectateRiderById(${r.riderId || 0})">
                    <td style="padding:4px; color:#fff;text-shadow: 1px 1px 4px #000">${name}</td>
                    <td style="padding:4px;color:#fff; font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${power}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${speed}</td>
                    <td style="padding:4px;color:${wkgColor}; font-weight:bold; font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000;">${wkg}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${gapText}</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${dist}m</td>
                    <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${r.lap}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

    }, 500); // Increased update frequency for better tracking

})();
