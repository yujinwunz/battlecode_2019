import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';

import * as farm from 'farm.js';

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

function launch_expedition(game, loc) {
    // launch pilgrim
    var trail = nav.build_map(game.map, loc, 4, nav.GAITS.SPRINT, game.getVisibleRobots());
    var [sx, sy] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
        if (utils.robots_collide(friends, [x, y])) return null;
        if (utils.robots_collide(enemies, [x, y])) return null;
        if (!trail[y][x]) return null;
        return (-trail[y][x][0]*1000 -trail[y][x][1]);
    });
    if (sx !== null) {
        return [
            game.buildUnit(SPECS.PILGRIM, sx-game.me.x, sy-game.me.y),
            [new Message("pilgrim_build_church", loc[0], loc[1]), 2]
        ];
    }
    return [null, null];
}

var pendingorders = [];

export function turn(game, steps, enemies, friends, orders) {
    // Observe

    // Execute
    var action = null;
    var msg = null;
    // Order your turn in priorities
    
    // Priority 1: Fulfil new orders
    pendingorders = pendingorders.concat(orders);
    if (pendingorders.length) {
        var o = pendingorders[0];
        if (o === "start_expedition") {
            var [action, msg] = launch_expedition([o.x, o.y]);
        }
    }

    // Priority 2: Defense
    
    // Priority 3: Autopilot resource management
    if (!action && !msg) var [action, msg] = farm.turn(game, steps, enemies, friends);
    return [action, msg];
}
