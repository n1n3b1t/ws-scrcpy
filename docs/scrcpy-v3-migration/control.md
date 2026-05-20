# Control-message protocol: ws-scrcpy fork (server 1.19-ws6) → upstream scrcpy 3.x

Scope: the client→device control-message channel (keyboard, mouse / touch,
scroll, clipboard, panel commands, device control) plus the device→client
`DeviceMessage` channel. Out of scope: video, audio, the ws-scrcpy
WebSocket envelope itself.

The fork ships a forked scrcpy server JAR pinned to `1.19-ws6` (see
`vendor/Genymobile/scrcpy/scrcpy-server.jar`, referenced from
`src/server/goog-device/ScrcpyServer.ts:1`). The Node side of ws-scrcpy
acts as a transparent WebSocket↔TCP relay for the control channel — the
only server-side decoder of fork-specific traffic is
`src/server/goog-device/filePush/FilePushReader.ts:78`, which sniffs the
ws-scrcpy `TYPE_PUSH_FILE` (102) frames. Every other control message is
serialised in the browser and shipped verbatim to the Android scrcpy
server, so the migration surface is essentially `src/app/controlMessage/*`
+ the Android server JAR.

## Current state in this fork

### Type byte table

All values are taken from `src/app/controlMessage/ControlMessage.ts:6-20`.

| Constant                              | Value | Class / factory                                                            | Wire payload (after the type byte) |
|---------------------------------------|-------|----------------------------------------------------------------------------|------------------------------------|
| `TYPE_KEYCODE`                        | 0     | `KeyCodeControlMessage` (`src/app/controlMessage/KeyCodeControlMessage.ts`) | i8 action, i32 keycode, i32 repeat, i32 metaState — 13 bytes |
| `TYPE_TEXT`                           | 1     | `TextControlMessage`   (`src/app/controlMessage/TextControlMessage.ts:21`) | u32 length, UTF-8 bytes |
| `TYPE_TOUCH`                          | 2     | `TouchControlMessage`  (`src/app/controlMessage/TouchControlMessage.ts:45`)| u8 action, u64 pointerId (hi32=0,lo32=id), i32 x, i32 y, u16 w, u16 h, u16 pressure-fixed, u32 buttons — 28 bytes |
| `TYPE_SCROLL`                         | 3     | `ScrollControlMessage` (`src/app/controlMessage/ScrollControlMessage.ts:20`)| u32 x, u32 y, u16 w, u16 h, **i32 hScroll, i32 vScroll** — 20 bytes |
| `TYPE_BACK_OR_SCREEN_ON`              | 4     | (no class — never emitted; `CommandControlMessage.Commands` map omits it)  | empty in fork — see Risk section |
| `TYPE_EXPAND_NOTIFICATION_PANEL`      | 5     | `CommandControlMessage` (`src/app/controlMessage/CommandControlMessage.ts:25`) | none (type byte only) |
| `TYPE_EXPAND_SETTINGS_PANEL`          | 6     | `CommandControlMessage`                                                    | none |
| `TYPE_COLLAPSE_PANELS`                | 7     | `CommandControlMessage`                                                    | none |
| `TYPE_GET_CLIPBOARD`                  | 8     | `CommandControlMessage`                                                    | none in fork — see Risk section |
| `TYPE_SET_CLIPBOARD`                  | 9     | `CommandControlMessage.createSetClipboardCommand` (`CommandControlMessage.ts:47`) | i8 paste-flag, i32 length, UTF-8 bytes |
| `TYPE_SET_SCREEN_POWER_MODE`          | 10    | `CommandControlMessage.createSetScreenPowerModeCommand` (`CommandControlMessage.ts:65`) | u8 boolean |
| `TYPE_ROTATE_DEVICE`                  | 11    | `CommandControlMessage`                                                    | none |
| `TYPE_CHANGE_STREAM_PARAMETERS`       | 101   | `CommandControlMessage.createSetVideoSettingsCommand` (`CommandControlMessage.ts:34`) | ws-scrcpy private payload (`VideoSettings.toBuffer`) |
| `TYPE_PUSH_FILE`                      | 102   | `CommandControlMessage.create*PushFile*` (`CommandControlMessage.ts:75-164`)| ws-scrcpy private (id u16, state u8, then state-specific) |

Type bytes 0–11 are 1:1 with upstream scrcpy 1.19. Type bytes 101 and 102
are fork-private extensions handled by the ws-scrcpy Node server, not the
Android scrcpy server (see `FilePushReader.ts:78`).

### Pointer / button / motion state

`src/app/MotionEvent.ts:1-19` defines only three actions
(`ACTION_DOWN=0`, `ACTION_UP=1`, `ACTION_MOVE=2`) and three buttons
(`BUTTON_PRIMARY=1`, `BUTTON_SECONDARY=2`, `BUTTON_TERTIARY=4`). There
is no notion of `ACTION_HOVER_*`, `ACTION_BUTTON_*`,
`BUTTON_BACK`/`BUTTON_FORWARD`, or stylus actions. The buttons bitmask
is written as a u32 in `TouchControlMessage.toBuffer`
(`TouchControlMessage.ts:57`).

### DOM key mapping

`src/app/googDevice/KeyToCodeMap.ts` (118 lines) maps W3C
`KeyboardEvent.code` values (sourced from
`src/app/UIEventsCode.ts`) to Android `KeyEvent.KEYCODE_*`. Only physical
keys with a direct Android equivalent are mapped; characters that have
no Android keycode are routed via `TYPE_TEXT` from the input field, not
through this table. `KeyInputHandler.ts:38-46` builds the `metaState`
bitmask from `KeyboardEvent.getModifierState`.

### Device→client framing (`DeviceMessage`)

`src/app/googDevice/DeviceMessage.ts:1-53` defines a minimal back-channel
inside the same WebSocket. The fork's Node server prefixes each device
message with the magic ASCII `scrcpy_message` (see line 7); the browser
strips that prefix and reads:

| Constant            | Value | Payload (after type byte) |
|---------------------|-------|---------------------------|
| `TYPE_CLIPBOARD`    | 0     | i32 length, UTF-8 bytes (`DeviceMessage.ts:25-29`) |
| `TYPE_PUSH_RESPONSE`| 101   | i16 id, i8 code (`DeviceMessage.ts:39-41`) — ws-scrcpy private, paired with `TYPE_PUSH_FILE` |

There is no `TYPE_ACK_CLIPBOARD`, no `TYPE_UHID_OUTPUT`, no clipboard
sequence number.

### Server-side framing

`src/server/goog-device/` does not parse or rewrite the standard control
stream. Its responsibilities are: ADB plumbing
(`adb/`, `AdbUtils.ts`), pushing and launching the scrcpy server
(`ScrcpyServer.ts`), wrapping ADB sockets in WebSocket frames
(`mw/WebsocketProxyOverAdb.ts`), and intercepting the fork-only
`TYPE_PUSH_FILE` frame (`filePush/FilePushReader.ts:78`). Everything
else is opaque. As a consequence, **the wire format used by the browser
must match exactly what the Android scrcpy server expects**; bumping
the server means bumping `src/app/controlMessage/*` in lockstep.

The pinned server is identified by `ServerVersion.ts:13` which requires
a `-ws*` suffix to be considered compatible — i.e. only the fork's
patched server, never the vanilla upstream JAR, will satisfy
`isCompatible()`.

## Upstream gap

References (fetched 2026-05-20):
`Genymobile/scrcpy@master:app/src/control_msg.h`,
`server/.../control/ControlMessage.java`,
`server/.../control/ControlMessageReader.java`.

### Upstream 3.x type byte table

| Constant                                       | Value | Status vs fork | Wire payload after type byte |
|------------------------------------------------|------:|----------------|------------------------------|
| `SC_CONTROL_MSG_TYPE_INJECT_KEYCODE`           | 0     | layout unchanged | i8 action, i32 keycode, i32 repeat, i32 metaState |
| `SC_CONTROL_MSG_TYPE_INJECT_TEXT`              | 1     | unchanged | u32 length, UTF-8 |
| `SC_CONTROL_MSG_TYPE_INJECT_TOUCH_EVENT`       | 2     | **layout changed** | i8 action, **i32 actionButton (NEW)**, i32 buttons, u64 pointerId, i32 x, i32 y, u16 w, u16 h, u16 pressure-fixed — order also rearranged, see below |
| `SC_CONTROL_MSG_TYPE_INJECT_SCROLL_EVENT`      | 3     | **layout changed** | i32 x, i32 y, u16 w, u16 h, **i16 hScroll-fixed**, **i16 vScroll-fixed**, **i32 buttons (NEW)** |
| `SC_CONTROL_MSG_TYPE_BACK_OR_SCREEN_ON`        | 4     | layout changed (action u8) | i8 action |
| `SC_CONTROL_MSG_TYPE_EXPAND_NOTIFICATION_PANEL`| 5     | unchanged | none |
| `SC_CONTROL_MSG_TYPE_EXPAND_SETTINGS_PANEL`    | 6     | unchanged | none |
| `SC_CONTROL_MSG_TYPE_COLLAPSE_PANELS`          | 7     | unchanged | none |
| `SC_CONTROL_MSG_TYPE_GET_CLIPBOARD`            | 8     | **layout changed** | i8 copyKey (0=none, 1=copy, 2=cut) |
| `SC_CONTROL_MSG_TYPE_SET_CLIPBOARD`            | 9     | **layout changed** | **i64 sequence (NEW)**, i8 paste, u32 length, UTF-8 |
| `SC_CONTROL_MSG_TYPE_SET_DISPLAY_POWER`        | 10    | renamed (was `SET_SCREEN_POWER_MODE`), wire identical | i8 boolean |
| `SC_CONTROL_MSG_TYPE_ROTATE_DEVICE`            | 11    | unchanged | none |
| `SC_CONTROL_MSG_TYPE_UHID_CREATE`              | 12    | **NEW** | u16 id, u16 vendorId, u16 productId, u8 nameLen, name bytes, u16 reportDescSize, descriptor bytes |
| `SC_CONTROL_MSG_TYPE_UHID_INPUT`               | 13    | **NEW** | u16 id, u16 dataLen, data bytes |
| `SC_CONTROL_MSG_TYPE_UHID_DESTROY`             | 14    | **NEW** | u16 id |
| `SC_CONTROL_MSG_TYPE_OPEN_HARD_KEYBOARD_SETTINGS` | 15 | **NEW** | none |
| `SC_CONTROL_MSG_TYPE_START_APP`                | 16    | **NEW** | u8 nameLen, UTF-8 (?+/- prefix) |
| `SC_CONTROL_MSG_TYPE_RESET_VIDEO`              | 17    | **NEW** | none |
| `SC_CONTROL_MSG_TYPE_CAMERA_SET_TORCH`         | 18    | **NEW** | i8 boolean (camera build only) |
| `SC_CONTROL_MSG_TYPE_CAMERA_ZOOM_IN`           | 19    | **NEW** | none |
| `SC_CONTROL_MSG_TYPE_CAMERA_ZOOM_OUT`          | 20    | **NEW** | none |
| `SC_CONTROL_MSG_TYPE_RESIZE_DISPLAY`           | 21    | **NEW** | u16 width, u16 height |

The fork's private extensions sit at 101 (`CHANGE_STREAM_PARAMETERS`)
and 102 (`PUSH_FILE`). Upstream now occupies 12 through 21, so the
fork's private types still do not collide — but anything we add must
either continue to live ≥101 (preserving the fork-only namespace) or be
renumbered to mirror upstream exactly.

### Touch event — detailed wire diff

Fork (`TouchControlMessage.ts:45-58`, 28-byte payload):

```
u8  type
u8  action
u64 pointerId   (hi32 hard-coded to 0; lo32 = pointerId)
i32 x
i32 y
u16 screenW
u16 screenH
u16 pressureFixed16
u32 buttons
```

Upstream (`ControlMessageReader.java` → `parseInjectTouchEvent`, 32-byte
payload):

```
u8  type
u8  action
i64 pointerId        (full 64-bit space; SDL synthesizes virtual IDs there)
i32 x
i32 y
u16 screenW
u16 screenH
u16 pressureFixed16
i32 actionButton     <-- NEW (which button transitioned)
i32 buttons
```

Net change: +4 bytes (an extra `actionButton` u32 inserted between
`pressure` and `buttons`). Upstream uses this to disambiguate "the user
pressed/released which mouse button" from the persistent `buttons`
bitmask — important for `ACTION_BUTTON_PRESS`/`ACTION_BUTTON_RELEASE`.

### Scroll event — detailed wire diff

Fork (`ScrollControlMessage.ts:20-30`, 20-byte payload):

```
u8  type
u32 x
u32 y
u16 screenW
u16 screenH
i32 hScroll      <-- integer
i32 vScroll      <-- integer
```

Upstream (`ControlMessageReader.java` → `parseInjectScrollEvent`,
20-byte payload but reshaped):

```
u8  type
i32 x
i32 y
u16 screenW
u16 screenH
i16 hScrollFixed   <-- 16-bit signed fixed-point representation of a float in [-1, 1]
i16 vScrollFixed   <-- same
i32 buttons        <-- NEW
```

The byte count happens to coincide (20 bytes of payload either way),
but every field after the screen size shifts. The fork's "ints became
floats" guess is correct in semantics — upstream now models scroll as a
fractional value — but the on-wire encoding is i16 fixed-point, not
IEEE-754. The conversion is `i16_value / 32767.0`.

### Clipboard — detailed wire diff

`TYPE_SET_CLIPBOARD` (9) fork (`CommandControlMessage.ts:47-63`):

```
u8  type
i8  pasteFlag
i32 textLength
UTF-8 bytes
```

Upstream:

```
u8  type
i64 sequence       <-- NEW
i8  pasteFlag
u32 textLength
UTF-8 bytes
```

`TYPE_GET_CLIPBOARD` (8) fork: empty payload — the fork just emits the
type byte.

Upstream: `u8 copyKey` where 0 = none (just read), 1 = COPY (also issue
copy intent first), 2 = CUT (cut intent). This is what enables the
"sync host clipboard with what's selected on the device" behavior.

The device→client clipboard message (`DeviceMessage.TYPE_CLIPBOARD`, 0)
was extended upstream too — there is now an additional `TYPE_ACK_CLIPBOARD`
that echoes the `sequence` so the host knows the round-trip succeeded.
This is a `DeviceMessage` (server→client) change, not a `ControlMessage`.

### Keyboard handling — the UHID question

Upstream 2.x introduced a second keyboard mode: instead of injecting
Android KeyEvents, the desktop client registers a virtual USB HID
keyboard via the new `UHID_CREATE`/`UHID_INPUT`/`UHID_DESTROY` triplet
and ships raw HID reports. This is the only way to get correct layout
handling for non-US keyboards. The fork only has the legacy keycode
path (`KeyInputHandler.ts`, `KeyToCodeMap.ts`), and is hard-wired to
the ASCII subset of US ANSI codes that exist in `UIEventsCode.ts` +
`KeyEvent.KEYCODE_*`. There is **no UHID infrastructure** anywhere in
the fork — neither the message types nor a `report_desc` generator.

### Other new types

- `OPEN_HARD_KEYBOARD_SETTINGS` (15): zero-payload message that opens
  Android's physical-keyboard layout picker. Useful when paired with
  UHID keyboard mode; otherwise nice-to-have.
- `START_APP` (16): u8 nameLen + UTF-8 bytes. The name uses a `+` or
  `?` prefix to choose package vs. fuzzy-search semantics (see upstream
  `Controller.java` for the parser). Pairs with new "list apps"
  request which is actually delivered via the *new-display* path, not
  a ControlMessage.
- `RESET_VIDEO` (17): zero-payload. Forces the encoder to emit a fresh
  keyframe. Useful when the video pipeline desyncs after rotation.
- `CAMERA_SET_TORCH` (18), `CAMERA_ZOOM_IN` (19), `CAMERA_ZOOM_OUT`
  (20): camera-mode build only; ws-scrcpy mirror does not stream
  camera and can ignore until camera support is on the roadmap.
- `RESIZE_DISPLAY` (21): u16 width + u16 height. Companion to the
  newer virtual-display feature.

### `BACK_OR_SCREEN_ON` (4)

The fork allocates the type byte but never emits it (no class, no entry
in `CommandControlMessage.Commands`). Even in 1.19 upstream, the
message carries an `action` byte so the server can distinguish DOWN
vs. UP. If we ever wire up a "Back" hardware button we have to send
the action byte. Same applies to upstream 3.x.

## Concrete changes needed

The list is grouped by surface. Each item names the file and the
specific class / constant to touch. Renumbering of the type-byte enum
is unavoidable because we have to introduce the upstream values
12–21 and align the wire layout with whatever scrcpy-server JAR we
ship.

### A. Replace the bundled server

- Either rebuild `vendor/Genymobile/scrcpy/scrcpy-server.jar` from a
  `3.x-wsN` fork of Genymobile/scrcpy, or build vanilla 3.x and add a
  thin WebSocket-aware front-end to it. Keep the suffix convention in
  `src/server/goog-device/ServerVersion.ts:13` (`isCompatible` requires
  a `-ws*` suffix) so old clients can detect a mismatch.

### B. Renumber the type-byte enum

- `src/app/controlMessage/ControlMessage.ts:6-20`: replace the table.
  Keep the fork-private slots at 101/102 to avoid colliding with
  upstream growth, but rename the ones whose semantics moved (e.g.
  `TYPE_SET_SCREEN_POWER_MODE` → `TYPE_SET_DISPLAY_POWER` to mirror
  upstream).
- Add the new constants: `TYPE_UHID_CREATE = 12`, `TYPE_UHID_INPUT = 13`,
  `TYPE_UHID_DESTROY = 14`, `TYPE_OPEN_HARD_KEYBOARD_SETTINGS = 15`,
  `TYPE_START_APP = 16`, `TYPE_RESET_VIDEO = 17`, optionally
  `TYPE_CAMERA_SET_TORCH = 18`, `TYPE_CAMERA_ZOOM_IN = 19`,
  `TYPE_CAMERA_ZOOM_OUT = 20`, `TYPE_RESIZE_DISPLAY = 21`.

### C. Update `TouchControlMessage`

- File: `src/app/controlMessage/TouchControlMessage.ts`.
- Bump `PAYLOAD_LENGTH` from 28 to 32.
- Add `actionButton: number` constructor field, default 0.
- In `toBuffer`, write `actionButton` as a u32 immediately before
  `buttons` (i.e. after `pressure`).
- Pointer ID: upstream uses the full i64. The fork currently encodes
  the high 32 bits as zero. Either keep that (compatible) or thread a
  64-bit pointer-id source. Recommend keeping zero in the high word
  unless multi-pointer disambiguation requires it.
- Caller updates: `src/app/interactionHandler/InteractionHandler.ts`,
  `src/app/interactionHandler/FeaturedInteractionHandler.ts` —
  compute `actionButton` from the DOM `mouseup`/`mousedown` `button`
  field (left/right/middle/back/forward → `MotionEvent.BUTTON_*`).
- Extend `MotionEvent.ts:1-19` with `BUTTON_BACK = 1 << 3`,
  `BUTTON_FORWARD = 1 << 4`, and the new actions used by upstream
  (`ACTION_HOVER_MOVE = 7`, `ACTION_BUTTON_PRESS`, etc.) if any caller
  needs them — touchscreen-only paths can stay on DOWN/UP/MOVE.

### D. Update `ScrollControlMessage`

- File: `src/app/controlMessage/ScrollControlMessage.ts`.
- Keep `PAYLOAD_LENGTH = 20` but rewrite `toBuffer`:
  - Drop the `u32` x/y writes (currently unsigned); upstream is signed
    i32 in this slot. Use `writeInt32BE`.
  - After the screen height, write `hScroll` and `vScroll` as i16
    fixed-point: `Math.max(-32768, Math.min(32767, Math.round(value * 32767)))`.
  - Append a u32 `buttons` field after the two i16 scroll values.
- Add a `buttons` constructor argument (default 0).
- Caller updates: same two interaction handlers as the touch path. They
  must source the persistent `buttons` bitmask from the latest mouse
  state.

### E. Update clipboard

- File: `src/app/controlMessage/CommandControlMessage.ts:47-63`
  (`createSetClipboardCommand`).
  - Add a `sequence: bigint` argument (or `number` in the i32 range,
    cast to BigInt for `writeBigUInt64BE`).
  - Buffer layout becomes: `u8 type, i64 sequence, i8 paste, u32 length, UTF-8`.
  - Total allocation: `1 + 8 + 1 + 4 + textLength`.
- File: same, `Commands` map (line 24). Extend
  `createGetClipboardCommand` so it emits the new `copyKey` byte
  instead of a bare type byte. Likely needs a new factory rather than
  re-using the generic `CommandControlMessage` constructor.
- File: `src/app/googDevice/DeviceMessage.ts`. Add a new constant
  `TYPE_ACK_CLIPBOARD = ?` (verify against upstream `DeviceMessage.java`
  in 3.x — outside this brief's WebFetch set; document in Risk) and
  parse the echoed `sequence`. Plumb that ack into whichever client
  module currently waits on the clipboard round-trip.

### F. Add UHID infrastructure (largest change)

- New file: `src/app/controlMessage/UHidCreateControlMessage.ts`. Type
  byte 12, payload `u16 id, u16 vendorId, u16 productId, u8 nameLen,
  name UTF-8, u16 reportDescSize, descriptor bytes`.
- New file: `src/app/controlMessage/UHidInputControlMessage.ts`. Type
  byte 13, payload `u16 id, u16 dataLen, data bytes`. Length cap from
  the upstream `SC_HID_MAX_SIZE` constant — verify the actual value
  (Risk).
- New file: `src/app/controlMessage/UHidDestroyControlMessage.ts`. Type
  byte 14, payload `u16 id`.
- New module: a HID report descriptor + report generator. The desktop
  scrcpy client ships static descriptors in `app/src/hid/`; we need
  TS equivalents. Minimum viable: a keyboard descriptor and a mouse
  descriptor. Source these from upstream's `hid_keyboard.c` and
  `hid_mouse.c` (out of scope for this doc — verify field order during
  implementation).
- New event path: a new `UHidKeyInputHandler` parallel to
  `src/app/googDevice/KeyInputHandler.ts` that emits HID reports
  instead of `KeyCodeControlMessage`. A UI toggle should switch
  between the two modes.

### G. Misc new types

- `TYPE_OPEN_HARD_KEYBOARD_SETTINGS = 15`: trivial zero-payload, can
  reuse `CommandControlMessage`.
- `TYPE_START_APP = 16`: add a factory `createStartAppCommand(name: string)`
  that emits `u8 type, u8 nameLen, UTF-8 bytes`. Document the `+`/`?`
  prefix convention.
- `TYPE_RESET_VIDEO = 17`: trivial zero-payload, can reuse
  `CommandControlMessage`. Wire this into rotation handling to
  drop the keyframe-wait race.
- `TYPE_RESIZE_DISPLAY = 21`: `u8 type, u16 w, u16 h` factory. Pairs
  with the virtual-display mode if/when added.
- Camera (`18`/`19`/`20`): skip until camera streaming is on the
  roadmap.

### H. `BACK_OR_SCREEN_ON` (4)

- If we wire any back-button UI: emit `u8 type, u8 action` (use
  `KeyEvent.ACTION_DOWN`/`ACTION_UP`). Keep one shot per click. The
  current `CommandControlMessage` zero-payload path will not work
  because the message expects an action byte.

### I. Constants & helper updates

- `src/app/MotionEvent.ts`: add `BUTTON_BACK`, `BUTTON_FORWARD`, and
  `ACTION_HOVER_MOVE` if used.
- `src/app/UIEventsCode.ts` / `KeyToCodeMap.ts`: no change strictly
  needed for the wire bump, but consider routing more keys through
  the new UHID path so we stop relying on the limited
  KEYCODE-translation table.
- `DeviceMessage.ts:25-29`: confirm whether upstream 3.x still
  length-prefixes the clipboard payload with i32 or moved to u32.

### J. Verification approach

- Capture frames with an `nc | xxd` on the ADB-forwarded socket
  against an upstream `scrcpy 3.x` desktop client, side-by-side with
  ws-scrcpy. Compare byte-for-byte for each message type produced by
  each UI gesture.
- Unit tests for every `toBuffer()` against a hand-computed byte
  array (the fork has no such tests today for the control side).

## Risk / unknowns

1. **Pointer ID semantics.** Upstream 3.x assigns `pointer_id` based on
   internal SDL pointer tracking, with a special "mouse" sentinel
   (`POINTER_ID_MOUSE = -1` interpreted as u64). The fork uses
   sequential integer IDs and zeros the high 32 bits. If the 3.x server
   relies on the sentinel to distinguish mouse from touchscreen events,
   the fork's encoding will misclassify mouse events. Needs a quick
   read of `Controller.java` parseInjectTouchEvent before locking in
   the implementation.

2. **Scroll fixed-point exact encoding.** WebFetch summarised the
   reader as "i16 ... multiplied by 16 after fixed-point conversion".
   That phrasing is ambiguous — likely upstream uses a Q15 packing
   (`i16 / 32767.0 → float in [-1,1]`), but a low-confidence guess.
   Verify against `Binary.floatToI16FixedPoint`-style helpers in
   `server/.../control/` before committing the encoder.

3. **`ACTION_BUTTON_*` action codes.** With `actionButton` joining the
   touch event, upstream also introduced new action codes
   (`ACTION_BUTTON_PRESS = 11`, `ACTION_BUTTON_RELEASE = 12` in Android
   `MotionEvent`). It is not yet clear whether the 3.x server still
   accepts `ACTION_DOWN/UP/MOVE` from mouse paths, or whether mouse
   buttons MUST come through `ACTION_BUTTON_*`. Mis-mapping will mean
   touches work but right-click does not.

4. **UHID descriptors.** `SC_HID_MAX_SIZE`, the exact byte layout of
   the keyboard descriptor, and the report-generation logic were not
   fetched. Cribbing from upstream `app/src/hid/hid_keyboard.c` is
   straightforward, but we have to be careful about layout mismatches
   between USB HID descriptors and what Android's UHID driver
   accepts.

5. **Clipboard sequence allocation.** Where does `sequence` come from?
   Upstream client generates it monotonically and the server echoes it
   in a new `TYPE_ACK_CLIPBOARD` device message. We need confirmation
   on the exact device-message type byte (not covered by the WebFetch
   above — was scoped to ControlMessage). Source:
   `server/.../device/DeviceMessage.java` and the new
   `DeviceMessageWriter`.

6. **`START_APP` name format.** The `+` / `?` prefix convention is
   documented in the upstream README but the exact server parser
   behavior on unknown prefixes is a guess. Test against a sample
   payload before exposing a UI affordance.

7. **Keyboard mode UI.** Switching between AKEY (legacy) and UHID
   modes is a runtime concern, not a wire concern, but it affects
   which control-message classes get instantiated. The fork has no
   notion of two keyboards — adding a toggle requires a new options
   surface in the stream client and probably a fork-config flag.

8. **WebSocket-server compatibility band.** The pinned 1.19-ws6 server
   includes ws-scrcpy-specific patches (notably the `scrcpy_message`
   framing in `DeviceMessage.ts:7` and the file-push protocol). Any
   3.x rebase has to re-apply those, and we need to assert (via
   `ServerVersion.gt`) that the client refuses to start against a
   pre-3.x server now that the wire format has shifted incompatibly.

9. **`TYPE_BACK_OR_SCREEN_ON` payload.** The fork allocates the type
   but never emits the message, so we have no historical compatibility
   constraint. If we begin emitting it, do so with the full
   `u8 type, u8 action` payload — the empty-payload pattern used by
   the other entries in `CommandControlMessage.Commands` is wrong for
   this type.

10. **Unverified upstream paths.** This audit was based on the master
    branch of Genymobile/scrcpy as of 2026-05-20 plus the existing
    fork source. Release notes for 1.20–3.x were not enumerated frame
    by frame; any wire-format change introduced and reverted within
    that band is invisible here. A second-pass diff of the upstream
    Reader against a 2.x branch tag would catch any silent revert
    we'd otherwise inherit.
