# Video streaming + codec negotiation — migration to scrcpy 3.x

Scope: the video layer only. Sibling docs (audio, control, server bootstrap)
are tracked separately. This fork is pinned to scrcpy server `1.19-ws6`
(`src/common/Constants.ts:3`); upstream is currently in the 3.x series and
moved through a hard wire-protocol break in 2.0.

## Current state in this fork

### Pinned server and single-socket transport

- `src/common/Constants.ts:3` — `SERVER_VERSION = '1.19-ws6'`. The
  pre-built JAR lives at
  `vendor/Genymobile/scrcpy/scrcpy-server.jar`; the version check in
  `src/server/goog-device/ScrcpyServer.ts:88-93` refuses to start any
  other build.
- The client opens **one** WebSocket per stream
  (`src/app/client/StreamReceiver.ts:48-54`). The same socket carries:
  1. an `scrcpy_initial` magic-prefixed metadata frame
     (`StreamReceiver.ts:11`, `:56-104`),
  2. `scrcpy_message` magic-prefixed device messages
     (`DeviceMessage.ts:7`, `StreamReceiver.ts:141-145`),
  3. everything else is raw video bytes passed through
     `emit('video', new Uint8Array(event.data))`
     (`StreamReceiver.ts:148`).
- Control commands flow upstream on the same WS via
  `sendEvent → ws.send(event.toBuffer())`
  (`StreamReceiver.ts:161-167`).

There is no separate audio socket, no control socket, and no demuxer —
the magic-byte sniff in `onSocketMessage` is the entire dispatcher.

### Video payload assumed by every player: raw H.264 NAL stream

Every `BasePlayer` subclass receives the raw bytes through
`onVideo → player.pushFrame(new Uint8Array(data))`
(`src/app/googDevice/client/StreamClientScrcpy.ts:170-181`). The five
real players are:

| File | `playerCodeName` | Decoder | Codec / container assumption |
|------|------------------|---------|-------------------------------|
| `BroadwayPlayer.ts` | `broadway` | Broadway.js WASM (`vendor/Broadway/Decoder`) | H.264 Annex B (start-code prefixed NALU) |
| `TinyH264Player.ts` | `tinyh264` | TinyH264 worker (`vendor/tinyh264/H264NALDecoder.worker`) | H.264 Annex B, single-NAL per `decode` post |
| `MsePlayer.ts` | `mse` | `h264-converter` → MSE `SourceBuffer` | H.264 in fragmented MP4 (`mimeType` from `h264-converter`); the converter repackages each NALU into fMP4 segments |
| `MsePlayerForQVHack.ts` | (QuickTime hack for iOS bridge) | Same as MSE | H.264, plus a "lonely SEI" workaround (see `WebCodecsPlayer.ts:158-162`) |
| `WebCodecsPlayer.ts` | `webcodecs` | `VideoDecoder` (WebCodecs API) | H.264 Annex B; codec string built from SPS as `avc1.<profile><constraints><level>` |
| `MjpegPlayer.ts` | `mjpeghttp` | `<img>` tag with HTTP MJPEG endpoint | Out-of-band — not part of the scrcpy WS stream |

Key signal of "the fork only understands H.264":

- `BasePlayer.isIFrame()` reads `frame[4] & 31 === 5` — i.e. it
  hard-codes the H.264 NAL unit type test (Annex B with a 4-byte
  start code, then `nal_unit_type` from the low five bits of the
  next byte). See `BasePlayer.ts:162-170`. There is no analogous
  check for H.265 NAL type 32–34 (VPS/SPS/PPS) or AV1 OBUs.
- `WebCodecsPlayer.parseSPS` calls `h264-converter`'s `H264Parser`
  on the bytes after the start code; the codec string it produces
  is **always** `avc1.…` (`WebCodecsPlayer.ts:60`). The placeholder
  `src/app/player/codec/H265Parser.ts` is **empty** (zero bytes) —
  evidently the slot was reserved but the work was never done.
- `MsePlayer` relies on `MediaSource.isTypeSupported(mimeType)` where
  `mimeType` is the H.264-only constant exported by `h264-converter`
  (`MsePlayer.ts:70-72`).

### `VideoSettings` wire format (the only knobs we negotiate)

Defined in `src/app/VideoSettings.ts`. The on-the-wire layout is
fixed-width big-endian. From `fromBuffer` / `toBuffer`
(`VideoSettings.ts:52-117`, `:154-197`):

```
offset  size  field                          ws-scrcpy name
------  ----  -----------------------------  ----------------------
  0      4   int32be  bitrate                bitrate
  4      4   int32be  maxFps                 maxFps
  8      1   int8     iFrameInterval         iFrameInterval (sec)
  9      2   int16be  bounds.width           bounds.width
 11      2   int16be  bounds.height          bounds.height
 13      2   int16be  crop.left              crop.left
 15      2   int16be  crop.top               crop.top
 17      2   int16be  crop.right             crop.right
 19      2   int16be  crop.bottom            crop.bottom
 21      1   int8     sendFrameMeta (0/1)    sendFrameMeta
 22      1   int8     lockedVideoOrientation lockedVideoOrientation
 23      4   int32be  displayId              displayId
 27      4   int32be  codecOptionsLength     -
 31      L1  utf8     codecOptions           codecOptions
 31+L1   4   int32be  encoderNameLength      -
 31+L1+4 L2  utf8     encoderName            encoderName
```

`BASE_BUFFER_LENGTH = 35` (`VideoSettings.ts:19`) — i.e. the minimum
payload when both string fields are empty.

The whole struct is wrapped by `CommandControlMessage.createSetVideoSettingsCommand`
(`src/app/controlMessage/CommandControlMessage.ts:34-45`) which prepends
one byte of type:

```
[ TYPE_CHANGE_STREAM_PARAMETERS = 101 ][ VideoSettings.toBuffer() ]
```

That command, plus other one-byte-typed control messages
(`ControlMessage.ts:6-19`), are everything the client can ask the
server to do for video.

Conspicuously **absent** from `VideoSettings`:
- no `videoCodec` field (server is always asked for H.264),
- no `videoSource` field (display only — camera was added upstream
  in 2.2),
- no `audioCodec` / `audioSource` / `noAudio` knobs at all,
- no `newDisplay` / virtual display fields,
- no `maxSize` separate from `bounds` (legacy `maxSize` is read
  from local storage in `BasePlayer.ts:258-265` for backward
  compatibility but never serialized).

### Initial handshake (`scrcpy_initial`)

`StreamReceiver.handleInitialInfo` (`StreamReceiver.ts:56-104`)
expects:

```
[ "scrcpy_initial" 14B ][ deviceName 64B utf8 ][ displaysCount i32be ]
  for each display:
    [ DisplayInfo (BUFFER_LENGTH) ][ connectionCount i32be ]
    [ screenInfoBytesCount i32be ][ ScreenInfo ... ]
    [ videoSettingsBytesCount i32be ][ VideoSettings.fromBuffer(...) ]
[ encodersCount i32be ]
  for each encoder: [ nameLength i32be ][ utf8 name ]
[ clientId i32be ]
```

The list of encoder names that ships with this message is the only
codec-related metadata the UI ever sees — it's just opaque strings
("OMX.qcom.video.encoder.avc" etc.) that get rendered in
`GoogMoreBox.ts:151-158` as a dropdown for `encoderName`.

### SPS/PPS / frame-start detection

There is **no** stream-level demuxer. Every player decides for
itself what to do with each WS message:

- `MsePlayer.pushFrame` / `checkForIFrame`
  (`MsePlayer.ts:296-303`, `:397-433`): inspects byte 4 of the
  Annex B frame to find IDR pictures (via `BasePlayer.isIFrame`)
  and feeds the buffer straight into `h264-converter`. SPS/PPS are
  not parsed — `h264-converter` pulls them out internally when it
  rebuilds the fMP4 init segment.
- `WebCodecsPlayer.decode` (`WebCodecsPlayer.ts:135-179`): walks
  the NAL type by hand. Uses `NALU.SPS`, `NALU.PPS`, `NALU.IDR`,
  `NALU.SEI` constants from `h264-converter/dist/util/NALU`. SPS
  is parsed via `H264Parser.parseSPS` (`WebCodecsPlayer.ts:44-67`)
  to extract `codec`, `width`, `height` and to size the canvas.
- `BaseCanvasBasedPlayer.pushFrame` (`BaseCanvasBasedPlayer.ts:211-231`)
  uses the same `isIFrame` check to discard backlogged frames when
  an IDR arrives — i.e. it relies on the upstream stream always
  being Annex B with 4-byte start codes.

There is no place that reads a `PTS`, no place that reads a
`size` field, and no place that distinguishes a "config" packet
from a regular packet. The fork assumes the server sends a raw
contiguous NAL stream and the WebSocket message boundary equals
"one NAL unit" (per `pushFrame(new Uint8Array(data))`).

### Mapping VideoSettings → server CLI args

The fork bundles a custom 1.19-ws6 JAR; the JAR reads its arguments
from `ARGS_STRING` in `src/common/Constants.ts:20`
(`/ ${SERVER_PACKAGE} ${SERVER_VERSION} ${SERVER_TYPE} ${LOG_LEVEL} ${SERVER_PORT} ${SCRCPY_LISTENS_ON_ALL_INTERFACES}`).
Everything *else* (bitrate, max_size, iframe interval, locked
orientation, codec options, encoder name, displayId, sendFrameMeta)
is **not** passed via CLI — it's sent in-band as the
`TYPE_CHANGE_STREAM_PARAMETERS` control message and applied at
runtime by the custom server. Upstream scrcpy has no such control
message: in upstream all encoder parameters are CLI-only.

## Upstream gap

Citations below are from `app/src/demuxer.c`, `app/src/server.c`,
`doc/video.md`, `doc/audio.md`, and the v2.0 / v3.x release notes
on master (as of 2026-05-20).

### Three sockets, not one

Upstream `app/src/server.c` accepts **up to three TCP sockets** over
adb reverse (or one tunnel socket in `--tunnel-forward` mode):

1. `video_socket` (if video enabled)
2. `audio_socket` (if audio enabled)
3. `control_socket` (if control enabled)

In forward mode the first connection is the "dummy byte" probe
("the connection may succeed even if the server behind the adb
tunnel is not listening, so read one byte to detect a working
connection"). ws-scrcpy currently multiplexes everything onto one
WebSocket via magic-byte sniffing; there is **no mapping** from
upstream's three sockets onto WS frames.

### Per-stream codec-id 4-byte magic

`app/src/demuxer.c::sc_demuxer_recv_codec_id` reads exactly four
bytes at the very start of each stream and big-endian-decodes them:

```c
static bool
sc_demuxer_recv_codec_id(struct sc_demuxer *demuxer, uint32_t *codec_id) {
    uint8_t data[4];
    ssize_t r = net_recv_all(demuxer->socket, data, 4);
    if (r < 4) return false;
    *codec_id = sc_read32be(data);
    return true;
}
```

Defined codec IDs:

| Constant | Hex (be) | ASCII | FFmpeg AVCodecID |
|----------|----------|-------|------------------|
| `SC_CODEC_ID_H264` | `0x68323634` | `h264` | `AV_CODEC_ID_H264` |
| `SC_CODEC_ID_H265` | `0x68323635` | `h265` | `AV_CODEC_ID_HEVC` |
| `SC_CODEC_ID_AV1`  | `0x00617631` | `\0av1` | `AV_CODEC_ID_AV1` |
| `SC_CODEC_ID_OPUS` | `0x6f707573` | `opus` | `AV_CODEC_ID_OPUS` |
| `SC_CODEC_ID_AAC`  | `0x00616163` | `\0aac` | `AV_CODEC_ID_AAC` |
| `SC_CODEC_ID_FLAC` | `0x666c6163` | `flac` | `AV_CODEC_ID_FLAC` |
| `SC_CODEC_ID_RAW`  | `0x00726177` | `\0raw` | `AV_CODEC_ID_PCM_S16LE` |

Special values on this prefix: `0` = stream disabled by device,
`1` = device-side configuration error. The client must read this
**before** it can decide what decoder to instantiate.

### Session header (video stream only)

Immediately after the codec id, the upstream demuxer reads a
**12-byte session header** with width / height (and a flag bit
that's only set when the client requested a resize):

```c
session->video.width  = sc_read32be(&header[4]);
session->video.height = sc_read32be(&header[8]);
session->video.client_resized = header[3] & 1;
```

So at video-stream start the byte layout is:

```
[ codec_id u32be ][ session_header 12B (width@4 u32be, height@8 u32be) ]
```

Total: 16 bytes of metadata before any packet header arrives.

### Per-packet header (12 bytes)

For every codec packet the server writes, upstream emits a 12-byte
big-endian header:

```
[  PTS / flags  : u64be ][  size : u32be ][ payload : size bytes ]
```

Bit layout inside the high u64:
- bit 63: `SC_PACKET_FLAG_CONFIG`  → `(1ULL << 63)` config packet
  (e.g. SPS+PPS / VPS+SPS+PPS / AV1 sequence OBU). PTS for these
  packets is forced to `AV_NOPTS_VALUE`.
- bit 62: `SC_PACKET_FLAG_KEY_FRAME` → `(1ULL << 62)` key frame
  (translated to `AV_PKT_FLAG_KEY`).
- bits 0–61: `SC_PACKET_PTS_MASK = SC_PACKET_FLAG_KEY_FRAME - 1`,
  i.e. a 62-bit PTS in microseconds.

(Note: some older revs of the demuxer used bits 62/61 instead of
63/62. We must read the version we pin against and codify the bit
mask; both layouts share the property that the top two bits are
flags and the lower bits are the PTS.)

### CLI / option renames the server now expects

The upstream server is configured by `key=value` args parsed in
`server/.../Options.java`. Compared to 1.19-ws6 this layer is
substantially different:

- `bit_rate` → **`video_bit_rate`** (with a parallel `audio_bit_rate`).
- `codec_options` → **`video_codec_options`** (with a parallel
  `audio_codec_options`).
- `encoder_name` → **`video_encoder`** (parallel `audio_encoder`).
- New: `video_codec` (h264 | h265 | av1), default `h264`.
- New: `audio_codec` (opus | aac | flac | raw), default `opus`.
- New: `video_source` (display | camera), default `display`.
- New: `audio_source` (output | playback | mic | …).
- New: `video` / `audio` (enable/disable each stream).
- New: `new_display`, `display_ime_policy`, `capture_orientation`,
  `angle`, `keep_active`, `flex_display`, `clipboard_autosync`,
  `power_on`, `power_off_on_close`, `screen_off_timeout`,
  `downsize_on_error`, `min_size_alignment`.
- New: `send_device_meta`, `send_frame_meta`, `send_dummy_byte`,
  `send_stream_meta`, and a meta-flag `raw_stream` that disables
  all four of the above.
- Camera bundle: `camera_id`, `camera_size`, `camera_facing`,
  `camera_ar`, `camera_zoom`, `camera_fps`, `camera_high_speed`,
  `camera_torch`.

There is no `TYPE_CHANGE_STREAM_PARAMETERS` analogue in upstream.
Codec, source, bit rate, max_size, max_fps, display id etc. are
**fixed at server-launch time**. The only way to change them is
to restart the scrcpy server with new args.

### Encoder lists

Upstream replaces ws-scrcpy's `scrcpy_initial` encoder list with
`--list-encoders`, which is a one-shot command that prints to
stdout and exits. Per-codec encoder availability has to be queried
*before* the streaming server is launched.

### Audio is a peer

Audio went from "doesn't exist" (1.19) to "default-on alongside
video" (2.x+). The audio stream is its own socket, uses the same
12-byte packet header, and starts with its own codec_id u32be from
the `OPUS|AAC|FLAC|RAW` set above. The video-layer code does not
need to decode audio, but it does need to coexist with the audio
socket being either present or `--no-audio`'d off.

## Concrete changes needed

These are scoped to the **video layer**. Audio, control-socket
re-plumbing, and the server-bootstrap rewrite are tracked by sibling
docs; the items below assume those happen in parallel.

### Data model

- **Add `videoCodec: 'h264' | 'h265' | 'av1'` and `videoSource:
  'display' | 'camera'` to `Settings` and `VideoSettings`**
  (`src/app/VideoSettings.ts:5-16`, `:18-50`). Default `videoCodec`
  to `h264` to preserve current behavior.
- **Serialize the new fields in `toBuffer` / `fromBuffer`.** Pick a
  forward-compatible layout: either bump `BASE_BUFFER_LENGTH` and
  append the two enum bytes at offset 35 (followed by the existing
  codec/encoder string blocks), or repurpose unused padding.
  Reflect in `equals`, `copy`, `toJSON`.
- **Migrate stored settings**: `BasePlayer.getVideoSettingFromStorage`
  (`BasePlayer.ts:230-280`) already gracefully renames `frameRate`→
  `maxFps` and `maxSize`→`bounds`. Add the same gentle defaulting
  for `videoCodec` (missing → `'h264'`) and `videoSource`
  (missing → `'display'`).
- **Drop or repurpose `encoderName`** as a free-form string scoped
  to a specific codec. Upstream's `video_encoder` is keyed by codec,
  so a UI that lets the user pick `h265` + an `OMX.…avc` encoder
  is nonsensical. Either:
  (a) namespace `encoderName` per codec, or
  (b) replace `encoderName` with a `{ codec, encoder }` tuple.

### Wire framing

- **Introduce a video demuxer**. The current
  `StreamReceiver.onSocketMessage` (`StreamReceiver.ts:132-150`)
  must, once the WS protocol is upgraded, route raw bytes through
  a stateful parser that:
  1. Reads the 4-byte `codec_id` at session start.
  2. Reads the 12-byte session header (width, height,
     `client_resized` flag at `header[3] & 1`).
  3. Reads the repeating 12-byte packet header (u64be flags+PTS,
     u32be size) and emits framed `{codec, isConfig, isKey, pts,
     payload}` chunks to the player.
- **Stop relying on WS message boundaries as NAL boundaries.**
  Today `pushFrame(new Uint8Array(data))` assumes a 1:1 mapping
  between WS messages and NAL units; upstream's stream is a
  contiguous byte stream with size-prefixed packets. The demuxer
  must coalesce / split as needed.
- **Replace `BasePlayer.isIFrame`** (`BasePlayer.ts:162-170`) —
  which hard-codes H.264 NAL type 5 — with a codec-aware check
  using the keyframe bit from the packet header
  (`SC_PACKET_FLAG_KEY_FRAME`). The Annex B byte sniff stops being
  reliable as soon as H.265 / AV1 arrive.

### Per-player work

- **`MsePlayer.ts`**: today its `isSupported` uses
  `MediaSource.isTypeSupported(mimeType)` where `mimeType` is
  `h264-converter`'s constant
  (`MsePlayer.ts:70-72`). To support H.265 it must build an
  `hev1.*` or `hvc1.*` mime string from the VPS+SPS (parsed via
  the currently empty `src/app/player/codec/H265Parser.ts`) and
  test that against MSE. `h264-converter` does not handle H.265
  — we'll need either a fork or an alternative fMP4 muxer (e.g.
  mux.js with HEVC support). For AV1, MSE support is browser-side
  but `h264-converter` is the wrong tool entirely.
- **`WebCodecsPlayer.ts`**: switch from "always `avc1.…`"
  (`WebCodecsPlayer.ts:60`) to a codec-id-driven codec string:
  H.264 → `avc1.*`, H.265 → `hev1.*`/`hvc1.*` (built from
  H.265 SPS), AV1 → `av01.*` (parse first OBU). `parseSPS` must
  branch on the active `videoCodec`. `NALU` constants from
  `h264-converter/dist/util/NALU` only cover H.264, so the
  `SPS/PPS/IDR/SEI` switch in `decode()` must move to a codec
  table.
- **`TinyH264Player.ts`** and **`BroadwayPlayer.ts`**: both are
  H.264-only decoders. They must declare `videoCodec='h264'` in
  `preferredVideoSettings` so the player picker doesn't offer them
  when the user has selected H.265 / AV1, and `isSupported(codec)`
  becomes per-codec.
- **Implement `src/app/player/codec/H265Parser.ts`** — currently a
  zero-byte placeholder. Minimum needed to power MSE / WebCodecs:
  VPS / SPS NAL identification (NAL types 32 / 33), profile / tier
  / level extraction, and `width`/`height` derivation (HEVC SPS
  uses `pic_width_in_luma_samples` and `pic_height_in_luma_samples`,
  not the H.264 macroblock math). Plus the corresponding codec
  string (`hvc1.<profile_idc>.…`).
- **Empty config-packet handling**: when a packet arrives with the
  `SC_PACKET_FLAG_CONFIG` bit set, treat it as the codec config
  blob (SPS+PPS or VPS+SPS+PPS or AV1 sequence header) and feed it
  to the decoder's `configure()` path *before* the first key
  frame. Today only `WebCodecsPlayer` does anything like this, and
  it does it by sniffing NAL types — which won't survive the
  multi-codec move.

### Settings serialization → server CLI

- **Drop `TYPE_CHANGE_STREAM_PARAMETERS` for codec-level fields**.
  Upstream cannot change `video_codec`, `video_source`,
  `video_bit_rate` etc. at runtime; the server must be relaunched.
  Reserve the in-band command only for things that *can* still
  change live (mostly nothing for video, since even `max_fps`
  is fixed at launch in upstream).
- **Build a CLI string in `ScrcpyServer.ts`** that emits the new
  `key=value` args: `video_bit_rate=…`, `video_codec=…`,
  `max_fps=…`, `max_size=…`, `lock_video_orientation=…`,
  `video_codec_options=…`, `video_encoder=…`, `display_id=…`,
  `video=…`, `send_frame_meta=…`. Old names (`bit_rate`,
  `codec_options`, `encoder_name`) must be removed from the
  invocation line — the upstream parser ignores unknown keys but
  also no longer reads the old names.
- **`SERVER_VERSION` bump** in `src/common/Constants.ts:3`. The
  version-equality check at `ScrcpyServer.ts:88-93` will reject
  any upstream-shaped JAR until this string matches.

### Initial-info / handshake

- **Make the `scrcpy_initial` payload codec-aware.** Today
  `StreamReceiver.handleInitialInfo` (`StreamReceiver.ts:56-104`)
  reads a flat encoders list of opaque strings. With three
  possible codecs, encoders are per-codec; the list should carry
  `{ codec, name }` tuples (or, more pragmatically, three lists).
  This also lets `GoogMoreBox.ts:151-158` filter the encoder
  dropdown by selected codec.
- **Decide where multiplexing lives.** `src/packages/multiplexer/`
  already implements a channel-based multiplexer over a single
  WebSocket and is used for file push and proxying
  (`server/mw/WebsocketProxy.ts:4`,
  `app/googDevice/filePush/AdbkitFilePushStream.ts:11`). The
  cheapest path is to assign one multiplexer channel per
  upstream socket (video / audio / control) and let the
  existing `StreamReceiver` move into a single channel. The
  alternative — three WebSockets — doubles the connection
  count and complicates the auth proxy in `WebsocketProxy.ts`.

## Risk / unknowns

- **Exact bit positions in the per-packet flag header**. The
  upstream code has shifted between `(1ULL<<63)/(1ULL<<62)` and
  `(1ULL<<62)/(1ULL<<61)` at different points in 2.x. We have to
  pin a server version, read its `demuxer.c` literally, and lock
  the masks in the client. Mis-shifting by one bit silently
  inverts "every frame is a config packet" with "no frame is a
  config packet" and the symptom is "black screen, no errors".
- **H.265 in MSE**. Safari ships HEVC MSE; Chromium has it behind
  a flag and only on hardware-decoded paths; Firefox has no
  HEVC support at all. We will almost certainly need a fallback
  matrix (codec, browser → decoder), and `MsePlayer.isSupported`
  has to consult that matrix instead of one static `mimeType`.
- **AV1 in browsers**. Decoder availability is good (dav1d-wasm,
  WebCodecs `av01.*`) but **encoder availability on Android
  devices is rare** — the upstream doc explicitly warns "AV1
  encoders are not common on current Android devices". The
  player UI should treat AV1 as opt-in and probably let
  `--list-encoders` gate it.
- **`h264-converter` is H.264-only**. The MSE path relies on it
  to repackage NALU→fMP4. Either we replace it (mux.js, or a
  custom muxer using mp4-muxer) or we drop MSE for non-H.264
  codecs and route everything else through WebCodecs.
- **Three-socket model vs WebSocket model**. Upstream assumes
  ordered byte-stream sockets with their own backpressure;
  splaying them across WS frames inside the multiplexer changes
  the timing characteristics. Audio glitching from mis-ordered
  delivery is a foreseeable regression even though it doesn't
  visually break video.
- **`send_frame_meta` semantics changed**. In 1.19-ws6 this was a
  toggle on the in-band control message. In upstream it controls
  whether the 12-byte packet header is sent *at all* — turning it
  off means a raw-codec stream with no framing whatsoever. The
  ws-scrcpy demuxer must handle both modes, and the UI should
  probably hide the toggle from users (turning it off breaks
  multi-codec dispatch).
- **PTS units**. We don't currently consume PTS anywhere; the MSE
  path lets `h264-converter` invent timestamps and the WebCodecs
  path passes `timestamp: 0` literally (`WebCodecsPlayer.ts:173`).
  Switching to real PTS will surface bugs in any frame-timing /
  buffering heuristics (e.g. `MsePlayer.checkForBadState`,
  `MsePlayer.ts:305-395`, which is built around wall-clock and
  `tag.currentTime`).
- **Camera source UI surface**. `videoSource=camera` opens a
  whole new option group (`camera_id`, `camera_size`,
  `camera_facing`, `camera_fps`, `camera_high_speed`,
  `camera_torch`, `camera_zoom`, `camera_ar`). The video-layer
  changes above only have to plumb the enum through; the UI work
  is its own task.
- **Pinned `scrcpy-server.jar` rebuild**. The fork carries its
  own server JAR at `vendor/Genymobile/scrcpy/scrcpy-server.jar`
  built from a custom branch with the in-band control protocol.
  Upgrading to upstream means either dropping all custom server
  patches (preferred — fewer divergences) or porting the in-band
  control message into upstream's protocol. Without a live
  Android device on the latest scrcpy-server we cannot verify
  that custom patches still apply.
- **`MsePlayerForQVHack`** is a quirky iOS / QuickTime path
  (`src/app/player/MsePlayerForQVHack.ts`) that hard-codes
  `setVideoSettings(): void { return; }` to refuse runtime
  reconfiguration. Its relationship to the new codec selection
  is unclear; it likely needs to remain H.264-only.
