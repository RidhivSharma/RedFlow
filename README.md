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

Phase 2 (global hotkey) is complete and verified on Windows: hold **F9**
anywhere in Windows to emit start, release to emit stop, with auto-repeat
filtered and the tray tooltip showing `Recording...` / `Idle`. Holds shorter
than 300 ms are discarded as taps. The binding is read from `settings.json` at
startup; `hotkeyModifiers` already supports combos such as Ctrl+Space. Tray
Quit and the hook-failure path were verified on a real Windows machine.

Phase 3 (mic → WAV) is complete and verified on Windows: a held utterance
produces a valid 16 kHz mono 16-bit `%TEMP%\murmur\last.wav`, taps are discarded,
and the 120 s cap auto-finishes.

Phase 4 (Whisper transcription) is complete and verified on Windows: each saved
utterance is snapshotted, queued, and transcribed locally with `whisper-cli.exe`
(60 s timeout, one process at a time). Live F9 runs return sensible English
text and log the elapsed time; rapid utterances transcribe in order, and
missing resources produce a clear terminal error plus tray tooltip. Text
insertion is phase 5.

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

## Local Whisper resources

Transcription needs two downloaded files, both ignored by git:

- `resources/whisper/whisper-cli.exe` plus its DLLs
- `resources/models/ggml-base.en.bin` (~142 MB, English-only base model)

Download a Windows x64 build from the
[whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) and
copy the **contents** of its `Release/` folder into `resources/whisper/`
(`whisper-cli.exe` and every DLL must sit directly in that folder). Download
`ggml-base.en.bin` from the
[whisper.cpp model collection](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
into `resources/models/`.

Set `modelPath` in `settings.json` to use a different model. `threads` controls
whisper's thread count; `0` means auto (logical cores minus one, minimum two).
The same `resources/whisper` and `resources/models` layout is used inside an
installed build, resolved through `process.resourcesPath`.
