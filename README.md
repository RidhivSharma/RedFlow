# Murmur

Free, local push-to-talk dictation for Windows. Hold a hotkey, speak, release,
and the transcribed text is typed at the cursor of whatever app is focused.

Murmur is built with Electron, React, and TypeScript, and transcribes locally
with whisper.cpp. No cloud APIs, no accounts, no telemetry.

## Status

Phase 1 (scaffold + tray) is implemented and smoke-tested in development and
production builds. The app starts with no visible window, lives in the system
tray, opens a placeholder Settings window, and enforces a single instance.
The tray Settings and Quit actions are verified manually. Remaining before the
phase is marked done: a day-long tray soak test.

## Requirements

- Windows 10 or 11, x64
- Node.js 22.12 or newer

## Commands

```bash
npm install       # install dependencies (also downloads the Electron runtime)
npm run dev       # run the app in development
npm run build     # typecheck and build main, preload, and renderer bundles
npm run start     # preview the built app
npm run typecheck # typecheck the Node and web sides
npm run lint      # ESLint
npm run icon      # regenerate the placeholder tray icon
```

The app writes `settings.json` to `%APPDATA%\Murmur\` on first run.
