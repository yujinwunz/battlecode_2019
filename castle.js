import {BCAbstractRobot, SPECS} from 'battlecode';
import * as farm from 'farm.js';
import * as castleutils from 'castleutils.js';
import * as utils from 'utils.js';
import {launch_expedition as launch_expedition} from 'church.js';
import {Message, decode} from 'message.js';
import * as warrior from 'warrior.js';
import * as macro from 'macro.js';

const EXPAND = 0;
const DEPLOY_TURTLE = 1;
const RESOURCE_TARGETS = 2;
const ENDGAME_POSSIBLE_THRESHOLD = 800;

const BUILD_POTENTIAL_COST_CONST = 10;

const MOBILE_ENEMY_DECAY = 30; // without seeing an enemy for that long assume it's dead
const CERTAIN_VISIBILITY = 0.7; // Our picture of a unit's position is not 100% accurate
                                // and so only rely on the center of its vision to deduce
                                // enemy castle death.

var known_friends = {};
var castles_remaining = 0;
var enemy_castles_remaining = 0;

var enemy_warrior_sightings = []; // to keep track of old stuff
var enemy_civilian_sightings = [];
var ews_i = 0;
var ecs_i = 1;

var warrior_health = 0;
var n_warriors = 0;
var worker_health = 0;

var karbonite_control = {};
var fuel_control = {};

var implied_enemy_castles = null;
var anticipated_church_loc = [null, null];
var expansion_attempts = {}; // if we expand and fail, maybe yall should try something else

var clearing_freq = 1; // Sometimes when there's lots of enemy sightings and friendly
                       // units, we want to clear units less frequently to avoid timeout.

// These are received before turn is called.
export function on_birth(game, r, unit) {
    var id = r.id;
    known_friends[id] = {unit, id};
    if (unit === SPECS.CASTLE) {
        castles_remaining++;
        enemy_castles_remaining++; // implication
    }
    
    if (unit === SPECS.CHURCH) {
        if (game.turn < 60) { // Before churches can be built for mining optimization
            if (anticipated_church_loc && anticipated_church_loc[0] !== null) {
                known_friends[id].x = anticipated_church_loc[0];
                known_friends[id].y = anticipated_church_loc[1];
            }
        }
    }

    if (warrior.is_warrior(unit)) {
        warrior_health += SPECS.UNITS[unit].STARTING_HP;
        n_warriors++;
    }
    else worker_health += SPECS.UNITS[unit].STARTING_HP;
}

var pings = {}; // ping list to keep track of "all clear" signals - 3 pings in a row
var recorded = {};

export function on_ping(game, r, loc) {
    if (!(r.id in known_friends)) {
        known_friends[r.id] = {id:r.id};
        if ("unit" in r) known_friends[r.id].unit = r.unit;
        else known_friends[r.id].unit = SPECS.PROPHET;
    }
    var id = r.id;
    if (loc[0] !== null) {
        known_friends[id].x = loc[0];
    }

    if (loc[1] !== null) {
        known_friends[id].y = loc[1];
    }

    if (!(r.id in pings)) pings[r.id] = [];
    pings[r.id].push(game.me.turn);

    if ("unit" in known_friends[id] && "x" in known_friends[id] && "y" in known_friends[id] && r.turn > 5 && "unit" in known_friends[id]) {

        if (!(r.id in recorded)) {
            recorded[r.id] = true;
            var unit = known_friends[id].unit;
            if (unit === SPECS.CASTLE || unit === SPECS.CHURCH) {
                utils.iterlocs(game.map[0].length, game.map.length, [known_friends[id].x, known_friends[id].y], farm.RESOURCE_MAX_R, (x, y) => {
                    if (game.karbonite_map[y][x]) {
                        if (!(y*64+x in karbonite_control)) karbonite_control[y*64+x] = 0;
                        karbonite_control[y*64+x]++;
                    }
                    if (game.fuel_map[y][x]) {
                        if (!(y*64+x in fuel_control)) fuel_control[y*64+x] = 0;
                        fuel_control[y*64+x]++;
                    }
                });
            }
        }

        if (pings[r.id].length >= 3 && pings[r.id][pings[r.id].length-3] === game.me.turn-2) {
            game.log("all clear from");
            game.log(r);
            game.log(known_friends[id]);
            game.log("reported loc " + loc[0] + " " + loc[1]);
            // Receiving a heartbeat means there are no enemies in sight.
            // On record, forget all known enemy castles and churches in it's vision range.
            implied_enemy_castles.forEach(f => {
                if (utils.dist(f, [known_friends[id].x, known_friends[id].y]) <= SPECS.UNITS[known_friends[id].unit].VISION_RADIUS * CERTAIN_VISIBILITY) {
                    game.log("cleared enemy castle at " + f[0] + " " + f[1]);
                    enemy_castles_remaining--;
                }
            });
            implied_enemy_castles = implied_enemy_castles.filter(f => 
                utils.dist(f, [known_friends[id].x, known_friends[id].y]) > SPECS.UNITS[known_friends[id].unit].VISION_RADIUS * CERTAIN_VISIBILITY
            );

            // Disregard all sightings in this area.
            if ((r.id + game.me.turn) % clearing_freq === 0) { // throttle to avoid timeouts
                var prevsize = enemy_warrior_sightings.length + enemy_civilian_sightings.length;
                enemy_warrior_sightings = enemy_warrior_sightings.filter(f => 
                    utils.dist([f[1], f[2]], [known_friends[id].x, known_friends[id].y]) > SPECS.UNITS[known_friends[id].unit].VISION_RADIUS * CERTAIN_VISIBILITY
                );
                enemy_civilian_sightings = enemy_civilian_sightings.filter(f => 
                    utils.dist([f[1], f[2]], [known_friends[id].x, known_friends[id].y]) > SPECS.UNITS[known_friends[id].unit].VISION_RADIUS * CERTAIN_VISIBILITY
                );
                game.log("cleared " + (enemy_warrior_sightings.length + enemy_civilian_sightings.length - prevsize) + " enemy reports");
            }
        }
    }
}

export function on_death(game, id) {
    if (!(id in known_friends)) {
        return;
    }

    var unit = known_friends[id].unit;
    if (warrior.is_warrior(unit)) {
        warrior_health -= SPECS.UNITS[unit].STARTING_HP;
        n_warriors--;
    }
    else worker_health -= SPECS.UNITS[unit].STARTING_HP;

    if (unit === SPECS.CASTLE || unit === SPECS.CHURCH) {
        if ("x" in known_friends[id] && "y" in known_friends[id]) {
            var x = known_friends[id].x, y = known_friends[id].y;
            utils.iterlocs(game.map[0].length, game.map.length, [x, y], farm.RESOURCE_MAX_R, (x, y) => {
                if (game.karbonite_map[y][x]) karbonite_control[y*64+x]--;
                if (game.fuel_map[y][x]) fuel_control[y*64+x]--;
                if (!karbonite_control[y*64+x]) delete karbonite_control[y*64+x];
                if (!fuel_control[y*64+x]) delete fuel_control[y*64+x];
            });
        }
    }

    if (unit === SPECS.CASTLE) castles_remaining--;
    delete known_friends[id];
}

export function on_warrior_sighting(game, steps, r, dx, dy) {
    if (!(r.id in known_friends)) return;
    var r = known_friends[r.id];
    if ("x" in r && "y" in r) {
        enemy_warrior_sightings.push([steps, r.x + dx*3-11, r.y + dy*3-11]);
    }
}

export function on_civilian_sighting(game, steps, r, dx, dy) {
    if (!(r.id in known_friends)) return;
    var r = known_friends[r.id];
    if ("x" in r && "y" in r) {
        enemy_civilian_sightings.push([steps, r.x + dx*3-11, r.y + dy*3-11]);
    }
}

const MEMORY = 10;

function prune_known_enemies(game, steps) {
    while (enemy_civilian_sightings.length > 0 && enemy_civilian_sightings[0][0] + MEMORY < steps) enemy_civilian_sightings.shift(0); 
    while (enemy_warrior_sightings.length > 0 && enemy_warrior_sightings[0][0] + MEMORY < steps) {
        enemy_warrior_sightings.shift(0); 
    }
}

var church_locs = null;
var group_locs = null;
var symmetry = null;

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
    } else if (type === RESOURCE_TARGETS) {
        return (2<<20) + arg[0] * 1000 + arg[1];
    }
}

function get_unused_groups(game, steps) {
    var known_churches = filter_known_friends((i, u, x, y) => 
        u === SPECS.CASTLE || u === SPECS.CHURCH
    );
    var groups_to_go = [];

    for (var i = 0; i < church_locs.length; i++) {
        var ok = true;
        var c = church_locs[i];
        known_churches.forEach(kc => {
            if (utils.dist(c, [kc.x, kc.y]) < farm.RESOURCE_MAX_R) ok = false;
        });
        var code = getcode([EXPAND, c]); // to avoid having to wait for one
                                                  // to finish before building another
        if (ok) groups_to_go.push([c, group_locs[i]]);
    };

    return groups_to_go;
}

function is_enemy_fortified(loc) {
    var fortification = 0;
    enemy_warrior_sightings.forEach(e => {
        if (utils.dist([e[1], e[2]], loc) < 64) fortification ++;
    });
    implied_enemy_castles.forEach(kl => {
        if (utils.dist(loc, kl) < farm.RESOURCE_MAX_R) fortification += 4;
    });
    return fortification;
}

// if it is fortified, this function is irrelevant.
function is_enemy_occupied(loc) {
    var occupation = 0;
    enemy_civilian_sightings.forEach(e => {
        if (utils.dist([e[1], e[2]], loc) < 36) occupation++;
    });
    return occupation;
}

function is_already_doing(loc) {
    var occupation = 0;
    for (var id in known_friends) {
        var r = known_friends[id];
        if (r.unit === SPECS.PILGRIM) {
            if (utils.dist([r.x, r.y], loc) < 25) occupation++;
        }
    }
    return occupation;
}

var resources_replenished = true;
var last_num_stations = 0;

// The potential is sum of (distance * value) of curches we have left to build.
// It estimates the amount of "value" we have yet to extract.
// Lowering the potential means gaining expansion progress.
function get_potential(game, steps, byvalue, station_locs) {
    var ans = 0;
    byvalue.forEach(g => {
        var [v, l] = g;
        var min_potential = (1<<30);
        var min_station = [null, null];
        station_locs.forEach(sl => {
            var pot = (Math.sqrt(utils.dist(sl, l)) + BUILD_POTENTIAL_COST_CONST) * v;
            if (sl[0] === l[0] && sl[1] === l[1]) pot = 0;
            if (pot < min_potential) {
                min_potential = pot;
                min_station = sl;
            }
        });
        ans += min_potential;
    });
    return ans;
}

function sorted_build_list(game, steps, groups, station_locs) {
    // Find the ones that are in contention, and sprint for those.

    // We will give weights to each one. Then, add more weight to how close they are to other
    // heavyweights (pseudo-bfs). Finally penalize with distance and return the sorted result.

    var byvalue = [];

    groups.forEach(g => {
        var [loc, places] = g;
        var value = 0;
        places.forEach(l => {
            if (game.karbonite_map[l[1]][l[0]]) value += 1;
            else value += 0.4;
        });

        // Give very high weight to ones in the center because those will decide the game.
        var dist;
        if (game.symmetry === utils.VERTICAL) {
            dist = Math.abs(loc[0] - game.map.length/2);
        } else {
            dist = Math.abs(loc[1] - game.map.length/2);
        }

        // The "contention" multipliers only apply once so do it for our side.
        // Once we have claimed our side of the contention it is time to move on.
        // Only once we've done all those then we realize our winning (and go on to win).
        if (utils.on_our_side(game, loc)) {
            if (steps < 60) { // Only focus on the center at the start
                // afterwards, don't forget the back
                if (dist <= 4) value *= 6;
                else if (dist <= 6) value *= 6;
                else if (dist <= 8) value *= 4;
                else if (dist <= 10) value *= 2;
                else if (dist <= 12) value *= 1.5;
            }
        } else {
            value /= 30; // Give MUCH less priorites on opponent forces until we get our own shit sorted.
            // This is necessary because our knowledge of the opponent is not accurate since we don't have scouts.
            // We are prone to assume that the opponent squares are unoccupued even though they are. So we adjust
            // this algorithm manually here to disregard that.
        }

        byvalue.push([value, loc]);
    });

    var by_potential = [];

    // We want to find nodes that will improve the "potential"
    var currpotential = get_potential(game, steps, byvalue, station_locs);
    byvalue.forEach(v => {
        var [_, l] = v;
        var potential = get_potential(game, steps, byvalue, station_locs.concat([l]));
        var mindist = (1<<30);
        var min_loc = [null, null];
        station_locs.forEach(s => {
            var tmp = Math.sqrt(utils.dist(s, l));
            if (tmp < mindist) {
                mindist = tmp;
                min_loc = s;
            }
        });
        potential *= (mindist + BUILD_POTENTIAL_COST_CONST); // +10 to account that multiple legs are worse than single legs
        var key = v[0]*64+v[1];
        if (key in expansion_attempts) {
            potential *= Math.pow(0.7, expansion_attempts[key]);
        }
        by_potential.push([potential, l]);
    });

    by_potential.sort((a, b) => a[0] - b[0]);
    return by_potential.map(a => a[1]);
}

// Remember that this depends on all (potentially) 3 castles arriving on the same conclusion and executing
// synchronously, so to avoid needing to communicate amongst them.
function canonical_strategic_move(game, steps, known_stations) {
    var station_locs = known_stations.map(s => [s.x, s.y]);
    if (game.karbonite >= 50 && game.fuel >= 200) resources_replenished = true;
    if (known_stations.length > last_num_stations) resources_replenished = true;

    // Consider adjusting resources
    var [kgoal, fgoal] = macro.recommend_params(game, steps, castles_remaining, enemy_castles_remaining, game.karbonite_squares,
        game.fuel_squares, Object.keys(karbonite_control).length, Object.keys(fuel_control).length, warrior_health, worker_health);
    
    if (Math.abs(kgoal - game.karbonite_target) / Math.min(kgoal, game.karbonite_target) > 0.5) {
        if (Math.abs(fgoal - game.fuel_target) / Math.min(fgoal, game.fuel_target) > 0.5) {
            if (steps >= 50) {
                if (steps % 10 === 0) {
                    game.log("Updating emission targets to " + kgoal + " " + fgoal);
                    return [RESOURCE_TARGETS, [kgoal, fgoal]];
                }
            }
        }
    }

    // Consider building churches.
    var available_groups_list = get_unused_groups(game, steps);

    available_groups_list.filter(g => {
        var [loc, group] = g;

        if (is_enemy_fortified(loc)) {
            return false;
        }
        if (game.karbonite < 50 && is_already_doing(loc)) {
            // Probably strapped for karbonite to build church, just wait for it
            return null;
        }
    })

    var to_build_list = sorted_build_list(game, steps, available_groups_list, station_locs);
    // Just get the top tobuild. Just do it.
    var to_build = null;
    if (to_build_list.length) to_build = to_build_list[0];

    if (to_build && !utils.in_distress(game, steps) && resources_replenished) {
        last_num_stations = known_stations.length;
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
        if (game.karbonite < 10 || game.fuel < 50) return [null, null];
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

        anticipated_church_loc = [arg[0], arg[1]]; // Don't have to wait for castle to send back coords to send out
        var key = arg[0]*64+arg[1];
        if (!(key in expansion_attempts)) {
            expansion_attempts[key] = 0;
        }
        expansion_attempts[key] ++;
        // another expedition
        if (castle.id === game.me.id) {
            // we should do something
            if (church.id === game.me.id) {
                // we are the expander.
                throttle[code] = steps + Math.max(10, (steps-100)/5) + Math.sqrt(utils.dist(arg, [game.me.x, game.me.y]));
                return launch_expedition(game, arg);
            } else {
                // signal to the church
                // It will take about manhatten distance before we suspect the pilgrim
                // died somewhere.
                game.log("Launching expedition");
                var cx = known_friends[church.id].x, cy = known_friends[church.id].y;
                throttle[code] = steps + Math.max(10, (steps-100)/5) + Math.sqrt(utils.dist(arg, [cx, cy]));
                resources_replenished = false;
                return [
                    null,
                    [new Message("start_expedition", arg[0], arg[1]), 
                        utils.dist([game.me.x, game.me.y], [cx, cy])
                    ]
                ];
            }

            // If we're going into opponent, expect to want to wait a bit longer if it fails
            if (!utils.on_our_side(game, arg)) {
                throttle[code] *= 3;
            }
        } else {
            // Wanted to build something but it's not my business.
        }
    } else if (type === RESOURCE_TARGETS) {
        if (game.fuel < game.map.length) return [null, null];

        throttle[code] = steps + 20;
        // Pick guy with smallest distance to furtherest unit
        var chosen_one = utils.argmax(known_stations, f => {
            if (f.unit !== SPECS.CASTLE) return null;
            var maxdis = 0;
            known_stations.forEach(g => {
                maxdis = Math.max(maxdis, utils.dist([g.x, g.y], [f.x, f.y]));
            });
            return -maxdis;
        });

        if (chosen_one.id === game.me.id) {
            var maxdis = 0;
            known_stations.forEach(g => {
                maxdis = Math.max(maxdis, utils.dist([g.x, g.y], [game.me.x, game.me.y]));
            });
            var [ek, ef] = macro.emission_params(arg[0], arg[1]);
            return [null, [new Message("emission", ek, ef), maxdis]];
        }
    }

    // 2. Do we have the resources?
    
    return [null, null];
}

function init(game) {
    var [_c, _g] = farm.get_church_locations(game);
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

var max_escorts = 0;
var target_escorts = 0;
var last_call_on = -(1<<30);
var last_distress_on = -(1<<30);

const CRITICAL_MASS = 100;
const BACKUP_DELAY = 5;
const DISTRESS_DELAY = 15;

function get_backup_message(game, steps, enemies, range=64) {
    var closest = utils.argmax(enemies, f => {
        if (!warrior.is_warrior(f.unit)) return null;
        return -utils.dist([game.me.x, game.me.y], [f.x, f.y]);
    });

    if (closest) {
        if (utils.dist([closest.x, closest.y], [game.me.x, game.me.y]) <= 64) {
            last_call_on = steps;
            // yes. Yes we do.
            return [new Message("attack", closest.x, closest.y), range];
        }
    }
    return null;
}

var last_savior_loc = [null, null];
var num_built = 0;

function defense(game, steps, enemies, predators, prey, friends) {
    var precaution_build = false;
    if (steps === 4) {
        // analyse the meta. Things close to the front should have a backup archer now.
        var mydist;
        if (game.symmetry === utils.VERTICAL) {
            mydist = Math.abs(game.map[0].length/2 - game.me.x);
        } else mydist = Math.abs(game.map.length/2 - game.me.y);

        var closest_castle = true;
        var my_castles = filter_known_friends((i, u, x, y) => u === SPECS.CASTLE);
        my_castles.forEach(c => {
            if (c.id === game.me.id) return;
            var dist;
            if (game.symmetry === utils.VERTICAL) {
                dist = Math.abs(game.map[0].length/2 - c.x);
            } else dist = Math.abs(game.map.length/2 - c.y);
            if (dist < mydist) {
                closest_castle = false;
            }
        });

        if (closest_castle && mydist < 14) {
            precaution_build = true; 
        }
    }

    var msg = null;

    // check if we need our bots to back us up
    // Do we need to call for backup?
    if (steps > last_call_on + BACKUP_DELAY) {
        msg = get_backup_message(game, steps, enemies);
    }

    // Calculate how much castles / churches should have.
    // Calculate how much of it goes to my castle.
    // Calculate what I have.
    // Calculate whether we should build given resources.

    var castle_church_ratio = (castles_remaining * 3 + 10) / ((Object.keys(karbonite_control).length + Object.keys(fuel_control).length) / 4 + 1);
    castle_church_ratio = Math.min(0.9, castle_church_ratio);
    castle_church_ratio = Math.max(0.3, castle_church_ratio);


    var total_castle_reo = 0;
    var my_reo = 0;

    var my_castles = filter_known_friends((i, u, x, y) => u === SPECS.CASTLE);
    for (var id in known_friends) {
        var f = known_friends[id];
        if (warrior.is_warrior(f.unit)) {
            my_castles.forEach(c => {
                if (utils.dist([c.x, c.y], [f.x, f.y]) < 100) {
                    total_castle_reo++;
                    if (c.id === game.me.id) my_reo++;
                }
            });
        }
    }

    var total_castle_target_reo = n_warriors * castle_church_ratio;

    var total_contrib = 0;
    var my_contrib = 0;
    my_castles.forEach(c => {
        var contrib = 0;
        if (game.symmetry === utils.VERTICAL) {
            contrib = 1/(Math.abs(c.x - game.map[0].length/2)+10);
        } else {
            contrib = 1/(Math.abs(c.y - game.map.length/2)+10);
        }

        if (c.id === game.me.id) my_contrib += contrib;
        total_contrib += contrib;
    });

    var my_target_reo = my_contrib / total_contrib * total_castle_target_reo;

    // Now analyse enemies
    var enemy_threat = 0;
    var seen = {};
    enemies.forEach(r => {
        seen[r.id] = true;
        if (warrior.is_warrior(r.unit)) enemy_threat += 3;
        else enemy_threat += 1;
    });

    var phantom_threat = 0;
    enemy_warrior_sightings.forEach(e => { // Helps to not react too late
        var [_, x, y] = e; 
        if (utils.dist([x, y], [game.me.x, game.me.y]) < 250) {
            phantom_threat += 0.2;
        }
    });

    phantom_threat = Math.min(phantom_threat, 5);
    enemy_threat += phantom_threat;

    my_target_reo = Math.max(my_target_reo, enemy_threat);

    var should_build = false;
    if (my_target_reo > my_reo) {
        
        if (predators.length || my_reo < enemy_threat) should_build = true;
        if (game.karbonite >= 75) {
            var bottleneck_resource = Math.min(game.karbonite / game.karbonite_target, game.fuel / game.fuel_target);
            if (my_reo / my_target_reo < bottleneck_resource) should_build = true;
        }
    }

    if (game.fuel > game.fuel_target && game.karbonite > game.karbonite_target) should_build = true;

    if (steps < 5) should_build = false;
    if (precaution_build) should_build = true;
    
    // Sometimes, in the early game we run out of karbonite and are outmatched. Call for dire assistance
    if (my_reo*2 < enemy_threat && game.karbonite < 70) {
        if (last_distress_on + DISTRESS_DELAY < steps) {
            var closest = utils.argmax(enemies, f => {
                if (!warrior.is_warrior(f.unit)) return null;
                return -utils.dist([game.me.x, game.me.y], [f.x, f.y]);
            });

            if (!closest) {
                closest = utils.argmax(enemy_warrior_sightings, f=> {
                    return -utils.dist([f[1], f[2]], [game.me.x, game.me.y]);
                });
                closest = [closest[1], closest[2]];
            } else closest = [closest.x, closest.y];

            if (closest) {
                last_distress_on = steps;
                game.log("requesting dire assistance");
                var range = game.map[0].length*game.map[0].length;
                range -= range%10;
                range += game.me.id%10; // Password for this thing
                game.last_castle_distress = steps;
                msg = [new Message("castle_distress", Math.floor((closest[0]+game.me.x)/2), Math.floor((closest[1]+game.me.y)/2)), range];
            }
        }
    }

    if (should_build) {
        game.log("decided to build.");
        var savior = SPECS.PROPHET;
        var preacher_rush = false;
        
        enemies.forEach(r => {
            if (r.unit === SPECS.PREACHER) preacher_rush++;
        });

        if (preacher_rush) savior = SPECS.PREACHER;
        else if (steps >= macro.MIDGAME_STEPS && num_built % 4 !== 0 && enemies.length === 0) { // Up the crusader ratio in the endgame.
            savior = SPECS.CRUSADER;
        }

        var turtle = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
            if (game.map[y][x] === false) return null;
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            var same = x === last_savior_loc[0] && y === last_savior_loc[1];

            if (savior === SPECS.PREACHER) {
                // If it's preacher, top right and top left diagonals preferred, alternating
                if (utils.on_our_side(game, [game.me.x, game.me.y], [x, y])) {
                    if (game.me.x !== x && game.me.y !== y) {
                        return 2 - same*2;
                    } else return 0 - same*2; // straight up / side to side, not ideal but whatevs
                }
                return -3; // do NOT send a preacher backwards unless forced
            } else if (savior === SPECS.PROPHET) {
                if (utils.on_our_side(game, [game.me.x, game.me.y], [x, y]) && utils.on_our_side(game, [x, y], [game.me.x, game.me.y])) {
                    // send prophet sideways
                    return 2 - same*2;
                } else {
                    // diagonal is cool too
                    if (x !== game.me.x && y !== game.me.y) return 1 - same*2;
                    return 0-same*2; // forwards or back wards directly not as cool.
                }
            }
        });

        if (turtle[0] !== null) {
            last_savior_loc = turtle;
            if (game.karbonite >= SPECS.UNITS[savior].CONSTRUCTION_KARBONITE &&
                game.fuel >= SPECS.UNITS[savior].CONSTRUCTION_FUEL) {
                if (!msg) msg = get_backup_message(game, steps, enemies, 2);
                num_built++;
                return [game.buildUnit(savior, turtle[0]-game.me.x, turtle[1]-game.me.y), msg];
            }
        }
    }

    // didn't build. Try just attacking
    if (prey.length) {
        var tohit = utils.argmax(prey, r => utils.threat_level(game, r));
        return [game.attack(tohit.x-game.me.x, tohit.y-game.me.y), msg];
    }

    return [null, msg];
}

var order_66 = false;

export function turn(game, steps, enemies, predators, prey, friends) {
    game.log("enemy warrior sightings: " + enemy_warrior_sightings.length);
    game.log("civilians: " + enemy_civilian_sightings.length);


    var clearing_comps = 5000;

    clearing_freq = Math.ceil((enemy_warrior_sightings.length + enemy_civilian_sightings.length) * Object.keys(known_friends).length / clearing_comps);

    game.log("it is now turn " + steps);
    if (implied_enemy_castles === null) init_implied_castles(game);
    if (game.me.turn === 1) {
        known_friends[game.me.id] = {id:game.me.id, unit:game.me.unit, x:game.me.x, y:game.me.y};
        on_birth(game, game.me, game.me.unit);
        on_ping(game, game.me, [game.me.x, game.me.y]);
    }
    if (order_66) {
        return farm.execute_order_66(game);
    }
    // Observe
    if (church_locs === null) init(game);
    prune_known_enemies(game, steps);

    var groups = get_unused_groups(game, steps);
    game.log("enemy warrior sightings:");
    game.log(enemy_warrior_sightings);
    game.log("enemy civilian sightings:");
    game.log(enemy_civilian_sightings);
    game.log("groups:");
    groups.forEach(g => {
        game.log(g[0] + " " + is_enemy_fortified(g[0]) + " " + is_enemy_occupied(g));
    });
    game.log("karbonite_control: " + Object.keys(karbonite_control).length);
    game.log(karbonite_control);
    game.log("fuel_control: " + Object.keys(fuel_control).length);
    game.log(fuel_control);

    if (steps > ENDGAME_POSSIBLE_THRESHOLD) { // save computing with this condition
        var endgame = macro.is_endgame(game, steps, castles_remaining, enemy_castles_remaining, known_friends);
        if (endgame) {
            order_66 = true;
            return [null, [new Message("order66"), game.map.length*game.map.length]];
        }
    }
    
    // Execute
    var action = null, msg = null;

    // Priority 1. Protect thyself
    if (!action && !msg) {
        var [action, msg] = defense(game, steps, enemies, predators, prey, friends);
    }

    if (!action && !msg) {
        // Priority 2. Strategic calls
        if (steps > 6) { // wait till we know all the castles
            var known_stations = filter_known_friends((i, u, x, y) => 
                (u === SPECS.CASTLE || u === SPECS.CHURCH) && x !== undefined && x !== null && y !== undefined && y !== null
            );
            var strategy = canonical_strategic_move(game, steps, known_stations);
            if (strategy) var [action, msg] = i_should_do(game, steps, strategy, known_stations);
        }
    }
    

    // Priority 3. Autopilot farming
    if (!action && !msg) {
        if ((predators.length === 0 && prey.length === 0) || game.karbonite >= 70) {
            var [action, msg] = farm.turn(game, steps, enemies, friends);
        }
    }

    // Priority 4. Passive turtling.
    if (!action && !msg) {
        var turtle = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            return Math.random();
        });

        if (turtle[0] !== null) {
            //action = game.buildUnit(SPECS.PROPHET, turtle[0]-game.me.x, turtle[1]-game.me.y);
        }
    }

    return [action, msg];
}
