In Devtools->Sources.
For solo rides: Search for "this.riderController.update(x)" and go to that line.
For race/events: Search for "humanRiderPositions.set(o)" and go to that line.
Right-click on linenumber which in this case is just - and click "Add Conditional Breakpoint"
Paste the code below, change SET_YOUR_NAME to yourown name and hit enter

(if you do this you need to keep the console open for the data to update.)
You can also use Override/local-override but I havent tried that so ymmv
###################################################

// 1. Get the raw sources
const others = this.humansList || [];
const me = this.focalRider;

// 2. --- GUARANTEED ARRAY CREATION FIX ---
const allRiders = [];

if (me) {
    allRiders.push(me);
}

for (const rider of others) {
    if (rider !== me) {
        allRiders.push(rider);
    }
}
// -------------------------------------------------------------------

// 3. Expose game manager for spectating
window.gameManager = this.riderController || this;

// 4. Initialize global lap tracker (MUST be in the breakpoint to run reliably)
window.__lapTracker = window.__lapTracker || {};
const LAP_THRESHOLD = 1000; 
const INIT_DISTANCE_LIMIT = 100; // Ignore drops when distance is near the start

// 5. Get my distance
const myDistance = me ? me.currentPathDistance : 0;

// 6. Map riders
// 👇 FIX: Use optional chaining to safely access ego.userData, preventing crash if spectating
const ef = window.gameManager.ego?.userData?.first_name || "";
const el = window.gameManager.ego?.userData?.last_name || "";

// Outside your map/loop, create a global object once
window.__totalDistMap = window.__totalDistMap || {};

window.hackedRiders = allRiders.map(r => {
    const c = r.config || {};
    const f = c.first_name || "";
    const l = c.last_name || "";
    let fullName = (f + " " + l).trim();

    if (!fullName && r === me) {
        fullName = (ef + " " + el).trim();
    }
    if (!fullName) fullName = "Unknown Rider";

    const watts = r.power || 0;
    const weightInGrams = c.weight || 103000; 
    const weightInKg = weightInGrams > 0 ? weightInGrams / 1000 : 103;
    const wkg = weightInKg > 0 ? watts / weightInKg : 0;
    const design = r.entity?.design || {};
    const hcolor = design.helmet_color;
    const scolor = design.skin_color;
    const path = r.currentPath;
    const pathID = path.id;

    const dist = r.currentPathDistance || 0;
    const riderId = r.athleteId || r.id; 

    // --- TOTAL DISTANCE TRACKING ---
    window.__totalDistMap = window.__totalDistMap || {};
    if (!window.__totalDistMap[riderId]) {
        window.__totalDistMap[riderId] = { total: 0, lastDist: dist };
    }
    let delta = dist - window.__totalDistMap[riderId].lastDist;
    if (delta < 0) delta = 0; // ignore resets
    window.__totalDistMap[riderId].total += delta;
    window.__totalDistMap[riderId].lastDist = dist;
    const totaldist = window.__totalDistMap[riderId].total;
    // ------------------------------

    // --- LAP TRACKER (unchanged) ---
    if (!window.__lapTracker[riderId]) {
        window.__lapTracker[riderId] = { lap: 1, lastDist: dist, isInitialized: false };
    }
    const tracker = window.__lapTracker[riderId];
    if (!tracker.isInitialized) {
        if (dist < INIT_DISTANCE_LIMIT && dist >= 0) {
            tracker.isInitialized = true;
            tracker.lastDist = dist;
        }
    } else {
        if (dist < tracker.lastDist - LAP_THRESHOLD) tracker.lap++;
        tracker.lastDist = dist;
    }
    const lapDistance = dist >= 0 ? dist : (dist + tracker.lastDist + LAP_THRESHOLD);

    return {
        name: fullName,
        dist: dist,
        lap: tracker.lap,
        lapDistance: lapDistance,
        totaldist: totaldist,       // <-- now available
        wkg: wkg,
        distanceFromMe: dist - myDistance,
        speed: r.speed,
        power: watts,
        isMe: r === me,
        riderId: riderId,
        helmet: hcolor,
        skin: scolor,
        pathID: pathID,
    };
});


false; // don't pause
