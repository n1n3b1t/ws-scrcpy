### Docker Compose Example 

```yaml
version: '3.8'

services:
  redroid:
    image: redroid/redroid:latest
    container_name: redroid
    privileged: true
    ports:
      - "5555:5555"  # ADB
    networks:
      - android-net

  ws-scrcpy:
    build: .
    container_name: ws-scrcpy
    depends_on:
      - redroid
    environment:
      - SCRCPY_DEVICE_HOST=redroid:5555  # Connect to redroid container
      - SCRCPY_AUTO_CONNECT=true
    ports:
      - "8000:8000"  # Web interface
    networks:
      - android-net
    # ADB needs to connect to redroid
    command: >
      sh -c "
        adb connect redroid:5555 &&
        node /opt/ws-scrcpy/dist/index.js
      "

networks:
  android-net:
    driver: bridge
```