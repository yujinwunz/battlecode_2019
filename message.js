// Remember we get 16 bits per broadcast and 8 bits per shuffle.

export const TYPE_BITS = 3;
export const UNKNOWN_TYPE = 7;
export const ID_BITS = 13;
export const COORD_BITS = 6;

export const CHECKSUM_BITS = 4;
export const CHECKSUM_MASK = ((1<<CHECKSUM_BITS)-1);
export const CHECKSUM_VALUE = 0b0101; // Any random value plz

export const KARBONITE_LEVEL_BITS = 4;
export const FUEL_LEVEL_BITS = 4;

export const UNIT_FILTER_BITS = 6;

export const SEED_BITS = 9;

const TYPEMAP = {
    pilgrim_build_church: 0b001,

    castle_distress: 0b010,

    attack: 0b011,

    start_expedition: 0b100,
    start_assult: 0b101,

    emission: 0b110, 

    order66: 0b111, // Command all building units to spam crusaders
};

// signed messages ensure that during the chaos of battle,
// only our team will send each other messages.
const SIGNEDMAP = {
    pilgrim_build_church: false,

    castle_distress: false,

    attack: false, // only sent by units who have "request_backup" beforehand.

    start_expedition: false, // to church: Send a pilgrim there. To signify which church, only works when radio signal is exactly the distance!!!!! OMG Radio radius is information
    start_assult: false,     // to church: Launch assult here 

    emission: true,

    order66: true,
};

function gen_checksum(msg, id, team) {
    var checksum = CHECKSUM_VALUE;
    for (var i = CHECKSUM_BITS; i < 16; i += CHECKSUM_BITS) {
        checksum = checksum ^ ((msg >> i) & CHECKSUM_MASK);
    }
    for (var i = 0; i < ID_BITS; i += CHECKSUM_BITS) {
        checksum = checksum ^ ((id >> i) & CHECKSUM_MASK);
    }
    checksum ^= team;

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
        if (this.type == "pilgrim_build_church") {
            this.x = arguments[1];
            this.y = arguments[2];
        } else if (this.type === "attack") {
            this.x = arguments[1];
            this.y = arguments[2];
        } else if (this.type === "castle_distress") {
            this.x = arguments[1];
            this.y = arguments[2];
        } else if (this.type === "start_expedition" || this.type === "start_assult") {
            this.x = arguments[1];
            this.y = arguments[2];
        } else if (this.type === "emission") {
            this.karbonite = arguments[1];
            this.fuel = arguments[2];
        } else if (this.type === "order66") {
            // everyone knows what order66 is
        } else if (this.type === "void" || this.type === "void_signature") {
            // Message from other team or malformed message
        } else {
            throw "invalid message type";
        }
    }

    encode(id, team) { // coordinates for encryption. Only needed to encode encrypted
                   // message.
        if (this.type === "void") throw "can't encode void message";

        var msg = 0;
        var typecode = TYPEMAP[this.type];
        msg |= (typecode << (16 - TYPE_BITS));

        if (this.type === "pilgrim_build_church") {
            msg |= (this.x << (16 - TYPE_BITS - COORD_BITS));
            msg |= (this.y << (16 - TYPE_BITS - COORD_BITS - COORD_BITS));
        } else if (this.type === "castle_distress") {
            msg |= (this.x << (16 - TYPE_BITS - COORD_BITS));
            msg |= (this.y << (16 - TYPE_BITS - COORD_BITS - COORD_BITS));
        } else if (this.type === "attack") {
            msg |= (this.x << (16 - TYPE_BITS - COORD_BITS));
            msg |= (this.y << (16 - TYPE_BITS - COORD_BITS - COORD_BITS)); 
        } else if (this.type === "start_expedition" || this.type === "start_assult") {
            msg |= (this.x << (16 - TYPE_BITS - COORD_BITS));
            msg |= (this.y << (16 - TYPE_BITS - COORD_BITS - COORD_BITS));
        } else if (this.type === "emission") {
            msg |= (this.karbonite << (16 - TYPE_BITS - KARBONITE_LEVEL_BITS));
            msg |= (this.fuel << (16 - TYPE_BITS - KARBONITE_LEVEL_BITS - FUEL_LEVEL_BITS));
        } else if (this.type === "order66") {
            // self explanatory
        }

        if (SIGNEDMAP[this.type]) {
            if (msg & CHECKSUM_MASK) throw "signed message overflow";
            msg = msg | gen_checksum(msg, id, team);
        }

        return msg;
    }
}

export function decode(rawmsg, frombot, team) {
    var omsg = rawmsg;
    var [type, rawmsg] = eat_msg(rawmsg, 3);

    var msg;
    var signed;

    if (type === TYPEMAP.pilgrim_build_church) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        msg = new Message("pilgrim_build_church", x, y);
        signed = false;
    } else if (type === TYPEMAP.castle_distress) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS); 
        msg = new Message("castle_distress", x, y);
        signed = false;
    } else if (type === TYPEMAP.attack) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS); 
        msg = new Message("attack", x, y);
        signed = false;
    } else if (type === TYPEMAP.start_expedition) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        msg = new Message("start_expedition", x, y);
        signed = false; 
    } else if (type === TYPEMAP.start_assult) {
        var [x, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        var [y, rawmsg] = eat_msg(rawmsg, COORD_BITS);
        msg = new Message("start_assult", x, y);
        signed = false; 
    } else if (type === TYPEMAP.emission) {
        var [karbonite, rawmsg] = eat_msg(rawmsg, KARBONITE_LEVEL_BITS);
        var [fuel, rawmsg] = eat_msg(rawmsg, FUEL_LEVEL_BITS);
        msg = new Message("emission", karbonite, fuel);
        signed = true;
    } else if (type === TYPEMAP.order66) {
        msg = new Message("order66");
        signed = true;
    } else {
        // invalid typecode, perhaps from enemy
        return new Message("void");
    }

    if (signed) {
        var sign = omsg & CHECKSUM_MASK;
        var thissign = gen_checksum(omsg & (~CHECKSUM_MASK), frombot.id, team);
        if (sign !== thissign) {
            console.log("Invalid message received with sums " + sign + " but got " + thissign);
            return new Message("void_signature");
        }
    }

    msg.sender = Object.assign(frombot);
    return msg;
}

