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

/** Options consumed by the v4.0 key=value builder. */
export interface KvServerOptions {
    serverVersion: string;
    scid: string;            // 8-char lowercase hex (31 bits; leading zeros allowed)
    logLevel: string;        // 'verbose'|'debug'|'info'|'warn'|'error' (lowercase)
    audio: boolean;          // ws-scrcpy bridge has no audio path yet; pass false for now
    video: boolean;          // pass true
    videoCodec: 'h264' | 'h265' | 'av1';
    maxSize?: number;
    videoBitRate?: number;
    maxFps?: number;
    displayId?: number;
    tunnelForward: boolean;  // ws-scrcpy uses adb forward; pass true
    control: boolean;        // pass true
    cleanup: boolean;        // pass true
}

/**
 * Build the upstream scrcpy v4.0 server command line. Positional version
 * followed by key=value pairs in a canonical order (the upstream parser
 * is order-insensitive but we keep a stable order for byte-identical
 * verifier output).
 *
 * Schema source: upstream scrcpy 4.0
 * `server/src/main/java/com/genymobile/scrcpy/Options.java` key=value
 * parser. See docs/scrcpy-v3-migration/args.md.
 */
export function buildArgsKv_v4_0(opts: KvServerOptions): string {
    const pairs: string[] = [
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
