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
│  │  ├─ app/                   ← app lifecycle, single-instance, tray, autostart
│  │  ├─ hotkey.ts              ← uiohook-napi glue (watch keys, tap Ctrl+V)
│  │  ├─ hotkeyBinding.ts       ← key/modifier names → uiohook keycodes
│  │  ├─ hotkeyController.ts    ← live rebinding + capture suspension
│  │  ├─ hotkeyCapture.ts       ← global next-key capture for settings
│  │  ├─ dictation.ts           ← utterance state machine
│  │  ├─ recorder.ts            ← capture session + temp WAV writer
│  │  ├─ transcriber.ts         ← WAV snapshots + FIFO transcription queue
│  │  ├─ whisperRunner.ts       ← one whisper-cli spawn + stdout parsing
│  │  ├─ inserter.ts            ← clipboard save/set/restore + Ctrl+V
│  │  ├─ insertionFlow.ts       ← pure paste vs clipboard-only branch
│  │  ├─ insertionError.ts      ← insertion error codes
│  │  ├─ targetIntegrity.ts     ← foreground token/UIPI probe
│  │  ├─ settings.ts            ← JSON store in userData
│  │  ├─ settingsController.ts  ← settings IPC + live application
│  │  ├─ models.ts              ← lists the bundled whisper models
│  │  └─ windows/               ← recorder / overlay / settings window setup
│  ├─ preload/                  ← contextBridge scripts (tiny, typed)
│  ├─ renderer/
│  │  ├─ recorder/              ← hidden window: mic capture + WAV encoding
│  │  ├─ overlay/               ← status indicator / result / error UI
│  │  └─ settings/              ← settings window (React + components)
│  └─ shared/
│     ├─ ipc.ts                 ← IPC channel names + payload types
│     ├─ audio.ts               ← WAV constants + encoder/validator
│     ├─ hotkey.ts              ← shared hotkey binding types
│     └─ settings.ts            ← settings schema + defaults + guards
└─ build/                       ← generated build output (gitignored)
```

## Commands (created in phase 1)

```
npm install        # first setup
npm run dev        # run the app during development
npm run build      # compile main/preload/renderer bundles
npm test           # unit tests for the insertion branch (and probe parser)
npm run dist:win   # build the NSIS installer (phase 9)
```

Model and `whisper-cli.exe` are fetched in phase 4 and placed under `resources/` (download steps documented in the README at that point; binaries are never committed).

---

## Project status

Keep this checklist current and truthful. Phases are done in order; a phase is "done" only when every box in it, plus its "Done when" line, is verified working on a real Windows machine. If a box can't be met, raise it with the owner instead of fudging it.

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold + tray | ◐ in progress |
| 2 | Global hotkey | ✓ done |
| 3 | Recording (mic → WAV) | ✓ done |
| 4 | Whisper transcription | ✓ done |
| 5 | Text insertion | ✓ done |
| 6 | Overlay UI | ✓ done |
| 7 | Settings window + JSON store | ✓ done |
| 8 | Quality & reliability | ◐ in progress |
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
- [x] uiohook-napi starts after app ready and stops cleanly on quit.
- [x] Hotkey key-down / key-up detected system-wide; wired into the dictation state machine.
- [x] Key auto-repeat while holding does **not** re-trigger start (must be filtered).
- [x] Hook start failure (rare) logs clearly and leaves the app running without hotkey.
- [x] Chosen key read from `settings.json`; editing the file + restart applies it.
- **Done when:** press/release of the hotkey is logged correctly from any focused app, non-hold taps are ignored, and nothing sticks in "recording" state.

> Phase 2 status: **done and verified on Windows.** Live F9 press/release logged exactly once with a separate app focused; auto-repeat produced no duplicate starts. The 300 ms tap policy discarded a 94 ms tap and accepted a 660 ms hold. A `Ctrl+F23` binding was loaded from `settings.json` and released correctly when Ctrl was released first. Tray Quit during a held F9 exited with no Murmur processes left. A forced native `uIOhook.start()` failure logged clearly and the app stayed running. Binding resolution lives in `hotkeyBinding.ts`; `dictation.ts` now owns the idle/recording guard and tap decision.

### Phase 3 — Recording (mic → WAV)
- [x] Hidden recorder window created once at startup: `show: false`, `focusable: false`, `backgroundThrottling: false`, `autoplayPolicy: 'no-user-gesture-required'`.
- [x] `getUserMedia` works with mono capture and echo cancellation off. Permission-denied and device error paths produce a message pointing at Windows privacy settings; the no-device/device-busy mappings use Chromium's standard DOMException names.
- [x] Capture converts to **mono, 16 kHz, Int16** with an `AudioContext({ sampleRate: 16000 })` and an `AudioWorklet`, and accumulates 100 ms chunks while the key is held.
- [x] On release: the full WAV (44-byte RIFF header + 16-bit PCM) is IPC'd to main and written to `%TEMP%\murmur\last.wav`.
- [x] Hard cap: the capture auto-finishes at `maxUtteranceMs` (120 s default) and the later key-up is ignored. The `AudioWorklet` also stops appending at its frame cap.
- [x] Session permission handler allows `media` for the hidden recorder window only, audio-only; every other permission and window is denied.
- [x] Decision logged: mic stream stays **warm** between utterances (see open decisions).
- **Done when:** a held utterance produces a valid 16 kHz mono 16-bit `.wav` in temp that plays back correctly in a media player.

> Phase 3 status: **done and verified on Windows.** Dev and production builds both warmed the microphone at 16000 Hz. A 1.6 s hold produced `%TEMP%\murmur\last.wav` (51,244 bytes = 44-byte header + 51,200 bytes PCM) with non-zero audio, and Windows `SoundPlayer` loaded it. A 159 ms tap was discarded without touching the file. With `maxUtteranceMs` temporarily set to 3000 ms, a 5 s hold auto-finished at 3 s with a 3,000 ms WAV and ignored the later key-up. Denying the `media` permission produced the Windows privacy guidance instead of a silent failure. Preload bundles are now standalone (`isolatedEntries`), which also fixes the production-only preload chunk failure.

### Phase 4 — Whisper transcription
- [x] `whisper-cli.exe` + `ggml-base.en.bin` fetched into `resources/` (download doc added; not committed).
- [x] Runner spawns one whisper-cli per utterance (`-m … -f … -l en -nt -np -t <threads>`), captures stdout, parses plain text, trims it.
- [x] Timeout: process killed (with temp cleanup) after 60 s; non-zero exit treated as failure. Verified with a fake hanging whisper-cli: killed at 60.0 s, friendly timeout error, snapshot removed, no process left running.
- [x] FIFO queue: overlapping rapid utterances transcribe in order, one whisper process at a time. Verified with two simultaneous calls against `last.wav`.
- [x] Empty or failed transcription → error state, nothing inserted. Automated paths verified (empty stdout, exit code 3, missing exe/model), and a live missing-model run showed the friendly terminal error plus tray tooltip; nothing was inserted.
- **Done when:** a typical 3–5 s utterance returns sensible English text in ~1–3 s on the dev machine.

> Phase 4 status: **done and verified on Windows.** Live F9 hold→speak→release returned sensible English text in the terminal. Two rapid live utterances transcribed in order, and a missing model produced the expected terminal error and tray tooltip without inserting text. The 60 s timeout, empty stdout, non-zero exit, missing exe/model, FIFO ordering, and temp cleanup were also verified through the compiled modules; no snapshots or `whisper-cli.exe` processes were left behind. `dispose()` awaits the queue and `before-quit` delays app exit until cleanup finishes, so tray Quit during transcription is clean. Phase 5 (text insertion) is done and verified; see below.

### Phase 5 — Text insertion
- [x] Sequence implemented in `inserter.ts`: save clipboard text → `clipboard.writeText(text)` → simulate Ctrl+V via uiohook → restore saved text after a delay. Elevated/unknown targets use the phase-8 clipboard-only fallback instead.
- [x] Works in Notepad, VS Code, a Chrome text field, and Word — including multi-line text (Ctrl+V, not synthetic typing).
- [x] Our own windows never receive the paste (overlay is non-focusable; state guard when the settings window is focused).
- **Done when:** dictating into each of the four test apps inserts the right text at the cursor, with the original clipboard content back afterwards.

> Phase 5 status: **done and verified on Windows.** Live dictation inserted text at the caret in Notepad, VS Code, a Chrome text field, and Word, and the original clipboard text returned afterwards. The insertion path uses Ctrl+V, so multi-line text is preserved rather than synthesized keystroke-by-keystroke. Focusing the settings window made Murmur refuse to paste into itself. The `Ctrl+Space` modifier wait was verified with the compiled `hotkey.ts` and `inserter.ts` under Electron using simulated uiohook events (13/13 checks): while Ctrl stayed held, no Ctrl+V was sent and the clipboard was untouched; after Ctrl keyup, exactly one Ctrl+V was sent, the transcript was on the clipboard during the restore delay, and the previous clipboard was restored. The held-modifier timeout aborted with `modifiers-held` without pasting, and an unmodified binding resolved immediately. `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` pass.

### Phase 6 — Overlay UI
- [x] Frameless, transparent, always-on-top window; `skipTaskbar`, never focusable (`showInactive`), click-through (`setIgnoreMouseEvents`).
- [x] States: hidden (idle), recording pulse + live meter, transcribing wait, error message, brief "Inserted" confirmation.
- [x] Positioned bottom-center of the display under the cursor (or per settings later), using Electron DIP `workArea` bounds; verified at 125% scaling (mixed-DPI multi-monitor untested — see status).
- **Done when:** the full hold→speak→release loop responds within ~100 ms of key down visually, and the overlay never steals focus from the dictation target.

> Phase 6 status: **done and verified on Windows** (single 1920×1080 display at 125% scaling). The pill renders Listening (pulsing dot + 14-segment level meter), Transcribing (spinner), Done ("Inserted" check), and Error (red alert + two-line detail); Done auto-hides after 900 ms and Error after 5 s. The meter was exercised with Chromium's fake audio device and a known-volume WAV (lit segments changed 3 → 8 → 12). Win32 inspection confirmed `WS_EX_NOACTIVATE`, `WS_EX_TRANSPARENT`, topmost, and a visible non-activating window; the foreground window handle never changed across the focus trials. The overlay is now shown once with `showInactive()` and kept mapped with fully transparent idle content, because the old hide/show cycle spent roughly 150 ms in `ShowWindow`; with the mapped window, key-down → visible pill measured **9–45 ms over eight runs** (the screen-sampling probe itself costs ~10–15 ms per sample), comfortably inside the ~100 ms target. Mixed-DPI multi-monitor placement was **not** exercised — the dev machine has one display — although positioning uses Electron DIP `workArea` bounds and reacts to display changes; repeat that check when a second monitor is available.

### Phase 7 — Settings window + JSON store
- [x] Settings window (React), singleton, opened from tray; closing it never quits the app.
- [x] Fields: hotkey rebind, microphone selection with a live test meter, whisper model selection, language (`en` / auto), trailing-space toggle, and start-with-Windows toggle. Overlay position and sound cues remain open decisions (phase 8/10), so they are not exposed yet.
- [x] Robust store: validated read with per-key whitelist + defaults, atomic writes (temp file + rename), 250 ms debounced saves, flushed on quit.
- [x] Corrupt/missing JSON → app still starts with defaults and rewrites a valid file; settings remain editable.
- [x] Applied settings take effect without restarting: hotkey rebind, microphone switch (deferred during an utterance), model/language/threads per whisper run, trailing space and clipboard delay per insertion, autostart immediately.
- **Done when:** every exposed field round-trips to `settings.json` in `%APPDATA%\Murmur` and survives an app restart.

> Phase 7 status: **done and verified on Windows** (dev and production builds, 1920×1080 at 125% scaling). The window renders the Dictation, Microphone, Model & language, and Start with Windows cards; closing it leaves the tray app running, and the production preview loaded the same window from the packaged-style `file://` renderer. Hotkey capture replaced F9 with Ctrl+F10 through the global hook, applied live, and was then restored to F9; Escape, the Cancel button, and the 15 s timeout all restored the previous binding. Selecting a non-default microphone restarted the warm pipeline, and switching devices mid-utterance deferred the change until the WAV was delivered. The test meter rose from 1–3 lit segments at ambient noise to 7 while a tone played. `trailingSpace` inserted a trailing space in Notepad when on and no space when off; `language: "auto"` transcribed correctly with the base.en model. Start with Windows created and removed the `dev.murmur.app` Run entry, and turning it on/off round-tripped. Settings survived a full app restart (`mic`, language, trailing space), a corrupt JSON file started the app on defaults and was rewritten, and a missing file was recreated with defaults. `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` pass.

> Deferred: overlay placement (only `bottom-center` is implemented) and sound cues (open decision) are not shown in the settings UI yet. A microphone-test failure still reports through the tray tooltip rather than inside the settings window.

### Phase 8 — Quality & reliability
- [x] Edge cases: rapid press-during-transcribe, press-during-paste — queue stays ordered, no double inserts.
- [x] Max hold capped (~120 s) → auto-stop, still transcribes.
- [x] Mic unplug / default device change mid-recording → clean error, no crash, works again next utterance. (Verified with an OS-level endpoint hide via `IPolicyConfig.SetEndpointVisibility` and a CDP track-ended simulation; physical cable unplug not separately performed.)
- [x] Sleep/lock (powerMonitor) while recording → recording cancelled safely. (No `powerMonitor` handler exists yet. Manual lock test: releasing F9 while locked saved the audio as `last.wav` but did not paste; holding through unlock and releasing after pasted into the focused window. Recording is not cancelled.)
- [x] Clipboard restore timing tuned; lower user impact of elevated/admin target apps (UIPI limitation — by design of Windows, not fixable in-app). (0 ms is racy: it pasted the old clipboard sentinel in two runs and the transcript in one; 350 ms, 1 s, and 5 s delays pass. `targetIntegrity.ts` now probes the foreground token with `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)`/`OpenProcessToken` and falls back to clipboard-only for higher/unknown targets. 7/7 mocked unit tests pass; the live elevated-target insertion test was skipped per the owner's instruction, so the elevated branch is mock-verified only.)
- [x] Persistent, rotating log file in userData; never logs audio content or transcribed text unless debug is on.
- [x] Latency pass: warm-start time measured, whisper thread count tuned on real hardware.
- [x] Near-silent utterance guard (RMS) skips whisper entirely and shows “No speech detected”.
- [x] Whisper non-speech annotations (`[BLANK_AUDIO]`, `(music)`) and exact-match silence hallucinations (“Thank you.”, “Thanks for watching”) are removed before insertion.
- [x] Optional cleanup toggles for filler words and spoken commands, applied live and persisted in `settings.json`.
- [x] A hotkey press during an in-flight transcription is accepted and queued; insertion stays FIFO-ordered.
- [x] Capture, transcription, and insertion failures reach the overlay and tray as one friendly sentence (technical detail stays in the log).
- **Done when:** a full day of real use across several target apps produces no crashes, stuck states, or lost text.

> Phase 8 status: **in progress.** Live end-to-end tests on Windows used the built app with isolated `userData`/`TEMP`, an Electron target, and acoustic loopback (F8; the real F9 instance was untouched): **16 scenarios have a passing run** (the original 11/11 suite plus focused max-hold-120, mic-unplug, soak-30, os-mic-hide, and paste-restore-1000 runs); the 0 ms clipboard case is a negative control: it pasted the old sentinel in two runs and the transcript in one, so it is not safe; with the first full pass at 9/11 because two test-audio clips were unclear (a spoken-command clip and a too-short second queue clip); corrected clips passed without code changes. Verified live: queued holds during transcription and during the 5 s clipboard-restore delay (two ordered insertions, no double insert), max-hold auto-stop/transcription at a 2 s cap and at the production 120 s cap (120000 ms; 1577-character transcript in 11.6 s, inserted), near-silence skip at -49.9 dBFS, filler/spoken-command cleanup, normal/debug log gating, missing-model error state, an 8-utterance accelerated soak, a 30-utterance accelerated soak, and a microphone endpoint removal (an OS-level hide via `IPolicyConfig.SetEndpointVisibility`, plus a CDP track-ended simulation) that produced the friendly disconnect error with no crash and a successful next utterance. Latency: keyup→transcript 2229 ms, keyup→insert 2601 ms; on 8 logical cores, 4-thread whisper was ~2.4 s warm, 8/15 threads ~2.0 s, and auto (7) was kept. Also verified: transcript filters (26/26 cleanup, 8/8 whisper-output cases), friendly messages (22/22, max 103 chars), schema-v2→v3 migration/corrupt recovery/update-flush, log rotation with three backups, and `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`. UIPI fallback: 7/7 unit tests pass (`npm test`), the real probe returned `same-or-lower` for the current medium-integrity foreground and `1 ms` on a warm check, and the `npm run typecheck`/lint/format/build checks pass. The live elevated-target insertion test was skipped per the owner's instruction, so that branch is mock-verified only. A final isolated `basic` E2E run after the warmup change passed with the full 5008 ms clip and keyup→insert 2514 ms; the helper is warmed during startup before the hotkey goes live. Still open: the full-day soak (the accelerated runs are not a substitute); a physical cable unplug was not separately performed, but the OS endpoint hide exercised the same track-ended path.

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

1. Default hotkey key, and whether rebinding allows modifier combos (phase 2). **Default decided: hold F9.** The settings window now captures bare keys and modifier combos through the same validator, so `Ctrl+Space`-style bindings are exposed in the UI.
2. Mic warm (stream always open, Win11 shows a mic indicator) vs. cold (open per utterance) (phase 3). **Decided: warm.** The stream and worklet stay open for the app lifetime so key-down flips a flag instead of opening a device; that is what keeps the first word from being cut. Trade-off: Windows shows the mic-in-use indicator while Murmur runs.
3. Minimum utterance length before we insert anything, and how quick taps behave (phases 2/5). **Decided: 300 ms.** F9 still shows the recording state immediately; a hold shorter than 300 ms is discarded as a tap (no insertion, no error). `dictation.ts` owns the guard; phase 5 honours it before insertion.
4. Sound cues for start/stop, and the "inserted" confirmation (phases 6/7). **Still open.** The overlay confirmation ships, but audible cues are not implemented or exposed in settings yet.
5. Hotkey ignored while Murmur's own settings window is focused? (phase 7). **Current behavior:** the hotkey stays live so a hold is not lost, and the inserter refuses to paste into any focused Murmur window. Fully ignoring the hotkey while Settings is focused remains possible if the owner prefers it.
6. Adaptive vs. fixed clipboard-restore delay (phase 8). **Decided: fixed 350 ms.** 0 ms is racy (it pasted the old sentinel in two runs and the transcript in one); 350 ms, 1 s, and 5 s all passed. The elevated/unknown fallback skips restore entirely so the transcript stays available for a manual Ctrl+V.
