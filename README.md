# ws scrcpy

Web client for [Genymobile/scrcpy][scrcpy] and more.

## Quick Start

### Docker (Recommended)

```shell
git clone https://github.com/NetrisTV/ws-scrcpy.git
cd ws-scrcpy
docker compose up -d
```

Open http://localhost:8000 in your browser.

### Manual Installation

```shell
git clone https://github.com/NetrisTV/ws-scrcpy.git
cd ws-scrcpy
npm install
npm start
```

**Requirements:** Node.js v10+, [node-gyp](https://github.com/nodejs/node-gyp#installation), `adb` in PATH

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
- Port `8000` for web interface
- USB passthrough for ADB (Linux host required)
- Persistent ADB keys in `./adb-keys`
- Optional config via `./config.yaml`

```shell
docker compose logs -f    # View logs
docker compose down       # Stop
docker compose exec ws-scrcpy adb devices  # Check devices
```

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

## scrcpy WebSocket Fork

Based on scrcpy v1.19: [Source][fork] | [Prebuilt](/vendor/Genymobile/scrcpy/scrcpy-server.jar)

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
