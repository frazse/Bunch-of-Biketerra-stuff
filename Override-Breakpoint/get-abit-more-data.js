In the file BJ3MmXx5.js
Search for "this.riderController.update(x)"
Right-click on linenumber which in this case is just - and click "Add Conditional Breakpoint"
Paste the code below, change SET_YOUR_NAME to yourown name and hit enter

(if you do this you need to keep the console open for the data to update.)

 Another alternative is to right-click BJ3MmXx5.js and use override content, aka we download and use a local copy of the javascript file.
In that file we;
Change this: humanRiderPositions.set(o)
To this: window.hackedRiders=this.humansList;humanRiderPositions.set(o)
Save the file and reload the page.
(I have not tried this so ymmv.)

 
This is what it should give you access to:

Identity	r.config.first_name, r.config.last_name	Name String	Player Name / "ME" flag
Performance	r.power	Raw Watts	Power Output
Physics	r.speed	Speed (m/s)	Used to calculate km/h
Position	r.currentPathDistance	Route Distance (meters)	Total distance traveled (for sorting)
Position	r.position.x, r.position.z	3D Coordinates	Location in the game world
Configuration	r.config.weight	Rider Weight (kg)	Used to calculate Watts/kg <- Other riders, not yours


###################################################
/* FINAL LOCATION-INDEPENDENT BREAKPOINT CODE */
/* FINAL, GUARANTEED BREAKPOINT CODE (V4.0 - FIXES STARTUP RESET) */
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
window.hackedRiders = allRiders.map(r => {
    const c = r.config || {};
    const f = c.first_name || "";
    const l = c.last_name || "";
    let fullName = (f + " " + l).trim();
    if (!fullName && r === me) fullName = "ME (Local User)";

    const watts = r.power || 0;
    const weightInGrams = c.weight || 103000; 
    const weightInKg = weightInGrams > 0 ? weightInGrams / 1000 : 103;
    const wkg = weightInKg > 0 ? watts / weightInKg : 0;

    const dist = r.currentPathDistance || 0;
    const riderId = r.athleteId || r.id; 

    // Initialize rider lap tracker
    if (!window.__lapTracker[riderId]) {
        window.__lapTracker[riderId] = {
            lap: 1,
            lastDist: dist,
            // FIX: Set to true once we pass the initial 'jump' phase
            isInitialized: false 
        };
    }

    const tracker = window.__lapTracker[riderId];
    
    // --- LAP TRACKING LOGIC ---
    if (!tracker.isInitialized) {
        // 1. On startup, check if the distance is stable (i.e., near zero or after a reset).
        if (dist < INIT_DISTANCE_LIMIT && dist >= 0) {
            tracker.isInitialized = true;
            tracker.lastDist = dist;
        }
    } else {
        // 2. Only track drops once initialized
        if (dist < tracker.lastDist - LAP_THRESHOLD) { 
            tracker.lap++;
        }
        // 3. Always update lastDist once tracking is active
        tracker.lastDist = dist;
    }
    
    // --- END LAP TRACKING LOGIC ---

    // Compute lap distance
    const lapDistance = dist >= 0 ? dist : (dist + tracker.lastDist + LAP_THRESHOLD); 

    return {
        name: fullName || ("Rider " + riderId),
        dist: dist,
        lap: tracker.lap,
        lapDistance: lapDistance,
        wkg: wkg,
        distanceFromMe: dist - myDistance,
        speed: r.speed,
        power: watts,
        isMe: r === me,
        riderId: riderId
    };
});

false; // don't pause
