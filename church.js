import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';

export function listen_orders(game) {
    var orders = [];
    game.getVisibleRobots().forEach(r => {
        if (!("signal" in r)) return;
        if (r.signal === -1) return;

        var msg = decode(r.signal, r, game.me.team);
        // Agreed protocol: castles will only send msg with radius hitting exactly you.
        if (msg.r === utils.dist([r.x, r.y], [game.me.x, game.me.y])) {
            // Only accept orders from castle.
            if (msg.type === "start_expedition") {
                if (utils.maybe_from_our_castle(game, [r.x, r.y])) { 
                    orders.push(msg);            
                }
            } else if (msg.type === "start_assult") {
                if (utils.maybe_from_our_castle(game, [r.x, r.y])) {
                    orders.push(msg);
                }
            }
        }
    });
    return orders;
}

export function turn(game, steps, enemies,predators, prey, friends, orders) {

}
