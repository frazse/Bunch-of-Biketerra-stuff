// ==UserScript==
// @name         Biketerra Elevation Graph Multi Rider
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Two-color rider lines with group highlighting and counter (fixed direction grouping)
// @author       Josef
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate/*
// @exclude      https://biketerra.com/dashboard
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    console.log("[LeaderOverlay v2.4] Script started with fixed direction grouping.");

    // ============================
    // CONFIGURATION
    // ============================
    const GROUP_DISTANCE_METERS = 25; // Riders within this distance are grouped together
    const GROUP_RECT_COLOR = "rgba(255, 255, 255, 0.8)"; // Yellow with transparency
    const GROUP_RECT_BORDER = "rgba(255, 255, 255, 1)"; // Yellow border
    const GROUP_CIRCLE_RADIUS_RATIO = 0.03; // Circle radius as ratio of viewHeight
    const GROUP_CIRCLE_Y_OFFSET_RATIO = 0.05; // How far above the top (as ratio of viewHeight)

    const checkInterval = 500;
    let autoDetect = true;
    let routeLength = 0; // Stored in KM for logging/fallback
    let overlay;
    let svg = null;
    // name → {lineTop: SVG line, lineBottom: SVG line, lastUpdateTime: number, lastKnownDist: number, speed: number}
    let riderLines = new Map();
    let groupRects = []; // Array of group rectangle elements
    let groupBadges = []; // Array of HTML group badge elements

    // ============================
    // OVERLAY
    // ============================
        function waitFor(selector, timeout=10000) {
        return new Promise((resolve, reject)=>{
            const t = setTimeout(()=>reject("Timeout "+selector), timeout);
            const check = ()=>{
                const el = document.querySelector(selector);
                if(el){ clearTimeout(t); resolve(el); } else requestAnimationFrame(check);
            };
            check();
        });
    }
    waitFor(".panel-auxiliary").then(el => {
        if(el) el.style.paddingBottom = '20px';
    }).catch(() => {});

    // Apply custom CSS modifications
    waitFor(".hud-bottom").then(el => {
        if(el) el.style.width = '68vw';
    }).catch(() => {});

    waitFor(".panel-elevation-profile").then(el => {
        if(el) el.style.height = '10rem';
    }).catch(() => {});

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
            background: 'rgba(0,0,0,0.0)', zIndex: '9999', overflow: 'visible',
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
    // UPDATE ELEV-CURSOR COLORS
    // ============================
    let myLineTop = null;
    let myLineBottom = null;
    let myPathId = null;

function updateElevCursorColors() {
    const elevCursor = document.querySelector('.elev-cursor');
    if (!elevCursor || !svg || !overlay) return;

    if (!window.hackedRiders) return;

    // Find our own rider
    const meRider = window.hackedRiders.find(r => r.isMe);
    if (!meRider) return;

    const helmetColor = meRider.helmet || "#ffffff";
    const skinColor = meRider.skin || "#ffffff";

    // Create our lines if they don't exist
    if (!myLineTop) {
        myLineTop = document.createElementNS("http://www.w3.org/2000/svg", "line");
        myLineBottom = document.createElementNS("http://www.w3.org/2000/svg", "line");
        overlay.lineSVG.appendChild(myLineTop);
        overlay.lineSVG.appendChild(myLineBottom);
    }

    // Hide the original elev-cursor line
    elevCursor.style.display = 'none';

    // Get viewBox for coordinates
    const viewBox = svg.getAttribute("viewBox");
    if (!viewBox) return;

    const parts = viewBox.split(' ').map(Number);
    const minY = parts[1];
    const viewWidth = parts[2];
    const viewHeight = parts[3];
    const midY = minY + (viewHeight / 2);
    const strokeWidth = viewWidth * 0.002;

    // Get position from CSS left (e.g., "calc(49.9993% - 1px)")
    const leftStyle = elevCursor.style.left;
    if (!leftStyle) return;

    let percentage = 0;
    const calcMatch = leftStyle.match(/calc\(([0-9.]+)%/);
    if (calcMatch) {
        percentage = parseFloat(calcMatch[1]);
    } else {
        const percentMatch = leftStyle.match(/([0-9.]+)%/);
        if (percentMatch) {
            percentage = parseFloat(percentMatch[1]);
        } else {
            return; // Can't parse position
        }
    }

    const relativePos = percentage / 100; // 0 to 1
    const xPos = parts[0] + (relativePos * viewWidth);

    // Top half (helmet)
    myLineTop.setAttribute('x1', xPos);
    myLineTop.setAttribute('x2', xPos);
    myLineTop.setAttribute('y1', minY);
    myLineTop.setAttribute('y2', midY);
    myLineTop.setAttribute('stroke', helmetColor);
    myLineTop.setAttribute('stroke-width', strokeWidth);
    myLineTop.style.display = 'block';

    // Bottom half (skin)
    myLineBottom.setAttribute('x1', xPos);
    myLineBottom.setAttribute('x2', xPos);
    myLineBottom.setAttribute('y1', midY);
    myLineBottom.setAttribute('y2', minY + viewHeight);
    myLineBottom.setAttribute('stroke', skinColor);
    myLineBottom.setAttribute('stroke-width', strokeWidth);
    myLineBottom.style.display = 'block';
}

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

        // Store the subject's path ID for grouping logic
        myPathId = subjectPathId;

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
            let skinColor = "#ffffff";

            if (r.helmet) helmetColor = r.helmet;
            if (r.skin)   skinColor = r.skin;


            positions.push({
                name: r.name || String(r.riderId),
                percent: rawPercent, // Value is 0.0 to 1.0 (Full route coordinate)
                distMeters: distInMeters, // Actual distance in meters for grouping
                speed: speedNormalized, // Value is percentage/second, sign-adjusted for display
                helmetColor,
                skinColor,
                pathId: riderPathId, // Track which direction they're going (ORIGINAL, not subject's)
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
    // GROUP RIDERS BY PROXIMITY
    // ============================
    function findGroups(riders) {
        if (riders.length === 0) return [];

        // Sort riders by their percent position
        const sorted = [...riders].sort((a, b) => a.percent - b.percent);
        const groups = [];
        let currentGroup = [sorted[0]];

        const pathMeters = routeLength * 1000;

        for (let i = 1; i < sorted.length; i++) {
            const prevRider = sorted[i - 1];
            const currRider = sorted[i];

            // Calculate distance in meters between riders
            const distDiff = Math.abs(currRider.distMeters - prevRider.distMeters);

            // Only group riders if they are:
            // 1. Within GROUP_DISTANCE_METERS of each other
            // 2. Going in the SAME direction (same pathId)
            if (distDiff <= GROUP_DISTANCE_METERS && currRider.pathId === prevRider.pathId) {
                currentGroup.push(currRider);
            } else {
                if (currentGroup.length > 1) {
                    groups.push(currentGroup);
                }
                currentGroup = [currRider];
            }
        }

        // Don't forget the last group
        if (currentGroup.length > 1) {
            groups.push(currentGroup);
        }

        return groups;
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
        const minY = parts[1];
        const viewWidth = parts[2];
        const viewHeight = parts[3];
        const strokeWidth = viewWidth * 0.002;
        const midY = minY + (viewHeight / 2);

        const activeRiders = new Set(ridersRaw.map(r => r.name));

        // Cleanup old lines
        riderLines.forEach((entry, name) => {
            if (!activeRiders.has(name)) {
                entry.lineTop.remove();
                entry.lineBottom.remove();
                riderLines.delete(name);
            }
        });

        // Clear old group elements
        groupRects.forEach(rect => rect.remove());
        groupRects = [];
        groupBadges.forEach(badge => badge.remove());
        groupBadges = [];

        // Calculate predicted positions for all riders
        const predictedRiders = [];

        // First, add the main rider position from the colored cursor lines
        if (myLineTop && myPathId !== null) {
            const xFromLine = parseFloat(myLineTop.getAttribute('x1'));
            if (!isNaN(xFromLine)) {
                // Convert SVG x to normalized 0-1 position
                const myPos = xFromLine;
                // Calculate distance in meters for grouping
                const myDistMeters = myPos * routeLength * 1000;

                predictedRiders.push({
                    name: '__ME__',
                    percent: myPos,
                    predictedPos: myPos,
                    distMeters: myDistMeters,
                    entry: null, // No visual element to update
                    isMe: true,
                    pathId: myPathId // Use the subject's path ID
                });
            }
        }

        ridersRaw.forEach(r => {
            // Skip the main rider as we already added them above
            if (r.isMe) return;

            let entry = riderLines.get(r.name);

            // 1. Initialization/State Update
            if (!entry) {
                // New Rider Init - create TWO lines
                const lineTop = document.createElementNS("http://www.w3.org/2000/svg", "line");
                const lineBottom = document.createElementNS("http://www.w3.org/2000/svg", "line");

                ov.lineSVG.appendChild(lineTop);
                ov.lineSVG.appendChild(lineBottom);

                entry = {
                    lineTop,
                    lineBottom,
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

            // Store predicted position with rider data (including pathId)
            predictedRiders.push({
                ...r,
                predictedPos,
                entry
            });
        });

        // Find groups based on predicted positions
        const groups = findGroups(predictedRiders.map(pr => ({
            ...pr,
            percent: pr.predictedPos,
            distMeters: pr.predictedPos * routeLength * 1000
        })));

        // Draw group rectangles and badges
        groups.forEach(group => {
            const minPos = Math.min(...group.map(r => r.percent));
            const maxPos = Math.max(...group.map(r => r.percent));
            const centerPos = (minPos + maxPos) / 2;

            // Check if any part of the group is visible
            const groupStartRelative = (minPos - minX) / viewWidth;
            const groupEndRelative = (maxPos - minX) / viewWidth;

            if (groupEndRelative >= -0.05 && groupStartRelative <= 1.05) {
                // Draw rectangle in SVG
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                rect.setAttribute("x", minPos);
                rect.setAttribute("y", 0);
                rect.setAttribute("width", maxPos - minPos);
                rect.setAttribute("height", 1);
                rect.setAttribute("fill", GROUP_RECT_COLOR);
                rect.setAttribute("stroke", GROUP_RECT_BORDER);
                rect.setAttribute("stroke-width", strokeWidth * 0.5);

                // Insert at the beginning so it's behind the lines
                ov.lineSVG.insertBefore(rect, ov.lineSVG.firstChild);
                groupRects.push(rect);

                // Draw HTML badge above the group
                const containerRect = svg.getBoundingClientRect();
                const centerPosRelative = (centerPos - minX) / viewWidth;
                const badgeX = containerRect.left + (containerRect.width * centerPosRelative);
                const badgeY = containerRect.top - 25; // 35px above the graph

                const badge = document.createElement('div');
                badge.style.position = 'fixed';
                badge.style.left = badgeX + 'px';
                badge.style.top = badgeY + 'px';
                badge.style.transform = 'translateX(-50%)';
                badge.style.width = '22px';
                badge.style.height = '22px';
                badge.style.borderRadius = '50%';
                badge.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                badge.style.display = 'flex';
                badge.style.alignItems = 'center';
                badge.style.justifyContent = 'center';
                badge.style.fontWeight = 'bold';
                badge.style.fontSize = '16px';
                badge.style.color = 'white';
                badge.style.fontFamily = 'Overpass Mono, monospace';
                badge.style.pointerEvents = 'none';
                badge.style.zIndex = '10001';
                badge.textContent = group.length;

                document.body.appendChild(badge);
                groupBadges.push(badge);

                //console.log(`[Group] Drawing group at x=${centerPos.toFixed(4)}, riders:`, group.length);
            }
        });

        // Now draw individual rider lines
        predictedRiders.forEach(pr => {
            // Skip drawing for main rider (game draws them)
            if (pr.isMe || !pr.entry) return;

            const { predictedPos, entry, helmetColor, skinColor } = pr;

            // 3. Visibility and Drawing
            const positionRelativeToViewStart = predictedPos - minX;
            const normalizedRelativePosition = positionRelativeToViewStart / viewWidth;

            // Check if marker is outside the view (slightly padded)
            if (normalizedRelativePosition < -0.05 || normalizedRelativePosition > 1.05) {
                entry.lineTop.style.display = 'none';
                entry.lineBottom.style.display = 'none';
                return;
            }

            // The X coordinate is the absolute position (0.0 to 1.0) on the full route.
            const xAbsolute = predictedPos;

            entry.lineTop.style.display = 'block';
            entry.lineBottom.style.display = 'block';

            // Top half: from top to middle (helmet color)
            entry.lineTop.setAttribute("x1", xAbsolute);
            entry.lineTop.setAttribute("x2", xAbsolute);
            entry.lineTop.setAttribute("y1", minY);
            entry.lineTop.setAttribute("y2", midY);
            entry.lineTop.setAttribute("stroke-width", strokeWidth);
            entry.lineTop.setAttribute("stroke", (helmetColor && helmetColor.startsWith("#")) ? helmetColor : "white");

            // Bottom half: from middle to bottom (skin color)
            entry.lineBottom.setAttribute("x1", xAbsolute);
            entry.lineBottom.setAttribute("x2", xAbsolute);
            entry.lineBottom.setAttribute("y1", midY);
            entry.lineBottom.setAttribute("y2", minY + viewHeight);
            entry.lineBottom.setAttribute("stroke-width", strokeWidth);
            entry.lineBottom.setAttribute("stroke", (skinColor && skinColor.startsWith("#")) ? skinColor : "white");
        });
    }

    // Set the refresh rate faster for smoother movement
    setInterval(() => {
        updateElevCursorColors();
        updateOverlay();
    }, 1000 / 60); // Aiming for ~60 FPS update rate

})();
