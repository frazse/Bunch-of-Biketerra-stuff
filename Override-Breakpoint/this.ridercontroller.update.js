


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
const lastMainBreakpointUpdate = window.__riderMap.size > 1 
    ? Math.max(...Array.from(window.__riderMap.values()).map(r => r._timestamp))
    : 0;
const mainBreakpointIsActive = (now - lastMainBreakpointUpdate) < 2000; // Increased to 2 seconds

// ONLY run fallback if we have 1 or fewer riders (solo mode)
if (!mainBreakpointIsActive && window.__riderMap.size <= 1) {
    // Main breakpoint isn't active AND we're alone - use riderController data
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
