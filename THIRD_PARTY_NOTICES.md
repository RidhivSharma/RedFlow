# Third-party notices

Murmur is released under the [MIT License](LICENSE). The installed app also
contains or uses the third-party components below. Their licenses apply to those
components, not to Murmur's own code.

This file is a convenience summary. The upstream projects and their license
files are authoritative.

## Components bundled with the app

### whisper.cpp (`whisper-cli.exe` and DLLs)

- **License:** MIT
- **Copyright:** Copyright (c) 2023-2026 The ggml authors
- **Source:** <https://github.com/ggml-org/whisper.cpp>
- **Used for:** local speech recognition. Murmur spawns `whisper-cli.exe` as a
  separate process for each utterance.

### OpenAI Whisper model (`ggml-base.en.bin`)

- **License:** MIT
- **Copyright:** Copyright (c) 2022 OpenAI
- **Source:** <https://github.com/openai/whisper>
- **GGML conversion:** <https://huggingface.co/ggerganov/whisper.cpp>
- **Used for:** the speech-recognition weights bundled with Murmur as
  `ggml-base.en.bin`.

### Electron

- **License:** MIT
- **Copyright:** Copyright (c) Electron contributors; Copyright (c) 2013-2020
  GitHub Inc.
- **Source:** <https://github.com/electron/electron>
- **Used for:** the desktop application runtime. Electron bundles Chromium and
  Node.js; their notices ship with the app as `LICENSE.electron.txt` and
  `LICENSES.chromium.html` next to `Murmur.exe`.

### uiohook-napi

- **License:** MIT
- **Copyright:** Copyright (c) 2020 Alexander Drozdov
- **Source:** <https://github.com/SnosMe/uiohook-napi>
- **Used for:** the global push-to-talk hotkey and the simulated Ctrl+V
  insertion. It ships as a native Node addon in `app.asar.unpacked`.

#### libuiohook (included in uiohook-napi)

- **License:** LGPL-3.0-or-later
- **Copyright:** Copyright (C) 2006-2023 Alexander Barker
- **Source:** <https://github.com/kwhat/libuiohook>
- **License text:** <https://www.gnu.org/licenses/lgpl-3.0.txt>
- **Used for:** the platform input hook underneath `uiohook-napi`.
  `uiohook-napi` includes and links libuiohook into its native addon. The
  libuiohook source is included in the `uiohook-napi` source distribution and is
  available at the link above.

### React and React DOM

- **License:** MIT
- **Copyright:** Copyright (c) Meta Platforms, Inc. and affiliates.
- **Source:** <https://github.com/facebook/react>
- **Used for:** the settings and overlay user interfaces. Both packages are
  bundled into the renderer output.

## MIT License

The following text applies to the MIT-licensed components listed above.

```text
MIT License

Copyright (c) the respective copyright holders listed above

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Notes

- Development-only tooling (electron-vite, Vite, TypeScript, ESLint, Prettier,
  electron-builder) is not part of the installed app and is not listed here.
- Electron's `LICENSES.chromium.html` contains the full notices for Chromium,
  Node.js, and the other libraries bundled by Electron.
- If you redistribute Murmur, keep this file and the upstream license texts with
  the app, and comply with the LGPL-3.0 terms for libuiohook.
