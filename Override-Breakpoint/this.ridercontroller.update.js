// ============================================================================
// BIKETERRA DATA EXTRACTOR - ZERO-SAFE PATHID SYNC
// ============================================================================

try {
    window.gameManager = this.riderController || this.gameManager || window.gameManager || this;
    
    window.hackedRiders ??= [];
    window.__totalDistMap ??= {};
    window.__riderMap ??= new Map();
    
    const gm = window.gameManager;
    const ego = gm?.ego || this.ego;
    const now = Date.now();

    // 1️⃣ GRAB ALL POTENTIAL RIDERS
    const rawHumans = gm?.humanManager?.humans || {};
    const ridersToProcess = [];

    for (const id in rawHumans) {
        if (rawHumans[id]) ridersToProcess.push({ id: id, data: rawHumans[id] });
    }

    if (ego) {
        const egoId = ego.userData?.id || ego.athleteId || "ego";
        ridersToProcess.push({ id: egoId, data: ego, isMe: true });
    }

    // 2️⃣ PROCESS
    for (const entry of ridersToProcess) {
        try {
            const rider = entry.data;
            const state = rider.entity?.state || {};
            const isMe = entry.isMe || (rider === ego);
            
            // Identity
            const rId = isMe ? (ego.userData?.id || entry.id) : (rider.athleteId || entry.id);
            const ud = isMe ? (ego.userData || {}) : (rider.config || {});
            const design = rider.entity?.design || {};
            
            const rName = `${ud.first_name || ""} ${ud.last_name || ""}`.trim() || (isMe ? "Me" : `Rider ${rId}`);

            // Stats
            const dist = state.currentPathDistance ?? rider.currentPathDistance ?? 0;
            const watts = state.power ?? rider.power ?? 0;
            const weightGrams = isMe ? (ego.userData?.weight) : (rider.config?.weight);
            const wkg = weightGrams > 0 ? (watts / (weightGrams / 1000)) : (state.smoothWkg ?? 0);

            // --- ZERO-SAFE PATHID LOOKUP ---
            // Using ?? (Nullish Coalescing) instead of || (Logical OR)
            // This ensures that 0 is treated as a valid value and not skipped.
            const pId = state.currentPath?.id ?? rider.currentPath?.id ?? null;

            // Distance Tracking
            window.__totalDistMap[rId] ??= { total: 0, lastDist: dist };
            const t = window.__totalDistMap[rId];
            const delta = dist - t.lastDist;
            if (delta >= 0 && delta < 500) t.total += delta;
            t.lastDist = dist;

            // 3️⃣ UPDATE DATA MAP
            window.__riderMap.set(rId, {
                name: rName,
                dist,
                lap: (state.lapCount ?? rider.lapCount ?? 0) + 1,
                lapDistance: Math.max(0, dist),
                totaldist: t.total,
                wkg,
                speed: state.speed ?? rider.speed ?? 0,
                power: watts,
                ftp: isMe ? gm.userFtp : 0,
                cadence: state.cadence || 0,
                heartRate: state.heartRate || 0,
                isMe: isMe,
                riderId: rId,
                helmet: design.helmet_color,
                skin: design.skin_color,
                pathID: pId, // Now correctly returns 0 or 1
                _timestamp: now
            });
        } catch (e) { continue; }
    }

    // 4️⃣ CLEANUP & PUBLISH
    for (const [id, r] of window.__riderMap.entries()) {
        if (now - r._timestamp > 5000) window.__riderMap.delete(id);
    }

    window.hackedRiders = [...window.__riderMap.values()];

} catch (err) {
    console.error("Extractor Error:", err);
}

false;
