import {BCAbstractRobot, SPECS} from 'battlecode';
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

export function attack() {
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
