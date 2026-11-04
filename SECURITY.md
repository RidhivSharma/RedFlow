# Security policy

Murmur is a local Windows app that listens for a global hotkey, records the microphone, runs a local speech model, and inserts text with a simulated Ctrl+V. Those are powerful capabilities, so security reports are taken seriously.

## Supported versions

| Version | Supported |
| :------ | :-------- |
| 0.1.x   | Yes       |

Murmur is pre-1.0. Security fixes land on the latest release; older builds are not maintained.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

- Open the repository's **Security** tab and choose **Report a vulnerability**, or
- go directly to <https://github.com/RidhivSharma/RedFlow/security/advisories/new>.

Do **not** open a public issue for a suspected vulnerability. Include:

- the Murmur version and Windows version,
- steps to reproduce, including the target app if relevant,
- the impact you believe is possible,
- any relevant log lines from `%APPDATA%\Murmur\logs\murmur.log`. Do not attach audio or transcripts unless they are necessary and you are comfortable sharing them.

You will get an acknowledgement as soon as possible, usually within a few days. Please allow time for a fix before publishing details.

## Scope

**In scope**

- Sandbox or IPC escapes: a renderer reaching Node.js, the filesystem, the clipboard, or another window's data outside the typed preload bridge.
- Command injection or path traversal through settings, model selection, microphone selection, or whisper invocation.
- Leakage of audio, transcripts, keystrokes, clipboard contents, or logs beyond what this repository documents.
- Privilege escalation or a bypass of the target-integrity check that could make Murmur paste into an app it should refuse.
- Installer or update-path tampering, including unsafe file permissions or path handling.
- Settings-file parsing that can execute code, escape the settings folder, or crash the app in a way that loses user data.

**Out of scope**

- The Windows UIPI limitation for elevated apps. Murmur detects it and falls back to clipboard-only; this is documented behavior, not a vulnerability.
- SmartScreen, antivirus warnings, or the absence of code signing. The release publishes a checksum; build from source if you do not trust the binary.
- Bugs in whisper.cpp, Electron, uiohook-napi, or Windows itself. Report those upstream.
- Transcription accuracy, hallucinated text, or microphone quality.
- Attacks that require physical access to an unlocked machine or an already-compromised administrator account.

## Safe harbor

Good-faith research that follows this policy is welcome. Do not access or modify data that is not yours, do not disrupt other users, and do not publish a working exploit before a fix is available. Murmur does not offer a bug bounty.
