// Some useful util functions

export const VERTICAL = 0;
export const HORIZONTAL = 1;

export function bitCount (n) {
  n = n - ((n >> 1) & 0x55555555)
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333)
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24
}

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
