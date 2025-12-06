// ==UserScript==
// @name         Biketerra Elevation Graph Multi Rider
// @namespace    http://tampermonkey.net/
// @version      1.0
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
        position: 'absolute', // must be absolute to overlay the graph
        background: 'rgba(0,0,0,0.0)',
        zIndex: '9999',
        overflow: 'hidden',
        pointerEvents: 'none' // so clicks go through
    });
    document.body.appendChild(overlay);

    // SVG Graph
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    overlay.appendChild(svg);

    // Set size & position to match .elev-graph
    updateOverlayPosition();

    return overlay;
}
function updateOverlayPosition() {
    const elevGraph = document.querySelector('.elev-graph');
    if (!elevGraph || !overlay) return false; // return false if not ready

    const rect = elevGraph.getBoundingClientRect();

    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    return true;
}

// Poll until .elev-graph exists
function waitForElevGraph(callback) {
    const interval = setInterval(() => {
        if (updateOverlayPosition()) {
            clearInterval(interval);
            if (callback) callback();
        }
    }, 100); // check every 100ms
}

waitForElevGraph();
window.addEventListener('resize', updateOverlayPosition);

// ============================
// READ EVERY RIDER POSITION
// ============================
function getRidersPositions() {
    if (!window.hackedRiders || !window.gameManager?.humans || !window.gameManager?.ego) return [];

    const gmHumans = window.gameManager.humans;
    const egoPathId = window.gameManager.ego.currentPath?.id; // Get your current Path ID (0 or 1)

    const myRider = window.hackedRiders.find(r => r.isMe);
    if (!myRider) return [];

    const positions = [];

    window.hackedRiders.forEach(r => {
        if (r.isMe) return; // ✅ DO NOT DRAW YOURSELF

        const riderKm = r.dist / 1000;

        // 1. Calculate standard percentage (0 to 100)
        let percent = ((riderKm % routeLength) / routeLength) * 100;

        // 2. Find the specific human object to check their path
        let targetHuman = gmHumans[r.riderId];

        // Fallback search if direct ID lookup fails (sometimes IDs drift in different arrays)
        if (!targetHuman) {
            for (const h of Object.values(gmHumans)) {
                if ((h.athleteId || h.id) === r.riderId) {
                    targetHuman = h;
                    break;
                }
            }
        }

        // 3. Direction Check: Flip the rider if they are on a different path ID than you
        if (targetHuman && targetHuman.currentPath && egoPathId !== undefined) {
            const riderPathId = targetHuman.currentPath.id;

            // If you are on Path A (0) and they are on Path B (1) -> Flip them
            // If you are on Path B (1) and they are on Path A (0) -> Flip them
            if (riderPathId !== egoPathId) {
                percent = 100 - percent;
            }
        }

        // --- Helmet color lookup ---
        let helmetColor = "#ffffff";
        if (targetHuman?.config?.design?.helmet_color) {
            helmetColor = targetHuman.config.design.helmet_color;
        }

        positions.push({
            name: r.name || String(r.riderId),
            percent, // This is now direction-corrected
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
const height = overlay.getBoundingClientRect().height || 1; // use full height


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
