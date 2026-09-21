/**
 * FL Studio Clone — Sequencer
 * BPM step sequencer with Web Audio lookahead scheduling
 */

class Sequencer {
  constructor(audioEngine) {
    this.engine = audioEngine;

    // Playback state
    this.isPlaying = false;
    this.bpm = 140;
    this.steps = 16;
    this.currentStep = 0;

    // Scheduling config
    this.scheduleAheadTime = 0.12; // seconds to look ahead
    this.lookahead = 20;           // ms timer interval
    this._nextStepTime = 0;
    this._schedulerTimer = null;

    // Channel data: array of channels
    // Each channel: { name, color, steps: bool[16], velocity: num[16], volume: 1, pan: 0, muted: false, solo: false, type: 'drum'|'synth', notes: [] }
    this.channels = this._buildDefaultChannels();

    // Pattern name
    this.patternName = 'Pattern 1';

    // Callbacks
    this.onStep = null;       // (stepIndex) => void
    this.onStop = null;       // () => void
    this.onPatternChange = null;

    // Piano roll channel index (which channel piano roll edits)
    this.pianoRollChannel = 6; // Bass by default
  }

  _buildDefaultChannels() {
    const make = (name, color, type = 'drum', defaults = []) => {
      const steps = Array(16).fill(false);
      const velocity = Array(16).fill(0.8);
      defaults.forEach(i => { steps[i] = true; });
      return { name, color, steps, velocity, volume: 1, pan: 0, muted: false, solo: false, type, notes: [], filterFreq: 2000, filterRes: 1 };
    };

    return [
      make('Kick',     '#ef4444', 'drum',  [0, 4, 8, 12]),
      make('Clap',     '#f97316', 'drum',  [4, 12]),
      make('Hi-Hat C', '#facc15', 'drum',  [0,2,4,6,8,10,12,14]),
      make('Hi-Hat O', '#84cc16', 'drum',  [6, 14]),
      make('Snare',    '#06b6d4', 'drum',  [4, 12]),
      make('Tom',      '#a855f7', 'drum',  [10, 15]),
      make('Bass',     '#ec4899', 'synth', [0, 4, 8]),
      make('Lead',     '#00d4aa', 'synth', [0, 2, 5, 9, 12]),
    ];
  }

  // ── Step time calculation ──────────────────────────────────────
  get stepDuration() {
    return (60 / this.bpm) / 4; // 16th note duration in seconds
  }

  // ── Playback control ───────────────────────────────────────────
  play() {
    if (!this.engine.initialized) this.engine.init();
    this.engine.resume();

    if (this.isPlaying) return;
    this.isPlaying = true;
    this.currentStep = 0;
    this._nextStepTime = this.engine.currentTime + 0.05;
    this._schedulerTimer = setInterval(() => this._scheduler(), this.lookahead);
  }

  stop() {
    this.isPlaying = false;
    clearInterval(this._schedulerTimer);
    this._schedulerTimer = null;
    this.currentStep = 0;
    if (this.onStop) this.onStop();
  }

  toggle() {
    this.isPlaying ? this.stop() : this.play();
  }

  // ── Lookahead scheduler ────────────────────────────────────────
  _scheduler() {
    const now = this.engine.currentTime;
    while (this._nextStepTime < now + this.scheduleAheadTime) {
      this._scheduleStep(this.currentStep, this._nextStepTime);
      this._advanceStep();
    }
  }

  _scheduleStep(step, time) {
    const hasSolo = this.channels.some(c => c.solo);

    this.channels.forEach((ch, idx) => {
      if (ch.muted) return;
      if (hasSolo && !ch.solo) return;
      if (!ch.steps[step]) return;

      const vel = ch.velocity[step] * ch.volume;

      if (ch.type === 'drum') {
        this.engine.triggerChannel(ch.name, time, vel);
      } else if (ch.type === 'audio' && ch.audioBuffer) {
        // Play recorded vocal / audio clip
        try {
          const src = this.engine.ctx.createBufferSource();
          src.buffer = ch.audioBuffer;
          const gainNode = this.engine.ctx.createGain();
          gainNode.gain.setValueAtTime(vel * (ch.volume || 1), time);
          src.connect(gainNode);
          gainNode.connect(this.engine.masterCompressor);
          src.start(time);
        } catch (e) {
          console.warn('Audio clip playback failed:', e);
        }
      } else {
        // Synth: find notes for this step from piano roll
        const stepNotes = ch.notes.filter(n => n.step === step);
        if (stepNotes.length > 0) {
          stepNotes.forEach(n => {
            const freq = this._midiToFreq(n.midi);
            const dur = n.length * this.stepDuration;
            if (ch.name === 'Bass') {
              this.engine.playBass(time, { freq, gain: vel * 0.5, duration: dur, filterFreq: ch.filterFreq || 800 });
            } else {
              this.engine.playSynth(time, { freq, gain: vel * 0.35, duration: dur, filterFreq: ch.filterFreq || 2000 });
            }
          });
        } else {
          // Default synth note if no piano roll notes
          const defaultFreqs = { 'Bass': 110, 'Lead': 440 };
          const freq = defaultFreqs[ch.name] || 220;
          const dur = this.stepDuration;
          if (ch.name === 'Bass') {
            this.engine.playBass(time, { freq, gain: vel * 0.4, duration: dur });
          } else {
            this.engine.playSynth(time, { freq, gain: vel * 0.25, duration: dur });
          }
        }
      }
    });

    // Notify UI on the step being played
    const stepCopy = step;
    const delay = (time - this.engine.currentTime) * 1000;
    setTimeout(() => {
      if (this.onStep) this.onStep(stepCopy);
    }, Math.max(0, delay));
  }

  _advanceStep() {
    this._nextStepTime += this.stepDuration;
    this.currentStep = (this.currentStep + 1) % this.steps;
  }

  // ── Step manipulation ──────────────────────────────────────────
  toggleStep(channelIdx, stepIdx) {
    const ch = this.channels[channelIdx];
    ch.steps[stepIdx] = !ch.steps[stepIdx];
    if (this.onPatternChange) this.onPatternChange();
  }

  setStepVelocity(channelIdx, stepIdx, vel) {
    this.channels[channelIdx].velocity[stepIdx] = Math.max(0.01, Math.min(1, vel));
  }

  setChannelVolume(idx, vol) {
    this.channels[idx].volume = Math.max(0, Math.min(1.5, vol));
  }

  setChannelMute(idx, val) {
    this.channels[idx].muted = val;
  }

  setChannelSolo(idx, val) {
    // Toggle solo — only one channel soloed at a time
    this.channels.forEach((c, i) => { c.solo = i === idx ? val : false; });
  }

  setBPM(bpm) {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }

  // ── Piano roll note integration ────────────────────────────────
  addNote(channelIdx, step, midi, length = 1, velocity = 0.8) {
    const ch = this.channels[channelIdx];
    // Remove existing note at same step/midi
    ch.notes = ch.notes.filter(n => !(n.step === step && n.midi === midi));
    ch.notes.push({ step, midi, length, velocity });
    ch.steps[step] = true;
  }

  removeNote(channelIdx, step, midi) {
    const ch = this.channels[channelIdx];
    ch.notes = ch.notes.filter(n => !(n.step === step && n.midi === midi));
    const hasNotes = ch.notes.some(n => n.step === step);
    if (!hasNotes) ch.steps[step] = false;
  }

  // ── Util ───────────────────────────────────────────────────────
  _midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // ── Randomize pattern ──────────────────────────────────────────
  randomizeChannel(idx) {
    const ch = this.channels[idx];
    ch.steps = ch.steps.map(() => Math.random() > 0.65);
    ch.velocity = ch.velocity.map(() => 0.4 + Math.random() * 0.6);
    if (this.onPatternChange) this.onPatternChange();
  }

  // ── Clear channel ──────────────────────────────────────────────
  clearChannel(idx) {
    const ch = this.channels[idx];
    ch.steps.fill(false);
    if (this.onPatternChange) this.onPatternChange();
  }

  // ── Serialize / restore ────────────────────────────────────────
  toJSON() {
    return {
      bpm: this.bpm,
      steps: this.steps,
      channels: this.channels.map(c => ({
        name: c.name,
        color: c.color,
        steps: [...c.steps],
        velocity: [...c.velocity],
        volume: c.volume,
        pan: c.pan,
        muted: c.muted,
        type: c.type,
        notes: [...c.notes],
      })),
    };
  }

  fromJSON(data) {
    this.bpm = data.bpm || 140;
    this.steps = data.steps || 16;
    this.channels = data.channels.map(c => ({
      ...c,
      steps: [...c.steps],
      velocity: [...c.velocity],
      notes: [...(c.notes || [])],
      solo: false,
    }));
    if (this.onPatternChange) this.onPatternChange();
  }
}

window.Sequencer = Sequencer;
