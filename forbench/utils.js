import {SPECS} from 'battlecode';
// Some useful util functions
import * as msg from './message.js';
import {Message, decode} from './message.js';

export const VERTICAL = 0;
export const HORIZONTAL = 1;

export const SQUAD_CAUTION_DIST = 36;

export function bitCount (n) {
  n = n - ((n >> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333)
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24
}

export function int_array(cols, rows, init=-1) {
    var buffer = new ArrayBuffer(cols*rows*4);
    var arr = new Int32Array(buffer);
    for (var i = 0; i < cols*rows; i++) arr[i] = init;
    return arr;
}

export function symmetry(map) {
    var cols = map[0].length;
    var rows = map.length;

    for (var i = 0; i < 500; i++) {
        var x = Math.floor(Math.random() * cols);
        var y = Math.floor(Math.random() * rows);

        var ix = cols - x - 1;
        var iy = rows - y - 1;

        // try vertical
        if (map[y][x] !== map[y][ix])
            return HORIZONTAL; // since vertical didn't work

        if (map[y][x] !== map[iy][x])
            return VERTICAL;
    }

    // By miracle after 500 iters we still haven't got anything yet. 
    throw "could not determine map direction";
}

export function print_map(console, map) {
    var rows = map.length;
    var cols = map[0].length;

    for (var y = 0; y < rows; y++) {
        var p = "";
        for (var x = 0; x < rows; x++) {
            var t = "" + map[y][x];
            while (t.length < 6) t += " ";
            p += t;
        }
        console.log(p);
    }
}

export var castle_talk_queue = []; // little endian

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

var last_heartbeat = [null, null];

// Lets the castle know you're still alive, and where you are.
export function heartbeat(game) {
    if (castle_talk_queue.length === 0) {
        if (game.me.x === last_heartbeat[0] && game.me.y === last_heartbeat[1]) {
            send_to_castle(game, 0);
        } else {
            send_to_castle(game, (game.me.x << (msg.COORD_BITS)) | game.me.y);
            last_heartbeat = [game.me.x, game.me.y];
        }
    }
}

export function castle_talk_work(game) {
    if (castle_talk_queue.length) {
        game.castleTalk(castle_talk_queue[0]);
        castle_talk_queue.shift();
    }
}

export function loc_dist(a, b) {
    return (a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]);
}

export function dist(a, b) {
    return (a[0]-b[0])*(a[0]-b[0]) + (a[1]-b[1])*(a[1]-b[1]);
}

export function in_fire_range(type, dist) {
    if (!SPECS.UNITS[type]) return false;
    if (!SPECS.UNITS[type].ATTACK_RADIUS) return false;
    if (dist < SPECS.UNITS[type].ATTACK_RADIUS[0]) return false; 
    if (dist > SPECS.UNITS[type].ATTACK_RADIUS[1]) return false;
    return true;
}

export function threat_level(game, r) {
    var hp = r.health;
    var hp_per_hit = SPECS.UNITS[r.unit].ATTACK_DAMAGE / r.health;
    var in_range = (game.me.x-r.x)*(game.me.x-r.x) + (game.me.y-r.y)*(game.me.y-r.y) <= SPECS.UNITS[r.unit].ATTACK_RANGE;

    return (in_range<<10) | (hp_per_hit<<5) | hp;
}

export function look(game, target_id) {
    var robots = game.getVisibleRobots();
    var in_range = [], exposed_to = [], confronting = [], other = [], friendly = [], target = null;

    robots.forEach(r => {
        if (!("type" in r)) return;
        if (!("x" in r)) return;
        if (!("team" in r)) return;
        game.log("in look, robot type was " + r.unit);
        
        if (r.team === game.me.team) {
            friendly.push(r);
        } else {
            var dist = loc_dist([game.me.x, game.me.y], [r.x, r.y]);
            if (in_fire_range(r.unit, dist)) exposed_to.push(r);
            if (in_fire_range(game.me.unit, dist)) in_range.push(r);
            if (!in_fire_range(r.unit, dist) && !in_fire_range(game.me.unit, dist)) {
                other.push(r);
            }
            if (in_fire_range(r.unit, dist) && in_fire_range(game.me.unit, dist)) {
                confronting.push(r);
            }
            game.log("was enemy. dist: " + dist + " unit: " + r.unit + " exposed: " + in_fire_range(r.unit, dist) + " in range: " + in_fire_range(game.me.unit, dist));
        }

        if (r.id === target_id) {
            target = r;
        }
    });

    return [in_range, exposed_to, confronting, other, friendly, target];
}

export function get_home(game, friendly) {
    game.log(friendly);
    game.log(game.me.x + " " + game.me.y);
    // find mother castle/church and assume it as home.
    var retval = null;
    friendly.forEach(r => {
        if (!("x" in r)) return;
        game.log(r);
        if (r.unit === SPECS.CASTLE || r.unit === SPECS.CHURCH) {
            game.log("good type");
            if (dist([game.me.x, game.me.y], [r.x, r.y]) <= 2) {
                game.log("good dist");
                retval = r;
            } else game.log("bad dist: " + dist([game.me.x, game.me.y], [r.x, r.y]));
        } else game.log("bad type " + r.unit);
    });

    if (retval) return retval;
    game.log("Could not find original home for this guy");
}

export function robots_collide(robots, coord) {
    for (var i = 0; i < robots.length; i++ ) {
        var r = robots[i];
        if ("x" in r) {
            if (r.x === coord[0] && r.y === coord[1]) return true;
        }
    }
    return false;
}

export function call_for_backup(game, strength, filter) {
    // gradually expand until we find X units.
    var robots = game.getVisibleRobots();
    var vision = SPECS.UNITS[game.me.unit].VISION_RADIUS;
    var cnt_by_dist = Array(vision+2);
    cnt_by_dist.fill(0);

    robots.forEach(r => {
        if (r.team !== game.me.team) return;
        if (!(filter & (1<<r.unit))) return;
        var dist = (r.x-game.me.x)*(r.x-game.me.x) + (r.y-game.me.y)*(r.y-game.me.y);
        cnt_by_dist[Math.min(dist, vision+1)] ++;
    });

    for (var i = 1; i <= vision+1; i++) cnt_by_dist[i] += cnt_by_dist[i-1];

    var targetn = Math.min(cnt_by_dist[vision+1], strength);
    if (targetn === 0) return true;

    for (var i = 0; i <= vision+1; i++) {
        if (cnt_by_dist[i] >= targetn) {
            var msg = new Message("requesting_backup", filter);
            if (i === vision+1) i = vision*2;
            var success = game.fuel >= Math.ceil(Math.sqrt(i));
            game.signal(msg.encode(game.me.id, game.me.team), i);
            return success;
        }
    }

    throw "shouldn't be here";
}

export function any_free_neighbour(game) {
    var cols = game.map[0].length;
    var rows = game.map.length;
    var robots = game.getVisibleRobots();
    for (var nx = Math.max(0, game.me.x-1); nx <= Math.min(cols-1, game.me.x+1); nx++) {
        for (var ny = Math.max(0, game.me.y-1); ny <= Math.min(rows-1, game.me.y+1); ny++) {
            if (nx === game.me.x && ny === game.me.y) continue;
            if (game.map[ny][nx] === false) continue;
            var collide = false;
            robots.forEach(r => {
                if (r.x === nx && r.y === ny) collide = true;
            });
            if (!collide) return [nx, ny];
        }
    }
    return [null, null];
}

export function arrcmp(a, b) {
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
}
