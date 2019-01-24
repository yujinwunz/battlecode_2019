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
            }
        }
    });
    return orders;
}

export function mining(game, steps, matrix, target, target_trail, home, home_trail, enemies, friends) {

    // Observation
    var has_neighboring_attacker = false;
    enemies.forEach(r => {
        if (warrior.is_warrior(r.unit)) has_neighboring_attacker = true;
    });

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

export function expedition(game, steps, matrix, target, trail, enemies, friends) {
    // Observation
    var next_to_target = (utils.adjacent(target, [game.me.x, game.me.y]));
    var enough_to_build = (game.fuel >= SPECS.UNITS[SPECS.CHURCH].CONSTRUCTION_FUEL &&
                           game.karbonite >= SPECS.UNITS[SPECS.CHURCH].CONSTRUCTION_KARBONITE);
    var on_resource = game.karbonite_map[game.me.y][game.me.x] || 
                      game.fuel_map[game.me.y][game.me.x];
    var can_build = !utils.robots_collide(enemies, target) && !utils.robots_collide(friends, target);

    // Execution
    var action = null;
    if (next_to_target && enough_to_build && can_build) {
        action = game.buildUnit(SPECS.CHURCH, target[0]-game.me.x, target[1]-game.me.y);
    } else if (next_to_target && on_resource) {
        action = game.mine();
    } else {
        // either next to already, not enough and not on a resource, or far away.
        // anyhow, get close! Preferably on to a karbonite / fuel.
        var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            if (!trail[y][x]) return null;
            if (x === target[0] && y === target[1]) return null; // don't stand on church square
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
