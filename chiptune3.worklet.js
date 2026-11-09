/*
	AudioWorklet: DrSnuggles
*/

import libopenmptPromise from './libopenmpt.worklet.js'

// consts
const OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT = 2
const OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3

// Сколько кадров генерируем за один вызов libopenmpt.
const RENDER_CHUNK_FRAMES = 1024

// Размер внутренней PCM-очереди.
// 32768 кадров ≈ 0.74 сек при 44.1 kHz.
const AUDIO_QUEUE_CAPACITY = 32768

// Сколько кадров желательно иметь в очереди перед началом воспроизведения.
// 8192 ≈ 186 мс при 44.1 kHz.
const AUDIO_QUEUE_START_TARGET = 8192

// vars
let libopenmpt

// init — сохраняем сам промис, чтобы не пересоздавать движок повторно,
// а просто подписываться на его готовность из каждого экземпляра процессора
const libopenmptReady = libopenmptPromise()
	.then(res => {
		libopenmpt = res

		if (!libopenmpt.stackSave) return

		// set libopenmpt version to display later
		let stack = libopenmpt.stackSave()

		libopenmpt.version =
			libopenmpt.UTF8ToString(
				libopenmpt._openmpt_get_string(
					asciiToStack('library_version')
				)
			)

		libopenmpt.build =
			libopenmpt.UTF8ToString(
				libopenmpt._openmpt_get_string(
					asciiToStack('build')
				)
			)

		libopenmpt.stackRestore(stack)
	})
	.catch(e => console.error(e))


//
// Helpers
//

function asciiToStack(str) {
	const stackStr = libopenmpt.stackAlloc(str.length + 1)
	writeAsciiToMemory(str, stackStr)
	return stackStr
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
	for (let i = 0; i < str.length; ++i) {
		libopenmpt.HEAP8[buffer++ >> 0] = str.charCodeAt(i)
	}

	if (!dontAddNull) {
		libopenmpt.HEAP8[buffer >> 0] = 0
	}
}


//
// Processor
//

class MPT extends AudioWorkletProcessor {

	constructor() {
		super()

		this.port.onmessage = this.handleMessage_.bind(this)

		this.paused = false

		// Номер текущей попытки воспроизведения.
		// Позволяет главному потоку отличать актуальные сообщения
		// от хвоста событий старого трека.
		this.gen = 0

		this.endedReported = false

		this.config = {
			repeatCount: -1,
			stereoSeparation: 100,
			interpolationFilter: 0,
		}

		this.channels = 0


		//
		// PCM queue
		//

		this.audioQueueLeft = new Float32Array(AUDIO_QUEUE_CAPACITY)
		this.audioQueueRight = new Float32Array(AUDIO_QUEUE_CAPACITY)

		this.audioQueueRead = 0
		this.audioQueueWrite = 0
		this.audioQueueFrames = 0

		// libopenmpt уже сообщил конец файла,
		// но PCM в очереди ещё может оставаться.
		this.moduleEnded = false

		// Начинаем отдавать звук браузеру только после небольшого
		// начального заполнения очереди.
		this.queueReady = false


		//
		// Diagnostics
		//

		this.processCalls = 0

		this.preModuleProcessCalls = 0
		this.totalPreModuleProcessCalls = 0

		this.pausedProcessCalls = 0
		this.emptyRenderCalls = 0

		this.renderedFrames = 0
		this.queuedFramesTotal = 0
		this.playedFrames = 0

		this.firstPcmTime = null
		this.playStartTime = null

		this.lastProcessTime = null
		this.maxProcessGap = 0

		this.diagSent = false
		this.lastPosReportTime = -Infinity

		this.queueUnderruns = 0
		this.renderCalls = 0
		this.moduleEndTime = null


		//
		// Сообщаем главному потоку, когда libopenmpt
		// реально готов принимать файлы.
		//

		libopenmptReady.then(() => {
			this.port.postMessage({
				cmd: 'ready'
			})
		})
	}


	//
	// AudioWorklet process
	//

	process(inputList, outputList, parameters) {

		this.processCalls++


		//
		// Движок ещё не готов / модуль ещё не создан.
		//

		if (!this.modulePtr || !this.leftPtr || !this.rightPtr) {

			this.preModuleProcessCalls++
			this.totalPreModuleProcessCalls++

			return true
		}


		//
		// Пауза.
		//

		if (this.paused) {

			this.pausedProcessCalls++

			return true
		}


		const left = outputList[0][0]
		const right = outputList[0][1]

		const framesNeeded = Math.min(left.length, 128)


		//
		// Сначала пытаемся наполнить очередь.
		//
		// Генерируем крупными блоками по 1024 кадра.
		//

		this.fillAudioQueue_()


		//
		// Если начальный буфер ещё не набран —
		// отдаём тишину.
		//

		if (!this.queueReady) {

			if (this.audioQueueFrames < AUDIO_QUEUE_START_TARGET) {

				left.fill(0)
				right.fill(0)

				return true
			}

			this.queueReady = true

			console.log(
				'[AUDIO QUEUE READY]',
				'frames=', this.audioQueueFrames,
				'seconds=', this.audioQueueFrames / sampleRate
			)
		}


		//
		// Забираем маленькую порцию из очереди.
		//

		let copiedFrames = 0

		while (
			copiedFrames < framesNeeded &&
			this.audioQueueFrames > 0
		) {

			left[copiedFrames] =
				this.audioQueueLeft[this.audioQueueRead]

			right[copiedFrames] =
				this.audioQueueRight[this.audioQueueRead]

			this.audioQueueRead++

			if (this.audioQueueRead >= AUDIO_QUEUE_CAPACITY) {
				this.audioQueueRead = 0
			}

			this.audioQueueFrames--
			copiedFrames++
			this.playedFrames++
		}


		//
		// Если очередь внезапно опустела,
		// остаток quantum заполняем тишиной.
		//

		if (copiedFrames < framesNeeded) {

			this.queueUnderruns++

			for (
				let i = copiedFrames;
				i < framesNeeded;
				i++
			) {
				left[i] = 0
				right[i] = 0
			}
		}


		//
		// Первый реально отданный PCM.
		//

		if (
			copiedFrames > 0 &&
			this.firstPcmTime === null
		) {
			this.firstPcmTime = currentTime
		}


		//
		// Диагностика времени между process().
		//

		if (this.lastProcessTime !== null) {

			const gap = currentTime - this.lastProcessTime

			if (gap > this.maxProcessGap) {
				this.maxProcessGap = gap
			}
		}

		this.lastProcessTime = currentTime


		//
		// ВАЖНО:
		//
		// libopenmpt уже мог закончить генерацию,
		// но очередь ещё содержит звук.
		//
		// Поэтому END отправляем только здесь,
		// когда одновременно:
		//
		// moduleEnded === true
		// audioQueueFrames === 0
		//

		if (
			this.moduleEnded &&
			this.audioQueueFrames === 0 &&
			!this.endedReported
		) {

			this.endedReported = true

			this.postDiagnostics_('end')

			this.port.postMessage({
				cmd: 'end',
				gen: this.gen
			})
		}


		//
		// Позиция трека.
		//

		if (currentTime - this.lastPosReportTime >= 0.05) {

			this.lastPosReportTime = currentTime

			if (this.modulePtr) {

				const msg = {
					cmd: 'pos',
					gen: this.gen,

					pos:
						libopenmpt._openmpt_module_get_position_seconds(
							this.modulePtr
						),

					order:
						libopenmpt._openmpt_module_get_current_order(
							this.modulePtr
						),

					pattern:
						libopenmpt._openmpt_module_get_current_pattern(
							this.modulePtr
						),

					row:
						libopenmpt._openmpt_module_get_current_row(
							this.modulePtr
						),
				}

				this.port.postMessage(msg)
			}
		}


		return true
	}


	//
	// Наполнение внутренней очереди.
	//
	// Один вызов libopenmpt = до 1024 PCM frames.
	//

	fillAudioQueue_() {

		if (!this.modulePtr) return

		if (this.moduleEnded) return


		//
		// Если места меньше одного полноценного чанка,
		// ждём следующего момента.
		//

		const freeFrames =
			AUDIO_QUEUE_CAPACITY - this.audioQueueFrames

		if (freeFrames < RENDER_CHUNK_FRAMES) {
			return
		}


		//
		// Не нужно генерировать огромный запас.
		//
		// Если очередь уже достаточно заполнена,
		// ничего не делаем.
		//

		if (this.audioQueueFrames >= AUDIO_QUEUE_START_TARGET) {
			return
		}


		const framesToRender = RENDER_CHUNK_FRAMES


		const actualFramesPerChunk =
			libopenmpt._openmpt_module_read_float_stereo(
				this.modulePtr,
				sampleRate,
				framesToRender,
				this.leftPtr,
				this.rightPtr
			)

		this.renderCalls++


		//
		// 0 = libopenmpt больше ничего не генерирует.
		//

		if (actualFramesPerChunk === 0) {

			this.emptyRenderCalls++

			this.moduleEnded = true
			this.moduleEndTime = currentTime

			//
			// Не отправляем END здесь!
			//
			// Очередь должна сначала полностью проиграться.

			return
		}


		//
		// Получаем PCM из HEAP.
		//

		const pcmLeft =
			libopenmpt.HEAPF32.subarray(
				this.leftPtr / 4,
				this.leftPtr / 4 + actualFramesPerChunk
			)

		const pcmRight =
			libopenmpt.HEAPF32.subarray(
				this.rightPtr / 4,
				this.rightPtr / 4 + actualFramesPerChunk
			)


		//
		// Кладём PCM в ring buffer.
		//

		for (let i = 0; i < actualFramesPerChunk; i++) {

			this.audioQueueLeft[this.audioQueueWrite] =
				pcmLeft[i]

			this.audioQueueRight[this.audioQueueWrite] =
				pcmRight[i]

			this.audioQueueWrite++

			if (
				this.audioQueueWrite >=
				AUDIO_QUEUE_CAPACITY
			) {
				this.audioQueueWrite = 0
			}

			this.audioQueueFrames++

			this.queuedFramesTotal++
		}


		this.renderedFrames += actualFramesPerChunk
	}


	//
	// Messages from main thread
	//

	handleMessage_(msg) {

		const v = msg.data.val

		switch (msg.data.cmd) {

			case 'config':

				this.config = v

				break


			case 'play':

				this.gen = v.gen

				this.play(v.buffer, false)

				break


			case 'pause':

				this.paused = true

				break


			case 'unpause':

				this.paused = false

				break


			case 'togglePause':

				this.paused = !this.paused

				break


			case 'stop':

				this.stop()

				break


			case 'meta':

				this.meta()

				break


			case 'repeatCount':

				this.config.repeatCount = v

				if (!this.modulePtr) return

				libopenmpt._openmpt_module_set_repeat_count(
					this.modulePtr,
					this.config.repeatCount
				)

				break


			case 'setCtl':

				if (
					!libopenmpt.stackSave ||
					!this.modulePtr
				) {
					return
				}

				const stack = libopenmpt.stackSave()

				libopenmpt._openmpt_module_ctl_set(
					this.modulePtr,
					asciiToStack(v.name),
					asciiToStack(v.val)
				)

				libopenmpt.stackRestore(stack)

				break


			case 'setStereoSeparation':

				if (!this.modulePtr) return

				const n =
					Number.isFinite(v)
						? Math.max(
							0,
							Math.min(200, Math.trunc(v))
						)
						: 100

				this.config.stereoSeparation = n

				libopenmpt._openmpt_module_set_render_param(
					this.modulePtr,
					OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT,
					n
				)

				break


			case 'selectSubsong':

				if (!this.modulePtr) return

				libopenmpt._openmpt_module_select_subsong(
					this.modulePtr,
					v
				)

				break


			case 'setPos':

				if (!this.modulePtr) return

				libopenmpt._openmpt_module_set_position_seconds(
					this.modulePtr,
					v
				)

				break


			case 'setOrderRow':

				if (!this.modulePtr) return

				libopenmpt._openmpt_module_set_position_order_row(
					this.modulePtr,
					v.o,
					v.r
				)

				break


			case 'decodeAll':

				this.decodeAll(v)

				break


			default:

				console.log(
					'Received unknown message',
					msg.data
				)
		}
	}


	//
	// Decode entire module
	//

	decodeAll(buffer) {

		this.play(buffer, true)

		const left = []
		const right = []

		const maxFramesPerChunk = RENDER_CHUNK_FRAMES

		let actualFramesPerChunk =
			libopenmpt._openmpt_module_read_float_stereo(
				this.modulePtr,
				sampleRate,
				maxFramesPerChunk,
				this.leftPtr,
				this.rightPtr
			)

		while (actualFramesPerChunk != 0) {

			left.push(
				...libopenmpt.HEAPF32.subarray(
					this.leftPtr / 4,
					this.leftPtr / 4 + actualFramesPerChunk
				)
			)

			right.push(
				...libopenmpt.HEAPF32.subarray(
					this.rightPtr / 4,
					this.rightPtr / 4 + actualFramesPerChunk
				)
			)

			actualFramesPerChunk =
				libopenmpt._openmpt_module_read_float_stereo(
					this.modulePtr,
					sampleRate,
					maxFramesPerChunk,
					this.leftPtr,
					this.rightPtr
				)
		}


		const msg = {
			cmd: 'fullAudioData',
			meta: this.getMeta(),
			data: [left, right]
		}

		this.port.postMessage(msg)

		this.stop()
	}


	//
	// Start playback
	//

	play(buffer, paused = false) {

		this.stop()

		this.endedReported = false

		//
		// Reset PCM queue.
		//

		this.audioQueueRead = 0
		this.audioQueueWrite = 0
		this.audioQueueFrames = 0

		this.moduleEnded = false
		this.queueReady = false


		const maxFramesPerChunk = RENDER_CHUNK_FRAMES

		const byteArray = new Int8Array(buffer)

		const ptrToFile =
			libopenmpt._malloc(byteArray.byteLength)

		libopenmpt.HEAPU8.set(
			byteArray,
			ptrToFile
		)


		this.modulePtr =
			libopenmpt._openmpt_module_create_from_memory(
				ptrToFile,
				byteArray.byteLength,
				0,
				0,
				0
			)


		//
		// После создания модуля временный буфер файла
		// больше не нужен.
		//

		libopenmpt._free(ptrToFile)


		this.playStartTime = currentTime
		this.firstPcmTime = null

		this.lastProcessTime = null
		this.maxProcessGap = 0

		this.diagSent = false

		this.lastPosReportTime = -Infinity

		this.renderedFrames = 0
		this.queuedFramesTotal = 0
		this.playedFrames = 0

		this.queueUnderruns = 0
		this.renderCalls = 0

		this.moduleEndTime = null


		//
		// Module creation failed.
		//

		if (this.modulePtr === 0) {

			this.postDiagnostics_(
				'module-create-error'
			)

			this.port.postMessage({
				cmd: 'err',
				val: 'ptr',
				gen: this.gen
			})

			return
		}


		//
		// Amiga resampler.
		//

		if (libopenmpt.stackSave) {

			const stack =
				libopenmpt.stackSave()

			libopenmpt._openmpt_module_ctl_set(
				this.modulePtr,
				asciiToStack(
					'render.resampler.emulate_amiga'
				),
				asciiToStack('1')
			)

			libopenmpt._openmpt_module_ctl_set(
				this.modulePtr,
				asciiToStack(
					'render.resampler.emulate_amiga_type'
				),
				asciiToStack('a1200')
			)

			libopenmpt.stackRestore(stack)
		}


		this.paused = paused


		//
		// Эти буферы теперь нужны именно для
		// одного 1024-frame render().
		//

		this.leftPtr =
			libopenmpt._malloc(
				4 * maxFramesPerChunk
			)

		this.rightPtr =
			libopenmpt._malloc(
				4 * maxFramesPerChunk
			)


		libopenmpt._openmpt_module_set_repeat_count(
			this.modulePtr,
			this.config.repeatCount
		)

		libopenmpt._openmpt_module_set_render_param(
			this.modulePtr,
			OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT,
			this.config.stereoSeparation
		)

		libopenmpt._openmpt_module_set_render_param(
			this.modulePtr,
			OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH,
			this.config.interpolationFilter
		)

		// тяжелый meta
		// if (!paused) this.meta()
	}


	//
	// Stop
	//

	stop() {

		if (
			this.modulePtr ||
			this.leftPtr ||
			this.rightPtr
		) {
			this.postDiagnostics_('stop')
		}


		if (this.modulePtr) {

			libopenmpt._openmpt_module_destroy(
				this.modulePtr
			)

			this.modulePtr = 0
		}


		if (this.leftPtr) {

			libopenmpt._free(
				this.leftPtr
			)

			this.leftPtr = 0
		}


		if (this.rightPtr) {

			libopenmpt._free(
				this.rightPtr
			)

			this.rightPtr = 0
		}


		this.channels = 0


		//
		// Очередь тоже сбрасываем.
		//

		this.audioQueueRead = 0
		this.audioQueueWrite = 0
		this.audioQueueFrames = 0

		this.moduleEnded = false
		this.queueReady = false
	}


	//
	// Diagnostics
	//

	postDiagnostics_(reason) {

		if (this.diagSent) return

		this.diagSent = true


		const data = {

			cmd: 'diag',

			gen: this.gen,

			reason,

			libReady: !!libopenmpt,

			processCalls:
				this.processCalls,

			preModuleProcessCalls:
				this.preModuleProcessCalls,

			totalPreModuleProcessCalls:
				this.totalPreModuleProcessCalls,

			pausedProcessCalls:
				this.pausedProcessCalls,

			emptyRenderCalls:
				this.emptyRenderCalls,

			renderCalls:
				this.renderCalls,

			renderedFrames:
				this.renderedFrames,

			queuedFramesTotal:
				this.queuedFramesTotal,

			playedFrames:
				this.playedFrames,

			queueFrames:
				this.audioQueueFrames,

			queueUnderruns:
				this.queueUnderruns,

			moduleEnded:
				this.moduleEnded,

			firstPcmDelay:
				this.firstPcmTime === null ||
				this.playStartTime === null
					? null
					: this.firstPcmTime -
						this.playStartTime,

			maxProcessGap:
				this.maxProcessGap
		}


		console.log(
			'[chiptune3 diag]',
			data
		)

		this.port.postMessage(data)
	}


	//
	// Metadata
	//

	meta() {

		this.port.postMessage({
			cmd: 'meta',
			gen: this.gen,
			meta: this.getMeta()
		})
	}


	getSong() {

		if (
			!libopenmpt.UTF8ToString ||
			!this.modulePtr
		) {
			return false
		}


		let song = {

			channels: [],

			instruments: [],

			samples: [],

			orders: [],

			numSubsongs:
				libopenmpt._openmpt_module_get_num_subsongs(
					this.modulePtr
				),

			patterns: [],
		}


		const chNum =
			libopenmpt._openmpt_module_get_num_channels(
				this.modulePtr
			)

		this.channel = chNum


		for (let i = 0; i < chNum; i++) {

			song.channels.push(
				libopenmpt.UTF8ToString(
					libopenmpt._openmpt_module_get_channel_name(
						this.modulePtr,
						i
					)
				)
			)
		}


		for (
			let i = 0,
			e =
				libopenmpt._openmpt_module_get_num_instruments(
					this.modulePtr
				);
			i < e;
			i++
		) {

			song.instruments.push(
				libopenmpt.UTF8ToString(
					libopenmpt._openmpt_module_get_instrument_name(
						this.modulePtr,
						i
					)
				)
			)
		}


		for (
			let i = 0,
			e =
				libopenmpt._openmpt_module_get_num_samples(
					this.modulePtr
				);
			i < e;
			i++
		) {

			song.samples.push(
				libopenmpt.UTF8ToString(
					libopenmpt._openmpt_module_get_sample_name(
						this.modulePtr,
						i
					)
				)
			)
		}


		for (
			let i = 0,
			e =
				libopenmpt._openmpt_module_get_num_orders(
					this.modulePtr
				);
			i < e;
			i++
		) {

			song.orders.push({

				name:
					libopenmpt.UTF8ToString(
						libopenmpt._openmpt_module_get_order_name(
							this.modulePtr,
							i
						)
					),

				pat:
					libopenmpt._openmpt_module_get_order_pattern(
						this.modulePtr,
						i
					),
			})
		}


		for (
			let patIdx = 0,
			patNum =
				libopenmpt._openmpt_module_get_num_patterns(
					this.modulePtr
				);
			patIdx < patNum;
			patIdx++
		) {

			const pattern = {

				name:
					libopenmpt.UTF8ToString(
						libopenmpt._openmpt_module_get_pattern_name(
							this.modulePtr,
							patIdx
						)
					),

				rows: [],
			}


			for (
				let rowIdx = 0,
				rowNum =
					libopenmpt._openmpt_module_get_pattern_num_rows(
						this.modulePtr,
						patIdx
					);
				rowIdx < rowNum;
				rowIdx++
			) {

				const row = []


				for (
					let chIdx = 0;
					chIdx < chNum;
					chIdx++
				) {

					const channel = []


					for (
						let comIdx = 0;
						comIdx < 6;
						comIdx++
					) {

						channel.push(
							libopenmpt._openmpt_module_get_pattern_row_channel_command(
								this.modulePtr,
								patIdx,
								rowIdx,
								chIdx,
								comIdx
							)
						)
					}


					row.push(channel)
				}


				pattern.rows.push(row)
			}


			song.patterns.push(pattern)
		}


		return song
	}


	getMeta() {

		if (
			!libopenmpt.UTF8ToString ||
			!this.modulePtr
		) {
			return false
		}


		const data = {}


		data.dur =
			libopenmpt._openmpt_module_get_duration_seconds(
				this.modulePtr
			)


		if (data.dur == 0) {

			this.port.postMessage({
				cmd: 'err',
				val: 'dur',
				gen: this.gen
			})
		}


		const keys =
			libopenmpt.UTF8ToString(
				libopenmpt._openmpt_module_get_metadata_keys(
					this.modulePtr
				)
			).split(';')


		for (
			let i = 0;
			i < keys.length;
			i++
		) {

			const keyNameBuffer =
				libopenmpt._malloc(
					keys[i].length + 1
				)

			writeAsciiToMemory(
				keys[i],
				keyNameBuffer
			)


			data[keys[i]] =
				libopenmpt.UTF8ToString(
					libopenmpt._openmpt_module_get_metadata(
						this.modulePtr,
						keyNameBuffer
					)
				)


			libopenmpt._free(
				keyNameBuffer
			)
		}


		data.song = this.getSong()

		data.totalOrders =
			data.song.orders.length

		data.totalPatterns =
			data.song.patterns.length

		data.songs =
			this.getSongs()

		data.libopenmptVersion =
			libopenmpt.version

		data.libopenmptBuild =
			libopenmpt.build


		return data
	}


	getSongs() {

		if (!libopenmpt.UTF8ToString) {
			return ''
		}


		const subsongs =
			libopenmpt._openmpt_module_get_num_subsongs(
				this.modulePtr
			)

		const names = []


		for (
			let i = 0;
			i < subsongs;
			i++
		) {

			const namePtr =
				libopenmpt._openmpt_module_get_subsong_name(
					this.modulePtr,
					i
				)

			const name =
				libopenmpt.UTF8ToString(
					namePtr
				)


			if (name != '') {

				names.push(name)

			} else {

				names.push(
					'Subsong ' + (i + 1)
				)
			}


			libopenmpt._openmpt_free_string(
				namePtr
			)
		}


		return names
	}
}


registerProcessor(
	'libopenmpt-processor',
	MPT
)