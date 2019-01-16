import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as nav from 'nav.js';

const GOING_TO_TARGET = 0;
const MINING = 1;
const GOING_HOME = 2;
const DANGER = 3;

const DEFAULT_SPEED = 4;

var home;
var state;
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

export function turn(game, steps) {
    game.log("I am a pilgrim state " + state + " home " + home + " target " + target);
    var robots = game.getVisibleRobots();
    if (steps === 1) {
        game.log("Initializing");
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
                        game.log("assigning target " + msg.x + " " + msg.y);
                        target = [msg.x, msg.y];
                    }
                }
            }
        };
        
        if (target[0] === 0 && target[1] === 0) {
            game.log("Pilgrim did not get a message");
        }

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
    }

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
        nav.printmap(game, homemap);
    }

    return action;
}
