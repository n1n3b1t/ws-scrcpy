export const SERVER_PACKAGE = 'com.genymobile.scrcpy.Server';
export const SERVER_PORT = 8886;
export const SERVER_VERSION = '1.19-ws6';

export const SERVER_TYPE = 'web';

export const LOG_LEVEL = 'ERROR';

export let SCRCPY_LISTENS_ON_ALL_INTERFACES: boolean;
/// #if SCRCPY_LISTENS_ON_ALL_INTERFACES
SCRCPY_LISTENS_ON_ALL_INTERFACES = true;
/// #else
SCRCPY_LISTENS_ON_ALL_INTERFACES = false;
/// #endif

const ARGUMENTS = [SERVER_VERSION, SERVER_TYPE, LOG_LEVEL, SERVER_PORT, SCRCPY_LISTENS_ON_ALL_INTERFACES];

export const SERVER_PROCESS_NAME = 'app_process';

// ARGS_STRING is the legacy v1.19-ws6 positional form. The v3/v4
// migration moves the assembly into
// src/server/goog-device/ServerArgs.ts so a future key=value builder
// can replace this without touching every caller. See
// docs/scrcpy-v3-migration/args.md.
export const ARGS_STRING = `/ ${SERVER_PACKAGE} ${ARGUMENTS.join(' ')} 2>&1 > /dev/null`;
