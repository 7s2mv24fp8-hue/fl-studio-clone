/**
 * FL Studio Clone — Piano Roll
 * Canvas-based MIDI note editor
 */

class PianoRoll {
  constructor(canvasEl, keysCanvasEl, sequencer) {
    this.canvas = canvasEl;
    this.keysCanvas = keysCanvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.keysCtx = keysCanvasEl.getContext('2d');
    this.sequencer = sequencer;

    // View config
    this.cellW = 48;   // pixels per step
    this.cellH = 14;   // pixels per semitone
    this.steps = 16;
    this.octaves = 8;  // C0–C8
    this.totalNotes = this.octaves * 12; // 96

    // Canvas sizing
    this.totalW = this.cellW * this.steps;
    this.totalH = this.cellH * this.totalNotes;

    // State
    this.tool = 'draw'; // 'draw' | 'erase' | 'select'
    this.quantize = 1;  // steps per note (1=1 step)
    this.isDragging = false;
    this.dragNote = null;
    this.playhead = 0; // current step playback position

    // Which channel we're editing
    this.channelIdx = 6; // Bass

    // Colors
    this.colors = {
      bg: '#1a1a1a',
      bgAlt: '#1e1e1e',
      gridLine: '#2d2d2d',
      gridLineBeat: '#383838',
      blackKey: '#111',
      whiteKey: '#2a2a2a',
      note: '#ec4899',
      noteSelected: '#ff6a00',
      noteOutline: 'rgba(0,0,0,0.5)',
      playhead: '#ff6a00',
      cLine: '#3a3a3a',
    };

    this._initCanvas();
    this._attachEvents();
    this.render();
  }

  _initCanvas() {
    this.canvas.width = this.totalW;
    this.canvas.height = this.totalH;
    this.keysCanvas.width = 48;
    this.keysCanvas.height = this.totalH;
    this._renderKeys();
  }

  setChannel(idx) {
    this.channelIdx = idx;
    const ch = this.sequencer.channels[idx];
    this.colors.note = ch ? ch.color : '#ec4899';
    this.render();
  }

  // ── Piano key rendering ────────────────────────────────────────
  _renderKeys() {
    const ctx = this.keysCtx;
    const totalNotes = this.totalNotes;
    ctx.clearRect(0, 0, 48, this.totalH);

    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const isBlack = [false,true,false,true,false,false,true,false,true,false,true,false];

    for (let i = 0; i < totalNotes; i++) {
      const noteIdx = totalNotes - 1 - i; // top = highest note
      const noteName = noteNames[noteIdx % 12];
      const isB = isBlack[noteIdx % 12];
      const octave = Math.floor(noteIdx / 12);
      const y = i * this.cellH;
      const h = this.cellH;

      ctx.fillStyle = isB ? this.colors.blackKey : this.colors.whiteKey;
      ctx.fillRect(0, y, 48, h);

      // Key border
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(0, y, 48, h);

      // Label C notes
      if (noteName === 'C') {
        ctx.fillStyle = '#666';
        ctx.font = `bold 9px JetBrains Mono, monospace`;
        ctx.textAlign = 'right';
        ctx.fillText(`C${octave}`, 44, y + h - 2);
      } else if (!isB) {
        ctx.fillStyle = '#3a3a3a';
        ctx.font = `8px Inter, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(noteName, 42, y + h - 2);
      }

      // Highlight on black key
      if (isB) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, y, 32, h);
      }
    }
  }

  // ── Note grid rendering ────────────────────────────────────────
  render() {
    const ctx = this.ctx;
    const { totalW, totalH, cellW, cellH, totalNotes, steps } = this;

    ctx.clearRect(0, 0, totalW, totalH);

    const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const isBlack = [false,true,false,true,false,false,true,false,true,false,true,false];

    // Draw rows
    for (let i = 0; i < totalNotes; i++) {
      const noteIdx = totalNotes - 1 - i;
      const isB = isBlack[noteIdx % 12];
      const y = i * cellH;

      // Row background
      ctx.fillStyle = isB ? '#161616' : '#1a1a1a';
      ctx.fillRect(0, y, totalW, cellH);

      // C note highlight
      if (noteIdx % 12 === 0) {
        ctx.fillStyle = 'rgba(255,106,0,0.04)';
        ctx.fillRect(0, y, totalW, cellH);
        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(totalW, y);
        ctx.stroke();
      }
    }

    // Vertical grid lines (steps)
    for (let s = 0; s <= steps; s++) {
      const x = s * cellW;
      ctx.strokeStyle = s % 4 === 0 ? '#383838' : '#252525';
      ctx.lineWidth = s % 4 === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalH);
      ctx.stroke();

      // Beat number
      if (s < steps && s % 4 === 0) {
        ctx.fillStyle = '#4a4a4a';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${s / 4 + 1}`, x + 2, 10);
      }
    }

    // Horizontal grid lines
    for (let i = 0; i <= totalNotes; i++) {
      const y = i * cellH;
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(totalW, y);
      ctx.stroke();
    }

    // Draw notes
    const ch = this.sequencer.channels[this.channelIdx];
    if (ch && ch.notes) {
      ch.notes.forEach(note => {
        const { step, midi, length, velocity = 0.8 } = note;
        const noteRowIdx = this.totalNotes - 1 - midi;
        const x = step * cellW + 1;
        const y = noteRowIdx * cellH + 1;
        const w = length * cellW - 2;
        const h = cellH - 2;

        // Note shadow
        ctx.shadowColor = ch.color;
        ctx.shadowBlur = 6;

        // Note body
        const noteColor = ch.color || '#ec4899';
        ctx.fillStyle = noteColor;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 2);
        ctx.fill();

        // Velocity overlay
        ctx.fillStyle = `rgba(0,0,0,${0.4 - velocity * 0.3})`;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 2);
        ctx.fill();

        // Highlight top edge
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(x, y, w, 2);

        ctx.shadowBlur = 0;

        // Note outline
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 2);
        ctx.stroke();
      });
    }

    // Playhead
    if (this.sequencer.isPlaying) {
      const px = this.playhead * cellW;
      const grad = ctx.createLinearGradient(px, 0, px + 3, 0);
      grad.addColorStop(0, 'rgba(255,106,0,0.9)');
      grad.addColorStop(1, 'rgba(255,106,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(px, 0, 3, totalH);
    }
  }

  // ── Event handling ─────────────────────────────────────────────
  _attachEvents() {
    this.canvas.addEventListener('mousedown', e => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', e => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup',   e => this._onMouseUp(e));
    this.canvas.addEventListener('contextmenu', e => { e.preventDefault(); this._eraseAt(e); });
    this.canvas.addEventListener('mouseleave', () => { this.isDragging = false; });
  }

  _getGridPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = Math.floor(x / this.cellW);
    const noteRow = Math.floor(y / this.cellH);
    const midi = this.totalNotes - 1 - noteRow;
    return { step, midi, x, y };
  }

  _onMouseDown(e) {
    e.preventDefault();
    this.isDragging = true;

    if (e.button === 2) { this._eraseAt(e); return; }

    const pos = this._getGridPos(e);
    if (pos.step < 0 || pos.step >= this.steps) return;
    if (pos.midi < 0 || pos.midi >= this.totalNotes) return;

    if (this.tool === 'draw') {
      // Check if note exists at this pos
      const ch = this.sequencer.channels[this.channelIdx];
      const existing = ch.notes.find(n => n.step === pos.step && n.midi === pos.midi);
      if (existing) {
        this.sequencer.removeNote(this.channelIdx, pos.step, pos.midi);
      } else {
        this.sequencer.addNote(this.channelIdx, pos.step, pos.midi, this.quantize, 0.8);
        this.dragNote = { step: pos.step, midi: pos.midi };
        // Play preview
        if (this.sequencer.engine.initialized) {
          const freq = this.sequencer._midiToFreq(pos.midi);
          const ch = this.sequencer.channels[this.channelIdx];
          if (ch.name === 'Bass') this.sequencer.engine.playBass(0, { freq, gain: 0.3, duration: 0.3 });
          else this.sequencer.engine.playSynth(0, { freq, gain: 0.25, duration: 0.3 });
        }
      }
    } else if (this.tool === 'erase') {
      this._eraseAt(e);
    }

    this.render();
  }

  _onMouseMove(e) {
    if (!this.isDragging || this.tool !== 'draw') return;
    const pos = this._getGridPos(e);
    if (pos.step < 0 || pos.step >= this.steps) return;
    if (pos.midi < 0 || pos.midi >= this.totalNotes) return;

    const ch = this.sequencer.channels[this.channelIdx];
    const existing = ch.notes.find(n => n.step === pos.step && n.midi === pos.midi);
    if (!existing) {
      this.sequencer.addNote(this.channelIdx, pos.step, pos.midi, this.quantize, 0.8);
      this.render();
    }
  }

  _onMouseUp(e) {
    this.isDragging = false;
    this.dragNote = null;
  }

  _eraseAt(e) {
    const pos = this._getGridPos(e);
    if (pos.step < 0 || pos.step >= this.steps) return;
    if (pos.midi < 0 || pos.midi >= this.totalNotes) return;
    this.sequencer.removeNote(this.channelIdx, pos.step, pos.midi);
    this.render();
  }

  setTool(tool) {
    this.tool = tool;
    this.canvas.style.cursor = tool === 'erase' ? 'cell' : 'crosshair';
  }

  setQuantize(q) {
    this.quantize = q;
  }

  updatePlayhead(step) {
    this.playhead = step;
    this.render();
  }

  clear() {
    const ch = this.sequencer.channels[this.channelIdx];
    ch.notes = [];
    ch.steps.fill(false);
    this.render();
  }
}

window.PianoRoll = PianoRoll;
