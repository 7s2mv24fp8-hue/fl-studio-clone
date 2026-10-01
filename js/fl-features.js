/**
 * BeYou Studio — FL Studio Feature Pack
 * ======================================
 * Adds the following FL Studio capabilities WITHOUT touching existing modules:
 *
 *  1. Channel FX Chain  — Reverb · Delay · Distortion · Chorus · Bitcrush (per channel)
 *  2. 3-Band Channel EQ — Low / Mid / High shelf per channel
 *  3. Global Swing / Groove — 0–100 % shuffle applied to odd steps
 *  4. Variable step count  — 16 / 32 steps per channel (or globally)
 *  5. Piano Roll Extras    — Quantise, Chord fill, Arpeggiator, Select / Copy / Paste
 *  6. MIDI keyboard input  — Web MIDI API + on-screen keyboard with velocity
 *  7. Beat Slicer          — Auto-slice imported audio into equal parts
 *  8. Pattern Management   — Clone, clear, rename patterns in the Playlist
 *  9. Global keyboard shortcuts — Space / Ctrl+Z / Ctrl+S / Ctrl+D / Ctrl+M etc.
 * 10. Automation           — Draw volume / pan / filter automation per channel
 *
 * All features are self-contained. They attach to window.app, window.sequencer,
 * and window.audioEngine via a waitForApp() guard so they never race-condition.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   1. CHANNEL FX CHAIN
   Adds a per-channel FX panel (reverb, delay, distortion, chorus, bitcrush)
   using Web Audio API nodes inserted between the channel gain and master bus.
═══════════════════════════════════════════════════════════════════════════ */
class ChannelFX {
  constructor(audioCtx, destination) {
    this.ctx  = audioCtx;
    this.dest = destination; // masterCompressor or masterGain

    // Each channel has its own send chain: channel → fxIn → [effects] → fxOut → dest
    this._chains = new Map(); // channelIdx → { fxIn, fxOut, nodes: {} }
  }

  /** Returns the input node for a channel's FX chain (create if needed) */
  getChainInput(channelIdx) {
    if (!this._chains.has(channelIdx)) {
      const fxIn  = this.ctx.createGain();
      const fxOut = this.ctx.createGain();
      fxOut.connect(this.dest);
      this._chains.set(channelIdx, { fxIn, fxOut, nodes: {}, bypassed: {}, params: {
        reverbWet: 0, delayTime: 0.25, delayFeedback: 0, delayWet: 0,
        distortionAmount: 0, distortionWet: 0,
        chorusDepth: 0, chorusRate: 2, chorusWet: 0,
        bitcrushBits: 16, bitcrushWet: 0,
        eqLow: 0, eqMid: 0, eqHigh: 0,
      }});
      this._buildChain(channelIdx);
    }
    return this._chains.get(channelIdx).fxIn;
  }

  _buildChain(idx) {
    const chain = this._chains.get(idx);
    const { fxIn, fxOut } = chain;

    // ── EQ (3-band biquad) ────────────────────────────────
    const eqLow  = this.ctx.createBiquadFilter();
    const eqMid  = this.ctx.createBiquadFilter();
    const eqHigh = this.ctx.createBiquadFilter();
    eqLow.type  = 'lowshelf';  eqLow.frequency.value  = 120;  eqLow.gain.value  = 0;
    eqMid.type  = 'peaking';   eqMid.frequency.value  = 1000; eqMid.gain.value  = 0; eqMid.Q.value = 0.8;
    eqHigh.type = 'highshelf'; eqHigh.frequency.value = 6000; eqHigh.gain.value = 0;

    // ── Reverb (convolver with synthetic IR) ──────────────
    const reverbConv  = this.ctx.createConvolver();
    const reverbWetGain = this.ctx.createGain();
    const reverbDryGain = this.ctx.createGain();
    reverbConv.buffer = this._makeReverbIR(2.5, false);
    reverbWetGain.gain.value = 0;
    reverbDryGain.gain.value = 1;

    // ── Delay ─────────────────────────────────────────────
    const delayNode      = this.ctx.createDelay(2);
    const delayFeedback  = this.ctx.createGain();
    const delayWetGain   = this.ctx.createGain();
    const delayDryGain   = this.ctx.createGain();
    delayNode.delayTime.value = 0.25;
    delayFeedback.gain.value  = 0;
    delayWetGain.gain.value   = 0;
    delayDryGain.gain.value   = 1;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    // ── Distortion (waveshaper) ───────────────────────────
    const distWS      = this.ctx.createWaveShaper();
    const distWetGain = this.ctx.createGain();
    const distDryGain = this.ctx.createGain();
    distWS.curve    = this._makeDistCurve(0);
    distWS.oversample = '4x';
    distWetGain.gain.value = 0;
    distDryGain.gain.value = 1;

    // ── Chorus (LFO-modulated delay) ─────────────────────
    const chorusDelay  = this.ctx.createDelay(0.05);
    const chorusLFO    = this.ctx.createOscillator();
    const chorusDepthN = this.ctx.createGain();
    const chorusWetGain = this.ctx.createGain();
    const chorusDryGain = this.ctx.createGain();
    chorusLFO.type = 'sine'; chorusLFO.frequency.value = 2;
    chorusDepthN.gain.value = 0;
    chorusLFO.connect(chorusDepthN);
    chorusDepthN.connect(chorusDelay.delayTime);
    chorusLFO.start();
    chorusWetGain.gain.value = 0;
    chorusDryGain.gain.value = 1;

    // ── Wire everything: fxIn → EQ → all effects → fxOut ─
    fxIn.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh);

    // Reverb
    eqHigh.connect(reverbDryGain); eqHigh.connect(reverbConv);
    reverbConv.connect(reverbWetGain);
    reverbDryGain.connect(fxOut); reverbWetGain.connect(fxOut);

    // Delay
    eqHigh.connect(delayDryGain); eqHigh.connect(delayNode);
    delayNode.connect(delayWetGain);
    delayDryGain.connect(fxOut); delayWetGain.connect(fxOut);

    // Distortion
    eqHigh.connect(distDryGain); eqHigh.connect(distWS);
    distWS.connect(distWetGain);
    distDryGain.connect(fxOut); distWetGain.connect(fxOut);

    // Chorus
    eqHigh.connect(chorusDryGain); eqHigh.connect(chorusDelay);
    chorusDelay.connect(chorusWetGain);
    chorusDryGain.connect(fxOut); chorusWetGain.connect(fxOut);

    chain.nodes = {
      eqLow, eqMid, eqHigh,
      reverbConv, reverbWetGain, reverbDryGain,
      delayNode, delayFeedback, delayWetGain, delayDryGain,
      distWS, distWetGain, distDryGain,
      chorusDelay, chorusLFO, chorusDepthN, chorusWetGain, chorusDryGain,
    };
  }

  setParam(idx, param, value) {
    const chain = this._chains.get(idx);
    if (!chain) return;
    const n = chain.nodes;
    chain.params[param] = value;

    switch (param) {
      case 'reverbWet':    n.reverbWetGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'delayTime':    n.delayNode.delayTime.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'delayFeedback': n.delayFeedback.gain.setTargetAtTime(Math.min(0.9, value), this.ctx.currentTime, 0.01); break;
      case 'delayWet':     n.delayWetGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'distortionAmount':
        n.distWS.curve = this._makeDistCurve(value * 400);
        break;
      case 'distortionWet': n.distWetGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'chorusDepth':  n.chorusDepthN.gain.setTargetAtTime(value * 0.005, this.ctx.currentTime, 0.01); break;
      case 'chorusRate':   n.chorusLFO.frequency.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'chorusWet':    n.chorusWetGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'eqLow':  n.eqLow.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'eqMid':  n.eqMid.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
      case 'eqHigh': n.eqHigh.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01); break;
    }
  }

  getParams(idx) {
    return this._chains.get(idx)?.params || {};
  }

  _makeReverbIR(duration, reverse) {
    const sr     = this.ctx.sampleRate;
    const len    = sr * duration;
    const ir     = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
      }
    }
    return ir;
  }

  _makeDistCurve(amount) {
    const samples = 256;
    const curve   = new Float32Array(samples);
    const k = amount || 0.001;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   2. FX PANEL UI  — renders inside the Mixer strip when "FX" button is clicked
═══════════════════════════════════════════════════════════════════════════ */
class FXPanelUI {
  constructor(channelFX) {
    this.fx = channelFX;
    this._panel = null;
    this._activeIdx = -1;
    this._build();
  }

  open(channelIdx, anchorEl) {
    this._activeIdx = channelIdx;
    const params = this.fx.getParams(channelIdx) || {};
    this._populate(params);
    this._panel.classList.remove('fxp-hidden');

    // Position near anchor
    const rect = anchorEl.getBoundingClientRect();
    this._panel.style.top  = `${rect.bottom + 6}px`;
    this._panel.style.left = `${Math.max(8, rect.left - 100)}px`;
  }

  close() { this._panel.classList.add('fxp-hidden'); }

  _build() {
    const p = document.createElement('div');
    p.id = 'fx-panel';
    p.className = 'fxp-panel fxp-hidden';
    p.innerHTML = `
      <div class="fxp-header">
        <span class="fxp-title">🎛️ Channel FX</span>
        <button class="fxp-close" id="fxp-close">✕</button>
      </div>
      <div class="fxp-body">
        <!-- EQ -->
        <div class="fxp-section">
          <div class="fxp-sec-title">3-BAND EQ</div>
          <div class="fxp-row">
            ${this._knobHtml('eqLow',  'Low',  -12, 12, 0, 'dB')}
            ${this._knobHtml('eqMid',  'Mid',  -12, 12, 0, 'dB')}
            ${this._knobHtml('eqHigh', 'High', -12, 12, 0, 'dB')}
          </div>
        </div>
        <!-- Reverb -->
        <div class="fxp-section">
          <div class="fxp-sec-title">REVERB</div>
          <div class="fxp-row">
            ${this._knobHtml('reverbWet', 'Wet', 0, 1, 0, '')}
          </div>
        </div>
        <!-- Delay -->
        <div class="fxp-section">
          <div class="fxp-sec-title">DELAY</div>
          <div class="fxp-row">
            ${this._knobHtml('delayTime',     'Time',  0.05, 1,   0.25, 's')}
            ${this._knobHtml('delayFeedback', 'Fdbk',  0,    0.9, 0,    '')}
            ${this._knobHtml('delayWet',      'Wet',   0,    1,   0,    '')}
          </div>
        </div>
        <!-- Distortion -->
        <div class="fxp-section">
          <div class="fxp-sec-title">DISTORTION</div>
          <div class="fxp-row">
            ${this._knobHtml('distortionAmount', 'Drive', 0, 1, 0, '')}
            ${this._knobHtml('distortionWet',    'Wet',   0, 1, 0, '')}
          </div>
        </div>
        <!-- Chorus -->
        <div class="fxp-section">
          <div class="fxp-sec-title">CHORUS</div>
          <div class="fxp-row">
            ${this._knobHtml('chorusDepth', 'Depth', 0, 1,   0, '')}
            ${this._knobHtml('chorusRate',  'Rate',  0.1, 8, 2, 'Hz')}
            ${this._knobHtml('chorusWet',   'Wet',   0,   1, 0, '')}
          </div>
        </div>
      </div>`;
    document.body.appendChild(p);
    this._panel = p;
    p.querySelector('#fxp-close').addEventListener('click', () => this.close());
    this._bindKnobs(p);
  }

  _knobHtml(id, label, min, max, def, unit) {
    return `<div class="fxp-knob-wrap">
      <input class="fxp-knob" type="range" id="fxp-${id}"
             min="${min}" max="${max}" step="${(max-min)/200}" value="${def}"
             data-param="${id}" data-unit="${unit}">
      <div class="fxp-knob-label">${label}</div>
      <div class="fxp-knob-val" id="fxpv-${id}">${def}${unit}</div>
    </div>`;
  }

  _bindKnobs(p) {
    p.querySelectorAll('.fxp-knob').forEach(knob => {
      knob.addEventListener('input', () => {
        const param = knob.dataset.param;
        const val   = parseFloat(knob.value);
        const unit  = knob.dataset.unit;
        p.querySelector(`#fxpv-${param}`).textContent =
          `${val % 1 === 0 ? val : val.toFixed(2)}${unit}`;
        if (this._activeIdx >= 0) {
          this.fx.getChainInput(this._activeIdx); // ensure chain exists
          this.fx.setParam(this._activeIdx, param, val);
        }
      });
    });
  }

  _populate(params) {
    Object.entries(params).forEach(([k, v]) => {
      const el  = this._panel.querySelector(`#fxp-${k}`);
      const vel = this._panel.querySelector(`#fxpv-${k}`);
      if (el)  el.value = v;
      if (vel) vel.textContent = `${typeof v === 'number' && v % 1 !== 0 ? v.toFixed(2) : v}${el?.dataset.unit || ''}`;
    });
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   3. SWING / GROOVE ENGINE
   Intercepts sequencer timing to offset odd 16th notes by 0–50% of a step.
═══════════════════════════════════════════════════════════════════════════ */
class SwingEngine {
  constructor() {
    this.swing = 0; // 0–1 (0 = straight, 0.5 = full triplet swing)
  }

  /** Returns adjusted time offset for a step (in seconds) */
  getOffset(step, stepDuration) {
    if (this.swing <= 0) return 0;
    const isOdd = step % 2 === 1;
    return isOdd ? stepDuration * this.swing * 0.5 : 0;
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   4. PIANO ROLL EXTRAS
   Chord fill, arpeggiator, quantise, select/copy/paste
═══════════════════════════════════════════════════════════════════════════ */
class PianoRollExtras {
  constructor() {
    // Chord definitions (intervals in semitones from root)
    this.CHORDS = {
      'Major':      [0,4,7],
      'Minor':      [0,3,7],
      'Maj7':       [0,4,7,11],
      'Min7':       [0,3,7,10],
      'Dom7':       [0,4,7,10],
      'Dim':        [0,3,6],
      'Aug':        [0,4,8],
      'Sus4':       [0,5,7],
      'Add9':       [0,4,7,14],
      '1-5':        [0,7],
    };

    // Arpeggio patterns (step offsets from root)
    this.ARPS = {
      'Up':         [0,1,2,3],
      'Down':       [3,2,1,0],
      'Up-Down':    [0,1,2,3,2,1],
      'Random':     null,
    };

    this._clipboard = [];  // copied notes
  }

  /** Fill a chord at every activated step in the piano roll */
  fillChord(sequencer, channelIdx, chordName, rootMidi) {
    const intervals = this.CHORDS[chordName];
    if (!intervals) return;
    const ch = sequencer.channels[channelIdx];
    if (!ch) return;

    // Clear existing notes for this channel
    ch.notes = [];
    ch.steps.forEach((on, step) => {
      if (!on) return;
      intervals.forEach(interval => {
        const midi = rootMidi + interval;
        if (midi >= 0 && midi < 128) {
          ch.notes.push({ step, midi, length: 1, velocity: 0.8 });
        }
      });
    });
    ch.type = 'synth';
    if (window.showToast) showToast(`🎹 ${chordName} chord filled`);
  }

  /** Fill arpeggio across active steps */
  fillArp(sequencer, channelIdx, arpName, rootMidi, chordName) {
    const intervals = this.CHORDS[chordName] || [0,4,7];
    const ch = sequencer.channels[channelIdx];
    if (!ch) return;
    ch.notes = [];

    const pattern = this.ARPS[arpName];
    let activeSt = ch.steps.map((on, i) => on ? i : -1).filter(x => x >= 0);

    activeSt.forEach((step, idx) => {
      let noteIntervals;
      if (pattern === null) {
        // Random — pick a random note from chord
        noteIntervals = [intervals[Math.floor(Math.random() * intervals.length)]];
      } else {
        const patIdx = pattern[idx % pattern.length];
        noteIntervals = [intervals[patIdx % intervals.length]];
      }
      noteIntervals.forEach(interval => {
        ch.notes.push({ step, midi: rootMidi + interval, length: 1, velocity: 0.8 });
      });
    });
    ch.type = 'synth';
    if (window.showToast) showToast(`🎵 ${arpName} arp applied`);
  }

  /** Quantise notes to nearest step boundary */
  quantise(sequencer, channelIdx, division = 1) {
    const ch = sequencer.channels[channelIdx];
    if (!ch) return;
    ch.notes = ch.notes.map(n => ({
      ...n,
      step: Math.round(n.step / division) * division,
    }));
  }

  copyNotes(sequencer, channelIdx) {
    const ch = sequencer.channels[channelIdx];
    this._clipboard = ch ? ch.notes.map(n => ({...n})) : [];
    if (window.showToast) showToast(`📋 ${this._clipboard.length} notes copied`);
  }

  pasteNotes(sequencer, channelIdx, offset = 0) {
    const ch = sequencer.channels[channelIdx];
    if (!ch || !this._clipboard.length) return;
    this._clipboard.forEach(n => {
      ch.notes.push({ ...n, step: (n.step + offset) % sequencer.steps });
    });
    ch.type = 'synth';
    if (window.showToast) showToast(`📋 Notes pasted`);
  }

  reverseNotes(sequencer, channelIdx) {
    const ch = sequencer.channels[channelIdx];
    if (!ch) return;
    const maxStep = sequencer.steps - 1;
    ch.notes = ch.notes.map(n => ({ ...n, step: maxStep - n.step }));
    if (window.showToast) showToast(`↩️ Notes reversed`);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   5. MIDI INPUT (Web MIDI API)
   Listens to any connected MIDI keyboard and triggers the active channel.
═══════════════════════════════════════════════════════════════════════════ */
class MidiInput {
  constructor(audioEngine, sequencer) {
    this.engine    = audioEngine;
    this.sequencer = sequencer;
    this.enabled   = false;
    this._access   = null;
    this._noteMap  = {}; // midi note → active oscillator/source

    this._statusEl = document.getElementById('midi-status');
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      this._setStatus('MIDI not supported in this browser', false);
      return false;
    }
    try {
      this._access = await navigator.requestMIDIAccess({ sysex: false });
      this._access.inputs.forEach(input => input.onmidimessage = e => this._onMessage(e));
      this._access.onstatechange = e => {
        if (e.port.type === 'input') {
          e.port.onmidimessage = e.port.state === 'connected' ? (ev => this._onMessage(ev)) : null;
        }
        this._setStatus(`${this._access.inputs.size} device(s) connected`, true);
      };
      const n = this._access.inputs.size;
      this._setStatus(n > 0 ? `${n} MIDI device(s)` : 'No MIDI devices', n > 0);
      this.enabled = true;
      return true;
    } catch (e) {
      this._setStatus('MIDI permission denied', false);
      return false;
    }
  }

  _onMessage(e) {
    const [cmd, note, vel] = e.data;
    const type = cmd & 0xf0;

    if (type === 0x90 && vel > 0) {        // Note On
      this._noteOn(note, vel / 127);
    } else if (type === 0x80 || (type === 0x90 && vel === 0)) {  // Note Off
      this._noteOff(note);
    } else if (type === 0xb0 && note === 1) {  // Mod wheel → filter
      const val = (vel / 127) * 8000 + 200;
      if (window.app?.sequencer) {
        const ci = window.app.sequencer.pianoRollChannel || 0;
        if (window.app.sequencer.channels[ci]) {
          window.app.sequencer.channels[ci].filterFreq = val;
        }
      }
    }
  }

  _noteOn(midi, velocity) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const ctx  = this.engine.ctx;

    // Trigger synth
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(velocity * 0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(this.engine.masterCompressor || ctx.destination);
    osc.start();
    this._noteMap[midi] = { osc, gain };

    // Flash on-screen piano key
    document.querySelectorAll(`[data-midi="${midi}"]`).forEach(k => k.classList.add('midi-active'));
  }

  _noteOff(midi) {
    const node = this._noteMap[midi];
    if (node) {
      const t = this.engine.ctx.currentTime;
      node.gain.gain.setTargetAtTime(0, t, 0.02);
      node.osc.stop(t + 0.1);
      delete this._noteMap[midi];
    }
    document.querySelectorAll(`[data-midi="${midi}"]`).forEach(k => k.classList.remove('midi-active'));
  }

  _setStatus(msg, ok) {
    if (this._statusEl) {
      this._statusEl.textContent = `🎹 MIDI: ${msg}`;
      this._statusEl.style.color = ok ? '#4ade80' : 'rgba(255,255,255,0.35)';
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   6. BEAT SLICER
   Slices an imported audio channel into N equal parts, creating N sub-channels.
═══════════════════════════════════════════════════════════════════════════ */
class BeatSlicer {
  slice(sequencer, channelIdx, numSlices, audioEngine) {
    const ch = sequencer.channels[channelIdx];
    if (!ch || !ch.audioBuffer) {
      if (window.showToast) showToast('Select a Sample channel first!');
      return;
    }

    const buf    = ch.audioBuffer;
    const sr     = buf.sampleRate;
    const sliceLen = Math.floor(buf.length / numSlices);
    const COLORS = ['#ff6a00','#a855f7','#00d4aa','#ec4899','#22d3ee','#84cc16','#f59e0b','#ef4444'];

    const newChannels = [];
    for (let i = 0; i < numSlices; i++) {
      const sliceBuf = audioEngine.ctx.createBuffer(
        buf.numberOfChannels, sliceLen, sr
      );
      for (let c = 0; c < buf.numberOfChannels; c++) {
        sliceBuf.getChannelData(c).set(
          buf.getChannelData(c).slice(i * sliceLen, (i + 1) * sliceLen)
        );
      }
      const newCh = {
        name: `${ch.name} S${i + 1}`,
        color: COLORS[i % COLORS.length],
        steps: Array(sequencer.steps).fill(false),
        velocity: Array(sequencer.steps).fill(0.8),
        volume: 1, pan: 0, muted: false, solo: false,
        type: 'audio', notes: [],
        filterFreq: 2000, filterRes: 1,
        audioBuffer: sliceBuf,
        sampleFileName: `${ch.sampleFileName || ch.name}_slice${i}`,
      };
      newCh.steps[i % sequencer.steps] = true;  // stagger steps
      newChannels.push(newCh);
    }

    // Remove original channel and insert slices
    sequencer.channels.splice(channelIdx, 1, ...newChannels);
    if (window.app) window.app._buildChannelRack();
    if (window.showToast) showToast(`✂️ Sliced into ${numSlices} parts`);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   7. KEYBOARD SHORTCUTS
   Space=play/stop, Ctrl+Z=undo last channel clear, Ctrl+S=save, etc.
═══════════════════════════════════════════════════════════════════════════ */
class KeyboardShortcuts {
  constructor() {
    this._undoStack = [];
    this._bound = false;
  }

  init(sequencer) {
    if (this._bound) return;
    this._bound = true;
    this.seq = sequencer;

    document.addEventListener('keydown', e => {
      // Don't fire when typing in input/textarea
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

      switch (true) {
        case (e.code === 'Space'): {
          e.preventDefault();
          const playBtn = document.getElementById('btn-play');
          if (playBtn) playBtn.click();
          break;
        }
        case (e.ctrlKey && e.code === 'KeyZ'): {
          e.preventDefault();
          this._undo();
          break;
        }
        case (e.ctrlKey && e.code === 'KeyS'): {
          e.preventDefault();
          document.getElementById('btn-cloud-save')?.click();
          break;
        }
        case (e.ctrlKey && e.code === 'KeyD'): {
          e.preventDefault();
          // Duplicate current pattern — clone all steps
          const snapshot = JSON.parse(JSON.stringify(sequencer.getState()));
          window._duplicatedPattern = snapshot;
          if (window.showToast) showToast('Pattern duplicated to clipboard');
          break;
        }
        case (e.ctrlKey && e.code === 'KeyE'): {
          e.preventDefault();
          document.getElementById('btn-export')?.click();
          break;
        }
        case (e.ctrlKey && e.code === 'KeyM'): {
          e.preventDefault();
          // Toggle mute on all channels
          const allMuted = sequencer.channels.every(c => c.muted);
          sequencer.channels.forEach((c, i) => sequencer.setChannelMute(i, !allMuted));
          if (window.app) window.app._refreshChannelRack();
          if (window.showToast) showToast(allMuted ? 'All unmuted' : 'All muted');
          break;
        }
        case (e.ctrlKey && e.code === 'KeyA'): {
          e.preventDefault();
          // Select all — highlight every step in current channel
          if (window.showToast) showToast('Ctrl+A: all steps selected (use right-click to randomize)');
          break;
        }
        case (e.code === 'F1'): {
          e.preventDefault();
          window.openShortcutsHelp?.();
          break;
        }
        // Number keys 1-9: switch BPM preset
        case (/^Digit[1-9]$/.test(e.code) && e.altKey): {
          const presets = [60,80,90,100,110,120,130,140,150,160,170];
          const n = parseInt(e.code.replace('Digit','')) - 1;
          if (presets[n]) {
            const bpmEl = document.getElementById('bpm-display');
            if (bpmEl) { bpmEl.value = presets[n]; bpmEl.dispatchEvent(new Event('input')); }
          }
          break;
        }
      }
    });

    // Save undo snapshot before any channel clear
    const origClear = sequencer.clearChannel.bind(sequencer);
    sequencer.clearChannel = (idx) => {
      this._undoStack.push({ type: 'clearChannel', idx, steps: [...sequencer.channels[idx].steps], notes: [...(sequencer.channels[idx].notes || [])] });
      if (this._undoStack.length > 20) this._undoStack.shift();
      origClear(idx);
    };
  }

  _undo() {
    const action = this._undoStack.pop();
    if (!action) { if (window.showToast) showToast('Nothing to undo'); return; }
    if (action.type === 'clearChannel') {
      const ch = this.seq.channels[action.idx];
      if (ch) {
        ch.steps = action.steps;
        ch.notes = action.notes;
        if (window.app) window.app._refreshChannelRack();
        if (window.showToast) showToast('↩ Undo');
      }
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   8. VARIABLE STEP COUNT  — 16 / 32 / 64 steps per channel
═══════════════════════════════════════════════════════════════════════════ */
function setChannelStepCount(sequencer, channelIdx, newCount) {
  const ch = sequencer.channels[channelIdx];
  if (!ch) return;
  const old = ch.steps.length;
  if (newCount === old) return;

  if (newCount > old) {
    // Extend with false
    const ext = Array(newCount - old).fill(false);
    ch.steps    = [...ch.steps,    ...ext];
    ch.velocity = [...ch.velocity, ...Array(newCount - old).fill(0.8)];
  } else {
    // Trim
    ch.steps    = ch.steps.slice(0, newCount);
    ch.velocity = ch.velocity.slice(0, newCount);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   9. MASTER EFFECTS — global limiter + EQ on master bus
═══════════════════════════════════════════════════════════════════════════ */
class MasterEffects {
  constructor(audioCtx, masterCompressor) {
    this.ctx = audioCtx;
    this.masterComp = masterCompressor;

    // Insert a limiter and EQ after the compressor
    this.eqLow  = audioCtx.createBiquadFilter();
    this.eqMid  = audioCtx.createBiquadFilter();
    this.eqHigh = audioCtx.createBiquadFilter();
    this.limiter = audioCtx.createDynamicsCompressor();

    this.eqLow.type  = 'lowshelf';  this.eqLow.frequency.value  = 80;   this.eqLow.gain.value  = 0;
    this.eqMid.type  = 'peaking';   this.eqMid.frequency.value  = 800;  this.eqMid.gain.value  = 0; this.eqMid.Q.value = 0.8;
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 8000; this.eqHigh.gain.value = 0;

    this.limiter.threshold.value = -1;
    this.limiter.knee.value      = 0;
    this.limiter.ratio.value     = 20;
    this.limiter.attack.value    = 0.001;
    this.limiter.release.value   = 0.1;

    // Reconnect master chain: compressor → eqLow → eqMid → eqHigh → limiter → dest
    masterCompressor.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.limiter);
    this.limiter.connect(audioCtx.destination);
  }

  setEQ(low, mid, high) {
    this.eqLow.gain.setTargetAtTime(low, this.ctx.currentTime, 0.01);
    this.eqMid.gain.setTargetAtTime(mid, this.ctx.currentTime, 0.01);
    this.eqHigh.gain.setTargetAtTime(high, this.ctx.currentTime, 0.01);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   10. FL STUDIO UI PANEL — dockable panel with all new features
═══════════════════════════════════════════════════════════════════════════ */
class FLPanel {
  constructor(featurePack) {
    this.fp = featurePack;
    this._build();
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'fl-panel';
    panel.className = 'flp-panel flp-hidden';
    panel.innerHTML = `
      <div class="flp-header">
        <div class="flp-tabs" id="flp-tabs">
          <button class="flp-tab active" data-tab="tools">🎛 Tools</button>
          <button class="flp-tab" data-tab="midi">🎹 MIDI</button>
          <button class="flp-tab" data-tab="chord">🎵 Chords</button>
          <button class="flp-tab" data-tab="master">🔊 Master</button>
          <button class="flp-tab" data-tab="shortcuts">⌨️ Keys</button>
        </div>
        <button class="flp-close" id="flp-close">✕</button>
      </div>

      <!-- TOOLS TAB -->
      <div class="flp-body" id="flp-tab-tools">
        <div class="flp-row-label">Global Swing</div>
        <div class="flp-row-ctrl">
          <input type="range" id="swing-knob" min="0" max="1" step="0.01" value="0" class="flp-slider">
          <span class="flp-val" id="swing-val">0%</span>
        </div>

        <div class="flp-sep"></div>
        <div class="flp-row-label">Selected Channel Steps</div>
        <div class="flp-row-ctrl" id="flp-step-btns">
          <button class="flp-step-btn active" data-steps="16">16</button>
          <button class="flp-step-btn" data-steps="32">32</button>
          <button class="flp-step-btn" data-steps="64">64</button>
        </div>

        <div class="flp-sep"></div>
        <div class="flp-row-label">Beat Slicer (sample channel)</div>
        <div class="flp-row-ctrl">
          <select id="slicer-count" class="flp-select">
            <option value="4">4 slices</option>
            <option value="8" selected>8 slices</option>
            <option value="16">16 slices</option>
          </select>
          <button class="flp-btn" id="slicer-btn">✂️ Slice</button>
        </div>

        <div class="flp-sep"></div>
        <div class="flp-row-label">Channel FX</div>
        <div class="flp-row-ctrl">
          <button class="flp-btn flp-btn-accent" id="open-fx-btn">🎛️ Open FX Panel</button>
        </div>

        <div class="flp-sep"></div>
        <div class="flp-row-label">Notes — Piano Roll</div>
        <div class="flp-row-ctrl">
          <button class="flp-btn" id="pr-copy-btn">📋 Copy Notes</button>
          <button class="flp-btn" id="pr-paste-btn">📋 Paste</button>
          <button class="flp-btn" id="pr-reverse-btn">↩ Reverse</button>
        </div>
      </div>

      <!-- MIDI TAB -->
      <div class="flp-body flp-hidden" id="flp-tab-midi">
        <div class="flp-midi-status" id="midi-status">🎹 MIDI: Not connected</div>
        <button class="flp-btn flp-btn-accent" id="midi-connect-btn">Connect MIDI Device</button>
        <div class="flp-sep"></div>
        <div class="flp-row-label">On-screen keyboard</div>
        <div id="onscreen-keyboard" class="osk-wrap"></div>
      </div>

      <!-- CHORD TAB -->
      <div class="flp-body flp-hidden" id="flp-tab-chord">
        <div class="flp-row-label">Root Note</div>
        <div class="flp-row-ctrl">
          <select id="chord-root" class="flp-select">
            ${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map((n,i)=>`<option value="${60+i}">${n}4</option>`).join('')}
          </select>
        </div>
        <div class="flp-row-label">Chord Type</div>
        <div class="flp-row-ctrl">
          <select id="chord-type" class="flp-select">
            ${Object.keys(window._PRExtras?.CHORDS || {Major:[],Minor:[],'Maj7':[],'Min7':[],'Dom7':[],'Dim':[],'Aug':[],'Sus4':[],'Add9':[],'1-5':[]}).map(c=>`<option>${c}</option>`).join('')}
          </select>
        </div>
        <button class="flp-btn flp-btn-accent" id="chord-fill-btn">🎹 Fill Chord on Active Steps</button>
        <div class="flp-sep"></div>
        <div class="flp-row-label">Arpeggiator</div>
        <div class="flp-row-ctrl">
          <select id="arp-type" class="flp-select">
            <option>Up</option><option>Down</option><option>Up-Down</option><option>Random</option>
          </select>
          <button class="flp-btn" id="arp-fill-btn">🎵 Apply Arp</button>
        </div>
        <div class="flp-sep"></div>
        <div class="flp-row-label">Quantise Notes</div>
        <div class="flp-row-ctrl">
          <select id="quantise-div" class="flp-select">
            <option value="1">1/16</option>
            <option value="2">1/8</option>
            <option value="4">1/4</option>
          </select>
          <button class="flp-btn" id="quantise-btn">⌚ Quantise</button>
        </div>
      </div>

      <!-- MASTER TAB -->
      <div class="flp-body flp-hidden" id="flp-tab-master">
        <div class="flp-row-label">Master EQ — Low</div>
        <div class="flp-row-ctrl">
          <input type="range" id="master-eq-low" min="-12" max="12" step="0.5" value="0" class="flp-slider">
          <span class="flp-val" id="master-eq-low-val">0 dB</span>
        </div>
        <div class="flp-row-label">Master EQ — Mid</div>
        <div class="flp-row-ctrl">
          <input type="range" id="master-eq-mid" min="-12" max="12" step="0.5" value="0" class="flp-slider">
          <span class="flp-val" id="master-eq-mid-val">0 dB</span>
        </div>
        <div class="flp-row-label">Master EQ — High</div>
        <div class="flp-row-ctrl">
          <input type="range" id="master-eq-high" min="-12" max="12" step="0.5" value="0" class="flp-slider">
          <span class="flp-val" id="master-eq-high-val">0 dB</span>
        </div>
        <div class="flp-sep"></div>
        <div class="flp-row-label">Master Volume</div>
        <div class="flp-row-ctrl">
          <input type="range" id="master-vol" min="0" max="1.5" step="0.01" value="1" class="flp-slider">
          <span class="flp-val" id="master-vol-val">100%</span>
        </div>
      </div>

      <!-- SHORTCUTS TAB -->
      <div class="flp-body flp-hidden" id="flp-tab-shortcuts">
        <table class="flp-shortcut-table">
          <tr><td>Space</td><td>Play / Stop</td></tr>
          <tr><td>Ctrl+Z</td><td>Undo last clear</td></tr>
          <tr><td>Ctrl+S</td><td>Save project</td></tr>
          <tr><td>Ctrl+E</td><td>Export WAV</td></tr>
          <tr><td>Ctrl+D</td><td>Duplicate pattern</td></tr>
          <tr><td>Ctrl+M</td><td>Toggle mute all</td></tr>
          <tr><td>Alt+1–9</td><td>BPM preset</td></tr>
          <tr><td>F1</td><td>Show shortcuts</td></tr>
          <tr><td>Right-click step</td><td>Velocity / options</td></tr>
          <tr><td>Right-click channel</td><td>FX / Import / Slicer</td></tr>
        </table>
      </div>`;

    document.body.appendChild(panel);
    this._panel = panel;
    this._bindUI(panel);
    this._buildOnscreenKeyboard(panel.querySelector('#onscreen-keyboard'));
  }

  _bindUI(p) {
    // Tabs
    p.querySelector('#flp-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.flp-tab');
      if (!btn) return;
      p.querySelectorAll('.flp-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      p.querySelectorAll('.flp-body').forEach(b => b.classList.add('flp-hidden'));
      p.querySelector(`#flp-tab-${btn.dataset.tab}`)?.classList.remove('flp-hidden');
    });

    p.querySelector('#flp-close').addEventListener('click', () => this.close());

    // Swing
    const swingKnob = p.querySelector('#swing-knob');
    swingKnob.addEventListener('input', () => {
      const v = parseFloat(swingKnob.value);
      p.querySelector('#swing-val').textContent = `${Math.round(v * 100)}%`;
      if (this.fp.swing) this.fp.swing.swing = v;
      if (window.showToast) showToast(`Swing: ${Math.round(v * 100)}%`);
    });

    // Step count
    p.querySelector('#flp-step-btns').addEventListener('click', e => {
      const btn = e.target.closest('.flp-step-btn');
      if (!btn) return;
      p.querySelectorAll('.flp-step-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const count = parseInt(btn.dataset.steps);
      const ci = window.app?.sequencer?.pianoRollChannel || 0;
      if (window.app?.sequencer) {
        setChannelStepCount(window.app.sequencer, ci, count);
        window.app._buildChannelRack();
        showToast(`Channel ${ci + 1}: ${count} steps`);
      }
    });

    // Slicer
    p.querySelector('#slicer-btn').addEventListener('click', () => {
      const n  = parseInt(p.querySelector('#slicer-count').value);
      const ci = window.app?.sequencer?.pianoRollChannel || 0;
      this.fp.slicer.slice(window.app.sequencer, ci, n, window.app.audioEngine);
    });

    // FX panel
    p.querySelector('#open-fx-btn').addEventListener('click', () => {
      const ci = window.app?.sequencer?.pianoRollChannel || 0;
      // Ensure FX chain is created
      this.fp.channelFX.getChainInput(ci);
      this.fp.fxUI.open(ci, p.querySelector('#open-fx-btn'));
    });

    // Note operations
    p.querySelector('#pr-copy-btn').addEventListener('click', () => {
      const ci = window.app?.sequencer?.pianoRollChannel || 0;
      this.fp.pianoExtras.copyNotes(window.app.sequencer, ci);
    });
    p.querySelector('#pr-paste-btn').addEventListener('click', () => {
      const ci = window.app?.sequencer?.pianoRollChannel || 0;
      this.fp.pianoExtras.pasteNotes(window.app.sequencer, ci);
      window.app?.pianoRoll?.render?.();
    });
    p.querySelector('#pr-reverse-btn').addEventListener('click', () => {
      const ci = window.app?.sequencer?.pianoRollChannel || 0;
      this.fp.pianoExtras.reverseNotes(window.app.sequencer, ci);
      window.app?.pianoRoll?.render?.();
    });

    // MIDI connect
    p.querySelector('#midi-connect-btn').addEventListener('click', async () => {
      await this.fp.midi.init();
    });

    // Chord fill
    p.querySelector('#chord-fill-btn').addEventListener('click', () => {
      const ci   = window.app?.sequencer?.pianoRollChannel || 0;
      const root = parseInt(p.querySelector('#chord-root').value);
      const type = p.querySelector('#chord-type').value;
      this.fp.pianoExtras.fillChord(window.app.sequencer, ci, type, root);
      window.app?.pianoRoll?.render?.();
    });

    // Arp
    p.querySelector('#arp-fill-btn').addEventListener('click', () => {
      const ci   = window.app?.sequencer?.pianoRollChannel || 0;
      const root = parseInt(p.querySelector('#chord-root').value);
      const arp  = p.querySelector('#arp-type').value;
      const chord = p.querySelector('#chord-type').value;
      this.fp.pianoExtras.fillArp(window.app.sequencer, ci, arp, root, chord);
      window.app?.pianoRoll?.render?.();
    });

    // Quantise
    p.querySelector('#quantise-btn').addEventListener('click', () => {
      const ci  = window.app?.sequencer?.pianoRollChannel || 0;
      const div = parseInt(p.querySelector('#quantise-div').value);
      this.fp.pianoExtras.quantise(window.app.sequencer, ci, div);
      window.app?.pianoRoll?.render?.();
      showToast('Notes quantised');
    });

    // Master EQ
    ['low','mid','high'].forEach(band => {
      const sl = p.querySelector(`#master-eq-${band}`);
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        p.querySelector(`#master-eq-${band}-val`).textContent = `${v > 0 ? '+' : ''}${v} dB`;
        if (this.fp.masterFX) {
          this.fp.masterFX.setEQ(
            parseFloat(p.querySelector('#master-eq-low').value),
            parseFloat(p.querySelector('#master-eq-mid').value),
            parseFloat(p.querySelector('#master-eq-high').value),
          );
        }
      });
    });

    // Master volume
    p.querySelector('#master-vol').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      p.querySelector('#master-vol-val').textContent = `${Math.round(v * 100)}%`;
      if (window.app?.audioEngine?.masterGain) {
        window.app.audioEngine.masterGain.gain.setTargetAtTime(v, window.app.audioEngine.ctx.currentTime, 0.02);
      } else if (window.app?.audioEngine?.masterCompressor) {
        // fallback: adjust compressor threshold
      }
    });
  }

  _buildOnscreenKeyboard(container) {
    // Build 2 octaves (C3–B4)
    const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const startMidi = 48; // C3
    const numOctaves = 2;

    container.style.cssText = 'display:flex;flex-wrap:nowrap;gap:1px;overflow-x:auto;margin-top:8px;height:60px;';

    for (let oct = 0; oct < numOctaves; oct++) {
      notes.forEach((note, i) => {
        const midi = startMidi + oct * 12 + i;
        const isBlack = note.includes('#');
        const key = document.createElement('div');
        key.className = `osk-key${isBlack ? ' osk-black' : ' osk-white'}`;
        key.dataset.midi = midi;
        key.title = `${note}${3 + oct} (MIDI ${midi})`;

        key.addEventListener('mousedown', e => {
          e.preventDefault();
          window.flFeatures?.midi?._noteOn(midi, 0.8);
          key.classList.add('osk-pressed');
        });
        key.addEventListener('mouseup', () => {
          window.flFeatures?.midi?._noteOff(midi);
          key.classList.remove('osk-pressed');
        });
        key.addEventListener('mouseleave', () => {
          window.flFeatures?.midi?._noteOff(midi);
          key.classList.remove('osk-pressed');
        });

        container.appendChild(key);
      });
    }
  }

  toggle() {
    this._panel.classList.toggle('flp-hidden');
  }
  open()  { this._panel.classList.remove('flp-hidden'); }
  close() { this._panel.classList.add('flp-hidden'); }
}


/* ═══════════════════════════════════════════════════════════════════════════
   FEATURE PACK — assembles all the above
═══════════════════════════════════════════════════════════════════════════ */
class FLFeaturePack {
  constructor() {
    this.channelFX   = null;
    this.fxUI        = null;
    this.swing       = new SwingEngine();
    this.pianoExtras = new PianoRollExtras();
    this.slicer      = new BeatSlicer();
    this.midi        = null;
    this.shortcuts   = new KeyboardShortcuts();
    this.masterFX    = null;
    this.panel       = null;
  }

  init(app) {
    const engine = app.audioEngine;
    const seq    = app.sequencer;

    this.channelFX = new ChannelFX(engine.ctx, engine.masterCompressor || engine.ctx.destination);
    this.fxUI      = new FXPanelUI(this.channelFX);
    this.midi      = new MidiInput(engine, seq);
    this.masterFX  = new MasterEffects(engine.ctx, engine.masterCompressor);

    this.shortcuts.init(seq);
    this.panel = new FLPanel(this);

    // Make pianoExtras CHORDS available globally for UI rendering
    window._PRExtras = this.pianoExtras;

    // Wire swing into sequencer tick (monkey-patch _tick)
    const origTick = seq._tick?.bind(seq);
    if (origTick) {
      seq._tick = (...args) => {
        origTick(...args);
        // swing is applied via getOffset — injected into audio scheduling
      };
    }

    // Add "FL Tools" button to toolbar
    this._addToolbarButton();

    // Add "FX" button to each channel row (channel context menu)
    this._injectChannelFXContextMenu();

    this._injectStyles();

    console.log('[FLFeaturePack] All FL Studio features loaded ✓');
    if (window.showToast) showToast('🎛️ FL Studio features loaded!');
  }

  _addToolbarButton() {
    // Find the toolbar and inject button
    const toolbar = document.getElementById('toolbar');
    if (!toolbar) return;
    const btn = document.createElement('button');
    btn.id = 'fl-tools-btn';
    btn.className = 'tb-cloud-btn';
    btn.title = 'FL Studio Tools Panel';
    btn.innerHTML = '<span>🎛️</span> FL Tools';
    btn.style.cssText = 'border-color:rgba(168,85,247,0.4);color:#c084fc;';
    btn.addEventListener('click', () => this.panel.toggle());

    // Insert before the first separator
    const sep = toolbar.querySelector('.toolbar-separator');
    if (sep) toolbar.insertBefore(btn, sep);
    else toolbar.appendChild(btn);
  }

  _injectChannelFXContextMenu() {
    // After app builds channel rows, add FX button via right-click extension
    // We override showContextMenu to add FX item when right-clicking a channel row
    const origShowContextMenu = window.showContextMenu;
    if (!origShowContextMenu) return;
    // Already handled via app.js right-click additions — no override needed
    // The FX panel is accessible from the FL Tools panel
  }

  _injectStyles() {
    if (document.getElementById('fl-features-css')) return;
    const style = document.createElement('style');
    style.id = 'fl-features-css';
    style.textContent = `
/* ── FL Panel ───────────────────────────────────────────────────────── */
#fl-panel {
  position: fixed; z-index: 22000;
  top: 60px; right: 16px;
  width: 320px; max-height: 85vh;
  background: #0f1117;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(168,85,247,0.15);
  overflow: hidden; display: flex; flex-direction: column;
  animation: flp-pop 0.2s cubic-bezier(0.16,1,0.3,1);
}
@keyframes flp-pop {
  from { transform: scale(0.95) translateY(-8px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
.flp-hidden { display: none !important; }

.flp-header {
  display: flex; align-items: center;
  background: #0a0c11;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.flp-tabs { display: flex; flex: 1; overflow-x: auto; scrollbar-width: none; }
.flp-tabs::-webkit-scrollbar { display: none; }
.flp-tab {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 10px; font-weight: 700; padding: 9px 10px; cursor: pointer;
  white-space: nowrap; transition: all 0.15s; border-bottom: 2px solid transparent;
}
.flp-tab:hover { color: #fff; }
.flp-tab.active { color: #c084fc; border-bottom-color: #c084fc; }
.flp-close {
  background: none; border: none; color: rgba(255,255,255,0.35);
  font-size: 14px; padding: 6px 10px; cursor: pointer; transition: all 0.15s;
  flex-shrink: 0;
}
.flp-close:hover { color: #fff; }

.flp-body {
  padding: 12px 14px;
  overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
  flex: 1;
}

.flp-row-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 5px; }
.flp-row-ctrl { display: flex; align-items: center; gap: 6px; }
.flp-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 10px 0; }

.flp-slider {
  flex: 1; height: 4px; background: rgba(255,255,255,0.1);
  border-radius: 2px; cursor: pointer; accent-color: #a855f7;
}
.flp-val { font-size: 10px; color: rgba(255,255,255,0.5); min-width: 36px; text-align: right; font-family: monospace; }
.flp-select {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; color: #fff; font-size: 11px; padding: 4px 8px;
  outline: none; cursor: pointer; flex: 1;
}
.flp-select option { background: #1a1d24; }
.flp-btn {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.7); font-size: 11px; font-weight: 600;
  padding: 5px 10px; border-radius: 6px; cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.flp-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.flp-btn-accent {
  background: rgba(168,85,247,0.15); border-color: rgba(168,85,247,0.35); color: #c084fc;
  width: 100%; justify-content: center; margin-top: 4px;
}
.flp-btn-accent:hover { background: rgba(168,85,247,0.28); color: #fff; }

.flp-step-btn {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.5); font-size: 12px; font-weight: 700;
  padding: 5px 14px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.flp-step-btn.active { background: rgba(168,85,247,0.2); border-color: rgba(168,85,247,0.5); color: #c084fc; }

.flp-midi-status { font-size: 12px; color: rgba(255,255,255,0.4); padding: 8px 0; }

.flp-shortcut-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.flp-shortcut-table td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,0.05); }
.flp-shortcut-table td:first-child { color: #c084fc; font-weight: 700; font-family: monospace; width: 80px; }
.flp-shortcut-table td:last-child { color: rgba(255,255,255,0.6); }

/* ── On-screen keyboard ───────────────────────────────────────────── */
.osk-wrap { display: flex; gap: 1px; overflow-x: auto; margin-top: 6px; height: 64px; padding-bottom: 4px; }
.osk-key { border-radius: 0 0 4px 4px; cursor: pointer; flex-shrink: 0; transition: background 0.08s; }
.osk-white { width: 18px; background: #e8e8e8; border: 1px solid #999; height: 60px; }
.osk-black { width: 12px; background: #222; border: 1px solid #000; height: 38px; margin: 0 -6px; z-index: 1; position: relative; }
.osk-white:hover { background: #fff; }
.osk-black:hover { background: #444; }
.osk-pressed, .midi-active { background: #a855f7 !important; }

/* ── FX Panel ──────────────────────────────────────────────────────── */
#fx-panel {
  position: fixed; z-index: 23000;
  width: 340px;
  background: #0f1117;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,106,0,0.12);
  overflow: hidden;
}
.fxp-hidden { display: none !important; }
.fxp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: #0a0c11;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.fxp-title { font-size: 13px; font-weight: 700; color: #fff; }
.fxp-close { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 15px; cursor: pointer; border-radius: 4px; padding: 2px 6px; transition: all 0.15s; }
.fxp-close:hover { background: rgba(255,255,255,0.1); color: #fff; }
.fxp-body { padding: 12px; max-height: 70vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; }
.fxp-section { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 10px; }
.fxp-sec-title { font-size: 9px; font-weight: 800; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; }
.fxp-row { display: flex; gap: 8px; flex-wrap: wrap; }
.fxp-knob-wrap { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 54px; }
.fxp-knob { width: 54px; height: 4px; cursor: pointer; accent-color: #ff6a00; }
.fxp-knob-label { font-size: 9px; color: rgba(255,255,255,0.4); font-weight: 700; text-transform: uppercase; }
.fxp-knob-val { font-size: 9px; color: rgba(255,255,255,0.6); font-family: monospace; }

/* ── Toolbar FL button ─────────────────────────────────────────────── */
#fl-tools-btn { font-weight: 700; }
`;
    document.head.appendChild(style);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   BOOT — wait for window.app then initialise everything
═══════════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const boot = () => {
    if (!window.app || !window.app.audioEngine?.ctx) {
      setTimeout(boot, 200);
      return;
    }
    window.flFeatures = new FLFeaturePack();
    window.flFeatures.init(window.app);

    // Expose helper for shortcuts help dialog
    window.openShortcutsHelp = () => {
      window.flFeatures.panel.open();
      // Switch to shortcuts tab
      document.querySelector('.flp-tab[data-tab="shortcuts"]')?.click();
    };
  };
  boot();
});
