import {BCAbstractRobot, SPECS} from 'battlecode';
import {Message, decode} from 'message.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';

// General strategy:
// On birth, guard the mother castle/church.
// Commands can be: 
// 1. Cover unit (from unit itself)
// 2.            (from a castle (for fuel efficiency on communication))
// 3. 

const DEFENDING = 0;
const ATTACKING = 1;

var target_loc = null; // null when unavailable.
var target_id = null;
var target_unit = null;
var target_map_loc = [null, null];
var target_map = null;

var state;

var home_loc = null;

// Check for signals.
function listen(game) {
    var robots = game.getVisibleRobots();
    robots.forEach(r => {
        if ("signal" in r && r.signal !== -1) {
            var raw = r.signal;
            var x = r.x, y = r.y;
            
            var msg = decode(raw, r);
            if (msg.type === "void_signature" || msg.type === "void") {
                // I'm tempted to assume we saw an enemy or something. But it
                // could just make things hard to debug.
                game.log("Error: void message received " + raw + " from " + r.x + " " + r.y);
                game.log("Message type: " + msg.type);
            } else if (msg.type === "requesting_backup") {
                game.log("got backup request from " + r.x + " " + r.y);
                state = DEFENDING;
                target_loc = [r.x, r.y];
                target_id = r.id;
                target_unit = r.unit;
            }
        }
    });
}

function get_vip(friendly) {
    for (var i = 0; i < friendly.length; i++) {
        if (friendly[i].id === target_id) return friendly[i];
    }
    return null;
}

export function turn(game, steps) {
    var robots = game.getVisibleRobots();
    var action = null;
    var cols = game.map[0].length;
    var rows = game.length;
    game.log("I am a crusaider: " + game.me.id);
    var [in_range, exposed_to, confronting, other, friendly, target] = utils.look(game, target_id);
    if (target) {
        target_loc = [target.x, target.y];
        target_unit = target.unit;
    }

    if (steps === 1) {
        game.log("Setting home");
        var home = utils.get_home(game, friendly);
        home_loc = [home.x, home.y];
        target_id = home.id;
        target_loc = [home.x, home.y];
        target_unit = home.unit;
        game.log("Setting home " + target_loc[0] + " " + target_loc[1]);
        state = DEFENDING;
    }

    listen(game);

    // Always attack if threatened
    if (confronting.length) {
        game.log("confronting some guys");
        confronting.sort((a, b) => utils.threat_level(game, a) - utils.threat_level(game, b));
        action = game.attack(confronting[0].x - game.me.x, confronting[0].y - game.me.y);
    } else if (in_range.length) {
        game.log("attacking in range");
        in_range.sort((a, b) => utils.threat_level(game, a) - utils.threat_level(game, b));
        action = game.attack(in_range[0].x - game.me.x, in_range[0].y - game.me.y);
    } else if (exposed_to.length) {
        game.log("exposed to");
        // fight or flight?
        // Exposed to would consist of only preachers.
        var opp_strength = 0;
        if (state === DEFENDING) {
            game.log(exposed_to);
            exposed_to.sort((a, b) => 
                utils.dist([a.x, a.y], target_loc) - 
                utils.dist([b.x, b.y], target_loc)
            );
        } else {
            exposed_to.sort((a, b) =>
                utils.dist([game.me.x, game.me.y], [a.x, a.y]),
                utils.dist([game.me.x, game.me.y], [b.x, b.y])
            );
        }

        var approach = exposed_to[0];
        exposed_to.forEach(r => {
            if (utils.dist([approach.x, approach.y], [r.x, r.y]) <= utils.SQUAD_CAUTION_DIST) {
                opp_strength ++;
            }
        });
        

        if (opp_strength <= 1 || true) { // fight
            game.log("fighting, not flighting");
            var to = nav.build_map(game.map, [approach.x, approach.y], 9, nav.GAITS.RUN, robots, 5);
            var [nx, ny] = nav.path_step(to, [game.me.x, game.me.y], 9);
            action = game.move(game.me.x - nx, game.me.y - ny);
        } else { // or flight
            game.log("flight mode");
            var best_score = 0;
            var best_loc = [null, null];
        }
    } else if (other.length) {
        // approach or ignore?
        // Ignore for now.
        game.log("ignoring other enemies");
    }
    
    if (action === null) {
        // no enemies, so cruise
        if (state === DEFENDING) {
            game.log("Defending vip at " + target_loc[0] + " " + target_loc[1] + " id " + target_id);
            // make cluster formation.
            // Add points for closeness to target, but take points away
            // for being too close to something.
            var target_moved = false;
            if (target_map_loc[0] !== target_loc[0] || target_map_loc[1] !== target_loc[1]) {
                target_map = nav.build_map(game.map, target_loc, 9, nav.GAITS.JOG, robots);
                target_map_loc = [target_loc[0], target_loc[1]];
                target_moved = true;
            }
            var bestscore = -(1<<30);
            var bestto = null;

            for (var dx = -3; dx <= 3; dx++) {
                for (var dy = -3; dy <= 3; dy++) {
                    if (dx*dx + dy*dy > 9) continue;
                    var nx = game.me.x + dx, ny = game.me.y + dy;
                    if (nx < 0 || nx >= cols) continue;
                    if (ny < 0 || ny >= cols) continue;
                    if (target_map[ny][nx] === null) continue;
                    var score = - Math.sqrt(target_map[ny][nx][0]);

                    var min_neigh = -(1<<30);
                    var orbit_dist = utils.ORBIT_DIST_MOBILE;
                    if (target_unit === SPECS.CASTLE || target_unit === SPECS.CHURCH) {
                        orbit_dist = utils.ORBIT_DIST_CASTLE;
                    }
                    friendly.forEach(r => {
                        if (r.id === game.me.id) { 
                        } else if (r.id === target_id) {
                            if (r.x !== nx || r.y !== ny)
                            min_neigh = Math.max(min_neigh, 100 / Math.min(orbit_dist, utils.dist([r.x, r.y], [nx, ny]))) * 5;
                            else min_neigh = (1<<30);
                        } else {
                            if (r.x !== nx || r.y !== ny) {
                                if (r.unit !== SPECS.PILGRIM) // ignore pilgrim back-and-forth movements
                            min_neigh = Math.max(min_neigh, 100 / Math.min(utils.MARCH_GAP, utils.dist([r.x, r.y], [nx, ny])));
                            } else min_neigh = (1<<30);
                        }
                    });
                    score -= min_neigh;
                    if (!target_moved) score -= (dx*dx+dy*dy)*2;

                    if (score > bestscore) {
                        bestscore = score;
                        bestto = [dx, dy];
                    }
                }
            }

            if (bestto) {
                if (bestto[0] !== 0 || bestto[1] !== 0) {
                    action = game.move(bestto[0], bestto[1]);
                } else action = game.proposeTrade(0, 0); // NULL action
            }
        } else if (state === ATTACKING) {
            // TODO
        }
    }

    return action;
}
