const nav = require("./nav");

obs_map = [
    [0, 0, 1, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0]
];

map = nav.build_map(obs_map, [4, 0], 2, 5);
console.log(map);
