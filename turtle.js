import {BCAbstractRobot, SPECS} from 'battlecode';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as macro from 'macro.js';

export const TURTLE_MIN_DIST = 9;
export const TURTLE_SHIELD_DIST = 6;
export const REFRAIN_BUFFER = 2;

var blocked = {};
// Stations don't change so we'll remember and persist these even when they go out
// of view - some edge cases are like that.
var nearby_stations = {};
var first_location = [null, null];

function get_blocked(game, loc) {
    return (!game.map[loc[1]] || !game.map[loc[1]][loc[0]] || (loc[0]*64+loc[1]) in blocked);
}

// Can we STAY here? less computationally heavy
function is_turtle(game, steps, loc, friends) {
        // at opening. Expanding lattice.
        if ((loc[0] + loc[1]) % 2) return false;

    /*
        if ((loc[0] + loc[1]) % 2) {
            game.log("midgame lattice considering " + loc[0] + " " + loc[1]);

            //iif (loc[0] === 0 || loc[0] === game.map[0].length-1) return true;
            //if (loc[1] === 0 || loc[1] === game.map.length-1) return true;

            // At lategame. Form crystals with my automata.
            // Assume we are going up. If we have this:
            //
            //     * * * *       * * *
            //* * * * * * * * * * * * * * *
            // * * * * * * * * * * * * * * *
            //* * * * * * * * * * * * * * *
            // 
            // We want this:
            //
            //     *******       *****
            //***** * * * *****************
            // * * * * * * *** ***** * * * *
            //* * * * * * * * * * * * * * *
            //
            //SO in addition to normal lattice, we need

            var tl = get_blocked(utils.forward(game, loc, [-1, 1]));
            var tr = get_blocked(utils.forward(game, loc, [1, 1]));
            var t = get_blocked(utils.forward(game, loc, [0, 1]));
            var l = get_blocked(utils.forward(game, loc, [-1, 0]));
            var ll = get_blocked(utils.forward(game, loc, [-2, 0]));
            var r = get_blocked(utils.forward(game, loc, [1, 0]));
            var rr = get_blocked(utils.forward(game, loc, [2, 0]));

            game.log(tl + " " + t + " " + tr + "; " + ll + " " + l + " me " + r + " " + rr);

            if (!tl && !tr && !t) {
                // ok
            } else if (!tl + !tr + !t == 2) {
                if (!(!l && !ll) && !(!r && !rr)) return false; 
            } else if (tl && tr && t) {
                if (l || r) return false;
            }
        }
    }*/

    // Move away from the castle.
    if (game.karbonite_map[loc[1]][loc[0]]) return false;
    if (game.fuel_map[loc[1]][loc[0]]) return false;
    var tooclose = false;
    for (var l in nearby_stations) {
        var r = nearby_stations[l];
        if (utils.dist(loc, [r.x, r.y]) < TURTLE_MIN_DIST) tooclose = true;
    }
    if (tooclose) return false;

    return true;
}

// Some things should be precomputed to make multiple calls to can_turtle much faster
function prepare_turtle(game, loc, enemies, friends) {
    friends.forEach(r => {
        if (r.unit === SPECS.CASTLE || r.unit === SPECS.CHURCH) nearby_stations[r.x*64+r.y] = r;
    });
    blocked = {};
    enemies.concat(friends).forEach(r => {
        blocked[r.x*64+r.y] = true;
    });
}

// Can we MOVE here?
function can_turtle(game, loc, enemies, friends) {
    if ((loc[0] + loc[1]) % 2) return false; // the main one

    if (!game.map[loc[1]][loc[0]]) return false;
    if ((loc[0]*64+loc[1]) in blocked) return false;

    // Don't stand on resources or too close to interfere with pilgrims
    if (game.karbonite_map[loc[1]][loc[0]]) return false;
    if (game.fuel_map[loc[1]][loc[0]]) return false;
    var tooclose = false;
    var protecting = false;
    for (var l in nearby_stations) {
        var r = nearby_stations[l];
        if (utils.dist(loc, [r.x, r.y]) < TURTLE_MIN_DIST) tooclose = true;
        if (utils.dist(loc, [r.x, r.y]) < 100) protecting = true;
    }
    if (tooclose) return false;

    return true;
}

// We want a forward facing turtle.
function turtlecost(game, steps, loc, enemies, friends) {
    var floc = utils.forward(game, first_location, TURTLE_SHIELD_DIST);
    if (game.me.unit === SPECS.CRUSADER) {
        // Crusaders hide backwards and are useless to the overall turtle strategy except unit health.
        floc = utils.forward(game, first_location, -1.5*TURTLE_SHIELD_DIST);
    }
    if (utils.on_our_side(game, utils.forward(game, loc, -REFRAIN_BUFFER))) {
        // If we started in our territory, 90% of the time it's better to form a wall slightly in front of you
        if (game.symmetry === utils.VERTICAL) return Math.abs(floc[0] - loc[0]);
        else return Math.abs(floc[1] - loc[1]);
    } else if (utils.on_our_side(game, loc, floc)) {
        // If we started on enemy territory, we need to expand in all directions
        return 0;
    }
    return 0;
}

function closest_visible_turtle(game, steps, enemies, friends) {
    var loc = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].VISION_RADIUS, (x, y) => {
        if (can_turtle(game, [x, y], enemies, friends)) return -Math.sqrt(utils.dist([x, y], [game.me.x, game.me.y])) - turtlecost(game, steps, [x, y], enemies, friends);
        else return null;
    });
    return loc;
}

var dream_loc = null;
var dream_trail = null;
var turtle_trail = {};

var last_trail = null;

export function turn(game, steps, matrix, enemies, friends) {
    var start = new Date().getTime();
    if (steps === 1) first_location = [game.me.x, game.me.y];
    prepare_turtle(game, [game.me.x, game.me.y], enemies, friends);
    if (is_turtle(game, steps, [game.me.x, game.me.y], friends)) return [null, null];

    var trail = last_trail;
    if (trail === null || steps%3 === 1) {
        // Not turtle so find turtle
        var loc = closest_visible_turtle(game, steps, enemies, friends);

        var trail = null;
        if (loc[0] === null) {
            // if whole view is crystalized, go to random point on map not in view.
            var changed = false;
            var iters = 0;

            while (iters < 100) {
                var ok = true;
                if (dream_loc === null) ok = false;
                else {
                    if (utils.dist(dream_loc, [game.me.x, game.me.y]) <= SPECS.UNITS[game.me.unit].VISION_RADIUS) ok = false;
                    if (game.me.unit === SPECS.CRUSADER) {
                        // Crusaders dream to go backwards
                        if (!utils.on_our_side(game, dream_loc, [game.me.x, game.me.y])) ok = false;
                    }
                }
                if (ok) break;

                iters++;
                dream_loc = [Math.floor(Math.random()*game.map.length), Math.floor(Math.random()*game.map[0].length)];
                changed = true;
            }

            if (changed) {
                dream_trail = nav.build_map(game.map, dream_loc, SPECS.UNITS[game.me.unit].SPEED, nav.GAITS.WALK);
            }
            trail = dream_trail;
        } else {
            if (!(loc[0]*64+loc[1] in turtle_trail)) {
                turtle_trail[loc[0]*64+loc[1]] = nav.build_map(game.map, loc, SPECS.UNITS[game.me.unit].SPEED, nav.GAITS.WALK);
            }
            trail = turtle_trail[loc[0]*64+loc[1]];
        }
        last_trail = trail;
    }

    var [x, y] = nav.path_step(trail, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].SPEED, enemies.concat(friends));
    if (x !== null && (x !== game.me.x || y !== game.me.y)) {
        return [game.move(x - game.me.x, y - game.me.y), null];
    }
    return [null, null];
}
