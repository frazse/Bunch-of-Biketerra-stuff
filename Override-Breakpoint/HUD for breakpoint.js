// ==UserScript==
// @name         Biketerra - Riderlist replacement HUD
// @namespace    http://tampermonkey.net/
// @version      11.7
// @description  Fixed lap detection using actual game path data
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
            console.log(`📡 Spectating: ${cleanedRider ? cleanedRider.name : "Unknown Rider"} (ID: ${riderId})`);
        }
    };
}
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
        padding: 10px;
        z-index: 1;
        border-radius: 8px;
        max-height: 60vh;
        overflow-y: auto;
    `;
    container.innerHTML = `
        <div style="display:flex; align-items:center;">
            <span id="status-light" style="color:red;">●</span>
            <button id="view-toggle" style="
                background:rgba(255,255,255,0);
                color:#fff;
                border:none;
                cursor:pointer;
                font-family:'Overpass',sans-serif;
                font-size:16px;
                outline:none;
                margin-top: -5px;

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

    viewToggle.addEventListener('click', () => {
        isGroupView = !isGroupView;
        viewToggle.textContent = isGroupView ? '🗉' : '🗊';
        expandedGroups.clear(); // Clear expanded state when switching views
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

    // --- Lap tracking state ---
    window.__lapTracker = window.__lapTracker || {};

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
    function renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj) {
        let name;
        if (r.isMe && ego) {
            name = ego.name || r.name || "You";
        } else {
            name = r.name || "Unknown";
        }

        const dist = r.lapDistance.toFixed(2);
        const speed = (r.speed * 3.6).toFixed(1);
        const power = Math.round(r.power);
        const wkg = r.wkg.toFixed(1);

        let gapText;

        if (r.riderId === referenceRiderId) {
            gapText = "0m";
        } else if (r.lap !== referenceLap) {
            const lapDiff = r.lap - referenceLap;
            if (lapDiff > 0) gapText = `+${lapDiff} Lap${lapDiff > 1 ? "s" : ""}`;
            else gapText = `${lapDiff} Lap`;
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

// --- 1. Get Global Map Info first ---
        const globalRoad = ego?.currentPath?.road || focalRiderObj?.currentPath?.road;
        const globalLapLimit = globalRoad?.pathA?.distance || globalRoad?.pathB?.distance || 10000; // Default 10k
        const globalIsLooped = globalRoad?.looped ?? true;

        riders.forEach(r => {
            const dist = r.dist;
            const id = r.riderId;

            if (!window.__lapTracker[id]) {
                window.__lapTracker[id] = {
                    lap: 1,
                    lastDist: null,
                    lastPathId: null,
                    initialized: false,
                    cooldown: 0
                };
            }

            const tracker = window.__lapTracker[id];
            if (tracker.cooldown > 0) tracker.cooldown--;

            // Find specific human for Path ID checks (A<->B)
            let human = (ego && (ego.athleteId === id || ego.id === id)) ? ego :
                        (focalRiderObj && (focalRiderObj.athleteId === id || focalRiderObj.id === id)) ? focalRiderObj :
                        (gm?.humans?.[id]);
            const pathId = human?.currentPath?.id;

            let lapTriggered = false;

            // --- 2. DETECTION LOGIC ---
            if (tracker.lastDist !== null) {
                if (globalIsLooped) {
                    // LOOP DETECTION
                    // Trigger if: (Currently at start) AND (Was previously at the end)
                    // This is safer than a "Massive Drop" which can be skipped by lag
                    const isNowAtStart = dist < 250;
                    const wasJustAtEnd = tracker.lastDist > (globalLapLimit - 500);

                    if (isNowAtStart && wasJustAtEnd && tracker.cooldown === 0) {
                        lapTriggered = true;
                    }

                    // FALLBACK: If we missed the "At Start" window due to a lag spike,
                    // check for the "Massive Drop" (>50% of the map)
                    if (!lapTriggered && (tracker.lastDist - dist) > (globalLapLimit * 0.5) && tracker.cooldown === 0) {
                        lapTriggered = true;
                    }
                } else {
                    // A<->B DETECTION (Path switch)
                    if (pathId !== undefined && pathId !== null && tracker.lastPathId !== null) {
                        if (pathId !== tracker.lastPathId && tracker.cooldown === 0) {
                            lapTriggered = true;
                        }
                    }
                }
            }

            // --- 3. HANDLE LAP ---
            if (lapTriggered) {
                tracker.lap++;
                tracker.cooldown = 20;
                console.log(`🏁 LAP ${tracker.lap} | ${r.name || id} | ${globalIsLooped ? 'Loop' : 'A↔B'} (Map: ${Math.round(globalLapLimit)}m)`);
            }

            // --- 4. STATE UPDATE ---
            if (!tracker.initialized && dist !== null) {
                tracker.initialized = true;
                console.log(`📡 Tracker engaged for ${r.name || id}. Start Dist: ${dist}m`);
            }

            tracker.lastDist = dist;
            tracker.lastPathId = pathId;
            r.lap = tracker.lap;
            r.lapDistance = dist >= 0 ? dist : 0;

            if (tracker.lap > leaderLap) leaderLap = tracker.lap;
        });
        riders.sort((a, b) => {
            if (b.lap !== a.lap) return b.lap - a.lap;
            return b.lapDistance - a.lapDistance;
        });

        statusLight.innerText = "●";
        statusLight.style.color = "#00ff00";

        let referenceRiderId = null;
        if (ego) {
            referenceRiderId = ego.athleteId || ego.id;
        } else if (focalRiderObj) {
            referenceRiderId = focalRiderObj.athleteId || focalRiderObj.id;
        }

        const referenceRider = riders.find(r => r.riderId === referenceRiderId) || riders[0];
        const referenceLap = referenceRider?.lap || 1;
        const referenceDist = referenceRider?.lapDistance || 0;

        let html = '';

        if (isGroupView) {
            const groups = [];
            let currentGroup = [];

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

let chaseCounter = 1;
let stragglersCounter = 1;

// Find largest group (Peloton)
let largestGroupSize = Math.max(...groups.map(g => g.length));

groups.forEach((group, groupIdx) => {
    const groupSize = group.length;
    const avgSpeed = (group.reduce((sum, r) => sum + r.speed, 0) / groupSize * 3.6).toFixed(1);
    const groupId = `group-${groupIdx}`;
    const isExpanded = !expandedGroups.has(groupId + '-collapsed');

    // Compute lap-adjusted distance
    const groupLeadDist = Math.max(...group.map(r => r.lapDistance + (r.lap-1)*10000));
    const referenceDistAdjusted = referenceDist + (referenceLap-1)*10000;

    let groupLabel = "";

    if (groupSize === largestGroupSize) {
        groupLabel = `Peloton - ${groupSize} rider${groupSize>1?'s':''}`;
    } else if (groupLeadDist > referenceDistAdjusted) {
        groupLabel = `Breakaway - ${groupSize} rider${groupSize>1?'s':''}`;
    } else if (groupLeadDist < referenceDistAdjusted && groupLeadDist >= referenceDistAdjusted - 200) {
        groupLabel = `Chase Group ${chaseCounter++} - ${groupSize} rider${groupSize>1?'s':''}`;
    } else {
        groupLabel = `Stragglers Group ${stragglersCounter++} - ${groupSize} rider${groupSize>1?'s':''}`;
    }

    // TTT team detection
    let tttTeamName = null;
    if (window.__tttDataLoaded && group.length > 1) {
        const teamNames = new Set(
            group
                .map(r => window.__tttTeamMap[String(r.riderId)])
                .filter(Boolean)
        );
        if (teamNames.size === 1) tttTeamName = [...teamNames][0];
    }

    const displayLabel = tttTeamName || groupLabel;

    const arrow = isExpanded ? '▲' : '▼';
    const displayStyle = isExpanded ? '' : 'none';

    if (groupSize === 1) {
        html += renderRiderRow(group[0], referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj);
    } else {
        html += `
            <tr style="background:rgba(255,255,255,0.15); cursor:pointer; font-family:'Overpass',sans-serif;"
                onclick="event.stopPropagation(); window.toggleGroup('${groupId}');">
                <td colspan="7" style="padding:6px; color:#fff; font-weight:bold;">
                    ${arrow} ${displayLabel} (${avgSpeed} kph)
                </td>
            </tr>
            <tr style="display:${displayStyle};">
                <td colspan="7" style="padding:0;">
                    <table style="width:100%; border-collapse:collapse;">
        `;

        group.forEach(r => {
            html += renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj);
        });

        html += `
                    </table>
                </td>
            </tr>
        `;
    }

    html += `<tr style="height:4px;"><td colspan="7"></td></tr>`;
});

        } else {
            riders.forEach(r => {
                html += renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj);
            });
        }

        tbody.innerHTML = html;

    }, 500);

})();
