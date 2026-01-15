// ============================================================================
// PRIMARY BREAKPOINT – Network rider feed
// ============================================================================

window.__netHumans ??= new Map();
window.__lastPrimaryBreakpoint = Date.now();

if (this.humansList && this.humansList.length) {
    for (const r of this.humansList) {
        const id = r.athleteId || r.id;
        window.__netHumans.set(id, r);
    }
}

false;
