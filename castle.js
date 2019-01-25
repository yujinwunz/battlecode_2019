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

const MOBILE_ENEMY_DECAY = 30; // without seeing an enemy for that long assume it's dead

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

// These are received before turn is called.
export function on_birth(game, r, unit) {
    var id = r.id;
    game.log("Birth of " + id + " type " + unit);
    known_friends[id] = {unit, id};
    if (unit === SPECS.CASTLE) {
        castles_remaining++;
        enemy_castles_remaining++; // implication
    }

    if (warrior.is_warrior(unit)) {
        warrior_health += SPECS.UNITS[unit].STARTING_HP;
        n_warriors++;
    }
    else worker_health += SPECS.UNITS[unit].STARTING_HP;
}

export function on_ping(game, r, loc) {
    game.log("ping from");
    game.log(r);
    if (!(r.id in known_friends)) {
        known_friends[r.id] = {id:r.id};
        if ("unit" in r) known_friends[r.id].unit = r.unit;
        else known_friends[r.id].unit = SPECS.PROPHET;
    }
    var id = r.id;
    if (loc[0] !== null) known_friends[id].x = loc[0];
    if (loc[1] !== null) known_friends[id].y = loc[1];

    if ("unit" in known_friends[id] && "x" in known_friends[id] && "y" in known_friends[id] && r.turn > 10) {
        // Receiving a heartbeat means there are no enemies in sight.
        // On record, forget all known enemy castles and churches in it's vision range.
        if (!(id in known_friends)) {
            game.log("Ping from the dead:");
            game.log(id);
            game.log(known_friends);
        }

        var unit = known_friends[id].unit;
        if (unit === SPECS.CASTLE || unit === SPECS.CHURCH) {
            utils.iterlocs(game.map[0].length, game.map.length, loc, farm.RESOURCE_MAX_R, (x, y) => {
                if (game.karbonite_map[y][x]) karbonite_control[y*64+x] = true;
                if (game.fuel_map[y][x]) fuel_control[y*64+x] = true;
            });
        }
        implied_enemy_castles.forEach(f => {
            if (utils.dist(f, [known_friends[id].x, known_friends[id].y]) <= SPECS.UNITS[known_friends[id].unit].VISION_RADIUS) {
                game.log("observed the defeat of enemy castle at " + f[0] + " " + f[1]);
                enemy_castles_remaining--;
            }
        });
        implied_enemy_castles = implied_enemy_castles.filter(f => 
            utils.dist(f, [known_friends[id].x, known_friends[id].y]) > SPECS.UNITS[known_friends[id].unit].VISION_RADIUS
        );
    }
}

export function on_death(game, id) {
    if (!(id in known_friends)) {
        game.log("death from the dead:");
        game.log(id);
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
                if (game.karbonite_map[y][x]) delete karbonite_control[y*64+x];
                if (game.fuel_map[y][x]) delete fuel_control[y*64+x];
            });
        }
    }

    game.log("Death of " + id);
    if (unit === SPECS.CASTLE) castles_remaining--;
    delete known_friends[id];
}

export function on_warrior_sighting(game, steps, r, dx, dy) {
    game.log("warrior sighting called");
    if (!(r.id in known_friends)) return;
    var r = known_friends[r.id];
    if ("x" in r && "y" in r) {
        game.log("warrior sighted " + (r.x+dx*2-7) + " " + (r.y+dy*2-7));
        enemy_warrior_sightings.push([steps, r.x + dx*2-7, r.y + dy*2-7]);
    }
}

export function on_civilian_sighting(game, steps, r, dx, dy) {
    if (!(r.id in known_friends)) return;
    var r = known_friends[r.id];
    if ("x" in r && "y" in r) {
        enemy_civilian_sightings.push([steps, r.x + dx*2-7, r.y + dy*2-7]);
    }
}

const MEMORY = 10;

function prune_known_enemies(game, steps) {
    while (enemy_civilian_sightings.length > 0 && enemy_civilian_sightings[0][0] + MEMORY < steps) enemy_civilian_sightings.shift(0); 
    while (enemy_warrior_sightings.length > 0 && enemy_warrior_sightings[0][0] + MEMORY < steps) enemy_warrior_sightings.shift(0); 
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
        var code = getcode([EXPAND, c]); // to avoid having to wait for one
                                                  // to finish before building another
        if (ok) churches_to_go.push(c);
    })

    return churches_to_go;
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
            if (utils.dist([r.x, r.y], loc) < 36) occupation++;
        }
    }
    return occupation;
}

var resources_replenished = true;
var last_num_stations = 0;

function canonical_strategic_move(game, steps, known_stations) {
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
    var to_build_list = get_unused_churches(game, steps);

    // To choose a next place, consider A) if it's fortified B) if it's occupied
    // If it's fortified or occupied, we must clear it first. Then we expand later.

    // Finally, don't build on opponent side until available our sides are done.
    var to_build = utils.argmax(to_build_list, loc => {

        if (is_enemy_fortified(loc)) {
            game.log(steps + " is fortified: " + loc[0] + " " + loc[1] + ": " + is_enemy_fortified(loc));
            return null;
        }
        if (is_enemy_occupied(loc)) {
            game.log(steps + " is occupied: " + loc[0] + " " + loc[1] + ": " + is_enemy_occupied(loc));
            return null;
        }
        if (game.karbonite < 50 && is_already_doing(loc)) {
            // Probably strapped for karbonite to build church, just wait for it
            game.log(steps + " is already doing: " + loc[0] + " " + loc[1]);
            return null;
        }

        var mindis = (1<<30);
        known_stations.forEach(m => {
            mindis = Math.min(mindis, utils.dist([m.x, m.y], loc))
        });
        if (utils.on_our_side(game, loc)) {
            return -mindis;
        } else {
            return -mindis - 1000;
        }
    });

    if (to_build && !utils.in_distress(game, steps) && resources_replenished) {
        resources_replenished = false;
        last_num_stations = known_stations.length;
        game.log(steps + " Considering building at " + to_build[0] + " " + to_build[1]);
        return [EXPAND, to_build]; 
    }

    game.log("No strategic decision");
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

        game.log("Sending emission from " + chosen_one.id);
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
            game.log("requesting assistance");
            // yes. Yes we do.
            return [new Message("attack", closest.x, closest.y), range];
        }
    }
    return null;
}

function defense(game, steps, enemies, predators, prey, friends) {
    var precaution_build = false;
    if (steps === 1) {
        // analyse the meta. Things close to the front should have a backup archer now.
        var dist;
        if (game.symmetry === utils.VERTICAL) {
            dist = Math.abs(game.map[0].length/2 - game.me.x);
        } else dist = Math.abs(game.map.length/2 - game.me.y);

        if (dist <= 18) {
            game.log("precaution build");
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

    game.log("castle_church_ratio: " + castle_church_ratio);

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
    game.log(my_contrib + " " + total_contrib + " " + total_castle_target_reo);

    var my_target_reo = my_contrib / total_contrib * total_castle_target_reo;
    game.log("Hoping to reach " + my_target_reo + " reinforcements. We have " + my_reo);
    game.log("kt k ft f " + game.karbonite_target + " " + game.karbonite + " " + game.fuel_target + " " + game.fuel);

    // Now analyse enemies
    var enemy_threat = 0;
    var seen = {};
    enemies.forEach(r => {
        seen[r.id] = true;
        game.log("seen " + r.id);
        if (warrior.is_warrior(r.unit)) enemy_threat += 3;
        else enemy_threat += 1;
    });

    enemy_warrior_sightings.forEach(e => { // Helps to not react too late
        var [_, x, y] = e; 
        game.log("inferring enemy");
        game.log(e);
        if (utils.dist([x, y], [game.me.x, game.me.y]) < 250) {
            game.log("added to enemy threat");
            enemy_threat += 1;
        }
    });

    my_target_reo = Math.max(my_target_reo, enemy_threat);

    var should_build = false;
    if (my_target_reo > my_reo) {
        
        if (predators.length || my_reo < enemy_threat) should_build = true;
        game.log("predator: " + predators.length + " enemy threat " + enemy_threat + " my reo " + my_reo);
        if (game.karbonite >= 75) {
            var bottleneck_resource = Math.min(game.karbonite / game.karbonite_target, game.fuel / game.fuel_target);
            if (my_reo / my_target_reo < bottleneck_resource) should_build = true;
        }
    }

    if (game.fuel > game.fuel_target && game.karbonite > game.karbonite_target) should_build = true;

    if (steps < 5) should_build = false;
    if (precaution_build) should_build = true;
    
    // Sometimes, in the early game we run out of karbonite and are outmatched. Call for dire assistance
    if (my_reo < enemy_threat && game.karbonite < 150) {
        if (last_distress_on + DISTRESS_DELAY < steps) {
            game.log("Calling for dire assistance");
            var closest = utils.argmax(enemies, f => {
                if (!warrior.is_warrior(f.unit)) return null;
                return -utils.dist([game.me.x, game.me.y], [f.x, f.y]);
            });

            if (!closest) {
                closest = utils.argmax(enemy_warrior_sightings, f=> {
                    return -utils.dist([f[1], f[2]], [game.me.x, game.me.y]);
                });
            } else closest = [closest.x, closest.y];

            if (closest) {
                last_distress_on = steps;
                game.log("requesting dire assistance");
                var range = Math.max(200, Math.ceil(game.map.length*game.map.length));
                range -= range%10;
                range += game.me.id%10; // Password for this thing
                game.last_castle_distress = steps;
                msg = [new Message("castle_distress", Math.round((closest[0]+game.me.x)/2), Math.round((closest[0]+game.me.y)/2)), range];
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

        var turtle = utils.iterlocs(game.map[0].length, game.map.length, [game.me.x, game.me.y], 2, (x, y) => {
            if (game.map[y][x] === false) return null;
            if (utils.robots_collide(friends, [x, y])) return null;
            if (utils.robots_collide(enemies, [x, y])) return null;
            return Math.random();
        });

        if (turtle[0] !== null) {
            if (game.karbonite >= SPECS.UNITS[savior].CONSTRUCTION_KARBONITE &&
                game.fuel >= SPECS.UNITS[savior].CONSTRUCTION_FUEL) {
                if (!msg) msg = get_backup_message(game, steps, enemies, 2);
                return [game.buildUnit(savior, turtle[0]-game.me.x, turtle[1]-game.me.y), msg];
            }
        }
    }

    // didn't build. Try just attacking
    if (prey.length) {
        game.log("default to attacking");
        var tohit = utils.argmax(prey, r => utils.threat_level(game, r));
        return [game.attack(tohit.x-game.me.x, tohit.y-game.me.y), msg];
    }

    return [null, msg];
}

var order_66 = false;

export function turn(game, steps, enemies, predators, prey, friends) {
    if (game.me.turn === 1) {
        known_friends[game.me.id] = {id:game.me.id, unit:game.me.unit, x:game.me.x, y:game.me.y};
    }
    if (order_66) {
        return farm.execute_order_66(game);
    }
    // Observe
    if (church_locs === null) init(game);
    prune_known_enemies(game, steps);
    
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
                u === SPECS.CASTLE || u === SPECS.CHURCH
            );
            if (implied_enemy_castles === null) init_implied_castles(game);
            var strategy = canonical_strategic_move(game, steps, known_stations);
            if (strategy) var [action, msg] = i_should_do(game, steps, strategy, known_stations);
        }
    }
    

    // Priority 3. Autopilot farming
    if (!action && !msg) {
        var [action, msg] = farm.turn(game, steps, enemies, friends);
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
