/**
 * FL Studio Clone — Audio Engine
 * Drum synthesis + oscillator synth via Web Audio API
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.masterCompressor = null;
    this.channelGains = {};
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master compressor
    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -6;
    this.masterCompressor.knee.value = 6;
    this.masterCompressor.ratio.value = 3;
    this.masterCompressor.attack.value = 0.003;
    this.masterCompressor.release.value = 0.25;

    // Master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;

    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.initialized = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMasterVolume(vol) { // 0–1
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
    }
  }

  // ── Shared util ──────────────────────────────────────────────
  _connectToMaster(node, gainDb = 0) {
    const gain = this.ctx.createGain();
    gain.gain.value = Math.pow(10, gainDb / 20);
    node.connect(gain);
    gain.connect(this.masterCompressor);
    return gain;
  }

  // ── 808 Kick ─────────────────────────────────────────────────
  playKick(time, options = {}) {
    const { freq = 58, gain = 0.9, pitch = 1 } = options;
    const t = time || this.ctx.currentTime;

    // Sub oscillator
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * pitch * 3.5, t);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch, t + 0.05);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch * 0.5, t + 0.4);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

    // Distortion for punch
    const dist = this.ctx.createWaveShaper();
    dist.curve = this._makeDistortionCurve(20);

    osc.connect(dist);
    dist.connect(gainNode);
    this._connectToMaster(gainNode, 2);

    osc.start(t);
    osc.stop(t + 0.55);
  }

  // ── Snare ────────────────────────────────────────────────────
  playSnare(time, options = {}) {
    const { gain = 0.7 } = options;
    const t = time || this.ctx.currentTime;

    // Noise component
    const bufferSize = this.ctx.sampleRate * 0.3;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 3200;
    noiseFilter.Q.value = 0.5;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(gain, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    // Tone component
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.1);

    const toneGain = this.ctx.createGain();
    toneGain.gain.setValueAtTime(gain * 0.6, t);
    toneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    osc.connect(toneGain);

    this._connectToMaster(noiseGain);
    this._connectToMaster(toneGain);

    noise.start(t);
    noise.stop(t + 0.25);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  // ── Hi-Hat ───────────────────────────────────────────────────
  playHihat(time, options = {}) {
    const { open = false, gain = 0.5 } = options;
    const t = time || this.ctx.currentTime;
    const duration = open ? 0.5 : 0.08;

    // Metal oscillators (6 overtones for metallic sound)
    const freqs = [40, 74, 164, 220, 163, 349].map(f => f * 20);
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = open ? 7000 : 9000;

    freqs.forEach(freq => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.value = 1 / freqs.length;
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.02);
    });

    filter.connect(gainNode);
    this._connectToMaster(gainNode, -3);
  }

  // ── Clap ─────────────────────────────────────────────────────
  playClap(time, options = {}) {
    const { gain = 0.7 } = options;
    const t = time || this.ctx.currentTime;

    // Multiple noise bursts for clap texture
    [0, 0.01, 0.02, 0.04].forEach((offset, i) => {
      const bufferSize = this.ctx.sampleRate * 0.06;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) data[j] = Math.random() * 2 - 1;

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.8;

      const g = this.ctx.createGain();
      const fadeTime = i === 3 ? 0.1 : 0.015;
      g.gain.setValueAtTime(gain, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + fadeTime);

      noise.connect(filter);
      filter.connect(g);
      this._connectToMaster(g);

      noise.start(t + offset);
      noise.stop(t + offset + fadeTime + 0.01);
    });
  }

  // ── Tom ──────────────────────────────────────────────────────
  playTom(time, options = {}) {
    const { freq = 120, gain = 0.75 } = options;
    const t = time || this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.25);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(gain, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    osc.connect(gainNode);
    this._connectToMaster(gainNode);

    osc.start(t);
    osc.stop(t + 0.35);
  }

  // ── Synth Note ───────────────────────────────────────────────
  playSynth(time, options = {}) {
    const {
      freq = 220,
      type = 'sawtooth',
      gain = 0.3,
      attack = 0.01,
      decay = 0.1,
      sustain = 0.7,
      release = 0.3,
      duration = 0.5,
      filterFreq = 2000,
      filterRes = 1,
      detune = 0,
    } = options;

    const t = time || this.ctx.currentTime;
    const noteEnd = t + duration;

    // Oscillator 1
    const osc1 = this.ctx.createOscillator();
    osc1.type = type;
    osc1.frequency.value = freq;
    osc1.detune.value = detune;

    // Oscillator 2 (slight detune for fatness)
    const osc2 = this.ctx.createOscillator();
    osc2.type = type;
    osc2.frequency.value = freq;
    osc2.detune.value = detune + 7;

    // Filter
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq * 1.5, t);
    filter.frequency.exponentialRampToValueAtTime(filterFreq, t + attack + decay);
    filter.Q.value = filterRes;

    // ADSR gain
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(gain, t + attack);
    gainNode.gain.linearRampToValueAtTime(gain * sustain, t + attack + decay);
    gainNode.gain.setValueAtTime(gain * sustain, noteEnd);
    gainNode.gain.linearRampToValueAtTime(0, noteEnd + release);

    const oscGain1 = this.ctx.createGain();
    const oscGain2 = this.ctx.createGain();
    oscGain1.gain.value = 0.6;
    oscGain2.gain.value = 0.4;

    osc1.connect(oscGain1);
    osc2.connect(oscGain2);
    oscGain1.connect(filter);
    oscGain2.connect(filter);
    filter.connect(gainNode);
    this._connectToMaster(gainNode);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(noteEnd + release + 0.05);
    osc2.stop(noteEnd + release + 0.05);

    return { osc1, osc2, gainNode };
  }

  // ── Bass ─────────────────────────────────────────────────────
  playBass(time, options = {}) {
    return this.playSynth(time, {
      type: 'square',
      attack: 0.005,
      decay: 0.08,
      sustain: 0.6,
      release: 0.15,
      filterFreq: 800,
      filterRes: 3,
      gain: 0.5,
      ...options,
    });
  }

  // ── Helper: distortion curve ──────────────────────────────────
  _makeDistortionCurve(amount) {
    const samples = 256;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  // ── Map channel name to play function ────────────────────────
  triggerChannel(channelName, time, velocity = 1, config = {}) {
    const vol = velocity;
    switch (channelName.toLowerCase()) {
      case 'kick':
      case '808':
        this.playKick(time, { gain: 0.9 * vol, ...config }); break;
      case 'snare':
        this.playSnare(time, { gain: 0.7 * vol, ...config }); break;
      case 'clap':
        this.playClap(time, { gain: 0.7 * vol, ...config }); break;
      case 'hihat':
      case 'hi-hat c':
      case 'hihat c':
        this.playHihat(time, { open: false, gain: 0.5 * vol, ...config }); break;
      case 'hihat o':
      case 'hi-hat o':
        this.playHihat(time, { open: true, gain: 0.4 * vol, ...config }); break;
      case 'tom':
        this.playTom(time, { gain: 0.75 * vol, ...config }); break;
      case 'bass':
        this.playBass(time, { freq: config.freq || 110, gain: 0.5 * vol, duration: config.duration || 0.25, ...config }); break;
      case 'lead':
        this.playSynth(time, { freq: config.freq || 440, type: 'sawtooth', gain: 0.35 * vol, duration: config.duration || 0.25, ...config }); break;
      default:
        this.playKick(time, { gain: 0.5 * vol }); break;
    }
  }
}

window.AudioEngine = AudioEngine;
