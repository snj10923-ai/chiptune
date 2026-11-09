# Changes compared with upstream chiptune3 / Что изменено относительно оригинала

Base: [DrSnuggles/chiptune](https://github.com/DrSnuggles/chiptune) (chiptune3, MIT), compared with the npm package `chiptune3@0.8.9`.

## English

### `chiptune3.js`
- **Playback generations.** Every `play()` increments a generation counter and sends it to the worklet; messages (`onEnded`, metadata, errors) that arrive with an old generation are ignored. This stops "tails" of a previous track from firing events for the next one when the user skips tracks quickly.
- **`ready` event.** `onInitialized` now fires when libopenmpt has actually finished loading inside the worklet (message `ready`), not just when the audio node has been created.
- **Audio warm-up.** A silent oscillator is played for ~0.5 s on creation to wake up the audio path on Android/Chrome.
- **Diagnostics.** The audio context state (`sampleRate`, `state`, `baseLatency`) is logged on creation and on `play()`.
- The `context` option is read from the config object as before (minor code style differences with upstream).

### `chiptune3.worklet.js` (13 KB → 21 KB)
- **Internal PCM queue (ring buffer, 32768 frames ≈ 0.74 s at 44.1 kHz).** libopenmpt is asked for audio in chunks of 1024 frames and the audio callback only reads from the queue, so a slow or uneven `process()` call no longer causes dropouts.
- **Start buffering.** Playback starts after ~8192 frames (≈186 ms) are queued; silence is output until then.
- **Correct end of track.** The `end` event is sent only when libopenmpt has finished *and* the queue has been fully played, so the last 0.7 s are not cut off.
- **Engine readiness.** The libopenmpt promise is created once and every processor instance waits for it; the worklet reports `ready` to the main thread.
- **Clean stop/restart.** Queue and counters are reset on `stop`/`play`; the temporary file buffer is released after the module is created.
- **Generation tagging.** Every outgoing message carries the generation sent by `play()`.
- Built-in diagnostics counters (process calls, empty renders, played frames, timing between `process()` calls).
- Removed commented-out legacy stubs (`setPitch`/`setTempo`/`toggleMute` message cases; pitch and tempo still work through `setCtl`, as in upstream's public API). Channel muting (`toggleMute`) was never active in upstream (it was commented out) and is not available here either.

### `libopenmpt.worklet.js` + `libopenmpt.wasm`
- libopenmpt **0.8.9** (the engine string inside the build reports `libopenmpt-0.8.9`).
- The WebAssembly binary is **not embedded** in the JS file any more: the worklet loads `libopenmpt.wasm` (≈1.25 MB) from the same folder by URL, and the JS file is ≈133 KB. Keep both files in the same directory.
- libopenmpt itself is under the BSD-3-Clause license of the OpenMPT project.

## Русский

### `chiptune3.js`
- **Поколения воспроизведения.** Каждый `play()` увеличивает счётчик и передаёт его в воркле; сообщения со старым номером (конец трека, метаданные, ошибки) игнорируются. Так «хвосты» предыдущего трека не вызывают события у следующего при быстром переключении.
- **Событие `ready`.** `onInitialized` теперь срабатывает, когда libopenmpt реально загрузился внутри воркле, а не просто создан аудио-узел.
- **Прогрев аудиотракта.** При создании на ~0,5 с играет беззвучный осциллятор, чтобы «разбудить» звук на Android/Chrome.
- **Диагностика.** В консоль выводятся параметры аудиоконтекста при создании и при `play()`.

### `chiptune3.worklet.js` (13 КБ → 21 КБ)
- **Внутренняя очередь PCM** (кольцевой буфер на 32768 кадров ≈ 0,74 с). libopenmpt рендерит блоками по 1024 кадра, а аудиоколбэк только читает из очереди, поэтому неровные вызовы `process()` не дают прерываний звука.
- **Стартовая буферизация:** воспроизведение начинается, когда накоплено ~8192 кадров (≈186 мс); до этого отдаётся тишина.
- **Корректный конец трека:** событие конца отправляется, только когда libopenmpt закончил **и** очередь полностью проиграна (последние ~0,7 с не обрезаются).
- **Готовность движка:** промис libopenmpt создаётся один раз, все экземпляры процессора ждут его; воркле сообщает `ready`.
- **Чистая остановка и перезапуск:** очередь и счётчики сбрасываются, временный буфер файла освобождается после создания модуля.
- **Метки поколений** во всех исходящих сообщениях.
- Диагностические счётчики (вызовы `process`, пустые рендеры, проигранные кадры, интервалы между вызовами).
- Убраны закомментированные заглушки (`setPitch`/`setTempo`/`toggleMute`); высота и темп работают через `setCtl`, как в публичном API оригинала. Отключение каналов (`toggleMute`) в оригинале не было реализовано и здесь тоже недоступно.

### `libopenmpt.worklet.js` + `libopenmpt.wasm`
- libopenmpt **0.8.9** (внутри сборки указана версия `libopenmpt-0.8.9`).
- WebAssembly-бинарник **не вшит** в JS: воркле загружает `libopenmpt.wasm` (≈1,25 МБ) из той же папки по ссылке, а JS-файл весит ≈133 КБ. Оба файла должны лежать в одной папке.
- Сама libopenmpt распространяется по лицензии BSD-3-Clause проекта OpenMPT.

## How these changes were made / Как это сделано
The changes were written by **Claude (Anthropic, AI assistant)** at the request and under the direction of the fork author, and tested in real use (desktop Chrome and Android Chrome) while building a personal tracker-music web player. / Изменения написаны ассистентом **Claude (Anthropic)** по запросу и под руководством автора форка и проверены на практике (Chrome на ПК и на Android) при создании личного веб-плеера трекерной музыки.
