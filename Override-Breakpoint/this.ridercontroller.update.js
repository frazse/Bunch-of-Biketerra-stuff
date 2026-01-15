// ============================================================================
// FALLBACK / PROCESSING BREAKPOINT – Solo + Group (FIXED)
// ============================================================================

// --------------------------------------------------------------------
// Init globals
// --------------------------------------------------------------------
window.hackedRiders ??= [];
window.__totalDistMap ??= {};
window.__riderMap ??= new Map();
window.__netHumans ??= new Map();
window.__lastPrimaryBreakpoint ??= 0;

// Expose gameManager
window.gameManager = this.riderController ?? this;

// Timestamp
const now = Date.now();

// Resolve ego
const me = this.focalRider || this.ego;

// --------------------------------------------------------------------
// Name resolver (DECLARE ONCE – breakpoint safe)
// --------------------------------------------------------------------
window.__resolveRiderName ??= function (rider, me) {
    // Network riders
    if (rider.config?.first_name || rider.config?.last_name) {
        const n = `${rider.config.first_name || ""} ${rider.config.last_name || ""}`.trim();
        if (n) return n;
    }

    // Ego
    if (rider === me) {
        const ud = window.gameManager?.ego?.userData || {};
        const n = `${ud.first_name || ""} ${ud.last_name || ""}`.trim();
        if (n) return n;
    }

    return "Unknown Rider";
};

// --------------------------------------------------------------------
// Build rider list
// --------------------------------------------------------------------
let riders = [];

if (window.__netHumans.size) {
    riders = [...window.__netHumans.values()];
}

if (me && !riders.includes(me)) {
    riders.unshift(me);
}

if (!riders.length) {
    false;
}

// --------------------------------------------------------------------
// Process riders
// --------------------------------------------------------------------
for (const rider of riders) {
    const riderId = rider.athleteId || rider.id;
    const dist = rider.currentPathDistance || 0;
    const watts = rider.power || 0;
    const c = rider.config || {};

    const weightKg = (c.weight || 103000) / 1000;
    const wkg = weightKg > 0 ? watts / weightKg : 0;

    // Distance tracking
    window.__totalDistMap[riderId] ??= { total: 0, lastDist: dist };
    const t = window.__totalDistMap[riderId];

    const delta = dist - t.lastDist;
    if (delta >= 0) t.total += delta;
    t.lastDist = dist;

    const lap = (rider.lapCount || 0) + 1;

    window.__riderMap.set(riderId, {
        name: window.__resolveRiderName(rider, me),
        dist,
        lap,
        lapDistance: Math.max(0, dist),
        totaldist: t.total,
        wkg,
        speed: rider.speed,
        power: watts,
        isMe: rider === me,
        riderId,
        helmet: rider.entity?.design?.helmet_color,
        skin: rider.entity?.design?.skin_color,
        pathID: rider.currentPath?.id,
        _timestamp: now
    });
}

// --------------------------------------------------------------------
// Cleanup stale riders
// --------------------------------------------------------------------
for (const [id, r] of window.__riderMap.entries()) {
    if (now - r._timestamp > 3000) {
        window.__riderMap.delete(id);
        window.__netHumans.delete(id);
    }
}

// --------------------------------------------------------------------
// Publish
// --------------------------------------------------------------------
window.hackedRiders = [...window.__riderMap.values()];

false;
