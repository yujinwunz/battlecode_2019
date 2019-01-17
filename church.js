import {BCAbstractRobot, SPECS} from 'battlecode';
import * as nav from 'nav.js';
import * as utils from 'utils.js';
import PQ from 'priorityqueue.js';
import {Message, decode} from 'message.js';
import * as messages from 'message.js';
import * as cutils from 'castleutils.js';

var last_seen = null;
var assignments = null;

var assigned_to = {};

var distmap_walk = null;
var distmap_jog = null;

var rows = null, cols = null;

const PILGRIM_ABANDON_BUFFER = 1.10;
const RESOURCE_MAX_R = 36;

const NEW_CASTLE_FUEL_THRESHOLD = 300;
const NEW_CASTLE_KARBONITE_THRESHOLD = 80;

var known_units = {};
var ongoing_expeditions = {};
var church_assignment = null;

// remember where we sent the last guy off to because we can only get his id
// on the next turn.
var last_target = null;

// How many turns after the last time we saw a pilgrim report back should we 
// assume it died and mark the resource expired?
function get_expiry(dist_t, isfuel) {
    var travel = dist_t;
    var mine = isfuel ? 100 / 10 : 20 / 2;
    return (travel + mine) * PILGRIM_ABANDON_BUFFER;
}

// Scan surrounding pilgrims who have returned, identify the guy we just created, and
// ack returning pilgrims.
function scan(game, steps) {
    game.log("scanning");
    var robots = game.getVisibleRobots();
    for (var i = 0; i < robots.length; i++) {
        var r = robots[i];
        if (!("x" in r)) {
            continue;
        }
        // Look for pilgrims that could have been from us
        if (r.unit !== SPECS.PILGRIM) continue;
        if ((r.x-game.me.x)*(r.x-game.me.x) + (r.y-game.me.y)*(r.y-game.me.y) > 10) continue;
        if (!("team" in r) || r.team !== game.me.team) continue;

        // Look for pilgrims that we might have last seen
        if (!assigned_to[r.id]) {
            game.log("assigned " + r.id + " to " + last_target + ". othertype " + r.unit);
            if (last_target) {
                assignments[last_target[1]][last_target[0]] = r.id;
                last_seen[last_target[1]][last_target[0]] = steps;
                assigned_to[r.id] = last_target;
                last_target = null;
            }
        } else {
            var [x, y] = assigned_to[r.id];
            game.log(r.id + " was already assigned to " + x + " " + y);
            last_seen[y][x] = steps;
        }
    }

    if (last_target !== null) {
        game.log("Error: just created a crusaider and sent him to " + last_target + " but he isn't found. Bug, or he just got killed. RIP");
        last_target = null;
    }
}

function get_closest_target(game, steps) {
    var kmap = game.karbonite_map;
    var fmap = game.fuel_map;

    var best_dist = [(1<<30), -1];
    var best_loc = [null, null];
    for (var x = 0; x < cols; x++) {
        for (var y = 0; y < rows; y++) {
            if ((x-game.me.x)*(x-game.me.x) + (y-game.me.y)*(y-game.me.y) > RESOURCE_MAX_R) continue;
            if (kmap[y][x] || fmap[y][x]) {
                if (!game.map[y][x]) {
                    game.log("Error: resource in unpassable square");
                    continue;
                }
                if (last_seen[y][x] == null || 
                    last_seen[y][x] + get_expiry(distmap_walk[y][x], fmap[y][x]) < steps) {
                    game.log("resource expired: " + y + " " + x + " " + last_seen[y][x]);
                    // Found an expired or unused resource
                    if (nav.distcmp(distmap_jog[y][x], best_dist) < 0) {
                        best_dist = distmap_jog[y][x];
                        best_loc = [x, y];
                    }
                }
            }
        }
    }

    return best_loc;
}

function on_birth(game, id) {
    game.log("birth " + id + " type " + cutils.unit_of_id[id]);
}

function on_msg(game, id, msg) {
    game.log("msg " + id + " " + msg + " unit_type " + cutils.unit_of_id[id]);
    var unit = cutils.unit_of_id[id];
    var x = msg >> messages.COORD_BITS;
    var y = msg & ((1<<messages.COORD_BITS)-1);
    if (!(id in known_units)) 
        known_units[id] = [unit, x, y];
}

function on_death(game, id) {
    game.log("death " + id);
    var unit = cutils.unit_of_id[id];
    delete known_units.id;
}

function make_church_assignments(game) {
    game.log("assigning");
    var castles = {};
    var existing_castles = [];
    Object.keys(known_units).forEach(i => {
        var [u, x, y] = known_units[i];
        if (u === SPECS.CASTLE) {
            castles[i] = nav.build_map(game.map, [x, y], 4, nav.GAITS.JOG);
            existing_castles.push([x, y]);
        }
    });

    var [churches, groups] = cutils.get_church_locations(game.map, game.karbonite_map, game.fuel_map, existing_castles, game);
    game.log(churches);
    game.log(groups);

    church_assignment = {};
    
    // For every church candidate, find its closest castle.
    churches.forEach(loc => {
        var bestDist = [(1<<30), 0];
        var bestid = null;
        Object.keys(castles).sort().forEach(i => { // sort so results are same in each castle
            var map = castles[i];
            var dist = map[loc[1]][loc[0]];
            if (dist != null && nav.distcmp(dist, bestDist) < 0) {
                bestDist = dist;
                bestid = i;
            }
        });

        if (!(bestid in church_assignment)) church_assignment[bestid] = [];
        church_assignment[bestid].push(loc);
    });

    church_assignment[game.me.id].sort((a, b) => // only my one should worry about distance. 
        nav.distcmp(distmap_jog[a[1]][a[0]], distmap_jog[b[1]][b[0]])
    );

    game.log("assignments");
    game.log(church_assignment);
}

function send_expedition(game, loc) {
    game.log("Sending expedition to " + loc[0] + " " + loc[1]);
}

export function turn(game, steps, is_castle = false) {
    game.log("I am a church/castle. fuel and karbs: " + game.fuel + " " + game.karbonite);
    rows = game.map.length;
    cols = game.map[0].length;
    var robots = game.getVisibleRobots();
    game.log("Number of robots: " + robots.length);
    game.log(robots);

    if (is_castle) {
        cutils.receive(
            robots, 
            a=>on_birth(game, a), 
            (a, b)=>on_msg(game, a, b), 
            a=>on_death(game, a)
        );
    }

    if (last_seen === null) {
        var start = new Date().getTime();
        assignments = utils.null_array(game.map[0].length, game.map.length);
        last_seen = utils.null_array(game.map[0].length, game.map.length);
        distmap_walk = nav.build_map(game.map, [game.me.x, game.me.y], 4, nav.GAITS.WALK);
        distmap_jog = nav.build_map(game.map, [game.me.x, game.me.y], 4, nav.GAITS.JOG);
        game.log("build maps took " + (new Date().getTime() - start));

        /*
        // just testing
        var [churches, groups] = cutils.get_church_locations(game.map, game.karbonite_map, game.fuel_map, []);
        var map = utils.null_array(cols, rows);
        for (var x = 0; x < cols; x++) {
            for (var y = 0; y < rows; y++) {
                map[y][x] = "";
                if (!game.map[y][x]) map[y][x] = "#";
                if (game.karbonite_map[y][x]) map[y][x] += "*";
                if (game.fuel_map[y][x]) map[y][x] += ".";
            }
        }
        for (var i = 0; i < churches.length; i++) {
            var [x, y] = churches[i];
            map[y][x] += "C";
        }
        utils.print_map(game, map);
        for (var i = 0; i < groups.length; i++) game.log(groups[i]);*/
    }

    scan(game, steps);

    var action = null;

    // Strat right now is to just build pilgrims for mining.
    if (game.karbonite >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_KARBONITE) {
        if (game.fuel >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_FUEL) {
            game.log("going to build pilgrim");
            // build it, smash it
            // Maintain a list of unclaimed resources and pick the closest one
            // to send our guy to.
            var [x, y] = get_closest_target(game, steps);
            if (x !== null) {
                last_target = [x, y];
                game.log("found closest target: " + x + " " + y);
                for (var i = 0; i < robots.length; i++) {
                    game.log(robots[i]);
                }
                var getthere = nav.build_map(game.map, [x, y], 4, nav.GAITS.JOG, robots); 
                var [nx, ny] = nav.path_step(getthere, [game.me.x, game.me.y], 3); // 3 signals 8-adjacent.
                game.log("next step: " + nx + " " + ny);
                if (nx === null) {
                    // We are completely blocked
                    game.log("can't build anything because we are blocked");
                } else {
                    var msg = new Message("pilgrim_assign_target", x, y);
                    game.log("creating new pilgram and assigning to " + x + " " + y);
                    game.log("Castle/church " + game.me.id + " sending message " + msg.encode());
                    game.log("building pilgrim (" + SPECS.PILGRIM + ") unit " + (nx-game.me.x) + " " + (ny-game.me.y));
                    
                    action = game.buildUnit(SPECS.PILGRIM, nx-game.me.x, ny-game.me.y);
                    game.signal(msg.encode(), 3);
                }
            } else game.log("couldn't find good target");
        }
    }

    if (is_castle && !action) {
        // Consider creating a church somewhere.
        if (game.karbonite >= NEW_CASTLE_KARBONITE_THRESHOLD 
            && game.fuel >= NEW_CASTLE_FUEL_THRESHOLD
            && steps >= 10) { // wait 5 turns so we know for sure where the castles are

            if (church_assignment === null) {
                make_church_assignments(game);
            }

            var my_churches = church_assignment[game.me.id];
            
            for (var i = 0; i < my_churches.length; i++) {
                var [x, y] = my_churches[i];
                var free = true;
                Object.keys(ongoing_expeditions).forEach(i => {
                    var [ox, oy] = ongoing_expeditions[j];
                    if (x === ox && y === oy) free = false;
                });
                Object.keys(known_units).forEach(i => {
                    var [ou, ox, oy] = known_units[i];
                    if (ou === SPECS.CHURCH && ox === x && oy === y) free = false;
                });

                if (free) {
                    action = send_expedition(game, my_churches[i]);
                    break;
                }
            }
        }

        
    }

    game.log("doing action " + action);
    return action;
}
