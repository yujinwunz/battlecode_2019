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
var castle_talk_queue = [];
var last_heartbeat = [null, null];

var last_reported = {};

// Sends a message via the free 8 bit castle channel.
// Because they are free, we can choose to do a nice delivery network thing.
function send_to_castle(game, msg) {
    var bytes = 0;
    while (Math.pow(2, bytes*8) <= msg && bytes < 4) bytes++;

    castle_talk_queue.push((bytes * Math.pow(2, 3)) + game.me.unit);
    while (bytes--) {
        castle_talk_queue.push(msg % 256);
        msg = Math.floor(msg / 256);
    }
}

// For castle talk, the type is at the end.

// Lets the castle know you're still alive, and where you are.
function heartbeat(game) {
    if (castle_talk_queue.length === 0) {
        if (game.me.x === last_heartbeat[0] && game.me.y === last_heartbeat[1]) {
            send_to_castle(game, CASTLE_TALK_HEARTBEAT);
        } else {
            var msg = game.me.x;
            msg = (msg * Math.pow(2, message.COORD_BITS)) + game.me.y;
            msg = (msg * Math.pow(2, CASTLE_TALK_TYPE_BITS)) + CASTLE_TALK_REPORT_COORD;
            send_to_castle(game, msg);
            last_heartbeat = [game.me.x, game.me.y];
        }
        return true;
    } return false;
}

function castle_talk_work(game) {
    if (castle_talk_queue.length) {
        game.castleTalk(castle_talk_queue[0]);
        castle_talk_queue.shift();
    }
}

function report_enemies(game, steps) {
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


    if (to_report) {
        if (castle_talk_queue.length === 0 || to_report.unit === SPECS.CASTLE) {
            last_reported[to_report.id] = steps;
            var msg = to_report.id;
            msg = (msg * Math.pow(2, message.TYPE_BITS)) + to_report.unit;
            msg = (msg * Math.pow(2, message.COORD_BITS)) + to_report.x;
            msg = (msg * Math.pow(2, message.COORD_BITS)) + to_report.y;
            msg = (msg * Math.pow(2, CASTLE_TALK_TYPE_BITS)) + CASTLE_TALK_REPORT_ENEMY;
            
            send_to_castle(game, msg);
            return true;
        }
    }
    return false;
}


// Castle game view state
// Includes tabs on all friendly units and some enemy units.

function init_castle_talk(game) {
    castleutils.init_castle_talk();
}

function read_castle_talk(game, steps) {
    castleutils.receive(game.getVisibleRobots(), (i, u) => castle.on_birth(game, steps, i, u), (id, unit, msg) => {
        var omsg = msg;
        var type = msg % (1*Math.pow(2, CASTLE_TALK_TYPE_BITS));
        msg = Math.floor(msg/Math.pow(2, CASTLE_TALK_TYPE_BITS));
        if (type === CASTLE_TALK_HEARTBEAT) {
            // pass
        } else if (type === CASTLE_TALK_REPORT_COORD) {
            var y = msg % (1*Math.pow(2, message.COORD_BITS));
            msg = Math.floor(msg/Math.pow(2, message.COORD_BITS));
            var x = msg % (1*Math.pow(2, message.COORD_BITS));
            castle.on_ping(game, steps, unit, id, [x, y]);
        } else if (type === CASTLE_TALK_REPORT_ENEMY) {
            var y = msg % (1*Math.pow(2, message.COORD_BITS));
            msg = Math.floor(msg/Math.pow(2, message.COORD_BITS));
            var x = msg % (1*Math.pow(2, message.COORD_BITS));
            msg = Math.floor(msg/Math.pow(2, message.COORD_BITS));
            var unit = msg % (1*Math.pow(2, message.TYPE_BITS));
            msg = Math.floor(msg/Math.pow(2, message.TYPE_BITS));
            var eid = msg % (1*Math.pow(2, message.ID_BITS));
            castle.on_sighting(game, steps, id, eid, [x, y], unit);
        } else {
            // how?
            game.log("Impossibly invalid castle talk " + omsg + " from " + id);
        }
    }, i => castle.on_death(game, steps, i), game);
}

function build_matrix() {

}

// common state variables
var target = [null, null];
var home = null;
var home_trail, target_trail;
var vipid = -1;

// Pilgrim state
var pilgrim_state = pilgrim.ORPHAN;

// Crusader state
var crusader_state = warrior.PROTECTING;
var prophet_state = warrior.TURTLING;
var preacher_state = warrior.PROTECTING;

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
                    target = [game.me.x, game.me.y];
                }
                target_trail = nav.build_map(this.map, target, SPECS.UNITS[this.me.unit].SPEED, nav.GAITS.WALK); // Slow gait for less fuel and more grouping. Rushes don't need to be... well... rushed.
            }
            this.fuel_target = 100;
            this.karbonite_target = 75;
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

        castle_talk_work(this);

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
            var [action, msg] =  church.turn(this, steps, enemies, friends, orders);
        } else if (this.me.unit === SPECS.PILGRIM) {
            var orders = pilgrim.listen_orders(this);
            orders.forEach(o => {
                if (o.type === "pilgrim_assign_target") {
                    if (pilgrim_state === pilgrim.MINING && target && target[0] !== null) return;
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT, [], 5);
                    home = [o.sender.x, o.sender.y];
                    home_trail = nav.build_map(this.map, home, 4, nav.GAITS.SPRINT, [], 5);
                    pilgrim_state = pilgrim.MINING;
                } else if (o.type === "pilgrim_build_church") {
                    if (pilgrim_state === pilgrim.MINING) return;
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT, []);
                    home = [o.sender.x, o.sender.y];
                    home_trail = nav.build_map(this.map, home, 4, nav.GAITS.SPRINT, []);
                    pilgrim_state = pilgrim.EXPEDITION;
                }
            });

            if (pilgrim_state === pilgrim.ORPHAN) {
                var [action, msg] = pilgrim.orphan(this, steps);
            } else if (pilgrim_state === pilgrim.MINING) {
                var [action, msg] = pilgrim.mining(this, steps, matrix, target, target_trail, home, home_trail, enemies, friends);
            } else if (pilgrim_state === pilgrim.EXPEDITION) {
                var [action, msg] = pilgrim.expedition(this, steps, matrix, target, target_trail, enemies, friends);
            }
        } else if (this.me.unit === SPECS.CRUSADER) {
            var orders = warrior.listen_orders(this, vipid);
            orders.forEach(o => {
                if (o.type === "attack") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 9, nav.GAITS.SPRINT);
                    crusader_state = warrior.ATTACKING;
                }
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
                if (o.type === "attack") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT);
                    prophet_state = warrior.ATTACKING;
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
                if (o.type === "attack") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT);
                    preacher_state = warrior.ATTACKING;
                } else if (o.type === "requesting_backup") {
                    vipid = o.sender.id;
                    target = [o.sender.x, o.sender.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT);
                    preacher_state = warrior.PROTECTING;
                }
            });

            if (preacher_state === warrior.ATTACKING) {
                var [action, msg] = preacher.attack(this, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            } else if (preacher_state === warrior.PROTECTING) {
                var [action, msg] = preacher.protect(this, steps, matrix, enemies, predators, prey, friends, target, target_trail);
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
