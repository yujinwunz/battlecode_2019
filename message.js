// Remember we get 16 bits per broadcast and 8 bits per shuffle.

export const TYPE_BITS = 3;
export const ID_BITS = 13;
export const COORD_BITS = 6;

export const CHECKSUM_BITS = 4;
export const CHECKSUM_MASK = ((1<<CHECKSUM_BITS)-1);
export const CHECKSUM_VALUE = 0b0101; // Any random value plz

export const UNIT_FILTER_BITS = 6;

export const SEED_BITS = 9;

const TYPEMAP = {
    pilgrim_assign_target: 0b000,
    pilgrim_build_church: 0b001,

    requesting_backup: 0b010,
};

// signed messages ensure that during the chaos of battle,
// only our team will send each other messages.
const SIGNEDMAP = {
    pilgrim_assign_target: false,
    pilgrim_build_church: false,

    requesting_backup: true,
};

function gen_checksum(msg, id) {
    var checksum = CHECKSUM_VALUE;
    for (var i = CHECKSUM_BITS; i < 16; i += CHECKSUM_BITS) {
        checksum = checksum ^ ((msg >> i) & CHECKSUM_MASK);
    }
    for (var i = 0; i < ID_BITS; i += CHECKSUM_BITS) {
        checksum = checksum ^ ((id >> i) & CHECKSUM_MASK);
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
        } else if (this.type === "requesting_backup") {
            this.filter = arguments[1];
        } else if (this.type === "void" || this.type === "void_signature") {
            // Message from other team or malformed message
        } else {
            throw "invalid message type";
        }
    }

    encode(id) { // coordinates for encryption. Only needed to encode encrypted
                   // message.
        if (this.type === "void") throw "can't encode void message";

        var msg = 0;
        var typecode = TYPEMAP[this.type];
        msg |= (typecode << (16 - TYPE_BITS));

        if (this.type === "pilgrim_assign_target" || this.type === "pilgrim_build_church") {
            msg |= (this.x << (16 - TYPE_BITS - COORD_BITS));
            msg |= (this.y << (16 - TYPE_BITS - COORD_BITS - COORD_BITS));
        } else if (this.type === "requesting_backup") {
            msg |= (this.filter << (16 - TYPE_BITS - UNIT_FILTER_BITS));
        }

        if (SIGNEDMAP[this.signed]) {
            if (msg & CHECKSUM_MASK) throw "signed message overflow";
            msg = msg | gen_checksum(msg, id);
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
    } else if (type === TYPEMAP.requesting_backup) {
        var [filter, rawmsg] = eat_msg(rawmsg, UNIT_FILTER_BITS);
        msg = new Message("requesting_backup", filter);
    } else {
        // invalid typecode, perhaps from enemy
        return new Message("void");
    }

    if (signed) {
        var sign = omsg & CHECKSUM_MASK;
        var thissign = gen_checksum(omsg & (~CHECKSUM_MASK), frombot.id);
        if (sign != thissign) {
            console.log("Invalid message received with sums " + sign + " but got " + thissign);
            return new Message("void_signature");
        }
    }

    return msg;
}

