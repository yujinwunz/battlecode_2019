import {BCAbstractRobot, SPECS} from 'battlecode';
import {turn as attacker_turn} from 'attacker.js';
import * as utils from 'utils.js';
import * as nav from 'nav.js';

const params = {
    ORBIT_DIST_CASTLE: 16,
    ORBIT_DIST_MOBILE: 4,
    MARCH_GAP: 2,
};

export function turn(game, steps) {
    game.log("I am a crusaider: " + game.me.id);
    return attacker_turn(game, steps, params, (in_range, exposed_to, confronting, other, friendly, target, is_defending, target_loc) => { 
        // Always attack if threatened
        if (confronting.length) {
            game.log("confronting some guys");
            confronting.sort((a, b) => utils.threat_level(game, a) - utils.threat_level(game, b));
            return game.attack(confronting[0].x - game.me.x, confronting[0].y - game.me.y);
        } else if (in_range.length) {
            game.log("attacking in range");
            in_range.sort((a, b) => utils.threat_level(game, a) - utils.threat_level(game, b));
            return game.attack(in_range[0].x - game.me.x, in_range[0].y - game.me.y);
        } else if (exposed_to.length) {
            game.log("exposed to");
            game.log(exposed_to);
            // fight or flight?
            // Exposed to would consist of only preachers.
            var opp_strength = 0;
            if (is_defending) {
                game.log(exposed_to);
                exposed_to.sort((a, b) => 
                    utils.dist([a.x, a.y], target_loc) - 
                    utils.dist([b.x, b.y], target_loc)
                );
            } else {
                exposed_to.sort((a, b) =>
                    utils.dist([game.me.x, game.me.y], [a.x, a.y]) -
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
                var to = nav.build_map(game.map, [approach.x, approach.y], 9, nav.GAITS.RUN, game.getVisibleRobots(), 5);
                var [nx, ny] = nav.path_step(to, [game.me.x, game.me.y], 9, game.getVisibleRobots());
                game.log("moving to " + (game.me.x-nx) + " " + (game.me.y - ny));
                return game.move(game.me.x - nx, game.me.y - ny);
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
    });
}
