// ==UserScript==
// @name          Biketerra 3D Route Viewer + Multi Rider Absolute Edition (with Labels)
// @namespace     http://tampermonkey.net/
// @version       3.2.0
// @description   3D viewer with two-color markers, group indicators, and labels (Name, Speed, W/kg)
// @author        Josef/chatgpt
// @match         https://biketerra.com/ride*
// @match         https://biketerra.com/spectate/*
// @exclude       https://biketerra.com/dashboard
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant         none
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


const hudObserver = new MutationObserver(() => {
    const hud = document.querySelector(".hud-bottom");
    if (hud) hud.style.left = "40%";
});
hudObserver.observe(document.body, { childList: true, subtree: true });
const mapObserver = new MutationObserver(() => {
    const mapWrap = document.querySelector(".map-wrap");
    if (mapWrap) mapWrap.style.display = "none";
});
mapObserver.observe(document.body, { childList: true, subtree: true });

    // ---------- Start 3D Viewer ----------
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
        // --- 1. Load BABYLON.GUI ---
        if(typeof window.BABYLON.GUI === 'undefined'){
             await new Promise((resolve, reject)=>{
                const s = document.createElement('script');
                s.src='https://cdn.babylonjs.com/gui/babylon.gui.min.js';
                s.onload=resolve; s.onerror=reject;
                document.head.appendChild(s);
            });
        }

        const BABYLON = window.BABYLON;
        const GUI = window.BABYLON.GUI;

        // --- FLAGS (Correct location to avoid SyntaxError) ---
        let labelsVisible = false; // Default: OFF (as requested)
        let firstFrame = true;     // Default: ON (for zoom lock fix)
        // -----------------------------------------------------
        let mainMarkerState = {
            lastUpdateTime: 0,
            lastKnownDist: 0,
            predictedDist: 0,
            speed: 0,
            initialized: false
        };

        let currentMarkerHelmetHex = "#ffffff";
        let currentMarkerSkinHex = "#ffffff";
// Add this function definition within start3DViewer()

/**
 * Checks for overlapping labels in 2D screen space and offsets them vertically.
 * Then draws a leader line from the label's new screen position back to the 3D marker.
 */
function applyCollisionAvoidance(allRiderEntries, scene, advancedTexture) {
    // NOTE: This check should be 'allRiderEntries.length === 0' since 1 entry doesn't need collision logic.
    if (allRiderEntries.length === 0) return;

    // Hide all lines first (if they exist)
    allRiderEntries.forEach(entry => {
        if (entry.leaderLine) entry.leaderLine.isVisible = false;
        // Also ensure labelControls is correctly accessible, as noted in the last response.
        // The structure of allRiderEntries must be:
        // { sphere: ..., labelControls: ..., leaderLine: ... }
        if (entry.leaderLine && entry.leaderLine.setControlPoints) {
             // Reset control points to prevent drawing complex shapes from old data
             entry.leaderLine.setControlPoints([new BABYLON.Vector2(0, 0), new BABYLON.Vector2(0, 0)]);
        }
    });

    // Get the screen-space position and height of all labels
    const labelData = allRiderEntries.map(entry => {
        const marker = entry.sphere.parent;
        // Corrected access: Use entry.labelControls if following the last recommended main rider structure
        const labelContainer = entry.labelControls.container;

        // Use BABYLON's project method to get the 2D screen position of the 3D mesh
        const screenPos = BABYLON.Vector3.Project(
            marker.absolutePosition,
            BABYLON.Matrix.Identity(), // World matrix
            scene.getTransformMatrix(), // View/Projection Matrix
            // 🐛 CORRECTED LINE BELOW: Get the dimensions of the rendering engine's canvas
            scene.activeCamera.getEngine().getRenderingCanvasClientRect()
        );

        return {
            name: entry.name,
            entry: entry,
            screenX: screenPos.x,
            screenY: screenPos.y,
            height: 60,
            width: 150,
            originalMeshY: screenPos.y,
            currentOffsetY: labelContainer.linkOffsetY,
            labelContainer: labelContainer,
            leaderLine: entry.leaderLine
        };
    });

    // 2. Collision Detection and Offset
    labelData.sort((a, b) => a.screenY - b.screenY);

    for (let i = 0; i < labelData.length; i++) {
        let current = labelData[i];

        // Lowest point of the currently positioned label
        let currentBottom = current.screenY - current.currentOffsetY + (current.height / 2);

        for (let j = i + 1; j < labelData.length; j++) {
            let other = labelData[j];

            // Highest point of the other label
            let otherTop = other.screenY - other.currentOffsetY - (other.height / 2);

            // Check for vertical overlap (5px buffer)
            if (currentBottom + 5 > otherTop) {
                let requiredMove = (currentBottom + 5) - otherTop;

                // Increase the 'other' label's screen-space offset (moves label up on screen)
                other.currentOffsetY -= requiredMove;

                // Update 'currentBottom' with the new position of the 'other' label's bottom
                currentBottom = other.screenY - other.currentOffsetY + (other.height / 2);
            }
        }
    }

    // 3. Apply Offsets and Draw Lines
    labelData.forEach(data => {
        const offsetPixels = data.currentOffsetY;
        const labelContainer = data.labelContainer;

        // Apply the calculated total screen-space offset
        labelContainer.linkOffsetY = offsetPixels;

        // 4. Draw Leader Lines
        let line = data.leaderLine;

        if (!line) {
            line = new GUI.Line(data.name + "_leaderLine");
            line.color = "white";
            line.alpha = 0.8;
            line.lineWidth = 1;
            advancedTexture.addControl(line);
            data.entry.leaderLine = line;
        }

        // Set the line coordinates:
        const labelY = data.screenY - data.currentOffsetY;
        const markerY = data.originalMeshY;
        const markerX = data.screenX;

        // Reset control points before setting new line end points (best practice for GUI.Line)
        line.setControlPoints([
            new BABYLON.Vector2(markerX, labelY),
            new BABYLON.Vector2(markerX, markerY)
        ]);

        line.isVisible = true;
    });
}        // --- Determine JSON URL ---
        let url;
        const params = new URLSearchParams(window.location.search);
        let isSpectating = window.location.pathname.startsWith("/spectate/");

        if(isSpectating){
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
            const dy=points[i].y-points[i-1].y;
            const dz=points[i].z-points[i-1].z;
            cum[i]=cum[i-1]+Math.sqrt(dx*dx+dy*dy+dz*dz);
        }
        const totalDist = cum[cum.length-1]||1;
        console.log(`[3D Viewer] Scene total distance: ${totalDist.toFixed(2)} units`);


        // --- Create Canvas + Scene ---
        const canvas=document.createElement("canvas");
        canvas.width=655; canvas.height=450;
        Object.assign(canvas.style,{position:"fixed",bottom:"8px",right:"8px",zIndex:"1",background:"transparent",borderRadius:"8px"});
        document.body.appendChild(canvas);
        const engine = new BABYLON.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,premultipliedAlpha:false});
        const scene = new BABYLON.Scene(engine);
        scene.clearColor = new BABYLON.Color4(0,0,0,0.5);

        // --- 2. Initialize AdvancedDynamicTexture (ADT) ---
        const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, scene);

        // --- STATIC MARKERS ---
        const bottomY = Math.min(...points.map(p=>p.y));

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


        // --- MAIN MARKER (Me or Focal) ---
        const marker = createTwoColorSphere("mainMarker", "#ffffff", "#ffffff", scene);
        // Hide name label for the main marker, as it is usually obvious
        if (marker.labelControls) marker.labelControls.nameText.isVisible = false;
        if (marker.label3D) marker.label3D.plane.isVisible = labelsVisible;

        // --- ARROW REMOVAL: Replaced with a placeholder null variable ---
        const arrow = null;
        // All subsequent references to arrow (like setting its position/visibility) will safely fail or be ignored.

// **********************************************
// * STEP 2: IMMEDIATE INITIAL MARKER POSITIONING *
// * (This must be immediately after marker creation)
// **********************************************
        updateMainMarker();


// **********************************************
// * STEP 3: CAMERA SETUP (FIXING THE JUMP) *
// **********************************************
        // 1. Calculate the max viewing radius (used for zoom limits)
        const maxRadius=Math.max(...points.map(p=>p.length()))*0.2;

        // 2. Set your desired starting zoom (e.g., 0.1 for very close)
        const initialRadius = maxRadius * 0.25;

        // 3. Create a static vector for the camera's INITIAL target.
        // We use marker.parent.position, which was just updated by updateMainMarker().
        const initialTarget = marker.parent.position.clone();

        // 4. Create camera, using the static target and the initial zoom
        const camera = new BABYLON.ArcRotateCamera("cam",Math.PI/2,Math.PI/3,initialRadius,initialTarget,scene);
        camera.attachControl(canvas,true);

        // 5. Set camera limits
        camera.minZ=0.1; camera.lowerRadiusLimit=0.5; camera.upperRadiusLimit=maxRadius*5; camera.wheelDeltaPercentage=0.05;

// **********************************************


        new BABYLON.HemisphericLight("light",new BABYLON.Vector3(0,1,0),scene);

        // --- Visuals: Grade Colors & Fill ---
        const GRADE_COLORS=[{grade:0,color:"#0008"},{grade:1,color:"#FF6262"},{grade:4,color:"#DC5666"},{grade:8,color:"#B14674"},{grade:11,color:"#7F347C"}];
        function hexToC4(hex){ const n=parseInt(hex.slice(1),16); return new BABYLON.Color4((n>>16&255)/255,(n>>8&255)/255,(n&255)/255,1); }
        function getGradeColor(g){ for(let i=GRADE_COLORS.length-1;i>=0;i--){ if(g>=GRADE_COLORS[i].grade) return hexToC4(GRADE_COLORS[i].color); } return hexToC4(GRADE_COLORS[0].color); }

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


        // --- 3. UTILITY: Create Text Label (ADT Control) ---
// --- 3. UTILITY: Create Text Label (ADT Control) ---
function createRiderLabel3D(name) {
    const plane = BABYLON.MeshBuilder.CreatePlane(name + "_labelPlane", {
        width: 1.0,
        height: 0.35
    }, scene);
plane.scaling.x = 0.8;
plane.scaling.y = 0.8;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;

    const tex = new BABYLON.DynamicTexture(name + "_labelTex", {
        width: 512,
        height: 256
    }, scene, true);

    const mat = new BABYLON.StandardMaterial(name + "_labelMat", scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = 0.6;

    plane.material = mat;

    const ctx = tex.getContext();

    function draw(topText, bottomText) {
        ctx.clearRect(0, 0, 512, 256);

        // Background
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.fillRect(0, 0, 512, 256);

        // Name
        ctx.fillStyle = "white";
        ctx.font = "bold 48px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(topText || "", 256, 80);

        // Speed + W/kg
        ctx.fillStyle = "#FFD700";
        ctx.font = "52px Arial";
        ctx.fillText(bottomText || "", 256, 170);

        tex.update();
    }

    // ✅ INITIAL DRAW (NAME ONLY)
    draw(name, "");

    return {
        plane,
        draw
    };
}
// ✅ Auto-calibrated dynamic zoom scaling (NO fixed radius values)
let __labelZoomRefRadius = null;

function applyDynamicLabelScaling(camera) {
    if (!camera) return;

    // Capture the starting zoom dynamically
    if (!__labelZoomRefRadius) {
        __labelZoomRefRadius = camera.radius;
    }

    const minScale = 0.45;   // Smallest readable size
    const maxScale = 1.0;

    // Scale relative to initial zoom
    let scale = __labelZoomRefRadius / camera.radius;
    scale = Math.max(minScale, Math.min(maxScale, scale));

    const baseWidth  = 150;
    const baseHeight = 60;
    const baseNameFont = 14;
    const baseDataFont = 12;

    const newWidth  = (baseWidth  * scale) + "px";
    const newHeight = (baseHeight * scale) + "px";
    const nameFont  = Math.round(baseNameFont * scale);
    const dataFont  = Math.round(baseDataFont * scale);

    // --- MAIN MARKER ---
    if (marker?.labelControls) {
        const c = marker.labelControls.container;
        c.width  = newWidth;
        c.height = newHeight;
        marker.labelControls.nameText.fontSize = nameFont;
        marker.labelControls.dataText.fontSize = dataFont;
    }

    // --- OTHER RIDERS ---
    riderMeshes.forEach(entry => {
        const lbl = entry?.sphere?.labelControls;
        if (!lbl) return;

        lbl.container.width  = newWidth;
        lbl.container.height = newHeight;
        lbl.nameText.fontSize = nameFont;
        lbl.dataText.fontSize = dataFont;
    });
}

        // --- UTILITY: Create Two-Color Sphere ---
        function createTwoColorSphere(name, helmetHex, skinHex, scene) {
            // ... (sphere creation code is the same) ...
            const hemisphereTop = BABYLON.MeshBuilder.CreateSphere(name + "_top", {
                diameter: 0.1,
                slice: 0.5,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE
            }, scene);

            const hemisphereBottom = BABYLON.MeshBuilder.CreateSphere(name + "_bottom", {
                diameter: 0.1,
                slice: 0.5,
                sideOrientation: BABYLON.Mesh.DOUBLESIDE
            }, scene);

            hemisphereBottom.rotation.z = Math.PI;

            const parent = new BABYLON.TransformNode(name + "_parent", scene);
            hemisphereTop.parent = parent;
            hemisphereBottom.parent = parent;

            // Create materials
            const topMat = new BABYLON.StandardMaterial(name + "_topMat", scene);
            const bottomMat = new BABYLON.StandardMaterial(name + "_bottomMat", scene);

            // Helper to convert hex to Color3
            function hexToColor3(hex) {
                if (!hex || !hex.startsWith("#") || hex.length !== 7) {
                    console.warn("[3D Viewer] Invalid hex color:", hex);
                    return new BABYLON.Color3(1, 1, 1);
                }
                const rr = parseInt(hex.slice(1, 3), 16) / 255;
                const gg = parseInt(hex.slice(3, 5), 16) / 255;
                const bb = parseInt(hex.slice(5, 7), 16) / 255;
                return new BABYLON.Color3(rr, gg, bb);
            }

            const helmetColor = hexToColor3(helmetHex);
            const skinColor = hexToColor3(skinHex);

            // Use emissive color ONLY to ensure colors show properly without lighting interference
            topMat.emissiveColor = helmetColor;
            topMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
            topMat.specularColor = new BABYLON.Color3(0, 0, 0);
            topMat.backFaceCulling = false;

            bottomMat.emissiveColor = skinColor;
            bottomMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
            bottomMat.specularColor = new BABYLON.Color3(0, 0, 0);
            bottomMat.backFaceCulling = false;

            hemisphereTop.material = topMat;
            hemisphereBottom.material = bottomMat;

            hemisphereTop.alwaysSelectAsActiveMesh = true;
            hemisphereBottom.alwaysSelectAsActiveMesh = true;

            // --- Label Creation ---
const label3D = createRiderLabel3D(name);
label3D.plane.parent = parent;
label3D.plane.position.y = 0.55; // ✅ FLOATS ABOVE RIDER HEAD
label3D.leaderLine = null; // Placeholder for the line in screen space

            return {
                parent,
                topMesh: hemisphereTop,
                bottomMesh: hemisphereBottom,
                topMat,
                bottomMat,
label3D,
                updateColors: function(newHelmetHex, newSkinHex) {
                    const newHelmet = hexToColor3(newHelmetHex);
                    const newSkin = hexToColor3(newSkinHex);
                    topMat.emissiveColor = newHelmet;
                    topMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
                    topMat.specularColor = new BABYLON.Color3(0, 0, 0);
                    bottomMat.emissiveColor = newSkin;
                    bottomMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
                    bottomMat.specularColor = new BABYLON.Color3(0, 0, 0);
                }
            };
        }
        // ... (rest of the script is the same until the update functions) ...

        // --- GROUP INDICATOR SYSTEM (same as before) ---
        const GROUP_DISTANCE_METERS = 25;
        let groupIndicators = [];
// ---------- LABEL TOGGLE BUTTON ----------
const toggleButton = BABYLON.GUI.Button.CreateSimpleButton("toggleLabels", "🗨");
toggleButton.width = "16px";
toggleButton.height = "16px";
toggleButton.color = "white";
toggleButton.background = "#444";
toggleButton.cornerRadius = 8;
toggleButton.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
toggleButton.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
toggleButton.top = "-10px";   // small offset from bottom
toggleButton.left = "-10px";  // small offset from right
toggleButton.alpha = 0.5;
toggleButton.fontSize = 12;

toggleButton.onPointerUpObservable.add(() => {
    labelsVisible = !labelsVisible;  // ✅ actually flip the flag
    toggleButton.text = "🗨";         // optional, you can show ON/OFF if you like

    // Toggle main marker label
    if (marker?.label3D) marker.label3D.plane.isVisible = labelsVisible;

    // Toggle other riders
    riderMeshes.forEach(entry => {
        if (entry.sphere?.label3D) entry.sphere.label3D.plane.isVisible = labelsVisible;
    });
});


advancedTexture.addControl(toggleButton);

        function createGroupIndicator(scene) {
            // Create a cylinder to connect grouped riders
            const cylinder = BABYLON.MeshBuilder.CreateCylinder("groupCylinder", {
                height: 1,
                diameter: 0.1,
                tessellation: 8
            }, scene);

            const mat = new BABYLON.StandardMaterial("groupCylinderMat", scene);
            mat.emissiveColor = new BABYLON.Color3(1, 1, 0.3); // Yellow glow
            mat.alpha = 0.6;
            cylinder.material = mat;
            cylinder.isVisible = false;

            return cylinder;
        }

        function findGroupsIn3D(allRiders) {
            // allRiders should be array of {name, position3D, distMeters}
            if (allRiders.length < 2) return [];

            const groups = [];
            const visited = new Set();

            for (let i = 0; i < allRiders.length; i++) {
                if (visited.has(i)) continue;

                const group = [i];
                visited.add(i);

                for (let j = i + 1; j < allRiders.length; j++) {
                    if (visited.has(j)) continue;

                    // Check if rider j is within 25m of any rider in the current group
                    let isClose = false;
                    for (const idx of group) {
                        const distDiff = Math.abs(allRiders[j].distMeters - allRiders[idx].distMeters);
                        if (distDiff <= GROUP_DISTANCE_METERS) {
                            isClose = true;
                            break;
                        }
                    }

                    if (isClose) {
                        group.push(j);
                        visited.add(j);
                    }
                }

                // Only consider it a group if 2+ riders
                if (group.length >= 2) {
                    groups.push(group.map(idx => allRiders[idx]));
                }
            }

            return groups;
        }

        function updateGroupIndicators(allRiders, scene) {
            // Hide all existing indicators
            groupIndicators.forEach(indicator => indicator.isVisible = false);

            const groups = findGroupsIn3D(allRiders);

            let indicatorIndex = 0;

            groups.forEach(group => {
                // Draw cylinders between each pair of riders in the group
                for (let i = 0; i < group.length; i++) {
                    for (let j = i + 1; j < group.length; j++) {
                        const rider1 = group[i];
                        const rider2 = group[j];

                        // Only draw if they're within 25m of each other
                        const distDiff = Math.abs(rider1.distMeters - rider2.distMeters);
                        if (distDiff <= GROUP_DISTANCE_METERS) {
                            // Ensure we have enough indicators
                            while (indicatorIndex >= groupIndicators.length) {
                                groupIndicators.push(createGroupIndicator(scene));
                            }

                            const indicator = groupIndicators[indicatorIndex];

                            // Position and orient the cylinder between the two riders
                            const pos1 = rider1.position3D;
                            const pos2 = rider2.position3D;

                            // Calculate midpoint
                            const midpoint = pos1.add(pos2).scale(0.5);

                            // Calculate distance and direction
                            const direction = pos2.subtract(pos1);
                            const distance = direction.length();

                            // Set cylinder position and scale
                            indicator.position.copyFrom(midpoint);
                            indicator.scaling.y = distance;

                            // Orient cylinder to point from rider1 to rider2
                            if (distance > 0.001) {
                                const axis1 = new BABYLON.Vector3(0, 1, 0);
                                const axis2 = direction.normalize();
                                const angle = Math.acos(BABYLON.Vector3.Dot(axis1, axis2));
                                const axis = BABYLON.Vector3.Cross(axis1, axis2);

                                if (axis.length() > 0.001) {
                                    indicator.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
                                } else if (angle > Math.PI / 2) {
                                    indicator.rotationQuaternion = BABYLON.Quaternion.RotationAxis(new BABYLON.Vector3(1, 0, 0), Math.PI);
                                } else {
                                    indicator.rotationQuaternion = BABYLON.Quaternion.Identity();
                                }
                            }

                            indicator.isVisible = true;
                            indicatorIndex++;
                        }
                    }
                }
            });
        }

        function calculateRider3DData(riderId, distMeters, speedMps) {
            const gm = window.gameManager;
            let targetHuman = null;

            // --- Resolve Human ---
            if (gm?.ego && (gm.ego.athleteId == riderId || gm.ego.id == riderId)) {
                targetHuman = gm.ego;
            }
            else if (gm?.focalRider && (gm.focalRider.athleteId == riderId || gm.focalRider.id == riderId)) {
                const fId = gm.focalRider.athleteId || gm.focalRider.id;
                targetHuman =
                    gm.humans?.[fId] ||
                    Object.values(gm.humans || {}).find(h => (h.athleteId || h.id) == fId);
            }
            else if (gm?.humans) {
                targetHuman =
                    gm.humans[riderId] ||
                    Object.values(gm.humans).find(h => (h.athleteId || h.id) == riderId);
            }

            // --- Path ID (0 = A, 1 = B) ---
            const pathId = targetHuman?.currentPath?.id ?? 0;

            // --- ✅ CORRECT LIVE GAME DISTANCE SOURCE (pathA.distance / pathB.distance) ---
            let pathTotalMeters = 0;
            const road = targetHuman?.currentPath?.road;

            if (road) {
                if (pathId === 0 && typeof road.pathA?.distance === "number") {
                    pathTotalMeters = road.pathA.distance;
                }
                else if (pathId === 1 && typeof road.pathB?.distance === "number") {
                    pathTotalMeters = road.pathB.distance;
                }
            }

            // --- Hard safety fallback (should NOT trigger anymore) ---
            if (!pathTotalMeters || pathTotalMeters < 1) {
                console.warn("[3D Viewer] Missing path length for rider", riderId, "fallback used");
                pathTotalMeters = Math.max(distMeters, 1);
            }

            // --- Progress based on correct in-game meters ---
            let progress = (distMeters % pathTotalMeters) / pathTotalMeters;

            if (pathId === 1) {
                progress = 1.0 - progress;
            }

            // --- Scene Mapping (per-path exact scaling) ---
            const sceneUnitsPerMeter = totalDist / pathTotalMeters;

            let target3D = distMeters * sceneUnitsPerMeter;
            let speed3D  = speedMps   * sceneUnitsPerMeter;

            if (pathId === 1) {
                target3D = totalDist - target3D;
                speed3D  = -speed3D;
            }

            // --- Final wrap safety ---
            if (totalDist > 0) {
                target3D = ((target3D % totalDist) + totalDist) % totalDist;
            }

            return {
                target3D,
                speed3D,
                pathId,
                pathTotalMeters,
                targetHuman // Return the human object for w/kg
            };
        }

        function updateMarkerColor() {
            const gm = window.gameManager;
            const humans = gm?.humans || {};
            const ego = gm?.ego;
            const focalRider = gm?.focalRider;
            let newHelmetHex = "#ffffff";
            let newSkinHex = "#ffffff";

            if (ego) {
                const design = ego.entity?.design || ego.config?.design;

                if (design) {
                    newHelmetHex = design.helmet_color || "#ffffff";
                    newSkinHex = design.skin_color || "#ffffff";
                }
            }
            else if (focalRider) {
                const focalId = focalRider.athleteId || focalRider.id;
                let targetHuman = humans[focalId];

                if (!targetHuman) {
                    targetHuman = Object.values(humans).find(h => (h.athleteId || h.id) == focalId);
                }

                if (targetHuman) {
                    const design = targetHuman.entity?.design || targetHuman.config?.design;

                    if (design) {
                        newHelmetHex = design.helmet_color || "#ffffff";
                        newSkinHex = design.skin_color || "#ffffff";
                    }
                }
            }

            if (newHelmetHex !== currentMarkerHelmetHex || newSkinHex !== currentMarkerSkinHex) {
                if (newHelmetHex.startsWith("#") && newSkinHex.startsWith("#")) {
                    currentMarkerHelmetHex = newHelmetHex;
                    currentMarkerSkinHex = newSkinHex;
                    marker.updateColors(newHelmetHex, newSkinHex);
                }
            }
        }

        function updateMainMarker() {
            if (!window.hackedRiders) return;
            updateMarkerColor();

            const focalId = window.gameManager.focalRider?.athleteId || window.gameManager.focalRider?.id;
            const myId = window.gameManager.ego?.athleteId;
            const mainId = myId || focalId;

            const r = window.hackedRiders.find(rider => rider.riderId == mainId);
            if (!r) return;

            const data = calculateRider3DData(r.riderId, r.dist, r.speed);
            const now = performance.now();

            if (!mainMarkerState.initialized) {
                mainMarkerState = { lastUpdateTime: now, lastKnownDist: data.target3D, predictedDist: data.target3D, speed: data.speed3D, initialized: true };
            } else if (Math.abs(mainMarkerState.lastKnownDist - data.target3D) > 0.001) {
                mainMarkerState.lastUpdateTime = now;
                mainMarkerState.lastKnownDist = data.target3D;
                mainMarkerState.speed = data.speed3D;
            }

            const dt = (now - mainMarkerState.lastUpdateTime) / 1000;
            let predictedPos = mainMarkerState.lastKnownDist + (mainMarkerState.speed * dt);

            if (Math.abs(predictedPos - data.target3D) > totalDist * 0.5) {
                predictedPos = data.target3D;
                mainMarkerState.lastKnownDist = data.target3D;
                mainMarkerState.lastUpdateTime = now;
            }
            if (predictedPos > totalDist) predictedPos = predictedPos % totalDist;
            if (predictedPos < 0) predictedPos = totalDist + predictedPos;

            const safeD = predictedPos;
            let i = 0;
            while (i < cum.length - 1 && !(cum[i] <= safeD && safeD <= cum[i + 1])) i++;
            const segStart = cum[i];
            const segEnd = cum[i + 1];
            const localT = (safeD - segStart) / (segEnd - segStart || 1);
            const pos = points[i].add(points[i + 1].subtract(points[i]).scale(localT));

            marker.parent.position.set(pos.x, pos.y, pos.z);

            // --- Label Update for Main Marker ---
if (marker.label3D) {
    const w_kg = r.wkg?.toFixed(1) || 'N/A';
    const speedKph = (r.speed * 3.6).toFixed(1);

    // Determine name
    let displayName = "You"; // default
    const myId = window.gameManager.ego?.athleteId;
    const focalId = window.gameManager.focalRider?.athleteId || window.gameManager.focalRider?.id;

    if (!myId && isSpectating) {
        // Spectating: show actual rider name
        displayName = r.name;
    } else if (r.riderId !== myId) {
        // Not ego: show actual name
        displayName = r.name;
    }

    marker.label3D.draw(
        displayName,
        `${speedKph} kph / ${w_kg} w/kg`
    );
}


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

            for (let [name, entry] of riderMeshes) {
                if (!existingNames.has(name)) {
                    // Dispose of the 3D meshes
                    entry.sphere.parent.dispose();
                    // Dispose of the GUI control
                    if(entry.sphere.labelControls) entry.sphere.labelControls.container.dispose();
                    riderMeshes.delete(name);
                }
            }

            const now = performance.now();

            ridersRaw.forEach(r => {
                let entry = riderMeshes.get(r.name);
                const data = calculateRider3DData(r.riderId, r.dist, r.speed);

                // Get current colors from game data
                let targetHuman = gmHumans[r.riderId];
                if(!targetHuman) {
                    for(const h of Object.values(gmHumans)) if((h.athleteId||h.id)==r.riderId) { targetHuman=h; break; }
                }

                let helmetHex = "#ffffff";
                let skinHex = "#ffffff";

                if (targetHuman?.config?.design) {
                    helmetHex = targetHuman.config.design.helmet_color || "#ffffff";
                    skinHex = targetHuman.config.design.skin_color || "#ffffff";
                }

                if (!entry) {
                    const sphere = createTwoColorSphere(r.name, helmetHex, skinHex, scene);
                    sphere.label3D.plane.isVisible = labelsVisible;
                    entry = {
                        sphere,
                        lastUpdateTime: now,
                        lastKnownDist: data.target3D,
                        predictedDist: data.target3D,
                        speed: data.speed3D,
                        lastHelmetHex: helmetHex,
                        lastSkinHex: skinHex
                    };
                    riderMeshes.set(r.name, entry);
                } else {
                    // Update colors if they've changed
                    if (helmetHex !== entry.lastHelmetHex || skinHex !== entry.lastSkinHex) {
                        entry.sphere.updateColors(helmetHex, skinHex);
                        entry.lastHelmetHex = helmetHex;
                        entry.lastSkinHex = skinHex;
                    }

                    if (Math.abs(entry.lastKnownDist - data.target3D) > 0.001) {
                         entry.lastUpdateTime = now;
                         entry.lastKnownDist = data.target3D;
                         entry.speed = data.speed3D;
                    }
                }

                const dt = (now - entry.lastUpdateTime) / 1000;
                let predictedPos = entry.lastKnownDist + (entry.speed * dt);

                if (Math.abs(predictedPos - data.target3D) > totalDist * 0.5) {
                    predictedPos = data.target3D;
                    entry.lastKnownDist = data.target3D;
                    entry.lastUpdateTime = now;
                }

                if (predictedPos > totalDist) predictedPos = predictedPos % totalDist;
                if (predictedPos < 0) predictedPos = totalDist + predictedPos;

                const safeD = predictedPos;
                let i = 0;
                while (i < cum.length - 1 && !(cum[i] <= safeD && safeD <= cum[i + 1])) i++;
                const segStart = cum[i];
                const segEnd = cum[i + 1];
                const localT = (safeD - segStart) / (segEnd - segStart || 1);
                const pos = points[i].add(points[i + 1].subtract(points[i]).scale(localT));

                entry.sphere.parent.position.set(pos.x, pos.y, pos.z);

                // --- Label Update for Other Riders ---
if (entry.sphere.label3D) {
    const w_kg = r.wkg?.toFixed(1) || 'N/A';
    const speedKph = (r.speed * 3.6).toFixed(1);

    entry.sphere.label3D.draw(
        r.name,
        `${speedKph} kph / ${w_kg} w/kg`
    );
}

            });
        }
let allRiderEntries = [];
        engine.runRenderLoop(()=>{
            updateMainMarker();
            updateRidersMarkers();

            // This ensures the camera follows the rider every frame
            camera.setTarget(marker.parent.position);

            // *******************************************************
            // * CRITICAL FIX: Lock the radius on the first frame(s) *
            // *******************************************************
            if (firstFrame) {
                // Force the camera radius to your desired starting zoom (initialRadius)
                // This will override any automatic camera smoothing/reset.
                camera.radius = initialRadius;
            }
            // *******************************************************


            // --- GROUP INDICATORS UPDATE ---
            const allRiderPositions = [];

            // Add main marker
            if (window.hackedRiders) {
                const mainId = window.gameManager.ego?.athleteId || window.gameManager.focalRider?.athleteId || window.gameManager.focalRider?.id;
                const mainRider = window.hackedRiders.find(r => r.riderId == mainId);
                if (mainRider) {
                    const data = calculateRider3DData(mainRider.riderId, mainRider.dist, mainRider.speed);
                    allRiderPositions.push({
                        name: 'main',
                        position3D: marker.parent.position.clone(),
                        distMeters: mainRider.dist % data.pathTotalMeters
                    });
                }
            }

            // Add other riders
            riderMeshes.forEach((entry, name) => {
                const riderData = window.hackedRiders?.find(r => r.name === name);
                if (riderData) {
                    const data = calculateRider3DData(riderData.riderId, riderData.dist, riderData.speed);
                    allRiderPositions.push({
                        name,
                        position3D: entry.sphere.parent.position.clone(),
                        distMeters: riderData.dist % data.pathTotalMeters
                    });
                }
            });

            updateGroupIndicators(allRiderPositions, scene);
            applyDynamicLabelScaling(camera);
            scene.render();
        });

        window.addEventListener("resize",()=>engine.resize());

        // --- NEW: Add logic to remove the radius lock after first user interaction ---
        // This stops forcing the radius once the user takes control.
        scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                firstFrame = false;
            }
        });

        // --- NEW: Add a delay to remove the radius lock (in case user doesn't interact) ---
        setTimeout(() => {
             firstFrame = false;
        }, 1000); // Stop forcing the zoom after 1 second
    }

})();
