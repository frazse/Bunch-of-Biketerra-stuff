// ============================================================================
// FALLBACK BREAKPOINT - Place at this.riderController.update(x)
// This handles solo rides AND takes over when others leave
// ============================================================================

// Initialize globals
window.hackedRiders = window.hackedRiders || [];
window.__totalDistMap = window.__totalDistMap || {};
window.__riderMap = window.__riderMap || new Map();
window.__lastPrimaryBreakpoint = window.__lastPrimaryBreakpoint || 0;
window.__lastFallbackBreakpoint = window.__lastFallbackBreakpoint || 0;

// Expose game manager
if (this.riderController) {
    window.gameManager = this.riderController;
} else if (this.ego || this.focalRider) {
    window.gameManager = this;
}

// Mark that fallback breakpoint ran
window.__lastFallbackBreakpoint = Date.now();

const now = Date.now();
const timeSincePrimary = now - window.__lastPrimaryBreakpoint;

// Use fallback breakpoint if:
// 1. Primary hasn't run in 1 second (we're alone), OR
// 2. We only have 0-1 riders in the map (transition to solo)
const shouldUseFallback = timeSincePrimary > 1000 || window.__riderMap.size <= 1;

if (shouldUseFallback) {
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
        
        // Clear map and add only our rider
        window.__riderMap.clear();
        
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
