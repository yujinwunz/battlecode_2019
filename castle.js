import {BCAbstractRobot, SPECS} from 'battlecode';
import * as farm from 'farm.js';


// These are received before turn is called.
export function on_birth(id, unit) {

}

export function on_ping(id, loc) {

}

export function on_death(id) {

}

// Sighting of an enemy
export function on_sighting(id, eid, loc, unit) {

}

const EXPAND = 0;
const DEPLOY_TURTLE = 1;

function canonical_strategic_move() {
    // Returns a move.
}

function if_i_should_do(smove) {

}

export function turn(game, steps, enemies, predators, prey, friends) {
    
    return farm.turn(game, enemies, friends);
}
