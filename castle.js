import {BCAbstractRobot, SPECS} from 'battlecode';
import * as farm from 'farm.js';
import * as castleutils from 'castleutils.js';
import * as utils from 'utils.js';
import {launch_expedition as launch_expedition} from 'church.js';
import {Message, decode} from 'message.js';

const EXPAND = 0;
const DEPLOY_TURTLE = 1;
const MOBILE_ENEMY_DECAY = 40; // without seeing an enemy for that long assume it's dead

var known_friends = {};
var castles_remaining = 0;

var mobile_enemy_sightings = []; // to keep track of old stuff
var mes_i = 0;
var known_enemies = {};
var known_enemy_stations = [];

// These are received before turn is called.
export function on_birth(game, steps, id, unit) {
    game.log("Birth of " + id + " type " + unit);
    known_friends[id] = {unit, id};
    if (unit === SPECS.CASTLE) castles_remaining++;
}

export function on_ping(game, steps, id, loc) {
    known_friends[id].x = loc[0];
    known_friends[id].y = loc[1];

    // Receiving a heartbeat means there are no enemies in sight.
    // On record, forget all known enemy castles and churches in it's vision range.
    var newlist = [];
    known_enemy_stations.forEach(s => {
        var [i, u, x, y] = s;
        if (utils.dist([x, y], loc) <= SPECS.UNITS[known_friends[id].unit].VISION_RADIUS) {
            // castle/church from enemy not seen.
            game.log("Observed the death of enemy station " + i);
            game.log(known_enemies[i]);
            delete known_enemies[i];
        } else newlist.push([i, u, x, y]);
    });
    known_enemy_stations = newlist;
}

export function on_death(game, steps, id) {
    if (known_friends[id].unit === SPECS.CASTLE) castles_remaining--;
    delete known_friends[id];
}

// Sighting of an enemy
export function on_sighting(game, steps, id, eid, loc, unit) {
    game.log("Enemy sighted by " + id + " of " + eid + " at " + loc[0] + " " + loc[1] + " type " + unit);

    known_enemies[eid] = {eid, unit, x:loc[0], y:loc[1], last_seen:steps};
    if (unit === SPECS.CASTLE || unit === SPECS.CHURCH) {
        // stationary target
        known_enemy_stations.push([eid, unit, loc[0], loc[1]]);
    } else {
        mobile_enemy_sightings.push([eid, steps]);
    }
}

function prune_known_enemies(game, steps) {
    while (mes_i < mobile_enemy_sightings.length && 
            mobile_enemy_sightings[mes_i][1] + MOBILE_ENEMY_DECAY < steps) {
        var [eid, last_seen] = mobile_enemy_sightings[mes_i];
        if (eid in known_enemies && known_enemies[eid].last_seen === last_seen) {
            game.log("Forgetting enemy id " + eid);
            game.log(known_enemies[eid]);
            delete known_enemies[eid];
        } // else the unit was seen again in a later message.
        mes_i++;
    }
}

var church_locs = null;
var group_locs = null;
var symmetry = null;
var implied_enemy_castles = null;

function filter_known_friends(f) {
    var res = [];
    for (var id in known_friends) {
        if (f(id, known_friends[id].unit, known_friends[id].x, known_friends[id].y)) 
            res.push(known_friends[id]);
    }
    return res;
}

function getcode(smove) {
    var [type, arg] = smove;
    if (type === EXPAND) {
        return (1<<20) + arg[0] * 1000 + arg[1];
    }
}

function get_unused_churches(game, steps) {
    var known_churches = filter_known_friends((i, u, x, y) => 
        u === SPECS.CASTLE || u === SPECS.CHURCH
    );
    var churches_to_go = [];

    church_locs.forEach(c => {
        var ok = true;
        known_churches.forEach(kc => {
            if (utils.dist(c, [kc.x, kc.y]) < farm.RESOURCE_MAX_R) ok = false;
        });
        implied_enemy_castles.forEach(kl => {
            if (utils.dist(c, kl) < farm.RESOURCE_MAX_R) ok = false;
        });
        var code = getcode([EXPAND, c]); // to avoid having to wait for one
                                                  // to finish before building another
        if (code in throttle && throttle[code] > steps) {
            // Don't overload. Keep # throttles at 3 max
            var numthrottles = 0;
            for (var k in throttle) {
                if (throttle[k] > steps) numthrottles++;
            }
            if (numthrottles < 2) ok = false;
        }
        if (ok) churches_to_go.push(c);
    })

    return churches_to_go;
}

function canonical_strategic_move(game, steps, known_stations) {
    // Consider building churches.
    var to_build_list = get_unused_churches(game, steps);
    var to_build = utils.argmax(to_build_list, loc => {
        var mindis = (1<<30);
        known_stations.forEach(m => mindis = Math.min(mindis, utils.dist([m.x, m.y], loc)));
        return -mindis;
    });

    if (to_build) {
        return [EXPAND, to_build]; 
    }

    // Returns a strategic decision (not move). It's up to the caller to implement that.
}

var throttle = {};


function i_should_do(game, steps, smove, known_stations) {
    var [type, arg] = smove;

    // 0. Do we need to throttle this action?
    var code = getcode(smove);

    if (code in throttle && throttle[code] > steps) {
        // action is throttled
        return [null, null];
    }

    // 1. Is it my responsibility?
    if (type === EXPAND) {
        var [x, y] = arg;
        var church = utils.argmax(known_stations, f => {
            if (!("x" in known_friends[f.id])) return null;
            return -utils.dist([f.x, f.y], arg);
        });

        // find closest church
        var castle = utils.argmax(known_stations, f => {
            if (!("x" in known_friends[f.id])) return null;
            if (f.unit === SPECS.CASTLE) {
                return -utils.dist([church.x, church.y], [f.x, f.y]);
            }
            return null;
        });

        if (castle.id === game.me.id) {
            // we should do something
            if (church.id === game.me.id) {
                // we are the expander.
                throttle[code] = steps + 10 + Math.sqrt(utils.dist(arg, [game.me.x, game.me.y]));
                return launch_expedition(game, arg);
            } else {
                // signal to the church
                // It will take about manhatten distance before we suspect the pilgrim
                // died somewhere.
                game.log("Launching expedition");
                var cx = known_friends[church.id].x, cy = known_friends[church.id].y;
                throttle[code] = steps + 10 + Math.sqrt(utils.dist(arg, [cx, cy]));
                return [
                    null,
                    [new Message("start_expedition", arg[0], arg[1]), 
                        utils.dist([game.me.x, game.me.y], [cx, cy])
                    ]
                ];
            }
        } else {
            // Wanted to build something but it's not my business.
        }
    }

    // 2. Do we have the resources?
    
    return [null, null];
}

function init(game) {
    var [_c, _g] = castleutils.get_church_locations(game.map, game.karbonite_map, game.fuel_map);
    church_locs = _c;
    group_locs = _g;
    symmetry = utils.symmetry(game.map);
}

function init_implied_castles(game) {
    var mine = filter_known_friends((i, u, x, y) => u === SPECS.CASTLE);
    implied_enemy_castles = [];
    if (symmetry === utils.VERTICAL) {
        mine.forEach(m => implied_enemy_castles.push([game.map[0].length-1-m.x, m.y]));
    } else {
        mine.forEach(m => implied_enemy_castles.push([m.x, game.map.length-1-m.y]));
    }
}

function defense(game, steps, enemies, predators, prey, friends) {
    return [null, null];
}

export function turn(game, steps, enemies, predators, prey, friends) {
    // Observe
    if (church_locs === null) init(game);
    prune_known_enemies(game, steps);
    
    // Execute
    var action = null, msg = null;

    // Priority 1. Strategic calls
    if (steps > 6) { // wait till we know all the castles
        var known_stations = filter_known_friends((i, u, x, y) => 
            u === SPECS.CASTLE || u === SPECS.CHURCH
        );
        if (implied_enemy_castles === null) init_implied_castles(game);
        var strategy = canonical_strategic_move(game, steps, known_stations);
        if (strategy) var [action, msg] = i_should_do(game, steps, strategy, known_stations);
    }
    
    // Priority 2. Protect thyself
    if (!action && !msg) {
        var [action, msg] = defense(game, steps, enemies, predators, prey, friends);
    }

    // Priority 3. Autopilot farming
    if (!action && !msg) {
        var [action, msg] = farm.turn(game, enemies, friends);
    }

    return [action, msg];
}
