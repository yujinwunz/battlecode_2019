import {BCAbstractRobot, SPECS} from 'battlecode';
import * as nav from 'nav.js';
import * as utils from 'utils.js';
import PQ from 'priorityqueue.js';
import {Message, decode} from 'message.js';
import * as messages from 'message.js';
import * as cutils from 'castleutils.js';

var assignments = null;

var assigned_to = {};

//var distmap_walk = null;
var distmap_jog = null;

var rows = null, cols = null;
var first_pilgrim = true;

var building_backlog = [];
var backup_requested = false;

const PILGRIM_ABANDON_BUFFER = 1.10;
const RESOURCE_MAX_R = 36;

const NEW_CASTLE_FUEL_THRESHOLD = 500;
const NEW_CASTLE_KARBONITE_THRESHOLD = 120;

const MAX_FARM_DIST = 5;

var known_units = {};
// var ongoing_expeditions = {}; // Merged with assigned_to.
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
                assigned_to[r.id] = last_target;
                last_target = null;
            }
        } else {
            var [x, y] = assigned_to[r.id];
            game.log(r.id + " was already assigned to " + x + " " + y);
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
                if (assignments[y][x] === null) {
                    game.log("resource expired: " + y + " " + x);
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
    if (id in assigned_to) {
        game.log("removing assignment for " + id + " to " + assigned_to[id][0] + " " + assigned_to[id][1]);
        assignments[assigned_to[id][1]][assigned_to[id][0]] = null;
        game.log(assigned_to);
        delete assigned_to[id];
        game.log(assigned_to);
    }
    var unit = cutils.unit_of_id[id];
    delete known_units[id];
}

function make_church_assignments(game) {
    game.log("assigning");
    game.log("known castles:");
    var castles = {};
    var existing_castles = [];
    Object.keys(known_units).forEach(i => {
        var [u, x, y] = known_units[i];
        if (u === SPECS.CASTLE) {
            castles[i] = nav.build_map(game.map, [x, y], 4, nav.GAITS.JOG);
            existing_castles.push([x, y]);
        }
    });
    game.log(existing_castles);

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

// An expedition is just sending a pilgrim out like sending them out for resources.
// Only difference: if it dies we do remove it from current expeditions.
function send_expedition(game, loc) {
    game.log("Sending expedition to " + loc[0] + " " + loc[1]);

    var msg = new Message("pilgrim_build_church", loc[0], loc[1]);

    building_backlog.push([SPECS.CRUSADER, null, null]);
    building_backlog.push([SPECS.CRUSADER, null, null]);
    building_backlog.push([SPECS.PILGRIM, loc, msg]);

    return "BUILD";
}

function process_building_queue(game) {
    game.log("Clearing backlog");
    var robots = game.getVisibleRobots();
    var [unit, dest, msg] = building_backlog[0];
    if (msg) game.signal(msg.encode(), 3);
    
    var action = null;

    if (dest) {
        last_target = [dest[0], dest[1]];
        // Find free spot closest to target
        var getthere = nav.build_map(game.map, dest, 4, nav.GAITS.JOG, robots); 
        var [nx, ny] = nav.path_step(getthere, [game.me.x, game.me.y], 3); // 3 signals 8-adjacent.
        if (nx === null) game.log("can't build - caked in");
        action = game.buildUnit(unit, nx-game.me.x, ny-game.me.y);
    } else {
        // Find any spot
        for (var nx = Math.max(0, game.me.x-1); nx <= Math.min(cols-1, game.me.x+1); nx++) {
            for (var ny = Math.max(0, game.me.y-1); ny <= Math.min(rows-1, game.me.y+1); ny++) {
                if (nx === game.me.x && ny === game.me.y) continue;
                if (game.map[ny][nx] === false) continue;
                var collide = false;
                robots.forEach(r => {
                    if (r.x === nx && r.y === ny) collide = true;
                });
                if (!collide) action = game.buildUnit(unit, nx-game.me.x, ny-game.me.y);
            }
        }
    }

    if (action) {
        building_backlog.shift();
        return action;
    } else game.log("Could not build unit for whatever reason");
}

function get_attackable_enemies(game, robots) {
    var ret = [];
    robots.forEach(a => {
        if (!("unit" in a)) return;
        if (!("team" in a)) return;
        if (!("x" in a)) return;
        if (a.team == game.me.team) return;
        var dis = (game.me.x - a.x) * (game.me.x - a.x) + (game.me.y - a.y) * (game.me.y - a.y);
        if (dis <= SPECS.UNITS[SPECS.CASTLE].ATTACK_RADIUS[1]) ret.push(a);
    });
    return ret;
}

export function turn(game, steps, is_castle = false) {
    game.log("I am a church/castle. fuel and karbs: " + game.fuel + " " + game.karbonite);
    rows = game.map.length;
    cols = game.map[0].length;
    var robots = game.getVisibleRobots();
    game.log("Number of robots: " + robots.length);
    game.log(robots);


    var start = new Date().getTime();
    if (steps === 1) {
        assignments = utils.null_array(game.map[0].length, game.map.length);
        //distmap_walk = nav.build_map(game.map, [game.me.x, game.me.y], 4, nav.GAITS.WALK);
        distmap_jog = nav.build_map(game.map, [game.me.x, game.me.y], 4, nav.GAITS.JOG);
        game.log("build maps took " + (new Date().getTime() - start));
    }

    var action = null;
    scan(game, steps);

    if (is_castle) {
        cutils.receive(
            robots, 
            a=>on_birth(game, a), 
            (a, b)=>on_msg(game, a, b), 
            a=>on_death(game, a)
        );

    }

    if (building_backlog.length) {
        game.log("Processing backlog");
        action = process_building_queue(game);
        return action; // with a building queue it doesn't make sense to do other things.
                        // A sent squad is kinda atomic.
    }

    if (is_castle) {
        // Attack visible enemies
        var enemies = get_attackable_enemies(game, robots);
        game.log("enemies:");
        game.log(enemies);
        enemies.sort((a, b) => -(utils.threat_level(game, a) - utils.threat_level(game, b)));

        if (enemies.length) {
            game.log("attacking " + enemies[0].id);
            action = game.attack(enemies[0].x - game.me.x, enemies[0].y - game.me.y);
        }
    }

    game.log("Attacking animemes took " + (new Date().getTime() - start));

    if (action === null) { // so we're not able to fight the fight
    // Strat right now is to just build pilgrims for mining.
        if (game.karbonite >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_KARBONITE &&
            game.fuel >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_FUEL) {
            game.log("going to obtain resources");
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
                game.log("before build map for pilgrim took " + (new Date().getTime() - start));
                var getthere = nav.build_map(game.map, [x, y], 4, nav.GAITS.JOG, robots, MAX_FARM_DIST); 
                game.log("build map for pilgrim took " + (new Date().getTime() - start));
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
                    if (!first_pilgrim || is_castle) { // churches are built by a pilgram
                        // which would already be waiting for its instruction. So churches
                        // dont' have to build their first pilgram, just assume the guy's
                        // loyally there.
                        action = game.buildUnit(SPECS.PILGRIM, nx-game.me.x, ny-game.me.y);
                    }
                    first_pilgrim = false;
                    game.signal(msg.encode(), 3);
                }
            } else game.log("All resources are being mined");
        }
    }

    game.log("building pilgrims took " + (new Date().getTime() - start));

    if (is_castle && action === null) {
        // Consider building a church somewhere.
        if (game.karbonite >= NEW_CASTLE_KARBONITE_THRESHOLD 
            && game.fuel >= NEW_CASTLE_FUEL_THRESHOLD
            && steps >= 10) { // wait 5 turns so we know for sure where the castles are

            if (church_assignment === null) {
                make_church_assignments(game);
                game.log("Church assignments:");
                game.log(church_assignment);
            }

            var my_churches = church_assignment[game.me.id];
            if (!my_churches) my_churches = [];
            
            for (var i = 0; i < my_churches.length; i++) {
                var [x, y] = my_churches[i];
                var free = true;
                Object.keys(assigned_to).forEach(j => {
                    var [ox, oy] = assigned_to[j];
                    if (x === ox && y === oy) {
                        free = false;
                        game.log("cannot build church at " + x + " " + y + " since it's assigned to " + ox + " " + oy + " id " + j);
                    }
                });
                Object.keys(known_units).forEach(j => {
                    var [ou, ox, oy] = known_units[j];
                    if (ou === SPECS.CHURCH && ox === x && oy === y) {
                        free = false;
                        game.log("cannot build church at " + x + " " + y + " since we've got a unit at " + ox + " " + oy + " type " + ou + " id " + j);
                    }
                });

                if (free) {
                    action = send_expedition(game, my_churches[i]);
                    break;
                }
            }
        } 
    }

    if (action === "BUILD") {
        action = process_building_queue(game);
    }

    if (!backup_requested && !is_castle && !action && steps != 1) {
        // a pilgrim built us. We just booted. So we should ask the pilgrim's reinforcements
        // to cover us instead.
        game.log("Requesting backup");
        backup_requested = utils.call_for_backup(game, 2); 
        game.log("Result: " + backup_requested);
    }

    game.log("build church took " + (new Date().getTime() - start));
    game.log("doing action " + action);
    return action;
}
