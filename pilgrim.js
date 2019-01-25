import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as message from 'message.js';
import * as warrior from 'warrior.js';

import * as nav from 'nav.js';
import * as utils from 'utils.js';

export const ORPHAN = 0;
export const MINING = 1;
export const EXPEDITION = 2;

export function listen_orders(game) {
    var orders = [];
    game.getVisibleRobots().forEach(r => {
        if (!("signal" in r)) return;
        if (r.signal <= 0) return;
        if (r.team !== game.me.team) return;

        var msg = decode(r.signal, r, game.me.team);

        if (r.signal_radius < 10) {
            if (msg.type === "pilgrim_assign_target") {
                game.log("pushing message from " + r.id);
                orders.push(msg);            
            } else if (msg.type === "pilgrim_build_church") {
                orders.push(msg);
            } else if (msg.type === "castle_distress") {
                if (r.id%10 === r.signal_radius%10) orders.push(msg);
            }
        }
    });
    return orders;
}

var last_attacker_seen = -(1<<30);

export function mining(game, steps, matrix, target, target_trail, home, home_trail, enemies, friends) {

    // Observation
    var has_neighboring_attacker = false;
    enemies.forEach(r => {
        if (warrior.is_warrior(r.unit)) last_attacker_seen = steps;
    });
    if (last_attacker_seen + 5 >= steps) has_neighboring_attacker = true; // use a cooldown of 5 so pilgrims don't go back and forth forgetting that there's an enemy.

    var action;

    var at_target = (game.me.x === target[0] && game.me.y === target[1]);
    var resources_full = (game.me.fuel >= SPECS.UNITS[SPECS.PILGRIM].FUEL_CAPACITY ||
                         game.me.karbonite >= SPECS.UNITS[SPECS.PILGRIM].KARBONITE_CAPACITY);
    var resources_third = (game.me.fuel*3 >= SPECS.UNITS[SPECS.PILGRIM].FUEL_CAPACITY ||
                          game.me.karbonite*3 >= SPECS.UNITS[SPECS.PILGRIM].KARBONITE_CAPACITY);

    var should_drop_off = false;

    // Execution
    if (has_neighboring_attacker) {
        if (resources_third) should_drop_off = true;
    } else if (resources_full) {
        should_drop_off = true;
    }

    if (should_drop_off) {
        // go home and dump
        if (utils.adjacent(home, [game.me.x, game.me.y])) {
            action = game.give(home[0]-game.me.x, home[1]-game.me.y, game.me.karbonite, game.me.fuel);
        } else {
            var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
                if (utils.robots_collide(friends, [x, y])) return null;
                if (utils.robots_collide(enemies, [x, y])) return null;
                if (game.map[y][x] === false) return null;
                if (utils.adjacent(home, [x, y])) return 100000 - utils.dist([x, y], [game.me.x, game.me.y]);
                return -utils.dist([x, y], home) * 1000 - utils.dist([x, y], [game.me.x, game.me.y]);
            });
            if (nx !== game.me.x || ny !== game.me.y) { 
                if (nx !== null) action = game.move(nx-game.me.x, ny-game.me.y);
            }
        }
    } else if (at_target) {
        // work
        action = game.mine();
    } else {
        // go to work
        var [nx, ny] = nav.path_step(target_trail, [game.me.x, game.me.y], 4, game.getVisibleRobots());
        if (nx !== game.me.x || ny !== game.me.y) {
            if (nx !== null) action = game.move(nx-game.me.x, ny-game.me.y);
        }
    }

    return [action, null]; 
}

export function expedition(game, steps, matrix, target, trail, home, home_trail, enemies, friends) {
    // Observation
    var next_to_target = (utils.adjacent(target, [game.me.x, game.me.y]));
    var enough_to_build = (game.fuel >= SPECS.UNITS[SPECS.CHURCH].CONSTRUCTION_FUEL &&
                           game.karbonite >= SPECS.UNITS[SPECS.CHURCH].CONSTRUCTION_KARBONITE);
    var on_resource = game.karbonite_map[game.me.y][game.me.x] || 
                      game.fuel_map[game.me.y][game.me.x];
    var can_build = !utils.robots_collide(enemies, target) && !utils.robots_collide(friends, target);
    var full = (game.me.fuel >= 100 || game.me.karbonite >= 20);

    // Check if the church didn't get accidentally built by someone else, so to avoid going back and forth
    // to the home one
    var otherhome = utils.argmax(friends, f => {
        if (f.unit === SPECS.CHURCH && f.x === target[0] && f.y === target[1]) return 1;
        return null;
    })

    // Execution
    var action = null;
    if (next_to_target && enough_to_build && can_build && !utils.in_distress(game, steps)) {
        action = game.buildUnit(SPECS.CHURCH, target[0]-game.me.x, target[1]-game.me.y);
    } else if (full && otherhome && next_to_target) {
        action = game.give(otherhome.x-game.me.x, otherhome.y-game.me.y);
    } else if (full && !enough_to_build) {
        game.log("cancelling expedition. Going back to " + home[0] + " " + home[1]);

        // give resources back to base and come back again when there IS enough.
        if (utils.adjacent(home, [game.me.x, game.me.y])) {
            action = game.give(home[0]-game.me.x, home[1]-game.me.y, game.me.karbonite, game.me.fuel);
        } else {
            var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
                if (utils.robots_collide(friends, [x, y])) return null;
                if (utils.robots_collide(enemies, [x, y])) return null;
                if (game.map[y][x] === false) return null;
                if (!home_trail[y][x]) return null;
                var attacked = false;
                enemies.forEach(e => {
                    if (utils.in_fire_range(e.unit, utils.dist([e.x, e.y], [x, y]))) attacked = true;
                });
                if (attacked) return null;
                if (utils.adjacent(home, [x, y])) return 100000 - utils.dist([x, y], [game.me.x, game.me.y]);

                return -(home_trail[y][x][0]*1000 + home_trail[y][x][1]);
            });
            if (nx !== game.me.x || ny !== game.me.y) { 
                if (nx !== null) {
                    action = game.move(nx-game.me.x, ny-game.me.y);
                }
            }
        } 
    } else if (next_to_target && on_resource) {
        action = game.mine();
    } else {
        // either next to already, not enough and not on a resource, or far away.
        // anyhow, get close! Preferably on to a karbonite / fuel.
        var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
            if (x !== game.me.x || y !== game.me.y) // allow standstill
                if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            if (!trail[y][x]) return null;
            if (x === target[0] && y === target[1]) return null; // don't stand on church square

            // Do not walk into enemy fire. We are actually good as scouts.
            var danger = 0;
            enemies.forEach(e => {
                if (warrior.is_warrior(e.unit)) {
                    if (utils.in_fire_range(e.unit, utils.dist([e.x, e.y], [x, y]))) danger++;
                }
            });

            if (danger) return -danger*1000000;

            if (utils.adjacent([x, y],target)) {
                if (game.karbonite_map[y][x]) return 100;
                if (game.fuel_map[y][x]) return 50;
                return 20;
            }
            return (-trail[y][x][0] * 1000 - trail[y][x][1]);
        });
        if (nx !== game.me.x || ny !== game.me.y)
            action = game.move(nx-game.me.x, ny-game.me.y);
    }
    return [action, null];
}

export function orphan(game, steps) {
    // literally do nothing 
    return [null, null];
}
