import {BCAbstractRobot, SPECS} from 'battlecode';
import * as utils from 'utils.js';
import * as nav from 'nav.js';

export const TURTLE_MIN_DIST = 9;
export const TURTLE_SHIELD_DIST = 5;
export const REFRAIN_BUFFER = 4;

var blocked = {};
// Stations don't change so we'll remember and persist these even when they go out
// of view - some edge cases are like that.
var nearby_stations = {};
var first_location = [null, null];

// Can we STAY here? less computationally heavy
function is_turtle(game, loc, friends) {
    if ((loc[0] + loc[1]) % 2) return false;;

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
    if (blocked[loc[0]*64+loc[1]]) return false;

    // Don't stand on resources or too close to interfere with pilgrims
    if (game.karbonite_map[loc[1]][loc[0]]) return false;
    if (game.fuel_map[loc[1]][loc[0]]) return false;
    var tooclose = false;
    var protecting = false;
    for (var l in nearby_stations) {
        var r = nearby_stations[l];
        if (utils.dist(loc, [r.x, r.y]) < TURTLE_MIN_DIST) tooclose = true;
        if (utils.dist(loc, [r.x, r.y]) < 64) protecting = true;
    }
    if (tooclose) return false;

    // Don't voluntarily go into enemy's fire unless it protects a castle/church.
    if (!protecting) {
        var dangerous = false;
        enemies.forEach(e => {
            if (utils.in_fire_range(e.unit, utils.dist([e.x, e.y], loc))) dangerous = true;
        });
        if (dangerous) return false;
    }
    return true;
}

// We want a forward facing turtle.
function turtlecost(game, steps, loc, enemies, friends) {
    var floc = utils.forward(game, first_location, TURTLE_SHIELD_DIST);
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

export function turn(game, steps, matrix, enemies, friends) {
    if (steps === 1) first_location = [game.me.x, game.me.y];
    prepare_turtle(game, [game.me.x, game.me.y], enemies, friends);
    if (is_turtle(game, [game.me.x, game.me.y], friends)) return [null, null];

    // Not turtle so find turtle
    var loc = closest_visible_turtle(game, steps, enemies, friends);

    var trail = null;
    if (loc[0] === null) {
        // if whole view is crystalized, go to random point on map not in view.
        var changed = false;
        var iters = 0;
        while ((iters < 100) && (dream_loc === null 
                    || utils.dist(dream_loc, [game.me.x, game.me.y]) <= SPECS.UNITS[game.me.unit].VISION_RADIUS)) {

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

    var [x, y] = nav.path_step(trail, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].SPEED, enemies.concat(friends));
    if (x !== null && (x !== game.me.x || y !== game.me.y)) {
        return [game.move(x - game.me.x, y - game.me.y), null];
    }
    return [null, null];
}
