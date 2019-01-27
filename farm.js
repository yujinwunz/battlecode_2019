import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';
import * as macro from 'macro.js';

export const RESOURCE_MAX_R = 36;


var last_target = null;
var resource_group = null;
var group_bounds = [(1<<30), -(1<<30), (1<<30), -(1<<30)];

export function dfs(map, k_map, f_map, loc, seen, res, cols=null, rows=null, dis=16, boxlen=4) {
    if (cols === null) cols = map[0].length;
    if (rows === null) rows = map.length;
    var [x, y] = loc;
    seen[y][x] = true;
    if (k_map[y][x] || f_map[y][x]) res.push([x, y]);
    for (var nx = Math.max(0, x-boxlen); nx <= Math.min(cols-1, x+boxlen); nx++) {
        for (var ny = Math.max(0, y-boxlen); ny <= Math.min(rows-1, y+boxlen); ny++) {
            if (seen[ny][nx]) continue;
            if ((nx-x)*(nx-x) + (ny-y)*(ny-y) > dis) continue;
            if (k_map[ny][nx] || f_map[ny][nx]) {
                dfs(map, k_map, f_map, [nx, ny], seen, res, cols, rows);
            }
        }
    }
}

export function get_best_church_location(map, group) {
    var cols = map[0].length;
    var rows = map.length;

    var minx = (1<<30), maxx = 0, miny = (1<<30), maxy = 0;
    for (var i = 0; i < group.length; i++) {
        var [x, y] = group[i];
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
    }

    var bestcost = (1<<30);
    var bestloc = [null, null];
    for (var x = Math.max(0, minx-2); x <= Math.min(cols-1, maxx+2); x++) {
        for (var y = Math.max(0, miny-2); y <= Math.min(rows-1, maxy+2); y++) {
            if (!map[y][x]) continue;

            var cost = 0;
            for (var i = 0; i < group.length; i++) {
                var [gx, gy] = group[i];
                var dist = (x-gx)*(x-gx) + (y-gy)*(y-gy);
                if (dist === 0) cost += 1000000; // not allowed to build church on resource itself
                else if (dist < 3) cost += 0;
                else if (dist <= 4) cost += 11;
                else if (dist <= 9) cost += 14;
                else if (dist <= 25) cost += 28;
                else cost += 200;
            }
            if (cost < bestcost) {
                bestcost = cost;
                bestloc = [x, y];
            }
        }
    }

    return bestloc;
}

export function get_church_locations(map, karbonite_map, fuel_map) {
    var symmetry = utils.symmetry(map);

    var cols = map[0].length;
    var rows = map.length;
    var ocols = cols, orows = rows;

    if (symmetry === utils.VERTICAL) {
        cols = Math.ceil(cols/2);
    } else rows = Math.ceil(rows/2);

    var groups = [];
    var seen = utils.null_array(cols, rows);

    // Use connected graphs to get the good castle locations.
    for (var x = 0; x < cols; x++) {
        for (var y = 0; y < rows; y++) {
            if (seen[y][x]) continue;
            if (karbonite_map[y][x] || fuel_map[y][x]) {
                var res = []
                dfs(map, karbonite_map, fuel_map, [x, y], seen, res, cols, rows);
                groups.push(res);
            }
        }
    }

    // Duplicate the flip. We only flipped to avoid weird cases with
    // super large clumps in the middle.
    for (var i = groups.length - 1; i >= 0; i--) {
        var g = groups[i];
        var ng = [];
        var minc = (1<<30);
        var maxc = 0;
        for (var j = 0; j < g.length; j++) {
            var [x, y] = g[j];
            if (symmetry === utils.VERTICAL) {
                ng.push([ocols-1-x, y]);
                minc = Math.min(minc, Math.min(x, ocols-1-x));
                maxc = Math.max(maxc, Math.max(x, ocols-1-x));
            } else {
                ng.push([x, orows-1-y]);
                minc = Math.min(minc, Math.min(y, orows-1-y));
                maxc = Math.max(maxc, Math.max(y, orows-1-y));
            }
        }

        /*
        // Use a single church for a resource group so close to the center
        // that it reflected into a clump
        if (maxc - minc <= 8) {
            ng.forEach(a => g.push(a));
        } else {
            groups.push(ng);
        }*/
    }

    var churches = [];

    // for each group, find best church location. 
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        // don't go if it's next to an existing castle

        churches.push(get_best_church_location(map, g));
    }

    return [churches, groups];
}

function get_a_karbonite_target(game, friends) {
    return utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], RESOURCE_MAX_R, (x, y) => {
        if (game.karbonite_map[y][x]) {
            if (!utils.robots_collide(friends, [x, y])) {
                return 1;
            }
        }
        return null;
    });
}

function get_a_fuel_target(game, friends) {
    return utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], RESOURCE_MAX_R, (x, y) => {
        if (game.fuel_map[y][x]) {
            if (!utils.robots_collide(friends, [x, y])) return 1;
        }
        return null;
    });
}

function get_a_target(game, friends) {
    var ret = get_a_karbonite_target(game, friends);
    if (ret[0] === null) ret = get_a_fuel_target(game, friends);
    return ret;
}

function initialize(game) {
    var seen = utils.null_array(game.map[0].length, game.map.length);
    resource_group = [];
    dfs(game.map, game.karbonite_map, game.fuel_map, [game.me.x, game.me.y], seen, resource_group, game.map[0].length, game.map.length, 36, 6);

    resource_group.forEach(r => {
        group_bounds[0] = Math.min(group_bounds[0], r[0]);
        group_bounds[1] = Math.max(group_bounds[1], r[0]);
        group_bounds[2] = Math.min(group_bounds[2], r[1]);
        group_bounds[3] = Math.max(group_bounds[3], r[1]);
    });

    group_bounds[0] -=2;
    group_bounds[1] +=2;
    group_bounds[2] -=2;
    group_bounds[3] +=2;
}

var first_build = true;

export function turn(game, steps, enemies, friends) {
    if (resource_group === null) initialize(game);

    // Observation
    var target = get_a_target(game, friends);
    var resources_enough = (game.fuel >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_FUEL &&
                            game.karbonite >= SPECS.UNITS[SPECS.PILGRIM].CONSTRUCTION_KARBONITE);

    // Should we build or nah
    var num_pilgrims = friends.filter(f => {
        return f.unit === SPECS.PILGRIM && f.x >= group_bounds[0] && f.x <= group_bounds[1] && f.y >= group_bounds[2] && f.y <= group_bounds[3];
    }).length;
   

    if (game.in_battle + 5 > steps) { // Sometimes pilgrims run away during battle so look for them further away.
                                        // only after 5 steps and they still haven't returned, then it's a problem.
        num_pilgrims = friends.filter(f => f.unit === SPECS.PILGRIM).length;
    }

    var needed = resource_group.length;
    if (steps < macro.FUEL_EMBARGO) {
        // At the start, don't spend pilgrims getting fuel since we need karbonite urgently for expansion and
        // possible urgent defense.
        needed = resource_group.filter(l => game.karbonite_map[l[1]][l[0]]).length;
    }
    if (num_pilgrims < needed) {
        game.log("building because we have " + num_pilgrims + " pilgrims but have " + needed + " resources");
        game.log(friends);
        if (target[0] === null) {
            game.log("no target, impossible!");
            return [null, msg];
        }

        // Execution
        var action = null, msg = null;
        if (target[0] !== null && resources_enough) {
            game.log("building with target " + target[0] + " " + target[1]);
            var trail = nav.build_map(game.map, target, 2, nav.GAITS.SPRINT, [], 5);

            var [sx, sy] = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
                if (utils.robots_collide(friends, [x, y])) return null;
                if (utils.robots_collide(enemies, [x, y])) return null;
                if (!trail[y][x]) return null;
                return (-trail[y][x][0]*1000 -trail[y][x][1]);
            });

            if (sx === null) {
                game.log("Caked in, can't build");
            } else {
                game.log("gonna build at " + sx + " " + sy);
                if (first_build && game.me.unit === SPECS.CHURCH) {
                    game.log("nullified");
                    first_build = false;
                } else {
                    if (!utils.in_distress(game, steps)) {
                        game.log("built");
                        action = game.buildUnit(SPECS.PILGRIM, sx-game.me.x, sy-game.me.y);
                    } else {
                        game.log("in distress");
                    }
                }
            }
        } else {
            game.log("not enough resources " + game.karbonite + " " + game.fuel);
        }
    }

    return [action, msg];
}

export function execute_order_66(game) {
    game.log("EXECUTING ORDER 66");
    var target = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
        if (game.map[y][x] === false) return null;
        if (utils.robots_collide(game.getVisibleRobots(), [x, y])) return null;
        return Math.random();
    });

    if (target[0] !== null) {
        return [game.buildUnit(SPECS.CRUSADER, target[0]-game.me.x, target[1]-game.me.y), null];
    }
}
