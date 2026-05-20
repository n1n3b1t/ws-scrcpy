#!/usr/bin/env node
// Pure-Node verification that ControlMessage and MotionEvent type-byte
// and button constants match upstream scrcpy 4.0 values, AND that the
// fork's private extension slots (101, 102) are preserved. Reads the
// TypeScript source as text so the script depends on NO build state
// and can be run at any commit.
//
// Upstream source:
//   https://github.com/Genymobile/scrcpy/blob/v4.0/server/src/main/java/com/genymobile/scrcpy/control/ControlMessage.java

import { readFileSync } from 'node:fs';

const controlMessagePath = 'src/app/controlMessage/ControlMessage.ts';
const motionEventPath = 'src/app/MotionEvent.ts';

const controlMessageExpected = {
    // Upstream block (0-11). Names diverge from upstream (e.g. TYPE_KEYCODE
    // vs upstream TYPE_INJECT_KEYCODE) but byte values match.
    TYPE_KEYCODE: 0,
    TYPE_TEXT: 1,
    TYPE_TOUCH: 2,
    TYPE_SCROLL: 3,
    TYPE_BACK_OR_SCREEN_ON: 4,
    TYPE_EXPAND_NOTIFICATION_PANEL: 5,
    TYPE_EXPAND_SETTINGS_PANEL: 6,
    TYPE_COLLAPSE_PANELS: 7,
    TYPE_GET_CLIPBOARD: 8,
    TYPE_SET_CLIPBOARD: 9,
    TYPE_SET_SCREEN_POWER_MODE: 10,
    TYPE_ROTATE_DEVICE: 11,
    // Upstream 4.0 additions (12-21).
    TYPE_UHID_CREATE: 12,
    TYPE_UHID_INPUT: 13,
    TYPE_UHID_DESTROY: 14,
    TYPE_OPEN_HARD_KEYBOARD_SETTINGS: 15,
    TYPE_START_APP: 16,
    TYPE_RESET_VIDEO: 17,
    TYPE_CAMERA_SET_TORCH: 18,
    TYPE_CAMERA_ZOOM_IN: 19,
    TYPE_CAMERA_ZOOM_OUT: 20,
    TYPE_RESIZE_DISPLAY: 21,
    // Fork-private slots — must remain unchanged.
    TYPE_CHANGE_STREAM_PARAMETERS: 101,
    TYPE_PUSH_FILE: 102,
};

const motionEventExpected = {
    BUTTON_PRIMARY: 1,
    BUTTON_SECONDARY: 2,
    BUTTON_TERTIARY: 4,
    BUTTON_BACK: 8,
    BUTTON_FORWARD: 16,
};

function readSource(path) {
    try {
        return readFileSync(path, 'utf8');
    } catch (err) {
        console.error(`FAIL  could not read ${path}: ${err.message}`);
        process.exit(1);
    }
}

// Evaluate the RHS of `public static NAME ... = <RHS>;` as either a decimal
// literal or a `1 << N` shift expression, since MotionEvent uses the latter.
function parseValue(rhs) {
    const trimmed = rhs.trim();
    if (/^-?\d+$/.test(trimmed)) {
        return Number(trimmed);
    }
    const shift = trimmed.match(/^1\s*<<\s*(\d+)$/);
    if (shift) {
        return 1 << Number(shift[1]);
    }
    return null;
}

function checkConstants(label, src, expected) {
    let ok = true;
    for (const [name, want] of Object.entries(expected)) {
        const re = new RegExp(
            `public\\s+static\\s+${name}(?:\\s*:\\s*number)?\\s*=\\s*([^;]+);`,
        );
        const m = src.match(re);
        if (!m) {
            console.error(`FAIL  ${label}.${name}: not found in source`);
            ok = false;
            continue;
        }
        const got = parseValue(m[1]);
        if (got === null) {
            console.error(
                `FAIL  ${label}.${name}: could not parse RHS ${JSON.stringify(m[1].trim())}`,
            );
            ok = false;
            continue;
        }
        if (got !== want) {
            console.error(
                `FAIL  ${label}.${name}: expected ${want}, got ${got}`,
            );
            ok = false;
            continue;
        }
        console.log(`OK    ${label}.${name} = ${got}`);
    }
    return ok;
}

const controlSrc = readSource(controlMessagePath);
const motionSrc = readSource(motionEventPath);

let allOk = true;
allOk = checkConstants('ControlMessage', controlSrc, controlMessageExpected) && allOk;
allOk = checkConstants('MotionEvent', motionSrc, motionEventExpected) && allOk;

if (!allOk) {
    process.exit(1);
}
console.log('\nAll control-type constants: OK');
