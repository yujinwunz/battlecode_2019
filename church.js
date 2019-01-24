import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as warrior from 'warrior.js';

import * as farm from 'farm.js';

export function listen_orders(game) {
    var orders = [];
    game.getVisibleRobots().forEach(r => {
        if (!("signal" in r)) return;
        if (r.signal === -1) return;

        var msg = decode(r.signal, r, game.me.team);
        // Agreed protocol: castles will only send msg with radius hitting exactly you.
        if (msg.sender.signal_radius === utils.dist([r.x, r.y], [game.me.x, game.me.y])) {
            // Only accept orders from castle.
            if (msg.type === "start_expedition") {
                game.log("Heard expedition message");
                if (utils.maybe_from_our_castle(game, [r.x, r.y])) { 
                    game.log("ok");
                    orders.push(msg);            
                } else game.log("But I thought it's from a different castle");
            } else if (msg.type === "start_assult") {
                if (utils.maybe_from_our_castle(game, [r.x, r.y])) {
                    orders.push(msg);
                }
            }
        }
    });
    return orders;
}

export function launch_expedition(game, loc) {
    // launch pilgrim
    var trail = nav.build_map(game.map, loc, 4, nav.GAITS.SPRINT, game.getVisibleRobots());
    var [sx, sy] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
        if (utils.robots_collide(game.getVisibleRobots(), [x, y])) return null;
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

var max_escorts = 0;
var target_escorts = 0;

function defense(game, steps, enemies, friends) {
    var escorts = 0;
    friends.forEach(r => {
        if (warrior.is_warrior(r.unit)) escorts += 1;
    });
    max_escorts = Math.max(escorts, max_escorts);
    target_escorts = max_escorts;
    

    if (enemies.length) {
        // Hard to know size of the attack. Multiply by 3 to be sure.
        var enemy_strength = 0;
        enemies.forEach(r => {
            if (warrior.is_warrior(r.unit)) enemy_strength += 3;
            else enemy_strength += 1;
        });

        target_escorts = Math.max(enemy_strength, target_escorts);
        game.log("enemy_strength: " + enemy_strength);
    }

    var should_build = false;
    if (target_escorts > escorts) {
        should_build = true;
    }

    game.log("target_escorts vs me: " + target_escorts + " " + escorts);
    game.log(enemies);
    game.log(friends);

    if (should_build) {
        var turtle = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            return Math.random();
        });

        if (turtle[0] !== null) {
            return [game.buildUnit(SPECS.PROPHET, turtle[0]-game.me.x, turtle[1]-game.me.y), null];
        }
    }
    return [null, null];
}

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
        if (o.type === "start_expedition") {
            game.log("starting expedition to " + o.x + " " + o.y);
            var [action, msg] = launch_expedition(game, [o.x, o.y]);
        }
        pendingorders.shift();
    }

    // Priority 2: Defense
    if (!action && !msg) {
        var [action, msg] = defense(game, steps, enemies, friends, orders); 
    }
    
    // Priority 3: Autopilot resource management
    if (!action && !msg) var [action, msg] = farm.turn(game, steps, friends);
    return [action, msg];
}
