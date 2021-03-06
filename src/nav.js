import * as utils from './utils.js';

export const ADJACENT = [[1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

// gaits
export const GAITS = {
    WALK: 0,
    JOG: 1,
    RUN: 3,
    SPRINT: 10
};

var EPS = 1e-10;


export function distcmp(a, b) {
    if (a[0] === b[0]) return a[1] - b[1];
    return a[0] - b[0];
}

// linear priority queue
// Assumes that items inserted are >= last popped.
// Just for Dijkstra. Linear time dijkstra is always nice.
class Queue {
    constructor() {
        this.qs = [];
        this.length = 0;
        this.first = 0;
        this.pos = 0;
    }
    push(item) {
        var p = item[0];
        while (this.qs.length <= p) this.qs.push([]);
        this.qs[p].push(item);
        this.length++;
    }
    pop(item) {
        if (this.length === 0) return undefined;

        this.length--;
        while (this.pos >= this.qs[this.first].length) {
            this.first++;
            this.pos = 0;
        }
        return this.qs[this.first][this.pos++];
    }
}

// Returns a distancemap given the target location. Set max_t for small localized dfs's.
export function build_map(pass_map, target, max_jump=4, gait=0, robots=[], max_t=(1<<30)) {
    var [tx, ty] = target;
    var rows = pass_map.length;
    var cols = pass_map[0].length;

    robots.forEach(r => {
            if ("x" in r) {
                pass_map[r.y][r.x] = false; // block visible robots
            }
    })

    let dij = new Queue(); /* new PQ(
        [[0, 0, tx, ty]], 
        (a, b) => {
            return a[0] + a[1] * gait - (b[0] + b[1] * gait);
        }
    );*/
    dij.push([0, 0, tx, ty]);
    

    var res = utils.null_array(cols, rows);

    var root=Math.ceil(Math.sqrt(max_jump)-EPS);
    while (dij.length) {
        var [f, t, x, y] = dij.pop();

        if (res[y][x] !== null) continue;
        if (t > max_t) continue;
        res[y][x] = [f, t];

        for (var dx = -root; dx <= +root; dx++) {
            for (var dy = -root; dy <= +root; dy++) {
                if (dx*dx + dy*dy > max_jump) continue; 

                var nx = x+dx, ny = y+dy;
                if (nx < 0 || nx >= cols) continue;
                if (ny < 0 || ny >= rows) continue;
                
                if (!pass_map[ny][nx]) continue;
                if (res[ny][nx] !== null) continue;
                dij.push([f + dx*dx + dy*dy, t+1, nx, ny]);   
            }
        }
    }

    robots.forEach(r => {
            if ("x" in r) {
                pass_map[r.y][r.x] = true; // block visible robots
            }
    })

    return res;
}

var map_cache = {};

// Assume we use the same pass map every time.
export function build_map_cached(pass_map, target, max_jump=4, gait=0, max_t=(1<<30), blocks=[]) {
    var key = target[0] + "," + target[1] + "," + max_jump + " " + gait + " " + max_t + " " + blocks;
    if (key in map_cache) return map_cache[key];
    map_cache[key] = build_map(pass_map, target, max_jump, gait, blocks.map(b=>{return{x:b[0],y:b[1]}}), max_t);
    return map_cache[key];
}

// Returns next location a unit should go to if we should go UP TO "step" distance
// away.
export function path_step(map, from, step, robots=[], fitness=null) {
    var rows = map.length;
    var cols = map[0].length;

    var [sx, sy] = from;

    var bestdist = map[sy][sx] ? map[sy][sx] : [(1<<30), 0];
    var bestto = [null, null];

    var max_coord = Math.ceil(Math.sqrt(step) - EPS);
    for (var dx = -max_coord; dx <= max_coord; dx++) {
        for (var dy = -max_coord; dy <= max_coord; dy++) {
            
            if (dx === 0 && dy === 0) {
                // To prevent "orbiting" around an occupied goal, don't force a move
                // when 1 away from goal
                if (!map[sy][sx] || map[sy][sx][1] > 1) {
                    continue; // Help avoid "awkward hallway dance"
                }
            }
            
            var nx = sx+dx;
            var ny = sy+dy;
            if (utils.robots_collide(robots, [nx, ny])) {
                if (dx !== sx || dy !== sy)
                    continue;
            }

            if (nx < 0 || nx >= cols) continue;
            if (ny < 0 || ny >= rows) continue;
            if (map[ny][nx] === null) continue;

            if (dx*dx + dy*dy <= step) {
                var news = map[ny][nx].slice();
                if (fitness) news[0] += fitness(nx, ny);
                var newd = distcmp(news, bestdist);

                // Add a bit of randomness to break the "awkward dance" along the hallways.
                if (newd < 0 || (newd == 0 && Math.random() < 0.2)) {
                    bestdist = map[ny][nx];
                    bestto = [nx, ny];
                }
            }
        }
    }

    return bestto;
}

