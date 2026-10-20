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
| Tray | `src/main/app/tray.ts` | Icon + menu: Settings, Start with Windows (toggle), Quit. Tray apps have no taskbar button, so the tray is the only visible surface between utterances. |
| Hotkey | `src/main/hotkey.ts` | uiohook-napi *listener* (keydown/keyup with keycodes — not Electron shortcuts) plus the *simulator* used for the final Ctrl+V tap. Runs in main so a hung renderer can't lose keyboard tracking. |
| Dictation state machine | `src/main/dictation.ts` | The single owner of "what is happening right now" (section 5). All windows are told state changes through IPC. |
| Transcriber | `src/main/transcriber.ts` | Writes the WAV to `%TEMP%`, spawns `whisper-cli.exe`, parses stdout, kills on timeout, cleans up in `finally`. Strictly one process at a time; new utterances queue FIFO so insertion order matches speaking order. |
| Paster | `src/main/paster.ts` | Clipboard save/set/restore + Ctrl+V simulation. Sequencing rules in section 7. |
| Settings | `src/main/settings.ts` | JSON at `%APPDATA%\Murmur\settings.json`. Load with per-key validation + defaults; save debounced and atomically (write temp file, rename). Schema in section 8. |
| Windows | `src/main/windows/*.ts` | Factories for the three windows (section 3). |
| Misc OS glue | — | `powerMonitor` (cancel recording on sleep/lock), `app.setLoginItemSettings` for start-with-Windows, `app.getPath('temp')` for WAV scratch space. |

**Windows-specific:** low-level keyboard hooks + clipboard writes + spawning an unsigned local exe is a pattern heuristic antivirus sometimes dislikes. Murmur does nothing secretly — if AV flags it, the fix is honest: document it, and consider code signing at release time.

---

## 3. Windows

Three renderer windows. Only one is ever visible.

### 3.1 Hidden recorder window (the microphone)

A borderless BrowserWindow created once at startup and kept for the app's lifetime, with:

- `show: false` — never visible; it exists so `getUserMedia` has a page to live in.
- `backgroundThrottling: false` — Windows would otherwise throttle timers/audio in a hidden page, garbling capture.
- `autoplayPolicy: 'no-user-gesture-required'` — `AudioContext` starts suspended without a user gesture; a hidden window has none, so this flag is required or the first utterance is silent.
- `contextIsolation: true`, `nodeIntegration: false`, minimal preload with exactly four operations: `begin`, `finish`, `sendAudio`, and `reportError`.

Capture pipeline (all inside this renderer):

1. `navigator.mediaDevices.getUserMedia({ audio: ... })` once at startup. **Keeping the stream open (warm mic)** means key-down → recording instantly. The cost: Windows shows a "mic in use" indicator whenever Murmur runs. This trade-off is an owned open decision (AGENTS.md, decision pending) — revisit if it bothers users.
2. An `AudioWorklet` pulls successive chunks of native-rate audio (usually 48 kHz), mixes to mono, downsamples to 16 kHz with plain decimation, converts `float32 → int16`, and appends to a growing buffer capped at the max hold length (audio is discarded beyond the cap).
3. On `finish`, the buffer is wrapped with a 44-byte RIFF/WAV header (16 kHz, 1 channel, 16-bit PCM = 32 KB/s) and the whole `ArrayBuffer` is posted to main via IPC (structured clone handles binary fine — no base64).

Failure modes surface as `dictation:capture-error` (no device, device busy, Windows microphone privacy setting off — the last is a per-OS toggle many users hit, and the message should point to it).

### 3.2 Overlay window (status & feedback)

Tiny, dismissed-in-one-glance, and — critically — **never focusable**:

- `transparent: true`, `frame: false`, `resizable: false`, `skipTaskbar: true`, `alwaysOnTop: 'screen-saver'`, `focusable: false`.
- Shown with `showInactive()` only; `setIgnoreMouseEvents(true, { forward: true })` so mouse input passes through to whatever is underneath.
- Positioned bottom-center of the monitor containing the keyboard-focus window; re-created/repositioned on display or DPI changes.

States it renders: hidden (idle) → **recording** (soft pulse, starts within ~100 ms of key-down) → **transcribing** (small spinner) → **pasting** (near-instant, may skip) → brief confirmation, or an **error** message ("microphone blocked — check Windows settings", "transcription failed", etc.). Idle return auto-hides it. It never shows transcribed text by default; that is baked into the target app's text field, which is confirmation enough.

### 3.3 Settings window

The only *normal* window, and the only one allowed to take focus. Standard frame, React page, singleton (reuse instead of creating twice). Opened from the tray; closing destroys it (recreated on demand). Because it can hold focus, the hotkey handler applies a state guard while it's focused (whether to fully ignore the hotkey then is an open decision in phase 7) — otherwise dictated text would be pasted into Murmur itself.

---

## 4. IPC

Principles:

- Channels and payload types are declared once in `src/shared/ipc.ts` and imported by main, preload, and renderers. The channel-name strings exist nowhere else.
- Each preload exposes a small, named API object for its window (`window.murmur = { begin(), finish(), sendAudio(buf), onState(cb) }`), never a raw `ipcRenderer` that could send arbitrary channels.
- Main validates every incoming payload at runtime (string length, whitelisted enum values, numeric ranges) — a renderer bug or compromise must not be able to corrupt settings or run whisper with attacker-controlled paths.

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `dictation:begin` | main → recorder | `{ sessionId }` | hotkey pressed: switch mic pipeline to "capturing" |
| `dictation:finish` | main → recorder | `{ sessionId }` | hotkey released: stop capturing, encode WAV |
| `dictation:audio` | recorder → main | `{ sessionId, wav: ArrayBuffer, durationMs }` | deliver the complete utterance |
| `dictation:capture-error` | recorder → main | `{ sessionId, code, message }` | mic/stream failure |
| `overlay:state` | main → overlay | `{ state, detail? }` | render the current status |
| `settings:get` | settings → main (invoke) | — | current settings snapshot |
| `settings:set` | settings → main (invoke) | partial settings (validated) | save changed fields |
| `settings:changed` | main → settings/overlay | full snapshot | push updates (e.g. hotkey changed) |

Everything else — spawning whisper, clipboard operations, writing temp files — is main-process-only and never crosses IPC. The recorder knows nothing about whisper; main is the only component that knows the whole pipeline.

---

## 5. The dictation state machine

One state at a time, owned by `dictation.ts`. Guards make confusion impossible: pressing the hotkey while already recording does nothing; releasing without the mic running does nothing; a transcription is never inserted twice.

| State | Entered by | Leaves to |
|---|---|---|
| `idle` | app start; after insert or error | `recording` (hotkey down) |
| `recording` | keydown + renderer started capturing OK | `transcribing` (keyup) · `idle` (capture error, or tap shorter than minimum length → discard) · auto-finish at max hold cap |
| `transcribing` | WAV arrived from recorder | `pasting` (non-empty text) · `idle` (empty/failed → error shown) |
| `pasting` | valid text ready | `idle` (pasted & clipboard restored, or error shown) |
| `error` | any failure (message shown in overlay) | `idle` (next keypress) |

Guards: FIFO — one utterance transcribes/pastes at a time; recording the next utterance proceeds immediately in parallel (capture is in the renderer; whisper runs in main/child process), outputs stay in speech order.

---

## 6. Data flow — one utterance, end to end

1. Murmur sits in the tray; uiohook listener armed; the recorder already has a warm mic stream; the overlay is hidden. The target app (say, a browser) has keyboard focus — Murmur never took it.
2. The user holds the hotkey anywhere in Windows. uiohook fires keydown **in the main process**; auto-repeat re-fires are filtered (same key, still no keyup).
3. Main bumps `sessionId` and sends `dictation:begin` to the recorder; the overlay switches to "recording" within ~100 ms.
4. The recorder's worklet pulls chunks, downmixes to mono, downsample 48 kHz→16 kHz, converts to Int16, and appends to the utterance buffer.
5. The user releases the key → uiohook keyup → main sends `dictation:finish`.
6. The recorder finalizes the buffer: 44-byte RIFF header + PCM data. Sends `dictation:audio` (ArrayBuffer) to main. Overlay shows "transcribing…".
7. Main writes `%TEMP%\murmur-<sessionId>.wav` and spawns: `whisper-cli.exe -m <model> -f <wav> -l en -nt -np -t <threads>`.
8. Main reads stdout: plain-text lines (timestamps suppressed via `-nt`), joined with single spaces and trimmed. Timeout ≈ 10 s + 4× clip duration; `whisper-cli.exe` is killed and temp deleted if it overruns. Non-zero exit → error path.
9. Non-empty text → state `pasting` (section 7). Empty text → "nothing heard" state; the window is returned to `idle` quietly.
10. After paste + clipboard restore, the temp WAV is deleted (`finally` — deletion happens even on failure).
11. If the user spoke again meanwhile, the queue processes the next `sessionId`.
12. Overlay flashes a brief confirmation (optional, open decision) and hides; state `idle`.

Model note: `ggml-base.en.bin` (~142 MB, English-only base model) ships with the app under `resources/models/`. It is **never committed** to the repo; the build fetches it from the whisper.cpp releases and the README documents that step. English-only is intentional for the first release.

---

## 7. Text insertion sequence (`paster.ts`)

Why paste instead of synthetic typing? Because typed Unicode production from a hook is fragile (dead keys, layout differences, focus flicker), and Ctrl+V pastes multi-line text exactly.

1. **Save:** `original = clipboard.readText()` (text only; see Limitations below).
2. **Set:** `clipboard.writeText(transcribedText)` — Electron's clipboard API.
3. **Tap:** uiohook-napi `keyTap(V, [Ctrl])` sends a synthetic Ctrl+V. The focused app — which is still the target app, since Murmur never steals focus — receives the paste and inserts our text at its caret.
4. **Restore:** wait `pasteRestoreDelayMs` (default ~350 ms), then `clipboard.writeText(original)`.

Why the delay? Windows apps don't necessarily read the clipboard the instant the keystroke arrives — some (Word, Excel, RDP sessions) read it a moment *later*. Restoring too early means the target pastes the *old* clipboard right after we've restored it. The delay is the known race; whether to make it adaptive is an open decision (phase 8).

**Why not send WM_PASTE / use other insertion APIs?** There is no universal programmatic "insert here" API into arbitrary windows — the synthetic keystroke is the reliable lowest common denominator.

**Known limitations (documented, not bugs):**
- **Apps running as Administrator** ignore synthetic input from user-level processes (Windows UIPI — a security boundary between integrity levels). Dictation into an elevated window silently does nothing unless Murmur itself is elevated. We can't fix it in-app; the overlay will say so (phase 8), and the README documents it.
- **The clipboard is borrowed.** Non-text clipboard content (images, file lists, rich formatting) isn't round-tripped by the initial version — it's saved/restored as text where possible and otherwise lost during the insert window (a fraction of a second). Preserving richer formats is a phase 8 stretch goal.
- **If the user copies something during the restore delay**, their copy may be overwritten by our restore. The window is small; logging/UX mitigation deferred to phase 8.

---

## 8. Settings (`%APPDATA%\Murmur\settings.json`)

Written atomically (temp file + rename), debounced, with a `schemaVersion` for future migrations. Reads go through a per-key whitelist: unknown keys are dropped, wrong types fall back to defaults. A corrupt file must never stop the app from starting — worst case the app runs on defaults and overwrites on the next save.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `schemaVersion` | `number` | `1` | migration marker |
| `hotkey` | `string` | *(decided phase 2)* | primary push-to-talk key |
| `hotkeyModifiers` | `string[]` | `[]` | optional combos, if we allow them (open decision) |
| `minUtteranceMs` | `number` | `300` | ignore taps shorter than this |
| `maxUtteranceMs` | `number` | `120000` | auto-stop cap |
| `modelPath` | `string` | `null` | override the bundled base.en model |
| `threads` | `number` | `0` | whisper threads; `0` = auto (logical cores − 1, min 2) |
| `autostart` | `boolean` | `false` | start with Windows (`app.setLoginItemSettings`) |
| `overlay` | `object` | `{ position: 'bottom-center' }` | overlay placement / visibility |
| `sounds` | `boolean` | `false` | start/stop sound cues (open decision) |
| `pasteRestoreDelayMs` | `number` | `350` | delay before clipboard restore |

---

## 9. Where files live (dev vs. installed)

| What | In dev (`npm run dev`) | Installed |
|---|---|---|
| App code | bundled by electron-vite in memory/out dir | `%LOCALAPPDATA%\Programs\Murmur\` inside `app.asar` |
| `whisper-cli.exe` | `<repo>/resources/whisper/` | `<install>\resources\whisper\` (`extraResources`) |
| Model bin | `<repo>/resources/models/` | `<install>\resources\models\` (`extraResources`) |
| uiohook native `.node` | `node_modules` (resolved normally) | `app.asar.unpacked` via `asarUnpack` — native modules can't load from inside an asar |
| Settings JSON | `%APPDATA%\Murmur\settings.json` | same |
| Temp WAVs | `%TEMP%\murmur-*.wav`, deleted after use | same |

A single path helper (`getBundledResource('models/ggml-base.en.bin')` style) tests `app.isPackaged` so dev and installed behavior stay aligned; nothing hardcodes a drive or repo path.

The exact installed path (per-user install is the default) is confirmed when the installer config is built in phase 9.

---

## 10. Windows-specific gotcha list (from project experience)

1. **UIPI / elevated targets** — synthetic input is blocked into admin windows (section 7). Graceful UX note, not a code fix.
2. **Key auto-repeat** — holding a key re-sends keydown at ~30 Hz. The hotkey layer treats "keydown already active" as a no-op.
3. **Focus discipline** — synthesized Ctrl+V goes to whatever is focused; every Murmur window must neither grab focus (`focusable:false` for the overlay, `showInactive` for updates) nor block the target.
4. **Mic privacy toggle** — Windows Settings can deny desktop apps microphone access; `getUserMedia` then fails. Detectable and must produce a pointer to `Settings → Privacy & security → Microphone`.
5. **Warm mic indicator** — Windows shows a mic-in-use badge while our stream is open. Known trade-off (open decision).
6. **DPI** — the overlay must position correctly on multi-monitor, mixed-scale setups.
7. **Hidden window throttling** — backgroundThrottling off or audio capture stalls.
8. **Tray-only lifecycle** — `window-all-closed` must **not** quit; only the tray Quit does. Also relevant:  `before-quit` must stop hooks, mic, and whisper cleanly.
9. **AV/SmartScreen** — hooks + clipboard + unsigned installer is a heuristic trifecta; expected, handled in phases 9/10.
10. **Per-user install default** — no admin rights needed; avoids most corporate and permission pitfalls.

## 11. Security posture

- Renderers sandboxed: no `nodeIntegration`, context isolation on, no remote origins, a minimal CSP for the static overlay/settings pages.
- The preload layer is the attack boundary: named functions only; main validates every payload.
- File touches confined to: temp WAVs (deleted in `finally`), settings JSON, log files; nothing else on disk.
- No network at runtime — the whisper model and `whisper-cli.exe` are pinned, checksum-verified downloads at build time. Dependencies are audited for phone-home behavior before adoption.

## 12. Open decisions

Tracks with AGENTS.md §Open decisions; summary with the architectural angle:

1. **Default hotkey + modifier combos** (phase 2) — a single rarely-used key is simplest; combos reduce collision risk but complicate keyup semantics.
2. **Warm vs. cold mic** (phase 3) — latency vs. the OS mic indicator; measured numbers wanted before deciding.
3. **Minimum utterance length / tap behavior** (phases 2/5) — discard-vs-insert threshold, plus good error feedback for sub-taps.
4. **Sound cues & confirmation flash** (phases 6/7) — audible feedback keys off user tolerance.
5. **Hotkey while the settings window is focused** (phase 7) — ignore (safe) vs. allow (pasting into Murmur's own fields).
6. **Adaptive clipboard-restore delay** (phase 8) — fixed 350 ms is simple; adaptive adds complexity and possible edge cases.
