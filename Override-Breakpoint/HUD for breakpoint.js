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
// ===== USER CONFIG =====
const LOCAL_RIDER_NAME = "SET-YOUR-Name";   // <-- Change this to anything you want
// =======================

// --- Global Function to Handle Spectate Click ---
// Default NO-OP so /ride pages never throw errors
window.spectateRiderById = function(riderId) {
    console.warn("Spectate disabled on non-spectate pages.");
};

// ONLY override on /spectate pages
if (location.href.startsWith("https://biketerra.com/spectate")) {
    window.spectateRiderById = function(riderId) {
        if (!window.gameManager) {
            console.error("Game Manager not exposed. Is breakpoint active?");
            return;
        }
        // We use the ID directly as the spectate function expects the athleteId
        if (!riderId) {
             console.warn("Cannot spectate: Rider ID is null or undefined.");
             return;
        }
        // 1. Find the CLEANED rider object (for logging the name)
        const cleanedRider = window.hackedRiders.find(r => r.riderId == riderId);
        // 2. --- HACK: Identify and call the spectate function ---
        let spectateFn = null;
        let functionName = 'setFocalRider'; // Start with the strongest candidate
        // We check for the function directly
        if (typeof window.gameManager[functionName] === 'function') {
             spectateFn = window.gameManager.setFocalRider;
        } else {
            // The brute-force check logic failed before, so we must rely on the user testing candidates.
            console.error(`❌ Spectate function failed: window.gameManager.${functionName} not found.`);
            return;
        }
        // Final Function Call
        if (typeof spectateFn === 'function') {
            // Call the function, passing the Rider ID (r.athleteId)
            spectateFn.call(window.gameManager, riderId);
            // Log the name from the CLEANED object
            console.log(`📡 Spectating: ${cleanedRider ? cleanedRider.name : "Unknown Rider"} (ID: ${riderId})`);
        }
    };
}
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
            const name = r.isMe ? LOCAL_RIDER_NAME : (r.name || "Unknown");
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

let helmetColor = "#444444"; // default fallback

if (r.isMe) {
    // Local rider / focalRider
    const me = window.gameManager?.focalRider;
    helmetColor = me?.entity?.design?.helmet_color
               || me?.config?.design?.helmet_color
               || me?.helmet_color
               || helmetColor;
} else {
    // Other riders
    const gmHumans = window.gameManager?.humans || {};
    if (gmHumans[r.riderId]?.config?.design?.helmet_color) {
        helmetColor = gmHumans[r.riderId].config.design.helmet_color;
    } else {
        // fallback search
        for (const h of Object.values(gmHumans)) {
            if ((h.athleteId || h.id) === r.riderId) {
                helmetColor = h.config?.design?.helmet_color || helmetColor;
                break;
            }
        }
    }
}

// Convert hex to rgba for semi-transparent background
let bgColor = helmetColor;
if (helmetColor.startsWith('#') && helmetColor.length === 7) {
    const rC = parseInt(helmetColor.slice(1,3),16);
    const gC = parseInt(helmetColor.slice(3,5),16);
    const bC = parseInt(helmetColor.slice(5,7),16);
    bgColor = `rgba(${rC},${gC},${bC},0.6)`;
}



            const rowStyle = `
                border-bottom:1px solid #333;
                background:${bgColor};
                cursor:${r.isMe ? "default" : "pointer"};
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
