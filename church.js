import {BCAbstractRobot, SPECS} from 'battlecode';
import * as nav from 'nav.js';
import PQ from 'priorityqueue.js';
import {Message, decode} from 'message.js';

var last_seen = null;
var assignments = null;

var assigned_to = {};

var distmap_walk = null;
var distmap_jog = null;

var rows = null, cols = null;

const PILGRIM_ABANDON_BUFFER = 1.10;

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

export function turn(game, steps, is_castle = false) {
    game.log("fuel and karbs: " + game.fuel + " " + game.karbonite);
    rows = game.map.length;
    cols = game.map[0].length;

    if (last_seen === null) {
        var start = new Date().getTime();
        assignments = nav.null_array(game.map[0].length, game.map.length);
        last_seen = nav.null_array(game.map[0].length, game.map.length);
        game.log("build arrays took " + (new Date().getTime() - start));
        distmap_walk = nav.build_map(game.map, [game.me.x, game.me.y], 4, nav.GAITS.WALK);
        game.log("build walk map took " + (new Date().getTime() - start));
        distmap_jog = nav.build_map(game.map, [game.me.x, game.me.y], 4, nav.GAITS.JOG);
        game.log("build jog map took " + (new Date().getTime() - start));
        
        game.log("walk map: ");
        nav.printmap(game, distmap_walk);
        game.log("jog map: ");
        nav.printmap(game, distmap_jog);
        game.log("");
        game.log("print maps took " + (new Date().getTime() - start));
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
                var robots = game.getVisibleRobots();
                for (var i = 0; i < robots.length; i++) {
                    game.log(robots[i]);
                }
                var getthere = nav.build_map(game.map, [x, y], 4, nav.GAITS.JOG, robots); 
                for (var iy = Math.max(0, game.me.y - 10); iy < Math.min(rows, game.me.y + 11); iy++) {
                    var rep = "";
                    for (var ix = Math.max(0, game.me.x-10); ix < Math.min(cols, game.me.x+11); ix++) {
                        rep += getthere[iy][ix];
                        if (iy === game.me.y && ix === game.me.x) rep += "*";
                        else rep += " ";
                        while (rep.length % 10 != 8) rep += " ";
                    }
                    game.log(rep);
                }
                var [nx, ny] = nav.path_step(getthere, [game.me.x, game.me.y], 3); // 3 signals 8-adjacent.
                game.log("next step: " + nx + " " + ny);
                game.log("");
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

    game.log("doing action " + action);
    return action;
}
