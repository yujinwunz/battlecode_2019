import {BCAbstractRobot, SPECS} from 'battlecode';
import {turn as attacker_turn} from 'attacker.js';
import * as utils from 'utils.js';

const params = {
    ORBIT_DIST_CASTLE: 9,
    ORBIT_DIST_MOBILE: 2,
    MARCH_GAP: 1,
};

function run_away(game, threatening) {
    game.log("running away from ");
    game.log(threatening);
    var low_score = [(1<<30), 0];
    var low_loc = [null, null];
    for (var dx = -2; dx <= 2; dx++) {
        for (var dy = -2; dy <= 2; dy++) {
            if (dx*dx + dy*dy > SPECS.UNITS[SPECS.PROPHET].SPEED) continue;
            var nx = game.me.x +dx, ny = game.me.y + dy;
            if (nx < 0 || nx >= game.map[0].length) continue;
            if (ny < 0 || ny >= game.map.length) continue;

            var mindist = (1<<30);
            var attack = 0;
            threatening.forEach(r => {
                var dist = utils.dist([r.x, r.y], [dx, dy]);
                mindist = Math.min(mindist, dist);
                if (utils.in_fire_range(r.unit, dist)) attack += SPECS.UNITS[r.unit].ATTACK_DAMAGE;
            });

            if (attack < low_score[0] || (low_score[0] === attack && mindist > low_score[1])) {
                low_score = [attack, mindist];
                low_loc = [nx, ny];
            }
        }
    }

    if (low_loc[0] !== null) {
        return game.move(low_loc[0]-game.me.x, low_loc[1].game.me.y);
    }
}

function step_back(game, inside, threatening) {
    game.log("stepping back from ");
    game.log(inside);
    game.log(threatening);
                //  attack threat, num inside, closest dist
    var low_score = [(1<<30), 0, 0];
    var low_loc = [null, null];
    
    for (var dx = -2; dx <= 2; dx++) {
        for (var dy = -2; dy <= 2; dy++) {
            if (dx*dx + dy*dy > SPECS.UNITS[SPECS.PROPHET].SPEED) continue;
            var nx = game.me.x +dx, ny = game.me.y + dy;
            if (nx < 0 || nx >= game.map[0].length) continue;
            if (ny < 0 || ny >= game.map.length) continue;

            var mindist = (1<<30);
            var attack = 0;
            var num_inside = 0;
            threatening.concat(inside).forEach(r => {
                var dist = utils.dist([r.x, r.y], [dx, dy]);
                if (dist < 16) num_inside++;
                mindist = Math.min(mindist, dist);
                if (utils.in_fire_range(r.unit, dist)) attack += SPECS.UNITS[r.unit].ATTACK_DAMAGE;
            });

            if (utils.arrcmp([attack, num_inside, -mindist], low_score) < 0) {
                low_score = [attack, low_loc, -mindist];
                low_loc = [nx, ny];
            }
        }
    }

    if (low_loc[0] !== null) {
        return game.move(low_loc[0]-game.me.x, low_loc[1].game.me.y);
    }
}

export function turn(game, steps) {
    game.log("I am a prophet: " + game.me.id);
    return attacker_turn(game, steps, params, (in_range, exposed, confronting, other, friendly, target, is_defending, target_loc) => {
        var enemies_threatening = [], enemies_benign = [], enemies_inside = [];
        game.getVisibleRobots().forEach(r => {
            if (!("team" in r)) return;
            if (!("unit" in r)) return;
            if (!("x" in r)) return;
            if (r.team === game.me.team) return;

            if (r.unit === SPECS.CHURCH || r.unit === SPECS.PILGRIM) enemies_benign.push(r);
            else enemies_threatening.push(r);
            if (utils.dist([game.me.x, game.me.y], [r.x, r.y]) < 16) enemies_inside.push(r);
        });
        
        if (confronting.length) {
            // are always enemy prophets, in which case just kill them plz
            confronting.sort((a, b) => utils.threat_level(game, a) - utils.threat_level(game, b));
            return game.move(confronting[0].x - game.me.x, confronting[0].y - game.me.y);
        } else if (exposed.length) {
            // are always enemies attacking me while inside my min radius. Run away.
            return run_away(game, enemies_threatening);
        } else if (in_range.length) {
            in_range.sort((a, b) => utils.threat_level(game, a) - utils.threat_level(game, b));
            return game.move(in_range[0].x - game.me.x, in_range[0].y - game.me.y);
        } else {
            if (enemies_inside.length) {
                // only benign enemies inside me now
                return step_back(game, enemies_inside, enemies_threatening);
            }
        }

        //
    });
}
