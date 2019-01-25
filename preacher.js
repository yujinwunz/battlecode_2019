import {BCAbstractRobot, SPECS} from 'battlecode';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as _turtle from 'turtle.js';

function reflex(game, steps, matrix, enemies, predators, prey, friends) {
    // Shoot first
    if (prey.length) {
        var target = utils.argmax(prey, r => utils.threat_level(game, r));
        return [game.attack(target.x - game.me.x, target.y - game.me.y), null];
    }

    // Don't engage. You are endgame only. Doesn't matter had success.
    return [null, null];
}

export function attack(game, steps, matrix, enemies, predators, prey, friends, target, target_trail) {
    game.log("attack turn");

    // Attack
    var tohit = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], SPECS.UNITS[game.me.unit].ATTACK_RADIUS[1], (x, y) => {
        if (utils.adjacent([x, y], [game.me.x, game.me.y])) return null;
        if (x === game.me.x && y === game.me.y) return null;

        var score = null;
        enemies.forEach(r => {
            if (!("x" in r)) return;
            if (utils.adjacent([r.x, r.y], [x, y])) {
                if (game.me.team === r.team) score = score -1;
                else score = score+1;
            }
        });
        if (score <= 0) return null;
        return score;
    });

    if (tohit[0] !== null) {
        game.log("attacking " + tohit[0] + " " + tohit[1]);
        return [game.attack(tohit[0]-game.me.x, tohit[1]-game.me.y), null];
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

export function turtle(game, steps, matrix, enemies, predators, prey, friends) {
    // Priority 1: reflex - attack anything in range, then back away from blindspot
    var action = null, msg = null;

    var [action, msg] = reflex(game, steps, matrix, enemies, predators, prey, friends);

    // Priority 2: Turtling
    if (!action && !msg) {
        var [action, msg] = _turtle.turn(game, steps, matrix, enemies, friends);
    }

    return [action, msg];
}
