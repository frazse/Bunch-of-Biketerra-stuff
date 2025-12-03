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
Configuration	r.config.weight	Rider Weight (kg)	Used to calculate Watts/kg


###################################################
/* PASTE THIS INTO THE CONDITIONAL BREAKPOINT BOX */
// 1. Get the list of other players
const others = this.humansList || [];

// 2. Get YOUR player (focalRider)
const me = this.focalRider;

// 3. Combine them into one array
const allRiders = me ? [me, ...others] : others;

// 4. Get local player's current distance and weight for calculations
const myDistance = me ? me.currentPathDistance : 0;
// We use 75kg as a default if the local player's weight isn't exposed.
const defaultWeight = me && me.config ? me.config.weight : 75; 

// 5. Map the combined list to our clean format
window.hackedRiders = allRiders.map(r => {
    const c = r.config || {};
    
    // Combine names
    const f = c.first_name || "";
    const l = c.last_name || "";
    let fullName = (f + " " + l).trim();
    
    // If name is empty, check if it's YOU
    if (!fullName && r === me) fullName = "ME (Local User)";

    // --- CALCULATIONS ---
    const watts = r.power || 0;
    const weight = c.weight || defaultWeight; // Use rider's weight, default to local player's weight
    const wkg = weight > 0 ? (watts / weight) : 0;

    return {
        name: fullName || ("Rider " + (r.id || "?")),
        dist: r.currentPathDistance,
        wkg: wkg, // W/kg
        distanceFromMe: r.currentPathDistance - myDistance, // Gap
        speed: r.speed,
        power: watts,
        x: r.position.x,
        z: r.position.z,
        isMe: (r === me)
    };
});

false;
