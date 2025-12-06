// ==UserScript==
// @name         Biketerra Elevation Graph Multi Rider
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Shows marker for every rider on elevation graph (exact positions)
// @author       Josef
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate/*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    console.log("[LeaderOverlay v1.7] Script started");

    const checkInterval = 500;
    let autoDetect = true;
    let routeLength = 0;
    let overlay;
    let svg = null;
    let riderLines = new Map(); // name → SVG line

    // ============================
    // OVERLAY
    // ============================
    function createOverlay() {
        // 1. Find the target graph element
        const elevGraph = document.querySelector('.elev-graph');
        if (!elevGraph) return null;

        // 2. Garbage Collection: If overlay exists in memory but fell off the DOM (e.g. React re-render), clear it
        if (overlay && !document.body.contains(overlay)) {
            overlay = null;
            riderLines.clear();
        }

        if (overlay) return overlay;

        // 3. Create the overlay
        overlay = document.createElement('div');
        overlay.id = 'leaderOverlay';

        // 4. CRITICAL FIX: CSS relative to the parent, not the viewport
        Object.assign(overlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.0)',
            zIndex: '9999',
            overflow: 'hidden',
            pointerEvents: 'none' // so clicks go through
        });

        // 5. SVG Graph
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.display = "block"; // prevents tiny scrollbars
        overlay.appendChild(svg);

        // 6. CRITICAL FIX: Append DIRECTLY to the graph container (or its parent if it's a canvas)
        // This ensures the overlay physically moves with the graph during resize.
        if (elevGraph.tagName === 'CANVAS') {
            const parent = elevGraph.parentElement;
            if (getComputedStyle(parent).position === 'static') {
                parent.style.position = 'relative';
            }
            parent.appendChild(overlay);
        } else {
            if (getComputedStyle(elevGraph).position === 'static') {
                elevGraph.style.position = 'relative';
            }
            elevGraph.appendChild(overlay);
        }

        return overlay;
    }

    // We no longer need to calculate 'rect' manually because CSS 'width: 100%' handles it.
    function waitForElevGraph() {
        const interval = setInterval(() => {
            if (document.querySelector('.elev-graph')) {
                clearInterval(interval);
                updateOverlay();
            }
        }, 500);
    }

    waitForElevGraph();

    // ============================
    // READ EVERY RIDER POSITION
    // ============================
    function getRidersPositions() {
        if (!window.hackedRiders || !window.gameManager?.humans || !window.gameManager?.ego) return [];

        const gmHumans = window.gameManager.humans;
        const egoPathId = window.gameManager.ego.currentPath?.id;
        const myRider = window.hackedRiders.find(r => r.isMe);

        if (!myRider) return [];

        const positions = [];

        window.hackedRiders.forEach(r => {
            if (r.isMe) return;

            // 1. Calculate standard percentage (0 to 100)
            let percent = ((r.dist / 1000) % routeLength) / routeLength * 100;

            // 2. Find the specific human object
            let targetHuman = gmHumans[r.riderId];
            if (!targetHuman) {
                for (const h of Object.values(gmHumans)) {
                    if ((h.athleteId || h.id) === r.riderId) {
                        targetHuman = h;
                        break;
                    }
                }
            }

            // 3. Direction Check
            if (targetHuman && targetHuman.currentPath && egoPathId !== undefined) {
                const riderPathId = targetHuman.currentPath.id;
                if (riderPathId !== egoPathId) {
                    percent = 100 - percent;
                }
            }

            // 4. Helmet color lookup
            let helmetColor = "#ffffff";
            if (targetHuman?.config?.design?.helmet_color) {
                helmetColor = targetHuman.config.design.helmet_color;
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
    // AUTO-DETECT ROUTE LENGTH
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
        const ov = createOverlay();
        if (!ov || !routeLength) return;

        // Use getBoundingClientRect only to get the current drawing width for scaling
        const width = ov.getBoundingClientRect().width || 1;
        const height = ov.getBoundingClientRect().height || 1;

        const riders = getRidersPositions();
        if (riders.length === 0) return;

        // Cleanup old lines
        riderLines.forEach((line, name) => {
            if (!riders.find(r => r.name === name)) {
                line.remove();
                riderLines.delete(name);
            }
        });

        // Draw new lines
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
            line.setAttribute("stroke", (r.helmetColor && r.helmetColor.startsWith("#")) ? r.helmetColor : "white");
        });
    }

    setInterval(() => {
        autoDetectRouteLength();
        updateOverlay();
    }, checkInterval);

})();
