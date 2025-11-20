// const yExag allows you to set scaling on Y aka height.
// ==UserScript==
// @name          Biketerra 3D Route Viewer
// @namespace     http://tampermonkey.net/
// @version       1.2.2
// @description   Adds a 3D Babylon.js elevation route to Biketerra ride & spectate pages. Uses pre-loaded JSON or intercepts fetch.
// @author        Josef/chatgpt/gemini
// @match         https://biketerra.com/ride*
// @match         https://biketerra.com/spectate*
// @exclude       https://biketerra.com/dashboard
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant         none
// ==/UserScript==

(function() {
    'use strict';

    // Global variable to hold the intercepted JSON data
    let interceptedRouteJson = null;

    // --- Interception Logic (Must run immediately) ---
    const originalFetch = window.fetch;
window.fetch = async function(resource, options) {
    let url = null;

    // Handle Request object
    if (resource instanceof Request) {
        url = resource.url;
    }
    // Handle string URL
    else if (typeof resource === "string") {
        url = resource;
    }

    // Detect the JSON request
    const isRouteJson = url && url.includes("/__data.json");

    if (isRouteJson) {
        const response = await originalFetch(resource, options);
        const clone = response.clone();

        try {
            interceptedRouteJson = await clone.json();
            console.log("[3D Viewer] Intercepted JSON via fetch override");
        } catch (e) {
            console.error("[3D Viewer] Intercept parse error:", e);
        }

        return response;
    }

    return originalFetch(resource, options);
};

    // -------------------------------------------------


    function waitFor(selector, timeout = 10000) {
        // ... (waitFor function remains the same)
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject("Timeout waiting for " + selector), timeout);
            const check = () => {
                const el = document.querySelector(selector);
                if (el) {
                    clearTimeout(t);
                    resolve(el);
                } else {
                    requestAnimationFrame(check);
                }
            };
            check();
        });
    }
async function waitForIntercept(timeout = 3000) {
    const start = performance.now();
    while (!interceptedRouteJson) {
        if (performance.now() - start > timeout) return false;
        await new Promise(r => setTimeout(r, 10));
    }
    return true;
}

    waitFor(".elev-cursor").then(() => {
        console.log("[3D Viewer] Page ready — launching viewer…");
        start3DViewer();
    }).catch(err => console.error(err));

    async function start3DViewer() {
        // Load Babylon.js if not present
        if (typeof window.BABYLON === 'undefined') {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.babylonjs.com/babylon.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
        const BABYLON = window.BABYLON;

        // ... (Determine JSON URL part remains the same, though less critical now) ...
        let url;
        const params = new URLSearchParams(window.location.search);
        // ... (url determination logic) ...
        if (window.location.pathname.startsWith("/spectate/")) {
            const spectateId = window.location.pathname.split("/")[2];
            url = `https://biketerra.com/spectate/${spectateId}/__data.json`;
        } else if (window.location.pathname.startsWith("/ride")) {
            const eventId = params.get("event");
            if (eventId) {
                url = `https://biketerra.com/ride/__data.json?event=${eventId}`;
            } else {
                const routeId = params.get("route");
                if (!routeId) return console.error("No route ID found");
                url = `https://biketerra.com/ride/__data.json?route=${routeId}`;
            }
        } else {
            return console.error("Unknown page type for 3D Viewer");
        }


        // ===== Use INTERCEPTED JSON first, then preloaded Remix, then fetch =====
        await waitForIntercept();

        let j = null;

        // 1. Try Intercepted Data
        if (interceptedRouteJson) {
            j = interceptedRouteJson;
            console.log("[3D Viewer] Using intercepted JSON from fetch.");
        }

        // 2. Try preloaded JSON from Remix loader (existing logic)
        if (!j) {
            const remix = window.__remixContext;
            if (remix?.state?.loaderData) {
                const ld = remix.state.loaderData;
                for (const key in ld) {
                    const v = ld[key];
                    // The extensive route finding logic goes here (same as original script)
                    if (v?.data?.route)      { j = v.data.route;      break; }
                    if (v?.data?.routeData)  { j = v.data.routeData;  break; }
                    if (v?.route)            { j = v.route;           break; }
                    if (v?.routeData)        { j = v.routeData;       break; }
                    if (Array.isArray(v) &&
                        v.length > 0 &&
                        Array.isArray(v[0]) &&
                        typeof v[0][0] === "number") {
                        j = v;
                        break;
                    }
                    if (v?.data &&
                        Array.isArray(v.data) &&
                        v.data.length > 0 &&
                        Array.isArray(v.data[0]) &&
                        typeof v.data[0][0] === "number") {
                        j = v.data;
                        break;
                    }
                }
            }
        }

        if (j) {
            // Already found JSON from interception or Remix
            console.log("[3D Viewer] Route JSON successfully acquired.");
        } else {
            // 3. Fallback: Perform the fetch (Original script's fallback)
            console.warn("[3D Viewer] Fallback to new fetch for route JSON:", url);
            const resp = await fetch(url);
            j = await resp.json();
        }

        if (!j) {
            return console.error("Unable to obtain route JSON for 3D Viewer");
        }

        // ... (The rest of start3DViewer() remains the same, using 'j') ...

        // ===== Find route coordinates =====
        function findRoutes(obj, routes = []) {
            // ... (findRoutes function remains the same) ...
            if (!obj) return routes;
            if (Array.isArray(obj)) {
                if (obj.length > 0 && Array.isArray(obj[0]) && typeof obj[0][0] === "number") {
                    routes.push(obj);
                } else obj.forEach(el => findRoutes(el, routes));
            } else if (typeof obj === "string") {
                try { findRoutes(JSON.parse(obj), routes); } catch {}
            } else if (typeof obj === "object") {
                Object.values(obj).forEach(v => findRoutes(v, routes));
            }
            return routes;
        }

        const routes = findRoutes(j);
        if (!routes.length) {
            return console.warn("3D Viewer: No route array found in JSON");
        }
        const raw = routes[0];

        // ... (The rest of the script for conversion and scene building remains unchanged) ...
        const lat0 = raw[0][0] * Math.PI / 180;
        const lon0 = raw[0][1] * Math.PI / 180;
        const R = 6371000;

        // ... (Continue with the rest of the original script) ...
        const xVals = raw.map(p => ((p[1]*Math.PI/180 - lon0) * R * Math.cos(lat0))); // east (m)
        const zVals = raw.map(p => ((p[0]*Math.PI/180 - lat0) * R));                  // north (m)
        const yVals = raw.map(p => p[2]);                                              // elevation (m)

        // ===== Normalization for scene coordinates (keep meter ratios, but scale to fit) =====
        const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
        const zMin = Math.min(...zVals), zMax = Math.max(...zVals);
        const yMin = Math.min(...yVals);

        const xRange = xMax - xMin, zRange = zMax - zMin;
        const maxXZ = Math.max(xRange, zRange) || 1;


                // ===== CUMULATIVE DISTANCES (meters) - horizontal distance in meters from xVals,zVals =====
        const cum = new Array(xVals.length).fill(0);
        for (let i = 1; i < xVals.length; i++) {
            const dx = xVals[i] - xVals[i-1];
            const dz = zVals[i] - zVals[i-1];
            cum[i] = cum[i-1] + Math.hypot(dx, dz);
        }
        const totalDist = cum[cum.length - 1] || 1;
        const distKm = totalDist / 1000;
     //   const yExag = 0.005; // vertical exaggeration factor (adjust)
      //  const sceneScale = 120;  // instead of 20
        let sceneScale = 20;
        if (distKm > 30) sceneScale = 50;
        if (distKm > 60) sceneScale = 80;
        if (distKm > 120) sceneScale = 150;
        if (distKm > 200) sceneScale = 200;
        if (distKm > 500) sceneScale = 500;
        if (distKm > 1000) sceneScale = 1000;
        if (distKm > 2000) sceneScale = 2000;



        let yExag = 0.01;
        //if (distKm > 30) yExag = 0.013;
        //if (distKm > 60) yExag = 0.017;
       // if (distKm > 120) yExag = 0.025;
       // if (distKm > 200) yExag = 0.041;

console.log(
    `[3D Viewer] Route length = ${distKm.toFixed(2)} km — sceneScale = ${sceneScale}, yExag = ${yExag}`
);

        const points = raw.map((p,i) => new BABYLON.Vector3(
            (xVals[i] - (xMin + xMax)/2) / maxXZ * sceneScale,
            (yVals[i] - yMin) * yExag,
            (zVals[i] - (zMin + zMax)/2) / maxXZ * sceneScale
        ));



        // binary search helper to find index i such that cum[i] <= d <= cum[i+1]
        function findSegmentIndexByDist(d) {
            if (d <= 0) return 0;
            if (d >= totalDist) return cum.length - 2;
            let lo = 0, hi = cum.length - 1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (cum[mid] <= d && d <= cum[mid+1]) return mid;
                if (cum[mid] < d) lo = mid + 1;
                else hi = mid - 1;
            }
            return Math.max(0, Math.min(cum.length - 2, lo - 1));
        }

        // ===== Canvas + Engine + Scene =====
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 350;
        canvas.style.position = "fixed";
        canvas.style.top = "8px";
        canvas.style.left = "8px";
        canvas.style.zIndex = "1";
        canvas.style.background = "transparent";
        canvas.style.borderRadius = "8px";
        // optional: make it click-through -> canvas.style.pointerEvents = "none";
        document.body.appendChild(canvas);

        const engine = new BABYLON.Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
            premultipliedAlpha: false
        });

        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0, 0, 0, 0.5); // background with partial alpha

        const radius = Math.max(...points.map(p => p.length())) * 2;
        const camera = new BABYLON.ArcRotateCamera("cam", Math.PI/2, Math.PI/3, radius, BABYLON.Vector3.Zero(), scene);
        camera.attachControl(canvas, true);
        camera.minZ = 0.1;
        camera.lowerRadiusLimit = 0.5;
        camera.upperRadiusLimit = radius * 5;
        camera.wheelDeltaPercentage = 0.05;

        new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0,1,0), scene);

        // ===== Grade colors (kept for fill logic if you want) =====
        const GRADE_COLORS = [
            { grade: 0, color: "#0008" },
            { grade: 1, color: "#FF6262" },
            { grade: 4, color: "#DC5666" },
            { grade: 8, color: "#B14674" },
            { grade: 11, color: "#7F347C" },
           // { grade: 14, color: "#572667" }
        ];
        function hexToC4(hex) {
            const n = parseInt(hex.slice(1), 16);
            return new BABYLON.Color4(
                ((n >> 16) & 255) / 255,
                ((n >> 8) & 255) / 255,
                (n & 255) / 255,
                1
            );
        }
        function getGradeColor(g) {
            for (let i = GRADE_COLORS.length - 1; i >= 0; i--) {
                if (g >= GRADE_COLORS[i].grade) return hexToC4(GRADE_COLORS[i].color);
            }
            return hexToC4(GRADE_COLORS[0].color);
        }

        // ===== Simple flat fill (keeps previous approach) =====
        // Build a colored triangle list per-segment so fill matches segment color (no vertical gradient)
        const bottomY = Math.min(...points.map(p => p.y));
        const positions = [];
        const colorsArray = [];
        const indices = [];
        let baseIndex = 0;
        // compute per-segment grade colors (based on distance and elevation)
        const grades = [];
        for (let i = 0; i < xVals.length - 1; i++) {
            const dy = yVals[i+1] - yVals[i];
            const dxz = Math.hypot(xVals[i+1] - xVals[i], zVals[i+1] - zVals[i]);
            grades.push(dxz === 0 ? 0 : (dy / dxz) * 100);
        }
        grades.push(grades[grades.length - 1]);
        const segmentColors = grades.map(g => getGradeColor(g));

for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i+1];
    const c0 = segmentColors[i], c1 = segmentColors[i+1];

    // top vertices
    const t0 = [p0.x, p0.y, p0.z];
    const t1 = [p1.x, p1.y, p1.z];

    // bottom vertices
    const b0 = [p0.x, bottomY, p0.z];
    const b1 = [p1.x, bottomY, p1.z];

    // push all 4 vertices (no sharing with next segment!)
    positions.push(...t0, ...t1, ...b0, ...b1);

    // assign segment color to all 4 vertices of this segment
    const c0a = [c0.r, c0.g, c0.b, 1];
    const c1a = [c1.r, c1.g, c1.b, 1];
    colorsArray.push(...c0a, ...c0a, ...c0a, ...c0a); // all same color per segment

    indices.push(baseIndex, baseIndex+1, baseIndex+2, baseIndex+1, baseIndex+3, baseIndex+2);
    baseIndex += 4;
}

        const fill = new BABYLON.Mesh("flatFill", scene);
        fill.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
        fill.setVerticesData(BABYLON.VertexBuffer.ColorKind, colorsArray);
        fill.setIndices(indices);
        const mat = new BABYLON.StandardMaterial("fillMat", scene);
        mat.alpha = 1;
        mat.emissiveColor = new BABYLON.Color3(1,1,1);
        mat.vertexColorMode = BABYLON.Constants.VERTEXCOLOR_USE_COLORS;
        mat.backFaceCulling = false;
        fill.material = mat;

        // ===== Simple thin route line on top (single color) =====
   const line = BABYLON.MeshBuilder.CreateLines("routeLine", {
       points: points,
       colors: points.map(() => new BABYLON.Color4(0.75,0.75,0.75,1)),
       updatable: false,
       instance: null,
   }, scene);


        // ===== Marker + Arrow =====
        // small invisible point (we'll place arrow and a small sphere for fallback)
        const marker = BABYLON.MeshBuilder.CreateSphere("marker",{diameter:0.001},scene);
        marker.isVisible = false;

        // Create arrow (cone) above route pointing down
        // Babylon doesn't have CreateCone across all versions; use cylinder with top=0 (a cone)
        const arrowHeight = 0.6;
        const arrow = BABYLON.MeshBuilder.CreateCylinder("arrow", {
            height: arrowHeight,
            diameterTop: 0.0,
            diameterBottom: 0.25,
            tessellation: 12
        }, scene);
        arrow.rotation.x = Math.PI; // point downwards
        arrow.position.y = bottomY + arrowHeight * 1.2; // initial place; updated each frame
        // use emissive dark color for visibility
        const arrowMat = new BABYLON.StandardMaterial("arrowMat", scene);
        arrowMat.emissiveColor = new BABYLON.Color3(0.95, 0.3, 0.2);
        arrow.material = arrowMat;
        arrow.alwaysSelectAsActiveMesh = true;

        const cursorEl = document.querySelector(".elev-cursor");

        // Main update: read cursor position (left in %) and convert to distance along route
        function updateMarkerFromCursor() {
            if (!cursorEl) return;
            const m = cursorEl.style.left.match(/([\d.]+)%/);
            if (!m) return;
            const pct = parseFloat(m[1]) / 100;
            if (!isFinite(pct)) return;

            const targetDist = pct * totalDist;
            const i = findSegmentIndexByDist(targetDist);
            const segStart = cum[i];
            const segEnd = cum[i+1];
            const segLen = segEnd - segStart || 1;
            const localT = (targetDist - segStart) / segLen;

            // interpolate in points (scene coords)
            const p0 = points[i];
            const p1 = points[i+1];
            const pos = p0.add(p1.subtract(p0).scale(localT));

            marker.position.copyFrom(pos);

            // place arrow above the marker and point down
            const arrowOffset = 0.35; // vertical offset above line (scene units)
            arrow.position.set(pos.x, pos.y + arrowOffset, pos.z);
            // keep arrow facing down (we already rotated it); optionally match camera rotation if desired

            // optionally clamp camera target (camera will follow marker in render loop)
        }

        // initial update
        updateMarkerFromCursor();

        // ===== Render loop - keep camera target on marker (follows marker) =====
        engine.runRenderLoop(() => {
            updateMarkerFromCursor();

            // camera target locked to marker
            camera.setTarget(marker.position);

            // ensure camera radius not too small
            if (camera.radius < camera.lowerRadiusLimit) camera.radius = camera.lowerRadiusLimit;
            if (camera.radius > camera.upperRadiusLimit) camera.radius = camera.upperRadiusLimit;

            scene.render();
        });

        window.addEventListener("resize", () => engine.resize());
    }

})();
