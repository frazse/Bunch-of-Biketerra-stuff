// ==UserScript==
// @name         Biketerra HUD (Final)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  FINAL: Adds accurate metrics, sorting, and stable spectating functionality.
// @author       You
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- Global Function to Handle Spectate Click ---
    // This function calls the public wrapper function (assumed to be 'B')
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
    // ----------------------------------------------------

    // Function to hide the element
    function hideOriginalRiderList() {
        const originalList = document.querySelector('.riders-main');
        if (originalList) {
            originalList.style.display = 'none';
        } else {
            setTimeout(hideOriginalRiderList, 500);
        }
    }
    hideOriginalRiderList();

    // --- 1. Create the UI Overlay (using your custom styling) ---
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        width: 20vw;
        min-width: 350px;
        background: rgba(0, 0, 0, 0.5);
        color: #00ffcc;
        font-family: "Overpass", sans-serif;
        font-size: 12px;
        padding: 10px;
        z-index: 1;
        border-radius: 8px;
        max-height: 65vh;
        overflow-y: auto;
    `;

    // UPDATED TABLE HEADERS
    container.innerHTML = `
        <span id="status-light" style="color: red; text-align: right;">●</span>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="text-align: left; color: #fff;">
                    <th style="padding: 2px;">Name</th>
                    <th style="padding: 2px;">Power</th>
                    <th style="padding: 2px;">Speed</th>
                    <th style="padding: 2px;">W/kg</th>
                    <th style="padding: 2px;">Gap</th>
                    <th style="padding: 2px;">Dist</th>
                </tr>
            </thead>
            <tbody id="rider-table-body">
                <tr><td colspan="4" style="text-align: center; color: #888; padding: 10px;">Waiting for breakpoint...</td></tr>
            </tbody>
        </table>
    `;
    document.body.appendChild(container);

    // --- 2. The Scanner Logic ---
    const tbody = document.getElementById('rider-table-body');
    const statusLight = document.getElementById('status-light');

    setInterval(() => {
        if (!window.hackedRiders) {
            statusLight.innerText = "●";
            statusLight.style.color = "orange";
            return;
        }

        let riders = [...window.hackedRiders];

        // Sort by Distance (Highest first)
        if (riders.length > 1) {
            riders.sort((a, b) => b.dist - a.dist);
        }

        statusLight.innerText = `●`;
        statusLight.style.color = "#00ff00";

        let html = '';
        riders.forEach(r => {
            const name = r.name || "Unknown";
            const dist = r.dist.toFixed(2);
            const speed = (r.speed * 3.6).toFixed(1);
            const power = Math.round(r.power);

            const wkg = r.wkg.toFixed(1);
            let gap = r.distanceFromMe;
            let gapText;

            // Format Gap Text
            if (gap === 0) {
                gapText = "0m";
            } else if (gap > 0) {
                gapText = `+${Math.round(gap)}m`; // Ahead
            } else {
                gapText = `${Math.round(gap)}m`; // Behind
            }

            // Color code W/kg (W/kg > 5 is red, W/kg > 3.5 is yellow)
            let wkgColor = '#fff';
            if (r.wkg >= 10.0) wkgColor = '#ff4444';
            else if (r.wkg >= 3.5) wkgColor = '#ffcc00';

            // Highlight row if it is YOU
            const rowStyle = r.isMe
                ? "border-bottom: 1px solid #333; background: rgba(255, 98, 98, 0.8); cursor: default;"
                : "border-bottom: 1px solid #333; cursor: pointer;";

            // --- CRITICAL: ADD ONCLICK HANDLER AND PASS RIDER ID ---
            html += `
                <tr style="${rowStyle}" onclick="window.spectateRiderById(${r.riderId || 0})">
                    <td style="padding: 4px; color: #fff;">${name}</td>
                    <td style="padding: 4px;color: #fff; font-family: Overpass Mono, monospace;">${power}</td>
                    <td style="padding: 4px;color: #fff;font-family: Overpass Mono, monospace;">${speed}</td>
                    <td style="padding: 4px; color: ${wkgColor}; font-weight: bold;font-family: Overpass Mono, monospace;">${wkg}</td>
                    <td style="padding: 4px;color: #fff;font-family: Overpass Mono, monospace;">${gapText}</td>
                    <td style="padding: 4px;color: #fff;font-family: Overpass Mono, monospace;">${dist}m</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;

    }, 1000); // 1-second update

})();
