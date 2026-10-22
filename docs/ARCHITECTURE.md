# Architecture — Murmur

A design document for Murmur, a Windows push-to-talk dictation app. Written for contributors with a web background — desktop concepts are explained as they appear. Decisions list lives in [`AGENTS.md`](../AGENTS.md); this document describes *how the pieces fit and why*.

---

## 1. Mental model (for the web developer)

An Electron app is one desktop program with multiple "browser tabs" inside it:

- The **main process** is like a Node.js server: it owns the OS — windows, tray, files, child processes. There is exactly one, and it lives for the whole app lifetime. It has no DOM.
- **Renderer processes** are the tabs: HTML/CSS/React. Each window is one renderer. By default they can't touch the OS; they must ask the main process.
- **IPC** (Inter-Process Communication) is the message bus between main and renderers — think `postMessage` between a page and a supersized service worker.
- A **preload script** is the tiny adapter loaded before each page's React code that defines exactly which IPC calls that page may make. This keeps renderers sandboxed.

Murmur runs three windows plus one child process outside Electron:

```
┌───────────────────────────── one Electron app ──────────────────────────────┐
│                                                                             │
│   MAIN PROCESS — the conductor                                              │
│     • app lifecycle, single-instance lock, tray icon + menu                 │
│     • uiohook-napi: global key events + simulated Ctrl+V taps               │
│     • dictation state machine (idle → recording → transcribing → pasting)   │
│     • whisper runner: spawns whisper-cli.exe per utterance (FIFO queue)     │
│     • clipboard save / write / restore                                      │
│     • settings store: %APPDATA%\Murmur\settings.json                        │
│                                                                             │
│        typed IPC bridge (preload script per window, context isolated)       │
│                │                        │                         │         │
│                ▼                        ▼                         ▼         │
│   hidden recorder window        overlay window          settings window     │
│   (mic capture → WAV,            (status, never            (React,          │
│    never visible)                 takes focus)          opened from tray)  │
└─────────────────────────────────────────────────────────────────────────────┘

 outside the app:
   • uiohook-napi reads key events straight from Windows (works in any app)
   • the simulated Ctrl+V lands in whichever app currently has keyboard focus
   • whisper-cli.exe runs as a local child process: main feeds it a temp WAV
     file on disk, and it prints the recognized text back to main
```

The shape that dictates every design choice below: **Murmur must never steal keyboard focus from the app the user is dictating into.** Every window flag and IPC rule obeys that law.

---

## 2. Main process

One Node process. Responsibilities and where they live:

| Concern | File (planned) | Notes |
|---|---|---|
| Boot & lifecycle | `src/main/index.ts` | Thin: create singletons, wire modules, handle quit. Windows-specific: set `app.setAppUserModelId('dev.murmur.app')` so Windows associates tray/notifications with Murmur rather than a generic "electron". |
| Single instance | `src/main/app/singleInstance.ts` | `app.requestSingleInstanceLock()`; second launch is a no-op. A tray app must not run twice — two hotkey listeners and clipboard writers would fight. |
| Tray | `src/main/app/tray.ts` | Icon + menu: Settings, Quit. Tray apps have no taskbar button, so the tray is the only visible surface between utterances. |
| Hotkey | `src/main/hotkey.ts`, `src/main/hotkeyBinding.ts`, `src/main/hotkeyController.ts`, `src/main/hotkeyCapture.ts` | uiohook-napi *listener* (keydown/keyup with keycodes — not Electron shortcuts) plus the *simulator* used for the final Ctrl+V tap. Runs in main so a hung renderer can't lose keyboard tracking. `hotkeyBinding.ts` validates the primary key and modifier names into keycodes; key auto-repeat is latched out until the matching keyup. `hotkeyController.ts` owns start/stop so settings can rebind live, and `hotkeyCapture.ts` temporarily owns the hook while the settings window picks a new key. |
| Dictation state machine | `src/main/dictation.ts` | The single owner of "what is happening right now" (section 5). All windows are told state changes through IPC. |
| Recorder sessions | `src/main/recorder.ts` | Owns the hidden window's main-process side: one active session, renderer payload validation, an 8 s finish watchdog, WAV validation, and writing `%TEMP%\murmur\last.wav`. Also brokers microphone listing, device switching, and the settings test meter. |
| Transcriber | `src/main/transcriber.ts`, `src/main/whisperRunner.ts` | `transcriber.ts` snapshots the latest WAV to a unique file and runs a strict FIFO queue. `whisperRunner.ts` spawns one `whisper-cli.exe` with `-m -f -l <en\|auto> -nt -np -t`, parses and cleans stdout, kills after 60 s, and cleans up in `finally`. |
| Inserter | `src/main/inserter.ts` | Serialized clipboard save/set/restore + Ctrl+V simulation via uiohook. Waits for hotkey modifiers to be released and refuses to paste into Murmur's own windows. Sequencing rules in section 7. |
| Settings | `src/main/settings.ts`, `src/main/settingsController.ts`, `src/main/models.ts`, `src/main/app/autostart.ts` | JSON at `%APPDATA%\Murmur\settings.json`. Load with per-key validation + defaults; save debounced and atomically (write temp file, rename). `settingsController.ts` serves the settings window and applies changes live (hotkey, microphone, autostart); `models.ts` lists `.bin` files; `autostart.ts` mirrors `autostart` into Windows login items. Schema in section 8. |
| Windows | `src/main/windows/*.ts` | Factories for the three windows (section 3). |
| Permissions | `src/main/app/permissions.ts` | Session handlers allow `media` only for the hidden recorder window, audio only. Every other window and permission is denied. |
| Misc OS glue | — | `powerMonitor` (cancel recording on sleep/lock), `app.setLoginItemSettings` for start-with-Windows, `app.getPath('temp')` for WAV scratch space. |

**Windows-specific:** low-level keyboard hooks + clipboard writes + spawning an unsigned local exe is a pattern heuristic antivirus sometimes dislikes. Murmur does nothing secretly — if AV flags it, the fix is honest: document it, and consider code signing at release time.

---

## 3. Windows

Three renderer windows. Only one is ever visible.

### 3.1 Hidden recorder window (the microphone)

A borderless BrowserWindow created once at startup and kept for the app's lifetime, with:

- `show: false` — never visible; it exists so `getUserMedia` has a page to live in. `focusable: false` and `skipTaskbar: true` keep it out of the user's way.
- `backgroundThrottling: false` — Windows would otherwise throttle timers/audio in a hidden page, garbling capture.
- `autoplayPolicy: 'no-user-gesture-required'` — `AudioContext` starts suspended without a user gesture; a hidden window has none, so this flag is required or the first utterance is silent.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, minimal preload with exactly six operations: `onBegin`, `onFinish`, `onCancel`, `sendAudio`, `reportCaptureError`, and `reportStatus`.

Capture pipeline (all inside this renderer):

1. `navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false } })` once at startup. **The mic stays warm** (decided, AGENTS.md): the stream and audio graph live for the whole app, so key-down only flips a gate instead of opening a device. This is what keeps the first word from being cut. The cost: Windows shows a "mic in use" indicator whenever Murmur runs.
2. The `AudioContext` is created with `sampleRate: 16000` (Chromium resamples the device input), and the `AudioWorkletNode` is forced to one channel, so the worklet receives 16 kHz mono samples. The worklet converts `float32 → int16` and posts 100 ms chunks; the renderer accumulates them and reports the worklet's frame count. If the requested rate is not honoured, setup fails loudly instead of producing a mislabelled WAV.
3. The worklet enforces a frame cap derived from `maxDurationMs` (hard ceiling 120 s). At the cap it flushes, posts an `ended` message, and stops appending; the main process also auto-finishes at the same duration and ignores the later key-up.
4. On `finish` (or the cap), the worklet flushes its partial chunk, the renderer wraps the accumulated samples in a 44-byte RIFF/WAV header (16 kHz, 1 channel, 16-bit PCM = 32 KB/s), and posts the whole `ArrayBuffer` to main (structured clone handles binary — no base64).

The main process validates the exact header and duration before writing `%TEMP%\murmur\last.wav`, and an 8 s finish watchdog turns a hung renderer into a visible error instead of a stuck recording state.

Failure modes surface as `dictation:capture-error` (no device, device busy, Windows microphone privacy setting off — the last is a per-OS toggle many users hit, so the message points at `Settings → Privacy & security → Microphone`). Startup failures arrive as `recorder:status` and are logged plus shown in the tray tooltip.

### 3.2 Overlay window (status & feedback)

Tiny, dismissed-in-one-glance, and — critically — **never focusable**:

- `transparent: true`, `frame: false`, `resizable: false`, `skipTaskbar: true`, `alwaysOnTop: 'screen-saver'`, `focusable: false`.
- Created hidden at startup, then shown inactive as soon as its renderer is ready and **kept mapped** for the app lifetime. Idle content is fully transparent (`visibility: hidden`), so the window is neither visible nor clickable; keeping it mapped turns the Listening transition into a compositor update instead of a `ShowWindow` call, which measured roughly 150 ms slower on Windows. Shown with `showInactive()` only; `setIgnoreMouseEvents(true, { forward: true })` passes mouse input through.
- Positioned bottom-center of the display **under the cursor** (the practical proxy for the active display, since Electron cannot ask Windows for an external app's focused window), offset above the taskbar using `display.workArea`. Repositioned on display add/remove and DPI/metric changes. Placement uses Electron DIP coordinates, so mixed-DPI layouts need no manual scale math; this was verified at 125% scaling on the dev display, while mixed-DPI multi-monitor still needs hardware testing.
- The pill is a single 360 × 96 transparent window; its dark, rounded CSS pill contains a state icon, a short label, and — while listening — a 14-segment level meter.
- Focus/click-through and latency were verified on Windows: the window has `WS_EX_NOACTIVATE` + `WS_EX_TRANSPARENT` + topmost styles, idle pixels are transparent, the foreground window never changed, and key-down → visible pill measured 9–45 ms over eight runs (the screen-polling probe itself costs ~10–15 ms per sample).

States it renders, driven by `overlay:state`:

| State | When | Behavior |
|---|---|---|
| `listening` | hotkey down, before the recorder acknowledges | shown immediately; meter fed by `dictation:level` at ~15 fps |
| `transcribing` | key-up / max-hold reached through the whisper run | spinner; stays visible while the utterance processes |
| `done` | transcript inserted, no other utterance pending | brief "Inserted" confirmation, auto-hides after 900 ms |
| `error` | capture, transcription, or insertion failure | short message (max 140 chars) for 5 s, then auto-hides |
| `idle` | tap discarded, new session, or shutdown | content transparent (the mapped window itself stays alive) |

The recorder computes a 0–1 level from an `AnalyserNode` RMS window on a dBFS scale (silence ≈ −54 dBFS, loud speech ≈ −6 dBFS), sends ~15 samples per second only while its capture gate is open, and main forwards them after checking the active session id. The overlay smooths the decay in CSS/JS. Error details are truncated for the pill; the full message is always logged and shown in the tray tooltip. The overlay never shows transcribed text by default; that is baked into the target app's text field, which is confirmation enough.


### 3.3 Settings window

The only *normal* window, and the only one allowed to take focus. Standard frame, React page, singleton (reuse instead of creating twice). Opened from the tray; closing destroys it (recreated on demand). Because it can hold focus, the inserter refuses to paste into any focused Murmur window (`own-window-focused`, section 7). The hotkey stays live while Settings is open so a recording is never silently lost, but its transcript is not pasted back into Murmur.

Controls, all applied live (no restart):

- **Push-to-talk hotkey** — click Change, then press a key or modifier combo. Capture runs in main through a temporary uiohook listener while the normal listener is suspended; Escape, a 15 s timeout, or closing the window cancels and restores the previous binding. A 300 ms arming delay ignores the click/Enter that started capture.
- **Trailing space** — appends one space after each transcript when the text does not already end in whitespace.
- **Microphone** — dropdown fed by the hidden recorder's `enumerateDevices` (labels are available because the recorder already holds the media permission). Choosing a device restarts the warm capture pipeline; a change made mid-utterance is deferred until the utterance ends. `System default` (`null`) follows Windows.
- **Test microphone** — enables a live 0–1 level meter in the settings window. The level comes from the recorder renderer's existing analyser, forwarded through main; the settings window never asks for microphone permission.
- **Whisper model** — dropdown listing `.bin` files in `resources/models`; `null` means the bundled `ggml-base.en.bin`. A custom absolute `modelPath` edited in JSON is shown even if it is not in the folder.
- **Language** — English (`en`) or auto-detect (`auto`), passed to `whisper-cli.exe` per run.
- **Start with Windows** — mirrors `autostart` into the Windows login items immediately (`app.setLoginItemSettings`).

The footer shows validation errors, background save failures, and a short "Saved" notice. Settings are validated in main; the renderer receives a `{ ok, settings } | { ok, message }` result rather than an Electron error string (section 4).

---

## 4. IPC

Principles:

- Channels and payload types are declared once in `src/shared/ipc.ts` and imported by main, preload, and renderers. The channel-name strings exist nowhere else.
- Each preload exposes a small, named API object for its window, never a raw `ipcRenderer` that could send arbitrary channels. The settings window gets `window.murmur` (settings read/update, model + microphone lists, mic test, hotkey capture, subscriptions). The hidden recorder gets `window.murmurRecorder` (begin/finish/cancel/set-device/test-monitor listeners, config request, sendAudio, sendLevel, sendMonitorLevel, reportDevices, reportCaptureError, reportStatus).
- Main validates every incoming payload at runtime (string length, whitelisted enum values, numeric ranges) — a renderer bug or compromise must not be able to corrupt settings or run whisper with attacker-controlled paths. Recorder messages are additionally checked against the recorder window's `webContents` identity.
- Electron's sandboxed preloads cannot `require` relative chunks, so each preload is built as a standalone bundle (`build.isolatedEntries` in `electron.vite.config.ts`).

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `dictation:begin` | main → recorder | `{ sessionId, maxDurationMs }` | hotkey pressed: open the capture gate; `maxDurationMs` is clamped to 120 s |
| `dictation:finish` | main → recorder | `{ sessionId }` | hotkey released: flush, encode WAV, send it back |
| `dictation:cancel` | main → recorder | `{ sessionId }` | tap shorter than the minimum: discard silently, no WAV |
| `dictation:audio` | recorder → main | `{ sessionId, wav: ArrayBuffer, durationMs }` | complete 16 kHz mono 16-bit WAV |
| `dictation:level` | recorder → main | `{ sessionId, level }` | ~15 fps normalized mic level while the capture gate is open |
| `dictation:capture-error` | recorder → main | `{ sessionId \| null, code, message }` | mic/stream failure; `null` session means startup |
| `recorder:status` | recorder → main | `{ microphone: 'ready' \| 'unavailable', message? }` | microphone warm-up result / device lost |
| `recorder:devices` | recorder → main | `{ devices }` | microphones visible to the recorder (labels require the media permission it already holds) |
| `recorder:set-device` | main → recorder | `{ deviceId \| null }` | switch the warm pipeline; deferred while recording |
| `recorder:list-devices` | main → recorder | — | request a fresh microphone list |
| `recorder:get-config` | recorder → main (invoke) | — | current `microphoneId` before warm-up |
| `recorder:test-monitor` | main → recorder | `{ enabled }` | start/stop the settings window's test meter |
| `recorder:monitor-level` | recorder → main | `{ level }` | one test-meter sample from the recorder analyser |
| `overlay:state` | main → overlay | `{ state, detail? }` | render `listening`, `transcribing`, `done`, `error`, or `idle` |
| `overlay:level` | main → overlay | `{ level }` | one 0–1 meter sample, forwarded only for the active session |
| `app:info` | settings → main (invoke) | — | app name/version + Electron version for the settings footer |
| `settings:get-state` | settings → main (invoke) | — | `{ settings, models, defaultModelFile, microphones }` |
| `settings:update` | settings → main (invoke) | partial settings (validated) | save changed fields live; resolves `{ ok: true, settings }` or `{ ok: false, message }` |
| `settings:changed` | main → settings | full snapshot | push after a change (for example one made by another surface) |
| `settings:devices` | main → settings | `{ devices }` | microphone list changed (hotplug, permission, device switch) |
| `settings:error` | main → settings | `{ message }` | a debounced background save failed |
| `settings:start-mic-test` / `settings:stop-mic-test` | settings → main (invoke) | — | toggle the test meter; main drives the recorder |
| `settings:mic-level` | main → settings | `{ level }` | one 0–1 sample while the test is active |
| `settings:capture-hotkey` | settings → main (invoke) | — | suspend the hotkey listener and resolve with the captured binding, or `null` after Esc/timeout |
| `settings:cancel-hotkey-capture` | settings → main (invoke) | — | cancel an in-flight capture |

Everything else — spawning whisper, clipboard operations, writing temp files — is main-process-only and never crosses IPC. The recorder knows nothing about whisper; main is the only component that knows the whole pipeline.

---

## 5. The dictation state machine

One state at a time, owned by `dictation.ts`. Guards make confusion impossible: pressing the hotkey while already recording does nothing; releasing without the mic running does nothing; a transcription is never inserted twice.

| State | Entered by | Leaves to |
|---|---|---|
| `idle` | app start; after save or error | `recording` (hotkey down) |
| `recording` | keydown + recorder accepted `begin` | `finalizing` (keyup past the tap minimum, or max-hold cap) · `idle` (capture error, or tap shorter than minimum length → discard) |
| `finalizing` | keyup/cap accepted; WAV in flight | `idle` (WAV validated and saved) · `idle` + error (capture or write failure) |
| `transcribing` | phase 4: WAV queued for whisper | `pasting` (non-empty text) · `idle` (empty/failed → error shown) |
| `pasting` | phase 5: valid text ready | `idle` (pasted & clipboard restored, or error shown) |
| `error` | any failure (message shown in overlay) | `idle` (next keypress) |

Phase 3 stops at `finalizing → idle`. The phase-4 transcription queue and the phase-5 insertion queue both run in the background after the WAV is saved, while the dictation state returns to `idle`; this lets the next hold start immediately while transcriptions and insertions stay FIFO-ordered by utterance. The overlay mirrors the user-visible part: **listening** on key-down, **transcribing** from key-up through the whisper run, **done** for 900 ms after a successful insertion when nothing else is pending, and **error** for five seconds on failure. A tap shorter than 300 ms hides the overlay without a result. If a new hold starts while an earlier transcript is still processing, the pitch stays on **listening** — older done/error flashes never overwrite a live recording. A new keypress during `finalizing` is ignored — the disk write is milliseconds.

Tap policy (decided): minimum hold **300 ms**. The overlay still enters `recording` immediately on keydown, so feedback is instant; releasing before 300 ms returns to `idle`, sends `dictation:cancel`, and produces no WAV or error.

Max-hold policy: at `maxUtteranceMs` (120 s default, clamped to the hard 120 s cap) the state moves to `finalizing` without waiting for key-up; the later key-up is ignored. The worklet also stops appending at its own frame cap, so a hung timer cannot grow the buffer.

---

## 6. Data flow — one utterance, end to end

1. Murmur sits in the tray; uiohook listener armed; the recorder already has a warm mic stream; the overlay window is mapped but fully transparent. The target app (say, a browser) has keyboard focus — Murmur never took it.
2. The user holds the hotkey anywhere in Windows. uiohook fires keydown **in the main process**; auto-repeat re-fires are filtered (same key, still no keyup).
3. Main creates a `sessionId` and sends `dictation:begin` (`{ sessionId, maxDurationMs }`) to the recorder. The warm worklet opens its capture gate on the next audio quantum — no device open, so the first word survives. The overlay appears as "Listening" within ~50 ms measured (9–45 ms key-down to visible pill), and the recorder starts sending ~15 fps level samples for its meter.
4. The 16 kHz mono worklet converts `float32 → int16` and posts 100 ms chunks; the renderer accumulates them. Audio past `maxDurationMs` is never written into the utterance buffer. A parallel `AnalyserNode` computes the display level without touching the recorded samples.
5. The user releases the key → uiohook keyup → main sends `dictation:finish` (or the max-hold timer sends it first).
6. The worklet flushes its partial chunk, the renderer builds the 44-byte RIFF header + PCM data, and sends `dictation:audio` (ArrayBuffer) to main. State becomes `finalizing`.
7. Main validates the header/duration and writes `%TEMP%\murmur\last.wav`. The transcriber immediately snapshots that file to a per-session path (so a following utterance cannot overwrite it) and queues: `whisper-cli.exe -m <model> -f <wav> -l <en|auto> -nt -np -t <threads>`.
8. Main reads stdout: diagnostic lines and timestamps are stripped, remaining plain-text lines are joined with single spaces, and the result is trimmed. Each run gets a 60 s timeout; `whisper-cli.exe` is killed on overrun. Non-zero exit → error path with whisper's stderr detail.
9. Non-empty text is returned to the dictation controller, which queues it for the inserter (section 7). Empty text → "No speech was recognized" in the tray/log until the overlay exists.
10. If the hotkey is a combo, insertion first waits until every required modifier is physically released. Then the inserter borrows the clipboard, sends a synthetic Ctrl+V, waits `pasteRestoreDelayMs`, and restores the previous clipboard text. Insertions are serialized, so rapid utterances cannot interleave their clipboard windows.
11. The per-session WAV snapshot is deleted in a `finally` immediately after the whisper run (deletion happens even on failure). `last.wav` is a phase-3 diagnostic and is simply overwritten by the next utterance.
12. If the user spoke again meanwhile, the queue processes the next `sessionId`.
13. The overlay flashes "Inserted" for 900 ms (when no later utterance is pending) and hides; state `idle`.

Model note: `ggml-base.en.bin` (~142 MB, English-only base model) ships with the app under `resources/models/`. It is **never committed** to the repo; the build fetches it from the whisper.cpp releases and the README documents that step. English-only is intentional for the first release.

---

## 7. Text insertion sequence (`inserter.ts`)

Why paste instead of synthetic typing? Because typed Unicode production from a hook is fragile (dead keys, layout differences, focus flicker), and Ctrl+V pastes multi-line text exactly.

1. **Guard:** refuse to insert while any Murmur window has focus (the settings window; the recorder and overlay are `focusable: false` by design), and refuse empty text. Murmur never shows, focuses, or activates a window during insertion.
2. **Wait for modifiers:** if the binding is a combo (`Ctrl+Space`), wait until every required modifier is physically released. Sending a synthetic Ctrl+V while the user still holds Ctrl would include that modifier, and the synthetic Ctrl-up would leave the target app believing Ctrl was released. The wait is bounded (5 s) so a missed keyup cannot block the queue forever.
3. **Save:** `original = await clipboard.readText()` (text only; see Limitations below).
4. **Set:** `await clipboard.writeText(transcribedText)` — Electron's promise-based clipboard API, so the text is committed before the keystroke.
5. **Tap:** uiohook-napi `keyTap(UiohookKey.V, [UiohookKey.Ctrl])` sends a synthetic Ctrl+V. The focused app — which is still the target app, since Murmur never steals focus — receives the paste and inserts our text at its caret.
6. **Restore:** wait `pasteRestoreDelayMs` (default 350 ms), then `await clipboard.writeText(original)`. Restore runs in a `finally`, including when the tap fails.

Insertions go through a FIFO queue inside the inserter, so overlapping utterances cannot interleave their save/set/restore windows.

Why the delay? Windows apps don't necessarily read the clipboard the instant the keystroke arrives — some (Word, Excel, RDP sessions) read it a moment *later*. Restoring too early means the target pastes the *old* clipboard right after we've restored it. The delay is the known race; whether to make it adaptive is an open decision (phase 8).

**Why not send WM_PASTE / use other insertion APIs?** There is no universal programmatic "insert here" API into arbitrary windows — the synthetic keystroke is the reliable lowest common denominator.

**Known limitations (documented, not bugs):**
- **Apps running as Administrator** ignore synthetic input from user-level processes (Windows UIPI — a security boundary between integrity levels). Dictation into an elevated window silently does nothing unless Murmur itself is elevated. We can't fix it in-app; the overlay will say so (phase 8), and the README documents it.
- **The clipboard is borrowed.** Non-text clipboard content (images, file lists, rich formatting) isn't round-tripped by the initial version — it's saved/restored as text where possible and otherwise lost during the insert window (a fraction of a second). Preserving richer formats is a phase 8 stretch goal.
- **If the user copies something during the restore delay**, their copy may be overwritten by our restore. The window is small; logging/UX mitigation deferred to phase 8.

---

## 8. Settings (`%APPDATA%\Murmur\settings.json`)

Written atomically (temp file + rename), debounced (250 ms), and flushed during shutdown, with a `schemaVersion` for future migrations. Reads go through a per-key whitelist: unknown keys are dropped, wrong types fall back to defaults, and numeric ranges are clamped. A corrupt file must never stop the app from starting — worst case the app runs on defaults and overwrites on the next save. A repaired file is rewritten immediately; an unchanged valid file is left alone.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `schemaVersion` | `number` | `2` | migration marker; a v1 file upgrades in place because every v2 key has a default |
| `hotkey` | `string` | `F9` | primary push-to-talk key (case-insensitive `UiohookKey` name) |
| `hotkeyModifiers` | `string[]` | `[]` | modifiers that must be held with the key (`Ctrl`, `Alt`, `Shift`, `Win`) |
| `microphoneId` | `string \| null` | `null` | input device id from the settings dropdown; `null` = Windows default |
| `modelPath` | `string \| null` | `null` | `.bin` file name in `resources/models`, an absolute path, or `null` for the bundled model |
| `language` | `'en' \| 'auto'` | `'en'` | whisper language flag; `auto` needs a multilingual model |
| `trailingSpace` | `boolean` | `true` | append one space after each transcript |
| `minUtteranceMs` | `number` | `300` | ignore taps shorter than this |
| `maxUtteranceMs` | `number` | `120000` | auto-stop cap |
| `threads` | `number` | `0` | whisper threads; `0` = auto (logical cores − 1, min 2) |
| `autostart` | `boolean` | `false` | start with Windows (`app.setLoginItemSettings`) |
| `overlay` | `object` | `{ position: 'bottom-center' }` | overlay placement / visibility |
| `sounds` | `boolean` | `false` | start/stop sound cues (open decision) |
| `pasteRestoreDelayMs` | `number` | `350` | delay before clipboard restore |

Push-to-talk bindings are two fields so a bare key and a combo use the same shape:

```json
{ "hotkey": "F9", "hotkeyModifiers": [] }
{ "hotkey": "Space", "hotkeyModifiers": ["Ctrl"] }
```

The primary key down starts dictation only when every listed modifier is held. Dictation ends on release of the primary key *or* of any required modifier, so a combo cannot stick. Holding the key produces Windows auto-repeat keydowns; the listener latches the first one and ignores the rest until keyup. An unknown key or modifier is a configuration error: it is logged, the tray tooltip reports the hotkey as unavailable, and the rest of the app keeps running.

---

## 9. Where files live (dev vs. installed)

| What | In dev (`npm run dev`) | Installed |
|---|---|---|
| App code | bundled by electron-vite in memory/out dir | `%LOCALAPPDATA%\Programs\Murmur\` inside `app.asar` |
| `whisper-cli.exe` | `<repo>/resources/whisper/` | `<install>\resources\whisper\` (`extraResources`) |
| Model bin | `<repo>/resources/models/` | `<install>\resources\models\` (`extraResources`) |
| uiohook native `.node` | `node_modules` (resolved normally) | `app.asar.unpacked` via `asarUnpack` — native modules can't load from inside an asar |
| Settings JSON | `%APPDATA%\Murmur\settings.json` | same |
| Temp WAVs | `%TEMP%\murmur\last.wav` (latest utterance, kept for inspection) | same |

`whisper-cli.exe` needs its DLLs beside it. The whisper.cpp release zip keeps them in a `Release/` folder; its contents are flattened into `resources/whisper/` so dev and packaged layouts match.

A single path helper (`getResourcePath(...)` in `src/main/app/paths.ts`) tests `app.isPackaged` so dev and installed behavior stay aligned; nothing hardcodes a drive or repo path.

The exact installed path (per-user install is the default) is confirmed when the installer config is built in phase 9.

---

## 10. Windows-specific gotcha list (from project experience)

1. **UIPI / elevated targets** — synthetic input is blocked into admin windows (section 7). Graceful UX note, not a code fix.
2. **Key auto-repeat** — holding a key re-sends keydown at ~30 Hz. The hotkey layer treats "keydown already active" as a no-op.
3. **Focus discipline** — synthesized Ctrl+V goes to whatever is focused; every Murmur window must neither grab focus (`focusable:false` for the overlay, `showInactive` for updates) nor block the target.
4. **Mic privacy toggle** — Windows Settings can deny desktop apps microphone access; `getUserMedia` then fails. Detectable and must produce a pointer to `Settings → Privacy & security → Microphone`.
5. **Warm mic indicator** — Windows shows a mic-in-use badge while our stream is open. **Decided: keep the mic warm** (first-word latency beats hiding the badge; see section 12).
6. **DPI** — the overlay must position correctly on multi-monitor, mixed-scale setups.
7. **Hidden window throttling** — `backgroundThrottling: false` or audio capture stalls; `autoplayPolicy: 'no-user-gesture-required'` or the hidden `AudioContext` stays suspended.
8. **AudioContext rate** — a 16 kHz context is supported on Windows, but if Chromium ever ignores the request the worklet would record at the wrong rate. `createPipeline` checks `context.sampleRate` and fails with a clear error instead of writing a mislabelled WAV.
9. **Tray-only lifecycle** — `window-all-closed` must **not** quit; only the tray Quit does. `before-quit` prevents the immediate exit, stops the hook, and awaits `dictation.dispose()` (recorder teardown, whisper cancellation, snapshot cleanup) before quitting for real.
10. **AV/SmartScreen** — hooks + clipboard + unsigned installer is a heuristic trifecta; expected, handled in phases 9/10.
11. **Per-user install default** — no admin rights needed; avoids most corporate and permission pitfalls.

## 11. Security posture

- Renderers sandboxed: no `nodeIntegration`, context isolation on, no remote origins, a minimal CSP for the static overlay/settings pages. The recorder page additionally allows `blob:` scripts because its `AudioWorklet` source is installed from a Blob URL; that code is bundled into the app, never fetched.
- Media permission is granted only to the recorder window, audio only; all other permission requests are denied. IPC payloads are validated again in main, and recorder messages must come from that window's `webContents`.
- The preload layer is the attack boundary: named functions only; main validates every payload.
- File touches confined to: temp WAVs (`last.wav` plus phase-4 snapshots deleted in `finally`), settings JSON, log files; nothing else on disk.
- No network at runtime — the whisper model and `whisper-cli.exe` are pinned, checksum-verified downloads at build time. Dependencies are audited for phone-home behavior before adoption.

## 12. Open decisions

Tracks with AGENTS.md §Open decisions; summary with the architectural angle:

1. **Default hotkey + modifier combos** (phase 2) — default is hold **F9** (decided). The config supports modifiers (`Ctrl+Space`), and the phase-7 settings window now captures them through the same validator; the default remains a single key because it is the simplest bind.
2. **Warm vs. cold mic** (phase 3) — **decided: warm.** The stream and AudioWorklet stay open for the app lifetime, so key-down only opens a gate and the first word is preserved. The OS mic-in-use indicator is the accepted trade-off; key-down → first captured sample is now a few milliseconds rather than a device-open round trip.
3. **Minimum utterance length / tap behavior** (phases 2/5) — **decided: 300 ms.** Shorter holds are discarded as taps after a brief recording pulse; no error is shown. Actual insertion will honour the decision in phase 5.
4. **Sound cues & confirmation flash** (phases 6/7) — audible feedback keys off user tolerance.
5. **Hotkey while the settings window is focused** (phase 7) — current build keeps the hotkey live so a hold is never silently lost, and the inserter's own-window guard refuses to paste the transcript back into Murmur. Fully ignoring the hotkey while Settings is focused remains possible if the owner prefers it.
6. **Adaptive clipboard-restore delay** (phase 8) — fixed 350 ms is simple; adaptive adds complexity and possible edge cases.
