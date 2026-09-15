/**
 * FL Studio Clone — Auto-Tune Engine
 * Real-time pitch detection (YIN autocorrelation) + scale quantization
 * + AudioWorklet pitch shifter (loaded via Blob URL for file:// compatibility)
 */

// ── AudioWorklet source (loaded via Blob URL) ──────────────────────────────
const PITCH_SHIFTER_WORKLET_CODE = `
/**
 * Granular pitch shifter using overlap-add synthesis.
 * Runs off the main thread in the audio processing graph.
 */
class PitchShifterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitchRatio', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'wetDry',     defaultValue: 1.0, minValue: 0.0,  maxValue: 1.0, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this._grainSize    = 1024;
    this._overlapCount = 4;
    this._hopSize      = this._grainSize / this._overlapCount;
    this._bufLen       = this._grainSize * 4;

    // Circular input buffer
    this._inputBuf  = new Float32Array(this._bufLen);
    this._outputBuf = new Float32Array(this._bufLen);
    this._writePtr  = 0;
    this._readPtr   = 0;

    // Hann window
    this._window = new Float32Array(this._grainSize);
    for (let i = 0; i < this._grainSize; i++) {
      this._window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / this._grainSize));
    }

    this._grainPhase = 0;
    this._pitchRatio = 1.0;

    this.port.onmessage = (e) => {
      if (e.data.pitchRatio !== undefined) this._pitchRatio = e.data.pitchRatio;
    };
  }

  process(inputs, outputs, parameters) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input[0] || !output || !output[0]) return true;

    const inCh  = input[0];
    const outCh = output[0];
    const ratio = parameters.pitchRatio[0] ?? this._pitchRatio;
    const wet   = parameters.wetDry[0] ?? 1.0;
    const dry   = 1.0 - wet;

    // Write input into circular buffer
    for (let i = 0; i < inCh.length; i++) {
      this._inputBuf[(this._writePtr + i) % this._bufLen] = inCh[i];
    }

    // Granular pitch shifting
    for (let i = 0; i < outCh.length; i++) {
      // Read position scaled by pitch ratio
      const readPos  = (this._writePtr + i - this._grainSize * 2 + this._grainPhase * ratio) % this._bufLen;
      const readIdx  = ((Math.floor(readPos)) % this._bufLen + this._bufLen) % this._bufLen;
      const frac     = readPos - Math.floor(readPos);
      const nextIdx  = (readIdx + 1) % this._bufLen;

      // Interpolated read
      const sample = this._inputBuf[readIdx] * (1 - frac) + this._inputBuf[nextIdx] * frac;
      // Window blend
      const win = this._window[Math.abs(Math.floor(this._grainPhase)) % this._grainSize];
      outCh[i] = sample * win * wet + inCh[i] * dry;

      this._grainPhase = (this._grainPhase + 1) % this._grainSize;
    }

    this._writePtr = (this._writePtr + inCh.length) % this._bufLen;
    return true;
  }
}
registerProcessor('pitch-shifter', PitchShifterProcessor);
`;

// ── Note / Scale data ──────────────────────────────────────────────────────
const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_FREQS  = [16.35,17.32,18.35,19.45,20.60,21.83,23.12,24.50,25.96,27.50,29.14,30.87]; // C0–B0

const SCALES = {
  'Major':         [0, 2, 4, 5, 7, 9, 11],
  'Minor':         [0, 2, 3, 5, 7, 8, 10],
  'Harmonic Min':  [0, 2, 3, 5, 7, 8, 11],
  'Pentatonic':    [0, 2, 4, 7, 9],
  'Blues':         [0, 3, 5, 6, 7, 10],
  'Dorian':        [0, 2, 3, 5, 7, 9, 10],
  'Mixolydian':    [0, 2, 4, 5, 7, 9, 10],
  'Chromatic':     [0,1,2,3,4,5,6,7,8,9,10,11],
};

// ── Utility: freq ↔ MIDI ────────────────────────────────────────────────────
function freqToMidi(freq) {
  if (freq <= 0) return 0;
  return 69 + 12 * Math.log2(freq / 440);
}
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function midiToNoteName(midi) {
  const n = Math.round(midi);
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

// ── Main AutoTune Engine ───────────────────────────────────────────────────
class AutoTuneEngine {
  constructor(audioCtx) {
    this.ctx = audioCtx;

    // Config
    this.key      = 'C';
    this.scale    = 'Major';
    this.strength = 0.95;  // 0 = bypass, 1 = full correction
    this.speed    = 0.15;  // smoothing: 0.05 = fast/robotic, 0.4 = slow/natural

    // Signal chain nodes
    this.inputGain     = null;
    this.analyser      = null;
    this.pitchShifter  = null; // AudioWorkletNode
    this.outputGain    = null;
    this.workletReady  = false;

    // Detection state
    this.detectedFreq  = 0;
    this.detectedMidi  = 0;
    this.targetFreq    = 0;
    this.targetMidi    = 0;
    this.currentRatio  = 1.0;
    this.smoothRatio   = 1.0;
    this.isSilent      = true;
    this.rms           = 0;

    // History for pitch display graph
    this.pitchHistory     = [];
    this.correctedHistory = [];
    this.historyMaxLen    = 200;

    // Analysis buffer
    this._analyserBuf   = null;
    this._rafId         = null;
  }

  // ── Setup signal chain ────────────────────────────────────────────────────
  async setupChain() {
    // Load worklet via Blob URL (works on file://)
    const blob = new Blob([PITCH_SHIFTER_WORKLET_CODE], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    try {
      await this.ctx.audioWorklet.addModule(blobUrl);
      this.workletReady = true;
    } catch (e) {
      console.warn('AudioWorklet failed, falling back to bypass mode:', e);
      this.workletReady = false;
    }
    URL.revokeObjectURL(blobUrl);

    // Input gain (mic input level)
    this.inputGain = this.ctx.createGain();
    this.inputGain.gain.value = 1.0;

    // Analyser for pitch detection
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this._analyserBuf = new Float32Array(this.analyser.fftSize);

    // Pitch shifter worklet
    if (this.workletReady) {
      this.pitchShifter = new AudioWorkletNode(this.ctx, 'pitch-shifter', {
        numberOfInputs:  1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
    }

    // Output gain
    this.outputGain = this.ctx.createGain();
    this.outputGain.gain.value = 1.0;

    // Connect chain: inputGain → analyser → (pitchShifter?) → outputGain
    this.inputGain.connect(this.analyser);
    if (this.pitchShifter) {
      this.analyser.connect(this.pitchShifter);
      this.pitchShifter.connect(this.outputGain);
    } else {
      this.analyser.connect(this.outputGain);
    }

    return this;
  }

  // ── Connect mic stream source → chain → destination ────────────────────────
  connectSource(sourceNode, destinationNode) {
    sourceNode.connect(this.inputGain);
    this.outputGain.connect(destinationNode);
  }

  // ── Pitch detection: YIN-simplified autocorrelation ───────────────────────
  detectPitch() {
    this.analyser.getFloatTimeDomainData(this._analyserBuf);
    const buf = this._analyserBuf;
    const SIZE = buf.length;

    // RMS (silence detection)
    let rmsSum = 0;
    for (let i = 0; i < SIZE; i++) rmsSum += buf[i] * buf[i];
    this.rms = Math.sqrt(rmsSum / SIZE);

    if (this.rms < 0.012) {
      this.isSilent = true;
      return null;
    }
    this.isSilent = false;

    // Autocorrelation
    const HALF = Math.floor(SIZE / 2);
    let bestOffset = -1;
    let bestCorr   = 0;

    // Min/max lag for human voice + instruments (50 Hz – 2000 Hz)
    const sampleRate = this.ctx.sampleRate;
    const lagMin = Math.floor(sampleRate / 2000);
    const lagMax = Math.floor(sampleRate / 50);

    for (let lag = lagMin; lag < Math.min(lagMax, HALF); lag++) {
      let corr = 0;
      for (let i = 0; i < HALF; i++) {
        corr += buf[i] * buf[i + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = lag;
      }
    }

    if (bestOffset <= 0) return null;

    // Parabolic interpolation for sub-sample accuracy
    const x1 = bestOffset > 0           ? this._autocorr(buf, HALF, bestOffset - 1) : 0;
    const x2 = this._autocorr(buf, HALF, bestOffset);
    const x3 = bestOffset < HALF - 1    ? this._autocorr(buf, HALF, bestOffset + 1) : 0;
    const denom = x1 + x3 - 2 * x2;
    const refinedLag = denom !== 0
      ? bestOffset - 0.5 * (x3 - x1) / denom
      : bestOffset;

    const freq = sampleRate / refinedLag;

    // Sanity check: 50 Hz – 2000 Hz
    if (freq < 50 || freq > 2000) return null;

    return freq;
  }

  _autocorr(buf, half, lag) {
    let c = 0;
    for (let i = 0; i < half; i++) c += buf[i] * buf[i + lag];
    return c;
  }

  // ── Quantize frequency to nearest scale note ───────────────────────────────
  quantize(freq) {
    const keyIdx   = NOTE_NAMES.indexOf(this.key);
    const scaleDeg = SCALES[this.scale] || SCALES['Major'];
    const midi     = freqToMidi(freq);

    // Try all candidate MIDI notes within ±1 octave
    let bestMidi = Math.round(midi);
    let bestDist = Infinity;

    for (let oct = -1; oct <= 1; oct++) {
      for (const deg of scaleDeg) {
        const candidate = Math.round(midi / 12) * 12 + keyIdx + deg + oct * 12;
        const dist = Math.abs(candidate - midi);
        if (dist < bestDist) {
          bestDist = dist;
          bestMidi = candidate;
        }
      }
    }

    return {
      targetMidi: bestMidi,
      targetFreq: midiToFreq(bestMidi),
      semitoneShift: bestMidi - midi,
      noteName: midiToNoteName(bestMidi),
    };
  }

  // ── Main update loop — call this on every animation frame ─────────────────
  update() {
    const freq = this.detectPitch();

    if (freq !== null && !this.isSilent) {
      this.detectedFreq = freq;
      this.detectedMidi = freqToMidi(freq);

      const q = this.quantize(freq);
      this.targetFreq = q.targetFreq;
      this.targetMidi = q.targetMidi;

      // Pitch ratio for the shifter
      const rawRatio  = q.targetFreq / freq;
      // Blend with strength (1.0 = full correction, 0 = bypass)
      const blendRatio = 1.0 + (rawRatio - 1.0) * this.strength;
      // Smooth ratio transition (speed controls how fast it tracks)
      this.smoothRatio += (blendRatio - this.smoothRatio) * this.speed;
      this.currentRatio = this.smoothRatio;

      // Send ratio to worklet
      if (this.pitchShifter && this.workletReady) {
        this.pitchShifter.port.postMessage({ pitchRatio: this.currentRatio });
      }

      // Record history for graph
      this.pitchHistory.push(this.detectedMidi);
      this.correctedHistory.push(this.targetMidi);
      if (this.pitchHistory.length > this.historyMaxLen) {
        this.pitchHistory.shift();
        this.correctedHistory.shift();
      }
    } else {
      this.currentRatio = 1.0;
      this.pitchHistory.push(null);
      this.correctedHistory.push(null);
      if (this.pitchHistory.length > this.historyMaxLen) {
        this.pitchHistory.shift();
        this.correctedHistory.shift();
      }
    }
  }

  // ── Setters ────────────────────────────────────────────────────────────────
  setKey(key)      { this.key      = key; }
  setScale(scale)  { this.scale    = scale; }
  setStrength(v)   { this.strength = Math.max(0, Math.min(1, v)); }
  setSpeed(v)      { this.speed    = Math.max(0.02, Math.min(0.5, v)); }
  setMicGain(v)    { if (this.inputGain) this.inputGain.gain.value = v; }

  // ── Apply offline auto-tune to an AudioBuffer ────────────────────────────
  // Used when processing a recording. Returns a new corrected AudioBuffer.
  async processBuffer(inputBuffer) {
    const sampleRate   = inputBuffer.sampleRate;
    const numChannels  = inputBuffer.numberOfChannels;
    const frameCount   = inputBuffer.length;
    const SEGMENT_SIZE = 4096;

    // Render via OfflineAudioContext with pitch-corrected segments
    const offlineCtx = new OfflineAudioContext(numChannels, frameCount, sampleRate);

    let offsetFrames = 0;
    while (offsetFrames < frameCount) {
      const len  = Math.min(SEGMENT_SIZE, frameCount - offsetFrames);
      const segBuf = offlineCtx.createBuffer(numChannels, len, sampleRate);

      // Compute average pitch of segment
      let segFreq = null;
      const data0 = inputBuffer.getChannelData(0);
      const segData = data0.slice(offsetFrames, offsetFrames + len);

      // Simple RMS silence check
      let rms = 0;
      for (const s of segData) rms += s * s;
      rms = Math.sqrt(rms / segData.length);

      if (rms > 0.012) {
        // Autocorrelation pitch estimate
        const lagMin = Math.floor(sampleRate / 2000);
        const lagMax = Math.floor(sampleRate / 50);
        let bestLag = lagMin, bestCorr = -Infinity;
        const half = Math.floor(segData.length / 2);
        for (let lag = lagMin; lag < Math.min(lagMax, half); lag++) {
          let c = 0;
          for (let i = 0; i < half; i++) c += segData[i] * segData[i + lag];
          if (c > bestCorr) { bestCorr = c; bestLag = lag; }
        }
        segFreq = sampleRate / bestLag;
      }

      // Compute pitch ratio
      let playbackRate = 1.0;
      if (segFreq && segFreq > 50 && segFreq < 2000) {
        const q = this.quantize(segFreq);
        const rawRatio = q.targetFreq / segFreq;
        playbackRate = 1.0 + (rawRatio - 1.0) * this.strength;
        playbackRate = Math.max(0.5, Math.min(2.0, playbackRate));
      }

      // Copy segment audio
      for (let ch = 0; ch < numChannels; ch++) {
        const src  = inputBuffer.getChannelData(ch).slice(offsetFrames, offsetFrames + len);
        segBuf.copyToChannel(src, ch);
      }

      // Schedule with pitch-shifted playback rate
      const src = offlineCtx.createBufferSource();
      src.buffer = segBuf;
      src.playbackRate.value = playbackRate;
      src.connect(offlineCtx.destination);
      src.start(offsetFrames / sampleRate);

      offsetFrames += len;
    }

    return await offlineCtx.startRendering();
  }

  // ── Getters for UI ────────────────────────────────────────────────────────
  getDetectedNote()  { return this.isSilent ? '—' : midiToNoteName(Math.round(this.detectedMidi)); }
  getTargetNote()    { return this.isSilent ? '—' : midiToNoteName(Math.round(this.targetMidi)); }
  getCentOffset()    {
    if (this.isSilent) return 0;
    return Math.round((this.detectedMidi - Math.round(this.detectedMidi)) * 100);
  }
  getSemitoneShift() { return Math.round((this.targetMidi - this.detectedMidi) * 10) / 10; }
  getRatio()         { return this.currentRatio; }

  stop() {
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }
}

// Expose globals
window.AutoTuneEngine = AutoTuneEngine;
window.SCALES = SCALES;
window.NOTE_NAMES = NOTE_NAMES;
window.freqToMidi = freqToMidi;
window.midiToFreq = midiToFreq;
window.midiToNoteName = midiToNoteName;
