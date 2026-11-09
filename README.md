# chiptune3 (fork: audio queue + libopenmpt 0.8.9 as separate .wasm)

> **This is an unofficial fork** of [DrSnuggles/chiptune](https://github.com/DrSnuggles/chiptune) (chiptune3 — an AudioWorklet player for tracker modules based on libopenmpt, successor of [deskjet/chiptune2.js](https://github.com/deskjet/chiptune2.js)). It is not affiliated with the original authors, and the original repository is untouched. All credit for chiptune3 goes to **DrSnuggles**, for chiptune2.js to **deskjet**, and for libopenmpt to the **OpenMPT project**.

Shared as a hobby project, no commercial intent. The goal is simply to share a version that was tested in practice and works smoothly.

## What is different
- **Smoother playback**: internal PCM queue in the AudioWorklet, start buffering, correct end-of-track handling (no cut-off tail).
- **Reliable track switching**: playback "generations" so events from a previous track never leak into the next one.
- **Real `ready` event**: `onInitialized` fires when libopenmpt is actually loaded.
- **Android/Chrome**: silent audio warm-up on creation.
- **libopenmpt 0.8.9** with the WebAssembly binary loaded as a separate `libopenmpt.wasm` file (keep it next to `libopenmpt.worklet.js`).

Full list: see [CHANGES.md](CHANGES.md).

## Usage
Same API as upstream chiptune3. Put `chiptune3.js`, `chiptune3.worklet.js`, `libopenmpt.worklet.js` and **`libopenmpt.wasm`** in one folder on your web server:

```js
import { ChiptuneJsPlayer } from './chiptune3.js'
const player = new ChiptuneJsPlayer()
player.onInitialized(() => player.load('song.xm'))   // load() fetches the file and starts playing
player.onEnded(() => console.log('finished'))
```

> Note: AudioWorklet requires a secure context (https:// or localhost), and the `.wasm` file must be served with the MIME type `application/wasm`.

## AI disclosure
The code changes in this fork were written by **Claude (Anthropic)** at the request and under the direction of the fork author, who tested them in real use. If AI-assisted code is not for you, please use the original project.

## License
Same as upstream: MIT (X11) for the JavaScript code; the compiled libopenmpt parts remain under the OpenMPT project's BSD license. See [LICENSE](LICENSE).

---

# Русская версия

**Это неофициальный форк** [DrSnuggles/chiptune](https://github.com/DrSnuggles/chiptune) (chiptune3 — плеер трекерных модулей на AudioWorklet и libopenmpt). С оригинальными авторами он не связан, сам оригинальный репозиторий не затронут. Вся заслуга за chiptune3 принадлежит **DrSnuggles**, за chiptune2.js — **deskjet**, за libopenmpt — **проекту OpenMPT**.

Выложено как хобби-проект, без коммерческих целей: просто хочется поделиться версией, которая проверена на практике и работает без запинок.

## Что изменено
- **Ровное воспроизведение**: внутренняя очередь PCM в AudioWorklet, стартовая буферизация, корректный конец трека (хвост не обрезается).
- **Надёжное переключение треков**: «поколения» воспроизведения, события старого трека не попадают в следующий.
- **Настоящее событие `ready`**: `onInitialized` срабатывает, когда libopenmpt действительно загрузился.
- **Android/Chrome**: беззвучный прогрев аудиотракта.
- **libopenmpt 0.8.9**, WebAssembly-бинарник загружается отдельным файлом `libopenmpt.wasm` (держите его рядом с `libopenmpt.worklet.js`).

Подробный список: [CHANGES.md](CHANGES.md).

## Использование
API тот же, что у оригинала. Положите `chiptune3.js`, `chiptune3.worklet.js`, `libopenmpt.worklet.js` и **`libopenmpt.wasm`** в одну папку на сервере (пример кода выше). AudioWorklet работает только по https:// или на localhost; сервер должен отдавать `.wasm` с типом `application/wasm`.

## Об использовании ИИ
Изменения в коде написаны ассистентом **Claude (Anthropic)** по запросу и под руководством автора форка, который проверил их в реальной работе. Если код, написанный с помощью ИИ, вам не подходит, пользуйтесь оригинальным проектом.

## Лицензия
Как у оригинала: MIT (X11) для JavaScript-кода; скомпилированные части libopenmpt остаются под BSD-лицензией проекта OpenMPT. См. [LICENSE](LICENSE).

---

# Original README (upstream, unchanged) / Оригинальный README

# Chiptune.js

## Important
Latest released and beta versions are available via "npm i chiptune".

https://www.npmjs.com/package/chiptune3

## Info
This is a javascript library that can play module music files. It is based on the [libopenmpt](https://lib.openmpt.org/libopenmpt) C/C++ library. To translate libopenmpt into Javascript [emscripten](https://github.com/kripken/emscripten) was used. 

Modernized ES6 module version with libopenmpt AudioWorklet backend

**Please note**: The compiled `libopenmpt.worklet.js` in this repository is maybe outdated.

## Demo
See: https://DrSnuggles.github.io/chiptune

Modland demo player: https://DrSnuggles.github.io/chiptune/demo.html

Drop in your favorite songs.

## How to use
- HTML: Include latest release version via https://drsnuggles.github.io/chiptune/chiptune3.min.js
- NPM: "npm i chiptune3" will install latest release but there are also upcoming versions available
- See index.html or demo.html for working examples

## Features

* Play all tracker formats supported by libopenmpt (including mod, xm, s3m, it)
* Simple Javascript API
* Pause/Resume
* Play local and remote files
* Stereo playback
* Module metadata
* Looping mode
* Volume control
* Position control
* Pattern data

## Build
Docker was used to build the library

CD into docker and run build.bat (Win) or build.sh (Linux)

You can minify by "npm run minify"

## Chiptune Maintainers
- v3: [DrSnuggles](https://github.com/DrSnuggles)
- v1/v2: [deskjet](https://github.com/deskjet)

## v3 History
- 2026-08-12: libopenmpt 0.8.7 + Emscripten 6.0.6
- 2026-07-17: libopenmpt 0.8.7 + Emscripten 6.0.3
- 2026-06-25: libopenmpt 0.8.7 + Emscripten 6.0.1
- 2026-06-05: libopenmpt 0.8.7 + Emscripten 6.0.0
- 2026-05-30: setSteroSeparation + setCtl (PR: indigo423 from CoolModFiles.com)
- 2026-05-29: libopenmpt 0.8.7 + Emscripten 5.0.7
- 2026-04-20: libopenmpt 0.8.6 + Emscripten 5.0.6
- 2025-04-22: Emscripten 4.0.7
- 2025-02-02: libopenmpt 0.7.13 + Emscripten 4.0.2
- 2025-02-02: Issue #1: Convert to AudioBuffer, see convert.html
- 2024-06-15: libopenmpt 0.7.8 + Emscripten 3.1.61
- 2024-05-12: libopenmpt 0.7.7 + Emscripten 3.1.59
- 2024-04-20: Emscripten 3.1.57 changes
- 2024-03-24: Bumped to 0.7.6
- 2024-03-18: Bumped to 0.7.5 using Emscripten 3.1.56
- 2024-03-13: Bumped to 0.7.4
- 2024-02-04: Metadata contains song, bugfixes and minify
- 2024-01-24: Added config object, Modland player
- 2024-01-23: Drag'n'Drop files. Build library using Docker.
- 2024-01-22: Libopenmpt 0.7.3 compiled with Emscripten 3.1.51

## License

All code in this project is MIT (X11) licensed. The only exception are the compiled libopenmpt parts which remain under the OpenMPT project BSD license.

License text below:

>Copyright © 2013-2026 The chiptune2.js/chiptune3.js contributers.
>
>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

