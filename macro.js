import * as utils from 'utils.js';

export const KARBONITE_LEVELS = [50, 70, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000]; // 16 vals
export const FUEL_LEVELS = [150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 50000, 75000]; // 16 vals

export function emission_params(karbonite, fuel) {
    var karb = 0, f = 0;
    for (var i = 0; i < 16; i++) {
        if (Math.abs(karbonite - KARBONITE_LEVELS[i]) < Math.abs(karbonite - KARBONITE_LEVELS[karb])) karb = i;
    }
    for (var i = 0; i < 16; i++) {
        if (Math.abs(fuel - FUEL_LEVELS[i]) < Math.abs(fuel - FUEL_LEVELS[f])) f = i;
    }
    return [karb, f];
}

// Assume we are equal and prepare for that.
export function recommend_params(game, steps, my_castles, opp_castles, karbonites, fuels, my_karbonites, my_fuels, my_warrior_health, my_worker_health) {
    var opp_threat = my_worker_health*0.3 + my_warrior_health + game.karbonite * 0.3;
    var fuel_target = 1.5 * opp_threat;
    var karbonite_target = .2 * opp_threat; // Always keep some karbonite as reserve.

    // Spare karbonite for versitility
    if (my_castles === 1) {
        karbonite_target *= 2;
    }
    return [karbonite_target, fuel_target];
}


// Should we expolode in a firework display of crusaders?
export function is_endgame(game, steps, my_castles, opp_castles, friends) {
    var turns_remaining = 1000 - steps;
    var num_builders = 0;
    friends.forEach(r => {
        if (r.unit === SPECS.CASTLE) num_builders++;
        else if (r.unit === SPECS.CHURCH) num_builders++;
    });

    var max_crusaders_by_karb = game.karbonite / SPECS.UNITS[SPECS.CRUSADER].CONSTRUCTION_KARBONITE;
    var max_crusaders_by_fuel = game.fuel / (SPECS.UNITS[SPECS.CRUSADER].CONSTRUCTION_FUEL + 30); // 30 for turtling movement

    var max_crusaders = Math.min(max_crusaders_by_karb, max_crusaders_by_fuel);
    
    var max_crusaders_by_time = num_builders * turns_remaining;
    if (max_crusaders_by_time > max_crusaders * 1.1) { // 10% buffer just in case of surprise attack or something
        return true;
    }
    return false;
}
