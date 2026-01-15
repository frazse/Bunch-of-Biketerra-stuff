// ==UserScript==
// @name         Biketerra - Riderlist replacement HUD
// @namespace    http://tampermonkey.net/
// @version      13.5
// @description  With time gaps for groups, sticky group headers, per-rider power zone tracking, and persistent race data across refreshes (Fixed rider ID 0 handling + stopped riders + individual view sorting)
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

    // --- Route/Event Tracking for Persistence ---
    window.__currentRouteId = null;
    window.__raceDataStorageKey = 'biketerraRaceData';

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

// Load race data from storage if it exists for this route
function loadRaceData() {
    try {
        const stored = JSON.parse(localStorage.getItem(window.__raceDataStorageKey) || "{}");
        const routeId = window.__currentRouteId;

        if (stored.routeId === routeId && stored.data) {
            console.log(`📊 Restoring race data for route ${routeId}`);

            // Restore power zones
            if (stored.data.powerZones) {
                window.__riderPowerZones = stored.data.powerZones;
                console.log(`✅ Restored power zones for ${Object.keys(window.__riderPowerZones).length} riders`);
            }

            // Restore zone update timestamps
            if (stored.data.zoneUpdates) {
                window.__lastZoneUpdate = stored.data.zoneUpdates;
            }

            // Restore finished riders
            if (stored.data.finishedRiders) {
                window.__finishedRiders = stored.data.finishedRiders;
                console.log(`✅ Restored ${Object.keys(window.__finishedRiders).length} finished riders`);
            }

            // Restore lap counts
            if (stored.data.lapCounts) {
                window.__lastLapCounts = stored.data.lapCounts;
            }

            return true;
        }

        return false;
    } catch (e) {
        console.error("Failed to load race data:", e);
        return false;
    }
}

// Save race data to storage
function saveRaceData() {
    try {
        const data = {
            routeId: window.__currentRouteId,
            timestamp: Date.now(),
            data: {
                powerZones: window.__riderPowerZones,
                zoneUpdates: window.__lastZoneUpdate,
                finishedRiders: window.__finishedRiders,
                lapCounts: window.__lastLapCounts
            }
        };

        localStorage.setItem(window.__raceDataStorageKey, JSON.stringify(data));
    } catch (e) {
        console.error("Failed to save race data:", e);
    }
}

// Clear race data (called when route changes)
function clearRaceData() {
    console.log("🗑️ Clearing race data for route change");
    window.__riderPowerZones = {};
    window.__lastZoneUpdate = {};
    window.__finishedRiders = {};
    window.__lastLapCounts = {};
    localStorage.removeItem(window.__raceDataStorageKey);
}

// Detect route/event changes
function detectRouteChange() {
    // Get route or event ID from URL
    let routeId = null;

    // Check if we're spectating (path-based ID)
    if (window.location.pathname.startsWith('/spectate/')) {
        const spectateId = window.location.pathname.split('/spectate/')[1];
        if (spectateId) {
            routeId = 'spectate_' + spectateId;
        }
    }
    // Check for ride with query parameters
    else if (window.location.pathname.startsWith('/ride')) {
        const urlParams = new URLSearchParams(window.location.search);

        if (urlParams.has('event')) {
            routeId = 'event_' + urlParams.get('event');
        } else if (urlParams.has('route')) {
            routeId = 'route_' + urlParams.get('route');
        }
    }

    // If we don't have a valid route ID, don't proceed
    if (!routeId) {
        console.log("⏳ Waiting for route ID... (current URL:", window.location.href, ")");
        return; // Wait until we have valid route data
    }

    if (routeId !== window.__currentRouteId) {
        if (window.__currentRouteId !== null) {
            console.log(`🔄 Route changed: ${window.__currentRouteId} → ${routeId}`);
            clearRaceData();
        } else {
            console.log(`🏁 Initial route detected: ${routeId}`);
        }

        window.__currentRouteId = routeId;
        loadRaceData();
    }
}
// Check for route changes periodically
setInterval(detectRouteChange, 2000);

// Initial route detection
detectRouteChange();

// Save data periodically (every 10 seconds)
setInterval(() => {
    if (window.__currentRouteId) {
        saveRaceData();
    }
}, 10000);

// Save on page unload
window.addEventListener('beforeunload', () => {
    if (window.__currentRouteId) {
        saveRaceData();
    }
});

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
    cache.failedFetches ||= {}; // Track riders with private profiles

    try {
        const res = await fetch(`/athletes/${athleteId}`, {
            credentials: "include"
        });

        // Handle 403 (private profile) - set default FTP and mark as failed
        if (res.status === 403) {
            console.log(`⚠️ Athlete ${athleteId} has a private profile, using default FTP (200W)`);

            const defaultFtp = 200;
            cache.riders[athleteId] = {
                ftp: defaultFtp,
                updated: new Date().toISOString().slice(0, 10),
                isDefault: true // Mark this as a default value
            };

            // Track this athlete for retry during monthly refresh
            cache.failedFetches[athleteId] = new Date().toISOString().slice(0, 10);

            saveFtpCache(cache);
            window.__athleteFtpMap[athleteId] = defaultFtp;
            return defaultFtp;
        }

        const html = await res.text();
        const ftp = extractFtpFromProfileHTML(html);

        if (!ftp) return null;

        cache.riders[athleteId] = {
            ftp,
            updated: new Date().toISOString().slice(0, 10)
        };

        // Remove from failed fetches if it was there (profile became public)
        if (cache.failedFetches && cache.failedFetches[athleteId]) {
            delete cache.failedFetches[athleteId];
        }

        cache.lastRefresh = new Date().toISOString().slice(0, 10);
        saveFtpCache(cache);

        window.__athleteFtpMap[athleteId] = ftp;
        return ftp;
    } catch (error) {
        console.warn(`Failed to fetch FTP for athlete ${athleteId}:`, error);
        return null;
    }
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
    cache.failedFetches ||= {};

    riders.forEach(r => {
        const id = r.riderId;
        // FIXED: Handle rider ID 0 properly
        if (id === undefined || id === null) return;

        // Skip fetching FTP for ego rider - we already have it from gameManager
        if (r.isMe && window.gameManager?.ego?.userData?.ftp) {
            window.__athleteFtpMap[id] = window.gameManager.ego.userData.ftp;
            return;
        }

        const riderCache = cache.riders[id];
        const isDefaultFtp = riderCache?.isDefault === true;
        const wasFailedFetch = cache.failedFetches && cache.failedFetches[id];
        const stale = !riderCache || shouldRefreshMonthly({ lastRefresh: riderCache.updated });

        // Load cached FTP immediately if available (including default FTP)
        if (cache.riders[id]?.ftp) {
            window.__athleteFtpMap[id] = cache.riders[id].ftp;
        }

        // Queue for refresh if:
        // 1. No FTP data exists
        // 2. Monthly refresh is due AND (it's a default FTP OR it was a failed fetch)
        const shouldQueue =
            window.__athleteFtpMap[id] === undefined ||
            (stale && (isDefaultFtp || wasFailedFetch));

        // FIXED: Use explicit check instead of truthy check
        if (shouldQueue && !window.__ftpQueue.includes(id)) {
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
                                console.log("🏁 TTT map keys (first 10):", Object.keys(window.__tttTeamMap).slice(0, 10));
                                console.log("🏁 TTT teams data:", teamsObj);
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
        // FIXED: Handle rider ID 0 properly
        if (riderId === undefined || riderId === null) {
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
            el.style.paddingTop = '0rem';
            el.style.paddingRight = '.4rem';
        }
    }).catch(() => {});
        waitFor(".view-toggle").then(el => {
        if(el) {
            el.style.paddingTop = '0rem';
            el.style.paddingRight = '.4rem';
        }

    }).catch(() => {});

    waitFor(".view-toggle button").then(el => {
        if(el && !el.classList.contains('latency')) {
            el.style.display = 'none';
        }
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

        /* Sticky group headers */
        .group-header-sticky {
            position: sticky;
            top: 20px;
            z-index: 10;
            background: rgba(255,255,255,0.15);
        }

        .finished-header-sticky {
            position: sticky;
            top: 20px;
            z-index: 10;
            background: rgba(50,205,50,0.3);
        }
        /* When a group header is hidden (content scrolled away), don't make it sticky */
        .group-header-sticky.hide-sticky,
        .finished-header-sticky.hide-sticky {
            position: relative;
            top: auto;
        }
        /* Hide sticky headers when their group content is not visible */
        .group-header-sticky.hide-sticky,
        .finished-header-sticky.hide-sticky {
            position: relative;
        }
    `;
    document.head.appendChild(style);

    // --- Manage sticky header visibility on scroll ---
    function manageStickyHeaders() {
        if (!scrollContainer) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const headers = scrollContainer.querySelectorAll('.group-header-sticky, .finished-header-sticky');

        headers.forEach(header => {
            // Find all rows belonging to this group (until next header or spacer)
            const groupRows = [];
            let currentRow = header.nextElementSibling;

            while (currentRow) {
                const onclick = currentRow.getAttribute('onclick');
                const style = currentRow.getAttribute('style');

                // Stop if we hit another header
                if (currentRow.classList.contains('group-header-sticky') ||
                    currentRow.classList.contains('finished-header-sticky')) {
                    break;
                }

                // Stop if we hit a spacer row
                if (style && (style.includes('height:4px') || style.includes('height:8px'))) {
                    break;
                }

                groupRows.push(currentRow);
                currentRow = currentRow.nextElementSibling;
            }

            // Check if any group rows are visible in the container
            let anyVisible = false;
            for (const row of groupRows) {
                const rowRect = row.getBoundingClientRect();

                // Check if row is visible within the scroll container
                if (rowRect.bottom > containerRect.top &&
                    rowRect.top < containerRect.bottom &&
                    row.style.display !== 'none') {
                    anyVisible = true;
                    break;
                }
            }

            // Hide sticky behavior if no content is visible
            if (!anyVisible) {
                header.classList.add('hide-sticky');
            } else {
                header.classList.remove('hide-sticky');
            }
        });
    }

    // --- HUD Container ---
    const container = document.createElement('div');
    container.id = 'rider-list-container';
    container.style.cssText = `
        position: fixed;
        top: 8px;
        right: 8px;
        width: 30vw;
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
                background:rgba(0,0,0,0.3);
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
        </div>
        <div style="flex: 1; overflow-y: auto; overflow-x: hidden;">
            <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                <colgroup>
                    <col style="width:40%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:10%;">
                    <col style="width:15%;">
                    <col style="width:5%;">
                </colgroup>
                <thead style="position: sticky; top: 0; background: rgba(0,0,0,0.5); z-index: 11;">
                    <tr style="text-align:left; color:#fff;">
                        <th style="padding:2px 2px 2px 10px;">Name</th>
                        <th style="padding:2px;">Power</th>
                        <th style="padding:2px;">Speed</th>
                        <th style="padding:2px;">W/kg</th>
                        <th style="padding:2px;">Gap</th>
                        <th style="padding:2px;">Dist</th>
                        <th style="padding:2px 10px 2px 2px;">Lap</th>
                    </tr>
                </thead>
                <tbody id="rider-table-body">
                    <tr><td colspan="7" style="text-align:center; color:#888; padding: 10px;">Waiting for breakpoint...</td></tr>
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

    // --- Auto-scroll state ---
    let lastManualScroll = 0;
    let autoScrollEnabled = true;
    const MANUAL_SCROLL_TIMEOUT = 5000; // 5 seconds

    // Get the scrollable container
    const scrollContainer = document.querySelector('#rider-list-container > div:last-child');

    // Detect manual scrolling
    if (scrollContainer) {
        scrollContainer.addEventListener('scroll', () => {
            // Only consider it manual scroll if auto-scroll isn't currently running
            if (!scrollContainer.dataset.isAutoScrolling) {
                lastManualScroll = Date.now();
                autoScrollEnabled = false;
            }
        });

        // Re-enable auto-scroll after timeout
        setInterval(() => {
            if (!autoScrollEnabled && Date.now() - lastManualScroll > MANUAL_SCROLL_TIMEOUT) {
                autoScrollEnabled = true;
            }
        }, 1000);
    }

    // Function to scroll to user's row
    function scrollToUserRow() {
        if (!autoScrollEnabled || !scrollContainer) return;

        // Find the user's row (has the red outline)
        const userRow = tbody.querySelector('tr[style*="outline: 2px solid #FF6262"]');
        if (!userRow) return;

        // Mark that we're auto-scrolling
        scrollContainer.dataset.isAutoScrolling = 'true';

        const containerRect = scrollContainer.getBoundingClientRect();
        const rowRect = userRow.getBoundingClientRect();

        // Calculate the center position
        const containerCenter = containerRect.top + (containerRect.height / 2);
        const rowCenter = rowRect.top + (rowRect.height / 2);
        const scrollOffset = rowCenter - containerCenter;

        // Smooth scroll to center the user's row
        scrollContainer.scrollBy({
            top: scrollOffset,
            behavior: 'smooth'
        });

        // Clear the auto-scrolling flag after animation completes
        setTimeout(() => {
            delete scrollContainer.dataset.isAutoScrolling;
        }, 500);
    }

    // Attach scroll listener for sticky headers
    if (scrollContainer) {
        scrollContainer.addEventListener('scroll', manageStickyHeaders);
    }

    // FIXED: Improved toggle function with immediate DOM manipulation
    window.toggleGroup = function(groupId) {
        const collapsedKey = groupId + '-collapsed';

        // Toggle the state
        if (expandedGroups.has(collapsedKey)) {
            expandedGroups.delete(collapsedKey);
        } else {
            expandedGroups.add(collapsedKey);
        }

        // IMMEDIATE visual feedback - find and toggle rows for this group
        const isExpanded = !expandedGroups.has(collapsedKey);
        const arrow = isExpanded ? '▲' : '▼';

        // Find the group header row by searching for the groupId in onclick attribute
        const allRows = tbody.querySelectorAll('tr');
        let groupHeaderRow = null;

        for (let i = 0; i < allRows.length; i++) {
            const row = allRows[i];
            const onclick = row.getAttribute('onclick');
            if (onclick && onclick.includes(`toggleGroup('${groupId}')`)) {
                groupHeaderRow = row;
                break;
            }
        }

        if (!groupHeaderRow) return;

        // Update arrow in header immediately
        const headerCell = groupHeaderRow.querySelector('td');
        if (headerCell) {
            const text = headerCell.innerHTML;
            headerCell.innerHTML = text.replace(/^[▲▼]/, arrow);
        }

        // Toggle visibility of subsequent rows until we hit another group header or separator
        let currentRow = groupHeaderRow.nextElementSibling;
        while (currentRow) {
            // Stop if we hit another group header (has onclick with toggleGroup or spectateGroupLeader)
            const onclick = currentRow.getAttribute('onclick');
            if (onclick && (onclick.includes('toggleGroup') || onclick.includes('spectateGroupLeader'))) {
                break;
            }

            // Stop if we hit the spacer row (height:4px or height:8px)
            const style = currentRow.getAttribute('style');
            if (style && (style.includes('height:4px') || style.includes('height:8px'))) {
                break;
            }

            // Toggle visibility
            if (isExpanded) {
                currentRow.style.display = '';
            } else {
                currentRow.style.display = 'none';
            }

            currentRow = currentRow.nextElementSibling;
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

        // FIXED: Stop interpolating if data is stale (rider has left)
        // If we haven't received new data in 5 seconds, freeze the position
        const MAX_STALE_TIME = 5000; // 5 seconds
        if (timeSinceUpdate > MAX_STALE_TIME) {
            // Data is stale - rider likely left, freeze position
            return interp.interpolatedDist;
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

    // --- Calculate time gap from distance gap ---
    function calculateTimeGap(distanceGapMeters, referenceSpeed, riderSpeed) {
        // Use average speed between the two riders for more accuracy
        const avgSpeed = (referenceSpeed + riderSpeed) / 2;

        // Avoid division by zero
        if (avgSpeed <= 0) return 0;

        // Time = Distance / Speed (speed is in m/s, distance in meters, result in seconds)
        return distanceGapMeters / avgSpeed;
    }

    // --- Format time gap for display ---
    function formatTimeGap(seconds) {
        const absSeconds = Math.abs(seconds);

        if (absSeconds < 1) {
            return "0s";
        } else if (absSeconds < 60) {
            return `${Math.round(absSeconds)}s`;
        } else {
            const mins = Math.floor(absSeconds / 60);
            const secs = Math.round(absSeconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
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

        // Build background color
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

        // FIXED: Handle rider ID 0 in onclick
        const onclickAttr = r.isMe ? "" : `onclick="window.spectateRiderById(${r.riderId})"`;

        return `
            <tr style="${rowStyle}" ${onclickAttr}>
                <td style="padding:4px 4px 4px 10px;font-size:13px; color:#fff;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${name}</td>
                <td style="padding:4px;font-size:13px;color:#fff; font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${power}</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${speed}</td>
                <td style="padding:4px;font-size:15px;color:${wkgColor}; font-weight:bold; font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${wkg}</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${gapText}</td>
                <td style="padding:4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${dist}m</td>
                <td style="padding:4px 10px 4px 4px;font-size:13px;color:#fff;font-family:Overpass Mono, monospace;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;">${r.lap}</td>
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
        // FIXED: Handle rider ID 0 properly
        if (!rider || !ftp || rider.riderId === undefined || rider.riderId === null) return;

        const riderId = rider.riderId;
        const now = Date.now();

        // Initialize tracking for this rider if not exists
        if (!window.__riderPowerZones[riderId]) {
            window.__riderPowerZones[riderId] = {
                z1: 0, z2: 0, z3: 0, ss: 0, z4: 0, z5: 0, z6: 0, z7: 0
            };
            console.log(`🎯 Initialized power zone tracking for rider ${riderId}`);
        }

if (window.__lastZoneUpdate[riderId] === undefined) {
        window.__lastZoneUpdate[riderId] = now;

        // Check if this is truly new or if we have existing zone data (from restoration)
        const hasExistingData = Object.values(window.__riderPowerZones[riderId]).some(v => v > 0);
        if (hasExistingData) {
            console.log(`📊 Restored power zone data for rider ${riderId}:`, window.__riderPowerZones[riderId]);
        } else {
            console.log(`⏱️ Starting zone timer for NEW rider ${riderId}`);
        }

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
        // FIXED: Handle rider ID 0 properly - use explicit undefined check
        if (riderId === undefined || riderId === null || !window.__riderPowerZones[riderId]) {
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
function autoFitTableText(tbody, options = {}) {
    const {
        minFontSize = 9,
        maxFontSize = 15,
        step = 0.5
    } = options;

    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
        const cells = row.children;
        if (!cells) return;

        [...cells].forEach(cell => {
            // Skip group headers / spacers
            if (cell.colSpan > 1) return;

            const style = window.getComputedStyle(cell);
            let fontSize = parseFloat(style.fontSize);

            // Reset first so shrinking is repeatable
            fontSize = Math.min(fontSize, maxFontSize);
            cell.style.fontSize = fontSize + 'px';

            // Shrink until it fits or we hit min size
            while (
                cell.scrollWidth > cell.clientWidth &&
                fontSize > minFontSize
            ) {
                fontSize -= step;
                cell.style.fontSize = fontSize + 'px';
            }
        });
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
            } else if (window.__athleteFtpMap[r.riderId] !== undefined) {
                ftp = window.__athleteFtpMap[r.riderId];
            }

            // Update tracking for this rider
            // FIXED: Explicit check for rider ID and power
            if (ftp && r.power && (r.riderId === 0 || r.riderId)) {
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
            const ungroupedRiders = [...activeRiders];

            // --- 1. Build TTT team groups FIRST (if TTT data is loaded) ---
            if (window.__tttDataLoaded) {
                const teamGroups = {};

                // Group riders by team - try multiple key formats
                activeRiders.forEach(r => {
                    const id = r.riderId;
                    // Try multiple formats: string, number, and both with/without type coercion
                    let teamName = window.__tttTeamMap[String(id)]
                                || window.__tttTeamMap[id]
                                || window.__tttTeamMap[String(id).toString()];

                    if (teamName) {
                        if (!teamGroups[teamName]) {
                            teamGroups[teamName] = [];
                        }
                        teamGroups[teamName].push(r);
                        console.log(`✅ Rider ${r.name} (ID: ${id}) assigned to TTT team: ${teamName}`);
                    } else {
                        // Debug: log riders that don't match
                        const mapKeys = Object.keys(window.__tttTeamMap);
                        if (mapKeys.length > 0) {
                            console.log(`❌ Rider ${r.name} (ID: ${id}, type: ${typeof id}) not found in TTT map. Map keys sample:`, mapKeys.slice(0, 3));
                        }
                    }
                });

                // Add team groups to main groups array and remove from ungrouped
                Object.entries(teamGroups).forEach(([teamName, teamRiders]) => {
                    if (teamRiders.length > 0) {
                        groups.push(teamRiders);
                        console.log(`🏁 Created TTT group: ${teamName} with ${teamRiders.length} riders`);
                        // Remove these riders from ungrouped list
                        teamRiders.forEach(tr => {
                            const idx = ungroupedRiders.findIndex(ur => ur.riderId === tr.riderId);
                            if (idx !== -1) ungroupedRiders.splice(idx, 1);
                        });
                    }
                });
            }

            // --- 2. Build distance-based groups from remaining riders ---
            // ONLY do distance-based grouping if this is NOT a TTT race
            // In TTT races, ALL riders should be in team groups, so skip distance grouping
            if (!window.__tttDataLoaded) {
                let currentGroup = [];
                ungroupedRiders.forEach((r, idx) => {
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
            } else {
                // In TTT races, if there are any ungrouped riders, create individual groups for them
                // (This handles edge cases where a rider might not be in the TTT data)
                ungroupedRiders.forEach(r => {
                    groups.push([r]);
                    console.log(`⚠️ Ungrouped rider in TTT race: ${r.name} (ID: ${r.riderId})`);
                });
            }

            // --- 3. Compute lead distance and lap for each group ---
            groups.forEach(g => {
                g.leadLap = Math.max(...g.map(r => r.lap));
                g.leadDist = Math.max(...g.map(r => r.lapDistance + (r.lap - 1) * globalLapLimit));
            });

            // --- 4. Sort groups by lap then distance, Identify Breakaway (front-most group) ---
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

                    // --- 5. Identify Peloton (largest group) ---
                    peloton = groups.reduce((max, g) => g.length > max.length ? g : max, groups[0]);

                    // --- 6. Ensure only 1 Peloton ---
                    if (breakaway.length > peloton.length) {
                        let temp = peloton;
                        peloton = breakaway;
                        breakaway = temp;
                    }
                }
            }

            // --- 7. Render Finished group first if there are finished riders ---
            if (finishedRiders.length > 0) {
                const groupId = 'group-finished';
                const isExpanded = !expandedGroups.has(groupId + '-collapsed');
                const arrow = isExpanded ? '▲' : '▼';

                html += `
                    <tr class="finished-header-sticky" style="cursor:pointer; font-family:'Overpass',sans-serif;"
                        onclick="event.stopPropagation(); window.toggleGroup('${groupId}');"
                        title="Click to expand/collapse">
                        <td colspan="7" style="padding:6px 10px; color:#fff; font-weight:bold;">
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

            // --- 8. Render active groups ---
            let chaseCounter = 1;
            let stragglersCounter = 1;

            groups.forEach((group, groupIdx) => {
                const groupSize = group.length;
                const avgSpeed = (group.reduce((sum, r) => sum + r.speed, 0) / groupSize * 3.6).toFixed(1);
                const groupId = `group-${groupIdx}`;
                const isExpanded = !expandedGroups.has(groupId + '-collapsed');

                // Calculate time gap for this group
                let groupTimeGap = "";
                if (groupIdx > 0) {
                    // Calculate distance gap to the front group
                    const frontGroup = groups[0];
                    const frontGroupLeadDist = frontGroup.leadDist;
                    const thisGroupLeadDist = group.leadDist;
                    const distGap = frontGroupLeadDist - thisGroupLeadDist;

                    // Use the average speed of both groups for time calculation
                    const frontGroupAvgSpeed = frontGroup.reduce((sum, r) => sum + r.speed, 0) / frontGroup.length;
                    const thisGroupAvgSpeed = group.reduce((sum, r) => sum + r.speed, 0) / group.length;
                    const avgSpeedBoth = (frontGroupAvgSpeed + thisGroupAvgSpeed) / 2;

                    const timeGap = calculateTimeGap(distGap, avgSpeedBoth, avgSpeedBoth);
                    groupTimeGap = ` +${formatTimeGap(timeGap)}`;
                }

                // Determine group label
                let groupLabel = "";

                // Check if this is a TTT team group
                const teamNames = new Set(
                    group
                        .map(r => window.__tttTeamMap[String(r.riderId)])
                        .filter(Boolean)
                );
                const isTTTTeam = window.__tttDataLoaded && teamNames.size === 1 && group.length > 1;

                if (isTTTTeam) {
                    groupLabel = [...teamNames][0];
                } else if (breakaway && group === breakaway) {
                    groupLabel = `Breakaway - ${groupSize} rider${groupSize>1?'s':''}`;
                } else if (peloton && group === peloton) {
                    groupLabel = `Peloton - ${groupSize} rider${groupSize>1?'s':''}`;
                } else if (breakaway && peloton && group.leadDist < breakaway.leadDist && group.leadDist > peloton.leadDist) {
                    groupLabel = `Chase Group ${chaseCounter++} - ${groupSize} rider${groupSize>1?'s':''}`;
                } else {
                    groupLabel = `Stragglers ${stragglersCounter++} - ${groupSize} rider${groupSize>1?'s':''}`;
                }

                const arrow = isExpanded ? '▲' : '▼';

                // Always show group header with sticky positioning
                html += `
                    <tr class="group-header-sticky" style="cursor:pointer; font-family:'Overpass',sans-serif;text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px #000;"
                        onclick="if(event.ctrlKey) { window.spectateGroupLeader(${groupIdx}); } else { event.stopPropagation(); window.toggleGroup('${groupId}'); }"
                        title="Click to expand/collapse, Ctrl+Click to spectate leader">
                        <td colspan="7" style="padding:6px 10px; color:#fff; font-weight:bold;">
                            ${arrow} ${groupLabel} (${avgSpeed} kph)${groupTimeGap}
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
            // Individual view - sort all riders (active + finished) normally by position
            const allRiders = [...activeRiders, ...finishedRiders];

            // Sort by lap and distance (finished riders will naturally be at top since they're on lap+1)
            allRiders.sort((a, b) => {
                if (b.lap !== a.lap) return b.lap - a.lap;
                return b.lapDistance - a.lapDistance;
            });

            allRiders.forEach(r => {
                const isFinished = window.__finishedRiders[r.riderId] !== undefined;
                html += renderRiderRow(r, referenceRiderId, referenceLap, referenceDist, gm, ego, focalRiderObj, globalLapLimit, isFinished);
            });
        }

        tbody.innerHTML = html;
        autoFitTableText(tbody, {
    minFontSize: 9,
    maxFontSize: 15,
    step: 0.5
});

        // Update sticky header visibility after render
        manageStickyHeaders();

        // Auto-scroll to user's row if enabled
        scrollToUserRow();


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
