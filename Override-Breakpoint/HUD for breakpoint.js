// ==UserScript==
// @name         Biketerra HUD (Sorted)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Overlay that sorts riders by distance
// @author       You
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// ==/UserScript==

// Please see get-abit-more-data.js for instructions on how to use.

(function() {
    'use strict';

    // --- 1. Create the UI Overlay ---
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        width: 350px;
        background: rgba(0, 0, 0, 0.85);
        color: #00ffcc;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        padding: 10px;
        z-index: 9999;
        border: 1px solid #00ffcc;
        border-radius: 8px;
        box-shadow: 0 0 10px rgba(0, 255, 204, 0.2);
        max-height: 80vh;
        overflow-y: auto;
    `;
    container.innerHTML = `
        <div style="border-bottom: 1px solid #444; padding-bottom: 5px; margin-bottom: 5px; font-weight: bold; display: flex; justify-content: space-between;">
            <span>🚴 RIDER HUD</span>
            <span id="status-light" style="color: red;">● OFFLINE</span>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="text-align: left; color: #fff;">
                    <th style="padding: 2px;">Name</th>
                    <th style="padding: 2px;">Dist</th>
                    <th style="padding: 2px;">Watts</th>
                    <th style="padding: 2px;">Speed</th>
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
        // Check if data exists
        if (!window.hackedRiders) {
            statusLight.innerText = "● WAITING";
            statusLight.style.color = "orange";
            return;
        }

        let riders = [...window.hackedRiders];

        // --- ⚡ SORTING LOGIC ---
        // If we have more than 1 rider, sort them by Distance (Highest first)
        if (riders.length > 1) {
            riders.sort((a, b) => b.dist - a.dist);
        }

        // Update Status
        statusLight.innerText = `● LIVE (${riders.length})`;
        statusLight.style.color = "#00ff00";

        // Build HTML
        let html = '';
        riders.forEach(r => {
            const name = r.name || "Unknown";
            const dist = r.dist.toFixed(2);
            const watts = Math.round(r.power || 0);
            const speed = (r.speed * 3.6).toFixed(1);

            let wattColor = '#fff';
            if (watts > 300) wattColor = '#ff4444';
            else if (watts > 200) wattColor = '#ffcc00';

            html += `
                <tr style="border-bottom: 1px solid #333;">
                    <td style="padding: 4px; color: #fff;">${name}</td>
                    <td style="padding: 4px;">${dist}m</td>
                    <td style="padding: 4px; color: ${wattColor}; font-weight: bold;">${watts}w</td>
                    <td style="padding: 4px;">${speed}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

    }, 200);

})();
