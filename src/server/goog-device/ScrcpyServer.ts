import '../../../vendor/Genymobile/scrcpy/scrcpy-server.jar';
import '../../../vendor/Genymobile/scrcpy/LICENSE';

import { Device } from './Device';
import {
    LOG_LEVEL,
    SCRCPY_LISTENS_ON_ALL_INTERFACES,
    SERVER_PACKAGE,
    SERVER_PORT,
    SERVER_PROCESS_NAME,
    SERVER_TYPE,
    SERVER_VERSION,
} from '../../common/Constants';
import path from 'path';
import { randomBytes } from 'crypto';
import PushTransfer from '@dead50f7/adbkit/lib/adb/sync/pushtransfer';
import { ServerVersion } from './ServerVersion';
import { buildArgsKv_v4_0, buildLegacyArgs_v1_19_ws6 } from './ServerArgs';

const TEMP_PATH = '/data/local/tmp/';
const FILE_DIR = path.join(__dirname, 'vendor/Genymobile/scrcpy');
const FILE_NAME = 'scrcpy-server.jar';

function generateScid(): string {
    // 31-bit unsigned (top bit masked to fit in a Java int per upstream
    // app/src/scrcpy.c::scrcpy_generate_scid).
    const num = randomBytes(4).readUInt32BE() & 0x7fffffff;
    return num.toString(16).padStart(8, '0');
}

type WaitForPidParams = { tryCounter: number; processExited: boolean; lookPidFile: boolean };

export class ScrcpyServer {
    private static PID_FILE_PATH = '/data/local/tmp/ws_scrcpy.pid';
    private static async copyServer(device: Device): Promise<PushTransfer> {
        const src = path.join(FILE_DIR, FILE_NAME);
        const dst = TEMP_PATH + FILE_NAME; // don't use path.join(): will not work on win host
        return device.push(src, dst);
    }

    // Important to notice that we first try to read PID from file.
    // Checking with `.getServerPid()` will return process id, but process may stop.
    // PID file only created after WebSocket server has been successfully started.
    private static async waitForServerPid(device: Device, params: WaitForPidParams): Promise<number[] | undefined> {
        const { tryCounter, processExited, lookPidFile } = params;
        if (processExited) {
            return;
        }
        const timeout = 500 + 100 * tryCounter;
        if (lookPidFile) {
            const fileName = ScrcpyServer.PID_FILE_PATH;
            const content = await device.runShellCommandAdbKit(`test -f ${fileName} && cat ${fileName}`);
            if (content.trim()) {
                const pid = parseInt(content, 10);
                if (pid && !isNaN(pid)) {
                    const realPid = await this.getServerPid(device);
                    if (realPid?.includes(pid)) {
                        return realPid;
                    } else {
                        params.lookPidFile = false;
                    }
                }
            }
        } else {
            const list = await this.getServerPid(device);
            if (Array.isArray(list) && list.length) {
                return list;
            }
        }
        if (++params.tryCounter > 5) {
            throw new Error('Failed to start server');
        }
        return new Promise<number[] | undefined>((resolve) => {
            setTimeout(() => {
                resolve(this.waitForServerPid(device, params));
            }, timeout);
        });
    }

    public static async getServerPid(device: Device): Promise<number[] | undefined> {
        if (!device.isConnected()) {
            return;
        }
        const list = await device.getPidOf(SERVER_PROCESS_NAME);
        if (!Array.isArray(list) || !list.length) {
            return;
        }
        const serverPid: number[] = [];
        const promises = list.map((pid) => {
            return device.runShellCommandAdbKit(`cat /proc/${pid}/cmdline`).then((output) => {
                const args = output.split('\0');
                if (!args.length || args[0] !== SERVER_PROCESS_NAME) {
                    return;
                }
                let first = args[0];
                while (args.length && first !== SERVER_PACKAGE) {
                    args.shift();
                    first = args[0];
                }
                if (args.length < 3) {
                    return;
                }
                const versionString = args[1];
                if (versionString === SERVER_VERSION) {
                    serverPid.push(pid);
                } else {
                    const currentVersion = new ServerVersion(versionString);
                    if (currentVersion.isCompatible()) {
                        const desired = new ServerVersion(SERVER_VERSION);
                        if (desired.gt(currentVersion)) {
                            console.log(
                                device.TAG,
                                `Found old server version running (PID: ${pid}, Version: ${versionString})`,
                            );
                            console.log(device.TAG, 'Perform kill now');
                            device.killProcess(pid);
                        }
                    }
                }
                return;
            });
        });
        await Promise.all(promises);
        return serverPid;
    }

    public static async run(device: Device): Promise<number[] | undefined> {
        if (!device.isConnected()) {
            return;
        }
        let list: number[] | string | undefined = await this.getServerPid(device);
        if (Array.isArray(list) && list.length) {
            return list;
        }
        await this.copyServer(device);

        const version = new ServerVersion(SERVER_VERSION);
        const v4 = new ServerVersion('4.0');
        let argsString: string;
        if (version.equals(v4) || version.gt(v4)) {
            // v4.0+: key=value, with a per-session scid.
            const scid = generateScid();
            argsString = buildArgsKv_v4_0({
                serverVersion: SERVER_VERSION,
                scid,
                logLevel: LOG_LEVEL.toLowerCase(),  // upstream expects lowercase
                audio: false,                       // no audio path in bridge yet
                video: true,
                videoCodec: 'h264',                 // bridge only handles h264 today
                tunnelForward: true,                // ws-scrcpy uses adb forward
                control: true,
                cleanup: true,
            });
        } else {
            // sub-4.0 (1.19-ws6 today): positional legacy form.
            argsString = buildLegacyArgs_v1_19_ws6({
                serverVersion: SERVER_VERSION,
                serverType: SERVER_TYPE,
                logLevel: LOG_LEVEL,
                serverPort: SERVER_PORT,
                listenOnAllInterfaces: SCRCPY_LISTENS_ON_ALL_INTERFACES,
            });
        }
        const runCommand = `CLASSPATH=${TEMP_PATH}${FILE_NAME} nohup app_process ${argsString}`;

        const params: WaitForPidParams = { tryCounter: 0, processExited: false, lookPidFile: true };
        const runPromise = device.runShellCommandAdb(runCommand);
        runPromise
            .then((out) => {
                if (device.isConnected()) {
                    console.log(device.TAG, 'Server exited:', out);
                }
            })
            .catch((e) => {
                console.log(device.TAG, 'Error:', e.message);
            })
            .finally(() => {
                params.processExited = true;
            });
        list = await Promise.race([runPromise, this.waitForServerPid(device, params)]);
        if (Array.isArray(list) && list.length) {
            return list;
        }
        return;
    }
}
