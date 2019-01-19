import {BCAbstractRobot, SPECS} from 'battlecode';
import {turn as castle_turn} from 'castle.js';
import {turn as church_turn} from 'church.js';
import {turn as pilgrim_turn} from 'pilgrim.js';
import {turn as crusader_turn} from 'crusader.js';
import {turn as prophet_turn} from 'prophet.js';
import {turn as preacher_turn} from 'preacher.js';
import {Message, decode} from 'message.js';

import * as nav from 'nav.js';
import * as utils from 'utils.js';

var obs_map = [
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0]
];

var map = nav.build_map(obs_map, [4, 0], 2, 5);
var step = 0;

class MyRobot extends BCAbstractRobot {
    turn() {
        step++;
        this.log("time remaining: " + this.me.time);

        var start = (new Date()).getTime();

        var action;

        if (this.me.unit === SPECS.CASTLE) action =  castle_turn(this, step);
        else if (this.me.unit === SPECS.CHURCH) action =  church_turn(this, step);
        else if (this.me.unit === SPECS.PILGRIM) action =  pilgrim_turn(this, step);
        else if (this.me.unit === SPECS.CRUSADER) action =  crusader_turn(this, step);
        else if (this.me.unit === SPECS.PROPHET) action =  prophet_turn(this, step);
        else if (this.me.unit === SPECS.PREACHER) action =  preacher_turn(this, step);

        utils.heartbeat(this);
        utils.castle_talk_work(this);

        this.log("turn took: " + ((new Date()).getTime()-start) / 1000 + "s");
        this.log("making action: " + action);
        return action;
    }
}

var robot = new MyRobot();
