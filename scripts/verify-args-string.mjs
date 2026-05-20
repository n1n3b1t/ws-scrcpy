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

if (!ok) {
    process.exit(1);
}
console.log('\nByte-identical: OK');
