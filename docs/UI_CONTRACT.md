# UI contract — Settings window (Phase 0.1)

Read-only audit of the settings UI and the surfaces it depends on, written before
the Redflow redesign. This document is the baseline for Phases 0.2–0.8: it records
what exists today so the redesign can change presentation without changing behavior.

| Item | Value |
|---|---|
| Phase | 0.1 — audit + contract |
| Branch | `ui-redesign` |
| Baseline commit | `b8de08e` (`tries something with readme`) |
| Audit date | 2026-11-05 |
| Working tree at audit start | `AGENTS.md` modified (UI track text), untracked owner logo files under `resources/icons/` |
| Source changes in this phase | none — only this file and `AGENTS.md` |
| Scope | settings renderer, settings preload, settings window host, settings controller, tray entry point, settings CSP, installer metadata |

The audit was performed by reading every file listed below. No application code was
run or modified, and no settings were changed during the audit.

---

## 1. How the settings UI is wired

```
BrowserWindow (src/main/windows/settingsWindow.ts)
└─ src/renderer/settings/index.html        (CSP meta, #root)
   └─ src/renderer/settings/main.tsx       (React root, StrictMode)
      └─ src/renderer/settings/App.tsx     (all state, effects, handlers)
         ├─ components/HotkeyPicker.tsx
         ├─ components/Toggle.tsx
         └─ components/LevelMeter.tsx
            ▲
            │ window.murmur (src/preload/settings.ts, MurmurBridge)
            ▼
src/main/settingsController.ts
├─ src/main/settings.ts          (validated JSON store, %APPDATA%\Murmur)
├─ src/main/dictation.ts         (microphone list, test meter)
├─ src/main/hotkeyController.ts  (live rebind, capture suspension)
├─ src/main/app/autostart.ts     (Windows login item)
└─ src/main/models.ts            (resources/models/*.bin)
```

The renderer never touches Node, the filesystem, the clipboard, or the microphone.
Everything goes through the typed `window.murmur` bridge. Main re-validates every
payload and accepts settings calls only from the live settings window.

### 1.1 File list

| File | Role | Current notes |
|---|---|---|
| `src/renderer/settings/index.html` | Window document, CSP meta tag, `#root`, title | CSP is a `<meta http-equiv>` tag. Title is `Murmur Settings`. |
| `src/renderer/settings/main.tsx` | React entry point | Throws a developer-only error if `#root` is missing. Mounts `<App />` in `StrictMode`. |
| `src/renderer/settings/App.tsx` | The whole settings page: state, effects, all controls, footer | 473 lines; the five cards are rendered inline. This is the file Phase 0.4 will restructure. |
| `src/renderer/settings/components/HotkeyPicker.tsx` | Keycap display, Change button, capture hint, Cancel button | Splits `binding.modifiers + binding.key` into keycaps; maps a few key names to symbols. |
| `src/renderer/settings/components/Toggle.tsx` | Checkbox styled as a switch, wrapped in a `<label>` | Real `<input type="checkbox">`; the label and hint are inside the clickable row. |
| `src/renderer/settings/components/LevelMeter.tsx` | 20-segment microphone meter | `role="meter"`, `aria-valuenow` 0–1; lit segments derived from the level. |
| `src/renderer/settings/styles.css` | All current settings styles | 510 lines, teal/navy theme, `backdrop-filter`, gradients. Replaced in Phase 0.3/0.5. |
| `src/renderer/settings/env.d.ts` | Vite client types | No runtime effect. |
| `src/preload/settings.ts` | `window.murmur` bridge | Named functions only; payload guards on every subscription. |
| `src/preload/index.d.ts` | `Window.murmur` typing | — |
| `src/main/windows/settingsWindow.ts` | Window factory, singleton, sender check, push channel | Window options in section 4. |
| `src/main/settingsController.ts` | Settings IPC, live application, mic test, capture | Registers six invoke handlers; disposes them on quit. |
| `src/main/app/tray.ts` | Opens Settings from the tray menu and double-click | Menu is `Settings` / `Quit`; tooltip is a status string, currently `Idle`. |
| `src/main/ipc.ts` | `app:info` handler for the footer | Returns `app.getName()`, `app.getVersion()`, Electron version, platform. |

### 1.2 Component tree as rendered today

```
App
├─ header.masthead
│  ├─ div.mark (five decorative bars)
│  └─ div
│     ├─ p.eyebrow                 "Murmur"
│     └─ h1                        "Settings"
├─ main.settings
│  ├─ section.card                 Dictation
│  │  ├─ div.card-heading          h2 + description
│  │  ├─ div.setting-row
│  │  │  ├─ div.setting-copy       label + hint
│  │  │  └─ HotkeyPicker
│  │  │     ├─ div.hotkey-keys     one span.keycap per modifier/key
│  │  │     └─ Change button  —or—  capture hint + Cancel button
│  │  └─ Toggle                    Trailing space
│  ├─ section.card                 Text cleanup
│  │  ├─ div.card-heading
│  │  ├─ Toggle                    Remove filler words
│  │  └─ Toggle                    Spoken commands
│  ├─ section.card                 Microphone
│  │  ├─ div.card-heading
│  │  ├─ div.setting-row           label[for=microphone] + select#microphone
│  │  └─ div.setting-row.test-row
│  │     ├─ div.setting-copy
│  │     └─ div.test-controls
│  │        ├─ button              "Test microphone" / "Stop test"
│  │        ├─ LevelMeter
│  │        └─ span.test-caption    "Listening…" / "Idle" / "No microphones found"
│  ├─ section.card                 Model & language
│  │  ├─ div.card-heading
│  │  ├─ div.setting-row           label[for=model] + select#model
│  │  ├─ div.setting-row           label[for=language] + select#language
│  │  └─ p.note                     only when language === "auto"
│  └─ section.card.compact         System
│     └─ Toggle                    Start with Windows
└─ footer.status[aria-live=polite]
```

While the initial snapshot is `null`, the page renders only the masthead and a
`main.panel` containing either `Loading settings…` or
`Could not load settings: <error>`. The five cards do not exist yet in that state.

---

## 2. Renderer state and effects

| State / ref | Type | Initial | Owned by | Used by |
|---|---|---|---|---|
| `snapshot` | `SettingsSnapshot \| null` | `null` | `getSettings` + `settings:changed` + update results | every control; `null` selects the loading branch |
| `microphones` | `readonly MicrophoneDevice[]` | `[]` | initial snapshot + `settings:devices` | input-device select, missing-device option, status caption |
| `appInfo` | `AppInfo \| null` | `null` | `getAppInfo` | version footer |
| `error` | `string \| null` | `null` | load failure, save failure, capture failure, mic-test failure, `settings:error` | footer / loading panel |
| `notice` | `string \| null` | `null` | `showNotice` (`Saved`, `Hotkey unchanged`) | footer |
| `saving` | `boolean` | `false` | `applyPatch` | Change button disabled state, footer `Saving…` |
| `capturing` | `boolean` | `false` | `handleStartCapture` / `.finally` | capture UI, disables several controls |
| `testing` | `boolean` | `false` | `handleTestMicrophone` | button label/style, meter active, status caption |
| `level` | `number` | `0` | `settings:mic-level` | LevelMeter |
| `noticeTimer` | `number \| null` | `null` | `showNotice` | clears notices after 1800 ms |

Effects, in order:

1. On mount: `Promise.all([window.murmur.getSettings(), window.murmur.getAppInfo()])`;
   sets `snapshot`, `microphones`, `appInfo`; failure sets `error`.
2. On mount: subscribes to `onSettingsChanged`, `onMicrophonesChanged`, `onMicLevel`,
   `onSettingsError`; returns their unsubscribe functions.
3. On unmount: `window.murmur.stopMicTest()` — closing the window must never leave
   the recorder streaming test levels.
4. On unmount: clears a pending notice timer.

Handler behavior:

- `applyPatch(patch)`: sets `saving`, clears `error`, calls
  `window.murmur.updateSettings(patch)`. On `{ ok: true }` it replaces
  `snapshot.settings` and shows `Saved` for 1800 ms; on `{ ok: false }` it shows the
  message; a rejected promise is caught into `error`. Always clears `saving`.
- `handleStartCapture()`: sets `capturing`, clears `error`, awaits
  `window.murmur.captureHotkey()`. `null` (Escape, 15 s timeout, window close)
  shows `Hotkey unchanged`; a binding is written through `applyPatch`; a rejection
  becomes `error`. Always clears `capturing`.
- `handleCancelCapture()`: fires `window.murmur.cancelHotkeyCapture()`.
- `handleTestMicrophone()`: if testing, clears `testing` and `level`, then calls
  `stopMicTest`; otherwise sets `testing`, clears `error`, and calls `startMicTest`.
  A start failure clears `testing` and reports through `error`.

---

## 3. Control contract

Every control below is part of the current UI contract. Names in the "Renderer"
column are the actual state / handler identifiers in `App.tsx`; they must keep their
names and behavior through the redesign (U3). "Preload" is the `window.murmur`
function actually called.

| # | Control | Reads | Renderer handler | Preload / IPC | Main effect | Current states |
|---|---|---|---|---|---|---|
| 1 | Hotkey keycaps | `snapshot.settings.hotkey`, `.hotkeyModifiers` → `hotkeyBinding` → `HotkeyPicker` splits modifiers then key; `keyLabel()` maps arrows, punctuation, numpad and PgUp/PgDn/PrtSc | none (display only) | data arrived via `getSettings()` → `settings:get-state` | none | one keycap per part; capture state adds `.is-capturing` to the wrapper |
| 2 | Change button | `capturing`, `saving` | `handleStartCapture` | `captureHotkey()` → `settings:capture-hotkey` | `settingsController` checks sender, suspends the normal listener, runs `hotkey.capture()`; 300 ms arming delay, Escape / 15 s timeout / window close resolve `null` | hidden while capturing; disabled while `saving` |
| 3 | Capture hint + Cancel | `capturing` | `handleCancelCapture` | `cancelHotkeyCapture()` → `settings:cancel-hotkey-capture` | `hotkey.cancelCapture()` finishes capture with `null`; the old binding is unchanged | hint text `Press a key or combo…`; Cancel is a ghost button |
| 4 | Trailing space | `snapshot.settings.trailingSpace` | `applyPatch({ trailingSpace })` | `updateSettings` → `settings:update` | validated store; next insertion appends one space | real checkbox; not disabled during capture (only this toggle) |
| 5 | Remove filler words | `snapshot.settings.removeFillerWords` | `applyPatch({ removeFillerWords })` | `updateSettings` → `settings:update` | next transcript cleanup | disabled while `capturing` |
| 6 | Spoken commands | `snapshot.settings.spokenCommands` | `applyPatch({ spokenCommands })` | `updateSettings` → `settings:update` | next transcript cleanup | disabled while `capturing` |
| 7 | Input device | `snapshot.settings.microphoneId ?? ''` → `selectedMicrophone`; `snapshot.microphones` + pushed `microphones`; `microphoneMissing` | `applyPatch({ microphoneId: value === '' ? null : value })` | `updateSettings` → `settings:update` | `dictation.setMicrophone`; a switch during an utterance is deferred until the WAV arrives | options: `System default` (`''`), optional `Selected microphone (not detected)`, then device labels; disabled while `capturing` |
| 8 | Test microphone button | `testing`, `microphones.length` | `handleTestMicrophone` | `startMicTest()` / `stopMicTest()` → `settings:start-mic-test` / `settings:stop-mic-test` | `dictation.startMicTest` asks the recorder to open its analyser; stop clears it and sends level 0 | label `Test microphone` or `Stop test`; `.button-active` while testing; disabled while `capturing` |
| 9 | Level meter | `level` (0–1), `testing` | none (display) | `onMicLevel` → `settings:mic-level` | forwarded from the recorder's analyser at ~15 samples/s | 20 segments; `active` lit count `round(clamp(level) * 20)`; `role="meter"`, `aria-valuenow` is `level` while active else `0` |
| 10 | Meter status caption | `testing`, `microphones.length` | none (display) | none | — | `Listening…` while testing; `No microphones found` when the list is empty; `Idle` otherwise |
| 11 | Whisper model | `snapshot.settings.modelPath ?? snapshot.defaultModelFile` → `selectedModel`; `modelChoicesFor(snapshot)` uses `snapshot.models` and `snapshot.defaultModelFile` | `applyPatch({ modelPath: value === snapshot.defaultModelFile ? null : value })` | `updateSettings` → `settings:update` | next whisper run uses `-m`; `null` = bundled `ggml-base.en.bin` | options show `file — size` (KB/MB/GB), or `file (not found)` for a custom path not in the folder; disabled while `capturing` or when no choices exist |
| 12 | Language | `snapshot.settings.language` | `applyPatch({ language: value === 'auto' ? 'auto' : 'en' })` | `updateSettings` → `settings:update` | next whisper run uses `-l en` or `-l auto` | options `English` (`en`) / `Auto-detect` (`auto`); disabled while `capturing` |
| 13 | Auto-language note | `snapshot.settings.language === 'auto'` | none (display) | none | — | static note: the bundled `base.en` model is English-only; choose a multilingual model |
| 14 | Start with Windows | `snapshot.settings.autostart` | `applyPatch({ autostart })` | `updateSettings` → `settings:update` | `applyAutostart` immediately updates the Windows login item | disabled while `capturing` |
| 15 | Version footer | `appInfo.version`, `appInfo.electronVersion` | none (display) | `getAppInfo()` → `app:info` | `app.getName()` / `app.getVersion()` / `process.versions.electron` | rendered only when `appInfo !== null`; text `Murmur {version} · Electron {version} · Changes apply instantly`. `appInfo.name` is currently unused by the UI. |
| 16 | Status footer / notices | `error`, `notice`, `saving`, `appInfo` | `showNotice`, `applyPatch`, capture/test handlers | `onSettingsError` → `settings:error`; update/capture/test invokes | save failures also set the tray tooltip | priority: `error` → `notice` → `Saving…` → version line → empty; `aria-live="polite"` |
| 17 | Loading / load error | `snapshot === null`, `error` | initial effect | `getSettings()` / `getAppInfo()` | — | `Loading settings…` or `Could not load settings: {error}` in a panel; no cards mounted |

### 3.1 Current disabled-state matrix (important for U3)

| Control | `saving` | `capturing` |
|---|---|---|
| Change button | disabled | replaced by Cancel |
| Trailing space | not disabled | **not disabled** |
| Remove filler words | not disabled | disabled |
| Spoken commands | not disabled | disabled |
| Input device | not disabled | disabled |
| Test microphone | not disabled | disabled |
| Whisper model | not disabled | disabled |
| Language | not disabled | disabled |
| Start with Windows | not disabled | disabled |

The trailing-space toggle is the one deliberate asymmetry in the current code. The
redesign must preserve it unless the owner explicitly changes behavior.

### 3.2 Current layout problem to fix in Phase 0.4

`.setting-row` uses `grid-template-columns: minmax(0, 1fr) minmax(220px, auto)`. The
control column's 220 px minimum leaves the text column narrow at small widths, and
`.select { width: 100%; min-width: 0; }` resolves against that 220 px track. The
"squeezed Input device label" bug comes from this grid, not from the select itself.
The Phase 0.4 row spec (text column never below 50%, control drops below at <560 px)
replaces this rule.

---

## 4. Settings window host

`src/main/windows/settingsWindow.ts` constructs the window. Current options:

| Option | Current value | Changeable in the UI track? |
|---|---|---|
| `title` | `Murmur Settings` | yes (U1 allows `title`) |
| `width` | `780` | yes |
| `height` | `680` | yes |
| `minWidth` | `560` | yes |
| `minHeight` | `480` | yes |
| `backgroundColor` | `#0b1220` | yes |
| `autoHideMenuBar` | `true` | yes |
| `icon` | `resources/icons/murmur.ico` via `getResourcePath` | yes (visible icon reference; Phase 0.2 repoints) |
| `show` | `false`, then `show()` on `ready-to-show` | no |
| `webPreferences.preload` | `../preload/settings.js` | no |
| `webPreferences.contextIsolation` | `true` | no |
| `webPreferences.nodeIntegration` | `false` | no |
| `webPreferences.sandbox` | `true` | no |
| `webPreferences.webSecurity` | `true` | no |
| `skipTaskbar` | not set (window appears in the taskbar) | no |
| frame | default standard frame | no |

Lifecycle and guards:

- Singleton: a second `openSettingsWindow()` restores/focuses the existing window.
- Opened from the tray menu, tray double-click, or a second app launch
  (`openSettingsWhenReady` in `src/main/index.ts`).
- Closing destroys the window and leaves the tray app running; a later tray click
  creates a fresh window.
- `setWindowOpenHandler` denies every new window; `will-navigate` blocks navigation
  away from the current URL.
- Renderer console errors and failed loads are logged in main.
- Loads `${ELECTRON_RENDERER_URL}/settings/index.html` in dev, otherwise
  `out/renderer/settings/index.html`.
- All settings IPC handlers check `isSettingsWebContents(event.sender)`.

---

## 5. Preload bridge and IPC map

`src/preload/settings.ts` exposes exactly one object, `window.murmur`, typed as
`MurmurBridge` in `src/shared/ipc.ts`. It throws at load time if
`contextIsolation` is off. No raw `ipcRenderer` is exposed.

| Bridge method | Direction | Channel | Main handler | Payload / result |
|---|---|---|---|---|
| `getAppInfo()` | invoke | `app:info` | `src/main/ipc.ts` | `AppInfo` (`name`, `version`, `electronVersion`, `platform`) |
| `getSettings()` | invoke | `settings:get-state` | `settingsController.getState` | `SettingsSnapshot` (`settings`, `models`, `defaultModelFile`, `microphones`) |
| `updateSettings(patch)` | invoke | `settings:update` | `settingsController.update` | validated patch → `{ ok: true, settings }` or `{ ok: false, message }`; live-applies hotkey/mic/autostart |
| `onSettingsChanged(handler)` | subscribe | `settings:changed` | `sendSettingsChanged` | full `MurmurSettings`; guarded by `isMurmurSettings` |
| `onMicrophonesChanged(handler)` | subscribe | `settings:devices` | `sendDevices` | `{ devices }`; guarded by `isMicrophoneDeviceListPayload` |
| `onSettingsError(handler)` | subscribe | `settings:error` | save-error handler | `{ message }`; guarded by an inline payload guard |
| `onMicLevel(handler)` | subscribe | `settings:mic-level` | mic-test callback in `settingsController` | `{ level }` 0–1; guarded by `isMicLevelPayload` |
| `startMicTest()` | invoke | `settings:start-mic-test` | `settingsController.startMicTest` | starts the recorder analyser; level samples flow back on `settings:mic-level` |
| `stopMicTest()` | invoke | `settings:stop-mic-test` | `settingsController.stopMicTest` | stops the recorder analyser and sends level `0` |
| `captureHotkey()` | invoke | `settings:capture-hotkey` | `settingsController` → `hotkey.capture()` | resolves `HotkeyBinding`, or `null` on Escape / 15 s timeout / window close |
| `cancelHotkeyCapture()` | invoke | `settings:cancel-hotkey-capture` | `hotkey.cancelCapture()` | resolves the pending capture with `null` |

All invoke handlers call `assertSettingsSender(event)` first. Main validates every
settings patch in `src/main/settings.ts`; unknown keys are dropped, types are
checked, and numeric ranges are clamped. The renderer treats all pushed payloads as
untrusted through the preload guards.

---

## 6. CSP findings

`src/renderer/settings/index.html` sets:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' ws://localhost:* ws://127.0.0.1:*
```

Findings:

- `script-src 'self'` — no inline scripts, no eval, no remote scripts. Vite emits a
  hashed module script and stylesheet in `out/renderer/settings/index.html`; both are
  same-origin. The CSP survives the production build unchanged.
- `style-src 'self' 'unsafe-inline'` — inline `<style>` and `style=""` attributes
  are technically allowed. This is needed by Vite's dev HMR style injection. It does
  **not** mean the redesign should use inline styles: U5 still requires tokens and
  classes, and Phase 0.8 audits hard-coded values.
- `img-src 'self' data:` — data URIs are allowed. Do not use them for icons: U2/U6
  require inline SVG components.
- `connect-src 'self' ws://localhost:* ws://127.0.0.1:*` — the WebSocket entries are
  only for the Vite dev HMR server. The packaged app makes no network calls. Do not
  add any other origin.
- `font-src 'self'` — no remote or data fonts. The design uses the Windows system
  font stack; no font files are needed.
- There are no inline `<script>` blocks and no `data:` URIs in the current settings
  page.
- Do not loosen this policy. If a future element needs `blob:` or another source,
  stop and ask the owner.

The overlay and recorder pages have their own CSPs; the recorder additionally allows
`blob:` for its AudioWorklet. They are outside the settings redesign, except for the
optional overlay pass in Phase 0.7.

---

## 7. Must not change (U1)

The redesign may change the settings renderer's markup and CSS, visible strings,
icon file references, and these settings-window options only: `backgroundColor`,
`width`, `height`, `minWidth`, `minHeight`, `autoHideMenuBar`, `title`, `icon`.

Everything below is frozen. If a task seems to require a change here, stop and ask
the owner.

- **Behavior.** No changes to what the controls do, when they are enabled, when they
  are deferred, or what they apply live.
- **IPC contract.** `src/shared/ipc.ts` channel names, payload shapes, and guards.
  No new channels for UI state.
- **Preload.** `src/preload/settings.ts` and the `window.murmur` surface. No raw
  `ipcRenderer`, no new bridge methods.
- **Hotkey.** `src/main/hotkey.ts`, `hotkeyBinding.ts`, `hotkeyController.ts`,
  `hotkeyCapture.ts`: arming delay, Escape, 15 s timeout, capture suspension.
- **Audio/recording.** Recorder window, `getUserMedia`, AudioWorklet, WAV encoding,
  warm-stream behavior, device switching, test-monitor plumbing.
- **Whisper.** `transcriber.ts`, `whisperRunner.ts`, model listing, thread handling,
  transcript cleanup.
- **Insertion.** `inserter.ts`, `insertionFlow.ts`, `targetIntegrity.ts`, clipboard
  save/restore, Ctrl+V, UIPI fallback.
- **Settings schema/storage.** `src/shared/settings.ts`, `src/main/settings.ts`,
  validation, defaults, schema version, debounced/atomic writes.
- **Dictation state machine.** `src/main/dictation.ts` and its queue/tap/max-hold
  behavior.
- **Naming legacy identifiers.** Keep `package.json` `name`/`productName`/`appId`,
  the `%APPDATA%\Murmur` userData folder, `%TEMP%\murmur` temp folder, the
  `dev.murmur.app` autostart/AppUserModelID value, IPC channel strings, internal
  identifier/file names that are not user-visible, and the existing
  `app.setName('Murmur')` call (it pins the userData path). Never add
  `app.setPath('userData', …)`.
- **Docs outside the track.** Do not edit `README.md` (U9). `docs/ARCHITECTURE.md`
  is updated only in Phases 0.4 and 0.8, and only for the settings renderer
  structure.

Other standing rules: U2 (no dependencies), U3 (keep React state/hooks/handlers and
all five sections mounted), U4 (native checkbox/select/button), U5 (CSS files and
`--rf-` tokens), U6 (CSP unchanged), U7 (strict TypeScript, one component per file),
U8 (WCAG 2.2 AA), U9 (five checks after every phase), U10 (one commit per phase).

---

## 8. "Murmur" occurrence inventory

The inventory covers every tracked file that contains `murmur` (case-insensitive)
at baseline `b8de08e`. Counts are matching lines from `git grep -c -i murmur`.
Generated/ignored artifacts (`.test-build/`, `.eslintcache`, `out/`, `dist/`,
`build/`) are excluded; they are rebuilt from source. The owner-supplied untracked
logos under `resources/icons/` contain no product-name string.

Classification rule used here: **visible** means a string a user can see in the
shipped app or installer and that the naming rule says must say "Redflow".
**legacy-keep** means an identifier, path, log tag, comment, test/documentation
reference, or legal/package metadata that must stay as-is (or is out of scope for
this track).

### 8.1 Visible occurrences (Phase 0.2 targets)

| File | Count | Occurrences |
|---|---|---|
| `src/renderer/settings/App.tsx` | 8 of 20 | eyebrow `Murmur` (loading branch, line 208); eyebrow `Murmur` (loaded branch, line 247); `How Murmur listens and inserts text.`; `Shape the transcript before Murmur pastes it.`; `The input Murmur keeps warm between utterances.`; `The .bin files found in Murmur’s models folder.`; `Launch Murmur quietly in the system tray when you sign in.`; footer `Murmur {version} · Electron {version} · Changes apply instantly` |
| `src/renderer/settings/index.html` | 1 | `<title>Murmur Settings</title>` |
| `src/main/windows/settingsWindow.ts` | 1 of 6 | `title: 'Murmur Settings'` |
| `src/main/index.ts` | 4 of 12 | native error-box title `Murmur`; `Could not load Murmur settings.`; `Could not create the Murmur tray icon.`; `Murmur failed to start.` |
| `src/main/friendlyErrors.ts` | 13 | overlay/tray sentences: microphone guidance (`Murmur Settings` ×2, `restart Murmur`), speech-engine/model/spawn/timeout/exit messages, `Murmur log`, shutdown cancellations, `Murmur pastes`, `Murmur's own window`, generic `Murmur log` fallback |
| `src/main/transcriber.ts` | 3 of 5 | `Choose another model in Murmur Settings…`; `Transcription was cancelled because Murmur is shutting down.` (two branches) |
| `src/main/whisperRunner.ts` | 1 of 5 | `Transcription was cancelled because Murmur is shutting down.` |
| `src/renderer/recorder/main.ts` | 2 of 38 | `The microphone does not support the audio format Murmur needs.`; `The audio capture component could not start. Restart Murmur and try again.` |
| `electron-builder.yml` | 4 of 11 | `productName: Murmur`; `artifactName: Murmur-Setup-${version}.${ext}`; `shortcutName: Murmur`; `uninstallDisplayName: Murmur ${version}` |

Total visible: 37 matching lines (some lines contain more than one word occurrence).

The Phase 0.2 checklist changes these strings and the installer display names. The
hidden-window titles discussed below are deliberately **not** in this list.

### 8.2 Legacy-keep or out-of-scope occurrences

| File | Count | Class | Why |
|---|---|---|---|
| `AGENTS.md` | 26 | legacy-keep | Working agreement and historical phase notes; the naming note intentionally keeps the old name in history. |
| `README.md` | 52 | legacy-keep | U9 forbids editing it in this track; Phase 0.8 must flag it for the release, not change it now. |
| `docs/ARCHITECTURE.md` | 34 | legacy-keep | Architecture/history; only the settings renderer structure is touched in 0.4/0.8. |
| `docs/assets/hero.svg` | 1 | legacy-keep | Documentation artwork title, not shipped UI. |
| `LICENSE` | 1 | legacy-keep | Copyright holder. |
| `SECURITY.md` | 7 | legacy-keep | Policy document. |
| `THIRD_PARTY_NOTICES.md` | 6 | legacy-keep | Legal notices. |
| `package.json` | 3 | legacy-keep | `name: murmur`, `productName: Murmur` (naming rule keeps it), author. |
| `package-lock.json` | 5 | legacy-keep | Lockfile package metadata. |
| `electron-builder.yml` | 7 of 11 | legacy-keep | `appId: dev.murmur.app`, copyright holder, `murmur.ico` file paths (Phase 0.2 repoints references, then deletes the old file), `%APPDATA%\Murmur` comment. |
| `scripts/generate-hero.mjs` | 2 | legacy-keep | Dev tooling, generated docs asset title/log. |
| `scripts/generate-icon.mjs` | 5 | legacy-keep | Dev tooling that generates `murmur.ico`/`murmur.png`; file names, not UI. |
| `src/main/index.ts` | 8 of 12 | legacy-keep | `app.setName('Murmur')` (must stay: pins `%APPDATA%\Murmur`), `APP_USER_MODEL_ID = 'dev.murmur.app'`, comments and `[murmur]` logs. |
| `src/main/app/autostart.ts` | 4 | legacy-keep | Comments, `Murmur.exe` example, `[murmur]` logs. |
| `src/main/app/logger.ts` | 9 | legacy-keep | Log file name `murmur.log`, `MURMUR_DEBUG`, log header, comments. |
| `src/main/app/permissions.ts` | 1 | legacy-keep | Comment. |
| `src/main/app/singleInstance.ts` | 1 | legacy-keep | `[murmur]` log. |
| `src/main/app/tray.ts` | 2 | legacy-keep | `murmur.ico` path, `[murmur]` log. Tooltip is a status, not the product name. |
| `src/main/dictation.ts` | 15 | legacy-keep | `MurmurSettings` type, comments, `[murmur]` logs, `MURMUR_DEBUG`. |
| `src/main/hotkey.ts` | 8 | legacy-keep | `[murmur]` logs. |
| `src/main/hotkeyCapture.ts` | 5 | legacy-keep | `[murmur]` logs. |
| `src/main/inserter.ts` | 13 | legacy-keep | `hasFocusedMurmurWindow` identifier, comments, internal `InsertionError` text (the overlay uses `friendlyErrors.ts` codes instead), `[murmur]` logs. |
| `src/main/insertionFlow.ts` | 1 | legacy-keep | Comment. |
| `src/main/models.ts` | 2 | legacy-keep | `[murmur]` logs. |
| `src/main/recorder.ts` | 24 | legacy-keep | `%TEMP%\murmur` path, comments, `[murmur]` logs. |
| `src/main/settings.ts` | 18 | legacy-keep | `MurmurSettings` types, comments, `[murmur]` logs. |
| `src/main/settingsController.ts` | 7 | legacy-keep | Types, comment, `[murmur]` log, internal sender-guard message that cannot occur through the shipped UI. |
| `src/main/targetIntegrity.ts` | 9 | legacy-keep | Embedded C# class name `MurmurTargetIntegrityProbe`, `[murmur]` logs. |
| `src/main/transcriber.ts` | 2 of 5 | legacy-keep | `%TEMP%\murmur` path, `[murmur]` log. |
| `src/main/whisperRunner.ts` | 4 of 5 | legacy-keep | Comment, `[murmur]` logs. |
| `src/main/windows/overlayWindow.ts` | 8 | legacy-keep | `title: 'Murmur Overlay'` (frameless, transparent, `skipTaskbar`; the title is never rendered), `[murmur]` logs. |
| `src/main/windows/recorderWindow.ts` | 5 | legacy-keep | `title: 'Murmur Recorder'` (hidden window; never rendered), `[murmur]` logs. |
| `src/main/windows/settingsWindow.ts` | 5 of 6 | legacy-keep | `murmur.ico` path, `[murmur]` logs. |
| `src/preload/index.d.ts` | 2 | legacy-keep | `MurmurBridge`, `Window.murmur`. |
| `src/preload/overlay.d.ts` | 1 | legacy-keep | `window.murmurOverlay`. |
| `src/preload/overlay.ts` | 3 | legacy-keep | Bridge object name, context-isolation error, `window.murmurOverlay`. |
| `src/preload/recorder.d.ts` | 1 | legacy-keep | `window.murmurRecorder`. |
| `src/preload/recorder.ts` | 3 | legacy-keep | Bridge object name, context-isolation error, API name. |
| `src/preload/settings.ts` | 8 | legacy-keep | `MurmurBridge`/`MurmurSettings`/`isMurmurSettings` types, bridge object, context-isolation error, API name. |
| `src/renderer/overlay/index.html` | 1 | legacy-keep | Hidden frameless window title; never rendered. |
| `src/renderer/overlay/main.ts` | 4 | legacy-keep | Developer error, log tag, `window.murmurOverlay`. |
| `src/renderer/recorder/index.html` | 1 | legacy-keep | Hidden window title; never rendered. |
| `src/renderer/recorder/main.ts` | 36 of 38 | legacy-keep | Worklet name, comments, `[murmur recorder]` logs, `window.murmurRecorder`. |
| `src/renderer/recorder/pcm-capture.worklet.js` | 3 | legacy-keep | Comment, processor class, registered processor name. |
| `src/renderer/settings/App.tsx` | 12 of 20 | legacy-keep | `MurmurSettings` type import/annotation, `window.murmur.*` API calls. |
| `src/renderer/settings/main.tsx` | 1 | legacy-keep | Developer-only `#root` error, never normal UI. |
| `src/shared/audio.ts` | 1 | legacy-keep | Comment. |
| `src/shared/ipc.ts` | 7 | legacy-keep | `MurmurBridge`, `MurmurSettings` types, API names. IPC contract is frozen. |
| `src/shared/settings.ts` | 6 | legacy-keep | `MurmurSettings`, `isMurmurSettings`, comments. Schema is frozen. |

Lowercase-only patterns are legacy throughout: `[murmur]` / `[murmur recorder]`
log prefixes, `window.murmur` / `murmurRecorder` / `murmurOverlay` bridge names,
`MurmurBridge` / `MurmurSettings` / `isMurmurSettings` types, `murmur-pcm-capture`
worklet name, `murmur.ico` / `murmur.png` file references, `%APPDATA%\Murmur`,
`%TEMP%\murmur`, `murmur.log`, `MURMUR_DEBUG`, `dev.murmur.app`, and the npm package
name.

Hidden-window titles (`Murmur Overlay`, `Murmur Recorder`) are marked legacy-keep
because those windows never display a title. If Phase 0.2 chooses to rename them for
consistency, that is a zero-risk string change, but it is not required by the naming
rule.

---

## 9. Baseline verification (Phase 0.1)

Environment: Windows, Node `v26.3.0`, npm `11.16.0`, branch `ui-redesign`, baseline
commit `b8de08e`, run at 2026-11-05 21:26 +05:30.

| Command | Result | Output summary |
|---|---|---|
| `npm run typecheck` | pass | `typecheck:node` and `typecheck:web` both completed with no diagnostics |
| `npm run lint` | pass | `eslint --cache .` completed with no findings |
| `npm run format:check` | pass | `prettier --check .`: "All matched files use Prettier code style!" |
| `npm run build` | pass | typecheck passed; electron-vite built main (121.22 kB), three preloads (4.69 / 6.36 / 8.10 kB), settings CSS 8.27 kB, settings JS 586.69 kB, plus overlay/recorder assets |
| `npm test` | pass | 7 tests, 2 suites, 7 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo (92 ms) |

The five commands are all green at baseline. No source file was modified to obtain
these results. `out/`, `.test-build/`, and `.eslintcache` are generated and
gitignored.

### 9.1 Done check

- `docs/UI_CONTRACT.md` exists.
- The only tracked changes made by this phase are `docs/UI_CONTRACT.md` and
  `AGENTS.md`.
- No renderer, preload, main, shared, installer, or HTML source file changed.

---

## 10. Risks and follow-ups found during the audit

1. **`app.setName('Murmur')` must not be renamed.** It determines
   `%APPDATA%\Murmur`; changing it during the rebrand would move `settings.json` and
   logs. Phase 0.2 must change the *dialog title and messages* in
   `src/main/index.ts`, but leave this call and `APP_USER_MODEL_ID` alone.
2. **Icon filename mismatch for Phase 0.2.** The owner-supplied untracked files are
   `resources/icons/RedFlow-logo.ico` and `RedFlow-logo.png`, while the Phase 0.2
   checklist names `redflow.ico` / `redflow-logo.png`. Resolve the final file names
   with the owner before repointing tray, windows, and installer references.
3. **CSP allows inline styles, but the design system does not.** `style-src
   'unsafe-inline'` is present for Vite dev style injection. Phase 0.5 must still use
   classes and tokens; Phase 0.8 audits hard-coded colors and inline styles.
4. **The meter has 20 segments, not 14.** The overlay uses 14; the settings meter
   uses `BAR_COUNT = 20`. "Keep the current segment count" in Phase 0.6 means 20.
5. **Trailing space is not disabled during hotkey capture.** The other toggles are.
   This is current behavior and must be preserved unless the owner changes it.
6. **The version footer lives in the page footer today.** Phase 0.4 moves it to the
   sidebar; the values must still come from `getAppInfo()` and stay live.
7. **`App.tsx` is already 473 lines.** Phase 0.4/0.5 should split the section
   components to stay near the ~250-line soft limit, without renaming the existing
   state or handlers.
8. **The HTML `<title>` and `BrowserWindow.title` both say `Murmur Settings`.**
   Phase 0.2 must change both, otherwise the taskbar/tab title can disagree.
9. **Hidden-window titles are not user-visible.** `Murmur Overlay` and
   `Murmur Recorder` are in frameless/hidden windows. They are classified
   legacy-keep; do not treat the Phase 0.2 grep as requiring their removal.

---

## 11. Phase 0.8 final QA

| Item | Value |
|---|---|
| Phase | 0.8 - final QA |
| Branch | `ui-redesign` |
| QA commit | `4874c25` (the Phase 0.8 commit adds this section) |
| Branch point | `b8de08e` |
| QA date | 2026-11-06 |
| App under test | built renderer + Electron shell; throwaway QA harness, mock preload |
| Source changes in this phase | documentation and checklist only; no product code or token values changed |

The audit used throwaway scripts outside the repository for the contrast
calculation and the Electron walkthrough. Nothing from those scripts is committed.

### 11.1 Contrast audit

WCAG 2.2 AA requires 4.5:1 for normal text and 3:1 for the visual information
required to identify a component or its state (SC 1.4.11). Inactive controls are
exempt from text contrast. The table below records every token pairing actually
used by the settings and overlay surfaces.

**Text pairings (4.5:1)**

| Pairing | Ratio | Result |
|---|---:|---|
| body text (`text` on `bg`) | 17.90 | pass |
| sidebar brand (`text` on `bg-sidebar`) | 17.29 | pass |
| section title (`text` on `bg`) | 17.90 | pass |
| setting label (`text` on `surface-1`) | 16.73 | pass |
| select value (`text` on `surface-2`) | 15.60 | pass |
| keycap label (`text` on `surface-2`) | 15.60 | pass |
| sidebar inactive label (`text-secondary` on `bg-sidebar`) | 9.24 | pass |
| sidebar active/hover label (`text-secondary` on `surface-2`) | 8.33 | pass |
| section description (`text-muted` on `bg`) | 5.83 | pass |
| setting hint (`text-muted` on `surface-1`) | 5.45 | pass |
| sidebar eyebrow (`text-muted` on `bg-sidebar`) | 5.64 | pass |
| sidebar footer (`text-muted` on `bg-sidebar`) | 5.64 | pass |
| status line (`text-muted` on `bg`) | 5.83 | pass |
| switch On/Off label (`text-muted` on `surface-1`) | 5.45 | pass |
| microphone test status (`text-muted` on `surface-1`) | 5.45 | pass |
| secondary body (`text-secondary` on `bg`) | 9.56 | pass |
| note text (`text-secondary` on `surface-1`) | 8.94 | pass |
| chip text (`text-secondary` on `surface-2`) | 8.33 | pass |
| badge text (`text-secondary` on `surface-2`) | 8.33 | pass |
| ghost button label (`text-secondary` on `surface-1`) | 8.94 | pass |
| select chevron (`text-muted` on `surface-2`) | 5.09 | pass |
| select chevron hover (`text-muted` on `surface-3`) | 4.57 | pass |
| primary button label (`on-accent` on `accent-solid`) | 4.93 | pass |
| primary button hover (`on-accent` on `accent-solid-hover`) | 5.62 | pass |
| primary button pressed (`on-accent` on `accent-solid-pressed`) | 7.01 | pass |
| active test button label (`accent-text` on `accent-soft` over `surface-1`) | 7.60 | pass |
| capture prompt (`accent-text` on `accent-soft` over `bg`) | 8.27 | pass |
| saved status (`success` on `bg`) | 10.48 | pass |
| error status (`warning` on `bg`) | 9.64 | pass |
| overlay label (`text` on pill `surface-1`) | 16.73 | pass |
| overlay label over desktop (`text` on pill `bg` at 94%) | 16.81 | pass |
| overlay detail (`text-secondary` on pill `surface-1`) | 8.94 | pass |
| overlay done label (`success` on pill `surface-1`) | 9.80 | pass |
| overlay error label (`warning` on pill `surface-1`) | 9.00 | pass |
| disabled button label (`text-disabled` on `surface-2`) | 2.59 | exempt (inactive) |
| disabled select value (`text-disabled` on `surface-2`) | 2.59 | exempt (inactive) |

**Non-text state and focus pairings (3:1)**

| Pairing | Ratio | Result |
|---|---:|---|
| sidebar active icon (`accent` on `surface-2`) | 4.38 | pass |
| focus ring on card (`accent-text` on `surface-1`) | 8.72 | pass |
| focus ring on window (`accent-text` on `bg`) | 9.33 | pass |
| switch knob when off (`switch-knob` on `surface-3`) | 9.36 | pass |
| switch track when on (`accent` on `surface-1`) | 4.69 | pass |
| switch knob when on (`on-accent` on `accent`) | 3.91 | pass |
| meter lit segment (`accent` on `surface-1`) | 4.69 | pass |
| meter peak segment (`accent-text` on `surface-1`) | 8.72 | pass |
| active microphone status dot (`accent` on `surface-1`) | 4.69 | pass |

**Supporting separations (not required to identify a component or state)**

| Pairing | Ratio | Why it is not a 1.4.11 failure |
|---|---:|---|
| switch track off (`surface-3` on `surface-1`) | 1.19 | The knob is 9.36:1 against the track and the adjacent "Off" label is 5.45:1; the track is the unfilled groove, not the state cue. |
| meter off segment (`surface-3` on `surface-1`) | 1.19 | Unlit segments carry no level information; lit and peak segments meet 3:1. |
| select surface (`surface-2` on `surface-1`) | 1.07 | The value text is 15.60:1, the chevron 5.09:1, and the focus ring 8.72:1; the surface tint is separation, not the only identifier. |
| select border (`border` 10% on `surface-1`) | 1.44 | Same as above. |
| card border (`border` 10% on `bg`) | 1.40 | Cards are non-interactive grouping; headings, spacing, and row dividers carry the structure. |
| secondary button surface (`surface-2` on `surface-1`) | 1.07 | The label is 8.94:1 and the focus ring 8.72:1; the filled area is decoration. |
| secondary button hover (`surface-3` on `surface-1`) | 1.19 | Same as above. |
| listening pill border (`accent-border` on `surface-1`) | 1.85 | "Listening" is 16.73:1 and the pulsing accent dot is 4.69:1; the border is decoration. |
| error pill border (`warning-border` on `surface-1`) | 2.42 | "Couldn't dictate" is 9.00:1 and the alert icon uses the same warning color; the border is decoration. |
| spinner track (`accent` 25% on `surface-1`) | 1.33 | The moving accent arc is 4.69:1; the track is decoration. |

No token values were changed. These separations are deliberately quiet in the
graphite design, and every control keeps a high-contrast label, value, icon, or
focus ring. A throwaway preview of brighter borders (24% and 32% white) made
cards and controls visibly heavy without adding information, so it was not
adopted. If the owner wants strict 3:1 boundaries even where WCAG does not
require them, that is a token-only change.

### 11.2 Keyboard walkthrough

The settings window was mounted in a throwaway Electron harness with a mock
preload (no settings were written) and driven with real key events.

- The sidebar is a vertical `tablist` with one roving tab stop. `ArrowDown`
  moved through Dictation -> Text cleanup -> Microphone -> Model & language ->
  System and wrapped to Dictation; `ArrowUp` reversed; `Home` and `End` jumped to
  the first and last tabs. Every move activated the matching panel.
- All five panels stayed mounted: four had `hidden` and one was visible. Tab
  order inside each section matched the visual order: Change -> trailing-space
  switch; filler -> spoken-commands switch; microphone select -> Test
  microphone; model select -> language select; Start with Windows switch.
  `Shift+Tab` returned to the previous control.
- Every stop showed the same visible `:focus-visible` ring (`solid 2px`
  `rgb(255, 149, 146)` at 150% scale, `1.6px` at 125% due to subpixel rounding).
  The real checkbox, native selects, and buttons all remained keyboard
  operable; the checkbox ring is drawn on the switch track.
- `Enter` on Change started one capture (`captureCalls: 1`), rendered the
  `Ctrl` + `F10` keycaps, and showed "Saved". Escape, Cancel, and the 15 s
  timeout were not re-driven in this phase; their behavior is unchanged from
  the Phase 0.5 implementation, and they remain in the owner regression below.
- The Test microphone button was reachable and focusable. Live meter movement
  remains part of the owner regression below.

### 11.3 Reduced motion

With `prefers-reduced-motion: reduce` forced in Chromium, the section panel
reported `animation-name: none` and the panel, button, meter, and sidebar all
reported a `0.01ms` transition duration. Pulses, the section rise, hover
transitions, and the meter animation are therefore suppressed; no motion is
required to understand a state.

### 11.4 Layout and scaling

The host display runs at 125% Windows scaling. The harness also forced a 1.5
device scale factor to represent 150%. Measurements are CSS pixels of the
window's inner area.

| Run | Inner viewport | Sidebar | Content | Overflow |
|---|---:|---:|---:|---|
| default, 125% | 927 x 598 | 232 px | 615 x 305 | none |
| minimum, 125% | 767 x 478 | 68 px rail | 619 x 305 | none |
| 820 px boundary, 125% | 820 x 478 | 232 px | 508 x 372 | none |
| default, forced 150% | 928 x 603 | 232 px | 616 x 305 | none |
| minimum, forced 150% | 768 x 483 | 68 px rail | 620 x 305 | none |
| 820 px boundary, forced 150% | 822 x 483 | 232 px | 510 x 372 | none |

At the 820 px boundary the rows stacked as intended: the text column kept
92.1% of the row width and the control moved to a full-width second line.
`scrollWidth` equalled `clientWidth` in every run, so there was no horizontal
overflow and no clipped control. Settings and overlay screenshots at 1x, 1.25x,
and 1.5x were inspected; the overlay kept its 336 px pill and all four states
rendered with the expected label colors.

### 11.5 Diff audit against `b8de08e`

All 50 changed files fall into an allowed category. "U1a" is a visible string
or icon reference outside the renderer; "U1b" is an allowed settings-window
constructor option.

| File | Change | Verdict |
|---|---|---|
| `AGENTS.md` | M | allowed - UI-track checklist/status documentation |
| `docs/ARCHITECTURE.md` | M | allowed - settings renderer structure documentation |
| `docs/UI_CONTRACT.md` | A | allowed - audit, contract, and QA evidence |
| `electron-builder.yml` | M | allowed - U1a product/shortcut names and icon references |
| `resources/icons/RedFlow-logo.ico` | A | allowed - owner-supplied brand icon |
| `resources/icons/RedFlow-logo.png` | A | allowed - owner-supplied brand logo |
| `resources/icons/murmur.ico` | D | allowed - replaced by the Redflow icon |
| `src/main/app/tray.ts` | M | allowed - U1a visible strings and icon reference |
| `src/main/friendlyErrors.ts` | M | allowed - U1a visible error strings |
| `src/main/index.ts` | M | allowed - U1a visible dialog strings/title |
| `src/main/transcriber.ts` | M | allowed - U1a visible error strings |
| `src/main/whisperRunner.ts` | M | allowed - U1a visible error strings |
| `src/main/windows/settingsWindow.ts` | M | allowed - U1b window options plus title/icon |
| `src/renderer/overlay/index.html` | M | allowed - overlay markup/icons |
| `src/renderer/overlay/main.ts` | M | allowed - overlay rendering and shared tokens |
| `src/renderer/overlay/styles.css` | M | allowed - overlay styling |
| `src/renderer/recorder/main.ts` | M | allowed - U1a visible error strings |
| `src/renderer/settings/App.tsx` | M | allowed - settings renderer shell; state and handlers preserved |
| `src/renderer/settings/assets/redflow-logo.png` | A | allowed - settings brand asset |
| `src/renderer/settings/components/Button.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/Card.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/HotkeyPicker.tsx` | M | allowed - settings component styling only |
| `src/renderer/settings/components/Keycap.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/SectionHeader.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/Select.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/SettingRow.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/SettingsStatus.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/Sidebar.tsx` | A | allowed - settings shell |
| `src/renderer/settings/components/Switch.tsx` | A | allowed - settings component |
| `src/renderer/settings/components/Toggle.tsx` | M | allowed - settings component composition |
| `src/renderer/settings/components/icons.tsx` | A | allowed - inline SVG icons |
| `src/renderer/settings/components/sections/CleanupSection.tsx` | A | allowed - extracted section markup |
| `src/renderer/settings/components/sections/DictationSection.tsx` | A | allowed - extracted section markup |
| `src/renderer/settings/components/sections/MicrophoneSection.tsx` | A | allowed - extracted section markup |
| `src/renderer/settings/components/sections/ModelSection.tsx` | A | allowed - extracted section markup |
| `src/renderer/settings/components/sections/SystemSection.tsx` | A | allowed - extracted section markup |
| `src/renderer/settings/index.html` | M | allowed - title only; CSP unchanged |
| `src/renderer/settings/main.tsx` | M | allowed - stylesheet imports |
| `src/renderer/settings/sections.ts` | A | allowed - navigation metadata |
| `src/renderer/settings/settingsModels.ts` | A | allowed - model display helper |
| `src/renderer/settings/styles.css` | D | allowed - replaced by the split style files |
| `src/renderer/settings/styles/base.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/buttons.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/components.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/keycaps.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/layout.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/selects.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/sidebar.css` | A | allowed - settings styling |
| `src/renderer/settings/styles/switches.css` | A | allowed - settings styling |
| `src/renderer/shared/styles/tokens.css` | A | allowed - shared design tokens |

No violation was found. Non-renderer changes were read line by line: they are
user-visible name/icon substitutions or the allowed settings-window options.
No IPC channel, payload, preload API, hotkey, audio, whisper, insertion, or
settings-schema code changed.

### 11.6 "Murmur" and old teal residue

Visible "Murmur" strings are gone from the shipped UI. Every remaining hit is
one of these legacy-keep categories:

- **Identity and storage:** `app.setName('Murmur')`, `dev.murmur.app`,
  `%APPDATA%\Murmur`, `%TEMP%\murmur`, `murmur.log`, `MURMUR_DEBUG`,
  `MurmurSettings`, `window.murmur`, `window.murmurOverlay`,
  `window.murmurRecorder`, and the `murmur-pcm-capture` worklet name. Renaming
  these would move user data, orphan the autostart entry, or change the typed
  bridge; the naming rules in AGENTS.md keep them.
- **Hidden/host-only titles:** `Murmur Overlay`, `Murmur Recorder`, and the
  `Murmur Settings` / `Murmur` names still used in package metadata. The two
  window titles are on hidden frameless windows; `package.json` identity is
  explicitly legacy-keep, while the installed display name comes from
  `electron-builder.yml` (`Redflow`).
- **Logs, comments, internal errors, and tests:** `[murmur]` console prefixes,
  `[murmur recorder]`, internal guard messages, comments, type names, and the
  `MurmurTargetIntegrityProbe` class. These are not shown in the overlay or
  settings window.
- **Out-of-scope documents and dev art:** `README.md` (flagged below),
  `SECURITY.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `scripts/generate-icon.mjs`,
  `scripts/generate-hero.mjs`, and the unreferenced `resources/icons/murmur.png`.
  Phase 0.2 only required replacing the icon references; the generator and its
  output are not shipped in the app.

Old teal (`#14b8a6`, `#0f766e`, `#2dd4bf`, and relatives) remains only in
`docs/assets/hero.svg` (README artwork), `scripts/generate-hero.mjs` (the
generator for that artwork), and the historical colour table in section 4 of
this contract. A search of `src/`, `resources/`, and `electron-builder.yml`
found no teal values; no shipped settings or overlay surface uses the old theme.

### 11.7 Packaging and verification

- `npm run dist:win` completed with exit code 0 and wrote
  `dist\Redflow-Setup-0.1.0.exe` plus its block map. The build/typecheck steps
  inside it passed; no code-signing certificate is configured, so signing was
  skipped as expected.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`,
  and `npm test` all passed after the documentation changes:
  - typecheck: node and web projects both clean.
  - lint: `eslint --cache .` clean.
  - format check: "All matched files use Prettier code style!"
  - build: 35 main modules, 3 preload entries, and 51 renderer modules built.
  - test: 7 tests passed, 0 failed (2 suites, `insertionFlow`).
- `README.md` is **not edited**. It still says "Murmur" throughout and must be
  updated before the Phase 10 release; that is a release-documentation task,
  not part of this UI track.

### 11.8 Owner verification still open

The automated checks above do not replace a real Windows regression. Still open:

1. Hotkey dictation into Notepad (hold, speak, release, text inserted).
2. Rebind the hotkey through Change, including Escape, Cancel, and the 15 s
   timeout, then dictate with the new binding.
3. Toggle trailing space, filler words, spoken commands, and Start with Windows;
   restart the app and confirm each persisted.
4. Run Test microphone: the meter moves while speaking and returns to Idle.
5. Switch input device, whisper model, and language; dictate once with each.
6. Install this build over the previous one and confirm `settings.json` is kept
   and no `%APPDATA%\Redflow` folder appears.
