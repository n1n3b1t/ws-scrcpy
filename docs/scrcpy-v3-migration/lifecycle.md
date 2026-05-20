# Lifecycle layer — fork vs. upstream scrcpy 3.x / 4.x

Scope of this document: server startup, push-to-device, PID-file detection,
host↔device socket(s) plumbing, and the kill / disconnect protocol.

Versions compared:
- Fork: `ws-scrcpy` at `orch/lifecycle`, pinned to scrcpy server **`1.19-ws6`**
  (see `src/common/Constants.ts:3`, vendored jar at
  `vendor/Genymobile/scrcpy/scrcpy-server.jar`, 113 530 bytes).
- Upstream: `Genymobile/scrcpy` master at the time of writing — release tag
  **`v4.0`** (server reports version string `"4.0"`). The protocol break
  relevant to this layer was introduced in **2.0** (multi-socket + scid) and
  is unchanged in 3.x / 4.x.

References used throughout this doc:

- Upstream `server/src/main/java/com/genymobile/scrcpy/Server.java` (`scrcpy()`
  body and `main()`).
- Upstream `server/src/main/java/com/genymobile/scrcpy/device/DesktopConnection.java`
  (socket open / shutdown / device-meta).
- Upstream `app/src/server.c` (`push_server`, `execute_server`,
  `ADD_PARAM("scid=%08x", …)`, `run_server` watchdog).
- Upstream `app/src/scrcpy.c` (`scrcpy_generate_scid()` →
  `sc_rand_u32(&rand) & 0x7FFFFFFF`).
- Upstream `app/src/adb/adb_tunnel.c` (reverse-first, forward-fallback).
- Upstream `doc/develop.md` (canonical description of the protocol).

---

## Current state in this fork

### 1. Vendored server jar

`vendor/Genymobile/scrcpy/scrcpy-server.jar` (113 530 bytes) — pulled in
via `import` in `src/server/goog-device/ScrcpyServer.ts:1`, exposed to
Webpack by the `.jar$` rule in `webpack/ws-scrcpy.common.ts:68`,
re-resolved at runtime through `FILE_DIR` (`ScrcpyServer.ts:11`). Version
string: `1.19-ws6` (`src/common/Constants.ts:3`). The `-ws6` suffix
marks it as a fork of Genymobile 1.19 source with three patches baked in:

- listens on a **TCP `ServerSocket`** instead of an abstract Unix socket,
- writes a PID file to `/data/local/tmp/ws_scrcpy.pid` after listen,
- emits the ws6 framing magic bytes `scrcpy_initial` /
  `scrcpy_message` (`src/app/client/StreamReceiver.ts:11`,
  `src/app/googDevice/DeviceMessage.ts:7`).

### 2. Constants assembled into the `app_process` cmdline

`src/common/Constants.ts`:

```
SERVER_PACKAGE        = 'com.genymobile.scrcpy.Server'
SERVER_PORT           = 8886
SERVER_VERSION        = '1.19-ws6'
SERVER_TYPE           = 'web'
LOG_LEVEL             = 'ERROR'
SERVER_PROCESS_NAME   = 'app_process'
ARGUMENTS             = [SERVER_VERSION, SERVER_TYPE, LOG_LEVEL,
                         SERVER_PORT, SCRCPY_LISTENS_ON_ALL_INTERFACES]
ARGS_STRING           = `/ ${SERVER_PACKAGE} ${ARGUMENTS.join(' ')} 2>&1 > /dev/null`
```

That produces the **positional**, space-separated cmdline:

```
/ com.genymobile.scrcpy.Server 1.19-ws6 web ERROR 8886 false 2>&1 > /dev/null
```

There is no `scid`, no `key=value` arg, no codec selection — those concepts
did not exist in the 1.x server fork was forked from.

### 3. `ScrcpyServer` (`src/server/goog-device/ScrcpyServer.ts`)

Constants local to the file:

```
TEMP_PATH    = '/data/local/tmp/'
FILE_DIR     = path.join(__dirname, 'vendor/Genymobile/scrcpy')
FILE_NAME    = 'scrcpy-server.jar'
RUN_COMMAND  = `CLASSPATH=${TEMP_PATH}${FILE_NAME} nohup app_process ${ARGS_STRING}`
PID_FILE_PATH = '/data/local/tmp/ws_scrcpy.pid'
```

Method-by-method (`ScrcpyServer.ts:17-141`):

- **`copyServer(device)` (lines 19-23).** Single `device.push(src, dst)`
  via adbkit, `dst = '/data/local/tmp/scrcpy-server.jar'`. No hash check,
  no re-push optimisation — `run()` re-pushes on every fresh start.

- **`run(device)` (lines 111-140).** Entrypoint called from
  `Device.startServer()` (`Device.ts:455`):
  1. `getServerPid(device)` — if a compatible server is already running,
     return its PIDs and skip everything.
  2. `copyServer(device)` — re-push the jar.
  3. `runPromise = device.runShellCommandAdb(RUN_COMMAND)` — fire
     `adb shell CLASSPATH=… nohup app_process …`.
  4. `Promise.race([runPromise, waitForServerPid(...)])` — if `runPromise`
     wins, the server died early; if `waitForServerPid` wins, it's live.

- **`waitForServerPid(device, params)` (lines 28-62).** Poll loop, hard
  cap 5 tries (`throw new Error('Failed to start server')`), backoff
  `500 + 100 * tryCounter` ms. Each iteration:
  1. `cat /data/local/tmp/ws_scrcpy.pid`; if it parses to a number AND
     that number appears in `getServerPid(device)`, return.
  2. If the file's PID disagrees with the process scan, flip
     `params.lookPidFile = false` and from then on rely only on the scan.
  3. Exits early if `params.processExited` flips true (set by `.finally()`
     chained on `runPromise`).

- **`getServerPid(device)` (lines 64-109).** Two-step:
  1. `device.getPidOf('app_process')` — all PIDs matching `comm`.
  2. For each, `cat /proc/<pid>/cmdline`, split on NUL, find
     `com.genymobile.scrcpy.Server`; keep PIDs whose `args[1]` (version)
     equals `SERVER_VERSION` exactly.
  3. If a running PID has a different but `ServerVersion.isCompatible()`
     version that is older, log `Perform kill now` and
     `device.killProcess(pid)` — the **upgrade-by-replace** path.

No explicit `start` / `stop` / `kill` on `ScrcpyServer` itself. Stop
happens on `Device` (see below).

### 4. `ServerVersion` (`src/server/goog-device/ServerVersion.ts`)

Parses strings of the shape `<major>.<minor>[.<patch>]-<suffix>` (the only
real example in the codebase is `1.19-ws6`):

- Splits on the first `-`; everything before is `parts` (split on `.`),
  everything after is `suffix`.
- **Compatibility rule (line 13):**
  `compatible = suffix.startsWith('ws') && parts.length >= 2`. Any
  non-`ws…`-suffixed version (which is exactly what upstream 2.x/3.x/4.x
  ships) is hard-coded to "incompatible".
- `gt()` does a part-wise string compare (lexicographic, not numeric — so
  `'9' > '10'`), then falls back to suffix string compare.

### 5. Push-to-device path & readiness probe

Push: exactly one file, `/data/local/tmp/scrcpy-server.jar`, written by
`ScrcpyServer.copyServer`. No upload verification.

Readiness is detected by two complementary signals inside
`waitForServerPid`:

1. **PID file** `/data/local/tmp/ws_scrcpy.pid`, written by the ws6 jar
   *after* `ServerSocket.bind()` succeeds.
2. **Process scan** of `app_process` as a fallback once the PID file
   disagrees with the live process table.

There is no socket probe — once a PID is returned, the WebSocket
forwarder (`WebsocketProxyOverAdb.ts`) just calls
`AdbUtils.forward(udid, 'tcp:8886')` and assumes the listener is ready.

### 7. Shutdown / kill protocol

- `Device.killServer(pid)` (`Device.ts:426-446`) sets `spawnServer =
  false`, resolves the **real** PID via `getServerPid()`, then
  `killProcess(realPid)`.
- `Device.killProcess(pid)` (`Device.ts:95-96`) is one line —
  `\`kill ${pid}\`` — i.e. plain SIGTERM (15). No SIGINT, no `kill -9`
  escalation, no socket-close-first.
- The fork has no "client disconnected → tear server down" notion. The
  WebSocket proxy closes its host-side adb forward implicitly when its
  `ws` closes, but the device-side `app_process` lives on until
  `Device.killServer` is called explicitly, or until a new client
  triggers the upgrade-by-replace path inside `getServerPid`.

### 8. WebSocket forwarder — socket name the fork talks

**No abstract Unix socket on the data path.** The ws6 server listens on
TCP `:8886`, and the client builds `remote=tcp:8886`:

- `src/app/googDevice/client/DeviceTracker.ts:155` —
  `urlObject.searchParams.set('remote', 'tcp:' + SERVER_PORT)`.
- `WebsocketProxyOverAdb.ts:51` → `AdbUtils.forward(udid, remote)`.
- `AdbUtils.ts:140-154` — `client.forward(serial, 'tcp:<random>', remote)`,
  reusing any existing forward whose `remote === 'tcp:8886'`.

`scrcpy`/`localabstract:` only appear in `AdbUtils` on the DevTools path
(`AdbUtils.ts:189`, `:242`), not the scrcpy data path. So nothing here
needs renaming from `scrcpy` to `scrcpy_<scid>` — an abstract socket has
to be *introduced* on this path in the first place (see "Concrete
changes needed").

---

## Upstream gap

Everything in this section refers to upstream master (server reports
`version=4.0`). The shape of the layer has been stable since 2.0.

### 1. The 31-bit session id (`scid`)

Generated by the host once per session:

```c
// app/src/scrcpy.c:276-280
static uint32_t
scrcpy_generate_scid(void) {
    struct sc_rand rand;
    sc_rand_init(&rand);
    return sc_rand_u32(&rand) & 0x7FFFFFFF;
}
```

So the scid is a **31-bit unsigned int** (the top bit is masked off so it
fits in a Java `int`). It is rendered as **8 lowercase hex digits**:

```c
// app/src/server.c:265
ADD_PARAM("scid=%08x", params->scid);
```

and used to derive the abstract socket name:

```c
// app/src/server.c:1067
asprintf(&server->device_socket_name, SC_SOCKET_NAME_PREFIX "%08x",
         params->scid);
```

```java
// server/.../device/DesktopConnection.java
private static final String SOCKET_NAME_PREFIX = "scrcpy";
private static String getSocketName(int scid) {
    if (scid == -1) {
        return SOCKET_NAME_PREFIX;            // legacy / debug fallback
    }
    return SOCKET_NAME_PREFIX + String.format("_%08x", scid);
}
```

So the abstract Unix socket name is `scrcpy_<8-hex>` (e.g.
`scrcpy_3f2a1bc4`). When scid is `-1` (only possible if you launch the
server jar by hand), it falls back to the bare `scrcpy` name — that is the
only situation in which the 1.x-style name still exists upstream.

### 2. Multi-socket multiplexing on a single `LocalServerSocket`

`DesktopConnection.open(scid, tunnelForward, video, audio, control,
sendDummyByte)`: **1 to 3 sockets** are opened, in strict declaration
order **video → audio → control**. Any can be disabled via
`video=false`/`audio=false`/`control=false`, but at least one must be
enabled.

- **Forward tunnel** (`tunnel_forward=true`, e.g. over `adb connect`
  where `adb reverse` is unavailable): server creates the
  `LocalServerSocket` and calls `accept()` once per enabled stream. On
  the *first* accepted socket it writes a single dummy `0x00` byte
  ("send one byte so the client may read() to detect a connection
  error"). Host must consume that byte before the device-name field.
- **Reverse tunnel** (default): host listens on a TCP port, sets up
  `adb reverse localabstract:scrcpy_<scid> tcp:<port>`, then starts the
  server. The server calls `connect(socketName)` once per enabled stream;
  no dummy byte is sent in this path.

### 3. Device-meta hello (sent on the **first** socket only)

```java
// DesktopConnection.sendDeviceMeta(String deviceName)
private static final int DEVICE_NAME_FIELD_LENGTH = 64;
byte[] buffer = new byte[DEVICE_NAME_FIELD_LENGTH];
// truncate-to-UTF8-boundary and zero-pad to 64 bytes
IO.writeFully(fd, buffer, 0, buffer.length);
```

So the hello is **exactly 64 bytes**: a UTF-8 device name, NUL-padded.
That's it — width/height/codec are **no longer** in this header. Width,
height, codec id, and stream session metadata are sent later, on the
video / audio sockets themselves, as part of the per-stream framing
(see the `video/`, `audio/` and `model/` packages — out of scope here,
covered by the sibling `video.md` brief). For 1.x callers used to a
69-byte hello (1 byte status + 64-byte name + 4-byte width + 4-byte
height), this is a wire break.

`sendDeviceMeta` is gated by the server option `send_device_meta` (default
`true`). The host may set `send_device_meta=false` and skip the read.

### 4. Server launch — positional version, then `key=value`

`app/src/server.c::execute_server()` (abbreviated):

```c
cmd[count++] = "CLASSPATH=/data/local/tmp/scrcpy-server.jar";
cmd[count++] = "app_process";
cmd[count++] = "/";                                  // unused, but required
cmd[count++] = "com.genymobile.scrcpy.Server";
cmd[count++] = SCRCPY_VERSION;                       // positional, exact match
ADD_PARAM("scid=%08x", params->scid);
ADD_PARAM("log_level=%s", log_level_to_server_string(params->log_level));
if (server->tunnel.forward) ADD_PARAM("tunnel_forward=true");
if (!params->video) ADD_PARAM("video=false");
if (!params->audio) ADD_PARAM("audio=false");
if (!params->control) ADD_PARAM("control=false");
// … 40+ other optional key=value args …
```

Invariants:
- Version is the only positional arg after the class name; any mismatch
  is fatal at server startup.
- Everything else is order-independent `key=value` text parsed by
  `Options.parse(String[])`. Unknown keys throw
  `IllegalArgumentException`.
- `audio=false` disables audio entirely (needed for devices < Android 11
  — audio capture is API 30+).

### 5. Push location

```c
#define SC_DEVICE_SERVER_PATH "/data/local/tmp/scrcpy-server.jar"
```

Same path the fork already uses. No change required there. Upstream also
relies on the `SCRCPY_SERVER_PATH` env var to override the host-side
source path (irrelevant for us).

### 6. Tunnel direction — reverse by default

`app/src/adb/adb_tunnel.c::sc_adb_tunnel_open` tries reverse first and
falls back to forward (unless `--force-adb-forward`).

- **Reverse**: host `net_listen(port)`, then
  `adb -s X reverse localabstract:scrcpy_<scid> tcp:<port>`, then
  `execute_server(...)`. The server's `DesktopConnection.open` calls
  `connect("scrcpy_<scid>")` per enabled stream, which lands on the
  host's TCP listener.
- **Forward**: `adb -s X forward tcp:<port> localabstract:scrcpy_<scid>`.
  Server `accept()`s on its `LocalServerSocket`; host
  `connect(127.0.0.1, port)` per enabled stream, in the same order, and
  reads the dummy byte from the first.

### 7. PID file: **gone**

Upstream's `Server.java` does **not** create a PID file. The host knows
the server is up because (a) the reverse-tunnelled socket connect
succeeds, or (b) the forward-tunnelled `read()` of the dummy byte
returns. `CleanUp.java` (the only thread that survives `main` exiting on
purpose) writes nothing under `/data/local/tmp` except internal sentinel
files used by `Settings` restoration, none of which is `*.pid`.

`grep` for `ws_scrcpy.pid` or `.pid` in the upstream tree returns
nothing in `server/` — the file is a ws-scrcpy invention.

### 8. Shutdown / teardown

Host (`app/src/server.c::run_server`):
1. User closes the window → `sc_server_stop` notifies `cond_stopped`.
2. `net_interrupt(video_socket)`, …`(audio_socket)`, …`(control_socket)`.
   Blocking `recv()` on the host returns; on the server the shut-down
   socket reads return `-1`/EOF.
3. `sc_process_observer_timedwait(&observer, deadline)` waits up to
   `WATCHDOG_DELAY = 1s` for the server to exit on its own.
4. If not exited: `sc_process_terminate(pid)` — SIGTERM on POSIX,
   `TerminateProcess` on Windows.

Server (`Server.java::scrcpy`):
- Each `AsyncProcessor` calls `completion.addCompleted(fatalError)` on
  the way out; when the counter hits zero or `fatalError` is true,
  `Looper.getMainLooper().quitSafely()` runs.
- `Looper.loop()` returns; `finally` runs `cleanUp.interrupt()` →
  `asyncProcessor.stop()` (×N) → `connection.shutdown()` →
  `connection.close()` → `main()` → `System.exit(status)` (force-exits
  non-daemon Android framework threads).

Contract: **host closes the sockets, server notices EOF, server exits
cleanly, host kills it only as a 1 s fallback**. Nothing relies on the
host knowing the server's PID.

### 9. Version negotiation

- Server reads positional arg `args[0]` (after the class name) and
  compares to its own `BuildConfig.VERSION_NAME` (the `SCRCPY_VERSION`
  the host built into its binary). Mismatch → `IllegalArgumentException`,
  `System.exit(1)`.
- The host has no version-detection probe — it pushes its bundled jar
  and asserts that the version on the cmdline matches the version baked
  into the jar.

---

## Concrete changes needed

This section assumes the goal is to **drop the ws6 patches and run an
unmodified upstream `scrcpy-server.jar`** (3.x or 4.x). If the chosen
path is instead "keep ws6, just bump the embedded version", almost none
of this applies — but then we also lose the reason to upgrade.

Numbers in parentheses are the call sites to touch.

### Jar + version constants

1. Replace `vendor/Genymobile/scrcpy/scrcpy-server.jar` with the
   upstream release jar of the chosen version (e.g. `scrcpy-server-v3.3.4`
   or `scrcpy-server-v4.0` renamed to `scrcpy-server.jar`). Keep the
   `vendor/Genymobile/scrcpy/LICENSE` refresh in lockstep.
2. `src/common/Constants.ts:3` — change `SERVER_VERSION` from
   `'1.19-ws6'` to e.g. `'3.3.4'` (no suffix). The string must be
   byte-identical to what the chosen jar reports.
3. `src/server/goog-device/ServerVersion.ts:13` — drop the
   `suffix.startsWith('ws')` requirement, or replace the whole
   `ServerVersion` with a small numeric SemVer comparator. The current
   class will mark any upstream version as `compatible === false` and the
   upgrade-by-replace path in `ScrcpyServer.getServerPid` will silently
   refuse to kill stale servers.
4. `gt()` (`ServerVersion.ts:19-39`) currently does lexicographic string
   compare on parts, so `'9'.gt('10') === true`. Replace with
   `parseInt`-based numeric compare while you're in there.

### Generate a per-session `scid`

5. In `ScrcpyServer.run`, before `runShellCommandAdb(RUN_COMMAND)`,
   generate a 31-bit hex id (e.g. `crypto.randomBytes(4).readUInt32BE() &
   0x7FFFFFFF`, then `.toString(16).padStart(8, '0')`) and remember it
   for the session — the WebSocket forwarder needs it too (point 10).

6. Switch `Constants.ts::ARGS_STRING` away from the positional form to
   the upstream contract (one positional version, then `key=value`):

   ```ts
   const args = [
       SERVER_VERSION,                       // positional
       `scid=${scid}`,
       `log_level=${LOG_LEVEL.toLowerCase()}`,
       'tunnel_forward=true',                // point 9
       'audio=false',                        // point 8
       // video=true and control=true are the defaults
   ].join(' ');
   const RUN_COMMAND =
       `CLASSPATH=${TEMP_PATH}${FILE_NAME} app_process / ${SERVER_PACKAGE} ${args}`;
   ```

   - `LOG_LEVEL` must move from `'ERROR'` to one of
     `verbose|debug|info|warn|error` (upstream `Ln.Level`, lowercase).
   - Drop `SERVER_TYPE`, `SERVER_PORT`, `SCRCPY_LISTENS_ON_ALL_INTERFACES`
     — none exist upstream.
   - Drop `2>&1 > /dev/null`. Upstream logs on stderr; we want them.

### Replace PID-file waiting with handshake-based readiness

7. **Delete** `PID_FILE_PATH`, `waitForServerPid`, and the
   `lookPidFile` branch (`ScrcpyServer.ts:18`, `28-62`). Upstream writes
   no PID file. Readiness is established by the socket itself succeeding
   to connect (forward mode) or by the server connecting back to our
   listener (reverse mode).

8. New readiness signal in `ScrcpyServer.run`:
   - Set up the tunnel (`adb forward` or `adb reverse`) before starting
     the server.
   - Spawn `app_process` via `runShellCommandAdb`.
   - In forward mode: `await` `net.createConnection({ host: '127.0.0.1', port })`,
     then `socket.read(1)` and discard the dummy byte. That's the proof
     the server is up. Resolve the promise with the *adb-shell-exit
     PID* — which we no longer need to track, so `Device.descriptor.pid`
     can just become a boolean "running" flag, or store the host-side
     forward port.
   - In reverse mode: `net.createServer(...).listen(0)` first, then
     `await once(server, 'connection')` per enabled stream.

### Open multiple sockets, not one

9. `WebsocketProxyOverAdb.ts:49-61` currently sets up exactly one
   `adb forward tcp:<random> → tcp:8886` and bridges that to the
   browser. Upstream needs **N sockets opened in declaration order
   against the same abstract name**. Two paths:

   a) **Minimal:** pin `audio=false` and `control=false`, so only the
      video socket is opened. Forward `tcp:<random> →
      localabstract:scrcpy_<scid>`, bridge as today. Loses audio; the
      fork's `MAGIC_BYTES_MESSAGE` control framing is ws6-only and is
      broken by 2.x+ anyway (see sibling `control.md`).

   b) **Faithful:** open three host-side forwards in sequence (one per
      enabled stream) and surface them as three WebSocket endpoints,
      or multiplex over one WS with the stream id in-band the way
      `Multiplexer` already does for other features. Order of
      `connect` to the device-side abstract socket must be
      `video → (audio?) → (control?)` to match `DesktopConnection.open`.

10. `DeviceTracker.ts:155` — replace `'tcp:' + SERVER_PORT` with
    `'localabstract:scrcpy_' + scid`. The scid must travel through the
    URL/query the browser sees, because the browser doesn't otherwise
    know which one the server side generated.

### Tear-down by closing sockets, not by `kill`

11. `Device.killProcess` (`Device.ts:95-96`) and `Device.killServer`
    (`Device.ts:426-446`) should stop being the primary stop signal.
    Mirror upstream: (a) `.destroy()` all bridged sockets; (b) remove
    the `adb forward`/`adb reverse` entries (we have `AdbUtils.forward`
    but no `--remove` wrapper — add one); (c) wait ~1 s on the
    `runPromise` chained inside `ScrcpyServer.run`; (d) fall back to
    `kill <pid>` only on timeout.

12. `RUN_COMMAND` currently uses `nohup`, which detaches `app_process`
    from the adb shell — necessary today because PID-file detection had
    to outlive the shell. With socket-driven lifecycle, `nohup` becomes
    harmful: closing the adb shell no longer signals the server. Drop
    `nohup`, keep the shell open for the session's lifetime, and use
    shell exit as one of the teardown signals.

### Cleanup of obsolete fork-only constructs

13. Delete the `SERVER_PORT = 8886` constant and its references — there
    is no longer a TCP port on the device. Same for `SERVER_TYPE`,
    `SCRCPY_LISTENS_ON_ALL_INTERFACES`.
14. The client-side `MAGIC_BYTES_INITIAL = 'scrcpy_initial'`
    (`src/app/client/StreamReceiver.ts:11`) and `MAGIC_BYTES_MESSAGE =
    'scrcpy_message'` (`src/app/googDevice/DeviceMessage.ts:7`) are
    ws6-only framing; upstream doesn't send them. Removing them is a
    `video.md` / `control.md` concern but it crosses paths with the
    handshake here — at minimum, no longer "wait for `scrcpy_initial`"
    as a readiness signal.

---

## Risk / unknowns

1. **scid endianness / signedness.** Upstream Java decodes `scid=` into
   an `int` and re-formats with `String.format("_%08x", scid)`. We
   generate in TS and format with `.toString(16).padStart(8, '0')`. The
   high-bit case round-trips fine in isolation, but if we ever apply
   `>>> 0` somewhere the sign behaviour could diverge. Needs a TS → arg
   → `/proc/<pid>/net/unix` round-trip test before trusting any 31-bit
   value.

2. **Exact byte layout of the device-meta hello.** I have confirmed via
   `DesktopConnection.sendDeviceMeta` that it is 64 bytes of zero-padded
   UTF-8 and nothing else. I have **not** confirmed by running the jar
   that the *first* socket actually receives it (`getFirstSocket()`
   returns video → audio → control in that priority). The per-stream
   codec/session header comes after this 64-byte chunk on the same
   socket — a hex capture of the first ~100 bytes of each enabled
   socket would settle it.

3. **Dummy byte timing in forward mode.** Written immediately after
   `accept()` returns, so the host may `read()` it before the device's
   `app_process` has fully initialised. Intended upstream design, but I
   haven't verified that an early `read()` can't return 0 bytes due to
   a half-open accept on older adbd builds.

4. **Reverse-tunnel availability over `adb connect`.** Upstream's
   comment in `adb_tunnel.c` says reverse does not work over
   `adb connect`. Since the fork is largely deployed against
   TCP-attached devices, our practical default will probably be
   `tunnel_forward=true`. Worth confirming on Pixel-over-TCP and a
   Genymotion image before committing to the simpler reverse path.

5. **`@dead50f7/adbkit` reverse API.** We import `Forward` and call
   `client.forward(...)` / `client.openLocal(...)`. I have not
   confirmed `client.reverse(...)` / `reverseRemove(...)` exist in that
   fork. If not, spawn `adb -s X reverse ...` directly the way
   `device.runShellCommandAdb` does for shell commands.

6. **Reverse-tunnel cleanup on crash.** Host-side `adb reverse` mapping
   persists across server restarts. We have no `sc_adb_reverse_remove`
   equivalent yet — leaked mappings won't break new sessions (fresh
   scid → fresh name) but will accumulate on `adb reverse --list` until
   reboot / adbd restart.

7. **Concurrent sessions per device.** Upstream supports it (the whole
   point of `scid`); the fork doesn't (everything keys off the fixed
   `tcp:8886`). I have not audited the WebSocket layer for "one server
   per device, ever" assumptions — there are probably data structures
   keyed by `udid` alone that need to become `udid + scid`.

8. **Version-string drift.** `BuildConfig.VERSION_NAME` is byte-compared
   against our arg. Pinning `SERVER_VERSION` in `Constants.ts` to a
   literal means manual bumps every re-vendor; an
   `npm run check:scrcpy-version` that `unzip -p`s `BuildConfig.class`
   and asserts the string would prevent accidental skew.

9. **Android API level for audio.** Upstream audio capture needs API 30
   (Android 11). Below that, pass `audio=false`. We have no SDK probe
   today — simplest first step is to hard-code `audio=false`.

10. **Whether `kill <pid>` survives the migration.** Once socket-driven
    teardown plus the 1 s watchdog is in place, `Device.killProcess`
    becomes a last-resort. Probably keep it as dead-code for now;
    delete after production sessions prove it's never hit.
