# Murmur

**Free, local push-to-talk dictation for Windows.** Hold a key, speak, release,
and Murmur types what you said at the cursor of whatever app is focused.

Murmur is built for people who want dictation without an account, a
subscription, or their voice leaving the machine. Speech recognition runs on
your PC with [whisper.cpp](https://github.com/ggml-org/whisper.cpp); the app
has no cloud service, telemetry, or analytics.

- Windows 10 or 11, x64
- 100% local transcription
- Works in any app that accepts pasted text
- Free and open source under the MIT license

## Install

1. Download `Murmur-Setup-<version>.exe` from the
   [Releases page](https://github.com/RidhivSharma/RedFlow/releases).
2. Optionally verify the download against the `.sha256` file published with the
   release (see [SmartScreen and checksums](#smartscreen-and-checksums)).
3. Run the installer. It installs per user, needs no administrator rights, and
   creates Start Menu and desktop shortcuts.
4. Launch Murmur. It starts in the system tray and does not open a main window.

On first launch, make sure Windows lets desktop apps use the microphone:
**Settings → Privacy & security → Microphone → Let desktop apps access your
microphone**. On Windows 10 the path is **Settings → Privacy → Microphone**.

### SmartScreen and checksums

Murmur's installer is not code-signed. Windows SmartScreen may show **"Windows
protected your PC"** the first time you run it. This is expected for an unsigned
open-source app; it is not a malware report.

To continue, click **More info**, then **Run anyway**. If you would rather not
bypass the warning, build Murmur from source using the steps below.

You can check that the file matches the release before running it:

```powershell
Get-FileHash .\Murmur-Setup-0.1.0.exe -Algorithm SHA256
```

Compare the output with the checksum on the release page. If they differ, do not
run the file.

## Use it

1. Click into the text field where you want the text to go.
2. Hold **F9** anywhere in Windows.
3. Speak normally, then release F9.
4. A pill appears at the bottom of the screen: **Listening**, then
   **Transcribing**, then **Inserted**. The text is pasted at the cursor.

Keep the target app focused until the pill says **Inserted**. Murmur pastes into
whatever window has focus when the transcript is ready, not necessarily the
window that was focused when you pressed the key.

Tips:

- Holds shorter than 300 ms are treated as taps and ignored.
- A single hold is capped at 120 seconds. Murmur stops recording at the cap and
  transcribes what it has.
- You can start another utterance while the previous one is still transcribing;
  utterances are queued and inserted in order.
- The tray tooltip shows what Murmur is doing. The tray menu has **Settings**
  and **Quit**; double-clicking the tray icon also opens Settings.
- Murmur never pastes into its own windows. If Murmur Settings has focus when a
  transcript is ready, the insertion is refused instead of pasting into the
  settings UI.

### Pasting into administrator apps

Windows blocks simulated input from a normal user-level app into an app running
as administrator (UIPI — User Interface Privilege Isolation). Murmur checks the
foreground app before inserting. If the target is elevated or its integrity
cannot be checked, Murmur does **not** send Ctrl+V. It copies the transcript to
the clipboard, leaves it there, and shows **Copied** in the overlay.

Press Ctrl+V yourself in the target app. The previous clipboard is intentionally
not restored in this case, so the transcript stays available for the manual
paste. Running Murmur as administrator can let it paste into some elevated apps,
but it is not recommended: it gives Murmur more privilege than it needs. UIPI is
a Windows security boundary, not a Murmur bug.

## Settings

Open the tray menu and choose **Settings**, or double-click the tray icon.
Changes save automatically and apply without restarting Murmur.

| Setting                 | What it does                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Push-to-talk hotkey** | Click the picker, then press the key or combination you want to hold. Escape cancels. Bare keys such as `F9` and combinations such as `Ctrl+Space` are supported. |
| **Trailing space**      | Adds one space after each transcript so back-to-back dictations do not run together.                                                                              |
| **Remove filler words** | Drops sounds such as "um" and "uh" from the transcript.                                                                                                           |
| **Spoken commands**     | Turns "new line", "new paragraph", "period", "comma", and "question mark" into punctuation and line breaks.                                                       |
| **Input device**        | Chooses the microphone. **System default** follows the device Windows currently uses.                                                                             |
| **Test microphone**     | Shows a live level meter for the selected input.                                                                                                                  |
| **Whisper model**       | Lists the `.bin` files found in Murmur's models folder. The bundled default is `ggml-base.en.bin`.                                                                |
| **Language**            | **English** or **Auto-detect**. Auto-detect needs a multilingual model; `base.en` is English-only.                                                                |
| **Start with Windows**  | Launches Murmur quietly in the tray when you sign in.                                                                                                             |

Settings live in `%APPDATA%\Murmur\settings.json`. The settings window is the
supported way to change them; if you edit the file by hand, quit Murmur first
and restart it afterwards.

### Advanced settings

A few options are intentionally not exposed in the settings window. They can be
changed in `settings.json` while Murmur is closed:

| Key                   | Default  | Meaning                                                                                          |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `threads`             | `0`      | Whisper thread count. `0` means auto (logical cores minus one, minimum two).                     |
| `pasteRestoreDelayMs` | `350`    | How long the target app gets to read the clipboard before Murmur restores the previous contents. |
| `minUtteranceMs`      | `300`    | Holds shorter than this are discarded as taps.                                                   |
| `maxUtteranceMs`      | `120000` | Hard cap for one utterance. The recorder also enforces a 120 s maximum.                          |

## Privacy

**All speech processing is local.** Murmur does not send audio, transcripts, or
usage data anywhere.

- Audio is captured by a hidden renderer window and transcribed locally by
  `whisper-cli.exe` on your CPU.
- There are no accounts, API keys, cloud APIs, telemetry, analytics, or update
  checks. Murmur makes no network requests to transcribe or to report usage.
- The microphone stream stays open between utterances so the first word is not
  clipped. Audio samples are only buffered while the hotkey is held; that is why
  Windows may show the microphone-in-use indicator for as long as Murmur runs.
- The latest utterance is written to `%TEMP%\murmur\last.wav` for troubleshooting
  and is replaced by the next one. Queued utterances get temporary copies that
  are deleted after transcription. Delete `%TEMP%\murmur` to remove the
  remaining audio.
- Logs are written to `%APPDATA%\Murmur\logs\murmur.log` and never contain audio.
  Transcript text is not logged by default. Set `MURMUR_DEBUG=1` before launch
  to include transcripts in the log while troubleshooting; turn it off
  afterwards.
- To insert text, Murmur reads the current clipboard text, writes the
  transcript, sends Ctrl+V, and restores the previous clipboard after 350 ms.
  Clipboard-history tools may still record the transcript.
- Settings and logs stay under `%APPDATA%\Murmur`. Uninstalling keeps that
  folder; delete it manually if you want a clean removal.
- Downloading the installer and the optional SmartScreen check are handled by
  Windows and your browser, not by Murmur.

## Troubleshooting

Logs are in `%APPDATA%\Murmur\logs\murmur.log` (plus `.1`–`.3` backups). The
overlay shows a short friendly message; the log has the technical detail.

### The hotkey does nothing

- Another app may be using the same key. Open **Settings** and rebind it to
  something else, then try again.
- Some games and apps that use raw input or anti-cheat can interfere with global
  hooks. Try windowed mode or a different hotkey.
- If the tray tooltip says the hotkey is unavailable, the key name in
  `settings.json` is invalid. Rebind it in Settings.
- Murmur's own Settings window can have focus while you record, but insertion
  is refused for Murmur's windows. Focus the target app before the transcript
  is ready.

### Nothing is inserted

- Make sure the target field still has focus when the overlay says **Inserted**.
- If the overlay says **Copied**, the target app is elevated or its integrity
  could not be checked. Press Ctrl+V manually; see
  [Pasting into administrator apps](#pasting-into-administrator-apps).
- Windows blocks synthetic input into some secure fields (password boxes,
  UAC prompts, lock screen). Murmur cannot paste there.
- Check the log for an insertion error. A clipboard manager or another app
  holding the clipboard open can also make the paste fail.

### The microphone is not found or access is denied

- Allow desktop apps to use the microphone in
  **Settings → Privacy & security → Microphone** (Windows 11) or
  **Settings → Privacy → Microphone** (Windows 10).
- Choose the correct input under **Settings → Microphone**, then use
  **Test microphone** to confirm it hears you.
- Close other apps that may be holding the microphone exclusively.
- If a USB microphone was unplugged and reconnected, try the next utterance;
  Murmur reopens the device. If it does not recover, restart Murmur.

### The microphone indicator never turns off

That is expected. Murmur keeps the capture stream warm so pressing the hotkey
does not wait for the device to open and clip the first word. Audio is only
buffered during a hold, and nothing is recorded while Murmur is idle.

### "No speech detected"

Murmur skips Whisper when a hold is nearly silent, because Whisper tends to
invent phrases from silence. Hold the key, wait a moment, speak at a normal
volume, then release. Check the level meter in **Settings → Test microphone** if
you are unsure whether the mic hears you.

### Text is wrong, has filler words, or the language is wrong

- The bundled `ggml-base.en.bin` model is English-only. Choose a multilingual
  model if you want **Auto-detect** to transcribe other languages.
- Turn on **Remove filler words** or **Spoken commands** under **Text cleanup**.
- A larger model (for example `small.en`) is more accurate but slower. Put the
  `.bin` file in Murmur's models folder and select it in Settings.
- Background noise and very quiet speech reduce accuracy; a headset microphone
  usually helps.

### Transcription is slow

- `base.en` typically takes a few seconds for a short utterance on a modern
  CPU; larger models take longer.
- Murmur uses all but one logical core by default. Advanced users can set
  `threads` in `settings.json` (for example `4`) and restart. Higher is not
  always faster; leave headroom for the app you are dictating into.
- The first transcription after launch can be slower while the model is read
  from disk.
- Very long holds take longer to transcribe. The 120 s cap keeps the worst case
  bounded.

### "Murmur's speech engine is missing" or "The Whisper model is missing"

The installed app ships `whisper-cli.exe` and `ggml-base.en.bin`. If either is
missing, reinstall Murmur. In a development checkout these files are downloaded
separately; see [Build from source](#build-from-source).

### Murmur is not in the tray

- Check the tray overflow area (the `^` button).
- Murmur allows only one instance. Launching it again does nothing; look for the
  existing tray icon.
- If it is not running, check Task Manager for `Murmur.exe` and start it again.
  If it exits immediately, check the log.
- If the app is running but the Settings window will not open, quit from the tray
  and restart.

### The installer is blocked by SmartScreen or antivirus

Murmur is unsigned and uses a global keyboard hook, the clipboard, and
simulated Ctrl+V. Those are legitimate features, but they are also common
heuristics for malware. The source is in this repository and the release
publishes a checksum. Restore the file only if you trust the source and the
checksum matches, or build from source. Do not disable antivirus protection
system-wide.

### Reset Murmur

1. Quit Murmur from the tray.
2. Rename or delete `%APPDATA%\Murmur\settings.json`.
3. Start Murmur again. It recreates the file with defaults.

To remove recordings and logs as well, delete `%TEMP%\murmur` and
`%APPDATA%\Murmur\logs`.

### Uninstall

Use **Settings → Apps → Installed apps → Murmur → Uninstall**, or the Start Menu
shortcut. The uninstaller removes the program and shortcuts but keeps
`%APPDATA%\Murmur`, so settings and logs survive a reinstall. Delete that folder
manually for a clean removal.

## Build from source

Requirements:

- Windows 10 or 11, x64
- Node.js 22.12 or newer
- Git
- About 1 GB free disk space for dependencies and the model

No Visual Studio install is needed: `uiohook-napi` ships a prebuilt N-API binary
for `win32-x64`.

```powershell
git clone https://github.com/RidhivSharma/RedFlow.git
cd RedFlow
npm install
```

Transcription needs two downloaded resources that are never committed:

- `resources/whisper/whisper-cli.exe` plus its DLLs
- `resources/models/ggml-base.en.bin` (~142 MB, English-only base model)

Download a Windows x64 build from the
[whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) and copy
the **contents** of its `Release/` folder into `resources/whisper/`
(`whisper-cli.exe` and every DLL must sit directly in that folder). Download
`ggml-base.en.bin` from the
[whisper.cpp model collection](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
into `resources/models/`.

Then run:

```powershell
npm run dev       # run the app in development
npm test          # unit tests
npm run typecheck # typecheck the Node and web sides
npm run lint      # ESLint
npm run build     # typecheck and build all bundles
npm run dist:win  # build the x64 NSIS installer into dist/
```

`npm run dist:win` produces `dist\Murmur-Setup-<version>.exe`. The installer is
per-user, needs no elevation, lets you choose the install folder, and creates
Start Menu and desktop shortcuts. The app code lives in `app.asar`;
`uiohook-napi`'s native binary is unpacked automatically; whisper, models, and
icons are copied beside it. The uninstaller keeps `%APPDATA%\Murmur`.

For a development build, `whisper-cli.exe` and the model are resolved from
`resources/whisper` and `resources/models` in the checkout. In an installed
build they resolve from `<install>\resources\...`.

## Where files live

| What             | Location                                                          |
| ---------------- | ----------------------------------------------------------------- |
| Installed app    | `%LOCALAPPDATA%\Programs\Murmur` by default                       |
| Settings         | `%APPDATA%\Murmur\settings.json`                                  |
| Logs             | `%APPDATA%\Murmur\logs\murmur.log` (2 MB per file, three backups) |
| Latest recording | `%TEMP%\murmur\last.wav`                                          |

## License

Murmur is released under the [MIT License](LICENSE).

Third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Murmur is not affiliated with
OpenAI, whisper.cpp, Electron, or the uiohook projects.

Issues and pull requests are welcome. If you plan to change code, read
[AGENTS.md](AGENTS.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.
