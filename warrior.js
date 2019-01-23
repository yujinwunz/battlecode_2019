import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';

export const PROTECTING = 0;
export const ATTACKING = 1;
export const TURTLING = 2; // Only used in lategame turtling. So not much strategy except fly off to opposite corners.

export function listen_orders(game, vipid) {
    var orders = [];
    game.getVisibleRobots().forEach(r => {
        if ("signal" in r) {
            if (r.signal != -1) {
                var msg = decode(r.signal, r, game.me.team);
                if (msg.type === "requesting_backup") {
                    orders.push(msg);
                } else if (msg.type === "attack") {
                    if (msg.sender.id === vipid) orders.push(msg);
                }
            }
        }
    });
    return orders;
}

export function is_warrior(unit) {
    return unit===SPECS.CRUSADER || unit===SPECS.PROPHET || unit===SPECS.PREACHER;
}
