# AGENTS.md — working rules for Murmur

**Murmur** is a free, open-source Windows push-to-talk dictation app: hold a hotkey anywhere in Windows, speak, release, and the transcribed text is inserted at the cursor of whatever app is focused (like Wispr Flow, but fully local).

This file is the working agreement for anyone (human or AI agent) writing code in this repo. Read it together with [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) before changing anything.

> Naming note: the repo folder is `D:\sde\RedFlow`, but the product name is **Murmur**. Use `Murmur` for `productName`, window titles, the tray tooltip, and the settings folder name. Do not rename the repo folder.

---

## Fixed technical decisions

These were approved by the owner. **Do not change, "improve", or silently work around them.** If one turns out to be impossible or badly broken in practice, stop and ask the owner first.

| # | Decision |
|---|----------|
| 1 | Electron + TypeScript via **electron-vite**, React for the renderer UI. |
| 2 | Global hotkey (key-down / key-up) and simulated Ctrl+V via **uiohook-napi**. |
| 3 | Mic capture in a **hidden renderer window** (`getUserMedia`), encoded as **16 kHz / mono / 16-bit** WAV. |
| 4 | Transcription with local **whisper.cpp**: spawn `whisper-cli.exe` per utterance, model **ggml-base.en.bin**. |
| 5 | No cloud APIs, no API keys, no paid services — and no network calls, telemetry, or analytics at runtime. |
| 6 | Insert text: save clipboard → write our text → simulate Ctrl+V → restore the saved clipboard. |
| 7 | Settings in a JSON file in Electron `userData` (hand-rolled, no settings library). |
| 8 | Packaging with **electron-builder** (NSIS). Windows 10/11, x64 only. |

## Coding rules

1. **Strict TypeScript, no escape hatches.** `strict: true` and `noUncheckedIndexedAccess` stay on. No `any`, no `@ts-ignore`, no `as unknown as X` unless truly unavoidable and explained in a comment. ESLint (from the electron-vite scaffold) must stay clean.
2. **Small files, one job each.** Soft limit ~250 lines per file. `src/main/index.ts` stays a thin bootstrapper; features live in their own files.
3. **Minimal dependencies.** Approved runtime deps: `electron`, `uiohook-napi`, `react`, `react-dom` (React is fixed by decision #1). Everything else is dev tooling. If a file under ~50 lines does the job (WAV header, JSON settings store, small debounce), we write it ourselves instead of installing a package. Installing anything outside the approved list requires the owner's OK first.
4. **Comment Windows-specific behavior** with a `// Windows:` prefix — focus rules, UIPI, DPI, temp paths, mic privacy, etc. The comment must explain *why*, not just *what*, and must be updated when behavior changes. Grep-able, so easy to audit.
5. **Process boundaries stay hardened.** Renderers never get `nodeIntegration`, never touch the filesystem or clipboard directly, and only talk through the typed preload bridge. `contextIsolation` stays on, web security is never disabled, no remote content is ever loaded.
6. **IPC is typed.** Channel names and payload types live in `src/shared/ipc.ts`. Preload scripts expose small named functions, never a raw `ipcRenderer`.
7. **Errors are surfaced, never swallowed.** Anything that goes wrong (mic, whisper, paste) must reach the user via the overlay or the tray tooltip, plus a log entry. Every spawned process and temp file gets a `finally` cleanup.
8. **No hardcoded paths.** Use `app.getPath(...)` and a single helper for `process.resourcesPath`. Code must behave identically in `npm run dev` and in the installed app.
9. **Keep the docs honest.** Changes to IPC channels, windows, or data flow update `docs/ARCHITECTURE.md` in the same change. The "Project status" checklist below reflects reality — `[x]` only after verifying on a real Windows machine.
10. **Manual test before "done".** Murmur's real failure modes (insertion targets, mic devices, hotkey conflicts) don't show up in unit tests. Run each phase's "Done when" list for real before marking it complete. If something passes unreliably, tell the owner — don't mark it done.

## Planned project layout

```
RedFlow/
├─ AGENTS.md                    ← this file
├─ docs/
│  └─ ARCHITECTURE.md           ← system design: processes, windows, IPC, data flow
├─ electron.vite.config.ts      ← build/tooling config (phase 1)
├─ electron-builder.yml         ← installer config (phase 9)
├─ resources/                   ← static assets shipped with the app
│  ├─ icons/murmur.ico          ← tray/installer icon
│  ├─ whisper/                  ← whisper-cli.exe (downloaded, NOT committed)
│  └─ models/                   ← ggml-base.en.bin (downloaded, NOT committed)
├─ src/
│  ├─ main/                     ← main process (Node side, the "conductor")
│  │  ├─ index.ts               ← bootstrapping only
│  │  ├─ app/                   ← app lifecycle, single-instance, tray
│  │  ├─ hotkey.ts              ← uiohook-napi glue (watch keys, tap Ctrl+V)
│  │  ├─ dictation.ts           ← utterance state machine
│  │  ├─ transcriber.ts         ← whisper-cli runner + FIFO queue
│  │  ├─ paster.ts              ← clipboard save/set/restore + Ctrl+V
│  │  ├─ settings.ts            ← JSON store in userData
│  │  └─ windows/               ← recorder / overlay / settings window setup
│  ├─ preload/                  ← contextBridge scripts (tiny, typed)
│  ├─ renderer/
│  │  ├─ recorder/              ← hidden window: mic capture + WAV encoding
│  │  ├─ overlay/               ← status indicator / result / error UI
│  │  └─ settings/              ← settings window (React)
│  └─ shared/
│     └─ ipc.ts                 ← IPC channel names + payload types
└─ build/                       ← generated build output (gitignored)
```

## Commands (created in phase 1)

```
npm install        # first setup
npm run dev        # run the app during development
npm run build      # compile main/preload/renderer bundles
npm run dist:win   # build the NSIS installer (phase 9)
```

Model and `whisper-cli.exe` are fetched in phase 4 and placed under `resources/` (download steps documented in the README at that point; binaries are never committed).

---

## Project status

Keep this checklist current and truthful. Phases are done in order; a phase is "done" only when every box in it, plus its "Done when" line, is verified working on a real Windows machine. If a box can't be met, raise it with the owner instead of fudging it.

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold + tray | ◐ in progress |
| 2 | Global hotkey | ☐ not started |
| 3 | Recording (mic → WAV) | ☐ not started |
| 4 | Whisper transcription | ☐ not started |
| 5 | Text insertion | ☐ not started |
| 6 | Overlay UI | ☐ not started |
| 7 | Settings window + JSON store | ☐ not started |
| 8 | Quality & reliability | ☐ not started |
| 9 | Installer (NSIS) | ☐ not started |
| 10 | Release | ☐ not started |

### Phase 1 — Scaffold + tray
- [x] electron-vite scaffold with strict TypeScript; React renderer compiles; ESLint clean.
- [x] Folder layout matches the tree above; `src/shared/ipc.ts` exists (types only for now).
- [x] App starts with **no visible window** and lives in the system tray with a menu (Settings → placeholder, Quit).
- [x] Single-instance lock: launching a second copy does nothing harmful.
- [x] Quit (from tray) ends every process cleanly — no zombie `electron.exe`.
- [x] Bare settings store: `settings.json` is created in `userData` on first run with defaults.
- **Done when:** `npm run dev` shows the tray icon on Windows 10/11, the app survives all day in the tray, and Quit fully exits.

> Phase 1 status: implementation and dev/production smoke tests pass, and the tray **Settings** and **Quit** actions were verified manually on Windows (Quit removed the tray icon and exited cleanly). Only the all-day tray soak remains before marking the phase done.

### Phase 2 — Global hotkey
- [ ] uiohook-napi starts after app ready and stops cleanly on quit.
- [ ] Hotkey key-down / key-up detected system-wide; wired into the dictation state machine.
- [ ] Key auto-repeat while holding does **not** re-trigger start (must be filtered).
- [ ] Hook start failure (rare) logs clearly and leaves the app running without hotkey.
- [ ] Chosen key read from `settings.json`; editing the file + restart applies it.
- **Done when:** press/release of the hotkey is logged correctly from any focused app, non-hold taps are ignored, and nothing sticks in "recording" state.

### Phase 3 — Recording (mic → WAV)
- [ ] Hidden recorder window created once at startup: `show: false`, `backgroundThrottling: false`, audio autoplay unlocked.
- [ ] `getUserMedia` works; mic failure paths (no device, Windows privacy setting off) produce a clear message.
- [ ] Capture converts to **mono, 16 kHz, Int16**, accumulates frames while the key is held.
- [ ] On release: full WAV (44-byte RIFF header + 16-bit PCM) is IPC'd to main and written to `%TEMP%`.
- [ ] Decision logged: mic stream stays warm between utterances (see open decisions).
- **Done when:** a held utterance produces a valid 16 kHz mono 16-bit `.wav` in temp that plays back correctly in a media player.

### Phase 4 — Whisper transcription
- [ ] `whisper-cli.exe` + `ggml-base.en.bin` fetched into `resources/` (download doc added; not committed).
- [ ] Runner spawns one whisper-cli per utterance (`-m … -f … -l en -nt -np -t <threads>`), captures stdout, parses plain text, trims it.
- [ ] Timeouts: process killed (with temp cleanup) if it runs past a duration-based limit; non-zero exit treated as failure.
- [ ] FIFO queue: overlapping rapid utterances transcribe in order, one whisper process at a time.
- [ ] Empty or failed transcription → error state, nothing inserted.
- **Done when:** a typical 3–5 s utterance returns sensible English text in ~1–3 s on the dev machine.

### Phase 5 — Text insertion
- [ ] Sequence implemented in `paster.ts`: save clipboard text → `clipboard.writeText(text)` → simulate Ctrl+V via uiohook → restore saved text after a delay.
- [ ] Works in Notepad, VS Code, a Chrome text field, and Word — including multi-line text (Ctrl+V, not synthetic typing).
- [ ] Our own windows never receive the paste (overlay is non-focusable; state guard when the settings window is focused).
- **Done when:** dictating into each of the four test apps inserts the right text at the cursor, with the original clipboard content back afterwards.

### Phase 6 — Overlay UI
- [ ] Frameless, transparent, always-on-top window; `skipTaskbar`, never focusable (`showInactive`), click-through when idle (`setIgnoreMouseEvents`).
- [ ] States: hidden (idle), recording pulse, transcribing wait, error message, optional brief "inserted" confirmation.
- [ ] Positioned bottom-center (or per settings later); handles per-monitor DPI scaling.
- **Done when:** the full hold→speak→release loop responds within ~100 ms of key down visually, and the overlay never steals focus from the dictation target.

### Phase 7 — Settings window + JSON store
- [ ] Settings window (React), singleton, opened from tray; closing it never quits the app.
- [ ] Fields: hotkey rebind, model path override, start-with-Windows toggle, overlay position, sound cues on/off.
- [ ] Robust store: validated read with per-key whitelist + defaults, atomic writes (temp file + rename), debounced saves.
- [ ] Corrupt/missing JSON → app still starts with defaults; settings editable again.
- [ ] Applied settings take effect without restarting where feasible (hotkey at minimum after restart is acceptable if noted).
- **Done when:** every field round-trips to `settings.json` in `%APPDATA%\Murmur` and survives an app restart.

### Phase 8 — Quality & reliability
- [ ] Edge cases: rapid press-during-transcribe, press-during-paste — queue stays ordered, no double inserts.
- [ ] Max hold capped (~120 s) → auto-stop, still transcribes.
- [ ] Mic unplug / default device change mid-recording → clean error, no crash, works again next utterance.
- [ ] Sleep/lock (powerMonitor) while recording → recording cancelled safely.
- [ ] Clipboard restore timing tuned; lower user impact of elevated/admin target apps (UIPI limitation — by design of Windows, not fixable in-app).
- [ ] Persistent, rotating log file in userData; never logs audio content or transcribed text unless debug is on.
- [ ] Latency pass: warm-start time measured, whisper thread count tuned on real hardware.
- **Done when:** a full day of real use across several target apps produces no crashes, stuck states, or lost text.

### Phase 9 — Installer (electron-builder + NSIS)
- [ ] x64 NSIS config, product name Murmur, icons, per-user install (no admin required), Start Menu shortcut, desktop shortcut optional.
- [ ] Packaging verified: `app.asar` for code; uiohook's native `.node` unpacked via `asarUnpack`; `whisper-cli.exe` + model shipped as `extraResources`; correct path resolution when installed vs. dev.
- [ ] Install → run → dictate → uninstall tested on clean Windows 10 **and** Windows 11; settings folder and leftover files handled sensibly.
- [ ] Upgrade install (run installer over previous version) works without losing `settings.json`.
- **Done when:** the produced `.exe` installer works end-to-end on a machine that has only the installer (no dev tools).

### Phase 10 — Release
- [ ] Version bump, changelog, git tag; GitHub Release with the installer + checksum file.
- [ ] README finalized: install steps, build from source, model download, troubleshooting (mic privacy, hotkey conflicts, admin apps).
- [ ] License (MIT) + third-party notices (whisper.cpp, uiohook, Electron).
- [ ] Documented policy for settings migrations between versions.
- **Done when:** a person with no dev tools can download, install, and use Murmur from the release page.

---

## Open decisions

Owned decisions are listed above. These still need the owner's answer when their phase arrives (details in `docs/ARCHITECTURE.md → Open decisions`):

1. Default hotkey key, and whether rebinding allows modifier combos (phase 2).
2. Mic warm (stream always open, Win11 shows a mic indicator) vs. cold (open per utterance) (phase 3).
3. Minimum utterance length before we insert anything, and how quick taps behave (phases 2/5).
4. Sound cues for start/stop, and the "inserted" confirmation (phases 6/7).
5. Hotkey ignored while Murmur's own settings window is focused? (phase 7).
6. Adaptive vs. fixed clipboard-restore delay (phase 8).
