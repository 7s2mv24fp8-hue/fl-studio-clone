/**
 * BeYou Studio — Preset Sample Library
 * =====================================
 * A built-in browser of pre-synthesized audio samples organized by category.
 * All samples are generated procedurally via Web Audio API — zero file hosting.
 *
 * Categories:
 *   Kicks     — 808, Acoustic, Punchy, Sub, Distorted
 *   Snares    — Crisp, Fat, Electronic, Clap, Rimshot
 *   Hi-Hats   — Closed, Open, Pedal, Shaker
 *   Bass      — 808 Bass, Sub, Reese, Pluck Bass
 *   Leads     — Saw, Square, Pluck, Bell, Pad
 *   Percussion — Tom Lo/Mid/Hi, Conga, Cowbell, Crash, Ride
 *   FX        — Riser, Downlifter, Noise Hit, Vinyl Scratch
 */

class PresetSampleLibrary {
  constructor(audioEngine, sequencer, onChannelAdded) {
    this.ctx          = audioEngine.ctx;
    this.masterComp   = audioEngine.masterCompressor || this.ctx.destination;
    this.sequencer    = sequencer;
    this.onChannelAdded = onChannelAdded;

    this._modal       = null;
    this._bufferCache = {};   // name → AudioBuffer
    this._previewSrc  = null;

    this._categories  = this._buildCatalog();
    this._buildModal();
    this._injectStyles();
  }

  /* ── Public ─────────────────────────────────────────────────── */
  open() {
    this._modal.classList.remove('psl-hidden');
    this._renderList(null); // show all on open
  }
  close() {
    this._modal.classList.add('psl-hidden');
    this._stopPreview();
  }

  /* ── Catalog ────────────────────────────────────────────────── */
  _buildCatalog() {
    return {
      'Kicks': [
        { name: '808 Kick',       color: '#ff6a00', fn: (ctx) => this._synth808Kick(ctx) },
        { name: 'Acoustic Kick',  color: '#fb923c', fn: (ctx) => this._synthAcousticKick(ctx) },
        { name: 'Punchy Kick',    color: '#f97316', fn: (ctx) => this._synthPunchyKick(ctx) },
        { name: 'Sub Kick',       color: '#ea580c', fn: (ctx) => this._synthSubKick(ctx) },
        { name: 'Clicky Kick',    color: '#c2410c', fn: (ctx) => this._synthClickKick(ctx) },
        { name: 'Distorted Kick', color: '#9a3412', fn: (ctx) => this._synthDistortedKick(ctx) },
      ],
      'Snares': [
        { name: 'Crisp Snare',    color: '#a855f7', fn: (ctx) => this._synthCrispSnare(ctx) },
        { name: 'Fat Snare',      color: '#9333ea', fn: (ctx) => this._synthFatSnare(ctx) },
        { name: 'Electronic Snare', color: '#7c3aed', fn: (ctx) => this._synthElecSnare(ctx) },
        { name: 'Clap',           color: '#6d28d9', fn: (ctx) => this._synthClap(ctx) },
        { name: 'Rimshot',        color: '#5b21b6', fn: (ctx) => this._synthRimshot(ctx) },
        { name: 'Snare Roll Hit', color: '#4c1d95', fn: (ctx) => this._synthSnareRoll(ctx) },
      ],
      'Hi-Hats': [
        { name: 'Closed HH',      color: '#22d3ee', fn: (ctx) => this._synthClosedHH(ctx) },
        { name: 'Open HH',        color: '#06b6d4', fn: (ctx) => this._synthOpenHH(ctx) },
        { name: 'Pedal HH',       color: '#0891b2', fn: (ctx) => this._synthPedalHH(ctx) },
        { name: 'Shaker',         color: '#0e7490', fn: (ctx) => this._synthShaker(ctx) },
        { name: 'Tambourine',     color: '#155e75', fn: (ctx) => this._synthTambourine(ctx) },
      ],
      'Bass': [
        { name: '808 Bass',       color: '#ec4899', fn: (ctx) => this._synth808Bass(ctx) },
        { name: 'Sub Bass',       color: '#db2777', fn: (ctx) => this._synthSubBass(ctx) },
        { name: 'Reese Bass',     color: '#be185d', fn: (ctx) => this._synthReeseBass(ctx) },
        { name: 'Pluck Bass',     color: '#9d174d', fn: (ctx) => this._synthPluckBass(ctx) },
        { name: 'Sine Bass',      color: '#831843', fn: (ctx) => this._synthSineBass(ctx) },
      ],
      'Leads': [
        { name: 'Saw Lead',       color: '#84cc16', fn: (ctx) => this._synthSawLead(ctx) },
        { name: 'Square Lead',    color: '#65a30d', fn: (ctx) => this._synthSquareLead(ctx) },
        { name: 'Pluck Synth',    color: '#4d7c0f', fn: (ctx) => this._synthPluck(ctx) },
        { name: 'Bell',           color: '#3f6212', fn: (ctx) => this._synthBell(ctx) },
        { name: 'Soft Pad',       color: '#365314', fn: (ctx) => this._synthPad(ctx) },
        { name: 'Super Saw',      color: '#a3e635', fn: (ctx) => this._synthSuperSaw(ctx) },
      ],
      'Percussion': [
        { name: 'Tom Lo',         color: '#f59e0b', fn: (ctx) => this._synthTom(ctx, 80) },
        { name: 'Tom Mid',        color: '#d97706', fn: (ctx) => this._synthTom(ctx, 110) },
        { name: 'Tom Hi',         color: '#b45309', fn: (ctx) => this._synthTom(ctx, 150) },
        { name: 'Conga',          color: '#92400e', fn: (ctx) => this._synthConga(ctx) },
        { name: 'Cowbell',        color: '#78350f', fn: (ctx) => this._synthCowbell(ctx) },
        { name: 'Crash',          color: '#fbbf24', fn: (ctx) => this._synthCrash(ctx) },
        { name: 'Ride',           color: '#fcd34d', fn: (ctx) => this._synthRide(ctx) },
      ],
      'FX': [
        { name: 'Riser',          color: '#6366f1', fn: (ctx) => this._synthRiser(ctx) },
        { name: 'Downlifter',     color: '#4f46e5', fn: (ctx) => this._synthDownlifter(ctx) },
        { name: 'Noise Hit',      color: '#4338ca', fn: (ctx) => this._synthNoiseHit(ctx) },
        { name: 'Vinyl Crackle',  color: '#3730a3', fn: (ctx) => this._synthVinyl(ctx) },
        { name: 'Zap',            color: '#312e81', fn: (ctx) => this._synthZap(ctx) },
        { name: 'Laser',          color: '#1e1b4b', fn: (ctx) => this._synthLaser(ctx) },
      ],
    };
  }

  /* ── Modal ──────────────────────────────────────────────────── */
  _buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'psl-overlay';
    overlay.className = 'psl-overlay psl-hidden';

    const cats = Object.keys(this._categories);
    const catBtns = cats.map(c =>
      `<button class="psl-cat-btn" data-cat="${c}">${c}</button>`
    ).join('');

    overlay.innerHTML = `
      <div class="psl-modal">
        <div class="psl-header">
          <div class="psl-title">
            <span class="psl-icon">🎧</span>
            <div>
              <div class="psl-title-text">Sample Library</div>
              <div class="psl-subtitle">Pre-recorded sounds · Click to preview · Double-click to add</div>
            </div>
          </div>
          <button class="psl-close-btn" id="psl-close">✕</button>
        </div>

        <div class="psl-body">
          <!-- Sidebar: categories -->
          <div class="psl-sidebar">
            <div class="psl-search-wrap">
              <input class="psl-search" id="psl-search" placeholder="🔍 Search samples…" autocomplete="off">
            </div>
            <div class="psl-cat-list">
              <button class="psl-cat-btn active" data-cat="all">All</button>
              ${catBtns}
            </div>
          </div>

          <!-- Main: sample grid -->
          <div class="psl-content">
            <div class="psl-grid" id="psl-grid"></div>

            <!-- Preview bar -->
            <div class="psl-preview-bar" id="psl-preview-bar">
              <div class="psl-preview-info">
                <span class="psl-preview-dot" id="psl-preview-dot"></span>
                <span class="psl-preview-name" id="psl-preview-name">No sample selected</span>
              </div>
              <div class="psl-preview-controls">
                <button class="psl-prev-btn" id="psl-play-btn" title="Preview">▶ Preview</button>
                <button class="psl-prev-btn" id="psl-stop-btn" title="Stop">■</button>
                <button class="psl-add-btn" id="psl-add-btn" disabled>＋ Add to Rack</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._modal = overlay;
    this._bindEvents(overlay);
  }

  _bindEvents(overlay) {
    // Close
    overlay.querySelector('#psl-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });

    // Category filter
    overlay.querySelector('.psl-cat-list').addEventListener('click', e => {
      const btn = e.target.closest('.psl-cat-btn');
      if (!btn) return;
      overlay.querySelectorAll('.psl-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat === 'all' ? null : btn.dataset.cat;
      this._renderList(cat, overlay.querySelector('#psl-search').value);
    });

    // Search
    overlay.querySelector('#psl-search').addEventListener('input', e => {
      const active = overlay.querySelector('.psl-cat-btn.active');
      const cat = active?.dataset.cat === 'all' ? null : active?.dataset.cat;
      this._renderList(cat, e.target.value);
    });

    // Preview controls
    overlay.querySelector('#psl-play-btn').addEventListener('click', () => {
      if (this._selectedSample) this._preview(this._selectedSample);
    });
    overlay.querySelector('#psl-stop-btn').addEventListener('click', () => this._stopPreview());
    overlay.querySelector('#psl-add-btn').addEventListener('click', () => {
      if (this._selectedSample) this._addToRack(this._selectedSample);
    });
  }

  /* ── Sample grid ────────────────────────────────────────────── */
  _renderList(filterCat, filterText = '') {
    const grid = this._modal.querySelector('#psl-grid');
    grid.innerHTML = '';
    const q = filterText.toLowerCase();

    Object.entries(this._categories).forEach(([cat, samples]) => {
      if (filterCat && cat !== filterCat) return;

      const filtered = samples.filter(s => !q || s.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q));
      if (!filtered.length) return;

      // Category header
      const header = document.createElement('div');
      header.className = 'psl-cat-header';
      header.textContent = cat;
      grid.appendChild(header);

      // Sample cards
      const row = document.createElement('div');
      row.className = 'psl-row';
      filtered.forEach(sample => {
        const card = document.createElement('div');
        card.className = 'psl-card';
        card.dataset.name = sample.name;
        card.innerHTML = `
          <div class="psl-card-icon" style="background:${sample.color}22;border-color:${sample.color}44;">
            <span class="psl-card-dot" style="background:${sample.color}"></span>
          </div>
          <div class="psl-card-name">${sample.name}</div>
          <div class="psl-card-cat">${cat}</div>`;

        // Single click → select + preview
        card.addEventListener('click', () => {
          this._modal.querySelectorAll('.psl-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          this._selectedSample = { ...sample, cat };
          this._updatePreviewBar(sample);
          this._preview(sample);
        });

        // Double-click → add to rack
        card.addEventListener('dblclick', () => {
          this._addToRack({ ...sample, cat });
        });

        row.appendChild(card);
      });
      grid.appendChild(row);
    });

    if (!grid.children.length) {
      grid.innerHTML = `<div class="psl-empty">No samples match "${filterText}"</div>`;
    }
  }

  _updatePreviewBar(sample) {
    this._modal.querySelector('#psl-preview-name').textContent = sample.name;
    this._modal.querySelector('#psl-preview-dot').style.background = sample.color;
    this._modal.querySelector('#psl-add-btn').disabled = false;
  }

  /* ── Preview ────────────────────────────────────────────────── */
  async _preview(sample) {
    this._stopPreview();
    const buf = await this._getBuffer(sample);
    if (!buf) return;

    await this.ctx.resume();
    const src  = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.value = 0.9;
    src.connect(gain);
    gain.connect(this.masterComp);
    src.start();
    this._previewSrc = src;

    // Waveform mini canvas
    this._drawWaveform(buf);
  }

  _stopPreview() {
    if (this._previewSrc) {
      try { this._previewSrc.stop(); } catch {}
      this._previewSrc = null;
    }
  }

  _drawWaveform(buf) {
    // Draw tiny waveform in the preview bar
    let canvas = this._modal.querySelector('#psl-wave-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'psl-wave-canvas';
      canvas.width = 200; canvas.height = 28;
      canvas.style.cssText = 'border-radius:3px;';
      this._modal.querySelector('.psl-preview-info').appendChild(canvas);
    }
    const ctx = canvas.getContext('2d');
    const data = buf.getChannelData(0);
    const step = Math.ceil(data.length / 200);
    ctx.clearRect(0, 0, 200, 28);
    const grad = ctx.createLinearGradient(0, 0, 200, 0);
    grad.addColorStop(0, this._selectedSample?.color || '#ff6a00');
    grad.addColorStop(1, '#a855f7');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < 200; x++) {
      let max = 0;
      for (let j = 0; j < step; j++) {
        const v = Math.abs(data[x * step + j] || 0);
        if (v > max) max = v;
      }
      const h = max * 12;
      ctx.moveTo(x, 14 - h);
      ctx.lineTo(x, 14 + h);
    }
    ctx.stroke();
  }

  /* ── Buffer cache ───────────────────────────────────────────── */
  async _getBuffer(sample) {
    if (this._bufferCache[sample.name]) return this._bufferCache[sample.name];
    try {
      await this.ctx.resume();
      const buf = sample.fn(this.ctx);
      this._bufferCache[sample.name] = buf;
      return buf;
    } catch (e) {
      console.error('[PSL] Synth error:', e);
      return null;
    }
  }

  /* ── Add to rack ────────────────────────────────────────────── */
  async _addToRack(sample) {
    const buf = await this._getBuffer(sample);
    if (!buf) { if (window.showToast) showToast('Could not synthesize sample'); return; }

    const COLORS = ['#ff6a00','#a855f7','#00d4aa','#ec4899','#22d3ee','#84cc16','#f59e0b','#ef4444'];
    const newCh = {
      name: sample.name,
      color: sample.color || COLORS[this.sequencer.channels.length % COLORS.length],
      steps:    Array(this.sequencer.steps).fill(false),
      velocity: Array(this.sequencer.steps).fill(0.8),
      volume: 1, pan: 0, muted: false, solo: false,
      type: 'audio', notes: [],
      filterFreq: 2000, filterRes: 1,
      audioBuffer: buf,
      sampleFileName: sample.name,
    };
    // Activate step 0 so it plays immediately
    newCh.steps[0] = true;

    this.sequencer.channels.push(newCh);
    if (this.onChannelAdded) this.onChannelAdded();
    if (window.showToast) showToast(`🎵 "${sample.name}" added to rack!`);
  }

  /* ════════════════════════════════════════════════════════════════
     SYNTHESIS FUNCTIONS — each returns an AudioBuffer
  ════════════════════════════════════════════════════════════════ */

  _makeBuffer(ctx, duration, fn) {
    const sr  = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const ch  = buf.getChannelData(0);
    fn(ch, sr, len);
    return buf;
  }

  // ── KICKS ────────────────────────────────────────────────────
  _synth808Kick(ctx) {
    return this._makeBuffer(ctx, 1.0, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 8);
        const freq = 60 * Math.exp(-t * 20) + 40;
        ch[i] = Math.sin(2 * Math.PI * freq * t) * env;
      }
    });
  }

  _synthAcousticKick(ctx) {
    return this._makeBuffer(ctx, 0.5, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 18);
        const freq = 80 * Math.exp(-t * 30) + 50;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 80) * 0.3;
        ch[i] = (Math.sin(2 * Math.PI * freq * t) + noise) * env;
      }
    });
  }

  _synthPunchyKick(ctx) {
    return this._makeBuffer(ctx, 0.4, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 25);
        const freq = 200 * Math.exp(-t * 40) + 50;
        ch[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.9;
      }
    });
  }

  _synthSubKick(ctx) {
    return this._makeBuffer(ctx, 1.2, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 5);
        ch[i] = Math.sin(2 * Math.PI * 50 * t) * env;
      }
    });
  }

  _synthClickKick(ctx) {
    return this._makeBuffer(ctx, 0.4, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const click = i < sr * 0.005 ? (Math.random() * 2 - 1) * 0.8 : 0;
        const body  = Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 20);
        ch[i] = click + body;
      }
    });
  }

  _synthDistortedKick(ctx) {
    return this._makeBuffer(ctx, 0.6, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 12);
        const freq = 80 * Math.exp(-t * 20) + 45;
        let s = Math.sin(2 * Math.PI * freq * t) * env;
        s = Math.tanh(s * 5) * 0.8; // saturation
        ch[i] = s;
      }
    });
  }

  // ── SNARES ──────────────────────────────────────────────────
  _synthCrispSnare(ctx) {
    return this._makeBuffer(ctx, 0.3, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 20);
        const tone  = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-t * 40) * 0.3;
        ch[i] = (noise + tone) * 0.85;
      }
    });
  }

  _synthFatSnare(ctx) {
    return this._makeBuffer(ctx, 0.4, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 12);
        const tone  = Math.sin(2 * Math.PI * 150 * t) * Math.exp(-t * 20) * 0.5;
        ch[i] = (noise * 0.6 + tone) * 0.9;
      }
    });
  }

  _synthElecSnare(ctx) {
    return this._makeBuffer(ctx, 0.25, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 30);
        const tone  = Math.sin(2 * Math.PI * 300 * t) * Math.exp(-t * 60) * 0.4;
        ch[i] = (noise * 0.8 + tone) * 0.9;
      }
    });
  }

  _synthClap(ctx) {
    return this._makeBuffer(ctx, 0.2, (ch, sr, len) => {
      // Multiple noise bursts = clap layers
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const layer1 = (Math.random() * 2 - 1) * Math.exp(-t * 60);
        const layer2 = (Math.random() * 2 - 1) * Math.exp(-(t - 0.01) * 60) * (t > 0.01 ? 1 : 0);
        const layer3 = (Math.random() * 2 - 1) * Math.exp(-(t - 0.02) * 40) * (t > 0.02 ? 1 : 0);
        ch[i] = (layer1 + layer2 + layer3) * 0.5;
      }
    });
  }

  _synthRimshot(ctx) {
    return this._makeBuffer(ctx, 0.15, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const tone = Math.sin(2 * Math.PI * 800 * t) * Math.exp(-t * 80);
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 100) * 0.3;
        ch[i] = (tone + noise) * 0.8;
      }
    });
  }

  _synthSnareRoll(ctx) {
    return this._makeBuffer(ctx, 0.5, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t    = i / sr;
        const rate = 20; // rapid hits
        const phase = (t * rate) % 1;
        const hit  = Math.exp(-phase * 15);
        const noise = (Math.random() * 2 - 1) * hit;
        const env  = 1 - t / 0.5;
        ch[i] = noise * env * 0.8;
      }
    });
  }

  // ── HI-HATS ──────────────────────────────────────────────────
  _synthClosedHH(ctx) {
    return this._makeBuffer(ctx, 0.08, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 80);
        // Metallic: mix of harmonics
        const s = (Math.sin(2*Math.PI*8000*t) + Math.sin(2*Math.PI*12000*t) * 0.5) * env;
        ch[i] = s * (0.4 + (Math.random() - 0.5) * 0.1);
      }
    });
  }

  _synthOpenHH(ctx) {
    return this._makeBuffer(ctx, 0.5, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 6);
        const s   = (Math.random() * 2 - 1) * 0.6 +
                    Math.sin(2 * Math.PI * 10000 * t) * 0.3;
        ch[i] = s * env;
      }
    });
  }

  _synthPedalHH(ctx) {
    return this._makeBuffer(ctx, 0.06, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-t * 120) * 0.5;
      }
    });
  }

  _synthShaker(ctx) {
    return this._makeBuffer(ctx, 0.12, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.sin(Math.PI * t / 0.12); // fade in/out
        ch[i] = (Math.random() * 2 - 1) * env * 0.4;
      }
    });
  }

  _synthTambourine(ctx) {
    return this._makeBuffer(ctx, 0.18, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 12);
        const metal = Math.sin(2 * Math.PI * 6000 * t) + Math.sin(2 * Math.PI * 9000 * t) * 0.5;
        ch[i] = ((Math.random() * 2 - 1) * 0.6 + metal * 0.3) * env;
      }
    });
  }

  // ── BASS ────────────────────────────────────────────────────
  _synth808Bass(ctx) {
    return this._makeBuffer(ctx, 1.5, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 2);
        ch[i] = Math.sin(2 * Math.PI * 50 * t) * env * 0.9;
      }
    });
  }

  _synthSubBass(ctx) {
    return this._makeBuffer(ctx, 2.0, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = i < sr * 0.01 ? i / (sr * 0.01) : Math.exp(-(t - 0.01) * 1);
        ch[i] = Math.sin(2 * Math.PI * 40 * t) * env * 0.85;
      }
    });
  }

  _synthReeseBass(ctx) {
    return this._makeBuffer(ctx, 1.0, (ch, sr, len) => {
      let phase1 = 0, phase2 = 0;
      const f = 55;
      for (let i = 0; i < len; i++) {
        const t    = i / sr;
        const env  = 0.7;
        // Two detuned saws
        phase1 = (phase1 + f / sr) % 1;
        phase2 = (phase2 + (f * 1.012) / sr) % 1;
        const saw1 = phase1 * 2 - 1;
        const saw2 = phase2 * 2 - 1;
        ch[i] = (saw1 + saw2) * 0.4 * env;
      }
    });
  }

  _synthPluckBass(ctx) {
    return this._makeBuffer(ctx, 0.6, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 8);
        ch[i] = Math.sin(2 * Math.PI * 65 * t) * env * 0.85;
      }
    });
  }

  _synthSineBass(ctx) {
    return this._makeBuffer(ctx, 1.2, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.max(0, 1 - t * 1.2);
        ch[i] = Math.sin(2 * Math.PI * 60 * t + Math.sin(2 * Math.PI * 2 * t) * 0.3) * env * 0.8;
      }
    });
  }

  // ── LEADS ────────────────────────────────────────────────────
  _synthSawLead(ctx) {
    return this._makeBuffer(ctx, 0.8, (ch, sr, len) => {
      let phase = 0;
      const f = 440;
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = i < sr * 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) * 3);
        phase = (phase + f / sr) % 1;
        ch[i] = (phase * 2 - 1) * env * 0.5;
      }
    });
  }

  _synthSquareLead(ctx) {
    return this._makeBuffer(ctx, 0.8, (ch, sr, len) => {
      let phase = 0;
      const f = 440;
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 2.5);
        phase = (phase + f / sr) % 1;
        ch[i] = (phase < 0.5 ? 1 : -1) * env * 0.45;
      }
    });
  }

  _synthPluck(ctx) {
    return this._makeBuffer(ctx, 0.5, (ch, sr, len) => {
      // Karplus-Strong style
      const bufSize = Math.round(sr / 440);
      const ks = new Float32Array(bufSize).fill(0).map(() => Math.random() * 2 - 1);
      for (let i = 0; i < len; i++) {
        const idx = i % bufSize;
        const next = (idx + 1) % bufSize;
        ks[idx] = (ks[idx] + ks[next]) * 0.498;
        ch[i] = ks[idx] * 0.8;
      }
    });
  }

  _synthBell(ctx) {
    return this._makeBuffer(ctx, 1.5, (ch, sr, len) => {
      const harmonics = [1, 2.756, 5.4, 7.13, 10.66];
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        let s = 0;
        harmonics.forEach((h, j) => {
          s += Math.sin(2 * Math.PI * 440 * h * t) * Math.exp(-t * (2 + j * 2)) / harmonics.length;
        });
        ch[i] = s * 0.7;
      }
    });
  }

  _synthPad(ctx) {
    return this._makeBuffer(ctx, 2.0, (ch, sr, len) => {
      const attack = sr * 0.3;
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = i < attack ? i / attack : Math.exp(-(t - 0.3) * 0.8);
        const s   = (Math.sin(2*Math.PI*220*t) + Math.sin(2*Math.PI*330*t)*0.6 + Math.sin(2*Math.PI*440*t)*0.4) / 2;
        ch[i] = s * env * 0.4;
      }
    });
  }

  _synthSuperSaw(ctx) {
    return this._makeBuffer(ctx, 1.0, (ch, sr, len) => {
      const freqs = [440, 440.8, 441.5, 439.2, 438.5]; // detuned
      const phases = freqs.map(() => 0);
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = i < sr * 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) * 1.5);
        let s = 0;
        phases.forEach((p, j) => {
          phases[j] = (phases[j] + freqs[j] / sr) % 1;
          s += phases[j] * 2 - 1;
        });
        ch[i] = s / freqs.length * env * 0.6;
      }
    });
  }

  // ── PERCUSSION ───────────────────────────────────────────────
  _synthTom(ctx, freq) {
    return this._makeBuffer(ctx, 0.4, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 15);
        const f   = freq * Math.exp(-t * 5);
        ch[i] = Math.sin(2 * Math.PI * f * t) * env * 0.85;
      }
    });
  }

  _synthConga(ctx) {
    return this._makeBuffer(ctx, 0.35, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 20);
        const freq = 250 * Math.exp(-t * 10);
        ch[i] = (Math.sin(2*Math.PI*freq*t) + (Math.random()-0.5)*0.15) * env * 0.8;
      }
    });
  }

  _synthCowbell(ctx) {
    return this._makeBuffer(ctx, 0.8, (ch, sr, len) => {
      const f1 = 540, f2 = 845;
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 5);
        ch[i] = (Math.sin(2*Math.PI*f1*t) + Math.sin(2*Math.PI*f2*t)) * env * 0.35;
      }
    });
  }

  _synthCrash(ctx) {
    return this._makeBuffer(ctx, 1.5, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 3);
        const metal = Math.sin(2*Math.PI*8000*t)*0.3 + Math.sin(2*Math.PI*12000*t)*0.2 + Math.sin(2*Math.PI*16000*t)*0.1;
        ch[i] = ((Math.random()*2-1)*0.5 + metal) * env;
      }
    });
  }

  _synthRide(ctx) {
    return this._makeBuffer(ctx, 1.0, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 4);
        const metal = Math.sin(2*Math.PI*10000*t)*0.4 + Math.sin(2*Math.PI*7500*t)*0.3;
        ch[i] = ((Math.random()*2-1)*0.3 + metal) * env;
      }
    });
  }

  // ── FX ──────────────────────────────────────────────────────
  _synthRiser(ctx) {
    return this._makeBuffer(ctx, 2.0, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t    = i / sr;
        const freq = 100 * Math.pow(2, t * 2); // exponential sweep
        const env  = t / 2;
        ch[i] = (Math.random()*2-1) * 0.5 * env + Math.sin(2*Math.PI*freq*t) * 0.3 * env;
      }
    });
  }

  _synthDownlifter(ctx) {
    return this._makeBuffer(ctx, 2.0, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t    = i / sr;
        const freq = 800 * Math.pow(0.5, t * 2);
        const env  = 1 - t / 2;
        ch[i] = ((Math.random()*2-1)*0.5 + Math.sin(2*Math.PI*freq*t)*0.3) * env;
      }
    });
  }

  _synthNoiseHit(ctx) {
    return this._makeBuffer(ctx, 0.25, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = Math.exp(-t * 20);
        ch[i] = (Math.random()*2-1) * env * 0.85;
      }
    });
  }

  _synthVinyl(ctx) {
    return this._makeBuffer(ctx, 1.5, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t   = i / sr;
        const env = 0.15;
        // Low-level crackle
        ch[i] = Math.random() < 0.002 ? (Math.random()*2-1) * 0.8 : (Math.random()*2-1) * env;
      }
    });
  }

  _synthZap(ctx) {
    return this._makeBuffer(ctx, 0.15, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t    = i / sr;
        const freq = 2000 * Math.exp(-t * 30);
        const env  = Math.exp(-t * 25);
        ch[i] = Math.sin(2*Math.PI*freq*t) * env * 0.9;
      }
    });
  }

  _synthLaser(ctx) {
    return this._makeBuffer(ctx, 0.3, (ch, sr, len) => {
      for (let i = 0; i < len; i++) {
        const t    = i / sr;
        const freq = 3000 * Math.exp(-t * 15);
        const env  = Math.exp(-t * 8);
        ch[i] = Math.sin(2*Math.PI*freq*t) * env * 0.85;
      }
    });
  }

  /* ── Styles ─────────────────────────────────────────────────── */
  _injectStyles() {
    if (document.getElementById('psl-styles')) return;
    const style = document.createElement('style');
    style.id = 'psl-styles';
    style.textContent = `
/* ── Preset Sample Library ──────────────────────────────────────────── */
.psl-overlay {
  position: fixed; inset: 0; z-index: 26000;
  background: rgba(0,0,0,0.88);
  backdrop-filter: blur(14px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: psl-fade .18s ease;
}
@keyframes psl-fade { from { opacity: 0; } to { opacity: 1; } }
.psl-hidden { display: none !important; }

.psl-modal {
  background: #0f1117;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  box-shadow: 0 40px 100px rgba(0,0,0,0.95), 0 0 0 1px rgba(34,211,238,0.1);
  width: 100%; max-width: 760px;
  height: min(85vh, 600px);
  display: flex; flex-direction: column;
  animation: psl-pop .22s cubic-bezier(0.16,1,0.3,1);
  overflow: hidden;
}
@keyframes psl-pop {
  from { transform: scale(0.94) translateY(12px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);    opacity: 1; }
}

/* Header */
.psl-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  background: linear-gradient(90deg, #0a0c11 0%, #0f1117 100%);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.psl-title { display: flex; align-items: center; gap: 12px; }
.psl-icon { font-size: 26px; }
.psl-title-text { font-size: 15px; font-weight: 800; color: #fff; }
.psl-subtitle { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 2px; }
.psl-close-btn {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 18px; cursor: pointer; border-radius: 6px; padding: 4px 9px; transition: all .15s;
}
.psl-close-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }

/* Body */
.psl-body { display: flex; flex: 1; overflow: hidden; }

/* Sidebar */
.psl-sidebar {
  width: 140px; flex-shrink: 0;
  background: #0a0c11;
  border-right: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.psl-search-wrap { padding: 10px 8px; }
.psl-search {
  width: 100%; box-sizing: border-box;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; color: #fff; font-size: 11px; padding: 6px 8px;
  outline: none; font-family: inherit;
}
.psl-search::placeholder { color: rgba(255,255,255,0.25); }
.psl-search:focus { border-color: rgba(34,211,238,0.4); }

.psl-cat-list {
  display: flex; flex-direction: column; gap: 2px;
  padding: 0 6px 10px; overflow-y: auto; scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.08) transparent;
}
.psl-cat-btn {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 11px; font-weight: 600; padding: 7px 10px; border-radius: 6px;
  cursor: pointer; text-align: left; transition: all .15s;
}
.psl-cat-btn:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }
.psl-cat-btn.active { background: rgba(34,211,238,0.1); color: #67e8f9; }

/* Content */
.psl-content {
  flex: 1; display: flex; flex-direction: column; overflow: hidden;
}

.psl-grid {
  flex: 1; overflow-y: auto; padding: 12px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
}

.psl-cat-header {
  font-size: 9px; font-weight: 800; color: rgba(255,255,255,0.25);
  text-transform: uppercase; letter-spacing: 1px;
  padding: 10px 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.05);
  margin-bottom: 8px;
}
.psl-cat-header:first-child { padding-top: 0; }

.psl-row {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
}

.psl-card {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px; padding: 8px 10px; cursor: pointer; transition: all .15s;
  width: calc(33.33% - 4px); min-width: 140px; box-sizing: border-box;
}
.psl-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.15); }
.psl-card.selected {
  background: rgba(34,211,238,0.08);
  border-color: rgba(34,211,238,0.35);
  box-shadow: 0 0 12px rgba(34,211,238,0.1);
}

.psl-card-icon {
  width: 28px; height: 28px; border-radius: 6px; border: 1px solid;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.psl-card-dot { width: 8px; height: 8px; border-radius: 50%; }
.psl-card-name { font-size: 11px; font-weight: 700; color: #fff; line-height: 1.2; }
.psl-card-cat  { font-size: 9px; color: rgba(255,255,255,0.3); }

.psl-empty { padding: 40px; text-align: center; color: rgba(255,255,255,0.25); font-size: 13px; }

/* Preview bar */
.psl-preview-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; gap: 10px;
  background: #0a0c11;
  border-top: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.psl-preview-info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.psl-preview-dot  { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.2); flex-shrink: 0; }
.psl-preview-name { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.psl-preview-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.psl-prev-btn {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.6); font-size: 11px; font-weight: 700;
  padding: 5px 12px; border-radius: 6px; cursor: pointer; transition: all .15s;
}
.psl-prev-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }

.psl-add-btn {
  background: linear-gradient(135deg, #22d3ee, #0891b2);
  border: none; color: #fff; font-size: 12px; font-weight: 800;
  padding: 6px 16px; border-radius: 6px; cursor: pointer; transition: all .18s;
}
.psl-add-btn:hover:not(:disabled) { filter: brightness(1.15); box-shadow: 0 0 14px rgba(34,211,238,0.35); }
.psl-add-btn:disabled { opacity: 0.35; cursor: not-allowed; filter: none; }

/* Toolbar / rack button */
#btn-preset-library {
  border-color: rgba(34,211,238,0.35) !important;
  color: #67e8f9 !important;
}
`;
    document.head.appendChild(style);
  }
}


/* ── Bootstrap ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const waitForApp = () => {
    if (!window.app || !window.app.audioEngine?.ctx) { setTimeout(waitForApp, 200); return; }

    window.presetLibrary = new PresetSampleLibrary(
      window.app.audioEngine,
      window.app.sequencer,
      () => window.app._buildChannelRack()
    );

    // Wire toolbar button
    document.getElementById('btn-preset-library')?.addEventListener('click', () => window.presetLibrary.open());

    // Wire rack footer button
    document.getElementById('preset-library-rack-btn')?.addEventListener('click', () => window.presetLibrary.open());
  };
  waitForApp();
});
