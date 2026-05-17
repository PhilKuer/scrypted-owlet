# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Scrypted plugin that integrates Owlet baby monitor cameras with HomeKit. It authenticates against Firebase (Owlet's auth backend), discovers cameras via the Owlet device API, fetches TUTK P2P credentials, and exposes cameras through the Scrypted `DeviceProvider` + `Camera`/`VideoCamera` interfaces.

## Commands

```bash
npm install                              # Install dependencies
npm run build                           # One-time webpack build → out/
npm run dev                             # Watch mode (scrypted-webpack --watch)
npm run scrypted-deploy-debug 127.0.0.1 # Build + deploy to local Scrypted server
npx tsc --noEmit                        # Type-check without building
npm test                                # No-op (no tests implemented)
```

The `watch` script (`tsc --watch`) is a legacy alias — use `dev` instead.

## Architecture

### Dual TypeScript / Python Implementations

Both `src/*.ts` and `src/*.py` implement the same logic. `package.json` sets `"runtime": "python"`, meaning Scrypted loads the Python code at runtime. The TypeScript source exists as a parallel implementation and compiles via webpack, but is not the active runtime. **When making logic changes, update both implementations.**

### Core Classes

- **`OwletPlugin`** (`main.ts` / `main.py`) — `DeviceProvider` + `Settings`. Manages credentials, triggers discovery, and instantiates per-camera devices. Auto-discovers on startup (5 s delay) and on a configurable periodic interval.
- **`OwletAuth`** (`owlet-auth.ts` / `owlet_auth.py`) — Handles Firebase login (email + password → JWT), device list fetching from `devices-public.owletdata.com`, and TUTK credential fetching from `camera-kms.owletdata.com`.
- **`OwletCamera`** (`owlet-camera.ts` / `owlet_camera.py`) — Per-camera device. Implements `Camera`, `VideoCamera`, `Settings`. Spawns external processes for streaming and snapshots, manages a connection pool per quality tier.

### Discovery Flow

```
Startup / settings save
  → OwletAuth.login(email, password)       # Firebase → JWT
  → OwletAuth.listDevices()                # devices-public API
  → Filter: type=='camera' | deviceType=='CAMERA' | id starts 'OCA'
  → Fallback: hardcoded 'OCA1234567890123' + manualCameraId setting
  → OwletAuth.getTutkCredentials(deviceId) # camera-kms API
  → sdk.deviceManager.onDevicesChanged()  # notify Scrypted
  → Scrypted calls getDevice(nativeId)    # instantiate OwletCamera
```

### Streaming Architecture

`OwletCamera` maintains a `Map<quality, ConnectionPool>`. Streaming and snapshots are handled by spawning external scripts:
- Video: `tutk-client.js` (TypeScript path) or `python/tutk-stream.py` (Python path)
- Snapshot: `tutk-snapshot.js` (TypeScript path) or `python/tutk-snapshot.py` (Python path)

**These scripts are currently placeholders** — video returns an empty HLS playlist and snapshots return placeholder JPEG data. Real TUTK SDK integration is the primary remaining work.

### Storage

Scrypted's `storage` API (key-value, survives restarts) stores:
- Plugin-level: `email`, `password`, `refreshInterval`, `manualCameraId`
- Per-device: `device_${nativeId}` — JSON blob with `deviceId`, `name`, TUTK credentials (`tutkId`, `tutkUsername`, `tutkPassword`, `authKey`), and `status`

### Authentication Details

- Firebase API key is hardcoded (`AIzaSyCx17leGPCKu5tZ1BLPni5LbAAlVvnNxZQ`) — this is a public client key, not a secret.
- Tokens auto-refresh with a 5-minute expiry buffer.
- Owlet API endpoints: `https://devices-public.owletdata.com/v2` (devices), `https://camera-kms.owletdata.com` (TUTK creds).

## Settings Schema

Plugin-level (defined in `package.json` scrypted.settings):
- `email` — Owlet account email
- `password` — Owlet account password (type: password)
- `refreshInterval` — 1–60 minutes, default 5

Per-device (defined in `OwletCamera.getSettings()`):
- `streamQuality` — `LD` | `SD` | `HD` | `2K`, default `HD`
- `streamTimeout` — 60–1800 s, default 300
- `maxConnections` — 1–5, default 3
- `motionDetection` — boolean, default true

## Known Limitations

- TUTK streaming is not implemented — `tutk-client.js` and `tutk-snapshot.js` are stubs.
- Audio, real motion detection, local recording, and night vision are unimplemented.
- No test coverage exists.
- The connection pool does not enforce `maxConnections` in practice.
- Python and TypeScript implementations may drift if changes are made to only one side.
