// ==UserScript==
// @name         Biketerra 3D Route Viewer + Multi Rider Absolute Edition
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  3D viewer. Fixed: Correctly detects when YOU (Ego) switch paths/turn around.
// @author       Josef/chatgpt
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate/*
// @exclude      https://biketerra.com/dashboard
// @icon         https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ---------- Fetch Interception ----------
    let interceptedRouteJson = null;
    const originalFetch = window.fetch;
    window.fetch = async function(resource, options) {
        let url = (resource instanceof Request) ? resource.url : resource;
        if (url && url.includes("/__data.json")) {
            const response = await originalFetch(resource, options);
            const clone = response.clone();
            try { interceptedRouteJson = await clone.json(); console.log("[3D Viewer] Intercepted JSON via fetch"); }
            catch(e){ console.error("[3D Viewer] Parse error:", e); }
            return response;
        }
        return originalFetch(resource, options);
    };

    // ---------- Wait Helpers ----------
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

    async function waitForIntercept(timeout=3000){
        const start = performance.now();
        while(!interceptedRouteJson){
            if(performance.now()-start>timeout) return false;
            await new Promise(r=>setTimeout(r,10));
        }
        return true;
    }

    waitFor(".elev-cursor").then(()=>{ start3DViewer(); }).catch(console.error);

    // ---------- Start 3D Viewer ----------
    async function start3DViewer() {
        if(typeof window.BABYLON === 'undefined'){
            await new Promise((resolve, reject)=>{
                const s = document.createElement('script');
                s.src='https://cdn.babylonjs.com/babylon.js';
                s.onload=resolve; s.onerror=reject;
                document.head.appendChild(s);
            });
        }
        const BABYLON = window.BABYLON;

        // --- Determine JSON URL ---
        let url;
        const params = new URLSearchParams(window.location.search);
        if(window.location.pathname.startsWith("/spectate/")){
            const spectateId = window.location.pathname.split("/")[2];
            url = `https://biketerra.com/spectate/${spectateId}/__data.json`;
        } else if(window.location.pathname.startsWith("/ride")){
            const eventId = params.get("event");
            if(eventId) url = `https://biketerra.com/ride/__data.json?event=${eventId}`;
            else { const routeId = params.get("route"); if(!routeId) return console.error("No route ID"); url=`https://biketerra.com/ride/__data.json?route=${routeId}`; }
        } else return console.error("Unknown page type");

        await waitForIntercept();
        let j = interceptedRouteJson || window.__remixContext?.state?.loaderData || null;
        if(!j) { const resp=await fetch(url); j = await resp.json(); }
        if(!j) return console.error("Cannot get route JSON");

        // --- Extract route points ---
        function findRoutes(obj,routes=[]){
            if(!obj) return routes;
            if(Array.isArray(obj)){
                if(obj.length>0 && Array.isArray(obj[0]) && typeof obj[0][0]==="number"){ routes.push(obj); }
                else obj.forEach(el=>findRoutes(el,routes));
            } else if(typeof obj==="string"){ try{ findRoutes(JSON.parse(obj),routes); } catch{} }
            else if(typeof obj==="object") Object.values(obj).forEach(v=>findRoutes(v,routes));
            return routes;
        }
        const routes = findRoutes(j);
        if(!routes.length) return console.warn("No route array found");
        const raw = routes[0];

        // --- Convert to scene coordinates ---
        const lat0 = raw[0][0]*Math.PI/180;
        const lon0 = raw[0][1]*Math.PI/180;
        const R = 6371000;

        const xVals = raw.map(p=>((p[1]*Math.PI/180 - lon0)*R*Math.cos(lat0)));
        const zVals = raw.map(p=>((p[0]*Math.PI/180 - lat0)*R));
        const yVals = raw.map(p=>p[2]);

        const xMin=Math.min(...xVals), xMax=Math.max(...xVals);
        const zMin=Math.min(...zVals), zMax=Math.max(...zVals);

        // --- Real-world scaling (1%) ---
        const scaleFactor = 0.01;
        const xCenter = (xMin + xMax) / 2;
        const zCenter = (zMin + zMax) / 2;
        const yMinVal = Math.min(...yVals);

        const points = raw.map((p,i)=>new BABYLON.Vector3(
            (xVals[i]-xCenter)*scaleFactor,
            (yVals[i]-yMinVal)*scaleFactor,
            (zVals[i]-zCenter)*scaleFactor
        ));

        console.log(`[3D Viewer] Applied 1% real-world scaling`);

        // --- Cumulative distances (3D Units) ---
        const cum = new Array(points.length).fill(0);
        for(let i=1;i<points.length;i++){
            const dx=points[i].x-points[i-1].x;
            const dz=points[i].z-points[i-1].z;
            cum[i]=cum[i-1]+Math.hypot(dx,dz);
        }
        const totalDist = cum[cum.length-1]||1;
        console.log(`[3D Viewer] Scene total distance: ${totalDist.toFixed(2)} units`);


        // --- MULTI-PATH DISTANCE EXTRACTION (v2.0) ---
        const pathLengths = new Map();
        let fallbackDistance = 0;

        function extractPathLengths(obj) {
            if (obj && obj.paths && Array.isArray(obj.paths)) {
                obj.paths.forEach(p => {
                    if (p.id !== undefined && p.distance) {
                        pathLengths.set(p.id, p.distance);
                    }
                });
            }
            if (obj && obj.pathA && obj.pathA.distance) pathLengths.set(0, obj.pathA.distance);
            if (obj && obj.pathB && obj.pathB.distance) pathLengths.set(1, obj.pathB.distance);

            if (pathLengths.size === 0 && typeof obj === 'object' && obj !== null) {
                for (const k in obj) {
                    if (obj.hasOwnProperty(k) && typeof obj[k] === 'object') {
                        extractPathLengths(obj[k]);
                        if (pathLengths.size > 0) return;
                    }
                }
            }
        }
        extractPathLengths(j);

        let gpsMeters = 0;
        for(let i=1; i<raw.length; i++) {
             const dx = xVals[i] - xVals[i-1];
             const dz = zVals[i] - zVals[i-1];
             gpsMeters += Math.hypot(dx, dz);
        }
        fallbackDistance = gpsMeters;

        if (pathLengths.size > 0) {
            console.log("[3D Viewer] Found Internal Path Lengths:", Object.fromEntries(pathLengths));
        } else {
            console.warn("[3D Viewer] Using GPS Fallback Distance:", fallbackDistance);
        }
        // ---------------------------------------------


        // --- Create Canvas + Scene ---
        const canvas=document.createElement("canvas");
        canvas.width=600; canvas.height=350;
        Object.assign(canvas.style,{position:"fixed",top:"8px",left:"8px",zIndex:"1",background:"transparent",borderRadius:"8px"});
        document.body.appendChild(canvas);
        const engine = new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,premultipliedAlpha:false});
        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0,0,0,0.5);

        // --- STATIC MARKERS ---
        const startMarker = BABYLON.MeshBuilder.CreateCylinder("startMarker", { height: 1.2, diameter: 0.10 }, scene);
        const endMarker = BABYLON.MeshBuilder.CreateCylinder("endMarker", { height: 1.2, diameter: 0.10 }, scene);
        const startMat = new BABYLON.StandardMaterial("startMat", scene);
        startMat.emissiveColor = new BABYLON.Color3(0, 1, 0);
        startMarker.material = startMat;
        const endMat = new BABYLON.StandardMaterial("endMat", scene);
        endMat.emissiveColor = new BABYLON.Color3(1, 0, 0);
        endMarker.material = endMat;

        if(points.length > 0) {
            startMarker.position.x = points[0].x;
            startMarker.position.z = points[0].z;
            startMarker.position.y = points[0].y + 0.6;
            endMarker.position.x = points[points.length-1].x;
            endMarker.position.z = points[points.length-1].z;
            endMarker.position.y = points[points.length-1].y + 0.6;
        }

        const radius=Math.max(...points.map(p=>p.length()))*2;
        const camera = new BABYLON.ArcRotateCamera("cam",Math.PI/2,Math.PI/3,radius,BABYLON.Vector3.Zero(),scene);
        camera.attachControl(canvas,true);
        camera.minZ=0.1; camera.lowerRadiusLimit=0.5; camera.upperRadiusLimit=radius*5; camera.wheelDeltaPercentage=0.05;
        new BABYLON.HemisphericLight("light",new BABYLON.Vector3(0,1,0),scene);

        // --- Visuals: Grade Colors & Fill ---
        const GRADE_COLORS=[{grade:0,color:"#0008"},{grade:1,color:"#FF6262"},{grade:4,color:"#DC5666"},{grade:8,color:"#B14674"},{grade:11,color:"#7F347C"}];
        function hexToC4(hex){ const n=parseInt(hex.slice(1),16); return new BABYLON.Color4((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1); }
        function getGradeColor(g){ for(let i=GRADE_COLORS.length-1;i>=0;i--){ if(g>=GRADE_COLORS[i].grade) return hexToC4(GRADE_COLORS[i].color); } return hexToC4(GRADE_COLORS[0].color); }

        const bottomY = Math.min(...points.map(p=>p.y));
        const grades=[];
        for(let i=0;i<points.length-1;i++){
            const dy=points[i+1].y-points[i].y;
            const dxz=points[i+1].subtract(points[i]).length();
            grades.push(dxz===0?0:(dy/dxz)*100);
        }
        grades.push(grades[grades.length-1]);
        const segmentColors = grades.map(g=>getGradeColor(g));

        const positions=[],colorsArray=[],indices=[];
        let baseIndex=0;
        for(let i=0;i<points.length-1;i++){
            const p0=points[i],p1=points[i+1];
            const c0=segmentColors[i],c1=segmentColors[i+1];
            const t0=[p0.x,p0.y,p0.z], t1=[p1.x,p1.y,p1.z];
            const b0=[p0.x,bottomY,p0.z], b1=[p1.x,bottomY,p1.z];
            positions.push(...t0,...t1,...b0,...b1);
            const c0a=[c0.r,c0.g,c0.b,1];
            colorsArray.push(...c0a,...c0a,...c0a,...c0a);
            indices.push(baseIndex,baseIndex+1,baseIndex+2,baseIndex+1,baseIndex+3,baseIndex+2);
            baseIndex+=4;
        }
        const fill = new BABYLON.Mesh("flatFill",scene);
        fill.setVerticesData(BABYLON.VertexBuffer.PositionKind,positions);
        fill.setVerticesData(BABYLON.VertexBuffer.ColorKind,colorsArray);
        fill.setIndices(indices);
        const fillMat = new BABYLON.StandardMaterial("fillMat",scene);
        fillMat.emissiveColor = new BABYLON.Color3(1,1,1);
        fillMat.vertexColorMode = BABYLON.Constants.VERTEXCOLOR_USE_COLORS;
        fillMat.backFaceCulling = false;
        fillMat.alpha = 1;
        fill.material=fillMat;

        const line = BABYLON.MeshBuilder.CreateLines("routeLine",{points:points,colors:points.map(()=>new BABYLON.Color4(0.75,0.75,0.75,1))},scene);


        // --- CORE MATH HELPER (USED BY ALL MARKERS) ---
        // Calculates normalized 3D Target and 3D Speed for any rider given their ID, Dist(m), Speed(m/s)
        function calculateRider3DData(riderId, distMeters, speedMps) {
            const gm = window.gameManager;
            let targetHuman = null;

            // --- FIXED: CHECK EGO FIRST ---
            if (gm?.ego && (gm.ego.athleteId == riderId || gm.ego.id == riderId)) {
                targetHuman = gm.ego;
            }
            // --- THEN CHECK OTHERS ---
            else if (gm?.humans) {
                 targetHuman = gm.humans[riderId] || Object.values(gm.humans).find(h => (h.athleteId || h.id) == riderId);
            }

            // 1. Identify Path
            let pathId = 0;
            if (targetHuman && targetHuman.currentPath) {
                pathId = targetHuman.currentPath.id;
            }

            // 2. Get Exact Path Length
            const pathTotalMeters = pathLengths.get(pathId) || fallbackDistance;

            // 3. Normalize Progress
            let progress = (distMeters % pathTotalMeters) / pathTotalMeters;

            // 4. Handle Reverse (Path B)
            if (pathId === 1) {
                progress = 1.0 - progress;
            }

            // 5. Convert to 3D Units
            const target3D = progress * totalDist;

            // 6. Convert Speed (m/s -> 3D/s)
            let speed3D = speedMps * (totalDist / pathTotalMeters);

            // --- SMOOTHING FIX FOR REVERSE PATH ---
            // If on Path 1 (Reverse), flip Speed to be Negative
            if (pathId === 1) {
                speed3D = -speed3D;
            }

            return { target3D, speed3D, pathId, pathTotalMeters };
        }


        // --- MAIN MARKER (Me or Focal) ---
        const marker = BABYLON.MeshBuilder.CreateSphere("marker",{ diameter: 0.1 },scene);
        const arrow = BABYLON.MeshBuilder.CreateCylinder("arrow",{height:0.4,diameterTop:0,diameterBottom:0.2,tessellation:12},scene);
        arrow.rotation.x=Math.PI; arrow.position.y=bottomY+0.6*1.2;
        const arrowMat = new BABYLON.StandardMaterial("arrowMat",scene);
        arrowMat.emissiveColor=new BABYLON.Color3(0.95,0.3,0.2); arrow.material=arrowMat; arrow.alwaysSelectAsActiveMesh=true;

        // --- FORCE RENDER ---
        marker.alwaysSelectAsActiveMesh = true;

        // Main Marker Smoothing State
        let mainMarkerState = {
            lastUpdateTime: 0,
            lastKnownDist: 0,
            predictedDist: 0,
            speed: 0,
            initialized: false
        };

        // Initialize Main Marker Material
        let myHelmetColor = "#ffffff";
        const gm = window.gameManager;
        const humans = gm?.humans || {};
        const ego = gm?.ego;
        const focalRider = gm?.focalRider;
        if (ego) {
             myHelmetColor = ego?.entity?.design?.helmet_color || ego?.config?.design?.helmet_color || ego?.helmet_color || myHelmetColor;
        } else if (focalRider) {
            const focalId = focalRider.athleteId || focalRider.id;
            const targetHuman = humans[focalId] || Object.values(humans).find(h => (h.athleteId || h.id) == focalId);
            if (targetHuman) myHelmetColor = targetHuman?.config?.design?.helmet_color || myHelmetColor;
        }
        let myColor = new BABYLON.Color3(1, 1, 1);
        if (myHelmetColor && myHelmetColor.startsWith("#")) {
            const rr = parseInt(myHelmetColor.slice(1, 3), 16) / 255;
            const gg = parseInt(myHelmetColor.slice(3, 5), 16) / 255;
            const bb = parseInt(myHelmetColor.slice(5, 7), 16) / 255;
            myColor = new BABYLON.Color3(rr, gg, bb);
        }
        const myMat = new BABYLON.StandardMaterial("myMarkerMat", scene);
        myMat.diffuseColor = myColor;
        myMat.emissiveColor = myColor;
        myMat.backFaceCulling = false;
        myMat.outlineWidth = 1;
        myMat.outlineColor = new BABYLON.Color3(0, 0, 0);
        marker.material = myMat;


        // --- UPDATE FUNCTION FOR MAIN MARKER ---
        function updateMainMarker() {
            if (!window.hackedRiders) return;

            const focalId = window.gameManager.focalRider?.athleteId || window.gameManager.focalRider?.id;
            const myId = window.gameManager.ego?.athleteId;
            const mainId = myId || focalId;

            const r = window.hackedRiders.find(rider => rider.riderId == mainId);
            if (!r) return; // Main rider data not found yet

            // Calculate Target using standard logic
            const data = calculateRider3DData(r.riderId, r.dist, r.speed);

            const now = performance.now();

            // Initialize or Update State
            if (!mainMarkerState.initialized) {
                mainMarkerState = {
                    lastUpdateTime: now,
                    lastKnownDist: data.target3D,
                    predictedDist: data.target3D,
                    speed: data.speed3D,
                    initialized: true
                };
            } else if (Math.abs(mainMarkerState.lastKnownDist - data.target3D) > 0.001) {
                // Data refreshed
                mainMarkerState.lastUpdateTime = now;
                mainMarkerState.lastKnownDist = data.target3D;
                mainMarkerState.speed = data.speed3D;
            }

            // Physics Prediction
            const dt = (now - mainMarkerState.lastUpdateTime) / 1000;
            let predictedPos = mainMarkerState.lastKnownDist + (mainMarkerState.speed * dt);

            // Teleport Check
            if (Math.abs(predictedPos - data.target3D) > totalDist * 0.5) {
                predictedPos = data.target3D;
                mainMarkerState.lastKnownDist = data.target3D;
                mainMarkerState.lastUpdateTime = now;
            }

            // Loop Wrapping
            if (predictedPos > totalDist) predictedPos = predictedPos % totalDist;
            if (predictedPos < 0) predictedPos = totalDist + predictedPos;

            // Map to 3D Points
            const safeD = predictedPos;
            let i = 0;
            while (i < cum.length - 1 && !(cum[i] <= safeD && safeD <= cum[i + 1])) i++;
            const segStart = cum[i];
            const segEnd = cum[i + 1];
            const localT = (safeD - segStart) / (segEnd - segStart || 1);
            const pos = points[i].add(points[i + 1].subtract(points[i]).scale(localT));

            // Apply to Meshes
            marker.position.set(pos.x, pos.y, pos.z);
            arrow.position.set(pos.x, pos.y + 0.35 + 0.2, pos.z);
        }


        // --- RIDER MARKERS (OTHERS) ---
        let riderMeshes = new Map();

        function updateRidersMarkers() {
            if (!window.hackedRiders) return;

            const focalId = window.gameManager.focalRider?.athleteId || window.gameManager.focalRider?.id;
            const myId = window.gameManager.ego?.athleteId;
            const idToExclude = myId || focalId;
            const gmHumans = window.gameManager.humans || {};

            const ridersRaw = window.hackedRiders.filter(r => r.riderId != idToExclude);
            const existingNames = new Set(ridersRaw.map(r => r.name));

            // Cleanup
            for (let [name, entry] of riderMeshes) {
                if (!existingNames.has(name)) {
                    entry.mesh.dispose();
                    riderMeshes.delete(name);
                }
            }

            const now = performance.now();

            ridersRaw.forEach(r => {
                let entry = riderMeshes.get(r.name);
                const data = calculateRider3DData(r.riderId, r.dist, r.speed);

                if (!entry) {
                    // New Rider Init
                    const mesh = BABYLON.MeshBuilder.CreateSphere(r.name, { diameter: 0.1 }, scene);
                    let color = new BABYLON.Color3(1, 1, 1);
                    mesh.alwaysSelectAsActiveMesh = true;

                    // Color Lookup
                    let targetHuman = gmHumans[r.riderId];
                    if(!targetHuman) {
                        for(const h of Object.values(gmHumans)) if((h.athleteId||h.id)==r.riderId) { targetHuman=h; break; }
                    }
                    let hex = targetHuman?.config?.design?.helmet_color || "#ffffff";

                    if (hex.startsWith("#")) {
                        const rr = parseInt(hex.slice(1, 3), 16) / 255;
                        const gg = parseInt(hex.slice(3, 5), 16) / 255;
                        const bb = parseInt(hex.slice(5, 7), 16) / 255;
                        color = new BABYLON.Color3(rr, gg, bb);
                    }
                    const mat = new BABYLON.StandardMaterial(r.name + "Mat", scene);
                    mat.diffuseColor = color;
                    mat.emissiveColor = color;
                    mat.backFaceCulling = false;
                    mat.outlineWidth = 1;
                    mat.outlineColor = new BABYLON.Color3(0, 0, 0);
                    mesh.material = mat;

                    entry = {
                        mesh,
                        lastUpdateTime: now,
                        lastKnownDist: data.target3D,
                        predictedDist: data.target3D,
                        speed: data.speed3D
                    };
                    riderMeshes.set(r.name, entry);
                } else {
                    // State Update
                    if (Math.abs(entry.lastKnownDist - data.target3D) > 0.001) {
                         entry.lastUpdateTime = now;
                         entry.lastKnownDist = data.target3D;
                         entry.speed = data.speed3D;
                    }
                }

                // Physics Prediction
                const dt = (now - entry.lastUpdateTime) / 1000;
                let predictedPos = entry.lastKnownDist + (entry.speed * dt);

                if (Math.abs(predictedPos - data.target3D) > totalDist * 0.5) {
                    predictedPos = data.target3D;
                    entry.lastKnownDist = data.target3D;
                    entry.lastUpdateTime = now;
                }

                if (predictedPos > totalDist) predictedPos = predictedPos % totalDist;
                if (predictedPos < 0) predictedPos = totalDist + predictedPos;

                // Positioning
                const safeD = predictedPos;
                let i = 0;
                while (i < cum.length - 1 && !(cum[i] <= safeD && safeD <= cum[i + 1])) i++;
                const segStart = cum[i];
                const segEnd = cum[i + 1];
                const localT = (safeD - segStart) / (segEnd - segStart || 1);
                const pos = points[i].add(points[i + 1].subtract(points[i]).scale(localT));

                // Height Offset
                entry.mesh.position.set(pos.x, pos.y, pos.z);
            });
        }

        engine.runRenderLoop(()=>{
            updateMainMarker();
            updateRidersMarkers();
            camera.setTarget(marker.position);
            scene.render();
        });

        window.addEventListener("resize",()=>engine.resize());
    }

})();
