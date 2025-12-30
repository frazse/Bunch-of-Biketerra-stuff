// ==UserScript==
// @name         Biketerra - Riderlist replacement HUD
// @namespace    http://tampermonkey.net/
// @version      12.9
// @description  With sticky header, per-rider power zone tracking, finished riders group, and fixed single group labeling
// @author       You
// @match        https://biketerra.com/ride*
// @match        https://biketerra.com/spectate*
// @exclude      https://biketerra.com/dashboard
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Store athleteId => teamName
    window.__tttTeamMap = {};
    window.__tttDataLoaded = false;

    // Store finished riders data
    window.__finishedRiders = {};
    window.__lastLapCounts = {}; // Track lap counts to detect lap completions
    window.__lastLapCounts = window.__lastLapCounts || {};

    // --- Power Zone Time Tracking (per rider) ---
    window.__riderPowerZones = {}; // riderId => { z1: 0, z2: 0, ... }
    window.__lastZoneUpdate = {}; // riderId => timestamp

    // --- FTP cache ---
    window.__athleteFtpMap = {};
    window.__ftpQueue = [];
    window.__ftpBusy = false;
(() => {
    const cache = loadFtpCache();
    if (cache?.riders) {
        Object.entries(cache.riders).forEach(([id, v]) => {
            window.__athleteFtpMap[id] = v.ftp;
        });
    }
})();

function loadFtpCache() {
    try {
        return JSON.parse(localStorage.biketerraFtpCache || "{}");
    } catch {
        return {};
    }
}
function extractFtpFromProfileHTML(html) {
    const match = html.match(/athlete:\s*{[\s\S]*?ftp:\s*(\d+)/);
    return match ? Number(match[1]) : null;
}
async function fetchAndCacheAthleteFTP(athleteId) {
    const cache = loadFtpCache();
    cache.riders ||= {};

    const res = await fetch(`/athletes/${athleteId}`, {
        credentials: "include"
    });

    const html = await res.text();
    const ftp = extractFtpFromProfileHTML(html);

    if (!ftp) return null;

    cache.riders[athleteId] = {
        ftp,
        updated: new Date().toISOString().slice(0, 10)
    };

    cache.lastRefresh = new Date().toISOString().slice(0, 10);
    saveFtpCache(cache);

    window.__athleteFtpMap[athleteId] = ftp;
    return ftp;
}

function saveFtpCache(cache) {
    localStorage.biketerraFtpCache = JSON.stringify(cache);
}

function shouldRefreshMonthly(cache) {
    if (!cache.lastRefresh) return true;

    const last = new Date(cache.lastRefresh);
    const now = new Date();

    return (
        now.getFullYear() !== last.getFullYear() ||
        now.getMonth() !== last.getMonth()
    );
}
function queueRidersForFtp(riders) {
    const cache = loadFtpCache();
    cache.riders ||= {};

    riders.forEach(r => {
        const id = r.riderId;
        if (!id) return;

        const riderCache = cache.riders[id];
        const stale = !riderCache || shouldRefreshMonthly({ lastRefresh: riderCache.updated });

        // Load cached FTP immediately if available
        if (cache.riders[id]?.ftp) {
            window.__athleteFtpMap[id] = cache.riders[id].ftp;
            return;
        }

        // Queue if missing or monthly refresh
        if (!window.__athleteFtpMap[id] && !window.__ftpQueue.includes(id)) {
            window.__ftpQueue.push(id);
        }
    });
}

    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
        const response = await originalFetch(input, init);

        try {
            const url = input?.url || input?.toString();
            if (url.includes('__data.json')) {
                const cloned = response.clone();
                const dataText = await cloned.text();

                // Parse the main JSON response
                let json;
                try {
                    json = JSON.parse(dataText);
                } catch (e) {
                    console.error("Failed to parse __data.json:", e);
                    return response;
                }

                // Look inside nodes if present
                const nodesArr = json.nodes || [];
                let found = false;

                nodesArr.forEach(node => {
                    const arr = node.data || node; // sometimes node itself is array

                    arr.forEach((item, idx) => {
                        if (item === "ttt") {
                            // Grab next few items to find the teams JSON
                            const potentialTeams = arr.slice(idx + 1, idx + 5);
                            const teamsString = potentialTeams.find(s => {
                                try {
                                    const o = JSON.parse(s);
                                    return typeof o === 'object' && Object.values(o).some(t => t?.name && Array.isArray(t?.members));
                                } catch (e) {
                                    return false;
                                }
                            });

                            if (!teamsString) return;

                            try {
                                const teamsObj = JSON.parse(teamsString);
                                Object.values(teamsObj).forEach(team => {
                                    if (Array.isArray(team.members)) {
                                        team.members.forEach(id => {
                                            window.__tttTeamMap[id.toString()] = team.name;
                                        });
                                    }
                                });
                                window.__tttDataLoaded = true;
                                console.log("🏁 TTT teams loaded:", window.__tttTeamMap);
                                found = true;
                            } catch (err) {
                                console.error("TTT JSON parse error:", err, teamsString);
                            }
                        }
                    });
                });

                if (!found) console.log("No TTT teams found in __data.json nodes");
            }
        } catch (e) {
            console.error("Error intercepting __data.json:", e);
        }

        return response;
    };

function getTotalLaps() {
    const el = document.querySelector('.panel-laps');
    if (!el) return 1; // Missing = 1 lap race

    // Example text: "Lap 4/3"
    const m = el.textContent.match(/\/\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
}

// Simplified function to mark riders as finished based on lap completion
function checkForRaceFinish(riders) {
    const totalLaps = getTotalLaps();

    riders.forEach(r => {
        const id = r.riderId;
        const currentLap = r.lap;
        const lastLap = window.__lastLapCounts[id];

        // Detect N -> N+1 transition (rider crossed finish line on final lap)
        if (
            lastLap !== undefined &&
            lastLap === totalLaps &&
            currentLap === totalLaps + 1
        ) {
            console.log(`🏁 Rider ${id} (${r.name}) finished race (Lap ${totalLaps} → ${currentLap})`);

            // Mark rider as finished and store their data
            if (!window.__finishedRiders[id]) {
                window.__finishedRiders[id] = {
                    finishTime: Date.now(), // Use current timestamp for sorting order
                    riderData: { ...r } // Store a copy of the rider data
                };
            }
        }

        window.__lastLapCounts[id] = currentLap;
    });
}

// --- Global Function to Handle Spectate Click ---
window.spectateRiderById = function(riderId) {
    console.warn("Spectate disabled on non-spectate pages.");
};

if (location.href.startsWith("https://biketerra.com/spectate")) {
    window.spectateRiderById = function(riderId) {
        if (!window.gameManager) {
            console.error("Game Manager not exposed. Is breakpoint active?");
            return;
        }
        if (!riderId) {
             console.warn("Cannot spectate: Rider ID is null or undefined.");
             return;
        }
        const cleanedRider = window.hackedRiders.find(r => r.riderId == riderId);
        let spectateFn = null;
        let functionName = 'setFocalRider';

        if (typeof window.gameManager[functionName] === 'function') {
             spectateFn = window.gameManager.setFocalRider;
        } else {
            console.error(`❌ Spectate function failed: window.gameManager.${functionName} not found.`);
            return;
        }

        if (typeof spectateFn === 'function') {
            spectateFn.call(window.gameManager, riderId);
            // Clear group spectate tracking when manually spectating a rider
            window.activeGroupSpectate = null;
            window.__lastGroupLeader = null;
        }
    };
}

// --- Global Function to Spectate Group Leader ---
window.spectateGroupLeader = function(groupIdx) {
    if (!window.gameManager) {
        console.error("Game Manager not exposed. Is breakpoint active?");
        return;
    }

    if (!window.hackedRiders) {
        console.warn("No rider data available");
        return;
    }

    // Find the group and get its leader (first rider in the group array)
    const riders = [...window.hackedRiders];
    const gm = window.gameManager;
    const ego = gm?.ego;
    const focalRiderObj = gm?.focalRider;
    const globalRoad = ego?.currentPath?.road || focalRiderObj?.currentPath?.road;
    const globalLapLimit = globalRoad?.pathA?.distance || globalRoad?.pathB?.distance || 10000;

    riders.forEach(r => {
        const rawDist = r.dist;
        const id = r.riderId;
        const dist = window.__riderInterpolation?.[id]?.interpolatedDist || rawDist;
        r.lapDistance = dist >= 0 ? dist : 0;
    });

    riders.sort((a, b) => {
        if (b.lap !== a.lap) return b.lap - a.lap;
        return b.lapDistance - a.lapDistance;
    });

    // Rebuild groups to find the correct one
    const groups = [];
    let currentGroup = [];
    const GROUP_DISTANCE = 25;

    riders.forEach((r, idx) => {
        if (currentGroup.length === 0) {
            currentGroup.push(r);
        } else {
            const lastRider = currentGroup[currentGroup.length - 1];
            const gap = lastRider.lapDistance - r.lapDistance;

            if (gap <= GROUP_DISTANCE && r.lap === lastRider.lap) {
                currentGroup.push(r);
            } else {
                groups.push([...currentGroup]);
                currentGroup = [r];
            }
        }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    // Sort groups the same way as the display
    groups.forEach(g => {
        g.leadLap = Math.max(...g.map(r => r.lap));
        g.leadDist = Math.max(...g.map(r => r.lapDistance + (r.lap - 1) * globalLapLimit));
    });
    groups.sort((a, b) => {
        if (b.leadLap !== a.leadLap) return b.leadLap - a.leadLap;
        return b.leadDist - a.leadDist;
    });

    if (groupIdx < groups.length) {
        const leader = groups[groupIdx][0]; // First rider is the leader

        // Call setFocalRider directly instead of spectateRiderById to avoid clearing tracking
        if (window.gameManager && typeof window.gameManager.setFocalRider === 'function') {
            window.gameManager.setFocalRider(leader.riderId);
            window.activeGroupSpectate = groupIdx; // Enable continuous tracking AFTER spectating
            window.__lastGroupLeader = leader.riderId; // Initialize last leader
        }
    }
};

// --- Function to stop group spectate tracking ---
window.stopGroupSpectate = function() {
    window.activeGroupSpectate = null;
    window.__lastGroupLeader = null;
};

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
    // --- Hide original list ---
    function hideOriginalRiderList() {
        const original = document.querySelector('.riders-main');
        if (original) original.style.display = 'none';
        else setTimeout(hideOriginalRiderList, 500);
    }
    hideOriginalRiderList();

    waitFor(".rider-list-footer").then(el => {
        if(el) {
            el.style.paddingTop = '.09rem';
            el.style.paddingRight = '.4rem';
        }
    }).catch(() => {});
    waitFor(".view-toggle").then(el => {
        if(el) el.style.display = 'none';
    }).catch(() => {});

    // --- Add custom scrollbar styling ---
    const style = document.createElement('style');
    style.textContent = `
        /* Scrollbar for rider list */
        #rider-list-container > div:last-child::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        #rider-list-container > div:last-child::-webkit-scrollbar-track {
            background: rgba(0,0,0,0.2);
            border-radius: 4px;
        }
        #rider-list-container > div:last-child::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.3);
            border-radius: 4px;
        }
        #rider-list-container > div:last-child::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.5);
        }

        /* Firefox */
        #rider-list-container > div:last-child {
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.3) rgba(0,0,0,0.2);
        }
    `;
    document.head.appendChild(style);

    // --- HUD Container ---
    const container = document.createElement('div');
    container.id = 'rider-list-container';
    container.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        width: 25vw;
        min-width: 350px;
        background: rgba(0,0,0,0.5);
        color: #00ffcc;
        font-family: "Overpass", sans-serif;
        font-size: 12px;
        z-index: 1;
        border-radius: 8px;
        max-height: 60vh;
        display: flex;
        flex-direction: column;
    `;
    container.innerHTML = `
        <div style="padding: 4px 10px 0px 10px;">
            <div style="display:flex; align-items:center; margin-bottom:2px; height:16px;">
                <span id="status-light" style="color:red; font-size:10px; line-height:1;">●</span>
                <button id="view-toggle" style="
                    background:rgba(255,255,255,0);
                    color:#fff;
                    border:none;
                    cursor:pointer;
                    font-family:'Overpass',sans-serif;
                    font-size:14px;
                    outline:none;
                    padding:0;
                    margin:0;
                    line-height:1;
                    height:16px;
                ">🗊</button>
            </div>
            <div id="power-zone-widget" style="
                background:rgba(0,0,0,0.7);
                padding:6px;
                margin-bottom:6px;
                border-radius:4px;
            ">
                <div style="font-size:11px; color:#fff; margin-bottom:4px; font-weight:bold;">Power Zones</div>
                <div id="zone-bars" style="display:flex; gap:0; height:14px; margin-bottom:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden;">
                    <div id="z1-bar" style="background:rgb(0,158,128); flex:0; transition:flex 0.3s;"></div>
                    <div id="z2-bar" style="background:rgb(0,158,0); flex:0; transition:flex 0.3s;"></div>
                    <div id="z3-bar" style="background:rgb(255,203,14); flex:0; transition:flex 0.3s;"></div>
                    <div id="ss-bar" style="background:rgb(255,160,14); flex:0; transition:flex 0.3s;"></div>
                    <div id="z4-bar" style="background:rgb(255,127,14); flex:0; transition:flex 0.3s;"></div>
                    <div id="z5-bar" style="background:rgb(221,4,71); flex:0; transition:flex 0.3s;"></div>
                    <div id="z6-bar" style="background:rgb(102,51,204); flex:0; transition:flex 0.3s;"></div>
                    <div id="z7-bar" style="background:rgb(80,72,97); flex:0; transition:flex 0.3s;"></div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(8, 1fr); gap:2px; font-size:9px; color:#aaa; font-family:Overpass Mono, monospace;">
                    <span id="z1-time" style="text-align:center;">Z1<br>0s</span>
                    <span id="z2-time" style="text-align:center;">Z2<br>0s</span>
                    <span id="z3-time" style="text-align:center;">Z3<br>0s</span>
                    <span id="ss-time" style="text-align:center;">SS<br>0s</span>
                    <span id="z4-time" style="text-align:center;">Z4<br>0s</span>
                    <span id="z5-time" style="text-align:center;">Z5<br>0s</span>
                    <span id="z6-time" style="text-align:center;">Z6<br>0s</span>
                    <span id="z7-time" style="text-align:center;">Z7<br>0s</span>
                </div>
            </div>
            <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                <colgroup>
                    <col style="width:30%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:15%;">
                    <col style="width:15%;">
                </colgroup>
                <thead>
                    <tr style="text-align:left; color:#fff;">
                        <th style="padding:2px;">Name</th>
                        <th style="padding:2px;">Power</th>
                        <th style="padding:2px;">Speed</th>
                        <th style="padding:2px;">W/kg</th>
                        <th style="padding:2px;">Gap</th>
                        <th style="padding:2px;">Dist</th>
                        <th style="padding:2px;">Lap</th>
                    </tr>
                </thead>
            </table>
        </div>
        <div style="flex: 1; overflow-y: auto; padding: 0 10px 10px 10px;">
            <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                <colgroup>
                    <col style="width:30%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:15%;">
                    <col style="width:15%;">
                </colgroup>
                <tbody id="rider-table-body">
                    <tr><td colspan="7" style="text-align:center; color:#888;">Waiting for breakpoint...</td></tr>
                </tbody>
            </table>
        </div>
    `;
    document.body.appendChild(container);

    const tbody = document.getElementById('rider-table-body');
    const statusLight = document.getElementById('status-light');
    const viewToggle = document.getElementById('view-toggle');

    // --- View state ---
    let isGroupView = false;
    const GROUP_DISTANCE = 25; // meters
    const expandedGroups = new Set(); // Track which groups are collapsed
    let activeGroupSpectate = null; // Track which group index is being spectated

    viewToggle.addEventListener('click', () => {
        isGroupView = !isGroupView;
        viewToggle.textContent = isGroupView ? '🗉' : '🗊';
        expandedGroups.clear(); // Clear expanded state when switching views
        window.activeGroupSpectate = null; // Clear group spectate tracking when switching views
        window.__lastGroupLeader = null; // Clear last leader tracking
    });

    // Global function to toggle group
    window.toggleGroup = function(groupId) {
        const collapsedKey = groupId + '-collapsed';
        if (expandedGroups.has(collapsedKey)) {
            expandedGroups.delete(collapsedKey);
        } else {
            expandedGroups.add(collapsedKey);
        }
    };

    // --- Interpolation state for smoother updates ---
    window.__riderInterpolation = window.__riderInterpolation || {};

    function interpolateRider(riderId, currentDist, currentSpeed, isMe) {
        const now = Date.now();

        if (!window.__riderInterpolation[riderId]) {
            window.__riderInterpolation[riderId] = {
                lastDist: currentDist,
                lastSpeed: currentSpeed,
                lastUpdate: now,
                interpolatedDist: currentDist,
                isMe: isMe
            };
            return currentDist;
        }

        const interp = window.__riderInterpolation[riderId];
        const timeSinceUpdate = now - interp.lastUpdate;

        // Check if we have new data (distance changed)
        if (currentDist !== interp.lastDist) {
            // New data received, reset interpolation
            interp.lastDist = currentDist;
            interp.lastSpeed = currentSpeed;
            interp.lastUpdate = now;
            interp.interpolatedDist = currentDist;
            interp.isMe = isMe;
            return currentDist;
        }

        // Apply the same interpolation logic to ALL riders (including isMe)
        // This ensures consistent position calculations across all riders
        // Speed is in m/s, time is in ms, so: distance = speed * (time / 1000)
        const interpolatedDistance = interp.lastDist + (interp.lastSpeed * (timeSinceUpdate / 1000));
        interp.interpolatedDist = interpolatedDistance;

        return interpolatedDistance;
    }

    // --- Get lap distance for a rider ---
    function getLapDistance(riderId, gm) {
        if (!gm) return null;

        let human = null;
        const ego = gm.ego;
        const focalRider = gm.focalRider;
        const humans = gm.humans || {};

        // Find the human object for this rider
        if (ego && (ego.athleteId === riderId || ego.id === riderId)) {
            human = ego;
        } else if (focalRider && (focalRider.athleteId === riderId || focalRider.id === riderId)) {
            human = focalRider;
        } else if (humans[riderId]) {
            human = humans[riderId];
        } else {
            // Search through humans by athleteId
            for (const h of Object.values(humans)) {
                if ((h.athleteId || h.id) === riderId) {
                    human = h;
                    break;
                }
            }
        }

        if (!human?.currentPath?.road) return null;

        const roadId = human.currentPath.road.id;
        const road = human.currentPath.road;

        // Get the lap distance based on which path they're on
        if (roadId === 0) {
            return road.pathA?.distance || null;
        } else if (roadId === 1) {
            return road.pathB?.distance || null;
        }

        return null;
    }

    // --- Rider row renderer ---
    function renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit, isFinished = false) {
        let name;
        if (r.isMe && ego) {
            name = ego.name || r.name || "You";
        } else {
            name = r.name || "Unknown";
        }

        const highlightStyle = r.isMe
            ? "outline: 2px solid #FF6262; outline-offset: -2px; box-shadow: 0 0 4px #FF6262;"
            : "";

        const dist = r.lapDistance.toFixed(2);
        const speed = (r.speed * 3.6).toFixed(1);
        const power = Math.round(r.power);
        const wkg = r.wkg.toFixed(1);

        let gapText;

        if (r.riderId === referenceRiderId) {
            gapText = "0m";
        } else if (r.lap !== referenceLap) {
            // Calculate actual distance gap using lap information
            const lapDiff = r.lap - referenceLap;

            // Calculate total distance traveled for each rider
            // For the reference rider: (laps completed * lap distance) + current lap distance
            const referenceTotalDist = (referenceLap - 1) * globalLapLimit + referenceDist;
            const riderTotalDist = (r.lap - 1) * globalLapLimit + r.lapDistance;

            const gapMeters = riderTotalDist - referenceTotalDist;

            if (gapMeters === 0) gapText = "0m";
            else if (gapMeters > 0) gapText = `+${Math.round(gapMeters)}m`;
            else gapText = `${Math.round(gapMeters)}m`;
        } else {
            const gapMeters = r.lapDistance - referenceDist;
            if (gapMeters === 0) gapText = "0m";
            else if (gapMeters > 0) gapText = `+${Math.round(gapMeters)}m`;
            else gapText = `${Math.round(gapMeters)}m`;
        }

        let wkgColor = '#fff';
        let ftp;

        // Determine correct FTP
        if (r.isMe && window.gameManager?.ego?.userData?.ftp) {
            ftp = window.gameManager.ego.userData.ftp;
        } else {
            ftp = window.__athleteFtpMap[r.riderId];
        }

        // Compute W/kg color based on Intervals.icu power zones
        if (ftp && r.power) {
            const ratio = r.power / ftp;

            if (ratio >= 1.51) wkgColor = 'rgb(80, 72, 97)';       // Z7 Neuromuscular: 151%+
            else if (ratio >= 1.21) wkgColor = 'rgb(102, 51, 204)'; // Z6 Anaerobic: 121-150%
            else if (ratio >= 1.06) wkgColor = 'rgb(221, 4, 71)';   // Z5 VO2 Max: 106-120%
            else if (ratio >= 0.97) wkgColor = 'rgb(255, 127, 14)'; // Z4 Threshold: 97-105%
            else if (ratio >= 0.84) wkgColor = 'rgb(255, 160, 14)'; // SS Sweet Spot: 84-97%
            else if (ratio >= 0.76) wkgColor = 'rgb(255, 203, 14)'; // Z3 Tempo: 76-83%
            else if (ratio >= 0.56) wkgColor = 'rgb(0, 158, 0)';    // Z2 Endurance: 56-75%
            else wkgColor = 'rgb(0, 158, 128)';                     // Z1 Active Recovery: 0-55%
        } else {
            // fallback if no FTP or power available
            if (r.wkg >= 6.0) wkgColor = 'rgb(102, 51, 204)';      // Likely maximal effort
            else if (r.wkg >= 4.0) wkgColor = 'rgb(221, 4, 71)';   // Hard effort
            else if (r.wkg >= 3.0) wkgColor = 'rgb(255, 127, 14)'; // Moderate effort
            else wkgColor = 'rgb(0, 158, 128)';                    // Easy effort
        }

        let helmetColor = "#444444";
        const gmHumans = gm?.humans || {};

        if (r.isMe) {
            if (ego) {
                 helmetColor = ego?.entity?.design?.helmet_color
                            || ego?.config?.design?.helmet_color
                            || ego?.helmet_color
                            || helmetColor;
            } else if (focalRiderObj) {
                const focalId = focalRiderObj.athleteId || focalRiderObj.id;
                const targetHuman = gmHumans[focalId] || Object.values(gmHumans).find(h => (h.athleteId || h.id) == focalId);
                if (targetHuman) {
                    helmetColor = targetHuman?.config?.design?.helmet_color || helmetColor;
                }
            }
        } else {
            if (gmHumans[r.riderId]?.config?.design?.helmet_color) {
                helmetColor = gmHumans[r.riderId].config.design.helmet_color;
            } else {
                for (const h of Object.values(gmHumans)) {
                    if ((h.athleteId || h.id) === r.riderId) {
                        helmetColor = h.config?.design?.helmet_color || helmetColor;
                        break;
                    }
                }
            }
        }

        let bgColor = helmetColor;
        if (helmetColor.startsWith('#') && helmetColor.length === 7) {
            const rC = parseInt(helmetColor.slice(1,3),16);
            const gC = parseInt(helmetColor.slice(3,5),16);
            const bC = parseInt(helmetColor.slice(5,7),16);
            bgColor = `rgba(${rC},${gC},${bC},0.6)`;
        }

        const rowStyle = `
            border-bottom:1px solid #333;
            background:${bgColor};
            cursor:${r.isMe ? "default" : "pointer"};
            ${highlightStyle}
        `;

        return `
            <tr style="${rowStyle}" onclick="window.spectateRiderById(${r.riderId || 0})">
                <td style="padding:4px;font-size:13px; color:#fff;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${name}</td>
                <td style="padding:4px;font-size:13px;color:#fff; font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${power}</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${speed}</td>
                <td style="padding:4px;font-size:15px;color:${wkgColor}; font-weight:bold; font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${wkg}</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${gapText}</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${dist}m</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${r.lap}</td>
            </tr>
        `;
    }

    async function processFtpQueue() {
        if (window.__ftpBusy) return;
        if (window.__ftpQueue.length === 0) return;

        window.__ftpBusy = true;
        const athleteId = window.__ftpQueue.shift();

        try {
            await fetchAndCacheAthleteFTP(athleteId);
        } catch (e) {
            console.warn("FTP fetch failed for", athleteId, e);
        }

        setTimeout(() => {
            window.__ftpBusy = false;
            processFtpQueue();
        }, 600); // safe throttle
    }

    function updatePowerZoneTracking(rider, ftp) {
        if (!rider || !ftp || !rider.riderId) return;

        const riderId = rider.riderId;
        const now = Date.now();

        // Initialize tracking for this rider if not exists
        if (!window.__riderPowerZones[riderId]) {
            window.__riderPowerZones[riderId] = {
                z1: 0, z2: 0, z3: 0, ss: 0, z4: 0, z5: 0, z6: 0, z7: 0
            };
        }
        
        if (!window.__lastZoneUpdate[riderId]) {
            window.__lastZoneUpdate[riderId] = now;
            return; // Skip first update to establish baseline
        }

        const timeDelta = (now - window.__lastZoneUpdate[riderId]) / 1000; // seconds
        window.__lastZoneUpdate[riderId] = now;

        const power = rider.power;
        const ratio = power / ftp;

        // Determine which zone the rider is in
        let zone = null;
        if (ratio >= 1.51) zone = 'z7';
        else if (ratio >= 1.21) zone = 'z6';
        else if (ratio >= 1.06) zone = 'z5';
        else if (ratio >= 0.97) zone = 'z4';
        else if (ratio >= 0.84) zone = 'ss';
        else if (ratio >= 0.76) zone = 'z3';
        else if (ratio >= 0.56) zone = 'z2';
        else zone = 'z1';

        // Add time to the current zone for this rider
        if (zone) {
            window.__riderPowerZones[riderId][zone] += timeDelta;
        }
    }

    function displayPowerZonesForRider(riderId) {
        if (!riderId || !window.__riderPowerZones[riderId]) {
            // No data yet - show zeros
            Object.keys({ z1: 0, z2: 0, z3: 0, ss: 0, z4: 0, z5: 0, z6: 0, z7: 0 }).forEach(z => {
                const bar = document.getElementById(`${z}-bar`);
                if (bar) bar.style.flex = 0;
                
                const label = document.getElementById(`${z}-time`);
                if (label) {
                    const zoneLabel = z === 'ss' ? 'SS' : z.toUpperCase();
                    label.innerHTML = `${zoneLabel}<br>0s`;
                }
            });
            return;
        }

        const zones = window.__riderPowerZones[riderId];
        const totalTime = Object.values(zones).reduce((a, b) => a + b, 0);
        
        // Update bars
        Object.keys(zones).forEach(z => {
            const bar = document.getElementById(`${z}-bar`);
            if (bar) {
                if (totalTime > 0) {
                    const percentage = (zones[z] / totalTime) * 100;
                    bar.style.flex = percentage > 0 ? percentage : 0;
                } else {
                    bar.style.flex = 0;
                }
            }
        });

        // Update time labels
        const formatTime = (seconds) => {
            if (seconds < 60) return `${Math.floor(seconds)}s`;
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        Object.keys(zones).forEach(z => {
            const label = document.getElementById(`${z}-time`);
            if (label) {
                const zoneLabel = z === 'ss' ? 'SS' : z.toUpperCase();
                label.innerHTML = `${zoneLabel}<br>${formatTime(zones[z])}`;
            }
        });
    }

    setInterval(() => {
        if (!window.hackedRiders && Object.keys(window.__finishedRiders).length === 0) {
            statusLight.innerText = "●";
            statusLight.style.color = "orange";
            return;
        }

        let riders = window.hackedRiders ? [...window.hackedRiders] : [];

        // Add back any finished riders that are no longer in hackedRiders
        Object.keys(window.__finishedRiders).forEach(finishedId => {
            if (!riders.find(r => r.riderId == finishedId)) {
                const storedData = window.__finishedRiders[finishedId].riderData;
                if (storedData) {
                    riders.push(storedData);
                }
            }
        });

        // If we have no riders at all, show waiting message
        if (riders.length === 0) {
            statusLight.innerText = "●";
            statusLight.style.color = "orange";
            return;
        }

        queueRidersForFtp(riders);

        let leaderLap = 0;

        const gm = window.gameManager;
        const ego = gm?.ego;
        const focalRiderObj = gm?.focalRider;

        // --- Get Global Map Info ---
        const globalRoad = ego?.currentPath?.road || focalRiderObj?.currentPath?.road;
        const globalLapLimit = globalRoad?.pathA?.distance || globalRoad?.pathB?.distance || 10000; // Default 10k

        // Get total laps to detect already-finished riders
        const totalLaps = getTotalLaps();

        // Separate finished and active riders
        const finishedRiders = [];
        const activeRiders = [];

        riders.forEach(r => {
            const rawDist = r.dist;
            const id = r.riderId;

            // Check if rider has finished (either already marked OR lap is beyond total laps)
            let isFinished = window.__finishedRiders[id] !== undefined;

            // Also check if rider has already completed all laps (for riders who finished before spectating started)
            if (!isFinished && r.lap > totalLaps) {
                isFinished = true;
                // Mark them as finished now
                window.__finishedRiders[id] = {
                    finishTime: Date.now() - (r.lap - totalLaps) * 60000, // Estimate earlier finish time
                    riderData: { ...r }
                };
                console.log(`🏁 Rider ${id} (${r.name}) was already finished when spectating started`);
            }

            // Apply interpolation to smooth out position updates
            const dist = interpolateRider(id, rawDist, r.speed, r.isMe);

            // Use native lapCount from Biketerra (starts at 0, so add 1 for display)
            // The lap count is already set in the breakpoint, just use it directly
            const displayLap = r.lap; // Already incremented in breakpoint (+1)

            r.lapDistance = dist >= 0 ? dist : 0;

            if (displayLap > leaderLap) leaderLap = displayLap;

            // Split into finished vs active
            if (isFinished) {
                // Update the stored rider data with current live data
                window.__finishedRiders[id].riderData = { ...r };
                finishedRiders.push(r);
            } else {
                activeRiders.push(r);
            }
        });

        // Check for race finishes
        checkForRaceFinish(riders);

        // Sort finished riders by finish time (earliest first)
        finishedRiders.sort((a, b) => {
            const timeA = window.__finishedRiders[a.riderId]?.finishTime || 0;
            const timeB = window.__finishedRiders[b.riderId]?.finishTime || 0;
            return timeA - timeB;
        });

        // Sort active riders by lap and distance
        activeRiders.sort((a, b) => {
            if (b.lap !== a.lap) return b.lap - a.lap;
            return b.lapDistance - a.lapDistance;
        });

        statusLight.innerText = "●";
        statusLight.style.color = "#00ff00";

        // --- Track power zones for ALL riders ---
        riders.forEach(r => {
            let ftp = null;
            
            // Get FTP for this rider
            if (r.isMe && ego?.userData?.ftp) {
                ftp = ego.userData.ftp;
            } else if (window.__athleteFtpMap[r.riderId]) {
                ftp = window.__athleteFtpMap[r.riderId];
            }
            
            // Update tracking for this rider
            if (ftp && r.power && r.riderId) {
                updatePowerZoneTracking(r, ftp);
            }
        });

        // Get reference rider ID (ego or focal rider)
        let referenceRiderId = null;
        if (ego) {
            referenceRiderId = ego.athleteId || ego.id;
        } else if (focalRiderObj) {
            referenceRiderId = focalRiderObj.athleteId || focalRiderObj.id;
        }

        // Find reference rider in active riders first, then finished riders, then default to first available rider
        let referenceRider = activeRiders.find(r => r.riderId === referenceRiderId);
        if (!referenceRider) {
            referenceRider = finishedRiders.find(r => r.riderId === referenceRiderId);
        }
        if (!referenceRider) {
            referenceRider = activeRiders[0] || finishedRiders[0];
        }

        // Display power zones for the reference rider (the one we're watching)
        if (referenceRider) {
            displayPowerZonesForRider(referenceRider.riderId);
        }
        const referenceLap = referenceRider?.lap || 1;
        const referenceDist = referenceRider?.lapDistance || 0;

        let html = '';

        if (isGroupView) {
            const groups = [];
            let currentGroup = [];

            // --- 1. Build groups based on distance (only for active riders) ---
            activeRiders.forEach((r, idx) => {
                if (currentGroup.length === 0) {
                    currentGroup.push(r);
                } else {
                    const lastRider = currentGroup[currentGroup.length - 1];
                    const gap = lastRider.lapDistance - r.lapDistance;

                    if (gap <= GROUP_DISTANCE && r.lap === lastRider.lap) {
                        currentGroup.push(r);
                    } else {
                        groups.push([...currentGroup]);
                        currentGroup = [r];
                    }
                }
            });
            if (currentGroup.length > 0) groups.push(currentGroup);

            // --- 2. Compute lead distance and lap for each group ---
            groups.forEach(g => {
                g.leadLap = Math.max(...g.map(r => r.lap));
                g.leadDist = Math.max(...g.map(r => r.lapDistance + (r.lap - 1) * globalLapLimit));
            });

            // --- 3. Sort groups by lap then distance, Identify Breakaway (front-most group) ---
            groups.sort((a, b) => {
                if (b.leadLap !== a.leadLap) return b.leadLap - a.leadLap;
                return b.leadDist - a.leadDist;
            });

            let breakaway = null;
            let peloton = null;

            // Only process groups if we have active riders
            if (groups.length > 0) {
                // If only one group, it's the peloton
                if (groups.length === 1) {
                    peloton = groups[0];
                } else {
                    breakaway = groups[0];

                    // --- 4. Identify Peloton (largest group) ---
                    peloton = groups.reduce((max, g) => g.length > max.length ? g : max, groups[0]);

                    // --- 5. Ensure only 1 Peloton ---
                    if (breakaway.length > peloton.length) {
                        let temp = peloton;
                        peloton = breakaway;
                        breakaway = temp;
                    }
                }
            }

            // --- 6. Render Finished group first if there are finished riders ---
            if (finishedRiders.length > 0) {
                const groupId = 'group-finished';
                const isExpanded = !expandedGroups.has(groupId + '-collapsed');
                const arrow = isExpanded ? '▲' : '▼';

                html += `
                    <tr style="background:rgba(50,205,50,0.3); cursor:pointer; font-family:'Overpass',sans-serif;"
                        onclick="event.stopPropagation(); window.toggleGroup('${groupId}');"
                        title="Click to expand/collapse">
                        <td colspan="7" style="padding:6px; color:#fff; font-weight:bold;">
                            ${arrow} Finished - ${finishedRiders.length} rider${finishedRiders.length>1?'s':''}
                        </td>
                    </tr>
                `;

                finishedRiders.forEach(r => {
                    const riderRow = renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit, true);
                    if (!isExpanded) {
                        html += riderRow.replace('<tr style="', '<tr style="display:none; ');
                    } else {
                        html += riderRow;
                    }
                });

                html += `<tr style="height:4px;"><td colspan="7"></td></tr>`;
            }

            // --- 7. Render active groups ---
            let chaseCounter = 1;
            let stragglersCounter = 1;

            groups.forEach((group, groupIdx) => {
                const groupSize = group.length;
                const avgSpeed = (group.reduce((sum, r) => sum + r.speed, 0) / groupSize * 3.6).toFixed(1);
                const groupId = `group-${groupIdx}`;
                const isExpanded = !expandedGroups.has(groupId + '-collapsed');

                // Determine group label
                let groupLabel = "";
                if (breakaway && group === breakaway) groupLabel = `Breakaway - ${groupSize} rider${groupSize>1?'s':''}`;
                else if (peloton && group === peloton) groupLabel = `Peloton - ${groupSize} rider${groupSize>1?'s':''}`;
                else if (breakaway && peloton && group.leadDist < breakaway.leadDist && group.leadDist > peloton.leadDist) {
                    groupLabel = `Chase Group ${chaseCounter++} - ${groupSize} rider${groupSize>1?'s':''}`;
                } else {
                    groupLabel = `Stragglers ${stragglersCounter++} - ${groupSize} rider${groupSize>1?'s':''}`;
                }

                // TTT team detection
                if (window.__tttDataLoaded && group.length > 1) {
                    const teamNames = new Set(
                        group
                            .map(r => window.__tttTeamMap[String(r.riderId)])
                            .filter(Boolean)
                    );
                    if (teamNames.size === 1) groupLabel = [...teamNames][0];
                }

                const arrow = isExpanded ? '▲' : '▼';

                // Always show group header
                html += `
                    <tr style="background:rgba(255,255,255,0.15); cursor:pointer; font-family:'Overpass',sans-serif;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;"
                        onclick="if(event.ctrlKey) { window.spectateGroupLeader(${groupIdx}); } else { event.stopPropagation(); window.toggleGroup('${groupId}'); }"
                        title="Click to expand/collapse, Ctrl+Click to spectate leader">
                        <td colspan="7" style="padding:6px; color:#fff; font-weight:bold;">
                            ${arrow} ${groupLabel} (${avgSpeed} kph)
                        </td>
                    </tr>
                `;

                // Render each rider in the group with proper display toggle
                group.forEach(r => {
                    const riderRow = renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit);
                    // Add display style to the row if group is collapsed
                    if (!isExpanded) {
                        html += riderRow.replace('<tr style="', '<tr style="display:none; ');
                    } else {
                        html += riderRow;
                    }
                });

                html += `<tr style="height:4px;"><td colspan="7"></td></tr>`;
            });
        } else {
            // Individual view - show finished riders first
            if (finishedRiders.length > 0) {
                finishedRiders.forEach(r => {
                    html += renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit, true);
                });
                // Add separator
                html += `<tr style="height:8px; background:rgba(50,205,50,0.3);"><td colspan="7"></td></tr>`;
            }

            // Then active riders
            activeRiders.forEach(r => {
                html += renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit);
            });
        }

        tbody.innerHTML = html;

        // --- Auto-update group spectate if active ---
        if (window.activeGroupSpectate !== null) {
            // Rebuild groups the same way as display
            const trackGroups = [];
            let trackCurrentGroup = [];

            activeRiders.forEach((r, idx) => {
                if (trackCurrentGroup.length === 0) {
                    trackCurrentGroup.push(r);
                } else {
                    const lastRider = trackCurrentGroup[trackCurrentGroup.length - 1];
                    const gap = lastRider.lapDistance - r.lapDistance;

                    if (gap <= GROUP_DISTANCE && r.lap === lastRider.lap) {
                        trackCurrentGroup.push(r);
                    } else {
                        trackGroups.push([...trackCurrentGroup]);
                        trackCurrentGroup = [r];
                    }
                }
            });
            if (trackCurrentGroup.length > 0) trackGroups.push(trackCurrentGroup);

            // Sort groups the same way
            trackGroups.forEach(g => {
                g.leadLap = Math.max(...g.map(r => r.lap));
                g.leadDist = Math.max(...g.map(r => r.lapDistance + (r.lap - 1) * globalLapLimit));
            });
            trackGroups.sort((a, b) => {
                if (b.leadLap !== a.leadLap) return b.leadLap - a.leadLap;
                return b.leadDist - a.leadDist;
            });

            // Check if the group still exists and update spectate target
            if (window.activeGroupSpectate < trackGroups.length) {
                const trackedGroup = trackGroups[window.activeGroupSpectate];
                const currentLeader = trackedGroup[0];

                // Store last leader to track changes
                if (!window.__lastGroupLeader) {
                    window.__lastGroupLeader = currentLeader.riderId;
                }

                // Check if current leader is still in the tracked group
                const lastLeaderInGroup = trackedGroup.some(r => r.riderId === window.__lastGroupLeader);

                if (!lastLeaderInGroup) {
                    // Last leader left the group, switch to new leader
                    window.__lastGroupLeader = currentLeader.riderId;
                    if (gm && typeof gm.setFocalRider === 'function') {
                        gm.setFocalRider(currentLeader.riderId);
                    }
                } else if (currentLeader.riderId !== window.__lastGroupLeader) {
                    // Leader changed but old leader still in group (someone attacked)
                    window.__lastGroupLeader = currentLeader.riderId;
                    if (gm && typeof gm.setFocalRider === 'function') {
                        gm.setFocalRider(currentLeader.riderId);
                    }
                }
            } else {
                // Group no longer exists at the tracked index
                // Check if last leader is still in any group (solo or with others)
                const lastLeaderRider = activeRiders.find(r => r.riderId === window.__lastGroupLeader);
                if (lastLeaderRider) {
                    // Leader still exists, stay with them but stop group tracking
                    window.activeGroupSpectate = null;
                    window.__lastGroupLeader = null;
                } else {
                    // Leader doesn't exist anymore, stop tracking
                    window.activeGroupSpectate = null;
                    window.__lastGroupLeader = null;
                }
            }
        }

    }, 500);
    setInterval(processFtpQueue, 1000);

})();
