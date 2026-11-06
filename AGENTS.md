# AGENTS.md — working rules for Murmur

**Murmur** is a free, open-source Windows push-to-talk dictation app: hold a hotkey anywhere in Windows, speak, release, and the transcribed text is inserted at the cursor of whatever app is focused (like Wispr Flow, but fully local).

This file is the working agreement for anyone (human or AI agent) writing code in this repo. Read it together with [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) before changing anything.

> Naming note: the product name is now **Redflow** (formerly Murmur). The repository folder is `RedFlow`. Historical status notes below keep the old name "Murmur" on purpose; do not rewrite them. Some internal identifiers intentionally stay as they are, see "Naming (Redflow)" in the UI redesign track.

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
| 9 | Installer (NSIS) | ✓ done |
| 10 | Release | ◐ in progress |
| 0.1 | UI: audit + contract | ✓ done |
| 0.2 | UI: rebrand to Redflow | ◐ awaiting owner check |
| 0.3 | UI: design system foundation | ◐ awaiting owner check |
| 0.4 | UI: app shell (sidebar + sections) | ◐ awaiting owner check |
| 0.5 | UI: core controls | ◐ awaiting owner check |
| 0.6 | UI: section polish + motion | ◐ awaiting owner check |
| 0.7 | UI: overlay alignment (optional) | ◐ awaiting owner check |
| 0.8 | UI: final QA | ☐ not started |

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
- [x] x64 NSIS config, product name Murmur, icons, per-user install (no admin required), Start Menu shortcut, desktop shortcut optional.
- [x] Packaging verified: `app.asar` for code; uiohook's native `.node` unpacked via `asarUnpack`; `whisper-cli.exe` + model shipped as `extraResources`; correct path resolution when installed vs. dev.
- [x] Install → run → dictate → uninstall tested with the installer alone; settings folder and leftover files handled sensibly. (Verified on the dev Windows 11 host from a folder containing only `Murmur-Setup-0.1.0.exe`, with a sanitized `PATH`/`TEMP`: no UAC, both shortcuts, installed-layout dictation, and uninstall behavior all passed. A separate clean Windows 10/11 machine was not available; the owner accepted this validation instead.)
- [x] Upgrade install (run installer over previous version) works without losing `settings.json`. (Verified 0.1.0 → 0.1.1 on the dev Windows 11 machine: the settings file stayed byte-identical and the uninstall entry updated to 0.1.1.)
- **Done when:** the produced `.exe` installer works end-to-end on a machine that has only the installer (no dev tools).

> Phase 9 status: **done.** `npm run dist:win` builds `dist\Murmur-Setup-0.1.0.exe` from `electron-builder.yml`: x64, assisted (not one-click) NSIS, per-user with no elevation, user-selectable install folder, Start Menu and desktop shortcuts, and the requested `Murmur-Setup-<version>.exe` artifact name. `app.asar` holds only the compiled `out` bundles plus `package.json`; `uiohook-napi` (including `prebuilds\win32-x64\uiohook-napi.node`) is unpacked under `app.asar.unpacked`; `resources/whisper`, `resources/models`, and `resources/icons` ship through `extraResources` and resolve through `process.resourcesPath` in the installed layout. Verified on the dev Windows 11 machine: install from an **installer-only** folder (no adjacent build files), then launch with a sanitized `PATH`/`TEMP` that excluded the repo and dev tools; the installed app used Chromium fake audio to dictate a 6.2 s utterance, transcribed it in ~2.7–3.0 s, and pasted the text into a separate Electron target; `last.wav` landed in the sanitized TEMP. A true 0.1.0 → 0.1.1 upgrade kept `settings.json` byte-identical, kept both shortcuts, updated the uninstall entry, and the upgraded app read the sentinel F10 binding. Uninstall preserved `%APPDATA%\Murmur` and removed the install folder, both shortcuts, and the registry entry; uninstall while the app was running completed in ~10 s after closing the app. The original user settings were backed up before testing and restored byte-identically afterwards. Clean-machine install → dictate → uninstall on separate Windows 10/11 machines (including SmartScreen/AV) was not run: this host is Windows 11 Home Single Language with no Windows Sandbox, Hyper-V, or VM software and no elevated session. The owner waived that validation and accepted the installer-only, sanitized-environment test instead.

### Phase 10 — Release
- [ ] Version bump, changelog, git tag; GitHub Release with the installer + checksum file.
- [x] README finalized: install steps, build from source, model download, troubleshooting (mic privacy, hotkey conflicts, admin apps).
- [x] License (MIT) + third-party notices (whisper.cpp, uiohook, Electron).
- [ ] Documented policy for settings migrations between versions.
- **Done when:** a person with no dev tools can download, install, and use Murmur from the release page.

> Phase 10 status: **in progress.** `README.md` now covers install, usage,
> SmartScreen, privacy, troubleshooting, and building from source; `LICENSE`
> (MIT) and `THIRD_PARTY_NOTICES.md` are in place. Remaining before release:
> version bump, changelog, tag, GitHub Release with the installer + checksum,
> and the documented settings-migration policy.

---

## Open decisions

Owned decisions are listed above. These still need the owner's answer when their phase arrives (details in `docs/ARCHITECTURE.md → Open decisions`):

1. Default hotkey key, and whether rebinding allows modifier combos (phase 2). **Default decided: hold F9.** The settings window now captures bare keys and modifier combos through the same validator, so `Ctrl+Space`-style bindings are exposed in the UI.
2. Mic warm (stream always open, Win11 shows a mic indicator) vs. cold (open per utterance) (phase 3). **Decided: warm.** The stream and worklet stay open for the app lifetime so key-down flips a flag instead of opening a device; that is what keeps the first word from being cut. Trade-off: Windows shows the mic-in-use indicator while Murmur runs.
3. Minimum utterance length before we insert anything, and how quick taps behave (phases 2/5). **Decided: 300 ms.** F9 still shows the recording state immediately; a hold shorter than 300 ms is discarded as a tap (no insertion, no error). `dictation.ts` owns the guard; phase 5 honours it before insertion.
4. Sound cues for start/stop, and the "inserted" confirmation (phases 6/7). **Still open.** The overlay confirmation ships, but audible cues are not implemented or exposed in settings yet.
5. Hotkey ignored while Murmur's own settings window is focused? (phase 7). **Current behavior:** the hotkey stays live so a hold is not lost, and the inserter refuses to paste into any focused Murmur window. Fully ignoring the hotkey while Settings is focused remains possible if the owner prefers it.
6. Adaptive vs. fixed clipboard-restore delay (phase 8). **Decided: fixed 350 ms.** 0 ms is racy (it pasted the old sentinel in two runs and the transcript in one); 350 ms, 1 s, and 5 s all passed. The elevated/unknown fallback skips restore entirely so the transcript stays available for a manual Ctrl+V.

## UI redesign track (Phases 0.1–0.8)

Scope: redesign the look and interaction of the Settings window (`src/renderer/settings`) and rebrand Murmur → Redflow wherever the user sees the name. Nothing else. Branch: `ui-redesign`. These phases are independent of phases 1–10; do not touch their checklists or status notes.

### UI rules (U1–U10)

1. **U1 UI-only.** Do not change behavior, IPC channels or payloads (`src/shared/ipc.ts`), preload, hotkey, audio, whisper, insertion, settings schema/storage, or the dictation state machine. The only allowed edits outside the renderer are: (a) visible strings and icon file references in main code and `electron-builder.yml`; (b) these BrowserWindow constructor options of the settings window only: `backgroundColor`, `width`, `height`, `minWidth`, `minHeight`, `autoHideMenuBar`, `title`, `icon`. Anything else: stop and ask the owner.
2. **U2 No new dependencies**, runtime or dev (no Tailwind, CSS-in-JS, icon libraries, animation libraries, font packages). Use plain CSS files, React, and inline SVG components. Fonts are the Windows system stack. No CDN assets, no network (fixed decision 5).
3. **U3 Keep logic intact.** Keep existing React state, hooks and handlers. JSX may be restructured for layout, but props and functions used by logic keep their names and behavior. All five sections stay mounted at all times and are shown/hidden with the `hidden` attribute, so hotkey capture, the mic test and any subscriptions never unmount when navigating.
4. **U4 Native controls underneath.** Switches stay real `input type="checkbox"`, dropdowns stay real `select`, actions stay real `button`. No custom listbox or fake controls.
5. **U5 CSS organization.** Shared tokens in `src/renderer/shared/styles/tokens.css`. Settings styles in `src/renderer/settings/styles/` (`base.css`, `layout.css`, `components.css`; split further when a file nears 250 lines). All colors, spacing, radii, shadows and motion come from CSS custom properties prefixed `--rf-`. No hard-coded hex values outside `tokens.css`. Remove old styles only when proven unreferenced.
6. **U6 CSP.** Do not loosen the Content-Security-Policy. Check the settings HTML first. Do not use `data:` URIs or inline `style` attributes if the CSP blocks them; use inline SVG elements and CSS classes.
7. **U7 Code quality rules still apply.** Strict TypeScript, no `any`, ESLint and Prettier clean. One component per file in `src/renderer/settings/components/`, soft limit ~250 lines per file.
8. **U8 Accessibility.** WCAG 2.2 AA: text contrast ≥ 4.5:1, UI component contrast ≥ 3:1, visible `:focus-visible` ring, full keyboard operability, `prefers-reduced-motion` respected, state never conveyed by color alone, interactive targets ≥ 32×32 px.
9. **U9 Verification after every phase.** `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, `npm test` must all pass; report the output. Do not edit `README.md`. Items that need a real Windows check stay unticked under "Owner to verify" until the owner confirms. Update `docs/ARCHITECTURE.md` (settings renderer structure only) in Phases 0.4 and 0.8.
10. **U10 Commits.** After the automated checks pass, make exactly one commit per phase on `ui-redesign` with the message `ui(0.N): <short summary>`. Do not push, switch branches, rebase, or amend.

### Naming (Redflow)

The product name is **Redflow** everywhere the user sees it: tray tooltip, window titles, settings header and footer, overlay text, installer/shortcut/product display names, installer file name (`Redflow-Setup-<version>.exe`). These legacy identifiers stay unchanged because changing them would move user data or orphan the autostart entry: repo folder `RedFlow`, `package.json` `name`/`productName`/`appId`, userData folder `%APPDATA%\Murmur`, temp folder `%TEMP%\murmur`, autostart registry value `dev.murmur.app`, IPC channel names, internal identifiers and file names that are not user-visible. Never add `app.setName` or `app.setPath('userData', …)`. If a rename would change the userData path, stop and ask the owner.

### Design system (source of truth)

Direction: "graphite + signal red". Calm, precise, Windows-native. Layered dark surfaces separated by hairline borders and lightness, not heavy shadows. Red is scarce: only active/on states, the primary button, the focus ring, listening/meter states, and the brand mark. Everything else is neutral.

Color tokens (`--rf-` prefix):

| Token | Value | Use |
|---|---|---|
| bg | #0B0B0D | window background |
| bg-sidebar | #101013 | sidebar |
| surface-1 | #141418 | cards |
| surface-2 | #1B1B21 | controls |
| surface-3 | #24242C | hover/pressed controls, switch off track |
| border-subtle | rgba(255,255,255,0.06) | row dividers |
| border | rgba(255,255,255,0.10) | card and control borders |
| border-strong | rgba(255,255,255,0.18) | hover borders |
| text | #F4F4F6 | primary text |
| text-secondary | #B4B4BE | descriptions |
| text-muted | #8B8B96 | helper text (5.4:1 on surface-1) |
| text-disabled | #5C5C66 | disabled only |
| accent | #E5484D | switch on, meter, glow, focus accents |
| accent-hover | #EC5D5E | accent hover |
| accent-solid | #D13438 | filled button background (white text 4.9:1) |
| accent-solid-hover | #C42B30 | filled button hover |
| accent-solid-pressed | #A9262A | filled button pressed |
| accent-text | #FF9592 | red text on dark, meter peak, focus ring |
| accent-soft | rgba(229,72,77,0.14) | soft red fills |
| accent-border | rgba(229,72,77,0.45) | red borders |
| accent-glow | rgba(229,72,77,0.35) | glow shadows |
| success | #3DD68C | success only |
| warning | #F5A524 | warning/overlay error only |

Other tokens: radii xs 4, sm 6, md 8 (controls), lg 12 (cards), xl 16, full 999. Spacing on a 4 px grid: 4, 8, 12, 16, 20, 24, 32, 40. Font UI: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif. Font mono: "Cascadia Mono", "Cascadia Code", Consolas, monospace. Type scale: 11 (eyebrow, uppercase, 0.08em tracking), 12 (status, chips), 13 (helper), 14 (body, labels, buttons; base size), 16 (brand), 22 (section title, weight 600, -0.01em tracking). Weights 400/500/600 only. Card shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -12px rgba(0,0,0,0.6). Motion: fast 120ms, base 180ms, slow 260ms; ease cubic-bezier(0.2, 0, 0, 1); switch knob may use cubic-bezier(0.34, 1.3, 0.64, 1). Pulse 1.6s ease-in-out infinite. `color-scheme: dark`. Atmosphere: one soft red radial glow, e.g. radial-gradient(320px 220px at 0 0, accent at 10% opacity, transparent 70%), behind the sidebar brand only; no other gradients or noise.

Layout: settings window default 940×660, minimum 780×540, `backgroundColor` = bg (no white flash), menu bar hidden, title "Redflow Settings". Sidebar 232 px wide (icon-only rail of 68 px below 820 px window width, labels kept as `aria-label` and `title`). Sidebar top: logo 32×32, "Redflow" (16/600), eyebrow "SETTINGS". Sidebar bottom: "Redflow {version}" and "Electron {version}" in text-muted 12 px, and "Changes apply instantly". Version values keep coming from wherever they come from today. Content pane: padding 40 px, max-width 680 px, scrolls internally; sidebar never scrolls. Section header: title 22/600, description 13/text-muted, 24 px below. Card: surface-1, border, radius lg, rows divided by border-subtle. Row: padding 16 px 20 px, two columns (text 1fr, control auto), gap 24, vertically centered. The text column must never be narrower than 50% of the row (this fixes the old squeezed "Input device" label). When the content pane is narrower than 560 px the control drops below its text (use a container query).

Sections and copy (labels stay as today; descriptions use this copy):
1. Dictation: "How Redflow listens and inserts your words." Hotkey: "Hold this key anywhere in Windows, speak, then release to insert your words." Trailing space: "Adds one space after each dictation so back-to-back phrases don't run together."
2. Text cleanup: "Tidy the transcript before it is inserted." Remove filler words: "Drops sounds like “um” and “uh”, including their longer spellings." Spoken commands: "Say “new line”, “new paragraph”, “period”, “comma” or “question mark” to insert line breaks and punctuation." Followed by static example chips (non-interactive) for those five phrases.
3. Microphone: "Choose and test the input Redflow listens to." Input device: "System default follows the device Windows currently uses." Test microphone: "Speak normally and watch the meter. Input device changes apply immediately."
4. Model & language: "Speech recognition runs locally on this PC." plus a small static badge "Runs locally" next to the title. Whisper model: "The .bin files found in Redflow's models folder." Language: "Auto-detect works best with a multilingual model."
5. System: "How Redflow behaves with Windows." Start with Windows: "Launch Redflow quietly in the system tray when you sign in."

Component specs:
- Switch: real checkbox, visually hidden; track 40×22, full radius. Off: surface-3 track with border, knob #C9C9D1 at left. On: accent track with soft glow, white knob at right. A small text label "On"/"Off" (12 px, text-muted) sits beside the switch. Visible focus ring.
- Select: native select, `appearance: none`, height 36, surface-2, border, radius md, padding 0 36 px 0 12 px, chevron drawn as an inline SVG sibling element with `pointer-events: none`, hover surface-3 + border-strong, min-width 220, max-width 300, option elements styled dark.
- Button: height 36, radius md, 14/500. Primary = accent-solid with white text. Secondary = surface-2 + border (used for "Change" and "Test microphone"). Hover/active/focus-visible/disabled states for each. Use whichever labels exist today.
- Keycap: min 32×32, padding 0 10 px, radius sm, mono 13/600, surface-2, border, slightly darker 2 px bottom border for key depth. A binding such as "Ctrl+Space" is split on "+" for display only, one keycap per part. Capture mode (only if the current code has this state): keycap area shows "Press a key…" with accent-soft fill, accent-border and a pulsing ring; style the existing Cancel/Escape/timeout states, do not change how capture works.
- Meter: keep the current segment count; segment 6 px wide, 3 px gap, 14 px tall, radius 2. Off = surface-3. Lit = accent; the top two segments use accent-text (peak). Transition 60 ms.
- Status label: 8 px dot + 12 px text-muted. Idle = text-disabled dot; active/listening = accent dot with pulse. Use the strings that exist today.
- Sidebar nav item: height 40, radius md, icon 18 px + label 14/500. Hover surface-2. Active = surface-2 background, text color, accent icon, and a 3 px rounded accent bar on the left edge. Focus-visible ring.
- Focus ring: 2 px accent-text with 2 px offset, on every interactive element.
- Icons: inline SVG React components in `components/icons.tsx`: 24×24 viewBox rendered at 18–20 px, stroke currentColor, stroke-width 1.75, round caps and joins. Needed: keyboard (Dictation), sparkle/wand (Text cleanup), microphone (Microphone), chip (Model & language), power (System), chevron-down.
- Section switch: new section fades in (opacity 0→1) and rises 6 px→0 over 180 ms; none under `prefers-reduced-motion`.

### Phase 0.1 — Audit + contract
- [x] Read-only audit of: `src/renderer/settings` (all files), `src/preload`, `src/shared/ipc.ts`, the settings window setup under `src/main/windows`, `src/main/settingsController.ts`, the tray code, `electron-builder.yml`, the settings HTML CSP.
- [x] Create `docs/UI_CONTRACT.md` with: component tree and file list; for every control (hotkey + Change/capture states, trailing space, filler words, spoken commands, input device, test microphone + meter + status, whisper model, language, start with Windows, version footer) the state it reads, the handler it calls and the preload function behind it; the "must not change" list (U1); current settings window options; CSP findings; and every occurrence of "Murmur" in the repo classified as visible or legacy-keep.
- [x] Run the five verification commands and record the baseline results in the contract.
- [x] No source files changed.
- **Done when:** the contract exists and `git diff` shows only `docs/UI_CONTRACT.md` and AGENTS.md.

### Phase 0.2 — Rebrand to Redflow
- [x] All visible "Murmur" strings changed to "Redflow" per "Naming (Redflow)"; legacy identifiers untouched.
- [x] `electron-builder.yml`: `productName` Redflow, shortcut names, `artifactName` `Redflow-Setup-${version}.exe`; `appId` unchanged; `package.json` `name`/`productName` unchanged.
- [x] Owner-supplied `resources/icons/redflow.ico` replaces every reference to `murmur.ico` (tray, windows, installer); the old file is deleted only after `npm run build` passes with the new references. The owner-supplied logo (`resources/icons/redflow-logo.png` or `.svg`) replaces the logo in the settings header.
- [x] No `app.setName` / `app.setPath('userData')` added.
- [x] `npm run dist:win` succeeds and produces `Redflow-Setup-<version>.exe`.
- **Owner to verify:** tray icon/tooltip and settings title say Redflow; installing over an existing Murmur build keeps the settings; after changing a setting, `%APPDATA%\Murmur\settings.json` updates and no `%APPDATA%\Redflow` folder appears.
- **Done when:** `grep -ri murmur` outside README, AGENTS.md history, docs and the legacy list finds nothing, and the owner checks pass.

### Phase 0.3 — Design system foundation
- [x] Create `tokens.css` (all tokens above), `base.css` (reset, `color-scheme: dark`, system font stack, themed thin scrollbar, selection color, global `:focus-visible` ring, `prefers-reduced-motion` rules) and import them in the settings entry.
- [x] Apply the settings window options from the Layout spec (size, min size, `backgroundColor`, `autoHideMenuBar`, `title`).
- [x] Replace the old teal/navy theme with the new tokens in all settings styles. The current layout may stay for now; everything must still function.
- **Owner to verify:** no white flash on open, no teal remains, every control still works.
- **Done when:** the window renders in the graphite theme and all behavior is unchanged.

### Phase 0.4 — App shell
- [x] Sidebar + content pane per the Layout spec, with brand block, five nav items, bottom version block, and the red glow behind the brand.
- [x] Navigation as a vertical tablist: `role="tablist"` with `aria-orientation="vertical"`, items `role="tab"` with `aria-selected` and `aria-controls`, roving `tabIndex`, ArrowUp/ArrowDown/Home/End move and activate, panels `role="tabpanel"` with `aria-labelledby`. Active section is in-memory React state only (default Dictation). All panels stay mounted (U3).
- [x] Section header (title + description) per section; System section holds Start with Windows; rows follow the Row spec, which fixes the squeezed-label bug.
- [x] Icon-only rail below 820 px.
- [x] `docs/ARCHITECTURE.md` settings renderer structure updated.
- **Owner to verify:** every control still works in all five sections; switching sections mid hotkey-capture or mid mic-test does not break either; window resize to minimum size looks right.
- **Done when:** the five sections switch with mouse and keyboard and no logic changed.

### Phase 0.5 — Core controls
- [x] Switch, Select, Button (primary/secondary), Keycap (including capture state), SettingRow and Card components per the Component specs; all states (hover, active, focus-visible, disabled).
- [x] Section descriptions and helper texts replaced with the copy above.
- **Owner to verify:** toggles persist after restart; hotkey rebind still works (including Escape, Cancel and the 15 s timeout); dropdowns still change input device, model and language.
- **Done when:** no control uses its old styling and behavior is identical.

### Phase 0.6 — Section polish + motion
- [x] Microphone: segmented meter and status label per spec, driven exactly as before; test button restyled for its existing states.
- [x] Model & language: "Runs locally" badge, model select showing file name and size as today, language select.
- [x] Text cleanup: static example chips. System: single row with header. Sidebar footer per Layout spec.
- [x] Section fade/rise transition; all pulses and transitions disabled or reduced under `prefers-reduced-motion`.
- **Owner to verify:** Test microphone moves the meter and returns to Idle when stopped; every section looks complete at 940×660 and 780×540.
- **Done when:** the window matches the design spec end to end.

### Phase 0.7 — Overlay alignment (optional)
- [x] The overlay (`src/renderer/overlay`) uses the shared tokens. Size, position, click-through, timing and states are unchanged. Recording/listening uses the accent pulse; the error state uses warning (#F5A524) with an alert icon and the same text, so errors stay distinct from the red brand/record color; "Inserted" uses success.
- **Owner to verify:** the overlay still never steals focus and all four states look right.
- **Done when:** overlay and settings share one visual language with unchanged behavior.

### Phase 0.8 — Final QA
- [ ] Contrast audit of every token pairing actually used (throwaway script, not committed), with the results table added to `docs/UI_CONTRACT.md`; fix failures by adjusting tokens only.
- [ ] Keyboard walkthrough of the whole window; `prefers-reduced-motion` check; layout check at 125% and 150% Windows scaling and at the minimum window size.
- [ ] Diff audit against the branch point: only allowed files changed (renderer settings/overlay/shared styles, the visible-string and icon edits, `electron-builder.yml`, settings window options, docs). Report any violation and revert it.
- [ ] Repo-wide search for leftover "Murmur" and old teal colors; each remaining hit justified.
- [ ] `npm run dist:win` succeeds; `docs/ARCHITECTURE.md` final; flag (do not edit) that `README.md` still says Murmur and must be updated before the Phase 10 release.
- **Owner to verify:** full regression (hotkey dictation into Notepad, rebind, every toggle, mic test, model/language, Start with Windows), installer over the previous build keeps settings, no `%APPDATA%\Redflow` folder.
- **Done when:** all boxes are verified on a real Windows machine.
