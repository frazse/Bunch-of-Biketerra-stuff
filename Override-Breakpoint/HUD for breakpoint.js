// ==UserScript==
// @name         Biketerra HUD (Final)
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Overlay that shows W/kg, Gap, and sorts riders by distance.
// @author       You
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
// Function to hide the element
    function hideOriginalRiderList() {
        const originalList = document.querySelector('.panel-rider-list');
        if (originalList) {
            originalList.style.display = 'none';
            console.log('✅ Original Rider List Hidden.');
        } else {
            // Keep trying until the list is loaded (it loads after the 3D world starts)
            setTimeout(hideOriginalRiderList, 500);
        }
    }

    // Call the function once the script starts
    hideOriginalRiderList();
    // --- 1. Create the UI Overlay ---
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
        //border: 1px solid #00ffcc;
        border-radius: 8px;
        max-height: 65vh;
        overflow-y: auto;
    `;

    // UPDATED TABLE HEADERS: Name, W/kg, Gap, Dist
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
            // --- METRIC FORMATTING ---
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
                ? "border-bottom: 1px solid #333; background: rgba(255, 98, 98, 0.8);"
                : "border-bottom: 1px solid #333;";

            html += `
                <tr style="${rowStyle}">
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
