// Remember we get 16 bits per broadcast and 8 bits per shuffle.

export const TYPE_BITS = 3;
export const ID_BITS = 13;
export const COORD_BITS = 6;

export const CHECKSUM_BITS = 3;
export const CHECKSUM_MASK = ((1<<CHECKSUM_BITS)-1);
export const CHECKSUM_VALUE = 0b101; // Any random value plz

const TYPEMAP = {
    pilgrim_assign_target: 0b000,
    pilgrim_build_church: 0b001,
    pilgrim_ack: 0b000,
};

// signed messages ensure that during the chaos of battle,
// only our team will send each other messages.
const SIGNEDMAP = {
    pilgrim_assign_target: false,
    pilgrim_build_church: false,
    pilgrim_ack: false,
};

function gen_checksum(msg) {
    var checksum = CHECKSUM_VALUE;
    for (var i = CHECKSUM_BITS; i < 16; i += CHECKSUM_BITS) {
        checksum = checksum ^ ((msg >> i) & CHECKSUM_MASK);
    }

    return checksum;
}

function get_type(msg) {
    return msg >> (16 - TYPE_BITS);
}

function eat_msg(msg, bits) {
    msg = msg<<bits;
    var ret = (msg>>16);
    return [ret, msg & ((1<<16)-1)];
}

export class Message {
    constructor(type) {
        this.type = type;
        if (this.type === "pilgrim_assign_target" || this.type == "pilgrim_build_church") {
            this.x = arguments[1];
            this.y = arguments[2];
        } else if (this.type == "pilgrim_ack") {
            this.id = arguments[1];
        } else if (this.type == "void") {
            // Message from other team
        } else {
            throw "invalid message type";
        }
    }

    encode() {
        if (this.type == "void") throw "can't encode void message";

        var msg = 0;
        var typecode = TYPEMAP[this.type];
        msg |= (typecode << (16 - TYPE_BITS));

        if (this.type == "pilgrim_assign_target" || this.type == "pilgrim_build_church") {
            msg |= (this.x << (16 - TYPE_BITS - COORD_BITS));
            msg |= (this.y << (16 - TYPE_BITS - COORD_BITS - COORD_BITS));
        } else if (this.type == "pilgrim_ack") {
            msg |= (this.id << (16 - TYPE_BITS - ID_BITS));
        }

        if (SIGNEDMAP[this.signed]) {
            if (msg & CHECKSUM_MASK) throw "signed message overflow";
            msg = msg | gen_checksum(msg);
        }

        return msg;
    }
}

export function decode(rawmsg, frombot) {
    var omsg = rawmsg;
    var [type, rawmsg] = eat_msg(rawmsg, 3);

    var msg;
    var signed;

    if (type === TYPEMAP.pilgrim_assign_target) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        msg = new Message("pilgrim_assign_target", x, y);
        signed = false;
    } else if (type === TYPEMAP.pilgrim_build_church) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        msg = new Message("pilgrim_build_church", x, y);
        signed = false;
    } else {
        // invalid typecode, perhaps from enemy
        return new Message("void");
    }

    if (signed) {
        var sign = omsg & CHECKSUM_MASK;
        if (sign != gen_checksum(omsg)) {
            return new Message("void_signature");
        }
    }

    return msg;
}

