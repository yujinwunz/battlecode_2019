import {BCAbstractRobot, SPECS} from 'battlecode';
import {turn as castle_turn} from 'castle.js';
import {turn as pilgrim_turn} from 'pilgrim.js';
import {turn as prophet_turn} from 'prophet.js';
import {turn as preacher_turn} from 'preacher.js';

var step = -1;

class MyRobot extends BCAbstractRobot {
    turn() {
        step++;

        if (this.me.unit === SPECS.CASTLE) castle_turn(this, step);
        else if (this.me.unit === SPECS.PILGRAM) pilgrim_turn(this, step);
        else if (this.me.unit === SPECS.PROPHET) prophet_turn(this, step);
        else if (this.me.unit === SPECS.PREACHER) preacher_turn(this, step);
    }
}

var robot = new MyRobot();
