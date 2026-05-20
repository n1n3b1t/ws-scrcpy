# scrcpy 3.x migration — CLI / server argument layer

This document surveys the gap between the `ws-scrcpy` fork (which pins the
WebSocket-enabled `scrcpy-server` at version `1.19-ws6`) and current
upstream `Genymobile/scrcpy` 3.x / 4.0. Scope: only the bytes that travel
on the `app_process` command line and the per-stream settings that are
currently smuggled around it. UI, transport, encoding pipeline, and
client-side options are covered by sibling docs.

Upstream references used:
- `Genymobile/scrcpy` master `server/src/main/java/com/genymobile/scrcpy/Options.java`
- `Genymobile/scrcpy` `v1.19` tag, same file (positional parser)
- `Genymobile/scrcpy` `v1.21` tag, same file (cutover to `key=value`)
- Release notes for v1.20 … v4.0 (Nov 2021 → May 2026)
- `doc/video.md`, `doc/audio.md`, `doc/device.md` on master

## Current state in this fork

### The vendored server is a hard fork, not stock scrcpy

`vendor/Genymobile/scrcpy/scrcpy-server.jar` is **not** the upstream
Genymobile build. `README.md:139-142` makes this explicit — the binary is
prebuilt from `NetrisTV/scrcpy` branch `feature/websocket-v1.19.x`. That
branch adds a "web" server-type that listens for WebSocket connections
and accepts a `port` and a "listen on all interfaces" flag in argv. The
launching contract in this repo is written for that fork's argv layout,
not Genymobile's. This is the single most important fact in the doc —
every concrete change below either replaces or coexists with the fact
that the JAR itself has to be replaced or rebuilt.

### Static argument string

All server arguments live in one place: `src/common/Constants.ts`.

```ts
// src/common/Constants.ts
1   export const SERVER_PACKAGE = 'com.genymobile.scrcpy.Server';
2   export const SERVER_PORT = 8886;
3   export const SERVER_VERSION = '1.19-ws6';
5   export const SERVER_TYPE = 'web';
7   export const LOG_LEVEL = 'ERROR';
9   let SCRCPY_LISTENS_ON_ALL_INTERFACES;       // build-time conditional
16  const ARGUMENTS = [SERVER_VERSION, SERVER_TYPE, LOG_LEVEL,
                       SERVER_PORT, SCRCPY_LISTENS_ON_ALL_INTERFACES];
18  export const SERVER_PROCESS_NAME = 'app_process';
20  export const ARGS_STRING =
        `/ ${SERVER_PACKAGE} ${ARGUMENTS.join(' ')} 2>&1 > /dev/null`;
```

Wire order pushed to `app_process` (`Constants.ts:16`, `Constants.ts:20`):

| argv | value                                                    |
|------|----------------------------------------------------------|
| 0    | `1.19-ws6` (`SERVER_VERSION`)                            |
| 1    | `web` (`SERVER_TYPE` — NetrisTV-fork-specific)           |
| 2    | `ERROR` (`LOG_LEVEL`)                                    |
| 3    | `8886` (`SERVER_PORT` — NetrisTV-fork-specific)          |
| 4    | `true`/`false` (`SCRCPY_LISTENS_ON_ALL_INTERFACES`)      |

These are positional, space-separated. There is no `key=` prefix
anywhere on the command line. The full shell expansion is:

```
CLASSPATH=/data/local/tmp/scrcpy-server.jar nohup app_process \
  / com.genymobile.scrcpy.Server 1.19-ws6 web ERROR 8886 false \
  2>&1 > /dev/null
```

### Launch site

`src/server/goog-device/ScrcpyServer.ts:13` composes the final shell
command:

```ts
const RUN_COMMAND =
  `CLASSPATH=${TEMP_PATH}${FILE_NAME} nohup app_process ${ARGS_STRING}`;
```

`ScrcpyServer.run()` (`ScrcpyServer.ts:111-140`) pushes the JAR to
`/data/local/tmp/scrcpy-server.jar`, executes `RUN_COMMAND` via
`device.runShellCommandAdb()`, then polls `/proc/<pid>/cmdline` to
confirm the launched process matches `SERVER_VERSION`.

### Version-compat gate

`ScrcpyServer.ts:88-103` only considers a running server "the same" if
its argv[1] string equals `SERVER_VERSION`. `ServerVersion.ts:13`
further gates compatibility on a `-ws*` suffix:

```ts
// ServerVersion.ts:13
this.compatible = this.suffix.startsWith('ws') && this.parts.length >= 2;
```

Any upstream version (`2.x`, `3.x`, `4.0`) will fail the suffix check
and be treated as incompatible — even before its argv layout would
fail to parse.

### Per-call overrides are NOT on the command line

This is the second most important fact in the doc. Per-stream things
that scrcpy 2.x+ requires on the CLI — `max_size`, `video_bit_rate`,
`max_fps`, `crop`, `display_id`, `video_codec`, `video_codec_options`,
`video_encoder`, etc. — are **never** passed to `app_process` in this
fork. They are transmitted later over the WebSocket as a packed binary
`VideoSettings` payload (`src/app/VideoSettings.ts:154-197`,
`fromBuffer` at `:52-117`), parsed by the NetrisTV fork's in-process
controller, and applied at runtime through a private RPC channel.

The buffer carries: `bitrate (i32be)`, `maxFps (i32be)`,
`iFrameInterval (i8)`, `bounds.width/height (i16be x2)`,
`crop.left/top/right/bottom (i16be x4)`, `sendFrameMeta (i8)`,
`lockedVideoOrientation (i8)`, `displayId (i32be)`, then length-prefixed
UTF-8 strings for `codecOptions` and `encoderName`
(`VideoSettings.ts:154-197`). The user-facing form in
`src/app/googDevice/client/ConfigureScrcpy.ts:352-379` (`buildVideoSettings`)
collects: `bitrate`, `maxFps`, `iFrameInterval`, `maxWidth`,
`maxHeight`, `displayId`, `codecOptions`, `encoderName`. Per-player
defaults are scattered around `src/app/player/*Player.ts`
(`BroadwayPlayer.ts:16-20`, `MsePlayer.ts:23-27`, etc.).

That entire mechanism is a private extension of the NetrisTV
WebSocket-fork server. **Stock scrcpy from 2.0 onward does not understand
the `VideoSettings` binary protocol at all.** Settings have to be on
the CLI now.

## Upstream gap

### The argv format changed in v1.21

Verified by reading both tags:

- `v1.19 server/src/main/java/com/genymobile/scrcpy/Server.java`
  `createOptions(args)` (lines 152-201) consumes **16 positional argv
  slots**: `argv[0]=version, argv[1]=log_level, argv[2]=max_size,
  argv[3]=bit_rate, argv[4]=max_fps, argv[5]=lock_video_orientation,
  argv[6]=tunnel_forward, argv[7]=crop, argv[8]=send_frame_meta,
  argv[9]=control, argv[10]=display_id, argv[11]=show_touches,
  argv[12]=stay_awake, argv[13]=codec_options, argv[14]=encoder_name,
  argv[15]=power_off_screen_on_close`.
- `v1.21 server/.../Server.java` is the cutover. `argv[0]` is still the
  client version string and is checked against `BuildConfig.VERSION_NAME`,
  but everything after it is now parsed as `key=value` pairs:

  ```java
  for (int i = 1; i < args.length; ++i) {
      String arg = args[i];
      int equalIndex = arg.indexOf('=');
      String key = arg.substring(0, equalIndex);
      String value = arg.substring(equalIndex + 1);
      switch (key) { ... }
  }
  ```

  Unknown keys produce a warning and are skipped (graceful), so future
  3.x→4.x changes are largely backward-compatible from the launcher's
  point of view — provided the launcher already speaks `key=value`.

### Example of the new launch line

Upstream 3.x is invoked roughly as (taken from running scrcpy with
`--server-debugger` and from the master `Options.java` parser):

```
CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / \
  com.genymobile.scrcpy.Server \
  3.3.4 \
  log_level=info \
  audio=true \
  video_codec=h264 \
  audio_codec=opus \
  max_size=0 \
  video_bit_rate=8000000 \
  max_fps=0 \
  tunnel_forward=false \
  control=true \
  cleanup=true \
  raw_stream=false
```

Two structural differences from the current fork string:

1. `argv[0]` is the **stock** version (`3.3.4`), with no `-ws*` suffix.
2. Everything else is `key=value`. There is no `web` server-type and no
   `port=…` — stock scrcpy talks back over the adb-tunneled local socket,
   not over its own WebSocket.

### Argument inventory on current master

From `server/src/main/java/com/genymobile/scrcpy/Options.java` parser
switch (master, May 2026 — verified against the v4.0 / v3.3.4 server
JARs):

**Session / logging**
- `scid` — session ID (hex, -1 = random). Added v2.0.
- `log_level` — `verbose|debug|info|warn|error`. Existed in 1.x.

**Stream selection**
- `video` (bool, default `true`). Added v2.0.
- `audio` (bool, default `true`). Added v2.0.
- `video_source` — `display|camera`. Added v2.4.
- `audio_source` — `output|playback|mic|mic-unprocessed|mic-camcorder|mic-voice-recognition|mic-voice-communication|voice-call|voice-call-uplink|voice-call-downlink|voice-performance`. Added v2.0, expanded v3.2.
- `audio_dup` (bool). Added v3.0.

**Codecs / bitrate / fps**
- `video_codec` — `h264|h265|av1`, default `h264`. Added v2.0.
- `audio_codec` — `opus|aac|flac|raw`, default `opus`. Added v2.0.
- `video_bit_rate` — int (bps), default `8000000`. **Renamed** from
  `bit_rate` in v2.0.
- `audio_bit_rate` — int (bps), default `128000`. Added v2.0.
- `max_fps` — int, default `0` (no cap). Always existed.
- `video_codec_options` — opaque MediaFormat option string. **Renamed**
  from `codec_options` in v2.0.
- `audio_codec_options`. Added v2.0.
- `video_encoder` — explicit encoder name. **Renamed** from
  `encoder_name` in v2.0.
- `audio_encoder`. Added v2.0.

**Size / framing**
- `max_size` — int, default `0` (no cap). Always existed.
- `min_size_alignment` — `1|2|4|8|16`. Added v4.0.
- `crop` — `W:H:X:Y`. Always existed; format unchanged.

**Display & orientation**
- `display_id` — int, default `0`. Always existed.
- `capture_orientation` — `0|90|180|270|flip0|flip90|flip180|flip270`
  with optional `@` lock prefix. Added v3.0. **Supersedes**
  `lock_video_orientation` from 1.x.
- `angle` — float degrees. Added v3.0.
- `display_ime_policy` — `local|fallback|hide`. Added v3.2.

**Virtual / flex displays (3.x, 4.0)**
- `new_display` — `WxH/dpi` or `/dpi` or just `W x H`. Added v3.0.
- `vd_destroy_content` (bool, default `true`). Added v3.0; companion CLI
  flag `--no-vd-destroy-content` arrived v3.1.
- `vd_system_decorations` (bool). Added v3.0.
- `flex_display` (bool). Added v4.0.

**Control & device state**
- `control` (bool, default `true`). Always existed.
- `show_touches` (bool). Always existed.
- `stay_awake` (bool). Always existed.
- `screen_off_timeout` — int (ms). Added v2.4.
- `power_off_on_close` (bool). Existed since 1.18.
- `power_on` (bool, default `true`). Added v2.0.
- `cleanup` (bool, default `true`). Added v2.0.
- `clipboard_autosync` (bool). Added v1.21.
- `keep_active` (bool). Added v4.0.

**Camera (separate from display source) — all added v2.4 / v3.x**
- `camera_id`, `camera_size`, `camera_facing`, `camera_ar`,
  `camera_zoom`, `camera_fps`, `camera_high_speed`, `camera_torch`.

**Listing modes (server prints then exits)**
- `list_encoders`, `list_displays`, `list_cameras`, `list_camera_sizes`,
  `list_apps`. Added v2.0 / v2.4 / v3.0.

**Tunnel / stream framing**
- `tunnel_forward` (bool). Always existed; semantics unchanged.
- `send_device_meta` (bool, default `true`). Added v2.0.
- `send_frame_meta` (bool, default `true`). Existed in 1.x as positional.
- `send_dummy_byte` (bool, default `true`). Added v2.0.
- `send_stream_meta` (bool). Added v3.x.
- `raw_stream` (bool, default `false`) — disables all meta; supersedes
  `raw_video_stream` from v1.22.

**Robustness**
- `downsize_on_error` (bool, default `true`). Added v1.22.

### Removed / renamed since v1.19

| 1.19 name                            | 3.x / 4.0 name                          |
|--------------------------------------|------------------------------------------|
| `bit_rate` (argv[3])                 | `video_bit_rate`                         |
| `codec_options` (argv[13])           | `video_codec_options`                    |
| `encoder_name` (argv[14])            | `video_encoder`                          |
| `lock_video_orientation` (argv[5])   | `capture_orientation` (richer semantics) |
| `raw_video_stream` (1.22+)           | `raw_stream`                             |
| positional `power_off_screen_on_close` | `power_off_on_close`                   |
| (n/a — NetrisTV-only) `web`          | removed; stock uses adb tunnel           |
| (n/a — NetrisTV-only) `port`         | removed; stock uses adb tunnel           |
| (n/a — NetrisTV-only) "listen on all interfaces" | removed                       |

`send_frame_meta` survives, but in 1.19 it was argv[8] and in 3.x it is
just one boolean among many.

### Default-value changes worth flagging

- Default video bitrate dropped from `8000000` (8 Mbps) → unchanged
  numerically but the unit/flag changed name.
- `max_size=0` (no cap) is unchanged.
- `max_fps=0` (no cap) is unchanged.
- `control=true` is unchanged.
- Audio defaults to **on** (`audio=true`) since v2.0; expect mirroring
  to silently start grabbing audio unless the launcher passes
  `audio=false`. Audio capture only works on Android ≥ 11 (per
  `doc/audio.md`), so a Pixel on Android 10 will hard-fail unless
  `audio=false` or scrcpy gracefully falls back. Stock scrcpy falls
  back silently unless `--require-audio` is set, but the failure mode
  on the ws-scrcpy launcher needs explicit handling.
- Stock scrcpy 4.0 enables a window-aspect-ratio lock by default — not
  a server-side concern, but worth noting that anything that ships a
  client UI alongside the server bump will see new defaults.

## Concrete changes needed

The list below assumes the longer-term path: ws-scrcpy upgrades the
vendored server to a 3.x-compatible build, either by rebasing the
NetrisTV WebSocket patches onto upstream 3.x or by switching to the
stock JAR and moving the WebSocket bridge into the Node.js side of
ws-scrcpy. The argv contract is what changes either way.

### `src/common/Constants.ts`

- `Constants.ts:3` — bump `SERVER_VERSION`. If continuing the NetrisTV
  fork, target something like `'3.3.4-ws1'`; if switching to stock,
  target the bare upstream version (e.g. `'3.3.4'`) and adjust the
  compat gate (see `ServerVersion.ts` below).
- `Constants.ts:16` — delete the positional `ARGUMENTS` array.
- `Constants.ts:5, :7, :9-14` — `SERVER_TYPE`, `LOG_LEVEL`,
  `SCRCPY_LISTENS_ON_ALL_INTERFACES`, `SERVER_PORT` are NetrisTV-fork
  concepts. If stock scrcpy is adopted they cease to be CLI args at
  all and become Node-side concerns. If the WebSocket-aware fork is
  preserved, they remain but must be emitted as `web=true`,
  `log_level=error`, `port=8886`, `listen_on_all_interfaces=false`.
- `Constants.ts:20` — replace the `ARGS_STRING` template literal with
  a builder. Concrete shape:

  ```ts
  // pseudo-code
  export function buildServerArgs(opts: ServerLaunchOptions): string {
    const pairs: string[] = [];
    pairs.push(`log_level=${opts.logLevel}`);
    pairs.push(`audio=${opts.audio ? 'true' : 'false'}`);
    pairs.push(`video_codec=${opts.videoCodec ?? 'h264'}`);
    if (opts.audio) pairs.push(`audio_codec=${opts.audioCodec ?? 'opus'}`);
    if (opts.maxSize) pairs.push(`max_size=${opts.maxSize}`);
    if (opts.videoBitRate) pairs.push(`video_bit_rate=${opts.videoBitRate}`);
    if (opts.maxFps) pairs.push(`max_fps=${opts.maxFps}`);
    if (opts.displayId != null) pairs.push(`display_id=${opts.displayId}`);
    if (opts.crop) pairs.push(`crop=${opts.crop}`);
    if (opts.captureOrientation)
      pairs.push(`capture_orientation=${opts.captureOrientation}`);
    if (opts.videoCodecOptions)
      pairs.push(`video_codec_options=${opts.videoCodecOptions}`);
    if (opts.videoEncoder)
      pairs.push(`video_encoder=${opts.videoEncoder}`);
    pairs.push(`tunnel_forward=${opts.tunnelForward ? 'true' : 'false'}`);
    pairs.push(`control=${opts.control ? 'true' : 'false'}`);
    pairs.push(`cleanup=true`);
    return `${SERVER_VERSION} ${pairs.join(' ')}`;
  }
  ```

  Values that may contain shell metacharacters (`crop` is fine,
  `video_codec_options` is a free-form string from user input) must be
  passed through a shell-quoting helper, since `ARGS_STRING` is still
  spliced into an `adb shell` invocation in `ScrcpyServer.ts:13`.

### `src/server/goog-device/ScrcpyServer.ts`

- `ScrcpyServer.ts:13` — `RUN_COMMAND` becomes per-launch instead of a
  module-level constant. `ScrcpyServer.run(device, opts)` needs a new
  parameter carrying the per-client settings, and `RUN_COMMAND`
  becomes:
  ```ts
  const runCommand =
    `CLASSPATH=${TEMP_PATH}${FILE_NAME} nohup app_process / ` +
    `${SERVER_PACKAGE} ${buildServerArgs(opts)} 2>&1 > /dev/null`;
  ```
- `ScrcpyServer.ts:88` — version comparison still works (still argv[1]
  in cmdline, since `app_process` prefixes with `/` and the class name
  remains at the same slot), but the equality check should accept
  either the new bare upstream tag or a new `-wsN` suffix scheme.
- `ScrcpyServer.ts:64-109` (`getServerPid`) — the search uses
  `/proc/<pid>/cmdline` and indexes into the split argv. The version
  field stays at the same index, so the loop body need not change, but
  any code that *assumes* additional positional slots after version
  (none currently in this file) would have to be rewritten.
- New: once the server is launched, ws-scrcpy must connect via the
  adb-tunneled local abstract socket if stock scrcpy is adopted, not
  via the WebSocket port. That changes `Device.ts` / the surrounding
  transport code (out of scope for this layer but worth flagging).

### `src/server/goog-device/ServerVersion.ts`

- `ServerVersion.ts:13` — the `.suffix.startsWith('ws')` gate must
  loosen. Either accept bare upstream versions (`3.x.y`) or extend the
  suffix scheme to e.g. `ws-3.x.y`.

### `src/app/VideoSettings.ts`

This file is the heart of the per-call protocol that no longer exists
upstream. Two paths:

1. **Rebase NetrisTV's `VideoSettings` RPC onto 3.x**: keep the binary
   protocol, port it onto the new server. This requires picking up
   `video_codec`, `audio_codec`, and `audio` into the binary frame
   (which currently has no slots for them — see
   `VideoSettings.ts:154-197`), and re-implementing the in-process
   handler in the rebased server JAR.
2. **Drop the runtime VideoSettings protocol entirely**: bake everything
   into the CLI launch args, restart the server when the user changes
   settings. This is the simpler path and matches how stock scrcpy
   already works.

If path 2 is chosen, `VideoSettings.toBuffer()` / `.fromBuffer()` lose
their reason to exist on the wire, but the class can still serve as the
in-memory settings carrier feeding `buildServerArgs(opts)`.

Either way, three new fields must be added to `Settings` interface
(`VideoSettings.ts:5-16`):

- `videoCodec?: 'h264' | 'h265' | 'av1'`
- `audio?: boolean`
- `audioCodec?: 'opus' | 'aac' | 'flac' | 'raw'`

…and optionally `captureOrientation`, `angle`, `newDisplay`, etc., for
feature parity with 3.x.

### `src/app/googDevice/client/ConfigureScrcpy.ts`

- `ConfigureScrcpy.ts:352-379` (`buildVideoSettings`) — extend to
  collect new fields (`videoCodec`, `audio`, `audioCodec`, optionally
  `captureOrientation`).
- `ConfigureScrcpy.ts:470-506` — extend the UI builder to expose a
  codec dropdown (h264/h265/av1), an audio on/off toggle, an audio
  codec dropdown, and a `capture_orientation` selector. The current
  "Codec options" free-text field maps to `video_codec_options` and
  keeps its name and semantics.
- `ConfigureScrcpy.ts:295-308` (`fillBasicInput`) — used today for
  numeric inputs; for the new dropdowns use the existing pattern at
  `:104-119` (encoder select) and `:121-165` (display select).

### Per-player default tables

Default `VideoSettings` blocks in `src/app/player/*Player.ts`
(`BroadwayPlayer.ts:16-20`, `MsePlayer.ts:23-27`,
`MsePlayerForQVHack.ts:8-12`, plus any sibling player files) all hard-
code `bitrate`/`maxFps`/`iFrameInterval`/`bounds`. They will need
`videoCodec` / `audio` defaults appended. Broadway can only decode
H.264; if `videoCodec` is exposed it must be locked to `h264` for the
Broadway player or the choice has to be disabled in the UI when
Broadway is selected.

### Vendored JAR

`vendor/Genymobile/scrcpy/scrcpy-server.jar` must be rebuilt. The
NetrisTV fork branch (`feature/websocket-v1.19.x`) does not have a 3.x
counterpart at the time of writing — that itself is a piece of work
that has to happen outside this repo. Document the build provenance in
`README.md:139-142` once it lands.

## Risk / unknowns

- **No live testing has been done against a 3.x server.** Every claim
  about the wire format is from reading source on master and tagged
  refs. The first time someone actually runs ws-scrcpy against a 3.x
  JAR, a handful of unknowns will likely surface (PID-detection
  timing, abstract-socket name changes, etc. — those are sibling
  layers' problems, but they couple back into the launch sequence).
- **The NetrisTV WebSocket fork has no 3.x rebase that we can verify
  exists.** If the only viable path is "fork-the-fork onto 3.x", the
  schedule for that work dominates everything in this doc. The
  alternative — switch to stock scrcpy and re-implement the WebSocket
  bridge in Node — is a bigger rewrite for ws-scrcpy itself but
  removes the dependency on a downstream Java fork.
- **`video_codec_options` and `video_encoder` are user-controlled
  strings** spliced into a shell command. The 1.x positional layout
  was already a quoting hazard (`codec_options` could contain `=` and
  `,` characters); a key=value rewrite that joins on space without
  shell-quoting is just as vulnerable. The replacement builder needs
  proper quoting from day one; treat this as a security item, not a
  cleanup item.
- **Audio on by default is a behavior change.** Stock scrcpy 3.x will
  silently start capturing audio. Whether ws-scrcpy should default
  `audio=false` (preserves current behavior — no audio in the
  browser) or `audio=true` (matches upstream and forces the
  client-side audio pipeline to be added) is a product decision, not
  a code one. Recommend `audio=false` until the audio transport
  layer ships, then flip to opt-in via the Configure dialog.
- **`capture_orientation` vs. `lock_video_orientation` semantics.**
  The fork currently sends an integer `-1..3` over the binary
  `VideoSettings` protocol (`VideoSettings.ts:74`). The 3.x
  `capture_orientation` adds flip variants and the `@` lock prefix.
  A naive int→string mapping will work for the four base rotations
  but will silently drop the new functionality.
- **`scid` (session id).** Stock 3.x assigns a 32-bit session id and
  expects the client to read it back from the control socket
  handshake. The NetrisTV fork has no such concept. Whatever takes
  over the transport layer needs to pass or accept `scid` — this is
  out of scope for the args layer but it is one of those things that
  *looks* like a CLI flag and isn't really, so flagging it here.
- **Min server version for some features.** `video_codec=av1`,
  `new_display`, `capture_orientation` etc. only exist on 3.x. If the
  launcher ever has to support a heterogeneous fleet of server
  versions (e.g. a v2.x JAR on one device and v3.x on another),
  feature detection becomes mandatory. Today, with `1.19-ws6` pinned,
  the launcher does no detection — it just sends whatever it has.
- **`raw_stream` collapsing the meta switches.** If a future ws-scrcpy
  version wants stream metadata for client-side reassembly, it must
  *not* set `raw_stream=true`; if it wants minimal overhead, setting
  `raw_stream=true` will implicitly clear `send_device_meta`,
  `send_frame_meta`, and `send_dummy_byte`. The interplay isn't
  documented in `doc/`, only readable from `Options.java`; verify
  against a running server before relying on either combination.
- **Help output / `--help` is not a server CLI.** Worth restating:
  flags like `--video-bit-rate` shown in `doc/video.md` are the
  *client* CLI of the upstream PC binary. The Java server speaks the
  underscore-snake-case keys (`video_bit_rate`, etc.). The two
  vocabularies match one-for-one in 3.x but they are not the same
  surface and shouldn't be conflated when reading upstream docs.
