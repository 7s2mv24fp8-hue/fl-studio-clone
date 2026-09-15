/**
 * FL Studio Clone — Mixer
 * Canvas knobs, faders, VU meters, mute/solo
 */

class Mixer {
  constructor(containerEl, sequencer, audioEngine) {
    this.container = containerEl;
    this.sequencer = sequencer;
    this.engine = audioEngine;

    // Mixer channels (one per sequencer channel + master)
    this.channels = this._buildChannels();

    // VU animation
    this._vuLevels = Array(this.channels.length).fill(0);
    this._vuTargets = Array(this.channels.length).fill(0);
    this._vuAnimId = null;

    this.render();
    this._startVUAnimation();
  }

  _buildChannels() {
    const seqChannels = this.sequencer.channels.map((c, i) => ({
      name: c.name,
      color: c.color,
      volume: 100,
      pan: 0,
      muted: false,
      solo: false,
      seqIdx: i,
    }));
    const master = {
      name: 'Master',
      color: '#ff6a00',
      volume: 85,
      pan: 0,
      muted: false,
      solo: false,
      seqIdx: -1,
      isMaster: true,
    };
    return [master, ...seqChannels];
  }

  // ── Render ─────────────────────────────────────────────────────
  render() {
    this.container.innerHTML = '';

    this.channels.forEach((ch, idx) => {
      const strip = this._buildStrip(ch, idx);
      this.container.appendChild(strip);
    });
  }

  _buildStrip(ch, idx) {
    const strip = document.createElement('div');
    strip.className = `mixer-channel${ch.isMaster ? ' master' : ''}`;
    strip.dataset.idx = idx;

    // Color stripe
    const colorStripe = document.createElement('div');
    colorStripe.className = 'ch-color-stripe';
    colorStripe.style.background = ch.color;
    strip.appendChild(colorStripe);

    // Name
    const name = document.createElement('div');
    name.className = 'mixer-ch-name';
    name.textContent = ch.name;
    strip.appendChild(name);

    // VU meter
    const vuWrap = document.createElement('div');
    vuWrap.className = 'vu-wrap';
    const vuL = document.createElement('div');
    vuL.className = 'vu-bar';
    const vuFillL = document.createElement('div');
    vuFillL.className = 'vu-fill';
    vuFillL.id = `vu-${idx}-l`;
    vuL.appendChild(vuFillL);
    const vuR = document.createElement('div');
    vuR.className = 'vu-bar';
    const vuFillR = document.createElement('div');
    vuFillR.className = 'vu-fill';
    vuFillR.id = `vu-${idx}-r`;
    vuR.appendChild(vuFillR);
    vuWrap.appendChild(vuL);
    vuWrap.appendChild(vuR);
    strip.appendChild(vuWrap);

    // Pan knob
    const panWrap = document.createElement('div');
    panWrap.className = 'pan-wrap';
    const panLabel = document.createElement('div');
    panLabel.className = 'pan-label';
    panLabel.textContent = 'PAN';
    const panCanvas = document.createElement('canvas');
    panCanvas.width = 32; panCanvas.height = 32;
    panCanvas.style.cursor = 'ns-resize';
    panCanvas.dataset.idx = idx;
    panCanvas.dataset.type = 'pan';
    this._renderKnob(panCanvas, ch.pan, -100, 100, '#666');
    this._attachKnobDrag(panCanvas, ch, 'pan', -100, 100, () => {
      this._renderKnob(panCanvas, ch.pan, -100, 100, '#666');
      this._updatePanDisplay(panLabel, ch.pan);
    });
    panWrap.appendChild(panLabel);
    panWrap.appendChild(panCanvas);
    const panVal = document.createElement('div');
    panVal.className = 'pan-label';
    this._updatePanDisplay(panVal, ch.pan);
    panWrap.appendChild(panVal);
    strip.appendChild(panWrap);

    // Fader
    const faderWrap = document.createElement('div');
    faderWrap.className = 'fader-wrap';
    faderWrap.style.minHeight = '80px';

    const faderTrack = document.createElement('div');
    faderTrack.className = 'fader-track';
    faderTrack.style.height = '80px';

    const faderFill = document.createElement('div');
    faderFill.className = 'fader-fill';
    faderFill.id = `fader-fill-${idx}`;
    faderFill.style.height = `${ch.volume}%`;

    const faderThumb = document.createElement('div');
    faderThumb.className = 'fader-thumb';
    faderThumb.id = `fader-thumb-${idx}`;
    faderThumb.style.bottom = `calc(${ch.volume}% - 5px)`;

    faderTrack.appendChild(faderFill);
    faderTrack.appendChild(faderThumb);
    this._attachFaderDrag(faderTrack, faderThumb, faderFill, ch, idx);

    const faderValue = document.createElement('div');
    faderValue.className = 'fader-value';
    faderValue.id = `fader-val-${idx}`;
    faderValue.textContent = `${ch.volume}%`;

    faderWrap.appendChild(faderTrack);
    faderWrap.appendChild(faderValue);
    strip.appendChild(faderWrap);

    // Mute/Solo
    const btns = document.createElement('div');
    btns.className = 'mixer-ch-btns';

    const muteBtn = document.createElement('button');
    muteBtn.className = `mix-btn${ch.muted ? ' muted' : ''}`;
    muteBtn.textContent = 'M';
    muteBtn.title = 'Mute';
    muteBtn.addEventListener('click', () => {
      ch.muted = !ch.muted;
      muteBtn.classList.toggle('muted', ch.muted);
      if (ch.seqIdx >= 0) this.sequencer.setChannelMute(ch.seqIdx, ch.muted);
      if (ch.isMaster && this.engine.masterGain) {
        this.engine.masterGain.gain.value = ch.muted ? 0 : ch.volume / 100;
      }
    });

    const soloBtn = document.createElement('button');
    soloBtn.className = `mix-btn${ch.solo ? ' soloed' : ''}`;
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo';
    soloBtn.addEventListener('click', () => {
      ch.solo = !ch.solo;
      soloBtn.classList.toggle('soloed', ch.solo);
      if (ch.seqIdx >= 0) this.sequencer.setChannelSolo(ch.seqIdx, ch.solo);
    });

    btns.appendChild(muteBtn);
    btns.appendChild(soloBtn);
    strip.appendChild(btns);

    return strip;
  }

  _updatePanDisplay(el, pan) {
    if (pan === 0) el.textContent = 'C';
    else if (pan < 0) el.textContent = `L${Math.abs(pan)}`;
    else el.textContent = `R${pan}`;
  }

  // ── Knob rendering ─────────────────────────────────────────────
  _renderKnob(canvas, value, min, max, color) {
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const r = cx - 3;
    const normalized = (value - min) / (max - min);
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const angle = startAngle + normalized * (endAngle - startAngle);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = '#2d2d2d';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Fill
    const fillColor = value === 0 ? '#555' : (color || '#ff6a00');
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, angle);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#888';
    ctx.fill();

    // Indicator line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (r - 2) * Math.cos(angle), cy + (r - 2) * Math.sin(angle));
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _attachKnobDrag(canvas, ch, prop, min, max, onChange) {
    let startY, startVal;
    canvas.addEventListener('mousedown', e => {
      startY = e.clientY;
      startVal = ch[prop];
      e.preventDefault();

      const onMove = (me) => {
        const delta = (startY - me.clientY) * 0.8;
        ch[prop] = Math.max(min, Math.min(max, Math.round(startVal + delta)));
        if (prop === 'volume' && ch.seqIdx >= 0) {
          this.sequencer.setChannelVolume(ch.seqIdx, ch.volume / 100);
        }
        onChange();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    canvas.addEventListener('dblclick', () => {
      ch[prop] = prop === 'pan' ? 0 : 85;
      onChange();
    });
  }

  _attachFaderDrag(track, thumb, fill, ch, idx) {
    let dragging = false;
    let startY, startVal;

    thumb.addEventListener('mousedown', e => {
      dragging = true;
      startY = e.clientY;
      startVal = ch.volume;
      e.preventDefault();

      const onMove = (me) => {
        if (!dragging) return;
        const trackRect = track.getBoundingClientRect();
        const trackH = trackRect.height;
        const dy = startY - me.clientY;
        const pctDelta = (dy / trackH) * 100;
        ch.volume = Math.max(0, Math.min(130, Math.round(startVal + pctDelta)));
        this._updateFaderUI(fill, thumb, ch, idx);

        if (ch.isMaster && this.engine.masterGain) {
          this.engine.masterGain.gain.value = (ch.volume / 100) * 0.85;
        } else if (ch.seqIdx >= 0) {
          this.sequencer.setChannelVolume(ch.seqIdx, ch.volume / 100);
        }
      };
      const onUp = () => {
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Click on track
    track.addEventListener('click', e => {
      const rect = track.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const h = rect.height;
      ch.volume = Math.round((1 - y / h) * 130);
      ch.volume = Math.max(0, Math.min(130, ch.volume));
      this._updateFaderUI(fill, thumb, ch, idx);
    });
  }

  _updateFaderUI(fill, thumb, ch, idx) {
    const pct = (ch.volume / 130) * 100;
    fill.style.height = `${pct}%`;
    thumb.style.bottom = `calc(${pct}% - 5px)`;
    const valEl = document.getElementById(`fader-val-${idx}`);
    if (valEl) valEl.textContent = `${ch.volume}%`;
  }

  // ── VU meter animation ─────────────────────────────────────────
  _startVUAnimation() {
    const update = () => {
      this.channels.forEach((ch, idx) => {
        let target = 0;
        if (!ch.muted && this.sequencer.isPlaying) {
          // Simulate VU activity based on channel activity
          const seqCh = ch.isMaster ? null : this.sequencer.channels[ch.seqIdx];
          const isActive = ch.isMaster || (seqCh && seqCh.steps.some(s => s));
          if (isActive) {
            const base = ch.isMaster ? 60 : 40;
            const vol = ch.volume / 100;
            target = (base + Math.random() * 30) * vol;
            // Spike on beats
            const step = this.sequencer.currentStep;
            if (seqCh && seqCh.steps[step]) {
              target = Math.min(95, target + 25);
            }
          }
        }
        this._vuTargets[idx] = target;
        this._vuLevels[idx] += (target - this._vuLevels[idx]) * 0.25;
        if (!this.sequencer.isPlaying) {
          this._vuLevels[idx] *= 0.88; // Decay
        }

        const lvl = Math.max(0, Math.min(100, this._vuLevels[idx]));
        const lEl = document.getElementById(`vu-${idx}-l`);
        const rEl = document.getElementById(`vu-${idx}-r`);
        if (lEl) lEl.style.height = `${lvl}%`;
        if (rEl) rEl.style.height = `${Math.min(100, lvl * (0.85 + Math.random() * 0.15))}%`;
      });

      this._vuAnimId = requestAnimationFrame(update);
    };
    this._vuAnimId = requestAnimationFrame(update);
  }

  stopVU() {
    if (this._vuAnimId) cancelAnimationFrame(this._vuAnimId);
  }
}

window.Mixer = Mixer;
