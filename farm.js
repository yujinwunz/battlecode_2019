import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';

const RESOURCE_MAX_R = 36;

var assigned_to = {};
var assignments = null;

var last_target = null;

function get_a_target(game) {
    return utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], RESOURCE_MAX_R, (x, y) => {
        if (game.karbonite_map[y][x] || game.fuel_map[y][x]) {
            if (!assignments[y][x]) {
                return 1;
            }
        }
        return null;
    });
}

function initialize(game) {
    assignments = utils.null_array(game.map[0].length, game.map.length); 
}

function headcount(game, friends) {
    if (last_target) {
        // the pilgrim we just build should be here by now
        var done = false;
        friends.forEach(r => {
            if (utils.dist([r.x, r.y], [game.me.x, game.me.y]) < 9 && r.unit === SPECS.PILGRIM) {
                if (!done) {
                    assigned_to[r.id] = [last_target[0], last_target[1]];
                    assignments[last_target[1]][last_target[0]] = r.id;
                    last_target = null;
                    done = true;
                }
            }
        });
    }

    var seen = {};
    friends.forEach(r => {
        seen[r.id] = true;
    });
    var to_remove = [];
    for (var id in assigned_to) {
        if (!seen[id]) to_remove.push(id);
    }
    to_remove.forEach(id => {
        var [x, y] = assigned_to[id];
        assignments[y][x] = null;
        delete assigned_to[id];
    });
}

export function turn(game, enemies, friends) {
    if (assignments === null) initialize(game);

    // Observation
    headcount(game, friends);

    var target = get_a_target(game);
    var resources_enough = (game.fuel >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_FUEL &&
                            game.karbonite >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_KARBONITE);

    // Execution
    var action = null, msg = null;
    if (target[0] !== null && resources_enough && last_target === null) {
        var trail = nav.build_map(game.map, target, 2, nav.GAITS.SPRINT, [], 4);

        var [sx, sy] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            if (!trail[y][x]) return null;
            return (-trail[y][x][0]*1000 -trail[y][x][1]);
        });

        if (sx === null) {
            game.log("Caked in, can't build");
        } else {
            action = game.buildUnit(SPECS.PILGRIM, sx-game.me.x, sy-game.me.y);
            msg = [new Message("pilgrim_assign_target", target[0], target[1]), 2];
            last_target = [target[0], target[1]];
        }
    }

    return [action, msg];
}
