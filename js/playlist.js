/**
 * FL Studio Clone — Playlist
 * Pattern arrangement on a timeline canvas
 */

class Playlist {
  constructor(canvasEl, labelsEl, sequencer) {
    this.canvas = canvasEl;
    this.labelsEl = labelsEl;
    this.sequencer = sequencer;
    this.ctx = canvasEl.getContext('2d');

    // Grid config
    this.trackH = 32;
    this.cellW  = 48;  // pixels per bar (1 bar = 1 pattern block)
    this.bars   = 32;  // total bars in playlist
    this.tracks = [];  // [{name, color, blocks: [{bar, length}]}]

    this.tool = 'draw';
    this.isDragging = false;
    this.playPosition = 0; // current bar (float)
    this.isLooping = false;
    this.loopStart = 0;
    this.loopEnd = 8;

    this._initTracks();
    this._initCanvas();
    this._renderLabels();
    this._attachEvents();
    this.render();
  }

  _initTracks() {
    this.tracks = this.sequencer.channels.map(ch => ({
      name: ch.name,
      color: ch.color,
      blocks: [],
    }));
    // Add some default blocks
    this.tracks[0].blocks = [{bar: 0, length: 4}, {bar: 4, length: 4}];
    this.tracks[1].blocks = [{bar: 0, length: 4}];
    this.tracks[2].blocks = [{bar: 0, length: 4}, {bar: 4, length: 4}];
    this.tracks[4].blocks = [{bar: 0, length: 4}];
    this.tracks[6].blocks = [{bar: 2, length: 2}];
    this.tracks[7].blocks = [{bar: 0, length: 4}];
  }

  _initCanvas() {
    const h = this.tracks.length * this.trackH;
    const w = this.bars * this.cellW;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  _renderLabels() {
    this.labelsEl.innerHTML = '';
    this.tracks.forEach((track, i) => {
      const label = document.createElement('div');
      label.className = 'pl-track-label';
      label.style.height = `${this.trackH}px`;

      const dot = document.createElement('div');
      dot.className = 'pl-track-dot';
      dot.style.background = track.color;

      const name = document.createElement('span');
      name.textContent = track.name;

      label.appendChild(dot);
      label.appendChild(name);
      this.labelsEl.appendChild(label);
    });
  }

  render() {
    const ctx = this.ctx;
    const { bars, cellW, trackH, tracks } = this;
    const w = bars * cellW;
    const h = tracks.length * trackH;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    // Track rows
    tracks.forEach((track, ti) => {
      const y = ti * trackH;

      // Alternating row backgrounds
      ctx.fillStyle = ti % 2 === 0 ? '#1a1a1a' : '#1e1e1e';
      ctx.fillRect(0, y, w, trackH);

      // Track separator
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + trackH);
      ctx.lineTo(w, y + trackH);
      ctx.stroke();

      // Pattern blocks
      track.blocks.forEach(block => {
        const x = block.bar * cellW;
        const bw = block.length * cellW - 2;
        const bh = trackH - 4;
        const by = y + 2;

        // Block glow
        ctx.shadowColor = track.color;
        ctx.shadowBlur = 8;

        // Block fill
        const grad = ctx.createLinearGradient(x, by, x, by + bh);
        grad.addColorStop(0, this._lightenColor(track.color, 20));
        grad.addColorStop(1, track.color);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, by, bw, bh, 3);
        ctx.fill();

        ctx.shadowBlur = 0;

        // Highlight top edge
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, by, bw, 2);

        // Pattern mini waveform visualization
        this._drawMiniWave(ctx, track, x, by, bw, bh);

        // Block label
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(track.name, x + 4, by + 12);

        // Block border
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.roundRect(x, by, bw, bh, 3);
        ctx.stroke();
      });
    });

    // Bar grid lines
    for (let b = 0; b <= bars; b++) {
      const x = b * cellW;
      ctx.strokeStyle = b % 4 === 0 ? '#333' : '#222';
      ctx.lineWidth = b % 4 === 0 ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Bar numbers
      if (b < bars && b % 4 === 0) {
        ctx.fillStyle = '#4a4a4a';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${b + 1}`, x + 2, 10);
      }
    }

    // Loop region
    if (this.isLooping) {
      const lx = this.loopStart * cellW;
      const lw = (this.loopEnd - this.loopStart) * cellW;
      ctx.fillStyle = 'rgba(255,106,0,0.07)';
      ctx.fillRect(lx, 0, lw, h);
      ctx.strokeStyle = 'rgba(255,106,0,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(lx, 0, lw, h);
    }

    // Playhead
    const px = this.playPosition * cellW;
    ctx.strokeStyle = '#ff6a00';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(255,106,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Playhead triangle
    ctx.fillStyle = '#ff6a00';
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 8);
    ctx.closePath();
    ctx.fill();
  }

  _drawMiniWave(ctx, track, x, y, w, h) {
    // Draw simple step pattern as mini bars
    const seqCh = this.sequencer.channels.find(c => c.name === track.name);
    if (!seqCh) return;
    const steps = seqCh.steps;
    const stepW = w / steps.length;
    const maxH = h * 0.5;

    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    steps.forEach((on, i) => {
      if (on) {
        const sx = x + i * stepW;
        const vel = seqCh.velocity[i] || 0.8;
        const sh = maxH * vel;
        ctx.fillRect(sx, y + h - sh - 2, stepW - 1, sh);
      }
    });
  }

  _lightenColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, (num >> 16) + amount);
    const g = Math.min(255, ((num >> 8) & 0xff) + amount);
    const b = Math.min(255, (num & 0xff) + amount);
    return `rgb(${r},${g},${b})`;
  }

  // ── Events ────────────────────────────────────────────────────
  _attachEvents() {
    this.canvas.addEventListener('mousedown', e => {
      e.preventDefault();
      this.isDragging = true;
      this._handleCanvasClick(e);
    });
    this.canvas.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      this._handleCanvasClick(e);
    });
    this.canvas.addEventListener('mouseup', () => { this.isDragging = false; });
    this.canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._removeBlockAt(e);
    });
  }

  _getGridPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bar = Math.floor(x / this.cellW);
    const track = Math.floor(y / this.trackH);
    return { bar, track };
  }

  _handleCanvasClick(e) {
    const { bar, track } = this._getGridPos(e);
    if (track < 0 || track >= this.tracks.length) return;
    if (bar < 0 || bar >= this.bars) return;

    if (this.tool === 'draw') {
      const t = this.tracks[track];
      const existing = t.blocks.find(b => bar >= b.bar && bar < b.bar + b.length);
      if (!existing) {
        t.blocks.push({ bar, length: 2 });
        this.render();
      }
    } else if (this.tool === 'erase') {
      this._removeBlockAt(e);
    }
  }

  _removeBlockAt(e) {
    const { bar, track } = this._getGridPos(e);
    if (track < 0 || track >= this.tracks.length) return;
    const t = this.tracks[track];
    t.blocks = t.blocks.filter(b => !(bar >= b.bar && bar < b.bar + b.length));
    this.render();
  }

  setTool(tool) { this.tool = tool; }

  updatePlayhead(bar) {
    this.playPosition = bar;
    this.render();
  }

  toggleLoop() {
    this.isLooping = !this.isLooping;
    this.render();
  }
}

window.Playlist = Playlist;
