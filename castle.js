import {BCAbstractRobot, SPECS} from 'battlecode';
import {turn as church_turn} from 'church.js';

export function turn(game, steps) {
    return church_turn(game, steps, true);
}
