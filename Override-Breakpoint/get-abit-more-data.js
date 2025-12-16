In Devtools->Sources.
For solo rides: Search for "this.riderController.update(x)" and go to that line.
For race/events: Search for "humanRiderPositions.set(o)" and go to that line.
Right-click on linenumber which in this case is just - and click "Add Conditional Breakpoint"

With this updated Breakpoint you can set both at the same time and it will work in solorides and races/events.
    
(if you do this you need to keep the console open for the data to update.)
You can also use Override/local-override but I havent tried that so ymmv
###################################################
// Initialize globals
window.hackedRiders = window.hackedRiders || [];
window.__totalDistMap = window.__totalDistMap || {};
window.__lapTracker = window.__lapTracker || {};
window.__riderMap = window.__riderMap || new Map();

// Expose game manager
if (this.riderController) {
    window.gameManager = this.riderController;
} else if (this.ego || this.focalRider) {
    window.gameManager = this;
}

// Get rider data from current context
let currentRider = null;
let allRiders = [];

// Check if we're in the riderController.update(x) context
if (typeof this.focalRider !== 'undefined' || typeof this.ego !== 'undefined') {
    const me = this.focalRider || this.ego;
    const others = this.humansList || [];
    
    if (me) allRiders.push(me);
    for (const r of others) {
        if (r !== me) allRiders.push(r);
    }
}

// Process each rider
const myDistance = (this.focalRider || this.ego)?.currentPathDistance || 0;

for (const rider of allRiders) {
    const c = rider.config || {};
    const f = c.first_name || "";
    const l = c.last_name || "";
    let fullName = (f + " " + l).trim();
    
    if (!fullName) {
        const ef = window.gameManager?.ego?.userData?.first_name || "";
        const el = window.gameManager?.ego?.userData?.last_name || "";
        fullName = (ef + " " + el).trim() || "Unknown Rider";
    }
    
    const watts = rider.power || 0;
    const weightInGrams = c.weight || 103000;
    const weightInKg = weightInGrams / 1000;
    const wkg = weightInKg > 0 ? watts / weightInKg : 0;
    
    const design = rider.entity?.design || {};
    const dist = rider.currentPathDistance || 0;
    const riderId = rider.athleteId || rider.id;
    
    // Total distance tracking
    if (!window.__totalDistMap[riderId]) {
        window.__totalDistMap[riderId] = { total: 0, lastDist: dist };
    }
    let delta = dist - window.__totalDistMap[riderId].lastDist;
    if (delta >= 0) {
        window.__totalDistMap[riderId].total += delta;
    }
    window.__totalDistMap[riderId].lastDist = dist;
    
    // Lap tracking
    if (!window.__lapTracker[riderId]) {
        window.__lapTracker[riderId] = { lap: 1, lastDist: dist, isInitialized: false };
    }
    const tracker = window.__lapTracker[riderId];
    if (!tracker.isInitialized && dist < 100 && dist >= 0) {
        tracker.isInitialized = true;
        tracker.lastDist = dist;
    } else if (tracker.isInitialized && dist < tracker.lastDist - 1000) {
        tracker.lap++;
    }
    tracker.lastDist = dist;
    
    // Store in map with timestamp
    window.__riderMap.set(riderId, {
        name: fullName,
        dist: dist,
        lap: tracker.lap,
        lapDistance: dist >= 0 ? dist : 0,
        totaldist: window.__totalDistMap[riderId].total,
        wkg: wkg,
        distanceFromMe: dist - myDistance,
        speed: rider.speed,
        power: watts,
        isMe: rider === (this.focalRider || this.ego),
        riderId: riderId,
        helmet: design.helmet_color,
        skin: design.skin_color,
        pathID: rider.currentPath?.id,
        _timestamp: Date.now()
    });
}

// Clean up stale riders (>3 seconds old)
const now = Date.now();
for (const [id, rider] of window.__riderMap.entries()) {
    if (now - rider._timestamp > 3000) {
        window.__riderMap.delete(id);
    }
}

// Update the array
window.hackedRiders = Array.from(window.__riderMap.values());

false;
