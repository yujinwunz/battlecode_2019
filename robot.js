import {BCAbstractRobot, SPECS} from 'battlecode';
import * as castle from 'castle.js';
import * as church from 'church.js';
import * as pilgrim from 'pilgrim.js';
import * as crusader from 'crusader.js';
import * as prophet from 'prophet.js';
import * as preacher from 'preacher.js';
import * as warrior from 'warrior.js';

import {Message, decode} from 'message.js';
import * as message from 'message.js';

import * as nav from 'nav.js';
import * as utils from 'utils.js';

import * as castleutils from 'castleutils.js';
import * as macro from 'macro.js';

var steps = 0;

// Castle talk state
const CASTLE_TALK_TYPE_BITS = 2;
const CASTLE_TALK_HEARTBEAT = 1;
const CASTLE_TALK_REPORT_COORD = 2;
const CASTLE_TALK_REPORT_ENEMY = 3;

const DISTRESS_RADIUS = 300;

var castle_talk_queue = [];
var last_heartbeat = [null, null];

var last_reported = {};


// For castle talk, the type is at the end.

// Lets the castle know you're still alive, and where you are.
function heartbeat(game) {
    if (game.me.turn === 1) {
        game.castleTalk(64 + game.me.unit);
        return true;
    }
    if (game.me.turn % 2 === 0) {
        game.castleTalk(64 + game.me.x); // 64 is to avoid sending 0, reserved for error.
        game.last_reported_x = game.me.x;
    } else {
        game.castleTalk(64 + game.me.y);
        game.last_reported_y = game.me.y;
    }
    return true;
}

var reports_in_a_row = 0;

function report_enemies(game, steps) {
    reports_in_a_row++;
    if (reports_in_a_row == 4) {
        reports_in_a_row = -1;
        game.log("taking a break");
        return false;
    }
    if (reports_in_a_row == 0) {
        game.log("taking another break");
        return false;
    }
    // find an enemy that was reported last.
    var to_report = utils.argmax(game.getVisibleRobots(), r => {
        if (r.team === 1-game.me.team && "x" in r) {
            if (r.id in last_reported) {
                return -last_reported[r.id];
            }
            // Report new ones based on threat
            if (r.unit === SPECS.CASTLE) return 110;
            if (r.unit === SPECS.CHURCH) return 100;
            if (r.unit === SPECS.PREACHER) return 90;
            if (r.unit === SPECS.PROPHET) return 80;
            if (r.unit === SPECS.CRUSADER) return 70;
            return 50;
        } else return null;
    });


    if (to_report && "last_reported_x" in game && "last_reported_y" in game) {
        last_reported[to_report.id] = steps;
        
        var dx = to_report.x - game.me.x;
        var dy = to_report.y - game.me.y;
        dx = Math.max(-11, Math.min(12, dx)) + 11;
        dy = Math.max(-11, Math.min(12, dy)) + 11;
        dx = Math.floor(dx/3);
        dy = Math.floor(dy/3);

        if (warrior.is_warrior(to_report.unit)) {
            game.log("reporting warrior at " + to_report.x + " " + to_report.y);
            game.castleTalk(128 + 64 + dx*8 + dy);
        } else {
            game.log("reporting civilian");
            game.castleTalk(128 + dx*8 + dy);
        }
        return true;
    }
    reports_in_a_row = 0;
    return false;
}


// Castle game view state
// Includes tabs on all friendly units and some enemy units.

function init_castle_talk(game) {
    castleutils.init_castle_talk();
}

function read_castle_talk(game, steps) {
    castleutils.receive(game.getVisibleRobots(), (r, msg) => {
        if (msg === 0) {
            game.log("untrusted message from " + r.id);
            return;
        }
        if (msg >= 128) {
            // report enemy
            msg -= 128;
            if (msg > 64) {
                // attacking enemy
                msg -= 64;
                castle.on_warrior_sighting(game, steps, r, Math.floor(msg/8)%8, msg%8);
            } else {
                // civilian enemy
                castle.on_civilian_sighting(game, steps, r, Math.floor(msg/8)%8, msg%8);
            }
        } else {
            if (r.turn === 1) {            // reporting in
                castle.on_birth(game, r, msg - 64); 
            } else if (r.turn % 2 === 0) { // report x
                castle.on_ping(game, r, [msg%64, null]);
            } else {                       // report y
                castle.on_ping(game, r, [null, msg%64]);
            }
        }
    }, i => castle.on_death(game, i), game);
}

function build_matrix() {

}

// common state variables
var target = [null, null];
var home = null;
var home_trail, target_trail;
var vipid = -1;

// Pilgrim state
var pilgrim_state = pilgrim.MINING;

// Crusader state
var crusader_state = warrior.TURTLING;
var prophet_state = warrior.TURTLING;
var preacher_state = warrior.TURTLING;

class MyRobot extends BCAbstractRobot {
    turn() {
        steps++;
        var start = (new Date()).getTime();

        var action = null, msg = null;

        var [enemies, predators, prey, blindspot, friends] = utils.glance(this);
        if (steps === 1) {
            this.log(this.me);
            this.symmetry = utils.symmetry(this.map);
            if (this.me.unit === SPECS.CASTLE) {
                init_castle_talk(this);
            } else if (warrior.is_warrior(this.me.unit)) {
                var _home = utils.get_home(this, friends);     
                if (_home) {
                    vipid = _home.id;
                    target = [_home.x, _home.y];
                } else {
                    vipid = 0;
                    target = [this.me.x, this.me.y];
                }
                //target_trail = nav.build_map(this.map, target, SPECS.UNITS[this.me.unit].SPEED, nav.GAITS.WALK); // Slow gait for less fuel and more grouping. Rushes don't need to be... well... rushed.
                this.last_castle_distress = -(1<<30);
            }
            this.fuel_target = 100;
            this.karbonite_target = 100;
            for (var x = 0; x < this.map[0].length; x++) {
                for (var y = 0; y < this.map.length; y++) {
                    if (this.karbonite_map[y][x]) this.karbonite_squares++;
                    if (this.fuel_map[y][x]) this.fuel_squares++;
                }
            }
        }

        if (report_enemies(this, steps)) {
            // ok.
        } else if (heartbeat(this)) {
            // ok.
        }

        // Look for resource management signals
        this.getVisibleRobots().forEach(f => {
            if ("signal" in f && f.signal > 0 && "x" in f) {
                var msg = decode(f.signal, f, this.me.team);
                if (msg.type === "emission") {
                    this.log("got new emission request " + msg.karbonite + " " + msg.fuel);
                    this.fuel_target = macro.FUEL_LEVELS[msg.fuel];
                    this.karbonite_target = macro.KARBONITE_LEVELS[msg.karbonite];
                    this.log("Targets now at " + this.karbonite_target + " " + this.fuel_target);
                } else if (msg.type === "void_signature" || msg.type === "void") this.log("bad msg from " + f.id + " " + f.signal);
            }
        });

        var matrix;
        if (this.me.unit !== SPECS.CASTLE && this.me.unit !== SPECS.CHURCH) {
            matrix = build_matrix(this);
        }

        if (this.me.unit === SPECS.CASTLE) {
            read_castle_talk(this, steps);
            var [action, msg] = castle.turn(this, steps, enemies, predators, prey, friends);
        } else if (this.me.unit === SPECS.CHURCH) {
            var orders = church.listen_orders(this);
            orders.forEach(o => {
                if (o.type === "castle_distress") this.last_castle_distress = steps;
            });
            var [action, msg] =  church.turn(this, steps, enemies, friends, orders);
        } else if (this.me.unit === SPECS.PILGRIM) {
            if (steps === 1) {
                // find nearest castle/church
                home = friends.filter(f => 
                    (f.unit === SPECS.CASTLE || f.unit === SPECS.CHURCH) 
                    && utils.adjacent([this.me.x, this.me.y], [f.x, f.y])
                );
                home = [home.x, home.y];
            }
            var orders = pilgrim.listen_orders(this);
            orders.forEach(o => {
                if (o.type === "pilgrim_build_church") {
                    if (steps !== 1) return;
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT, []);
                    this.log("sending pilgrim to build church. home is now " + o.sender.x + " " + o.sender.y);
                    home = [o.sender.x, o.sender.y];
                    home_trail = nav.build_map(this.map, home, 4, nav.GAITS.SPRINT, []);
                    pilgrim_state = pilgrim.EXPEDITION;
                }
                if (o.type === "castle_distress") this.last_castle_distress = steps;
            });

            if (pilgrim_state === pilgrim.MINING) {
                var [action, msg] = pilgrim.mining(this, steps, matrix, home, predators, enemies, friends);
            } else if (pilgrim_state === pilgrim.EXPEDITION) {
                var [action, msg, newstate] = pilgrim.expedition(this, steps, matrix, target, target_trail, home, home_trail, enemies, friends);
                if (newstate !== undefined) {
                    this.log("swithching to new state " + newstate);
                    pilgrim_state = newstate;
                }
            }
        } else if (this.me.unit === SPECS.CRUSADER) {
            var orders = warrior.listen_orders(this, vipid);
            orders.forEach(o => {
                if (o.type === "attack" || (o.type === "castle_distress" && utils.dist([o.x, o.y], [this.me.x, this.me.y]) < DISTRESS_RADIUS)) {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 9, nav.GAITS.SPRINT);
                    crusader_state = warrior.ATTACKING;
                }
                if (o.type === "castle_distress") this.last_castle_distress = steps;
            });

            if (crusader_state === warrior.ATTACKING) {
                if (warrior.done_attacking(this, steps, enemies, friends, target)) {
                    this.log("area clear");
                    crusader_state = warrior.TURTLING;
                }
            }

            if (crusader_state === warrior.ATTACKING) {
                var [action, msg] = crusader.attack(this, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            } else if (crusader_state === warrior.TURTLING) {
                var [action, msg] = crusader.turtle(this, steps, matrix, enemies, predators, prey, friends);
            }
        } else if (this.me.unit === SPECS.PROPHET) {
            var orders = warrior.listen_orders(this, vipid);
            orders.forEach(o => {
                if (o.type === "attack" || (o.type === "castle_distress" && utils.dist([o.x, o.y], [this.me.x, this.me.y]) < DISTRESS_RADIUS)) {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT);
                    prophet_state = warrior.ATTACKING;
                }
                if (o.type === "castle_distress") {
                    this.log("castle_distress received");
                    this.log(o);
                    this.last_castle_distress = steps;
                }
            });

            if (prophet_state === warrior.ATTACKING) {
                if (warrior.done_attacking(this, steps, enemies, friends, target)) {
                    this.log("area clear");
                    prophet_state = warrior.TURTLING;
                }
            }
            if (prophet_state === warrior.ATTACKING) {
                var [action, msg] = prophet.attack(this, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail);
            } else if (prophet_state === warrior.TURTLING) {
                var [action, msg] = prophet.turtle(this, steps, matrix, enemies, predators, prey, blindspot, friends);
            }

        } else if (this.me.unit === SPECS.PREACHER) {
            var orders = warrior.listen_orders(this, vipid);
            orders.forEach(o => {
                if (o.type === "attack" || (o.type === "castle_distress" && utils.dist([o.x, o.y], [this.me.x, this.me.y]) < DISTRESS_RADIUS)) {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 9, nav.GAITS.SPRINT);
                    preacher_state = warrior.ATTACKING;
                }
                if (o.type === "castle_distress") this.last_castle_distress = steps;
            });

            if (preacher_state === warrior.ATTACKING) {
                if (warrior.done_attacking(this, steps, enemies, friends, target)) {
                    this.log("area clear");
                    preacher_state = warrior.TURTLING;
                }
            }

            if (preacher_state === warrior.ATTACKING) {
                var [action, msg] = preacher.attack(this, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            } else if (preacher_state === warrior.TURTLING) {
                var [action, msg] = preacher.turtle(this, steps, matrix, enemies, predators, prey, friends);
            }
        }

        var elapsed = new Date().getTime()-start;
        if (elapsed > 25) {
            this.log("time remaining: " + this.me.time);
            this.log("turn took: " + ((new Date()).getTime()-start) / 1000 + "s");
            this.log("making action: " + action);
        }
        if (msg) {
            this.log("Sending message " + msg[0].type + " by distance " + msg[1] + " raw " + msg[0].encode(this.me.id, this.me.team));
            this.log(msg);
            this.signal(msg[0].encode(this.me.id, this.me.team), msg[1]);
        }
        return action;
    }
}

var robot = new MyRobot();
