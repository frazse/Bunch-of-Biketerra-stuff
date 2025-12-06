// ==UserScript==
// @name         Biketerra Elevation Graph Multi Rider
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  FIXED: Removed redundant absolute speed flip. Speed is now only negated when the rider's path opposes the graph's visible path.
// @author       Josef
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate/*
// @exclude      https://biketerra.com/dashboard
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    console.log("[LeaderOverlay v2.0] Script started with streamlined speed logic.");

    const checkInterval = 500;
    let autoDetect = true;
    let routeLength = 0; // Stored in KM for logging/fallback
    let overlay;
    let svg = null;
    // name → {line: SVG line, lastUpdateTime: number, lastKnownDist: number, speed: number}
    let riderLines = new Map();

    // ============================
    // OVERLAY
    // ============================
    function createOverlay() {
        const elevGraph = document.querySelector('.elev-graph');
        if (!elevGraph) return null;

        const pathSVG = elevGraph.querySelector('svg.pathSVG');
        if (!pathSVG) return null;

        svg = pathSVG;

        if (overlay && !document.body.contains(overlay)) {
            overlay = null;
            riderLines.clear();
        }

        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'leaderOverlay';

        Object.assign(overlay.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.0)', zIndex: '9999', overflow: 'hidden',
            pointerEvents: 'none'
        });

        const lineSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        lineSVG.setAttribute("width", "100%");
        lineSVG.setAttribute("height", "100%");
        lineSVG.style.display = "block";
        lineSVG.setAttribute("preserveAspectRatio", "none");
        overlay.appendChild(lineSVG);
        overlay.lineSVG = lineSVG;

        const parent = elevGraph.parentElement;
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }
        parent.appendChild(overlay);

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
        let subjectPathId = 0;

        // 1. Determine Subject Path ID (0 or 1)
        if (gm.ego) {
            subjectPathId = gm.ego.currentPath?.id;
        } else if (gm.focalRider) {
            const fId = gm.focalRider.athleteId || gm.focalRider.id;
            const focalHuman = gmHumans[fId] || Object.values(gmHumans).find(h => (h.athleteId||h.id) == fId);
            if (focalHuman) {
                subjectPathId = focalHuman.currentPath?.id;
            }
        }

        const fallbackPathMeters = routeLength * 1000;
        const positions = [];

        window.hackedRiders.forEach(r => {
            // Skip the rider being controlled by the main game cursor
            if (r.isMe || r.riderId === gm.ego?.athleteId || r.riderId === gm.focalRider?.athleteId) return;

            let targetHuman = gmHumans[r.riderId];
            if (!targetHuman) {
                for (const h of Object.values(gmHumans)) {
                    if ((h.athleteId || h.id) === r.riderId) {
                        targetHuman = h;
                        break;
                    }
                }
            }

            let riderPathMeters = fallbackPathMeters;
            let riderPathId = 0;
            if (targetHuman?.currentPath) {
                riderPathMeters = targetHuman.currentPath.distance || fallbackPathMeters;
                riderPathId = targetHuman.currentPath.id;
            }
            if (riderPathMeters === 0) return;

            // Calculate current distance into the lap (r.dist is cumulative meters)
            let distInMeters = (r.dist) % riderPathMeters;

            // Normalize speed to the path length (m/s to percentage/s). Speed is initially POSITIVE.
            let speedNormalized = r.speed / riderPathMeters;

            // --- Apply Direction/Flipping Logic ---

            // If the rider's path is DIFFERENT from the subject's path, we must FLIP everything visually.
            if (riderPathId !== subjectPathId) {
                // 1. Flip position: e.g., if rider is at 80% on Path A, they appear at 20% on Path B view.
                const percent = distInMeters / riderPathMeters;
                distInMeters = (1.0 - percent) * riderPathMeters;

                // 2. Flip speed: The prediction must move the marker backward on the visible profile.
                speedNormalized = -speedNormalized;
            }
            // --- End Direction/Flipping Logic ---

            // Normalize final position to the 0.0 to 1.0 range
            const rawPercent = distInMeters / riderPathMeters;

            let helmetColor = "#ffffff";
            if (targetHuman?.config?.design?.helmet_color) {
                helmetColor = targetHuman.config.design.helmet_color;
            }

            positions.push({
                name: r.name || String(r.riderId),
                percent: rawPercent, // Value is 0.0 to 1.0 (Full route coordinate)
                speed: speedNormalized, // Value is percentage/second, sign-adjusted for display
                helmetColor,
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
        }
    }

    // ============================
    // DRAW ALL RIDERS
    // ============================
    function updateOverlay() {
        const ov = createOverlay();
        if (!ov || !svg) return;

        autoDetectRouteLength();
        if (routeLength === 0) return;

        const ridersRaw = getRidersPositions();
        const now = performance.now();

        // --- SYNCHRONIZATION STEP ---
        const viewBox = svg.getAttribute("viewBox");
        ov.lineSVG.setAttribute("viewBox", viewBox);

        const parts = viewBox.split(' ').map(Number);
        const minX = parts[0];
        const viewWidth = parts[2];
        const strokeWidth = viewWidth * 0.005;

        const activeRiders = new Set(ridersRaw.map(r => r.name));

        // Cleanup old lines
        riderLines.forEach((entry, name) => {
            if (!activeRiders.has(name)) {
                entry.line.remove();
                riderLines.delete(name);
            }
        });

        // Update state and Draw lines
        ridersRaw.forEach(r => {
            let entry = riderLines.get(r.name);

            // 1. Initialization/State Update
            if (!entry) {
                // New Rider Init
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                ov.lineSVG.appendChild(line);
                line.setAttribute("y1", 0);
                line.setAttribute("y2", 1);

                entry = {
                    line,
                    lastUpdateTime: now,
                    lastKnownDist: r.percent,
                    speed: r.speed
                };
                riderLines.set(r.name, entry);
            } else if (Math.abs(entry.lastKnownDist - r.percent) > 0.0001) {
                // Position Update (if new data is significantly different)
                entry.lastUpdateTime = now;
                entry.lastKnownDist = r.percent;
                entry.speed = r.speed;
            }

            // 2. Physics Prediction
            const dt = (now - entry.lastUpdateTime) / 1000;

            // Predict the new absolute position (0.0 to 1.0)
            let predictedPos = entry.lastKnownDist + (entry.speed * dt);

            // Clamp position to stay within a single lap (0.0 to 1.0)
            if (predictedPos > 1.0) predictedPos = predictedPos % 1.0;
            if (predictedPos < 0.0) predictedPos = 1.0 + predictedPos;

            // 3. Visibility and Drawing

            // Calculate position relative to the start of the visible view (minX)
            const positionRelativeToViewStart = predictedPos - minX;

            // Normalized position to the view's width (0.0 = left edge, 1.0 = right edge)
            const normalizedRelativePosition = positionRelativeToViewStart / viewWidth;

            // Check if marker is outside the view (slightly padded)
            if (normalizedRelativePosition < -0.05 || normalizedRelativePosition > 1.05) {
                entry.line.style.display = 'none';
                return;
            }

            // The X coordinate is the absolute position (0.0 to 1.0) on the full route.
            const xAbsolute = predictedPos;

            entry.line.style.display = 'block';

            entry.line.setAttribute("x1", xAbsolute);
            entry.line.setAttribute("x2", xAbsolute);
            entry.line.setAttribute("stroke-width", strokeWidth);
            entry.line.setAttribute("stroke", (r.helmetColor && r.helmetColor.startsWith("#")) ? r.helmetColor : "white");
        });
    }

    // Set the refresh rate faster for smoother movement
    setInterval(() => {
        updateOverlay();
    }, 1000 / 60); // Aiming for ~60 FPS update rate

})();
