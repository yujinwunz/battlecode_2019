import {BCAbstractRobot, SPECS} from 'battlecode';
import * as castle from 'castle.js';
import * as church from 'church.js';
import * as pilgrim from 'pilgrim.js';
import * as crusader from 'crusader.js';
import * as prophet from 'prophet.js';
import * as preacher from 'preacher.js';

import {Message, decode} from 'message.js';
import * as message from 'message.js';

import * as nav from 'nav.js';
import * as utils from 'utils.js';

import * as castleutils from 'castleutils.js';

var step = 0;

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
export function send_to_castle(game, msg) {
    var bytes = 0;
    while ((1<<(bytes*8)) <= msg) bytes++;

    castle_talk_queue.push((bytes << 3) | game.me.unit);
    while (bytes--) {
        castle_talk_queue.push(msg & 0b11111111);
        msg = msg >> 8;
    }
}

// For castle talk, the type is at the end.

// Lets the castle know you're still alive, and where you are.
export function heartbeat(game) {
    if (castle_talk_queue.length === 0) {
        if (game.me.x === last_heartbeat[0] && game.me.y === last_heartbeat[1]) {
            send_to_castle(game, CASTLE_TALK_HEARTBEAT);
        } else {
            var msg = game.me.x;
            msg = (msg << message.COORD_BITS) | game.me.y;
            msg = (msg << CASTLE_TALK_TYPE_BITS) | CASTLE_TALK_REPORT_COORD;
            send_to_castle(game, msg);
            last_heartbeat = [game.me.x, game.me.y];
        }
        return true;
    } return false;
}

export function castle_talk_work(game) {
    if (castle_talk_queue.length) {
        game.castleTalk(castle_talk_queue[0]);
        castle_talk_queue.shift();
    }
}

function report_enemies(game, steps) {
    // find an enemy that was reported last.
    var to_report = utils.argmax(game.getVisibleRobots(), r => {
        if (r.team === 1-game.me.team) {
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
        } else return -(1<<30);
    });

    if (to_report) {
        if (castle_talk_queue.length === 0 || to_report.unit === SPECS.CASTLE) {
            last_reported[to_report.id] = steps;
            var msg = to_report.id;
            msg = (msg << message.TYPE_BITS) | to_report.unit;
            msg = (msg << message.COORD_BITS) | to_report.x;
            msg = (msg << message.COORD_BITS) | to_report.y;
            msg = (msg << CASTLE_TALK_TYPE_BITS) | CASTLE_TALK_REPORT_ENEMY;
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

function read_castle_talk(game) {
    castleutils.receive(game.getVisibleRobots(), castle.on_birth, (id, msg) => {
        var type = msg % (1<<CASTLE_TALK_TYPE_BITS);
        msg >>= CASTLE_TALK_TYPE_BITS;
        if (type === CASTLE_TALK_HEARTBEAT) {
            // pass
        } else if (type === CASTLE_TALK_REPORT_COORD) {
            var y = msg % (1<<message.COORD_BITS);
            msg >>= message.COORD_BITS;
            var x = msg % (1<<message.COORD_BITS);
            castle.on_ping(id, [x, y]);
        } else if (type === CASTLE_TALK_REPORT_ENEMY) {
            var y = msg % (1<<message.COORD_BITS);
            msg >>= message.COORD_BITS;
            var x = msg % (1<<message.COORD_BITS);
            msg >>= message.COORD_BITS;
            var unit = msg % (1<<message.TYPE_BITS);
            msg >>= message.TYPE_BITS;
            var eid = msg % (1<<message.TYPE_BITS);
            castle.on_sighting(id, eid, [x, y], unit);
        } else {
            // how?
            game.log("Impossibly invalid castle talk");
        }
    }, castle.on_death);
}

// common state variables
var target = [null, null];
var home;
var home_trail, target_trail;
var vipid = -1;

// Pilgrim state
var pilgrim_state = pilgrim.ORPHAN;

// Crusader state
var crusader_state = warrior.PROTECTING;
var prophet_state = warrior.PROTECTING;
var preacher_state = warrior.PROTECTING;

class MyRobot extends BCAbstractRobot {
    turn() {
        step++;
        var [enemies, predators, prey, blindspot, friendly] = utils.glance(this);

        if (step === 1) {
            game.log(game.me);
            if (this.me.unit === SPECS.CASTLE) {
                init_castle_talk(this);
            } else if (warrior.is_warrior(this.me.unit)) {
                var home = utils.get_home(this, friendly);     
                vipid = home.id;
                target = [home.x, home.y];
                target_trail = nav.build_map(this.map, target, SPECS.UNITS[game.me.unit].SPEED, nav.GAITS.SPRINT);
            }
        }

        var start = (new Date()).getTime();

        var action = null, msg = null;


        var matrix;
        if (this.me.unit !== SPECS.CASTLE && this.me.unit !== SPECS.CHURCH) {
            matrix = build_matrix(game);
        }

        if (this.me.unit === SPECS.CASTLE) {
            read_castle_talk(this);
            var [action, msg] = castle.turn(this, step, enemies, predators, prey, friends);
        } else if (this.me.unit === SPECS.CHURCH) {
            var orders = church.listen_orders(game);
            var [action, msg] =  church.turn(this, step, enemies, predators, prey, friends, orders);
        } else if (this.me.unit === SPECS.PILGRIM) {
            var orders = pilgrim.listen_orders(game);
            orders.forEach(o => {
                if (o.type === "pilgrim_assign_target" || o.type === "pilgrim_build_church") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(this.map, target, 4, nav.GAITS.SPRINT, [], 5);
                    home = [o.sender.x, o.sender.y];
                    home_trail = nav.build_map(this.map, home, 4, nav.GAITS.SPRINT, [], 5);
                    if (o.type === "pilgrim_assign_target") pilgrim_state = pilgrim.MINING;
                    else pilgrim_state = pilgrim.EXPEDITION;
                }
            });

            if (pilgrim_state === pilgrim.ORPHAN) {
                var [action, msg] = pilgrim.orphan(game, steps);
            } else if (pilgrim_state === pilgrim.MINING) {
                var [action, msg] = pilgrim.mining(game, steps, matrix, target, target_trail, home, home_trail, enemies, friends);
            } else if (pilgrim_state === pilgrim.EXPEDITION) {
                var [action, msg] = pilgrim.expedition(game, steps, matrix, target, target_trail, enemies, friends);
            }
        } else if (this.me.unit === SPECS.CRUSADER) {
            var orders = warrior.listen_orders(game, vipid);
            orders.forEach(o => {
                if (o.type === "attack") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(game.map, target, 9, nav.GAITS.SPRINT);
                    crusader_state = warrior.ATTACKING;
                } else if (o.type === "requesting_backup") {
                    vipid = o.sender.id;
                    target = [o.sender.x, o.sender.y];
                    target_trail = nav.build_map(game.map, target, 9, nav.GAITS.SPRINT);
                    crusader_state = warrior.PROTECTING;
                } else if (o.type === "turtle") {
                    // TODO
                    crusader_state = warrior.TURTLING;
                }
            });

            if (crusader_state === warrior.ATTACKING) {
                var [action, msg] = crusader.attack(game, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            } else if (crusader_state === warrior.TURTLING) {
                var [action, msg] = crusader.turtle(game, steps, matrix, enemies, predators, prey, friends);
            } else if (crusader_state === warrior.PROTECTING) {
                var [action, msg] = crusader.protect(game, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            }
        } else if (this.me.unit === SPECS.PROPHET) {
            var orders = warrior.listen_orders(game, vipid);
            orders.forEach(o => {
                if (o.type === "attack") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(game.map, target, 4, nav.GAITS.SPRINT);
                    prophet_state = warrior.ATTACKING;
                } else if (o.type === "requesting_backup") {
                    vipid = o.sender.id;
                    target = [o.sender.x, o.sender.y];
                    target_trail = nav.build_map(game.map, target, 4, nav.GAITS.SPRINT);
                    prophet_state = warrior.PROTECTING;
                } else if (o.type === "turtle") {
                    // TODO
                    prophet_state = warrior.TURTLING;
                }
            });

            if (prophet_state === warrior.ATTACKING) {
                var [action, msg] = prophet.attack(game, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail);
            } else if (prophet_state === warrior.TURTLING) {
                var [action, msg] = prophet.turtle(game, steps, matrix, enemies, predators, prey, blindspot, friends);
            } else if (prophet_state === warrior.PROTECTING) {
                var [action, msg] = prophet.protect(game, steps, matrix, enemies, predators, prey, blindspot, friends, target, target_trail);
            }
        } else if (this.me.unit === SPECS.PREACHER) {
            var orders = warrior.listen_orders(game, vipid);
            orders.forEach(o => {
                if (o.type === "attack") {
                    target = [o.x, o.y];
                    target_trail = nav.build_map(game.map, target, 4, nav.GAITS.SPRINT);
                    preacher_state = warrior.ATTACKING;
                } else if (o.type === "requesting_backup") {
                    vipid = o.sender.id;
                    target = [o.sender.x, o.sender.y];
                    target_trail = nav.build_map(game.map, target, 4, nav.GAITS.SPRINT);
                    preacher_state = warrior.PROTECTING;
                }
            });

            if (preacher_state === warrior.ATTACKING) {
                var [action, msg] = preacher.attack(game, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            } else if (preacher_state === warrior.PROTECTING) {
                var [action, msg] = preacher.protect(game, steps, matrix, enemies, predators, prey, friends, target, target_trail);
            }
        }

        if (report_enemies(game, steps)) {
            // ok.
        } else if (heartbeat(this)) {
            // ok.
        }

        castle_talk_work(this);

        var elapsed = new Date().getTime()-start;
        if (elapsed > 25) {
            this.log("time remaining: " + this.me.time);
            this.log("turn took: " + ((new Date()).getTime()-start) / 1000 + "s");
            this.log("making action: " + action);
        }
        if (msg) {
            game.log("Sending message " + msg[0].type + " by distance " + msg[1] + " raw " + msg[0].encode(game.me.id, game.me.team));
            game.log(msg);
            this.signal(msg[0].encode(game.me.id, game.me.team), msg[1]);
        }
        return action;
    }
}

var robot = new MyRobot();
