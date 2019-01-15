// Transpile all code following this line with babel and use 'env' (aka ES6) preset.
require('babel-register')({
    presets: [ 'env' ]
})

const nav = require("./nav");

obs_map = [
    [1, 1, 0, 1, 1],
    [1, 0, 1, 1, 1],
    [1, 0, 1, 1, 1],
    [1, 1, 1, 1, 1]
];

map = nav.build_map(obs_map, [4, 0], 2, 5);
console.log(map);
console.log(nav.path_step(map, [1, 0], 3));
