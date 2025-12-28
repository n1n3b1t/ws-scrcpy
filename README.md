# ws-scrcpy (Docker Fork)

> 🍴 **Fork of [NetrisTV/ws-scrcpy][upstream]** — Updated for 2025 with Docker-first deployment

Web client for [Genymobile/scrcpy][scrcpy] that lets you view and control Android devices from your browser.

## What's Different in This Fork?

- **Docker-first deployment** — Single command to get running
- **Updated dependencies** — Node.js 18, modern npm packages, security patches
- **2025-ready** — Fixes for deprecated APIs and build issues
- **Multi-stage Docker build** — Optimized image size
- **USB passthrough** — Direct device access without privileged mode

## Quick Start

### Docker (Recommended)

```shell
git clone https://github.com/n1n3b1t/ws-scrcpy
cd ws-scrcpy
docker compose up -d
```

Open http://localhost:8233 in your browser.

> **Note:** USB passthrough requires a Linux host. For macOS/Windows, use [ADB over network](#adb-over-network).

### Manual Installation

```shell
git clone https://github.com/n1n3b1t/ws-scrcpy
cd ws-scrcpy
npm install
npm run dist
cd dist && npm start
```

**Requirements:** Node.js v18+, [node-gyp](https://github.com/nodejs/node-gyp#installation), `adb` in PATH

## Features

### Android
- **Screen casting** - H264 streaming with multiple decoder options (Mse, Broadway, TinyH264, WebCodecs)
- **Remote control** - Touch, multi-touch, keyboard, mouse, clipboard
- **File management** - Push APKs, list/upload/download files
- **Remote shell** - ADB shell in browser via [xterm.js][xterm.js]
- **DevTools** - Debug WebPages/WebView ([details](/docs/Devtools.md))

### iOS (Experimental)
- Screen casting via [ws-qvh][ws-qvh] or MJPEG
- Basic remote control via [WebDriverAgent][WebDriverAgent]

*iOS support is not built by default. See [Custom Build](#custom-build).*

## Configuration

Set `WS_SCRCPY_CONFIG` environment variable to specify a config file path.
Set `WS_SCRCPY_PATHNAME` for custom base URL path.

See [config.example.yaml](/config.example.yaml) for format.

## Docker Details

The `docker-compose.yml` provides:
- Port `8233` for web interface
- USB passthrough for ADB (Linux host required)
- Persistent ADB keys in `./adb-keys`
- Optional config via `./config.yaml`

```shell
docker compose logs -f                      # View logs
docker compose down                         # Stop
docker compose exec ws-scrcpy adb devices   # Check connected devices
docker compose build --no-cache             # Rebuild image
```

### ADB over Network

For macOS/Windows hosts (no USB passthrough), connect devices via TCP/IP:

1. Connect device to same network as host
2. Enable wireless debugging on device (Android 11+) or run `adb tcpip 5555`
3. Configure in `config.yaml`:

```yaml
remoteAdbHostList:
  - '192.168.1.100:5555'  # Your device IP
```

4. Restart the container: `docker compose restart`

## Custom Build

Override [default configuration](/webpack/default.build.config.json) in [build.config.override.json](/build.config.override.json):

| Option | Description |
|--------|-------------|
| `INCLUDE_APPL` | iOS device support |
| `INCLUDE_GOOG` | Android device support |
| `INCLUDE_ADB_SHELL` | Remote shell |
| `INCLUDE_DEV_TOOLS` | WebView debugging |
| `INCLUDE_FILE_LISTING` | File management |
| `USE_BROADWAY` | Broadway Player |
| `USE_H264_CONVERTER` | Mse Player |
| `USE_TINY_H264` | TinyH264 Player |
| `USE_WEBCODECS` | WebCodecs Player |
| `USE_WDA_MJPEG_SERVER` | iOS MJPEG streaming |
| `USE_QVH_SERVER` | ws-qvh support |
| `SCRCPY_LISTENS_ON_ALL_INTERFACES` | Direct browser connection |

## Requirements

**Browser:** WebSockets, Media Source Extensions, WebWorkers, WebAssembly

**Device:** Android 5.0+ with [USB debugging enabled](https://developer.android.com/studio/command-line/adb.html#Enabling)

## Known Issues

- Android Emulator: Select "proxy over adb" from interfaces list
- TinyH264Player may fail to start - reload the page
- Safari: File upload shows no progress

## Security Warning

 No encryption or authorization by default. Consider:
- [Configuring HTTPS](#configuration)
- Network-level security
- The scrcpy WebSocket server listens on all interfaces

## Related Projects

[scrcpy][scrcpy] • [xterm.js][xterm.js] • [Broadway][broadway] • [tinyh264][tinyh264] • [adbkit][adbkit]

## Credits

This is a fork of [NetrisTV/ws-scrcpy][upstream], updated for 2025 with Docker support.

**scrcpy WebSocket fork:** Based on scrcpy v1.19 ([Source][fork] | [Prebuilt](/vendor/Genymobile/scrcpy/scrcpy-server.jar))

[upstream]: https://github.com/NetrisTV/ws-scrcpy
[fork]: https://github.com/NetrisTV/scrcpy/tree/feature/websocket-v1.19.x
[scrcpy]: https://github.com/Genymobile/scrcpy
[xevokk/h264-converter]: https://github.com/xevokk/h264-converter
[h264-live-player]: https://github.com/131/h264-live-player
[broadway]: https://github.com/mbebenita/Broadway
[adbkit]: https://github.com/DeviceFarmer/adbkit
[xterm.js]: https://github.com/xtermjs/xterm.js
[tinyh264]: https://github.com/udevbe/tinyh264
[node-pty]: https://github.com/Tyriar/node-pty
[WebDriverAgent]: https://github.com/appium/WebDriverAgent
[qvh]: https://github.com/danielpaulus/quicktime_video_hack
[ws-qvh]: https://github.com/NetrisTV/ws-qvh
[MSE]: https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API
[isTypeSupported]: https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/isTypeSupported
[MediaSource]: https://developer.mozilla.org/en-US/docs/Web/API/MediaSource
[wasm]: https://developer.mozilla.org/en-US/docs/WebAssembly
[webgl]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
[workers]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
[webcodecs]: https://w3c.github.io/webcodecs/
