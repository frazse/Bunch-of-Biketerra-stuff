// ==UserScript==
// @name         Biketerra Elevation Graph Multi Rider
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  Shows marker for every rider on elevation graph. Spectator compatible.
// @author       Josef
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate/*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    console.log("[LeaderOverlay v1.3] Script started");

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

        // 2. Garbage Collection
        if (overlay && !document.body.contains(overlay)) {
            overlay = null;
            riderLines.clear();
        }

        if (overlay) return overlay;

        // 3. Create the overlay
        overlay = document.createElement('div');
        overlay.id = 'leaderOverlay';

        // 4. CSS relative to the parent
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
        svg.style.display = "block";
        overlay.appendChild(svg);

        // 6. Append DIRECTLY to the graph container
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

            // --- FIX IS HERE (v1.3) ---
            // Previously caused HierarchyRequestError
            elevGraph.appendChild(overlay);
        }

        return overlay;
    }

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
        if (!window.hackedRiders || !window.gameManager?.humans) return [];

        const gm = window.gameManager;
        const gmHumans = gm.humans;

        // --- DETERMINE THE "SUBJECT" PATH ID ---
        let subjectPathId = 0; // Default to 0 (Forward)

        if (gm.ego) {
            subjectPathId = gm.ego.currentPath?.id;
        } else if (gm.focalRider) {
            const fId = gm.focalRider.athleteId || gm.focalRider.id;
            const focalHuman = gmHumans[fId] || Object.values(gmHumans).find(h => (h.athleteId||h.id) == fId);
            if (focalHuman) {
                subjectPathId = focalHuman.currentPath?.id;
            }
        }

        const positions = [];

        window.hackedRiders.forEach(r => {
            if (r.isMe) return;

            if (!routeLength) return;
            let percent = ((r.dist / 1000) % routeLength) / routeLength * 100;

            let targetHuman = gmHumans[r.riderId];
            if (!targetHuman) {
                for (const h of Object.values(gmHumans)) {
                    if ((h.athleteId || h.id) === r.riderId) {
                        targetHuman = h;
                        break;
                    }
                }
            }

            // Direction Check
            if (targetHuman && targetHuman.currentPath && subjectPathId !== undefined) {
                const riderPathId = targetHuman.currentPath.id;
                if (riderPathId !== subjectPathId) {
                    percent = 100 - percent;
                }
            }

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
        const gm = window.gameManager;

        let currentPath = gm?.ego?.currentPath;

        if (!currentPath && gm?.focalRider) {
             const fId = gm.focalRider.athleteId || gm.focalRider.id;
             const humans = gm.humans || {};
             const focalHuman = humans[fId] || Object.values(humans).find(h => (h.athleteId||h.id) == fId);
             if (focalHuman) currentPath = focalHuman.currentPath;
        }

        const meters = currentPath?.distance;
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

        const width = ov.getBoundingClientRect().width || 1;
        const height = ov.getBoundingClientRect().height || 1;

        const riders = getRidersPositions();

        riderLines.forEach((line, name) => {
            if (!riders.find(r => r.name === name)) {
                line.remove();
                riderLines.delete(name);
            }
        });

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
