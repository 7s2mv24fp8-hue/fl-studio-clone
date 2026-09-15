/**
 * FL Studio Clone — Recorder Engine
 * Microphone capture, MediaRecorder clips, waveform display,
 * auto-tune processing, and full-project WAV export.
 */

class RecorderEngine {
  constructor(audioEngine, autoTuneEngine) {
    this.engine    = audioEngine;
    this.autoTune  = autoTuneEngine;

    // State
    this.isRecording   = false;
    this.isMonitoring  = false;
    this.isArmed       = false;
    this.micStream     = null;
    this.mediaRecorder = null;
    this._chunks       = [];

    // Clips: [{id, name, buffer:AudioBuffer, rawBlob:Blob, processedBuffer:AudioBuffer|null, duration, timestamp}]
    this.clips = [];
    this._clipIdCounter = 1;

    // Web Audio nodes for monitoring
    this.micSourceNode  = null;
    this.monitorGain    = null;
    this.monitoringChain = null;

    // Pitch update RAF
    this._pitchRafId = null;

    // Callbacks
    this.onClipAdded     = null;  // (clip) => void
    this.onLevelUpdate   = null;  // (rmsL, rmsR) => void
    this.onPitchUpdate   = null;  // () => void
    this.onStateChange   = null;  // (state) => void
  }

  // ── Request microphone permission ─────────────────────────────────────────
  async requestMic() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          sampleRate: this.engine.ctx.sampleRate,
        }
      });
      this.isArmed = true;
      if (this.onStateChange) this.onStateChange('armed');
      return true;
    } catch (err) {
      console.error('Mic access denied:', err);
      if (this.onStateChange) this.onStateChange('error');
      return false;
    }
  }

  // ── Start monitoring mic through auto-tune (live in ears) ─────────────────
  async startMonitoring() {
    if (!this.micStream) return;
    if (!this.engine.initialized) this.engine.init();
    if (!this.autoTune.inputGain) await this.autoTune.setupChain();

    const ctx = this.engine.ctx;

    // Create source from mic stream
    this.micSourceNode = ctx.createMediaStreamSource(this.micStream);

    // Connect mic → auto-tune chain → master (for live monitoring)
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = 0.85;

    this.autoTune.connectSource(this.micSourceNode, this.monitorGain);
    this.monitorGain.connect(this.engine.masterCompressor);

    this.isMonitoring = true;

    // Start pitch update loop
    this._startPitchLoop();
    if (this.onStateChange) this.onStateChange('monitoring');
  }

  stopMonitoring() {
    if (this.monitorGain) {
      this.monitorGain.disconnect();
      this.monitorGain = null;
    }
    if (this.micSourceNode) {
      this.micSourceNode.disconnect();
    }
    this.isMonitoring = false;
    this._stopPitchLoop();
    if (this.onStateChange) this.onStateChange('armed');
  }

  // ── Start / stop recording ────────────────────────────────────────────────
  async startRecording() {
    if (!this.micStream || this.isRecording) return;
    this._chunks = [];

    // If not monitoring, start it first
    if (!this.isMonitoring) await this.startMonitoring();

    this.mediaRecorder = new MediaRecorder(this.micStream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    this.mediaRecorder.addEventListener('dataavailable', e => {
      if (e.data.size > 0) this._chunks.push(e.data);
    });

    this.mediaRecorder.addEventListener('stop', () => this._onRecordingStop());

    this.mediaRecorder.start(100); // collect every 100ms
    this.isRecording = true;
    this._recordStart = Date.now();
    if (this.onStateChange) this.onStateChange('recording');
  }

  stopRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.mediaRecorder.stop();
    this.isRecording = false;
  }

  async _onRecordingStop() {
    const blob = new Blob(this._chunks, { type: this.mediaRecorder.mimeType });
    const duration = (Date.now() - this._recordStart) / 1000;

    // Decode to AudioBuffer
    const arrayBuf = await blob.arrayBuffer();
    let audioBuffer;
    try {
      audioBuffer = await this.engine.ctx.decodeAudioData(arrayBuf);
    } catch (e) {
      console.error('Could not decode recording:', e);
      return;
    }

    const clip = {
      id:        this._clipIdCounter++,
      name:      `Take ${this._clipIdCounter - 1}`,
      rawBuffer: audioBuffer,
      processedBuffer: null,
      processing: false,
      duration:  audioBuffer.duration,
      timestamp: new Date().toLocaleTimeString(),
    };

    this.clips.push(clip);
    if (this.onClipAdded) this.onClipAdded(clip);
    if (this.onStateChange) this.onStateChange('monitoring');

    // Auto-process with auto-tune in background
    this._processClipAutoTune(clip);
  }

  // ── Apply auto-tune to a clip's buffer ────────────────────────────────────
  async _processClipAutoTune(clip) {
    clip.processing = true;
    if (this.onClipAdded) this.onClipAdded(clip); // re-render to show spinner

    try {
      clip.processedBuffer = await this.autoTune.processBuffer(clip.rawBuffer);
    } catch (e) {
      console.warn('Auto-tune processing failed, using raw:', e);
      clip.processedBuffer = clip.rawBuffer;
    }

    clip.processing = false;
    if (this.onClipAdded) this.onClipAdded(clip);
  }

  // ── Play a clip ────────────────────────────────────────────────────────────
  playClip(clip, withAutoTune = true) {
    if (!this.engine.initialized) this.engine.init();
    const ctx = this.engine.ctx;

    const buffer = withAutoTune && clip.processedBuffer
      ? clip.processedBuffer
      : clip.rawBuffer;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.value = 0.85;
    src.connect(gain);
    gain.connect(this.engine.masterCompressor);
    src.start();

    clip._currentSource = src;
    return src;
  }

  stopClip(clip) {
    if (clip._currentSource) {
      try { clip._currentSource.stop(); } catch(e){}
      clip._currentSource = null;
    }
  }

  deleteClip(id) {
    const idx = this.clips.findIndex(c => c.id === id);
    if (idx >= 0) this.clips.splice(idx, 1);
  }

  // ── Waveform rendering ─────────────────────────────────────────────────────
  drawWaveform(canvas, clip, color = '#00d4aa') {
    const ctx   = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const buffer = clip.processedBuffer || clip.rawBuffer;
    if (!buffer) return;

    const data   = buffer.getChannelData(0);
    const step   = Math.ceil(data.length / W);
    const amp    = H / 2;

    // Background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    // Center line
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.lineTo(W, amp);
    ctx.stroke();

    // Waveform
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + 'aa');
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, color + 'aa');

    ctx.fillStyle = grad;

    for (let i = 0; i < W; i++) {
      let min = 1, max = -1;
      const start = i * step;
      for (let j = 0; j < step && start + j < data.length; j++) {
        const v = data[start + j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yMin = amp - min * amp * 0.95;
      const yMax = amp - max * amp * 0.95;
      ctx.fillRect(i, yMax, 1, Math.max(1, yMin - yMax));
    }

    // Overlay highlight
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, W, H / 2);
  }

  // ── Pitch graph rendering ──────────────────────────────────────────────────
  drawPitchGraph(canvas) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);

    const history  = this.autoTune.pitchHistory;
    const corr     = this.autoTune.correctedHistory;
    if (history.length < 2) return;

    // MIDI range to display: 48 (C3) – 84 (C6)
    const midiMin = 36, midiMax = 84;
    const midiRange = midiMax - midiMin;

    const midiToY = (m) => H - ((m - midiMin) / midiRange) * H;

    // Grid lines for octaves + note rows
    for (let midi = midiMin; midi <= midiMax; midi++) {
      const y = midiToY(midi);
      const isC = midi % 12 === 0;
      ctx.strokeStyle = isC ? '#2a2a2a' : '#1a1a1a';
      ctx.lineWidth = isC ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();

      if (isC) {
        ctx.fillStyle = '#333';
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`C${Math.floor(midi / 12) - 1}`, 2, y - 1);
      }
    }

    // Scale lanes (highlight target notes)
    const key   = this.autoTune.key;
    const scale = SCALES[this.autoTune.scale] || [];
    const keyIdx = NOTE_NAMES.indexOf(key);
    for (let midi = midiMin; midi <= midiMax; midi++) {
      const semitone = ((midi - keyIdx) % 12 + 12) % 12;
      if (scale.includes(semitone)) {
        const y = midiToY(midi);
        ctx.fillStyle = 'rgba(255,106,0,0.06)';
        ctx.fillRect(0, y - 0.5, W, 1);
      }
    }

    // Corrected pitch line (orange — where auto-tune snaps to)
    ctx.beginPath();
    ctx.strokeStyle = '#ff6a00';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff6a00';
    ctx.shadowBlur = 4;
    let first = true;
    corr.forEach((m, i) => {
      if (m === null) { first = true; return; }
      const x = (i / this.autoTune.historyMaxLen) * W;
      const y = midiToY(m);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Detected pitch line (teal — raw voice)
    ctx.beginPath();
    ctx.strokeStyle = '#00d4aa';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#00d4aa';
    ctx.shadowBlur = 3;
    first = true;
    history.forEach((m, i) => {
      if (m === null) { first = true; return; }
      const x = (i / this.autoTune.historyMaxLen) * W;
      const y = midiToY(m);
      if (first) { ctx.moveTo(x, y); first = false; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── Level meter update ────────────────────────────────────────────────────
  getMicLevel() {
    return Math.min(1, this.autoTune.rms * 6);
  }

  // ── Pitch detection loop ──────────────────────────────────────────────────
  _startPitchLoop() {
    const loop = () => {
      this.autoTune.update();
      if (this.onPitchUpdate) this.onPitchUpdate();
      this._pitchRafId = requestAnimationFrame(loop);
    };
    this._pitchRafId = requestAnimationFrame(loop);
  }

  _stopPitchLoop() {
    if (this._pitchRafId) {
      cancelAnimationFrame(this._pitchRafId);
      this._pitchRafId = null;
    }
  }

  // ── Full project WAV export ───────────────────────────────────────────────
  async exportMix(sequencer, durationBars = 8) {
    if (!this.engine.initialized) this.engine.init();
    const sampleRate = this.engine.ctx.sampleRate;
    const bpm        = sequencer.bpm;
    const stepDur    = (60 / bpm) / 4;          // 16th note
    const barDur     = stepDur * 16;             // 1 bar = 16 steps
    const totalDur   = barDur * durationBars;

    // Offline context for rendering
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(totalDur * sampleRate), sampleRate);

    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.85;
    masterGain.connect(offlineCtx.destination);

    const compressor = offlineCtx.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 6;
    compressor.ratio.value = 3;
    compressor.connect(masterGain);

    // Schedule sequencer events
    const hasSolo = sequencer.channels.some(c => c.solo);

    for (let bar = 0; bar < durationBars; bar++) {
      for (let step = 0; step < sequencer.steps; step++) {
        const time = bar * barDur + step * stepDur;

        sequencer.channels.forEach(ch => {
          if (ch.muted) return;
          if (hasSolo && !ch.solo) return;
          if (!ch.steps[step]) return;

          const vel = ch.velocity[step] * ch.volume;
          this._scheduleOfflineDrum(offlineCtx, compressor, ch.name, time, vel, sampleRate);
        });
      }
    }

    // Schedule vocal clips
    this.clips.forEach(clip => {
      const buf = clip.processedBuffer || clip.rawBuffer;
      if (!buf) return;
      // Place each clip at t=0 for simplicity (user can record in sync)
      const src = offlineCtx.createBufferSource();
      src.buffer = buf;
      const g = offlineCtx.createGain();
      g.gain.value = 0.85;
      src.connect(g);
      g.connect(compressor);
      src.start(0);
    });

    // Render
    let rendered;
    try {
      rendered = await offlineCtx.startRendering();
    } catch (e) {
      console.error('Offline render failed:', e);
      throw e;
    }

    // Encode to WAV and download
    const wavBuffer = this._encodeWAV(rendered);
    this._downloadWAV(wavBuffer, 'fl-studio-mix.wav');
    return rendered;
  }

  _scheduleOfflineDrum(ctx, dest, name, time, vel, sampleRate) {
    const makeNoise = (duration) => {
      const buf  = ctx.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    };

    const n = name.toLowerCase();
    let src, env;

    if (n.includes('kick') || n.includes('808')) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, time);
      osc.frequency.exponentialRampToValueAtTime(55, time + 0.08);
      env = ctx.createGain();
      env.gain.setValueAtTime(vel * 0.9, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
      osc.connect(env); env.connect(dest);
      osc.start(time); osc.stop(time + 0.55);

    } else if (n.includes('snare')) {
      const buf  = makeNoise(0.25);
      const nsrc = ctx.createBufferSource();
      nsrc.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 3200; filt.Q.value = 0.5;
      env = ctx.createGain();
      env.gain.setValueAtTime(vel * 0.7, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
      nsrc.connect(filt); filt.connect(env); env.connect(dest);
      nsrc.start(time); nsrc.stop(time + 0.25);

    } else if (n.includes('clap')) {
      [0, 0.012, 0.025].forEach(off => {
        const buf  = makeNoise(0.06);
        const nsrc = ctx.createBufferSource();
        nsrc.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass'; filt.frequency.value = 1200; filt.Q.value = 0.8;
        env = ctx.createGain();
        env.gain.setValueAtTime(vel * 0.7, time + off);
        env.gain.exponentialRampToValueAtTime(0.001, time + off + (off === 0.025 ? 0.1 : 0.018));
        nsrc.connect(filt); filt.connect(env); env.connect(dest);
        nsrc.start(time + off); nsrc.stop(time + off + 0.12);
      });

    } else if (n.includes('hi-hat') || n.includes('hihat')) {
      const open = n.includes(' o') || n.includes('-o');
      const dur  = open ? 0.35 : 0.06;
      const freqs = [800, 1200, 2000, 3000, 4000, 5000].map(f => f * 4);
      env = ctx.createGain();
      env.gain.setValueAtTime(vel * 0.45, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + dur);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = open ? 7000 : 9000;
      freqs.forEach(freq => {
        const o = ctx.createOscillator();
        o.type = 'square'; o.frequency.value = freq;
        const g = ctx.createGain(); g.gain.value = 1 / freqs.length;
        o.connect(g); g.connect(hp);
        o.start(time); o.stop(time + dur + 0.01);
      });
      hp.connect(env); env.connect(dest);

    } else if (n.includes('tom')) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, time);
      osc.frequency.exponentialRampToValueAtTime(100, time + 0.25);
      env = ctx.createGain();
      env.gain.setValueAtTime(vel * 0.75, time);
      env.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      osc.connect(env); env.connect(dest);
      osc.start(time); osc.stop(time + 0.35);

    } else {
      // Generic synth note
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      env = ctx.createGain();
      env.gain.setValueAtTime(0, time);
      env.gain.linearRampToValueAtTime(vel * 0.3, time + 0.01);
      env.gain.linearRampToValueAtTime(0, time + 0.3);
      osc.connect(env); env.connect(dest);
      osc.start(time); osc.stop(time + 0.32);
    }
  }

  // ── WAV encoder ────────────────────────────────────────────────────────────
  _encodeWAV(audioBuffer) {
    const numCh     = audioBuffer.numberOfChannels;
    const numFrames = audioBuffer.length;
    const sampleRate = audioBuffer.sampleRate;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataLen   = numFrames * numCh * bytesPerSample;

    const buffer = new ArrayBuffer(44 + dataLen);
    const view   = new DataView(buffer);
    const write  = (str, offset) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    write('RIFF', 0);
    view.setUint32(4,  36 + dataLen, true);
    write('WAVE', 8);
    write('fmt ', 12);
    view.setUint32(16, 16, true);                           // chunk size
    view.setUint16(20, 1,  true);                           // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
    view.setUint16(32, numCh * bytesPerSample, true);
    view.setUint16(34, bitsPerSample, true);
    write('data', 36);
    view.setUint32(40, dataLen, true);

    // Interleave channels and convert float → int16
    let offset = 44;
    for (let frame = 0; frame < numFrames; frame++) {
      for (let ch = 0; ch < numCh; ch++) {
        const sample = audioBuffer.getChannelData(ch)[frame];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
        offset += 2;
      }
    }
    return buffer;
  }

  _downloadWAV(arrayBuffer, filename) {
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  destroy() {
    this.stopRecording();
    this.stopMonitoring();
    this._stopPitchLoop();
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
  }
}

window.RecorderEngine = RecorderEngine;
