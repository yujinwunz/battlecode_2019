// Contains things specifically helped by castles.
// Like a messaging queue for more organized castle messaging.
// 
// Like independently concurring what castles are responsible
// for what areas, and sending troops there.

import * as utils from 'utils.js';

export const MAX_ID = 4096;

// Messaging stack. Receive multi-part messages from all other bots, and detect
// deaths through silence.

export var message_buffer = [];
export var buffer_size    = [];
export var expected_size  = [];
export var unit_of_id     = [];

var active_ids = {};

export function init_castle_talk() {
    for (var i = 0; i <= MAX_ID; i++) {
        message_buffer.push(0);
        buffer_size.push(0);
        expected_size.push(0);
        unit_of_id.push(null);
    }
}

export function receive(robots, on_msg, on_death, game=null) {
    var seen = {};
    robots.forEach(r => {
        if (game.me.id === r.id) return;
        if ("castle_talk" in r) {
            seen[r.id] = true;
            active_ids[r.id] = true;
            on_msg(r, r.castle_talk);
        }
    });

    for (var i in active_ids) {
        if (!(i in seen)) on_death(i);
    }

    active_ids = seen;
}
