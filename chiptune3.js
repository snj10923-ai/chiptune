/*
	chiptune3 (worklet version)
	based on: https://deskjet.github.io/chiptune2.js/
*/

const defaultCfg = {
	repeatCount: -1,		// -1 = play endless, 0 = play once, do not repeat
	stereoSeparation: 100,	// percents
	interpolationFilter: 0,	// https://lib.openmpt.org/doc/group__openmpt__module__render__param.html
	context: false,
}

export class ChiptuneJsPlayer {
	constructor(cfg) {
		this.config = {...defaultCfg, ...cfg}

			if (this.config.context) {
			if (!this.config.context.destination) {
				throw('ChiptuneJsPlayer: This is not an audio context')
			}
			this.context = this.config.context
			this.destination = false
		} else {
			this.context = new AudioContext()
			this.destination = this.context.destination
		}

		console.log(
			'[AUDIO CONTEXT]',
			'sampleRate=', this.context.sampleRate,
			'state=', this.context.state,
			'baseLatency=', this.context.baseLatency
		)

		delete this.config.context
		
		// make gainNode
		this.gain = this.context.createGain()
		this.gain.gain.value = 1

// Audio warm-up — пробуждаем аудиотракт Android/Chrome
const osc = this.context.createOscillator()
const warmupGain = this.context.createGain()

warmupGain.gain.value = 0

osc.connect(warmupGain)
warmupGain.connect(this.context.destination)

osc.start()
osc.stop(this.context.currentTime + 0.5)

		this.handlers = []
		this._playGen = 0 // номер текущей попытки воспроизведения (см. chiptune3.worklet.js)

		// worklet
		this.context.audioWorklet.addModule( new URL('./chiptune3.worklet.js', import.meta.url) )
		.then(()=>{
			this.processNode = new AudioWorkletNode(this.context, 'libopenmpt-processor', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2]
			})
			// message port
			this.processNode.port.onmessage = this.handleMessage_.bind(this)
			this.processNode.port.postMessage({cmd:'config', val:this.config})
			// onInitialized теперь вызывается позже — см. handleMessage_,
			// случай 'ready' (когда движок libopenmpt внутри воркера
			// реально загрузился, а не просто создался сам узел)

			// audio routing
			this.processNode.connect(this.gain)
			if (this.destination) this.gain.connect(this.destination)	// also connect to output if no gainNode was given
		})
		.catch(e=>console.error(e))
	}

	// msg from worklet
	handleMessage_(msg) {
		switch (msg.data.cmd) {
			case 'ready':
				this.fireEvent('onInitialized')
				break
			case 'meta':
				if (msg.data.gen !== this._playGen) break // "хвост" от уже сброшенного трека
				this.meta = msg.data.meta
				this.duration = msg.data.meta.dur
				this.fireEvent('onMetadata', this.meta)
				break
			case 'pos':
				if (msg.data.gen !== this._playGen) break // "хвост" от уже сброшенного трека
				//this.meta.pos = msg.data.pos
	
				this.currentTime = msg.data.pos
				this.order = msg.data.order
				this.pattern = msg.data.pattern
				this.row = msg.data.row
				this.fireEvent('onProgress', msg.data)
				break
			case 'end':
				if (msg.data.gen !== this._playGen) break // "хвост" от уже сброшенного трека — игнорируем
				this.fireEvent('onEnded')
				break
			case 'err':
				if (msg.data.gen !== this._playGen) break // то же самое для ошибок
				this.fireEvent('onError', {type: msg.data.val})
				break
			case 'fullAudioData':
				this.fireEvent('onFullAudioData', msg.data)
				break
			default:
				console.log('Received unknown message',msg.data)
		}
	}

	// handlers
	fireEvent(eventName, response) {
		const handlers = this.handlers
		if (handlers.length) {
			handlers.forEach(function (handler) {
				if (handler.eventName === eventName) {
					handler.handler(response)
				}
			})
		}
	}
	addHandler(eventName, handler) { this.handlers.push({eventName: eventName, handler: handler}) }
	onInitialized(handler) { this.addHandler('onInitialized', handler) }
	onEnded(handler) { this.addHandler('onEnded', handler) }
	onError(handler) { this.addHandler('onError', handler) }
	onMetadata(handler) { this.addHandler('onMetadata', handler) }
	onProgress(handler) { this.addHandler('onProgress', handler) }
	onFullAudioData(handler) { this.addHandler('onFullAudioData', handler) }

	// methods
	postMsg(cmd, val) {
		if (this.processNode)
			this.processNode.port.postMessage({cmd:cmd,val:val})
	}
	load(url) {
		fetch(url)
		.then(response => response.arrayBuffer())
		.then(arrayBuffer => this.play(arrayBuffer))
		.catch(e=>{this.fireEvent('onError', {type: 'Load'})})
	}
	play(val) {
	this._playGen = (this._playGen || 0) + 1

	console.log(
		'[PLAY]',
		'sampleRate=', this.context.sampleRate,
		'state=', this.context.state,
		'currentTime=', this.context.currentTime
	)

	this.postMsg('play', { buffer: val, gen: this._playGen })
}
	stop() { this.postMsg('stop') }
	pause() { this.postMsg('pause') }
	unpause() { this.postMsg('unpause') }
	togglePause() { this.postMsg('togglePause') }
	setRepeatCount(val) { this.postMsg('repeatCount', val) }
	//setPitch(val) { this.postMsg('setPitch', val) }
	//setTempo(val) { this.postMsg('setTempo', val) }
	setCtl(name, val) { this.postMsg('setCtl', { name, val }) }					// Generic forwarder for any ctl_set(key, value) pair
	setPitch(val) { this.postMsg('setCtl', {name:'play.pitch_factor', val:val}) }
	setTempo(val) { this.postMsg('setCtl', {name:'play.tempo_factor', val:val}) }
	setStereoSeparation(val) { this.postMsg('setStereoSeparation', val*1) }		// 0..200 default=100
	setPos(val) { this.postMsg('setPos', val) }
	setOrderRow(o,r) { this.postMsg('setOrderRow', {o:o,r:r}) }
	setVol(val) { this.gain.gain.value = val }
	selectSubsong(val) { this.postMsg('selectSubsong', val) }
	// compatibility
	seek(val) { this.setPos(val) }
	getCurrentTime() { return this.currentTime }
	decodeAll(ab) { this.postMsg('decodeAll', ab) }
}
