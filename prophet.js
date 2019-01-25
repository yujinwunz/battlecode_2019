import {BCAbstractRobot, SPECS} from 'battlecode';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as _turtle from 'turtle.js';

function reflex(game, steps, matrix, enemies, predators, prey, blindspot, friends) {
    // Shoot first
    if (prey.length) {
        var target = utils.argmax(prey, r => utils.threat_level(game, r));
        return [game.attack(target.x - game.me.x, target.y - game.me.y), null];
    }
    
    // Don't move from blindspot. We are always in lattice.

    return [null, null];
}


export function protect(game, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail) {
   throw "not implemented"; 
}

export function attack(game, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail) {
    game.log("attack turn");

    // attack anything in sight first
    if (prey.length) {
        var tohit = utils.argmax(prey, f => utils.threat_level(game, f));
        if (tohit) {
            return [game.attack(tohit.x-game.me.x, tohit.y-game.me.y), null];
        }
    }

    // Check blind spot if we've reached the target
    if (utils.dist(target, [game.me.x, game.me.y]) < SPECS.UNITS[game.me.unit].VISION_RADIUS/2) {
        if (blindspot.length) {
            // Move away from that
            var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, 
                [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].SPEED, (x, y) => {

                    if (game.map[y][x] === false) return null;
                    if (utils.robots_collide(friends, [x, y])) return null;
                    if (utils.robots_collide(enemies, [x, y])) return null;
                    
                    var mindist = (1<<30);
                    blindspot.forEach(f => {
                        mindist = Math.min(mindist, utils.dist([f.x, f.y], [x, y]));
                    });
                    return mindist; // be as far away as any blind spot possible.
                    // We are attacking and clearing so we don't care if we step into range.
                    // We also wouldn't be able to tell.
            });
            if (nx !== null && (nx !== game.me.x || nx !== game.me.y)) {
                return [game.move(nx-game.me.x, ny-game.me.y), null];
            }
        }
    }

    // If we've reached the target then we must be all clear by now, so this path is
    // impossible. So... we must be pretty far.
    game.log("voyaging");
    var [nx, ny] = nav.path_step(target_trail, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].SPEED, friends.concat({x:target[0],y:target[1]})); // don't step on the target 
    if (nx !== null && (nx !== game.me.x || ny !== game.me.y)) {
        game.log("Moving to " + nx + " " + ny + " im at " + game.me.x + " " + game.me.y);
        return [game.move(nx - game.me.x, ny - game.me.y), null];
    }

    return [null, null];
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
