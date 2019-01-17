// Contains things specifically helped by castles.
// Like a messaging queue for more organized castle messaging.
// 
// Like independently concurring what castles are responsible
// for what areas, and sending troops there.

import * as utils from 'utils.js';

var cols, rows;

function dfs(map, k_map, f_map, loc, seen, res) {
    var [x, y] = loc;
    seen[y][x] = true;
    res.push([x, y]);
    for (var nx = Math.max(0, x-4); nx <= Math.min(cols-1, x+4); nx++) {
        for (var ny = Math.max(0, y-4); ny <= Math.min(rows-1, y+4); ny++) {
            if (seen[ny][nx]) continue;
            if (k_map[ny][nx] || f_map[ny][nx]) {
                dfs(map, k_map, f_map, [nx, ny], seen, res);
            }
        }
    }
}

export function get_best_church_location(map, group) {
    var cols = map[0].length;
    var rows = map.length;

    var minx = (1<<30), maxx = 0, miny = (1<<30), maxy = 0;
    for (var i = 0; i < group.length; i++) {
        var [x, y] = group[i];
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
    }

    var bestcost = (1<<30);
    var bestloc = [null, null];
    for (var x = Math.max(0, minx-2); x <= Math.min(cols-1, maxx+2); x++) {
        for (var y = Math.max(0, miny-2); y <= Math.min(rows-1, maxy+2); y++) {
            if (!map[y][x]) continue;

            var cost = 0;
            for (var i = 0; i < group.length; i++) {
                var [gx, gy] = group[i];
                var dist = (x-gx)*(x-gx) + (y-gy)*(y-gy);
                if (dist === 0) cost += 1000000; // not allowed to build church on resource itself
                else if (dist < 3) cost += 0;
                else if (dist <= 4) cost += 11;
                else if (dist <= 9) cost += 14;
                else if (dist <= 25) cost += 28;
                else cost += 200;
            }
            if (cost < bestcost) {
                bestcost = cost;
                bestloc = [x, y];
            }
        }
    }

    return bestloc;
}

export function get_church_locations(map, karbonite_map, fuel_map, existing_castles) {
    var symmetry = utils.symmetry(map);

    cols = map[0].length;
    rows = map.length;
    var ocols = cols, orows = rows;

    if (symmetry === utils.VERTICAL) {
        cols = Math.ceil(cols/2);
    } else rows = Math.ceil(rows/2);

    var groups = [];
    var seen = utils.null_array(cols, rows);

    // Use connected graphs to get the good castle locations.
    for (var x = 0; x < cols; x++) {
        for (var y = 0; y < rows; y++) {
            if (seen[y][x]) continue;
            if (karbonite_map[y][x] || fuel_map[y][x]) {
                var res = []
                dfs(map, karbonite_map, fuel_map, [x, y], seen, res);
                groups.push(res);
            }
        }
    }

    // Duplicate the flip. We only flipped to avoid weird cases with
    // super large clumps in the middle.
    for (var i = groups.length - 1; i >= 0; i--) {
        var g = groups[i];
        var ng = [];
        var minc = (1<<30);
        var maxc = 0;
        for (var j = 0; j < g.length; j++) {
            var [x, y] = g[j];
            if (symmetry === utils.VERTICAL) {
                ng.push([ocols-1-x, y]);
                minc = Math.min(minc, Math.min(x, ocols-1-x));
                maxc = Math.max(maxc, Math.max(x, ocols-1-x));
            } else {
                ng.push([x, orows-1-y]);
                minc = Math.min(minc, Math.min(y, orows-1-y));
                maxc = Math.max(maxc, Math.max(y, orows-1-y));
            }
        }

        // Use a single church for a resource group so close to the center
        // that it reflected into a clump
        if (maxc - minc <= 8) {
            ng.forEach(a => g.push(a));
        } else {
            groups.push(ng);
        }
    }

    var churches = [];

    // for each group, find best church location. 
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        // don't go if it's next to an existing castle
        var ok = true;
        for (var j = 0; j < existing_castles.length; j++) {
            var x = existing_castles[j].x;
            var y = existing_castles[j].y;
            if (abs(g[0] - x) <= 4 && ans(g[1] - y) <= 4) ok = false;
        }

        if (ok) churches.push(get_best_church_location(map, g));
    }

    return [churches, groups];
}