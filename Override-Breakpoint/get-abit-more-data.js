In the file BJ3MmXx5.js
Search for "humanRiderPositions.set(o)"
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
/* PASTE THIS INTO THE CONDITIONAL BREAKPOINT BOX */
// 1. Get the list of other players
const others = this.humansList || [];
const me = this.focalRider;

// 2. --- DEDUPLICATION LOGIC ---
const filteredOthers = others.filter(rider => rider !== me);
const allRiders = me ? [me, ...filteredOthers] : filteredOthers;
// --------------------------------------------------

// 3. --- CRITICAL: EXPOSE GAME MANAGER FOR SPECTATING ---
window.gameManager = this;
// --------------------------------------------------

// 4. Get local player's current distance for gap calculation
const myDistance = me ? me.currentPathDistance : 0;

// 5. Map the combined list to our clean format
window.hackedRiders = allRiders.map(r => {
    const c = r.config || {};
    
    // Combine names
    const f = c.first_name || "";
    const l = c.last_name || "";
    let fullName = (f + " " + l).trim();
    
    if (!fullName && r === me) fullName = "ME (Local User)";

    // --- CALCULATIONS ---
    const watts = r.power || 0;
    const weightInGrams = c.weight || 103000;
    const weightInKg = weightInGrams > 0 ? (weightInGrams / 1000) : 103;
    const wkg = weightInKg > 0 ? (watts / weightInKg) : 0;
    


    return {
        name: fullName || ("Rider " + (r.athleteId || "?")),
        dist: r.currentPathDistance,
        wkg: wkg,
        distanceFromMe: r.currentPathDistance - myDistance,
        speed: r.speed,
        power: watts,
        isMe: (r === me),
        
        // CRITICAL: Use athleteId for spectating
        riderId: r.athleteId 
    };
});

false; // Don't pause!
