import {BCAbstractRobot, SPECS} from 'battlecode';
import * as utils from 'utils.js';
import * as nav from 'nav.js';

export const TURTLE_MIN_DIST = 9;

export function closest_visible_turtle(game, steps, enemies, friends) {
    var loc = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].VISION_RADIUS, (x, y) => {
        if (can_turtle(game, [x, y], enemies, friends)) return -utils.dist([x, y], [game.me.x, game.me.y]);
        else return null;
    });
    return loc;
}


// Can we STAY here? less computationally heavy
export function is_turtle(game, loc, friends) {
    if ((loc[0] + loc[1]) % 2) return false;;

    // Move away from the castle.
    if (game.karbonite_map[loc[1]][loc[0]]) return false;
    if (game.fuel_map[loc[1]][loc[0]]) return false;
    var tooclose = false;
    friends.forEach(r => {
        if (r.unit === SPECS.CASTLE || r.unit === SPECS.CHURCH) {
            if (utils.dist(loc, [r.x, r.y]) < TURTLE_MIN_DIST) tooclose = true;
        }
    });
    if (tooclose) return false;

    return true;
}

// Can we MOVE here?
export function can_turtle(game, loc, enemies, friends) {
    if ((loc[0] + loc[1]) % 2) return false; // the main one

    if (!game.map[loc[1]][loc[0]]) return false;
    if (utils.robots_collide(enemies, loc)) return false;
    if (utils.robots_collide(friends, loc)) return false;

    // Don't stand on resources or too close to interfere with pilgrims
    if (game.karbonite_map[loc[1]][loc[0]]) return false;
    if (game.fuel_map[loc[1]][loc[0]]) return false;
    var tooclose = false;
    var protecting = false;
    friends.forEach(r => {
        if (r.unit === SPECS.CASTLE || r.unit === SPECS.CHURCH) {
            if (utils.dist(loc, [r.x, r.y]) < TURTLE_MIN_DIST) tooclose = true;
            if (utils.dist(loc, [r.x, r.y]) < 64) protecting = true;
        }
    });
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

var dream_loc = null;
var dream_trail = null;
var last_turtle = [null, null];
var turtle_trail = null;

export function turn(game, steps, matrix, enemies, friends) {
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
        if (last_turtle[0] !== loc[0] || last_turtle[1] !== loc[1]) {
            turtle_trail = nav.build_map(game.map, loc, SPECS.UNITS[game.me.unit].SPEED, nav.GAITS.WALK);
            last_turtle = [loc[0], loc[1]];
        }
        trail = turtle_trail;
    }

    var [x, y] = nav.path_step(trail, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].SPEED, enemies.concat(friends));
    if (x !== null && (x !== game.me.x || y !== game.me.y)) {
        return [game.move(x - game.me.x, y - game.me.y), null];
    }
    return [null, null];
}
