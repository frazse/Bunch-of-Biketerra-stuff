// ==UserScript==
// @name         Biketerra - Riderlist replacement HUD
// @namespace    http://tampermonkey.net/
// @version      12.2
// @description  Using native game lapCount with Finished riders group
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
    window.__raceResults = null;
    window.__lastLapCounts = {}; // Track lap counts to detect lap completions
    window.__pendingResultsFetch = false; // Prevent multiple simultaneous fetches
    window.__biketerra_token = ""; // Store auth token for API requests

    // Token extraction from page scripts (same method as Challenge List script)
    function extractTokenFromScripts() {
        console.log("🔍 Attempting to extract token from page scripts...");
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const text = script.textContent;
            // Look for token with flexible whitespace and any alphanumeric characters
            // Matches: token: "..." or token:"..." where ... is 15+ alphanumeric chars
            const tokenMatch = text.match(/token\s*:\s*"([a-zA-Z0-9]{15,})"/);
            if (tokenMatch) {
                window.__biketerra_token = tokenMatch[1];
                console.log("🔑 Auth token extracted from page scripts:", tokenMatch[1].substring(0, 8) + "...");
                return tokenMatch[1];
            }
        }
        console.warn("⚠️ Token not found in page scripts");
        return null;
    }

    // Fetch token from dashboard as fallback
    async function fetchTokenFromDashboard() {
        console.log("🔍 Fetching token from dashboard...");
        try {
            const response = await fetch('https://biketerra.com/dashboard');
            const text = await response.text();

            // Look for token with flexible whitespace and any alphanumeric characters
            const tokenMatch = text.match(/token\s*:\s*"([a-zA-Z0-9]{15,})"/);
            if (tokenMatch) {
                window.__biketerra_token = tokenMatch[1];
                console.log("🔑 Auth token extracted from dashboard:", tokenMatch[1].substring(0, 8) + "...");
                return tokenMatch[1];
            }
            console.warn("⚠️ Token not found in dashboard");
            return null;
        } catch (e) {
            console.error("❌ Error fetching dashboard:", e);
            return null;
        }
    }

    // Try to extract token on load with multiple fallbacks
    async function initializeToken() {
        // Try page scripts first
        let token = extractTokenFromScripts();

        if (!token) {
            // Wait a bit and try again
            await new Promise(resolve => setTimeout(resolve, 2000));
            token = extractTokenFromScripts();
        }

        if (!token) {
            // Fetch from dashboard as last resort
            console.log("🔍 Token not found on page, fetching from dashboard...");
            token = await fetchTokenFromDashboard();
        }

        if (token) {
            console.log("✅ Token successfully initialized");
        } else {
            console.error("❌ Failed to obtain auth token from any source");
        }
    }

    // Initialize token
    initializeToken();

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
                        // Also look for token in __data.json
                        if (!window.__biketerra_token && typeof item === 'object' && item?.user?.token) {
                            window.__biketerra_token = item.user.token;
                            console.log("🔑 Auth token extracted from __data.json:", item.user.token.substring(0, 8) + "...");
                        }

                        // Look for token string in array (it might be stored as separate items)
                        if (!window.__biketerra_token && idx > 0 && arr[idx - 1] === "token" && typeof item === 'string' && item.length > 15) {
                            window.__biketerra_token = item;
                            console.log("🔑 Auth token found as array item in __data.json:", item.substring(0, 8) + "...");
                        }

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

    // Function to fetch race results
    async function fetchRaceResults() {
        if (window.__pendingResultsFetch) return; // Prevent duplicate fetches

        window.__pendingResultsFetch = true;

        try {
            // Extract race ID from URL
            const urlMatch = location.href.match(/(?:ride|spectate)\/([^/?]+)/);
            if (!urlMatch) return null;

            const raceId = urlMatch[1];

            // Get the token - try to extract if we don't have it yet
            let token = window.__biketerra_token;
            if (!token) {
                token = extractTokenFromScripts();
            }

            if (!token) {
                console.warn("⚠️ Cannot fetch results: No auth token available");
                return null;
            }

            const resultsUrl = `https://biketerra.com/api/results`;

            const response = await fetch(resultsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    token: token,
                    id: parseInt(raceId)
                })
            });

            if (!response.ok) {
                console.error("Results API error:", response.status, response.statusText);
                return null;
            }

            const data = await response.json();

            if (!data.ok || !data.msg) {
                console.error("Results API returned error:", data);
                return null;
            }

            window.__raceResults = data.msg;

            // Process results into finished riders map
            if (data.msg.results && Array.isArray(data.msg.results)) {
                const finishedCount = data.msg.results.filter(r => r.finish_time).length;
                console.log(`🏁 Processing ${finishedCount} finished riders from results API`);

                data.msg.results.forEach((result, index) => {
                    if (result.id && result.finish_time) {
                        window.__finishedRiders[result.id] = {
                            position: index + 1,
                            finishTime: result.finish_time,
                            elapsedTime: result.elapsed_time,
                            firstName: result.first_name,
                            lastName: result.last_name
                        };
                    }
                });
                console.log("🏁 Race results loaded. Finished rider IDs:", Object.keys(window.__finishedRiders));
            }

            return data.msg;
        } catch (e) {
            console.error("Error fetching race results:", e);
            return null;
        } finally {
            window.__pendingResultsFetch = false;
        }
    }

    // Function to check for lap completions and trigger results fetch
    function checkForLapCompletions(riders) {
        let shouldFetch = false;

        riders.forEach(r => {
            const riderId = r.riderId;
            const currentLap = r.lap;

            // Check if this rider completed a lap since last check
            if (window.__lastLapCounts[riderId] !== undefined) {
                if (currentLap > window.__lastLapCounts[riderId]) {
                    console.log(`🏁 Rider ${riderId} completed lap ${currentLap}`);
                    shouldFetch = true;
                }
            }

            // Update last known lap count
            window.__lastLapCounts[riderId] = currentLap;
        });

        // Fetch results 15 seconds after a lap completion is detected
        if (shouldFetch && !window.__pendingResultsFetch) {
            console.log("⏱️ Scheduling results fetch in 15 seconds...");
            setTimeout(() => {
                fetchRaceResults();
            }, 15000);
        }
    }

    // Initial fetch on load
    fetchRaceResults();

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
            el.style.paddingTop = '.3rem';
            el.style.paddingRight = '.4rem';
        }
    }).catch(() => {});
        waitFor(".view-toggle").then(el => {
        if(el) el.style.display = 'none';
    }).catch(() => {});

    // --- HUD Container ---
    const container = document.createElement('div');
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
        padding: 4px 10px 10px 10px;
        z-index: 1;
        border-radius: 8px;
        max-height: 60vh;
        overflow-y: auto;
    `;
    container.innerHTML = `
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
        <table style="width:100%; border-collapse:collapse;">
            <thead>
                <tr style="text-align:left; color:#fff;">
                    <th style="padding:2px; width:30%;">Name</th>
                    <th style="padding:2px;">Power</th>
                    <th style="padding:2px;">Speed</th>
                    <th style="padding:2px;">W/kg</th>
                    <th style="padding:2px;">Gap</th>
                    <th style="padding:2px;">Dist</th>
                    <th style="padding:2px;">Lap</th>
                </tr>
            </thead>
            <tbody id="rider-table-body">
                <tr><td colspan="7" style="text-align:center; color:#888;">Waiting for breakpoint...</td></tr>
            </tbody>
        </table>
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

    // Format time helper
    function formatTime(milliseconds) {
        if (!milliseconds) return "—";

        const totalSeconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    // --- Rider row renderer ---
    function renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit, isFinished = false) {
        let name;
        if (r.isMe && ego) {
            name = ego.name || r.name || "You";
        } else {
            name = r.name || "Unknown";
        }

        // Add position and time for finished riders
        if (isFinished && window.__finishedRiders[r.riderId]) {
            const finishData = window.__finishedRiders[r.riderId];
            const positionStr = finishData.position.toString().padStart(2, ' ');
            const timeStr = formatTime(finishData.elapsedTime);
            name = `${positionStr}. ${timeStr} - ${name}`;
        }

const highlightStyle = r.isMe
    ? "outline: 2px solid #FF6262; outline-offset: -2px; box-shadow: 0 0 4px #FF6262;"
    : "";

        const dist = r.lapDistance.toFixed(2);
        const speed = (r.speed * 3.6).toFixed(1);
        const power = Math.round(r.power);
        const wkg = r.wkg.toFixed(1);

        let gapText;

        if (isFinished) {
            gapText = "—";
        } else if (r.riderId === referenceRiderId) {
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
        if (r.wkg >= 10.0) wkgColor = '#ff4444';
        else if (r.wkg >= 3.5) wkgColor = '#ffcc00';

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
                <td style="padding:4px; color:#fff;text-shadow: 1px 1px 4px #000">${name}</td>
                <td style="padding:4px;color:#fff; font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${power}</td>
                <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${speed}</td>
                <td style="padding:4px;color:${wkgColor}; font-weight:bold; font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000;">${wkg}</td>
                <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${gapText}</td>
                <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${dist}m</td>
                <td style="padding:4px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: 1px 1px 4px #000">${r.lap}</td>
            </tr>
        `;
    }

    setInterval(() => {
        if (!window.hackedRiders) {
            statusLight.innerText = "●";
            statusLight.style.color = "orange";
            return;
        }

        let riders = [...window.hackedRiders];
        let leaderLap = 0;

        const gm = window.gameManager;
        const ego = gm?.ego;
        const focalRiderObj = gm?.focalRider;

        // --- Get Global Map Info ---
        const globalRoad = ego?.currentPath?.road || focalRiderObj?.currentPath?.road;
        const globalLapLimit = globalRoad?.pathA?.distance || globalRoad?.pathB?.distance || 10000; // Default 10k

        // Separate finished and active riders
        const finishedRiders = [];
        const activeRiders = [];

        riders.forEach(r => {
            const rawDist = r.dist;
            const id = r.riderId;

            // Check if rider has finished
            const isFinished = window.__finishedRiders[id] !== undefined;

            // Apply interpolation to smooth out position updates
            const dist = interpolateRider(id, rawDist, r.speed, r.isMe);

            // Use native lapCount from Biketerra (starts at 0, so add 1 for display)
            // The lap count is already set in the breakpoint, just use it directly
            const displayLap = r.lap; // Already incremented in breakpoint (+1)

            r.lapDistance = dist >= 0 ? dist : 0;

            if (displayLap > leaderLap) leaderLap = displayLap;

            // Split into finished vs active
            if (isFinished) {
                finishedRiders.push(r);
            } else {
                activeRiders.push(r);
            }
        });

        // Check for lap completions to trigger results fetch
        checkForLapCompletions(riders);

        // Sort finished riders by position
        finishedRiders.sort((a, b) => {
            const posA = window.__finishedRiders[a.riderId]?.position || 9999;
            const posB = window.__finishedRiders[b.riderId]?.position || 9999;
            return posA - posB;
        });

        // Sort active riders by lap and distance
        activeRiders.sort((a, b) => {
            if (b.lap !== a.lap) return b.lap - a.lap;
            return b.lapDistance - a.lapDistance;
        });

        statusLight.innerText = "●";
        statusLight.style.color = "#00ff00";

        // Get reference rider ID (ego or focal rider)
        let referenceRiderId = null;
        if (ego) {
            referenceRiderId = ego.athleteId || ego.id;
        } else if (focalRiderObj) {
            referenceRiderId = focalRiderObj.athleteId || focalRiderObj.id;
        }

        // CRITICAL: Use the rider data from activeRiders array (which comes from window.hackedRiders)
        // for ALL gap calculations, including for "isMe" rider. This ensures consistent data source.
        // If gaps seem wrong, the issue is in the breakpoint code that populates window.hackedRiders,
        // not in this display code.
        const referenceRider = activeRiders.find(r => r.riderId === referenceRiderId) || activeRiders[0];
        const referenceLap = referenceRider?.lap || 1;
        const referenceDist = referenceRider?.lapDistance || 0;

        // Debug logging (uncomment to troubleshoot gap issues)
        // if (referenceRider) {
        //     console.log(`Reference rider: ${referenceRider.name} | Lap: ${referenceLap} | Distance: ${referenceDist.toFixed(2)}m`);
        //     const nearbyRiders = activeRiders.slice(0, 5);
        //     nearbyRiders.forEach(r => {
        //         const gap = r.lapDistance - referenceDist;
        //         console.log(`  ${r.name}: Lap ${r.lap}, Dist ${r.lapDistance.toFixed(2)}m, Gap: ${gap.toFixed(2)}m, isMe: ${r.isMe}`);
        //     });
        // }

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
let breakaway = groups[0];

    // --- 4. Identify Peloton (largest group) ---
    let peloton = groups.reduce((max, g) => g.length > max.length ? g : max, groups[0]);

    // --- 5. Ensure only 1 Peloton ---
    if (breakaway.length > peloton.length) {
        let temp = peloton;
        peloton = breakaway;
        breakaway = temp;
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
        if (group === breakaway) groupLabel = `Breakaway - ${groupSize} rider${groupSize>1?'s':''}`;
        else if (group === peloton) groupLabel = `Peloton - ${groupSize} rider${groupSize>1?'s':''}`;
        else if (group.leadDist < breakaway.leadDist && group.leadDist > peloton.leadDist) {
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
            <tr style="background:rgba(255,255,255,0.15); cursor:pointer; font-family:'Overpass',sans-serif;"
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
}


       else {
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

})();
