# ws-scrcpy Simplification & Embedding Notes

## Project Goal

Simplify `ws-scrcpy` for clean iframe embedding in the Hive platform, connecting directly to `redroid` Android containers with a single clean URL.

## What We Have Done

The codebase has been massively simplified and modernized:

### Architecture Simplifications

1. **Decoder Lock**: Locked video decoder exclusively to **H264 Converter (MSE)**. Removed Broadway.js, TinyH264, and WebCodecs implementations.
2. **Code Cleanup**: Removed ADB Shell (node-pty), File Listing, DevTools tracking, and all iOS support (appl-device).
3. **Auto-Connect Mode**: Removed device selection UI. Client auto-connects to root URL (`ws://hostname:port/`).
4. **Environment-Based Configuration**: Device UDID read from runtime environment variables instead of build-time webpack injection.
5. **Clean URLs**: No query parameters needed. Simple iframe embedding: `<iframe src="http://ws-scrcpy:8000">`

### UI Improvements
Configuration

### Environment Variables

```bash
# Required: Device to connect to
export SCRCPY_DEVICE_HOST=emulator-5554        # Local testing
export SCRCPY_DEVICE_HOST=redroid:5555         # Docker/Production

# Optional: scrcpy server port (default: 8886)
export SCRCPY_DEVICE_PORT=8886

# Optional: ws-scrcpy server port (default: 8000)
export WS_SCRCPY_SERVER_PORT=8000
```

### Local Development

```bash
# 1. Start Android emulator
~/Library/Android/sdk/emulator/emulator -avd Pixel_7 -no-window -no-audio

# 2. Set device and build
export SCRCPY_DEVICE_HOST=emulator-5554
npm run dist

# 3. Start server
cd dist && npm start

# 4. Open browser
open http://localhost:8000
```

### Docker Deployment

```yaml
version: '3.8'
services:
  redroid:
    image: redroid/redroid:latest
    privileged: true
    networks:
      - android-net

  ws-scrcpy:
    build: .
    environment:
      - SCRCPY_DEVICE_HOST=redroid:5555
    ports:
      - "8000:8000"
    networks:
      - android-net
    command: >
      sh -c "adb connect redroid:5555 && node /app/dist/index.js"
```

---

## Technical Details

### Connection Flow

1. **Client**: Browser loads from `http://hostname:8000`
2. **WebSocket**: Client connects to `ws://hostname:8000/` (clean URL, no query params)
3. **Server**: Reads `SCRCPY_DEVICE_HOST` from environment
4. **Auto-start**: Pushes scrcpy-server.jar and starts it on device (if needed)
5. **Port Forward**: Sets up `adb forward` from local port to device tcp:8886
6. **Proxy**: Establishes WebSocket proxy to scrcpy server
7. **Stream**: H264 video streams via MSE decoder to browser

### Key Files

- `src/app/index.ts` - Client auto-connect logic
- `src/server/goog-device/mw/WebsocketProxyOverAdb.ts` - Server-side proxy with env config
- `src/server/services/WebSocketServer.ts` - Default route handler
- `src/common/Constants.ts` - scrcpy server configuration (port 8886)tion logic that used to push `vendor/scrcpy/scrcpy-server.jar` to the Android device and execute it via `adb shell`.

We threw this out because the `redroid` container in the Hive stack generally runs the `scrcpy` daemon out of the box natively. However, you are currently testing this on a **raw, local Android Studio Pixel 7 emulator**, which does _not_ have the server injected or running.

Because the client is now optimized to be a "dumb client" that blindly assumes the server is actively listening on the target device, it crashes on your local emulator when it tries to proxy to a nonexistent socket.

## Next Steps

To test this successfully on your local machine before deploying to Hive, we have two options:

1. **Manual Server Push**: Manually push the `scrcpy-server.jar` to your emulator and run it via `adb shell app_process ...` from a separate terminal window to mimic the `redroid` environment.
2. **Restore Auto-Push**: Temporarily restore the auto-push code we deleted so `ws-scrcpy` handles injecting the jar for your local testing phase.
