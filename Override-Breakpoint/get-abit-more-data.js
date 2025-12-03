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

// 2. --- FIXED ARRAY CREATION ---
// Filter out the local player instance from the network list, 
// then add the local player back once (guaranteed visibility).
const filteredOthers = others.filter(rider => rider !== me);
const allRiders = me ? [me, ...filteredOthers] : filteredOthers;
// --- END FIXED ARRAY CREATION ---


// 3. Get local player's current distance for gap calculation
const myDistance = me ? me.currentPathDistance : 0;

// 4. Map the combined list to our clean format
window.hackedRiders = allRiders.map(r => {
    const c = r.config || {};
    
    // Combine names
    const f = c.first_name || "";
    const l = c.last_name || "";
    let fullName = (f + " " + l).trim();
    
    // If name is empty, assume it's the local player and use the fallback
    // Me = Change to your own name if you want to.
    if (!fullName && r === me) fullName = "Me";

    // --- BULLETPROOF W/KG CALCULATION ---
    const watts = r.power || 0;
    
    // Use the confirmed property: r.config.weight (in GRAMS)
    // Total Mass is calculated from network data for everyone.
    const weightInGrams = c.weight || 103000; // CHANGE THIS TO YOUR WEIGHT FOR ACCURATE W/KG Default to 75000 grams if config is missing
    const weightInKg = weightInGrams > 0 ? (weightInGrams / 1000) : 103; // CHANGE THIS TO YOUR WEIGHT FOR ACCURATE W/KG CONVERT GRAMS TO KG
    
    const wkg = weightInKg > 0 ? (watts / weightInKg) : 0;
    // ----------------------------------
   
    return {
        name: fullName || ("Rider " + (r.id || "?")),
        dist: r.currentPathDistance,
        wkg: wkg,
        distanceFromMe: r.currentPathDistance - myDistance,
        speed: r.speed,
        power: watts,
        isMe: (r === me)
    };
});

false; // Don't pause!
