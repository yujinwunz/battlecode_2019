import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as message from 'message.js';
import * as warrior from 'warrior.js';

import * as nav from 'nav.js';
import * as utils from 'utils.js';

import * as farm from 'farm.js';

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
            if (msg.type === "pilgrim_build_church") {
                orders.push(msg);
            } else if (msg.type === "castle_distress") {
                if (r.id%10 === r.signal_radius%10) orders.push(msg);
            }
        }
    });
    return orders;
}

function num_dangling_resources(game, steps, loc, churches) {
    var ans = 0;
    utils.iterlocs(game.map[0].length, game.map.length, loc, 2, (x, y) => {
        // A dangling reosurce is one where a pilgrim has to travel to deposit.
        if (game.karbonite_map[y][x] || game.fuel_map[y][x]) {
            var mindist = (1<<30);
            churches.forEach(f => {
                mindist = Math.min(mindist, utils.dist([f.x, f.y], [x, y]));
            });
            if (mindist > 2) ans += 1. + 0.1 * mindist;
        }
    });
    return ans;
}

function expand_church(game, steps, friends) {
    // As game gets more progressive, we need to build more stuff.
    if (steps < 50) return null;
    if (!game.karbonite_map[game.me.y][game.me.x] 
        && !game.fuel_map[game.me.y][game.me.x]) return null;

    //if (game.karbonite_target < 100) return null;
    //if (game.fuel_target < 500) return null;

    var churches = friends.filter(f => 
        (f.unit === SPECS.CHURCH || f.unit === SPECS.CASTLE)
    );

    var [bx, by] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
        if (game.map[y][x] === false) return null;
        if (game.karbonite_map[y][x] || game.fuel_map[y][x]) return null;
        var penalty = 0; // don't build adjacent to existing ones
        churches.forEach(c => {
            if (utils.adjacent([c.x, c.y], [x, y])) penalty += 0.5;
        });
        return num_dangling_resources(game, steps, [x, y], churches) - penalty;
    });

    if (bx !== null) {
        var benefit = num_dangling_resources(game, steps, [bx, by], churches);
        
        // Janky heuristics here
        if (game.fuel*(benefit/1.5)-100 >= game.fuel_target && game.karbonite*(benefit/1.5)-50 >= game.karbonite_target) {
            game.log("Building auxilary church at " + bx + " " + by + " with benefit " + benefit);
            
            if (utils.robots_collide(friends, [bx, by])) {
                game.log("cancelled");
                return null;
            }
            return game.buildUnit(SPECS.CHURCH, bx-game.me.x, by-game.me.y);
        } else {
            game.log("Would build but our resources are under budget kt k ft f " + 
                game.karbonite_target + " " + game.karbonite + " " + game.fuel_target + 
                " " + game.fuel + " benefit " + benefit);
        }
    }
    return null;
}

var last_attacker_seen = -(1<<30);
var resource_group = null;
var mining_target = null;
var target_trail = null;

export function mining(game, steps, matrix, home, predators, enemies, friends) {
    if (resource_group === null) {
        game.log("initializing. Resource group:");
        var seen = utils.null_array(game.map[0].length, game.map[1].length);
        resource_group = [];
        farm.dfs(game.map, game.karbonite_map, game.fuel_map, [game.me.x, game.me.y], seen, resource_group); 
        game.log(resource_group);
    }

    if (predators.length) {
        // if directly in the line of fire, gtfo.
        var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
            if (game.map[y][x] === false) return null;
            if (utils.robots_collide(friends.concat(enemies), [x, y])) return null;

            var danger = 0;
            enemies.forEach(e => {
                if (warrior.is_warrior(e.unit)) {
                    if (utils.in_fire_range_full(e.unit, utils.dist([e.x, e.y], [x, y]))) danger++;
                }
            });

            return -danger;
        });

        if (nx !== null && (nx !== game.me.x || ny !== game.me.y)) {
            game.log("running away");
            return [game.move(nx-game.me.x, ny-game.me.y), null];
        }
    }

    // Observation
    var has_neighboring_attacker = false;
    enemies.forEach(r => {
        if (warrior.is_warrior(r.unit)) last_attacker_seen = steps;
    });
    if (last_attacker_seen + 5 >= steps) has_neighboring_attacker = true; // use a cooldown of 5 so pilgrims don't go back and forth forgetting that there's an enemy.

    var action;

    var at_target = mining_target && (game.me.x === mining_target[0] && game.me.y === mining_target[1]);
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

    var churches = friends.filter(f => f.unit === SPECS.CHURCH || f.unit === SPECS.CASTLE);
    if (should_drop_off) {
        // go home and dump
        // actually, go to any neighbour church and dump
        var loc = utils.argmax(churches, f=> {
            if (utils.adjacent([f.x, f.y], [game.me.x, game.me.y])) return 1;
            return null;
        });
        if (loc) {
            action = game.give(loc.x-game.me.x, loc.y-game.me.y, game.me.karbonite, game.me.fuel);
        } else {
            // consider building a nearby church
            action = expand_church(game, steps, friends);

            if (!action) {
                var closest = utils.argmax(churches, c => {
                    return -utils.dist([c.x, c.y], [game.me.x, game.me.y]);
                });
                if (!closest) closest = home;
                var trail = nav.build_map_cached(game.map, [closest.x, closest.y], SPECS.UNITS[game.me.unit].SPEED, nav.GAITS.SPRINT, 10, resource_group);
                var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
                    if (utils.robots_collide(friends, [x, y])) return null;
                    if (utils.robots_collide(enemies, [x, y])) return null;
                    if (game.map[y][x] === false) return null;
                    var is_adj = false;
                    churches.forEach(h => {
                        if (utils.adjacent(h, [x, y])) is_adj = true; 
                    });
                    if (is_adj) return 100000 - utils.dist([x, y], [game.me.x, game.me.y]);
                    if (!trail[y][x]) return null;
                    return -trail[y][x][0] * 1000 - trail[y][x][1];
                });
                if (nx !== game.me.x || ny !== game.me.y) { 
                    if (nx !== null) action = game.move(nx-game.me.x, ny-game.me.y);
                }
            }
        }
    } else if (at_target) {
        // work
        action = game.mine();
    } else {
        // go to work
        if (mining_target === null || utils.robots_collide(friends.filter(f => f.unit === SPECS.PILGRIM), mining_target)) {
            // Time for a new target
            var target = utils.argmax(resource_group, f => {
                if (utils.robots_collide(friends, f) && (f[0] !== game.me.x || f[1] !== game.me.y)) return null;
                var dist = utils.dist(f, [game.me.x, game.me.y]);
                return -dist;
            });

            if (target === null) {
                // Go into stalking mode.
                // TODO
                // First just get out of the way of any churches.
                var [nx, ny] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 4, (x, y) => {
                    if (utils.robots_collide(friends, [x, y])) return null;
                    if (utils.robots_collide(enemies, [x, y])) return null;
                    if (game.map[y][x] === false) return null;
                    var is_adj = false;
                    churches.forEach(h => {
                        if (utils.adjacent(h, [x, y])) is_adj = true; 
                    });
                    if (is_adj) return null;
                    return -utils.dist([x, y], [game.me.x, game.me.y]);
                });
                if (nx !== game.me.x || ny !== game.me.y) { 
                    if (nx !== null) action = game.move(nx-game.me.x, ny-game.me.y);
                }
            } else {
                // go to new target
                target_trail = nav.build_map_cached(game.map, target, SPECS.UNITS[game.me.unit].SPEED, nav.GAITS.SPRINT, 5);
                mining_target = [target[0], target[1]];
            }
        }
    
        if (!action) {
            var [nx, ny] = nav.path_step(target_trail, [game.me.x, game.me.y], 4, game.getVisibleRobots());
            if (nx !== game.me.x || ny !== game.me.y) {
                if (nx !== null) action = game.move(nx-game.me.x, ny-game.me.y);
            }
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

    var newstate;
    if (otherhome) {
        game.log("someone else built it");
        newstate = MINING;
    }

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
    return [action, null, newstate];
}

export function orphan(game, steps) {
    // literally do nothing 
    return [null, null];
}
