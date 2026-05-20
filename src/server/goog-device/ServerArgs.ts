export interface ServerLaunchOptions {
    serverVersion: string;
    serverType: string;
    logLevel: string;
    serverPort: string | number;
    listenOnAllInterfaces: boolean;
}

/**
 * Build the positional argv string for a v1.19-ws6 scrcpy server.
 *
 * Legacy NetrisTV-fork shape:
 *   SERVER_VERSION SERVER_TYPE LOG_LEVEL SERVER_PORT LISTEN
 * followed by the shell-stderr redirect `2>&1 > /dev/null` so the
 * background app_process invocation behaves identically to before.
 *
 * A future v3/v4 builder will key=value-encode arguments per upstream
 * Options.java (see docs/scrcpy-v3-migration/args.md). Keep that path
 * in a separate exported function — do not add a `version` switch here.
 */
export function buildLegacyArgs_v1_19_ws6(opts: ServerLaunchOptions): string {
    const args = [
        opts.serverVersion,
        String(opts.serverType),
        opts.logLevel,
        String(opts.serverPort),
        String(opts.listenOnAllInterfaces),
    ].join(' ');
    return `/ com.genymobile.scrcpy.Server ${args} 2>&1 > /dev/null`;
}
