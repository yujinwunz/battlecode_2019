import {BCAbstractRobot, SPECS} from 'battlecode';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as _turtle from 'turtle.js';

var first_location = [null, null];

const IDEAL_CASTLE_DIST = 5;

function kite(game, steps, enemies, friends) {
    game.log("zooming out");
    // we have something inside our eye and we are not backed up. We need to move.
    var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
        if (game.map[y][x] === false) return null;
        if (utils.robots_collide(friends, [x, y])) return null;
        var attacked = false;
        enemies.forEach(e => {
            if (utils.in_fire_range(e.unit, utils.dist([e.x, e.y], [x, y]))) attacked = true;
        });
        if (attacked) return null;

        var mindist = (1<<30);
        enemies.forEach(e => mindist = Math.min(mindist, utils.dist1([e.x, e.y], [x, y])));
        var castledist_penalty = utils.dist1([x, y], first_location);
        castledist_penalty = Math.abs(castledist_penalty - IDEAL_CASTLE_DIST);
        if (utils.on_our_side(game, [x, y], first_location)) castledist_penalty += 0.2*utils.depth_dist(game, [x, y], first_location);
        return mindist + castledist_penalty;
    });

    if (nx !== null && (nx !== game.me.x || ny != game.me.y)) {
        game.log("moving to " + nx + " " + ny + " " + game.me.x + " " + game.me.y);
        return [game.move(nx-game.me.x, ny-game.me.y), null];
    }
    game.log("no good zooming location");
    return [null, null];
}

function reflex(game, steps, matrix, enemies, predators, prey, blindspot, friends) {
    if (first_location[0] === null) first_location = [game.me.x, game.me.y];

    var action = null, msg = null;

    var attacked_by_preacher = false;
    enemies.forEach(e => {
        if (e.unit === SPECS.PREACHER && utils.in_fire_range(e.unit, utils.dist([e.x, e.y], [game.me.x, game.me.y]))) {
            attacked_by_preacher = true;
        }
    });
    if (attacked_by_preacher) {
        var [action, msg] = kite(game, steps, enemies, friends);
    }

    // Move outta da way
    if (blindspot.length) {
        if (friends.length <= 20) {
            var [action, msg] = kite(game, steps, enemies, friends);
        }
    }
    // Shoot next
    if (prey.length && !action && !msg) {
        var target = utils.argmax(prey, r => utils.threat_level(game, r));
        var [action, msg] = [game.attack(target.x - game.me.x, target.y - game.me.y), null];
    }
    

    return [action, msg];
}


export function protect(game, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail) {
   throw "not implemented"; 
}

export function attack(game, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail) {
    var action = null, msg = null;
    var [action, msg] = reflex(game, steps, matrix, enemies, predators, prey, blindspot, friends);

    if (!action && !msg) {
        // Check blind spot always if we've reached the target
        if (utils.dist(target, [game.me.x, game.me.y]) < SPECS.UNITS[game.me.unit].VISION_RADIUS/2) {
            if (blindspot.length) {
                var [action, msg] = kite(game, steps, matrix, enemies, predators, prey, blindspot, friends);
            }
        }
    }

    if (!action && !msg) {
        // If we've reached the target then we must be all clear by now, so this path is
        // impossible. So... we must be pretty far.
        var [nx, ny] = nav.path_step(target_trail, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].SPEED, friends.concat({x:target[0],y:target[1]})); // don't step on the target 
        if (nx !== null && (nx !== game.me.x || ny !== game.me.y)) {
            var [action, msg] = [game.move(nx - game.me.x, ny - game.me.y), null];
        }
    }

    return [action, msg];
}

export function turtle(game, steps, matrix, enemies, predators, prey, blindspot, friends) {
    // Priority 1: reflex - attack anything in range, then back away from blindspot
    var action = null, msg = null;

    var [action, msg] = reflex(game, steps, matrix, enemies, predators, prey, blindspot, friends);

    // Priority 2: Turtling
    if (!action && !msg) {
        var [action, msg] = _turtle.turn(game, steps, matrix, enemies, friends);
    }

    return [action, msg];
}
