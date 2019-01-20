import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as nav from 'nav.js';
import * as utils from 'utils.js';

const GOING_TO_TARGET = 0;
const MINING = 1;
const GOING_HOME = 2;
const DANGER = 3;

const WANDERING = 0;
const MINER = 1;
const EXPEDITION = 2;

const DEFAULT_SPEED = 4;

var home;
var state;
var mode = WANDERING;
var targetmap;
var homemap;
var target = [0, 0];

var MYSPEC = SPECS.UNITS[SPECS.PILGRIM];

function get_adjacent_castle(robots, me) {
    for (var i = 0; i < robots.length; i++) {
        var r = robots[i];
        if (!("team" in r)) continue;
        if (!("unit" in r)) continue;
        if (!("x" in r)) continue;
        if ((r.unit === SPECS.CASTLE || r.unit === SPECS.CHURCH) && r.team === me.team) {
            if (Math.abs(r.x - me.x) <= 1 && Math.abs(r.y - me.y) <= 1) return r;
        }
    }
    return null;
}

function mining_turn(game, steps) {
    var robots = game.getVisibleRobots();
    var has_neighboring_pilgrim = false;
    var has_neighboring_attacker = false;

    for (var i = 0; i < robots.length; i++) {
        var r = robots[i];
        if (!("team" in r)) continue;

        if (r.team !== game.me.team) {
            if ("unit" in r) {
                if (r.unit == SPECS.CRUSAIDER 
                    || r.unit == SPECS.PROPHET 
                    || r.unit == SPECS.PREACHER) 
                    has_neighboring_attacker = true;
            }
        } else if ("unit" in r) {
            if (r.unit === SPECS.PILGRIM) has_neighboring_pilgrim = true;
        }
    }

    var action;

    if (has_neighboring_attacker) {
        state = DANGER;
    }

    if (state === GOING_TO_TARGET) {
        if (game.me.x === target[0] && game.me.y === target[1]) {
            state = MINING;
        } else {
            // Opportunistically mine things along the way
            if (game.karbonite_map[game.me.x][game.me.y] && !has_neighboring_pilgrim
                && game.me.karbonite != MYSPEC.KARBONITE_CAPACITY) {
                action = game.mine();
            } else if (game.fuel_map[game.me.x][game.me.y] && !has_neighboring_pilgrim
                && game.me.fuel != MYSPEC.FUEL_CAPACITY) {
                action = game.mine();
            } else {
                var [nx, ny] = nav.path_step(targetmap, [game.me.x, game.me.y], DEFAULT_SPEED, robots);
                if (nx !== game.me.x || ny !== game.me.y) { 
                    game.log("moving to " + nx + " " + ny);
                    action = game.move(nx-game.me.x, ny-game.me.y);
                }
            }
        }
    }

    if (state === MINING) {
        if (game.karbonite_map[game.me.y][game.me.x] && game.me.karbonite === MYSPEC.KARBONITE_CAPACITY) {
            state = GOING_HOME;
        } else if (game.fuel_map[game.me.y][game.me.x] && game.me.fuel === MYSPEC.FUEL_CAPACITY) {
            state = GOING_HOME;
        } else {
            action = game.mine();
        }
    }

    if (state === GOING_HOME || state === DANGER) {
        // check if we're at home castle already.
        var castle = get_adjacent_castle(robots, game.me);
        if (castle) {
            state = GOING_TO_TARGET;
            action = game.give(castle.x - game.me.x, castle.y - game.me.y, game.me.karbonite, game.me.fuel);
        } else {

            var [nx, ny] = nav.path_step(homemap, [game.me.x, game.me.y], (state === DANGER ? 4 : DEFAULT_SPEED), robots);
            if (nx !== game.me.x || ny !== game.me.y) { 
                game.log("moving to " + nx + " " + ny);
                action = game.move(nx-game.me.x, ny-game.me.y);
            }
        }
    }

    game.log("now I'm state: " + state);

    if (game.me.id == 986) {
        utils.print_map(game, homemap);
    }

    return action;
}

function expedition_turn(game, steps) {
    // We move to location. We make castle. We wander around castle, waiting for instruction.

    // Check if we can build him
    if (Math.abs(game.me.x - target[0]) <= 1 && Math.abs(game.me.y - target[1]) <= 1) {
        if (game.karbonite >= SPECS.UNITS[SPECS.CHURCH].CONSTRUCTION_KARBONITE && 
            game.fuel >= SPECS.UNITS[SPECS.CHURCH].CONSTRUCTION_FUEL) {
            if (!utils.robots_collide(game.getVisibleRobots(), target)) { 
                mode = WANDERING;
                return game.buildUnit(SPECS.CHURCH, target[0] - game.me.x, target[1] - game.me.y);
            }
        }
    } else {
        var robots = game.getVisibleRobots();
                                                                    // full steam ahead.    make sure we don't walk on the square
        //                                                          //                     where the church is supposed to be
        var [nx, ny] = nav.path_step(targetmap, [game.me.x, game.me.y], 4, robots.concat([{x:target[0], y:target[1]}]));
        return game.move(nx-game.me.x, ny-game.me.y);
    }
}


function wandering_turn(game, steps) {
    var robots = game.getVisibleRobots();
    game.log("Wandering");
    state = GOING_TO_TARGET;

    home = [game.me.x, game.me.y];

    // Get an initialization message from castle
    for (var i = 0; i < robots.length; i++) {
        var r = robots[i];
        if (!("team" in r)) return;
        if (!("unit" in r)) return;
        if ((r.unit === SPECS.CASTLE || r.unit === SPECS.CHURCH) && r.team == game.me.team) {
            if ("signal" in r) {
                var msg = decode(r.signal, game.me);
                
                game.log("Pilgrim got message " + r.signal + " type " + msg.type);
                game.log("Message was from " + r.unit + " " + r.x + " " + r.y);
                home = [r.x, r.y];
                
                if (msg.type === "pilgrim_assign_target") {
                    mode = MINER;
                    game.log("assigning target " + msg.x + " " + msg.y);
                    target = [msg.x, msg.y];
                    
                    homemap = nav.build_map(game.map
                        , [game.me.x, game.me.y]
                        , MYSPEC.SPEED
                        , nav.GAITS.WALK
                    );

                    targetmap = nav.build_map(
                        game.map,
                        target,
                        DEFAULT_SPEED,
                        nav.GAITS.WALK // in case we are in danger
                    );

                    return mining_turn(game, steps);
                }

                if (msg.type === "pilgrim_build_church") {
                    mode = EXPEDITION;
                    game.log("building church at " + msg.x + " " + msg.y);
                    target = [msg.x, msg.y];

                    targetmap = nav.build_map(
                        game.map,
                        target,
                        DEFAULT_SPEED,
                        nav.GAITS.WALK // in case we are in danger
                    );

                    utils.call_for_backup(game, 2); // get 2 crusaiders to escort you
                    //return expedition_turn(game, steps); 
                    // Don't do the step immediately because call_for_backup needs to stay put
                }
            }
        }
    };
    
    game.log("Pilgram got an existential crisis");
    // do nothing this turn and await instruction. TODO: find a tower and alert them that you're wandering.
}

export function turn(game, steps) {
    game.log("I am a pilgrim state " + state + " home " + home + " target " + target);
    if (mode === WANDERING) return wandering_turn(game, steps);
    if (mode === MINER) return mining_turn(game, steps);
    if (mode === EXPEDITION) return expedition_turn(game, steps);
    throw "invalid AI mode";
}
