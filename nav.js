import PQ from './priorityqueue';

export const ADJACENT = [[1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];

// gaits
export const GAITS = {
    WALK: 0,
    JOG: 1,
    RUN: 3,
    SPRINT: 10
};

var EPS = 1e-10;

export function null_array(cols, rows) {
    var map = [];
    for (var i = 0; i < rows; i++) {
        var toadd = [];
        for (var j = 0; j < cols; j++) {
            toadd.push(null);
        }
        map.push(toadd);
    }
    return map;
}

export function distcmp(a, b) {
    if (a[0] === b[0]) return a[1] - b[1];
    return a[0] - b[0];
}

// Returns a distancemap given the target location.
export function build_map(pass_map, target, max_jump=4, gait=0, robots=[]) {
    var [tx, ty] = target;
    var rows = pass_map.length;
    var cols = pass_map[0].length;

    if (robots) {
        var map = [];
        for (var y = 0; y < rows; y++) {
            map.push(pass_map[y].slice());
        }
        
        for (var i = 0; i < robots.length; i++) {
            var r = robots[i];
            if ("x" in r) {
                map[r.y][r.x] = false; // block visible robots
            }
        }

        pass_map = map;
    }

    let dij = new PQ(
        [[0, 0, tx, ty]], 
        (a, b) => {
            return a[0] + a[1] * gait - (b[0] + b[1] * gait);
        }
    );

    var res = null_array(cols, rows);

    var root=Math.ceil(Math.sqrt(max_jump)-EPS);
    while (dij.length) {
        var [f, t, x, y] = dij.pop();

        if (res[y][x] !== null) continue;
        res[y][x] = [f, t];

        for (var dx = -root; dx <= +root; dx++) {
            for (var dy = -root; dy <= +root; dy++) {

                var nx = x+dx, ny = y+dy;
                if (nx < 0 || nx >= cols) continue;
                if (ny < 0 || ny >= rows) continue;
                
                if (!pass_map[ny][nx]) continue;
                dij.push([f + dx*dx + dy*dy, t+1, nx, ny]);   
            }
        }
    }

    return res;
}

// Returns next location a unit should go to if we should go UP TO "step" distance
// away.
export function path_step(map, from, step) {
    var rows = map.length;
    var cols = map[0].length;

    var bestdist = [(1<<30), 0];
    var bestto = [null, null];

    var [sx, sy] = from;

    var max_coord = Math.ceil(Math.sqrt(step) - EPS);
    for (var dx = -max_coord; dx <= max_coord; dx++) {
        for (var dy = -max_coord; dy <= max_coord; dy++) {
            var nx = sx+dx;
            var ny = sy+dy;
            
            if (nx < 0 || nx >= cols) continue;
            if (ny < 0 || ny >= rows) continue;
            if (map[ny][nx] === null) continue;

            if (dx*dx + dy*dy <= step) {
                if (distcmp(map[ny][nx], bestdist) < 0) {
                    bestdist = map[ny][nx];
                    bestto = [nx, ny];
                }
            }
        }
    }

    return bestto;
}

export function printmap(console, map) {
    var rows = map.length;
    var cols = map[0].length;

    for (var y = 0; y < rows; y++) {
        console.log(map[y]);
    }
}
