// ==UserScript==
// @name         Biketerra Racepacer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Advanced drafting pacer with rider selection, FTP zones, historical tracking, adaptive catch-up, and visual alerts, with PACER MODE toggle.
// @match        https://biketerra.com/ride*
// @exclude      https://biketerra.com/dashboard
// @icon         https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --------------------------------------------------------------------
    // --- CONFIGURATION & ASSUMPTIONS ---
    // --------------------------------------------------------------------
    const RIDER_DATA_SOURCE = 'humans';
    const STRONG_DRAFT_THRESHOLD = 0.7;
    const FALLBACK_TARGET_POWER = 150;
    const FALLBACK_CRR = 0.004;
    const CATCH_UP_TIMES = {
        close: { maxGap: 10, time: 10 },
        medium: { maxGap: 50, time: 20 },
        far: { maxGap: 200, time: 40 },
        veryFar: { maxGap: Infinity, time: 60 }
    };
    const RHO = 1.225;
    const G = 9.8067;
    const ETA = 0.97;

    let powerSavingsHistory = [];
    let lastUpdateTime = Date.now();
    let totalTimeSaved = 0;
    let currentTargetId = 'none';
    let allRidersMap = {};
    let selectElement, dataDisplay;

    // PACER MODE
    let PACER_MODE = 'keepUp'; // 'keepUp' = stay in draft at all costs, 'catchUpSlow' = gradual catch

    // --------------------------------------------------------------------
    // --- CORE FUNCTIONS ---
    // --------------------------------------------------------------------
    function calculateTargetCdA(targetPower, targetWeight, targetSpeed, currentGrade, targetCrr) {
        const v = targetSpeed;
        const G_rad = Math.atan(currentGrade);
        const P_wheel_Target = targetPower * ETA;
        const P_gravity_Target = targetWeight * G * v * Math.sin(G_rad);
        const P_rolling_Target = targetWeight * G * v * targetCrr * Math.cos(G_rad);
        const P_drag_Target = P_wheel_Target - P_gravity_Target - P_rolling_Target;
        if (v < 0.1 || P_drag_Target <= 0) return 0.35;
        return Math.max(0.2, Math.min(P_drag_Target / (0.5 * RHO * Math.pow(v, 3)), 0.6));
    }

    function calculateRequiredPower(targetCdA, targetSpeed, currentGrade, systemWeight, yourCrr) {
        const v = targetSpeed;
        const G_rad = Math.atan(currentGrade);
        const P_gravity = systemWeight * G * v * Math.sin(G_rad);
        const P_rolling = systemWeight * G * v * yourCrr * Math.cos(G_rad);
        const P_drag = 0.5 * RHO * targetCdA * Math.pow(v, 3);
        return (P_gravity + P_rolling + P_drag) / ETA;
    }

    function populateRiderList(gm) {
        if (!selectElement || !dataDisplay) return;
        const ridersData = gm[RIDER_DATA_SOURCE];
        if (!ridersData) return;
        allRidersMap = ridersData;
        let previouslySelectedId = currentTargetId;
        const egoId = gm.ego?.id;
        const riderKeys = Object.keys(ridersData).filter(key => ridersData[key].id !== egoId);
        selectElement.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = 'none';
        defaultOption.textContent = '-- Select Target --';
        selectElement.appendChild(defaultOption);
        let selectedStillExists = false;
        riderKeys.forEach(riderKey => {
            const rider = ridersData[riderKey];
            const firstName = rider.config?.first_name || '';
            const lastName = rider.config?.last_name || '';
            const riderName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : `Rider ${riderKey}`;
            const distance = rider.currentPathDistance || 0;
            const yourDistance = gm.ego?.currentPathDistance || 0;
            const gap = Math.round(distance - yourDistance);
            const option = document.createElement('option');
            option.value = riderKey;
            option.textContent = `${riderName} (${gap > 0 ? '+' : ''}${gap}m)`;
            if (riderKey == previouslySelectedId) selectedStillExists = true;
            selectElement.appendChild(option);
        });
        let newTargetId = currentTargetId;
        if (riderKeys.length > 0) {
            if (!selectedStillExists || currentTargetId === 'none') newTargetId = riderKeys[0];
            else newTargetId = previouslySelectedId;
        } else newTargetId = 'none';
        currentTargetId = newTargetId;
        selectElement.value = newTargetId;
    }

    function handleRiderSelection(event) {
        currentTargetId = event.target.value;
        powerSavingsHistory = [];
        totalTimeSaved = 0;
    }

    function getCatchUpTime(gap) {
        const absGap = Math.abs(gap);
        if (absGap < CATCH_UP_TIMES.close.maxGap) return CATCH_UP_TIMES.close.time;
        if (absGap < CATCH_UP_TIMES.medium.maxGap) return CATCH_UP_TIMES.medium.time;
        if (absGap < CATCH_UP_TIMES.far.maxGap) return CATCH_UP_TIMES.far.time;
        return CATCH_UP_TIMES.veryFar.time;
    }

    function getFTPZoneColor(power, ftp) {
        if (!ftp) return '#ffffff';
        const intensity = power / ftp;
        if (intensity < 0.55) return '#808080';
        if (intensity < 0.75) return '#4169E1';
        if (intensity < 0.90) return '#32CD32';
        if (intensity < 1.05) return '#FFA500';
        if (intensity < 1.20) return '#FF4500';
        return '#FF0000';
    }

    // --------------------------------------------------------------------
    // --- MAIN LOOP ---
    // --------------------------------------------------------------------
function updatePowerPacer() {
    const gm = window.gameManager;

    // Declare these upfront
    let requiredPower = 0;
    let holdPower = 0;
    let catchPower = 0;
    let DISPLAY_POWER = 0;

        if (!selectElement && document.body) {
            let displayElement = document.createElement('div');
            displayElement.id = 'power-pacer-display';
            displayElement.style.cssText = `
                position: fixed; bottom: 190px; right: 5px; background: rgba(0,0,0,0.5);
                color: white; padding: 12px; border-radius: 8px; font-size: 14px;
                z-index: 9999; font-family: monospace; width: 300px; line-height: 1.4;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5); border: 2px solid #333;
                transition: border-color 0.3s ease; display: flex; flex-direction: column-reverse;
            `;
            document.body.appendChild(displayElement);

            displayElement.innerHTML = `
                <label for="target-rider-select" style="display:block; margin-bottom:5px; font-weight:bold;">TARGET RIDER:</label>
                <select id="target-rider-select" style="width:100%; padding:5px; margin-bottom:5px; color:#333; border-radius:4px;"></select>
                <label for="pacer-mode-select" style="display:block; margin-bottom:5px; font-weight:bold;">PACER MODE:</label>
                <select id="pacer-mode-select" style="width:100%; padding:5px; margin-bottom:8px; color:#333; border-radius:4px;">
                    <option value="keepUp">Keep Up — Stay in Draft</option>
                    <option value="catchUpSlow">Catch Gradually (10min)</option>
                </select>
                <div id="pacer-data">Awaiting data...</div>
            `;
            selectElement = document.getElementById('target-rider-select');
            dataDisplay = document.getElementById('pacer-data');
            selectElement.addEventListener('change', handleRiderSelection);
            const modeSelect = document.getElementById('pacer-mode-select');
            modeSelect.addEventListener('change', (e) => { PACER_MODE = e.target.value; });
        }

        if (gm && gm.ego && gm.ego.config && gm.ego.config.mass !== undefined && gm.ego.grade !== undefined) {
            populateRiderList(gm);

            if (currentTargetId !== 'none') {
                const targetRider = allRidersMap[currentTargetId];

                if (targetRider && targetRider.speed !== undefined) {

                    const yourBodyWeight = gm.ego.config.mass / 1000;
                    const yourBikeWeight = gm.ego.bikeMetrics?.mass / 1000 || 8;
                    const YOUR_SYSTEM_WEIGHT_KG = yourBodyWeight + yourBikeWeight;
                    const yourCrr = gm.ego.crr || FALLBACK_CRR;
                    const yourCurrentPower = gm.ego.power || 0;
                    const yourSpeed = gm.ego.speed || 0;
                    const currentGrade = gm.ego.grade;
                    const userFtp = gm.userFtp || null;
                    const targetBodyWeight = (targetRider.config?.weight || targetRider.config?.mass || 75000)/1000;
                    const targetBikeWeight = targetRider.bikeMetrics?.mass / 1000 || 8;
                    const targetWeightKG = targetBodyWeight + targetBikeWeight;
                    const targetCrr = targetRider.crr || FALLBACK_CRR;
                    const targetSpeed = targetRider.speed;
                    const targetPower = targetRider.power || FALLBACK_TARGET_POWER;

                    const derivedCdA = calculateTargetCdA(targetPower, targetWeightKG, targetSpeed, currentGrade, targetCrr);
                    const draftingFactor = gm.ego.draftingFactor || 1;
                    const inStrongDraft = draftingFactor < STRONG_DRAFT_THRESHOLD;
                    const yourDistance = gm.ego.currentPathDistance || 0;
                    const targetDistance = targetRider.currentPathDistance || 0;
                    const distanceGap = targetDistance - yourDistance;
                    const catchUpTime = getCatchUpTime(distanceGap);
                    const speedDiff = yourSpeed - targetSpeed;

                    // --- PACER STRATEGY BASED ON MODE ---
                    let targetStrategy = '';
                    let catchSpeed = targetSpeed;

                    if (PACER_MODE === 'keepUp') {
                        if (!inStrongDraft) {
                            catchSpeed = targetSpeed + Math.max(1.5, Math.abs(distanceGap)*0.12);
                            targetStrategy = `🚨 EMERGENCY DRAFT RE-ENTRY (${Math.round(distanceGap)}m)`;
                        } else if (distanceGap >= 3.0) {
                            catchSpeed = targetSpeed + Math.max(0.8, distanceGap*0.08);
                            targetStrategy = `⚠ HARD CLOSE (${distanceGap.toFixed(1)} m)`;
                        } else {
                            catchSpeed = targetSpeed;
                            targetStrategy = '✅ DRAFT SECURE — MATCH';
                        }
                    } else if (PACER_MODE === 'catchUpSlow') {
                        catchSpeed = targetSpeed + distanceGap/(10*60); // Spread catch over ~10min
                        targetStrategy = `⏱ CATCH GRADUALLY (${distanceGap.toFixed(1)} m)`;
                    }

                    let holdPower = calculateRequiredPower(derivedCdA, targetSpeed, currentGrade, YOUR_SYSTEM_WEIGHT_KG, yourCrr);
                    let catchPower = calculateRequiredPower(derivedCdA, catchSpeed, currentGrade, YOUR_SYSTEM_WEIGHT_KG, yourCrr);
                    catchPower = Math.max(catchPower, holdPower);
                    const DISPLAY_POWER = Math.round(catchPower);
                    requiredPower = catchPower;

                    // --- TRACK POWER SAVINGS ---
                    const perfectDraftCdA = derivedCdA * STRONG_DRAFT_THRESHOLD;
                    const perfectDraftPower = Math.max(0, calculateRequiredPower(perfectDraftCdA, targetSpeed, currentGrade, YOUR_SYSTEM_WEIGHT_KG, yourCrr));
                    const now = Date.now();
                    const timeDelta = (now - lastUpdateTime)/1000;
                    lastUpdateTime = now;
                    if (inStrongDraft) {
                        const powerSaved = perfectDraftPower - requiredPower;
                        totalTimeSaved += powerSaved * timeDelta;
                        powerSavingsHistory.push(powerSaved);
                        if (powerSavingsHistory.length > 120) powerSavingsHistory.shift();
                    }
                    const avgPowerSaved = powerSavingsHistory.length > 0 ? powerSavingsHistory.reduce((a,b)=>a+b,0)/powerSavingsHistory.length : 0;
                    const energySavedKJ = totalTimeSaved/1000;

                    // --- VISUALS ---
                    let draftStatus = '';
                    if (draftingFactor < 0.6) draftStatus = '<span style="color:#33ff33; font-weight:bold;">● EXCELLENT</span>';
                    else if (draftingFactor < STRONG_DRAFT_THRESHOLD) draftStatus = '<span style="color:#66ff66; font-weight:bold;">● STRONG</span>';
                    else if (draftingFactor < 0.85) draftStatus = '<span style="color:#ffff33; font-weight:bold;">○ WEAK</span>';
                    else draftStatus = '<span style="color:#ff6666; font-weight:bold;">○ NONE</span>';

                    const displayElement = document.getElementById('power-pacer-display');
                    if (displayElement) {
                        if (!inStrongDraft && distanceGap > 10) displayElement.style.borderColor = '#ff3333';
                        else if (!inStrongDraft) displayElement.style.borderColor = '#ff9933';
                        else displayElement.style.borderColor = '#33ff33';
                    }

                    const powerColor = getFTPZoneColor(requiredPower, userFtp);

                    dataDisplay.innerHTML = `
                        <hr style="border:0; height:1px; background:#555; margin:5px 0;">
                        <div style="font-size:11px; color:#aaa;">${targetStrategy}</div>
                        <span style="font-weight:bold; font-size:24px; color:${powerColor};">${DISPLAY_POWER} W</span>
                        <br>
                        <span style="font-size:12px; color:#aaa;">
                            HOLD: ${Math.round(holdPower)}W${userFtp?` (${Math.round(holdPower/userFtp*100)}%)`:''}<br>
                            CATCH (${catchUpTime}s): ${Math.round(catchPower)}W
                        </span>
                        <br>
                        Current: ${Math.round(yourCurrentPower)} W <span style="color:${(requiredPower-yourCurrentPower)>0?'#ff6666':'#66ff66'};">(${(requiredPower-yourCurrentPower>0?'+':'')+Math.round(requiredPower-yourCurrentPower)}W)</span><br>
                        In Draft: ${Math.round(perfectDraftPower)} W<br>
                        Draft: ${draftStatus} ${draftingFactor.toFixed(2)}<br>
                        Gap: <span style="font-weight:bold; color:${distanceGap>10?'#ff6666':distanceGap>5?'#ffaa33':'#66ff66'};">${Math.round(distanceGap)}m</span><br>
                    <hr style="border: 0; height: 1px; background: #444; margin: 5px 0;"> <div style="font-size: 11px; color: #aaa;"> Target: ${(targetSpeed * 3.6).toFixed(1)} km/h @ ${targetPower}W<br> You: ${(yourSpeed * 3.6).toFixed(1)} km/h | Grade: ${(currentGrade * 100).toFixed(1)}% </div>
                    `;
                } else {
                    dataDisplay.innerHTML = `Target rider data incomplete.`;
                }
            } else {
                 dataDisplay.textContent = 'Please select a rider to begin pacing.';
            }
        } else {
            dataDisplay.textContent = 'Awaiting core ego data...';
        }

        setTimeout(updatePowerPacer, 500);
    }

    updatePowerPacer();
})();
