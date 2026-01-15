// ============================================================================
// FALLBACK / PROCESSING BREAKPOINT – SOLO + GROUP (NO GHOST RIDERS, ADD NETWORK RIDERS)
// ============================================================================

// Init globals
window.hackedRiders ??= [];
window.__totalDistMap ??= {};
window.__riderMap ??= new Map();
window.__netHumans ??= new Map();

// Expose gameManager
window.gameManager = this.riderController ?? this;

// Timestamp
const now = Date.now();
const me = this.focalRider || this.ego;

// Name resolver
window.__resolveRiderName ??= function (rider, me) {
    if (rider.config?.first_name || rider.config?.last_name) {
        const n = `${rider.config.first_name || ""} ${rider.config.last_name || ""}`.trim();
        if (n) return n;
    }
    if (rider === me) {
        const ud = window.gameManager?.ego?.userData || {};
        const n = `${ud.first_name || ""} ${ud.last_name || ""}`.trim();
        if (n) return n;
    }
    return "Unknown Rider";
};

// --------------------------------------------------------------------
// 1️⃣ Build current riders from humansList + network humans
// --------------------------------------------------------------------
const ridersMap = new Map();

// Add humansList if present
if (this.humansList?.length) {
    for (const r of this.humansList) {
        const id = r.athleteId || r.id;
        ridersMap.set(id, r);
    }
}

// Add network riders from gameManager.humans
if (window.gameManager?.humans) {
    for (const r of Object.values(window.gameManager.humans)) {
        const id = r.athleteId || r.id;
        ridersMap.set(id, r);
    }
}

// Always add ego
if (me) {
    const id = me.athleteId || me.id;
    ridersMap.set(id, me);
}

// Build set of valid IDs
const validIds = new Set(ridersMap.keys());

// --------------------------------------------------------------------
// 2️⃣ Remove stale riders from __riderMap and __netHumans
// --------------------------------------------------------------------
for (const id of window.__riderMap.keys()) {
    if (!validIds.has(id)) {
        window.__riderMap.delete(id);
        window.__netHumans.delete(id);
    }
}

// --------------------------------------------------------------------
// 3️⃣ Update __netHumans with current network riders (exclude ego)
// --------------------------------------------------------------------
window.__netHumans.clear();
for (const r of ridersMap.values()) {
    if (r !== me) {
        const id = r.athleteId || r.id;
        window.__netHumans.set(id, r);
    }
}

// --------------------------------------------------------------------
// 4️⃣ Process each rider
// --------------------------------------------------------------------
for (const rider of ridersMap.values()) {
    const riderId = rider.athleteId || rider.id;
    const dist = rider.currentPathDistance || 0;
    const watts = rider.power || 0;
    const c = rider.config || {};
    const weightKg = (c.weight || 103000) / 1000;
    const wkg = weightKg > 0 ? watts / weightKg : 0;

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
// 5️⃣ Cleanup stale riders older than 3s (backup)
// --------------------------------------------------------------------
for (const [id, r] of window.__riderMap.entries()) {
    const isEgo = id === (me?.athleteId || me?.id);
    if (!isEgo && now - r._timestamp > 3000) {
        window.__riderMap.delete(id);
        window.__netHumans.delete(id);
    }
}

// --------------------------------------------------------------------
// 6️⃣ Publish hackedRiders
// --------------------------------------------------------------------
window.hackedRiders = [...window.__riderMap.values()];

false;
