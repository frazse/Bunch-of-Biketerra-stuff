// SMART BREAKPOINT - Place at humanRiderPositions.set(o)
// This will be the primary breakpoint when other riders are present

// Initialize globals
window.hackedRiders = window.hackedRiders || [];
window.__totalDistMap = window.__totalDistMap || {};
window.__riderMap = window.__riderMap || new Map();
window.__usingFallbackBreakpoint = false; // Track which breakpoint is active

// Expose game manager
if (this.ego || this.focalRider) {
    window.gameManager = this;
} else if (this.riderController) {
    window.gameManager = this.riderController;
}

// Check if we have other riders (humanRiderPositions context)
const hasOtherRiders = this.humansList && this.humansList.length > 0;

if (hasOtherRiders) {
    // We have other riders - use humanRiderPositions data for EVERYONE
    window.__usingFallbackBreakpoint = false;
    
    const me = this.focalRider || this.ego;
    const allRiders = [];
    
    if (me) allRiders.push(me);
    for (const r of this.humansList) {
        if (r !== me) allRiders.push(r);
    }
    
    // Process each rider
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
        
        // Use native lap tracking from Biketerra
        const lapCount = (rider.lapCount || 0) + 1;
        
        // Store in map with timestamp
        window.__riderMap.set(riderId, {
            name: fullName,
            dist: dist,
            lap: lapCount,
            lapDistance: dist >= 0 ? dist : 0,
            totaldist: window.__totalDistMap[riderId].total,
            wkg: wkg,
            speed: rider.speed,
            power: watts,
            isMe: rider === me,
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
}
// If no other riders, the fallback breakpoint will handle it

false;




// ============================================================================
// FALLBACK BREAKPOINT - Place at this.riderController.update(x)
// This will be used when you're alone in the race
// ============================================================================

// Initialize globals
window.hackedRiders = window.hackedRiders || [];
window.__totalDistMap = window.__totalDistMap || {};
window.__riderMap = window.__riderMap || new Map();
window.__usingFallbackBreakpoint = window.__usingFallbackBreakpoint !== undefined ? window.__usingFallbackBreakpoint : true;

// Expose game manager
if (this.riderController) {
    window.gameManager = this.riderController;
} else if (this.ego || this.focalRider) {
    window.gameManager = this;
}

// Check if we should use this fallback breakpoint
// Only use it if the main breakpoint hasn't run recently (no other riders present)
const now = Date.now();
const lastMainBreakpointUpdate = window.__riderMap.size > 0 
    ? Math.max(...Array.from(window.__riderMap.values()).map(r => r._timestamp))
    : 0;
const mainBreakpointIsActive = (now - lastMainBreakpointUpdate) < 1000;

if (!mainBreakpointIsActive) {
    // Main breakpoint isn't active - we're alone, use riderController data
    window.__usingFallbackBreakpoint = true;
    
    const me = this.focalRider || this.ego;
    
    if (me) {
        const c = me.config || {};
        const f = c.first_name || "";
        const l = c.last_name || "";
        let fullName = (f + " " + l).trim();
        
        if (!fullName) {
            const ef = window.gameManager?.ego?.userData?.first_name || "";
            const el = window.gameManager?.ego?.userData?.last_name || "";
            fullName = (ef + " " + el).trim() || "Unknown Rider";
        }
        
        const watts = me.power || 0;
        const weightInGrams = c.weight || 103000;
        const weightInKg = weightInGrams / 1000;
        const wkg = weightInKg > 0 ? watts / weightInKg : 0;
        
        const design = me.entity?.design || {};
        const dist = me.currentPathDistance || 0;
        const riderId = me.athleteId || me.id;
        
        // Total distance tracking
        if (!window.__totalDistMap[riderId]) {
            window.__totalDistMap[riderId] = { total: 0, lastDist: dist };
        }
        let delta = dist - window.__totalDistMap[riderId].lastDist;
        if (delta >= 0) {
            window.__totalDistMap[riderId].total += delta;
        }
        window.__totalDistMap[riderId].lastDist = dist;
        
        // Use native lap tracking from Biketerra
        const lapCount = (me.lapCount || 0) + 1;
        
        // Store in map with timestamp
        window.__riderMap.set(riderId, {
            name: fullName,
            dist: dist,
            lap: lapCount,
            lapDistance: dist >= 0 ? dist : 0,
            totaldist: window.__totalDistMap[riderId].total,
            wkg: wkg,
            speed: me.speed,
            power: watts,
            isMe: true,
            riderId: riderId,
            helmet: design.helmet_color,
            skin: design.skin_color,
            pathID: me.currentPath?.id,
            _timestamp: Date.now()
        });
        
        // Update the array
        window.hackedRiders = Array.from(window.__riderMap.values());
    }
}

false;
