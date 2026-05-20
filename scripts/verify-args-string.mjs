#!/usr/bin/env node
// Pure-Node verification that the v1.19-ws6 args builder produces the
// exact pre-refactor RUN_COMMAND byte string. Re-implements
// buildLegacyArgs_v1_19_ws6 so this script depends on no project
// build state and can be run at any commit.

const SERVER_PACKAGE = 'com.genymobile.scrcpy.Server';
const SERVER_VERSION = '1.19-ws6';
const SERVER_TYPE = 'web';
const LOG_LEVEL = 'ERROR';
const SERVER_PORT = 8886;
const SCRCPY_LISTENS_ON_ALL_INTERFACES = false;
const TEMP_PATH = '/data/local/tmp/';
const FILE_NAME = 'scrcpy-server.jar';

function buildLegacyArgs_v1_19_ws6(opts) {
    const args = [
        opts.serverVersion,
        String(opts.serverType),
        opts.logLevel,
        String(opts.serverPort),
        String(opts.listenOnAllInterfaces),
    ].join(' ');
    return `/ ${SERVER_PACKAGE} ${args} 2>&1 > /dev/null`;
}

const expectedArgs =
    '/ com.genymobile.scrcpy.Server 1.19-ws6 web ERROR 8886 false 2>&1 > /dev/null';
const expectedRunCommand =
    'CLASSPATH=/data/local/tmp/scrcpy-server.jar nohup app_process ' +
    '/ com.genymobile.scrcpy.Server 1.19-ws6 web ERROR 8886 false 2>&1 > /dev/null';

const actualArgs = buildLegacyArgs_v1_19_ws6({
    serverVersion: SERVER_VERSION,
    serverType: SERVER_TYPE,
    logLevel: LOG_LEVEL,
    serverPort: SERVER_PORT,
    listenOnAllInterfaces: SCRCPY_LISTENS_ON_ALL_INTERFACES,
});
const actualRunCommand =
    `CLASSPATH=${TEMP_PATH}${FILE_NAME} nohup app_process ${actualArgs}`;

function assertEqual(label, actual, expected) {
    if (actual === expected) {
        console.log(`OK  ${label}`);
        console.log(`    ${JSON.stringify(actual)}`);
        return true;
    }
    console.error(`FAIL ${label}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    return false;
}

let ok = true;
ok = assertEqual('buildLegacyArgs_v1_19_ws6 output', actualArgs, expectedArgs) && ok;
ok = assertEqual('RUN_COMMAND (CLASSPATH=... nohup app_process ARGS)', actualRunCommand, expectedRunCommand) && ok;

// --- v4.0 key=value builder ---
function buildArgsKv_v4_0(opts) {
    const pairs = [
        `scid=${opts.scid}`,
        `log_level=${opts.logLevel}`,
        `audio=${opts.audio ? 'true' : 'false'}`,
        `video=${opts.video ? 'true' : 'false'}`,
        `video_codec=${opts.videoCodec}`,
    ];
    if (opts.maxSize !== undefined) pairs.push(`max_size=${opts.maxSize}`);
    if (opts.videoBitRate !== undefined) pairs.push(`video_bit_rate=${opts.videoBitRate}`);
    if (opts.maxFps !== undefined) pairs.push(`max_fps=${opts.maxFps}`);
    if (opts.displayId !== undefined) pairs.push(`display_id=${opts.displayId}`);
    pairs.push(`tunnel_forward=${opts.tunnelForward ? 'true' : 'false'}`);
    pairs.push(`control=${opts.control ? 'true' : 'false'}`);
    pairs.push(`cleanup=${opts.cleanup ? 'true' : 'false'}`);
    const args = [opts.serverVersion, ...pairs].join(' ');
    return `/ com.genymobile.scrcpy.Server ${args} 2>&1 > /dev/null`;
}

const v4Input = {
    serverVersion: '4.0',
    scid: 'abcd1234',
    logLevel: 'error',
    audio: false,
    video: true,
    videoCodec: 'h264',
    tunnelForward: true,
    control: true,
    cleanup: true,
};
const expectedV4Args =
    '/ com.genymobile.scrcpy.Server 4.0 scid=abcd1234 log_level=error ' +
    'audio=false video=true video_codec=h264 tunnel_forward=true ' +
    'control=true cleanup=true 2>&1 > /dev/null';
ok = assertEqual('buildArgsKv_v4_0 output', buildArgsKv_v4_0(v4Input), expectedV4Args) && ok;

if (!ok) {
    process.exit(1);
}
console.log('\nByte-identical: OK');
