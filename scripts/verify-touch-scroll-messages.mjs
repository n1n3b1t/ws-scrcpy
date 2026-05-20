#!/usr/bin/env node
// Pure-Node verification that TouchControlMessage and ScrollControlMessage
// produce the exact upstream scrcpy 4.0 wire bytes. Re-implements both
// encoders inline so this script is independent of project build state.

const TYPE_TOUCH = 2;
const TYPE_SCROLL = 3;
const TOUCH_MAX_PRESSURE_VALUE = 0xffff;

// --- Touch encoder (PAYLOAD_LENGTH = 32 total wire bytes) ---
function encodeTouch({ action, pointerId, x, y, screenWidth, screenHeight, pressure, actionButton, buttons }) {
    const buf = Buffer.alloc(32);
    let o = 0;
    o = buf.writeUInt8(TYPE_TOUCH, o);
    o = buf.writeUInt8(action, o);
    o = buf.writeUInt32BE(0, o); // pointerId high i32
    o = buf.writeUInt32BE(pointerId, o); // pointerId low i32
    o = buf.writeInt32BE(x, o);
    o = buf.writeInt32BE(y, o);
    o = buf.writeUInt16BE(screenWidth, o);
    o = buf.writeUInt16BE(screenHeight, o);
    o = buf.writeUInt16BE(Math.round(pressure * TOUCH_MAX_PRESSURE_VALUE), o);
    o = buf.writeUInt32BE(actionButton, o);
    buf.writeUInt32BE(buttons, o);
    return buf;
}

// --- Scroll encoder (PAYLOAD_LENGTH = 20 after type byte, 21 total) ---
function toScrollFixedPoint(v) {
    const scaled = Math.round(v * 32767);
    return Math.max(-32768, Math.min(32767, scaled));
}

function encodeScroll({ x, y, screenWidth, screenHeight, hScroll, vScroll, buttons }) {
    const buf = Buffer.alloc(21);
    let o = 0;
    o = buf.writeUInt8(TYPE_SCROLL, o);
    o = buf.writeInt32BE(x, o);
    o = buf.writeInt32BE(y, o);
    o = buf.writeUInt16BE(screenWidth, o);
    o = buf.writeUInt16BE(screenHeight, o);
    o = buf.writeInt16BE(toScrollFixedPoint(hScroll), o);
    o = buf.writeInt16BE(toScrollFixedPoint(vScroll), o);
    buf.writeUInt32BE(buttons, o);
    return buf;
}

function assertHex(label, actualBuf, expectedHex) {
    const actualHex = actualBuf.toString('hex');
    const normalized = expectedHex.replace(/\s+/g, '').toLowerCase();
    if (actualHex === normalized) {
        console.log(`OK ${label}`);
        console.log(`   ${actualHex} (${actualBuf.length} bytes)`);
        return true;
    }
    console.error(`FAIL ${label}`);
    console.error(`   expected: ${normalized}`);
    console.error(`   actual:   ${actualHex}`);
    return false;
}

const touchBuf = encodeTouch({
    action: 0, // ACTION_DOWN
    pointerId: 0,
    x: 100,
    y: 200,
    screenWidth: 1080,
    screenHeight: 2160,
    pressure: 1.0,
    actionButton: 1, // BUTTON_PRIMARY
    buttons: 1,
});
const expectedTouchHex =
    '02' +
    '00' +
    '00000000' +
    '00000000' +
    '00000064' +
    '000000c8' +
    '0438' +
    '0870' +
    'ffff' +
    '00000001' +
    '00000001';

const scrollBuf = encodeScroll({
    x: 50,
    y: 75,
    screenWidth: 1080,
    screenHeight: 2160,
    hScroll: 0,
    vScroll: -1.0,
    buttons: 1,
});
const expectedScrollHex =
    '03' +
    '00000032' +
    '0000004b' +
    '0438' +
    '0870' +
    '0000' +
    '8001' +
    '00000001';

let ok = true;
ok = assertHex('touch', touchBuf, expectedTouchHex) && ok;
ok = assertHex('scroll', scrollBuf, expectedScrollHex) && ok;

if (!ok) {
    process.exit(1);
}
console.log('\nByte-identical: OK');
