// ==UserScript==
// @name         Biketerra 3D Route Viewer + Multi Rider Absolute Edition
// @namespace    http://tampermonkey.net/
// @version      1.3
// @description  3D route viewer with elevation + live rider markers (Absolute Path Logic)
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

        // --- Cumulative distances ---
        const cum = new Array(points.length).fill(0);
        for(let i=1;i<points.length;i++){
            const dx=points[i].x-points[i-1].x;
            const dz=points[i].z-points[i-1].z;
            cum[i]=cum[i-1]+Math.hypot(dx,dz);
        }
        const totalDist = cum[cum.length-1]||1;
        console.log(`[3D Viewer] Scene total distance: ${totalDist.toFixed(2)} units`);

        // --- Get real-world route length from page/fallback ---
        let distanceKm = null;
        const routeMain = document.querySelector(".route-main");
        if (!routeMain) return console.warn("[3D Viewer] Cannot find .route-main");

        const infoDiv = Array.from(routeMain.querySelectorAll("div"))
        .find(d => d && /km/i.test(d.textContent) && /\//.test(d.textContent));
        if (!infoDiv) return console.warn("[3D Viewer] Cannot find info div with km / m");

        const text = infoDiv.textContent.replace(/\s+/g, " ").trim();
        const match = text.match(/([\d.,]+)\s*km\s*\/\s*([\d.,]+)\s*m/i);
        if (!match) return console.warn("[3D Viewer] Cannot parse km / m from info div");

        distanceKm = parseFloat(match[1].replace(",", "."));
        const climbM = parseFloat(match[2].replace(",", "."));
        if (!Number.isFinite(distanceKm) || !Number.isFinite(climbM)) return console.warn("[3D Viewer] Invalid distance or climb");

        console.log(`[3D Viewer] Route length: ${distanceKm} km, climb: ${climbM} m`);

        // --- Create Canvas + Scene ---
        const canvas=document.createElement("canvas");
        canvas.width=600; canvas.height=350;
        Object.assign(canvas.style,{position:"fixed",top:"8px",left:"8px",zIndex:"1",background:"transparent",borderRadius:"8px"});
        document.body.appendChild(canvas);
        const engine = new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,premultipliedAlpha:false});
        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0,0,0,0.5);

        // --- START & END ROUTE MARKERS (STATIC) ---
        const startMarker = BABYLON.MeshBuilder.CreateCylinder("startMarker", { height: 1.2, diameter: 0.10 }, scene);
        const endMarker = BABYLON.MeshBuilder.CreateCylinder("endMarker", { height: 1.2, diameter: 0.10 }, scene);

        const startMat = new BABYLON.StandardMaterial("startMat", scene);
        startMat.emissiveColor = new BABYLON.Color3(0, 1, 0); // green
        startMarker.material = startMat;

        const endMat = new BABYLON.StandardMaterial("endMat", scene);
        endMat.emissiveColor = new BABYLON.Color3(1, 0, 0); // red
        endMarker.material = endMat;

        // Position them (always at 0 and End for static map)
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

        // --- Grade Colors Helper ---
        const GRADE_COLORS=[{grade:0,color:"#0008"},{grade:1,color:"#FF6262"},{grade:4,color:"#DC5666"},{grade:8,color:"#B14674"},{grade:11,color:"#7F347C"}];
        function hexToC4(hex){ const n=parseInt(hex.slice(1),16); return new BABYLON.Color4((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1); }
        function getGradeColor(g){ for(let i=GRADE_COLORS.length-1;i>=0;i--){ if(g>=GRADE_COLORS[i].grade) return hexToC4(GRADE_COLORS[i].color); } return hexToC4(GRADE_COLORS[0].color); }

        // --- Flat Fill Mesh ---
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

        // --- Route Line ---
        const line = BABYLON.MeshBuilder.CreateLines("routeLine",{points:points,colors:points.map(()=>new BABYLON.Color4(0.75,0.75,0.75,1))},scene);

        // --- Marker Arrow (YOU) ---
        const marker = BABYLON.MeshBuilder.CreateSphere("marker",{ diameter: 0.1 },scene);
        marker.isVisible = true;

        // --- Get MY helmet color ---
        let myHelmetColor = "#ffffff";
        if (window.gameManager?.humans) {
            for (const h of Object.values(window.gameManager.humans)) {
                if (h.isMe || h.athleteId === window.myRiderId) {
                    myHelmetColor = h.config?.design?.helmet_color || myHelmetColor;
                    break;
                }
            }
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

        const arrow = BABYLON.MeshBuilder.CreateCylinder("arrow",{height:0.4,diameterTop:0,diameterBottom:0.2,tessellation:12},scene);
        arrow.rotation.x=Math.PI; arrow.position.y=bottomY+0.6*1.2;
        const arrowMat = new BABYLON.StandardMaterial("arrowMat",scene);
        arrowMat.emissiveColor=new BABYLON.Color3(0.95,0.3,0.2); arrow.material=arrowMat; arrow.alwaysSelectAsActiveMesh=true;

        const cursorEl = document.querySelector(".elev-cursor");

        function findSegmentIndexByDist(d){
            if(d<=0) return 0;
            if(d>=totalDist) return cum.length-2;
            let lo=0,hi=cum.length-1;
            while(lo<=hi){
                const mid=(lo+hi)>>1;
                if(cum[mid]<=d && d<=cum[mid+1]) return mid;
                if(cum[mid]<d) lo=mid+1;
                else hi=mid-1;
            }
            return Math.max(0,Math.min(cum.length-2,lo-1));
        }

        // --- UPDATE YOU (CURSOR) ---
        function updateMarkerFromCursor(){
            if(!cursorEl) return;
            const m = cursorEl.style.left.match(/([\d.]+)%/); if(!m) return;
            const pct = parseFloat(m[1])/100; if(!isFinite(pct)) return;

            let targetDist = pct * totalDist;

            // ABSOLUTE CHECK: Are YOU on Path B (ID 1)?
            const egoPathId = window.gameManager?.ego?.currentPath?.id;
            if (egoPathId === 1) {
                // If you are on Path B, your progress bar (0-100%) represents moving BACKWARDS on the map
                targetDist = totalDist - targetDist;
            }

            const i = findSegmentIndexByDist(targetDist);
            const segStart=cum[i], segEnd=cum[i+1], segLen=segEnd-segStart||1;
            const localT=(targetDist-segStart)/segLen;
            const p0=points[i], p1=points[i+1];
            const pos=p0.add(p1.subtract(p0).scale(localT));
            marker.position.copyFrom(pos);
            arrow.position.set(pos.x,pos.y+0.35,pos.z);
        }

        // --- Rider markers ---
        let riderMeshes = new Map();

        // --- Get all riders (Absolute Logic) ---
        function getRiderPositions() {
            const results = [];
            if (!window.hackedRiders || !window.gameManager?.humans) return results;

            const myRider = window.hackedRiders.find(r => r.isMe);
            if (!myRider || !distanceKm) return results;

            const gmHumans = window.gameManager.humans;

            window.hackedRiders.forEach(r => {
                if (r.isMe) return;

                // 1. Get Human Object
                let targetHuman = gmHumans[r.riderId];
                if (!targetHuman) {
                    for (const h of Object.values(gmHumans)) {
                        if ((h.athleteId || h.id) === r.riderId) {
                            targetHuman = h;
                            break;
                        }
                    }
                }

                // 2. Calculate Distance
                const riderKm = r.dist / 1000;
                let wrappedKm = ((riderKm % distanceKm) + distanceKm) % distanceKm;

                // 3. ABSOLUTE DIRECTION LOGIC
                // Path ID 1 = Path B (Going Backwards)
                if (targetHuman && targetHuman.currentPath && targetHuman.currentPath.id === 1) {
                     wrappedKm = distanceKm - wrappedKm;
                }

                // Color
                let helmetColor = "#ffffff";
                if (targetHuman?.config?.design?.helmet_color) {
                    helmetColor = targetHuman.config.design.helmet_color;
                }

                results.push({
                    name: r.name,
                    riderKm: wrappedKm,
                    riderId: r.riderId,
                    helmetColor
                });
            });
            return results;
        }

        // --- Update rider meshes in the scene ---
        function updateRidersMarkers() {
            const riders = getRiderPositions();
            const existingNames = new Set(riders.map(r => r.name));

            // Cleanup
            for (let [name, mesh] of riderMeshes) {
                if (!existingNames.has(name)) {
                    mesh.dispose();
                    riderMeshes.delete(name);
                }
            }

            // Update
            riders.forEach(r => {
                let mesh = riderMeshes.get(r.name);
                if (!mesh) {
                    mesh = BABYLON.MeshBuilder.CreateSphere(r.name, { diameter: 0.1 }, scene);
                    let color = new BABYLON.Color3(1, 1, 1);
                    if (r.helmetColor && r.helmetColor.startsWith("#")) {
                        const rr = parseInt(r.helmetColor.slice(1, 3), 16) / 255;
                        const gg = parseInt(r.helmetColor.slice(3, 5), 16) / 255;
                        const bb = parseInt(r.helmetColor.slice(5, 7), 16) / 255;
                        color = new BABYLON.Color3(rr, gg, bb);
                    }
                    const mat = new BABYLON.StandardMaterial(r.name + "Mat", scene);
                    mat.diffuseColor = color;
                    mat.emissiveColor = color;
                    mat.backFaceCulling = false;
                    mat.outlineWidth = 1;
                    mat.outlineColor = new BABYLON.Color3(0, 0, 0);
                    mesh.material = mat;
                    riderMeshes.set(r.name, mesh);
                }

                // Map KM -> 3D Units
                // Note: wrappedKm is already flipped if needed by getRiderPositions
                const targetDist = (r.riderKm / distanceKm) * totalDist;

                let i = 0;
                while (i < cum.length - 1 && !(cum[i] <= targetDist && targetDist <= cum[i + 1])) i++;
                const segStart = cum[i];
                const segEnd = cum[i + 1];
                const localT = (targetDist - segStart) / (segEnd - segStart || 1);
                const pos = points[i].add(points[i + 1].subtract(points[i]).scale(localT));
                mesh.position.copyFrom(pos);
            });
        }

        // --- Render Loop ---
        engine.runRenderLoop(()=>{
            updateMarkerFromCursor();
            updateRidersMarkers();
            camera.setTarget(marker.position);
            scene.render();
        });

        window.addEventListener("resize",()=>engine.resize());
    }

})();
