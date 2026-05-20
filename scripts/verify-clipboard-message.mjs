#!/usr/bin/env node
// Pure-Node verification of scrcpy 4.0 clipboard message layouts:
// outgoing SET_CLIPBOARD (i64 sequence + paste + length + utf8),
// outgoing GET_CLIPBOARD (u8 copyKey), and incoming TYPE_ACK_CLIPBOARD
// (i64 sequence). Re-implements encoders inline so this script depends
// on no project build state. Pattern mirrors verify-args-string.mjs.

const TYPE_GET_CLIPBOARD = 8;
const TYPE_SET_CLIPBOARD = 9;
const TYPE_ACK_CLIPBOARD = 1;

function buildSetClipboard(text, paste, sequence) {
    const textBytes = text ? Buffer.from(text, 'utf8') : null;
    const textLength = textBytes ? textBytes.length : 0;
    const buffer = Buffer.alloc(1 + 8 + 1 + 4 + textLength);
    let offset = 0;
    offset = buffer.writeInt8(TYPE_SET_CLIPBOARD, offset);
    buffer.writeBigInt64BE(sequence, offset);
    offset += 8;
    offset = buffer.writeInt8(paste ? 1 : 0, offset);
    offset = buffer.writeInt32BE(textLength, offset);
    if (textBytes) {
        textBytes.copy(buffer, offset);
    }
    return buffer;
}

function buildGetClipboard(copyKey) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt8(TYPE_GET_CLIPBOARD, 0);
    buffer.writeUInt8(copyKey, 1);
    return buffer;
}

function parseAck(buf) {
    const type = buf.readUInt8(0);
    if (type !== TYPE_ACK_CLIPBOARD) {
        throw new TypeError(`Wrong message type: ${type}`);
    }
    return buf.readBigInt64BE(1);
}

function assertEqualBuf(label, actual, expected) {
    if (actual.equals(expected)) {
        console.log(`OK  ${label}`);
        console.log(`    ${actual.toString('hex')}`);
        return true;
    }
    console.error(`FAIL ${label}`);
    console.error(`    expected: ${expected.toString('hex')}`);
    console.error(`    actual:   ${actual.toString('hex')}`);
    return false;
}

function assertEqual(label, actual, expected) {
    if (actual === expected) {
        console.log(`OK  ${label}`);
        console.log(`    ${actual}`);
        return true;
    }
    console.error(`FAIL ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    return false;
}

let ok = true;

// --- SET_CLIPBOARD: sequence=0x1234, paste=true, text="hi" ---
const expectedSet = Buffer.from([
    0x09,                                              // type
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x12, 0x34,    // sequence i64 BE = 0x1234
    0x01,                                              // paste = true
    0x00, 0x00, 0x00, 0x02,                            // length = 2
    0x68, 0x69,                                        // "hi"
]);
const actualSet = buildSetClipboard('hi', true, 0x1234n);
ok = assertEqualBuf('set SET_CLIPBOARD (sequence=0x1234, paste=true, "hi")', actualSet, expectedSet) && ok;
ok = assertEqual('set SET_CLIPBOARD length', actualSet.length, 16) && ok;

// --- GET_CLIPBOARD: copyKey=1 (COPY) ---
const expectedGet = Buffer.from([0x08, 0x01]);
const actualGet = buildGetClipboard(1);
ok = assertEqualBuf('get GET_CLIPBOARD (copyKey=1)', actualGet, expectedGet) && ok;

// --- TYPE_ACK_CLIPBOARD decode: sequence=0x1234 ---
const ackBuf = Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x12, 0x34]);
const ackSeq = parseAck(ackBuf);
ok = assertEqual('ack parseAck sequence (0x1234)', ackSeq, 0x1234n) && ok;

if (!ok) {
    process.exit(1);
}
console.log('\nOK set');
console.log('OK get');
console.log('OK ack');
