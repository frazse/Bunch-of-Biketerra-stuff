// ==UserScript==
// @name         Biketerra LeaderOverlay v1.6 (Multi Rider)
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Shows marker for every rider on elevation graph (exact positions) + settings
// @author       Josef
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate/*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    console.log("[LeaderOverlay v1.6] Script started");

    const checkInterval = 500;

    let manualRouteLength = null;
    let manualTotalClimb = null;
    let autoDetect = true;

    let routeLength = 0;
    let overlay, logContainer;
    let settingsBox = null;
    let gearButton = null;

    let svg = null;
    let riderLines = new Map(); // name → SVG line

    // ============================
    // OVERLAY
    // ============================
    function createOverlay() {
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'leaderOverlay';
        Object.assign(overlay.style, {
            position: 'fixed',
            bottom: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '50vw',
            height: '95px',
            background: 'rgba(0,0,0,0.0)',
            zIndex: '9999',
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
        });
        document.body.appendChild(overlay);


        // SVG Graph
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "80%");
        overlay.appendChild(svg);

        return overlay;
    }

    // ============================
    // READ EVERY RIDER POSITION
    // ============================
function getRidersPositions() {
    if (!window.hackedRiders || !window.gameManager?.humans) return [];

    const gmHumans = window.gameManager.humans;
    const myRider = window.hackedRiders.find(r => r.isMe);
    if (!myRider) return [];

    const myKm = myRider.dist / 1000;

    const positions = [];

window.hackedRiders.forEach(r => {
    if (r.isMe) return; // ✅ DO NOT DRAW YOURSELF
        const riderKm = r.dist / 1000;

        const percent = ((riderKm % routeLength) / routeLength) * 100;

        // --- Helmet color lookup ---
        let helmetColor = "#ffffff";

        if (gmHumans[r.riderId]?.config?.design?.helmet_color) {
            helmetColor = gmHumans[r.riderId].config.design.helmet_color;
        } else {
            for (const h of Object.values(gmHumans)) {
                if ((h.athleteId || h.id) === r.riderId) {
                    helmetColor = h.config?.design?.helmet_color || helmetColor;
                    break;
                }
            }
        }

        positions.push({
            name: r.name || String(r.riderId),
            percent,
            helmetColor,
            isYou: r.isMe,
            isLeader: r.isLeader || false
        });
    });

    return positions;
}
// ============================
// AUTO-DETECT ROUTE LENGTH (EXACT, FROM gameManager.ego)
// ============================
function autoDetectRouteLength() {
    if (!autoDetect) return;

    const meters = window.gameManager?.ego?.currentPath?.distance;
    if (!meters) return;

    const km = meters / 1000;

    if (Math.abs(routeLength - km) > 0.001) {
        routeLength = km;
        console.log("[LeaderOverlay] Route length auto-detected:", km, "km");
    }
}

    // ============================
    // DRAW ALL RIDERS
    // ============================
    function updateOverlay() {
        createOverlay();
        if (!routeLength) return;

        const width = overlay.getBoundingClientRect().width || 1;
        const height = overlay.clientHeight * 0.8;

const riders = getRidersPositions();
        if (riders.length === 0) return;

        // Remove SVG lines for riders that disappeared
        riderLines.forEach((line, name) => {
            if (!riders.find(r => r.name === name)) {
                line.remove();
                riderLines.delete(name);
            }
        });

        // Update / create lines for each rider
        riders.forEach(r => {
            let line = riderLines.get(r.name);
            if (!line) {
                line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                svg.appendChild(line);
                riderLines.set(r.name, line);
            }

            const x = (r.percent / 100) * width;

            line.setAttribute("x1", x);
            line.setAttribute("x2", x);
            line.setAttribute("y1", 0);
            line.setAttribute("y2", height);
            line.setAttribute("stroke-width", 2);

// --- Helmet color first ---
if (r.helmetColor && r.helmetColor.startsWith("#")) {
    line.setAttribute("stroke", r.helmetColor);
} else {
    line.setAttribute("stroke", "white");
}

        });

        // Debug log
        //logContainer.textContent = `Riders: ${riders.length} | Route=${routeLength} km`;
    }

setInterval(() => {
    autoDetectRouteLength();
    updateOverlay();
}, checkInterval);

})();
