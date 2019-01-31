import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as warrior from 'warrior.js';
import * as macro from 'macro.js';

import * as farm from 'farm.js';

const BACKUP_DELAY = 5;

var order_66 = false;

export function listen_orders(game) {
    var orders = [];
    game.getVisibleRobots().forEach(r => {
        if (!("signal" in r)) return;
        if (r.signal === -1) return;

        var msg = decode(r.signal, r, game.me.team);
        // Agreed protocol: castles will only send msg with radius hitting exactly you.
        if (r.signal_radius === utils.dist([r.x, r.y], [game.me.x, game.me.y])) {
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

        // Broader messages: order66
        if (msg.type === "order66") {
            game.log("EXECUTE ORDER 66; YES SIR");
            orders.push(msg);
        } else if (msg.type === "castle_distress") {
            if (r.id % 10 === r.signal_radius % 10) orders.push(msg);
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

var last_call_on = -(1<<30);

function defense(game, steps, enemies, friends) {
    var msg = null;

    // Do we need to call for backup?
    if (steps > last_call_on + BACKUP_DELAY) {
        var closest = utils.argmax(enemies, f => {
            if (!warrior.is_warrior(f.unit)) return null;
            return -utils.dist([game.me.x, game.me.y], [f.x, f.y]);
        });

        if (closest) {
            if (utils.dist([closest.x, closest.y], [game.me.x, game.me.y]) <= 64) {
                last_call_on = steps;
                game.log("requesting assistance");
                max_escorts += 5; // learn from previous failures
                // yes. Yes we do.
                msg = [new Message("attack", closest.x, closest.y), 64];
            }
        }
    }

    var escorts = 0;
    friends.forEach(r => {
        // Only things in front are escorts, unless we are in enemy zone in which everything is an escort
        // This avoids mistaking units from neighbours as helpful to us since they won't come to our defense.
        if (warrior.is_warrior(r.unit)) {
            if (utils.on_our_side(game, [game.me.x, game.me.y])) {
                // Only in enemy zones
                var center = utils.forward(game, [game.me.x, game.me.y], 7);
                if (utils.dist(center, [r.x, r.y]) <= 64) escorts++;
            } else {
                // Everywhere close
                if (utils.dist([r.x, r.y], [game.me.x, game.me.y]) <= 64) escorts++;
            }
        }
    });
    max_escorts = Math.max(escorts, max_escorts);
    target_escorts = max_escorts;
    

    var enemy_strength = 0;
    if (enemies.length) {
        // Hard to know size of the attack. Multiply by 3 to be sure.
        enemies.forEach(r => {
            if (warrior.is_warrior(r.unit)) enemy_strength += 3;
            else enemy_strength += 1;
        });

        target_escorts = Math.max(enemy_strength, target_escorts);
    }

    var should_build = false;
    if (target_escorts > escorts) {
        var fuel_crisis = game.fuel / game.fuel_target;
        var karb_crisis = game.karbonite / game.karbonite_target;
        var defense_crisis = escorts / target_escorts;
        if (defense_crisis <= fuel_crisis && defense_crisis <= karb_crisis) 
            should_build = true;
        
        //            emergency                         allow them to shoot 
        if (escorts <= enemy_strength * 1.5 && game.fuel >= 50 + escorts*75) should_build = true;
    }

    if (game.fuel > game.fuel_target && game.karbonite > game.karbonite_target) {
        // Randomly grow cloud when in abundance of resources. Ones in the center should be hotter.
        var dist = 0;
        if (game.symmetry === utils.VERTICAL) dist = Math.abs(game.map.length/2 - game.me.x);
        else dist = Math.abs(game.map.length/2 - game.me.y);
        
        dist = Math.floor(dist / (game.map.length/2) * 10) + 1

        if (steps % dist === game.me.id % dist) should_build = true;
    }

    if (should_build) {
        var turtle = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
            if (game.map[y][x] === false) return null;
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            return Math.random();
        });
        
        var closest = (1<<30);
        var preacher_rush = false;
        enemies.forEach(e => {
            var dist = utils.dist([e.x, e.y], [game.me.x, game.me.y]);
            closest = Math.min(closest, utils.dist([e.x, e.y], [game.me.x, game.me.y]));
            if (e.unit === SPECS.PREACHER && dist <= 49) preacher_rush = true;
        });

        if (turtle[0] !== null) {
            if (!utils.in_distress(game, steps)) { // castle protection before church protection
                var type = SPECS.PROPHET;
                if (closest <= 25 || preacher_rush) type = SPECS.PREACHER;
                return [game.buildUnit(type, turtle[0]-game.me.x, turtle[1]-game.me.y), msg];
            }
        }
    }
    return [null, msg];
}

// Disregard everything. Go forward.
function war_turn(game, steps, enemies, predators, friends) {
    var fuel_needed = 0;
    friends.forEach(kf => {
        if ("unit" in kf && "x" in kf && "y" in kf) {
            if (warrior.is_warrior(kf.unit) && utils.dist([kf.x, kf.y], game.war_target) < macro.WAR_ATTACK_RADIUS) {
                fuel_needed += 4 * Math.sqrt(utils.dist([kf.x, kf.y], game.war_target)) + 50;
            }
        }
    });

    // Build if near target, don't build if far away.
    if (utils.dist(utils.forward(game, [game.me.x, game.me.y], 6), game.war_target) < macro.WAR_BUILD_RADIUS) {
        var savior = SPECS.PROPHET;
        var msg = null;
        if (game.war_mode === 1) {
            savior = SPECS.PREACHER;
            msg = [new Message("attack", game.war_target[0], game.war_target[1]), 2];
        }

        if (game.karbonite >= 30 && game.fuel >= fuel_needed) {
            game.log("sending a " + savior + " to war");
            var turtle = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
                if (game.map[y][x] === false) return null;
                if (utils.robots_collide(friends, [x, y])) return null;
                if (utils.robots_collide(enemies, [x, y])) return null;

                if (utils.on_our_side(game, [game.me.x, game.me.y], [x, y])) {
                    if (game.me.x !== x && game.me.y !== y) {
                        return 0;
                    } else return 1; // send em forwards
                }
                return -1;
            });

            if (turtle[0] !== null) {
                if (game.karbonite >= SPECS.UNITS[savior].CONSTRUCTION_KARBONITE &&
                    game.fuel >= SPECS.UNITS[savior].CONSTRUCTION_FUEL) {
                    return [game.buildUnit(savior, turtle[0]-game.me.x, turtle[1]-game.me.y), msg];
                }
            }
        } else {
            game.log("not enough resources for war " + savior + " " + game.karbonite + " " + game.fuel + " " + fuel_needed);
        }
    } else {
        game.log("I'm a bit far, will save resources for the center");
    }

    return [null, null];
}


export function turn(game, steps, enemies, predators, friends, orders) {
    // Observe

    // Execute
    var action = null;
    var msg = null;
    // Order your turn in priorities
    
    // Priority 0: Fulfil new orders
    pendingorders = pendingorders.concat(orders);
    if (pendingorders.length) {
        var o = pendingorders[0];
        if (o.type === "start_expedition") {
            game.log("starting expedition to " + o.x + " " + o.y);
            var [action, msg] = launch_expedition(game, [o.x, o.y]);
        } else if (o.type === "order66") {
            order_66 = true;
        }
        pendingorders.shift();
    }

    // Priority 1: EXECUTE ORDER 66
    if (order_66) {
        return farm.execute_order_66(game);
    }

    // Priority 2: Defense
    if (!action && !msg) {
        if ("war_mode" in game) {
            var [action, msg] = war_turn(game, steps, enemies, predators, friends);
        } else {
            var [action, msg] = defense(game, steps, enemies, friends, orders); 
        }
    }
    
    // Priority 3: Autopilot resource management
    if (!action && !msg) {
        if (predators.length === 0 || game.karbonite >= 50) { 
            var [action, msg] = farm.turn(game, steps, enemies, friends);
        }
    }
    return [action, msg];
}
