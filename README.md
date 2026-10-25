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
insertion is implemented and verified across Notepad, VS Code, Chrome, and Word.

Phase 8 quality work is in progress. Near-silent holds skip Whisper entirely,
Whisper's non-speech annotations and known silence hallucinations are removed,
and optional toggles can drop filler words or convert spoken punctuation and
line-break commands. Holds that start while an earlier transcript is still
processing are queued. Failures now appear in the overlay as one friendly
sentence, with technical detail in the log. Elevated or unknown-integrity
targets now get a clipboard-only fallback instead of a blocked paste; see
[Pasting into administrator apps](#pasting-into-administrator-apps).

## Requirements

- Windows 10 or 11, x64
- Node.js 22.12 or newer

## Commands

```bash
npm install       # install dependencies (also downloads the Electron runtime)
npm run dev       # run the app in development
npm run build     # typecheck and build main, preload, and renderer bundles
npm run start     # preview the built app
npm test          # unit tests for the insertion branch and probe parser
npm run typecheck # typecheck the Node and web sides
npm run lint      # ESLint
npm run icon      # regenerate the placeholder tray icon
```

The app writes `settings.json` to `%APPDATA%\Murmur\` on first run. A rotating
log lives in `%APPDATA%\Murmur\logs\murmur.log` (2 MB per file, three backups).
Transcript text is not logged by default; start with `MURMUR_DEBUG=1` to include
it for troubleshooting.

## Pasting into administrator apps

Windows blocks synthetic input from a normal user-level app into an app running
as administrator or at a higher integrity level (UIPI — User Interface
Privilege Isolation). Murmur checks the foreground process before inserting. If
the target is elevated or its integrity cannot be checked, Murmur does **not**
send Ctrl+V. It copies the transcript to the clipboard, leaves it there, and
shows:

> Target app is running as admin - text copied, press Ctrl+V manually.

Press Ctrl+V yourself in the target app. The previous clipboard is intentionally
not restored in this case, so the transcript stays available for the manual
paste. For normal apps, Murmur restores the previous clipboard after the tuned
350 ms delay.

Running Murmur as administrator can let it paste into some elevated apps, but it
is not recommended for everyday use: it gives Murmur more privilege than it
needs. UIPI is a Windows security boundary, not a Murmur bug.

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
