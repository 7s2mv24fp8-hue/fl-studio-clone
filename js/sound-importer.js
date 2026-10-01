/**
 * BeYou Studio — Import Sound Module
 * Drag-and-drop / file-picker sample importer.
 * Supports WAV, MP3, OGG, FLAC, AIFF.
 * Flow:
 *   1. User picks a file (drag-drop or file input)
 *   2. File is decoded via Web Audio API locally (instant, no server needed)
 *   3. Optionally uploaded to /api/audio/upload for persistence
 *   4. A new 'audio' channel is added to the sequencer with the AudioBuffer
 */

/* eslint-disable no-unused-vars */

class SoundImporter {
  constructor(audioEngine, sequencer, onChannelAdded) {
    this.audioEngine   = audioEngine;
    this.sequencer     = sequencer;
    this.onChannelAdded = onChannelAdded;   // callback → app._refreshChannelRack()

    this._modal     = null;
    this._fileInput = null;

    this._buildModal();
    this._injectStyles();
  }

  /* ── Public ──────────────────────────────────────────────────── */

  open() {
    this._resumeAudio();
    this._modal.classList.remove('si-hidden');
    this._modal.querySelector('.si-drop-zone').classList.remove('si-drag-over');
    this._setStatus('');
  }

  close() {
    this._modal.classList.add('si-hidden');
  }

  /* ── Modal builder ───────────────────────────────────────────── */

  _buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'si-overlay';
    overlay.className = 'si-overlay si-hidden';
    overlay.innerHTML = `
      <div class="si-modal">
        <div class="si-header">
          <div class="si-title">
            <span class="si-icon">🎵</span>
            <span>Import Sound</span>
            <span class="si-sub">Add a sample to the channel rack</span>
          </div>
          <button class="si-close" id="si-close-btn">✕</button>
        </div>

        <div class="si-body">
          <!-- Drop zone -->
          <div class="si-drop-zone" id="si-drop-zone" tabindex="0" role="button"
               aria-label="Drop audio file here or click to browse">
            <div class="si-drop-icon">🎚️</div>
            <div class="si-drop-label">Drop your audio file here</div>
            <div class="si-drop-sub">WAV · MP3 · OGG · FLAC · AIFF — up to 50 MB</div>
            <button class="si-browse-btn" id="si-browse-btn">Browse Files</button>
          </div>

          <!-- Format pills -->
          <div class="si-formats">
            <span class="si-fmt active" data-fmt="wav">WAV</span>
            <span class="si-fmt active" data-fmt="mp3">MP3</span>
            <span class="si-fmt active" data-fmt="ogg">OGG</span>
            <span class="si-fmt active" data-fmt="flac">FLAC</span>
            <span class="si-fmt active" data-fmt="aiff">AIFF</span>
          </div>

          <!-- Status / progress -->
          <div class="si-status-wrap">
            <div class="si-status" id="si-status"></div>
            <div class="si-progress-track si-hidden" id="si-progress-track">
              <div class="si-progress-fill" id="si-progress-fill"></div>
            </div>
          </div>

          <!-- Loaded sound preview -->
          <div class="si-preview si-hidden" id="si-preview">
            <div class="si-preview-waveform" id="si-preview-waveform"></div>
            <div class="si-preview-meta">
              <div class="si-preview-name" id="si-preview-name"></div>
              <div class="si-preview-info" id="si-preview-info"></div>
            </div>
            <div class="si-preview-actions">
              <button class="si-preview-play" id="si-preview-play" title="Audition">▶ Preview</button>
              <button class="si-preview-stop" id="si-preview-stop" title="Stop">■</button>
            </div>
          </div>

          <!-- Channel name input (shown after load) -->
          <div class="si-name-row si-hidden" id="si-name-row">
            <label class="si-label">Channel name</label>
            <input class="si-input" id="si-channel-name" placeholder="e.g. 808, Vocal Chop, Clap..." maxlength="32">
            <div class="si-color-row">
              <label class="si-label">Color</label>
              <div class="si-color-swatches" id="si-color-swatches"></div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="si-actions si-hidden" id="si-actions">
            <button class="si-btn-secondary" id="si-cancel-btn">Cancel</button>
            <button class="si-btn-primary" id="si-add-btn">
              <span>＋</span> Add to Channel Rack
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._modal = overlay;

    // Hidden file input
    const fi = document.createElement('input');
    fi.type   = 'file';
    fi.accept = 'audio/*,.wav,.mp3,.ogg,.flac,.aiff,.aif,.m4a';
    fi.style.display = 'none';
    fi.id = 'si-file-input';
    document.body.appendChild(fi);
    this._fileInput = fi;

    // Color swatches
    const COLORS = ['#ff6a00','#a855f7','#00d4aa','#ec4899','#22d3ee','#84cc16','#f59e0b','#ef4444','#6366f1','#f97316'];
    this._selectedColor = COLORS[0];
    const swatchWrap = overlay.querySelector('#si-color-swatches');
    COLORS.forEach((c, i) => {
      const s = document.createElement('button');
      s.className = `si-swatch${i === 0 ? ' selected' : ''}`;
      s.style.background = c;
      s.dataset.color = c;
      s.addEventListener('click', () => {
        swatchWrap.querySelectorAll('.si-swatch').forEach(x => x.classList.remove('selected'));
        s.classList.add('selected');
        this._selectedColor = c;
      });
      swatchWrap.appendChild(s);
    });

    this._bindEvents();
  }

  /* ── Events ──────────────────────────────────────────────────── */

  _bindEvents() {
    const dz = this._modal.querySelector('#si-drop-zone');

    // Close
    this._modal.querySelector('#si-close-btn').addEventListener('click', () => this.close());
    this._modal.querySelector('#si-cancel-btn').addEventListener('click', () => this.close());
    this._modal.addEventListener('click', e => { if (e.target === this._modal) this.close(); });

    // Browse
    this._modal.querySelector('#si-browse-btn').addEventListener('click', () => this._fileInput.click());
    dz.addEventListener('click', e => { if (e.target === dz || e.target.classList.contains('si-drop-icon') || e.target.classList.contains('si-drop-label') || e.target.classList.contains('si-drop-sub')) this._fileInput.click(); });
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') this._fileInput.click(); });

    // File input change
    this._fileInput.addEventListener('change', e => {
      if (e.target.files[0]) this._handleFile(e.target.files[0]);
      e.target.value = '';
    });

    // Drag & Drop
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('si-drag-over'); });
    dz.addEventListener('dragleave', e => { if (!dz.contains(e.relatedTarget)) dz.classList.remove('si-drag-over'); });
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('si-drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this._handleFile(file);
    });

    // Preview buttons
    this._modal.querySelector('#si-preview-play').addEventListener('click', () => this._previewPlay());
    this._modal.querySelector('#si-preview-stop').addEventListener('click', () => this._previewStop());

    // Add to rack
    this._modal.querySelector('#si-add-btn').addEventListener('click', () => this._addToRack());
  }

  /* ── File handling ───────────────────────────────────────────── */

  async _handleFile(file) {
    const MAX = 50 * 1024 * 1024; // 50 MB
    const ALLOWED = ['audio/wav','audio/wave','audio/x-wav','audio/mpeg','audio/mp3','audio/ogg','audio/flac','audio/x-flac','audio/aiff','audio/x-aiff','audio/m4a','audio/mp4','audio/x-m4a'];

    if (file.size > MAX) { this._setStatus('❌ File too large (max 50 MB)', 'error'); return; }

    const isAudio = file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aif|aiff|m4a)$/i.test(file.name);
    if (!isAudio) { this._setStatus('❌ Not an audio file', 'error'); return; }

    this._setStatus('⏳ Decoding audio...', 'loading');
    this._showProgress(0);

    try {
      await this._resumeAudio();
      const arrayBuffer = await this._readFileAsArrayBuffer(file, pct => this._showProgress(pct * 0.6));
      this._showProgress(70);

      const audioBuffer = await this.audioEngine.ctx.decodeAudioData(arrayBuffer.slice(0));
      this._showProgress(100);

      this._loadedBuffer = audioBuffer;
      this._loadedFileName = file.name;

      // Auto-name the channel from the file name
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
      this._modal.querySelector('#si-channel-name').value = baseName.slice(0, 32);

      this._setStatus(`✅ Decoded — ${(file.size / 1024).toFixed(0)} KB · ${audioBuffer.duration.toFixed(2)}s · ${audioBuffer.numberOfChannels}ch · ${(audioBuffer.sampleRate / 1000).toFixed(1)} kHz`, 'success');
      this._renderPreview(file.name, audioBuffer);
      this._showNameRow();
      this._showActions();

      // Background upload for cloud persistence (non-blocking)
      this._uploadInBackground(file);

    } catch (err) {
      console.error('[SoundImporter] Decode error:', err);
      this._setStatus(`❌ Could not decode: ${err.message || 'Unsupported format'}`, 'error');
      this._hideProgress();
    }
  }

  _readFileAsArrayBuffer(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  async _uploadInBackground(file) {
    const token = localStorage.getItem('bs_token');
    if (!token) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/audio/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.ok) {
        const d = await res.json();
        this._uploadedFileId = d.file_id;
        console.log('[SoundImporter] Uploaded to cloud:', d.file_id);
      }
    } catch (e) {
      console.warn('[SoundImporter] Cloud upload skipped:', e.message);
    }
  }

  /* ── Preview ─────────────────────────────────────────────────── */

  _renderPreview(name, buf) {
    const panel = this._modal.querySelector('#si-preview');
    panel.classList.remove('si-hidden');

    this._modal.querySelector('#si-preview-name').textContent = name;
    this._modal.querySelector('#si-preview-info').textContent =
      `${buf.duration.toFixed(2)}s · ${buf.numberOfChannels === 1 ? 'Mono' : 'Stereo'} · ${(buf.sampleRate / 1000).toFixed(1)} kHz`;

    this._drawMiniWaveform(buf);
  }

  _drawMiniWaveform(buf) {
    const canvas = document.createElement('canvas');
    canvas.width  = 320; canvas.height = 50;
    canvas.style.cssText = 'width:100%;height:50px;border-radius:4px;';
    const ctx = canvas.getContext('2d');

    const data   = buf.getChannelData(0);
    const step   = Math.ceil(data.length / 320);
    const grad   = ctx.createLinearGradient(0, 0, 320, 0);
    grad.addColorStop(0,   '#ff6a00');
    grad.addColorStop(0.5, '#a855f7');
    grad.addColorStop(1,   '#00d4aa');

    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, 0, 320, 50);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = 1.2;
    ctx.beginPath();

    for (let x = 0; x < 320; x++) {
      let max = 0;
      for (let j = 0; j < step; j++) {
        const v = Math.abs(data[x * step + j] || 0);
        if (v > max) max = v;
      }
      const h = max * 22;
      const y = 25;
      ctx.moveTo(x, y - h);
      ctx.lineTo(x, y + h);
    }
    ctx.stroke();

    const container = this._modal.querySelector('#si-preview-waveform');
    container.innerHTML = '';
    container.appendChild(canvas);
  }

  _previewPlay() {
    this._previewStop();
    if (!this._loadedBuffer) return;
    try {
      const src = this.audioEngine.ctx.createBufferSource();
      src.buffer = this._loadedBuffer;
      src.connect(this.audioEngine.masterCompressor || this.audioEngine.ctx.destination);
      src.start();
      this._previewSrc = src;
    } catch (e) { console.warn(e); }
  }

  _previewStop() {
    if (this._previewSrc) {
      try { this._previewSrc.stop(); } catch {}
      this._previewSrc = null;
    }
  }

  /* ── Add to channel rack ─────────────────────────────────────── */

  _addToRack() {
    if (!this._loadedBuffer) return;

    const name  = (this._modal.querySelector('#si-channel-name').value.trim() || 'Sample').slice(0, 32);
    const color = this._selectedColor;

    // Add channel to sequencer
    const newChannel = {
      name,
      color,
      steps:    new Array(this.sequencer.steps).fill(false),
      velocity: new Array(this.sequencer.steps).fill(0.8),
      volume:   1,
      pan:      0,
      muted:    false,
      solo:     false,
      type:     'audio',
      notes:    [],
      filterFreq: 2000,
      filterRes:  1,
      audioBuffer: this._loadedBuffer,
      sampleFileName: this._loadedFileName || name,
      uploadedFileId:  this._uploadedFileId || null,
    };

    this.sequencer.channels.push(newChannel);
    if (this.onChannelAdded) this.onChannelAdded();

    const idx = this.sequencer.channels.length - 1;
    // Auto-activate step 0 so user hears it immediately
    this.sequencer.channels[idx].steps[0] = true;
    if (this.onChannelAdded) this.onChannelAdded();

    this.close();
    this._resetState();

    if (window.showToast) showToast(`🎵 "${name}" added to channel rack!`);
  }

  /* ── UI helpers ──────────────────────────────────────────────── */

  _setStatus(msg, type = '') {
    const el = this._modal.querySelector('#si-status');
    el.textContent = msg;
    el.className = `si-status${type ? ` si-status-${type}` : ''}`;
  }

  _showProgress(pct) {
    const track = this._modal.querySelector('#si-progress-track');
    const fill  = this._modal.querySelector('#si-progress-fill');
    track.classList.remove('si-hidden');
    fill.style.width = `${Math.min(100, pct)}%`;
    if (pct >= 100) setTimeout(() => track.classList.add('si-hidden'), 600);
  }

  _hideProgress() {
    this._modal.querySelector('#si-progress-track').classList.add('si-hidden');
  }

  _showNameRow()  { this._modal.querySelector('#si-name-row').classList.remove('si-hidden'); }
  _showActions()  { this._modal.querySelector('#si-actions').classList.remove('si-hidden'); }

  _resetState() {
    this._loadedBuffer   = null;
    this._loadedFileName = null;
    this._uploadedFileId = null;
    this._previewStop();
    this._setStatus('');
    this._hideProgress();
    this._modal.querySelector('#si-preview').classList.add('si-hidden');
    this._modal.querySelector('#si-name-row').classList.add('si-hidden');
    this._modal.querySelector('#si-actions').classList.add('si-hidden');
    this._modal.querySelector('#si-channel-name').value = '';
    this._modal.querySelector('#si-preview-waveform').innerHTML = '';
  }

  async _resumeAudio() {
    if (this.audioEngine.ctx && this.audioEngine.ctx.state === 'suspended') {
      await this.audioEngine.ctx.resume();
    }
  }

  /* ── Styles ──────────────────────────────────────────────────── */

  _injectStyles() {
    if (document.getElementById('si-styles')) return;
    const style = document.createElement('style');
    style.id = 'si-styles';
    style.textContent = `
/* ── Import Sound overlay ────────────────────────────────────────────── */
.si-overlay {
  position: fixed; inset: 0; z-index: 25000;
  background: rgba(0,0,0,0.88);
  backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  animation: si-fade-in 0.18s ease;
}
@keyframes si-fade-in { from { opacity: 0; } to { opacity: 1; } }
.si-overlay.si-hidden { display: none !important; }

.si-modal {
  background: #0f1117;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  box-shadow: 0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,106,0,0.15);
  width: 100%; max-width: 520px;
  max-height: 90vh; overflow-y: auto;
  animation: si-pop 0.22s cubic-bezier(0.16,1,0.3,1);
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
}
@keyframes si-pop {
  from { transform: scale(0.93) translateY(16px); opacity: 0; }
  to   { transform: scale(1)    translateY(0);    opacity: 1; }
}

/* Header */
.si-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px;
  background: #0a0c11;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px 16px 0 0;
}
.si-title {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 700; color: #fff;
}
.si-icon { font-size: 20px; }
.si-sub  { font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.35); }
.si-close {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 18px; cursor: pointer; border-radius: 6px; padding: 4px 9px;
  transition: all 0.15s;
}
.si-close:hover { background: rgba(255,255,255,0.1); color: #fff; }

/* Body */
.si-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; }

/* Drop zone */
.si-drop-zone {
  border: 2px dashed rgba(255,255,255,0.12);
  border-radius: 12px;
  padding: 36px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(255,255,255,0.02);
  position: relative; overflow: hidden;
}
.si-drop-zone::before {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(255,106,0,0.04) 0%, transparent 70%);
  pointer-events: none;
}
.si-drop-zone:hover, .si-drop-zone:focus {
  border-color: rgba(255,106,0,0.4);
  background: rgba(255,106,0,0.04);
  outline: none;
}
.si-drop-zone.si-drag-over {
  border-color: #ff6a00;
  background: rgba(255,106,0,0.1);
  box-shadow: 0 0 0 4px rgba(255,106,0,0.15);
}
.si-drop-icon { font-size: 40px; margin-bottom: 10px; }
.si-drop-label { font-size: 14px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.si-drop-sub { font-size: 11px; color: rgba(255,255,255,0.35); margin-bottom: 14px; }
.si-browse-btn {
  background: rgba(255,106,0,0.15); border: 1px solid rgba(255,106,0,0.35);
  color: #ff8040; font-size: 12px; font-weight: 700;
  padding: 7px 18px; border-radius: 20px; cursor: pointer; transition: all 0.15s;
}
.si-browse-btn:hover { background: rgba(255,106,0,0.28); color: #fff; }

/* Format pills */
.si-formats { display: flex; gap: 5px; flex-wrap: wrap; }
.si-fmt {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 700;
  padding: 3px 9px; border-radius: 20px; letter-spacing: 0.4px; user-select: none;
}
.si-fmt.active { background: rgba(255,106,0,0.12); border-color: rgba(255,106,0,0.3); color: #fb923c; }

/* Status */
.si-status-wrap { display: flex; flex-direction: column; gap: 6px; }
.si-status { font-size: 12px; font-weight: 600; min-height: 18px; }
.si-status-success { color: #4ade80; }
.si-status-error   { color: #f87171; }
.si-status-loading { color: #fb923c; }

.si-progress-track {
  height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden;
}
.si-progress-fill {
  height: 100%; width: 0;
  background: linear-gradient(90deg, #ff6a00, #a855f7);
  border-radius: 2px; transition: width 0.2s ease;
}

/* Preview */
.si-preview {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px;
}
.si-preview-waveform { border-radius: 4px; overflow: hidden; height: 50px; background: rgba(0,0,0,0.2); }
.si-preview-meta { display: flex; flex-direction: column; gap: 3px; }
.si-preview-name { font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.si-preview-info { font-size: 11px; color: rgba(255,255,255,0.4); }
.si-preview-actions { display: flex; gap: 6px; }
.si-preview-play {
  background: rgba(255,106,0,0.15); border: 1px solid rgba(255,106,0,0.3);
  color: #ff8040; font-size: 11px; font-weight: 700;
  padding: 6px 14px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.si-preview-play:hover { background: rgba(255,106,0,0.28); }
.si-preview-stop {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.6); font-size: 11px;
  padding: 6px 12px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.si-preview-stop:hover { background: rgba(255,255,255,0.12); }

/* Name row */
.si-name-row { display: flex; flex-direction: column; gap: 8px; }
.si-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.5px; }
.si-input {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; padding: 9px 12px; font-size: 13px; color: #fff;
  outline: none; font-family: inherit; transition: border-color 0.2s; width: 100%; box-sizing: border-box;
}
.si-input:focus { border-color: rgba(255,106,0,0.5); }
.si-input::placeholder { color: rgba(255,255,255,0.2); }
.si-color-row { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.si-color-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.si-swatch {
  width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent; transition: all 0.15s; outline: none;
}
.si-swatch:hover { transform: scale(1.15); }
.si-swatch.selected { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,0.4); }

/* Actions */
.si-actions { display: flex; gap: 8px; justify-content: flex-end; }
.si-btn-secondary {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  color: rgba(255,255,255,0.7); font-size: 13px; font-weight: 600;
  padding: 9px 18px; border-radius: 8px; cursor: pointer; transition: all 0.15s;
}
.si-btn-secondary:hover { background: rgba(255,255,255,0.1); }
.si-btn-primary {
  background: linear-gradient(135deg, #ff6a00, #ea580c);
  border: none; color: #fff; font-size: 13px; font-weight: 700;
  padding: 9px 22px; border-radius: 8px; cursor: pointer;
  display: flex; align-items: center; gap: 6px; transition: all 0.18s;
}
.si-btn-primary:hover { filter: brightness(1.12); box-shadow: 0 0 18px rgba(255,106,0,0.45); }

.si-hidden { display: none !important; }

/* Import button in toolbar */
#btn-import-sound {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(34,211,238,0.1); border: 1px solid rgba(34,211,238,0.28);
  color: #67e8f9; font-size: 11px; font-weight: 700;
  padding: 4px 11px; border-radius: 5px; cursor: pointer; transition: all 0.18s; height: 26px;
}
#btn-import-sound:hover { background: rgba(34,211,238,0.2); color: #fff; }
`;
    document.head.appendChild(style);
  }
}

/* ── Bootstrap: create importer + wire button after DOM loads ────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Wait until app is initialised (app.js runs after this file)
  const waitForApp = () => {
    if (!window.app) { setTimeout(waitForApp, 150); return; }

    window.soundImporter = new SoundImporter(
      window.app.audioEngine,
      window.app.sequencer,
      () => window.app._buildChannelRack()
    );

    // Wire toolbar button
    const btn = document.getElementById('btn-import-sound');
    if (btn) btn.addEventListener('click', () => window.soundImporter.open());

    // Add "Import Sound" to the add-channel button
    const addBtn = document.getElementById('add-channel-btn');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopImmediatePropagation();
        window.soundImporter.open();
      });
    }
  };
  waitForApp();
});
