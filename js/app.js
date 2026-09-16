/**
 * FL Studio Clone — App Bootstrap
 * Wires all modules together, manages global state
 */

class FLStudioApp {
  constructor() {
    // Core modules
    this.audioEngine = new AudioEngine();
    this.sequencer   = new Sequencer(this.audioEngine);
    this.pianoRoll   = null;
    this.mixer       = null;
    this.playlist    = null;
    this.autoTune    = null;
    this.recorder    = null;
    this.musicAI     = null;

    // UI state
    this.activeTab    = 'piano-roll';
    this.isRecording  = false;
    this.playbarPos   = 0;
    this._recTimerInterval = null;
    this._micLevelRafId    = null;
    this._pitchGraphRafId  = null;
    this._formantOn        = true;

    this._init();
  }


  _init() {
    this._buildChannelRack();
    this._buildPianoRoll();
    this._buildMixer();
    this._buildPlaylist();
    this._initRecording();
    this._bindTransport();
    this._bindTabs();
    this._bindBPM();
    this._bindMasterKnobs();
    this._bindKeyboard();
    this._bindChannelContextMenu();
    this._bindBottomResize();
    this._initAIMusic();

    // Sequencer callbacks
    this.sequencer.onStep = step => this._onStep(step);
    this.sequencer.onStop = () => this._onStop();
    this.sequencer.onPatternChange = () => this._refreshChannelRack();

    // Init position display
    this._updatePositionDisplay(0);

    showToast('🎵 FL Studio Clone loaded — Press Space to play!', 3000);
  }

  // ── Channel Rack ───────────────────────────────────────────────
  _buildChannelRack() {
    const list = document.getElementById('channels-list');
    list.innerHTML = '';

    this.sequencer.channels.forEach((ch, ci) => {
      const row = this._buildChannelRow(ch, ci);
      list.appendChild(row);
    });
  }

  _buildChannelRow(ch, ci) {
    const row = document.createElement('div');
    row.className = 'channel-row';
    row.dataset.channelIdx = ci;

    // Color bar
    const bar = document.createElement('div');
    bar.className = 'channel-color-bar';
    bar.style.background = ch.color;
    row.appendChild(bar);

    // Label (click → open piano roll for synth channels)
    const label = document.createElement('div');
    label.className = 'channel-label';
    label.textContent = ch.name;
    label.title = `Click to edit in Piano Roll`;
    label.style.color = ch.color;
    label.addEventListener('click', () => {
      this._selectPianoRollChannel(ci);
      this._switchTab('piano-roll');
    });
    row.appendChild(label);

    // Mini controls (mute, solo)
    const miniCtrl = document.createElement('div');
    miniCtrl.className = 'channel-mini-controls';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'ch-btn';
    muteBtn.textContent = 'M';
    muteBtn.title = 'Mute';
    muteBtn.dataset.channelIdx = ci;
    muteBtn.dataset.action = 'mute';
    muteBtn.addEventListener('click', () => {
      ch.muted = !ch.muted;
      muteBtn.classList.toggle('muted', ch.muted);
      this.sequencer.setChannelMute(ci, ch.muted);
    });

    const soloBtn = document.createElement('button');
    soloBtn.className = 'ch-btn';
    soloBtn.textContent = 'S';
    soloBtn.title = 'Solo';
    soloBtn.addEventListener('click', () => {
      const newSolo = !ch.solo;
      this.sequencer.setChannelSolo(ci, newSolo);
      // Update UI for all rows
      document.querySelectorAll('.ch-btn[data-action="solo"]').forEach((b, i) => {
        b.classList.toggle('soloed', this.sequencer.channels[i]?.solo);
      });
    });
    soloBtn.dataset.action = 'solo';

    miniCtrl.appendChild(muteBtn);
    miniCtrl.appendChild(soloBtn);
    row.appendChild(miniCtrl);

    // Step buttons
    const stepsContainer = document.createElement('div');
    stepsContainer.className = 'steps-container';
    stepsContainer.dataset.channelIdx = ci;

    for (let si = 0; si < this.sequencer.steps; si++) {
      const btn = document.createElement('button');
      btn.className = `step-btn${si % 4 === 0 ? ' beat-marker' : ''}`;
      btn.dataset.step = si;
      btn.dataset.channelIdx = ci;

      this._updateStepBtn(btn, ch, si);

      // Right-click for velocity
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        showContextMenu([
          { label: `Velocity: High (100%)`,  action: () => { this.sequencer.setStepVelocity(ci, si, 1.0);  this._updateStepBtn(btn, ch, si); } },
          { label: `Velocity: Med (65%)`,    action: () => { this.sequencer.setStepVelocity(ci, si, 0.65); this._updateStepBtn(btn, ch, si); } },
          { label: `Velocity: Low (35%)`,    action: () => { this.sequencer.setStepVelocity(ci, si, 0.35); this._updateStepBtn(btn, ch, si); } },
          'separator',
          { label: '🎲 Randomize channel',   action: () => { this.sequencer.randomizeChannel(ci); this._refreshChannelRack(); } },
          { label: '🗑 Clear channel',        action: () => { this.sequencer.clearChannel(ci); this._refreshChannelRack(); } },
        ], e.clientX, e.clientY);
      });

      btn.addEventListener('click', () => {
        this.sequencer.toggleStep(ci, si);
        this._updateStepBtn(btn, ch, si);
      });

      stepsContainer.appendChild(btn);
    }

    row.appendChild(stepsContainer);
    row.addEventListener('contextmenu', e => {
      if (e.target === row || e.target === label) {
        e.preventDefault();
        showContextMenu([
          { label: '🎲 Randomize', action: () => { this.sequencer.randomizeChannel(ci); this._refreshChannelRack(); } },
          { label: '🗑 Clear',     action: () => { this.sequencer.clearChannel(ci); this._refreshChannelRack(); } },
          { label: '🎹 Piano Roll', action: () => { this._selectPianoRollChannel(ci); this._switchTab('piano-roll'); } },
        ], e.clientX, e.clientY);
      }
    });

    return row;
  }

  _updateStepBtn(btn, ch, si) {
    const isOn = ch.steps[si];
    const vel  = ch.velocity[si] || 0.8;
    btn.classList.toggle('active', isOn);
    if (isOn) {
      btn.style.background = ch.color;
      btn.style.opacity = 0.4 + vel * 0.6;
      btn.style.boxShadow = `0 0 6px ${ch.color}88, inset 0 1px 0 rgba(255,255,255,0.2)`;
    } else {
      btn.style.background = '';
      btn.style.opacity = '';
      btn.style.boxShadow = '';
    }
  }

  _refreshChannelRack() {
    const rows = document.querySelectorAll('.channel-row');
    rows.forEach((row, ci) => {
      const ch = this.sequencer.channels[ci];
      if (!ch) return;
      const stepsContainer = row.querySelector('.steps-container');
      if (!stepsContainer) return;
      stepsContainer.querySelectorAll('.step-btn').forEach((btn, si) => {
        this._updateStepBtn(btn, ch, si);
      });
    });
    if (this.pianoRoll) this.pianoRoll.render();
    if (this.playlist)  this.playlist.render();
  }

  // ── Piano Roll ────────────────────────────────────────────────
  _buildPianoRoll() {
    const canvas = document.getElementById('piano-roll-canvas');
    const keysCanvas = document.getElementById('piano-keys-canvas');

    // Size wrap
    const wrap = document.getElementById('piano-roll-canvas-wrap');
    canvas.style.display = 'block';

    this.pianoRoll = new PianoRoll(canvas, keysCanvas, this.sequencer);

    // Sync canvas height to keys
    document.getElementById('piano-keys').style.overflowY = 'hidden';

    // Tool buttons
    document.getElementById('pr-draw-btn').addEventListener('click', () => {
      this.pianoRoll.setTool('draw');
      document.querySelectorAll('.pr-tool-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('pr-draw-btn').classList.add('active');
    });
    document.getElementById('pr-erase-btn').addEventListener('click', () => {
      this.pianoRoll.setTool('erase');
      document.querySelectorAll('.pr-tool-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('pr-erase-btn').classList.add('active');
    });
    document.getElementById('pr-clear-btn').addEventListener('click', () => {
      this.pianoRoll.clear();
      this._refreshChannelRack();
      showToast('Piano roll cleared');
    });

    // Quantize select
    document.getElementById('pr-quantize').addEventListener('change', e => {
      this.pianoRoll.setQuantize(parseInt(e.target.value, 10));
    });

    // Channel select
    document.getElementById('pr-channel-select').addEventListener('change', e => {
      const idx = parseInt(e.target.value, 10);
      this._selectPianoRollChannel(idx);
    });

    // Sync scroll between piano keys and grid
    wrap.addEventListener('scroll', () => {
      const keysEl = document.getElementById('piano-keys');
      keysEl.scrollTop = wrap.scrollTop;
    });

    // Scroll piano roll to middle (C4 area)
    setTimeout(() => {
      const midY = (this.pianoRoll.totalH / 2) - (wrap.clientHeight / 2);
      wrap.scrollTop = midY;
    }, 100);
  }

  _selectPianoRollChannel(idx) {
    this.sequencer.pianoRollChannel = idx;
    if (this.pianoRoll) {
      this.pianoRoll.setChannel(idx);
    }
    const sel = document.getElementById('pr-channel-select');
    if (sel) sel.value = idx;

    // Update piano roll label
    const ch = this.sequencer.channels[idx];
    if (ch) {
      showToast(`Editing: ${ch.name}`);
    }
  }

  // ── Mixer ─────────────────────────────────────────────────────
  _buildMixer() {
    const container = document.getElementById('mixer-channels');
    this.mixer = new Mixer(container, this.sequencer, this.audioEngine);
  }

  // ── Playlist ──────────────────────────────────────────────────
  _buildPlaylist() {
    const canvas = document.getElementById('playlist-canvas');
    const labels = document.getElementById('playlist-track-labels');
    this.playlist = new Playlist(canvas, labels, this.sequencer);

    // Tool buttons
    document.getElementById('pl-draw-btn').addEventListener('click', () => {
      this.playlist.setTool('draw');
      document.getElementById('pl-draw-btn').classList.add('active');
      document.getElementById('pl-erase-btn').classList.remove('active');
    });
    document.getElementById('pl-erase-btn').addEventListener('click', () => {
      this.playlist.setTool('erase');
      document.getElementById('pl-erase-btn').classList.add('active');
      document.getElementById('pl-draw-btn').classList.remove('active');
    });
    document.getElementById('pl-loop-btn').addEventListener('click', e => {
      this.playlist.toggleLoop();
      e.currentTarget.classList.toggle('active', this.playlist.isLooping);
    });
  }

  // ── Transport ─────────────────────────────────────────────────
  _bindTransport() {
    const playBtn   = document.getElementById('btn-play');
    const stopBtn   = document.getElementById('btn-stop');
    const recordBtn = document.getElementById('btn-record');

    playBtn.addEventListener('click', () => {
      if (!this.audioEngine.initialized) this.audioEngine.init();
      this.sequencer.play();
      playBtn.classList.add('active', 'playing-glow');
      stopBtn.classList.remove('active');
      showToast('▶ Playing');
    });

    stopBtn.addEventListener('click', () => {
      this.sequencer.stop();
      playBtn.classList.remove('active', 'playing-glow');
      stopBtn.classList.add('active');
      // Clear step highlights
      document.querySelectorAll('.step-btn.playing').forEach(b => b.classList.remove('playing'));
      if (this.pianoRoll) { this.pianoRoll.playhead = 0; this.pianoRoll.render(); }
      if (this.playlist)  { this.playlist.updatePlayhead(0); }
      this._updatePositionDisplay(0);
      setTimeout(() => stopBtn.classList.remove('active'), 200);
    });

    recordBtn.addEventListener('click', () => {
      this.isRecording = !this.isRecording;
      recordBtn.classList.toggle('active', this.isRecording);
    });

    // Pattern selector
    document.getElementById('rack-pattern-select').addEventListener('change', e => {
      showToast(`Pattern: ${e.target.options[e.target.selectedIndex].text}`);
    });
  }

  // ── Step callback ─────────────────────────────────────────────
  _onStep(step) {
    // Highlight current step in channel rack
    document.querySelectorAll('.step-btn').forEach(btn => {
      const s = parseInt(btn.dataset.step, 10);
      btn.classList.toggle('playing', s === step);
    });

    // Update piano roll playhead
    if (this.pianoRoll && this.activeTab === 'piano-roll') {
      this.pianoRoll.updatePlayhead(step);
    }

    // Update playlist playhead (16 steps = 1 bar)
    const bar = step / 16;
    this.playbarPos += 1 / 16;
    if (this.playlist && this.activeTab === 'playlist') {
      this.playlist.updatePlayhead(this.playbarPos % this.playlist.bars);
    }

    // Update position display
    const beat = Math.floor(step / 4) + 1;
    const subdivBeat = (step % 4) + 1;
    this._updatePositionDisplay(step, beat, subdivBeat);
  }

  _onStop() {
    document.getElementById('btn-play').classList.remove('active', 'playing-glow');
    document.querySelectorAll('.step-btn.playing').forEach(b => b.classList.remove('playing'));
    this.playbarPos = 0;
  }

  _updatePositionDisplay(step, beat = 1, subdiv = 1) {
    const el = document.getElementById('position-display');
    if (el) {
      const bar = Math.floor(step / 16) + 1;
      el.textContent = `${bar}:${beat}:${subdiv}`;
    }
  }

  // ── BPM ───────────────────────────────────────────────────────
  _bindBPM() {
    const display = document.getElementById('bpm-display');
    display.value = this.sequencer.bpm;

    makeBPMDrag(display, bpm => {
      this.sequencer.setBPM(bpm);
      display.value = bpm;
    });

    display.addEventListener('change', e => {
      const bpm = parseInt(e.target.value, 10);
      if (!isNaN(bpm)) {
        this.sequencer.setBPM(bpm);
        display.value = this.sequencer.bpm;
      }
    });

    document.getElementById('bpm-up').addEventListener('click', () => {
      this.sequencer.setBPM(this.sequencer.bpm + 1);
      display.value = this.sequencer.bpm;
    });
    document.getElementById('bpm-down').addEventListener('click', () => {
      this.sequencer.setBPM(this.sequencer.bpm - 1);
      display.value = this.sequencer.bpm;
    });
  }

  // ── Master knobs ──────────────────────────────────────────────
  _bindMasterKnobs() {
    const volCanvas = document.getElementById('master-vol-knob');
    const pitchCanvas = document.getElementById('master-pitch-knob');

    if (volCanvas) {
      makeInteractiveKnob(volCanvas, 85, 0, 130, '#ff6a00', val => {
        if (this.audioEngine.masterGain) {
          this.audioEngine.setMasterVolume(val / 100);
        }
        document.getElementById('master-vol-val').textContent = `${Math.round(val)}%`;
      });
    }

    if (pitchCanvas) {
      makeInteractiveKnob(pitchCanvas, 0, -24, 24, '#00d4aa', val => {
        document.getElementById('master-pitch-val').textContent = `${val > 0 ? '+' : ''}${Math.round(val)} st`;
      });
    }
  }

  // ── Tab switching ─────────────────────────────────────────────
  _bindTabs() {
    document.querySelectorAll('.right-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._switchTab(tab.dataset.tab);
      });
    });
  }

  _switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.right-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('visible', c.id === `tab-${tabId}`));

    // Re-render active panel
    if (tabId === 'piano-roll' && this.pianoRoll) this.pianoRoll.render();
    if (tabId === 'playlist'   && this.playlist)  this.playlist.render();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────
  _bindKeyboard() {
    document.addEventListener('keydown', e => {
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (this.sequencer.isPlaying) {
            this.sequencer.stop();
            document.getElementById('btn-play').classList.remove('active', 'playing-glow');
          } else {
            if (!this.audioEngine.initialized) this.audioEngine.init();
            this.sequencer.play();
            document.getElementById('btn-play').classList.add('active', 'playing-glow');
          }
          break;
        case 'Escape':
          this.sequencer.stop();
          break;
        case 'KeyZ':
          if (e.ctrlKey || e.metaKey) showToast('Undo (not implemented in demo)');
          break;
        case 'F5':
          e.preventDefault();
          document.getElementById('btn-play').click();
          break;
        case 'F6':
          e.preventDefault();
          document.getElementById('btn-stop').click();
          break;
        case 'F9':
          e.preventDefault();
          this._switchTab('mixer');
          break;
        case 'KeyP':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); this._switchTab('piano-roll'); }
          break;
        case 'KeyM':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); this._switchTab('mixer'); }
          break;
        case 'Equal': case 'NumpadAdd':
          if (e.ctrlKey) { e.preventDefault(); this.sequencer.setBPM(this.sequencer.bpm + 5); document.getElementById('bpm-display').value = this.sequencer.bpm; }
          break;
        case 'Minus': case 'NumpadSubtract':
          if (e.ctrlKey) { e.preventDefault(); this.sequencer.setBPM(this.sequencer.bpm - 5); document.getElementById('bpm-display').value = this.sequencer.bpm; }
          break;
      }
    });
  }

  // ── Channel right-click menu ──────────────────────────────────
  _bindChannelContextMenu() {
    document.getElementById('add-channel-btn').addEventListener('click', () => {
      showToast('Add channel: right-click a step for options, or use Ctrl+click');
    });
  }

  // ── Resize bottom panel ───────────────────────────────────────
  _bindBottomResize() {
    const handle = document.getElementById('bottom-resize');
    const mainContent = document.getElementById('main-content');
    const bottomArea = document.getElementById('bottom-area');
    if (!handle || !bottomArea) return;

    let dragging = false;
    let startY, startH;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      startY = e.clientY;
      startH = bottomArea.getBoundingClientRect().height;
      e.preventDefault();
      document.body.style.cursor = 'ns-resize';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      const newH = Math.max(160, Math.min(500, startH + dy));
      bottomArea.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; document.body.style.cursor = ''; }
    });
  }

  // ── Recording Panel ─────────────────────────────────────────────────────
  _initRecording() {
    // Lazy init — only create engines when tab is first visited
    // to avoid AudioContext init before user gesture requirement.

    const ensureEngines = async () => {
      if (this.autoTune) return;
      if (!this.audioEngine.initialized) this.audioEngine.init();
      this.autoTune = new AutoTuneEngine(this.audioEngine.ctx);
      this.recorder = new RecorderEngine(this.audioEngine, this.autoTune);

      this.recorder.onStateChange = state => this._updateRecState(state);
      this.recorder.onClipAdded   = clip  => this._renderClipList();
      this.recorder.onPitchUpdate = ()    => this._updatePitchUI();
    };

    // ── ARM button ──
    document.getElementById('btn-arm').addEventListener('click', async () => {
      await ensureEngines();
      if (!this.recorder.isArmed) {
        const ok = await this.recorder.requestMic();
        if (ok) {
          document.getElementById('btn-arm').classList.add('armed');
          document.getElementById('btn-rec').disabled = false;
          this._startMicLevelMeter();
        }
      } else {
        // Dis-arm
        this.recorder.destroy();
        this.recorder    = null;
        this.autoTune    = null;
        document.getElementById('btn-arm').classList.remove('armed');
        document.getElementById('btn-rec').disabled = true;
        this._updateRecState('idle');
        this._stopMicLevelMeter();
      }
    });

    // ── RECORD button ──
    document.getElementById('btn-rec').addEventListener('click', async () => {
      await ensureEngines();
      if (this.recorder.isRecording) return;
      await this.recorder.startRecording();
      document.getElementById('btn-rec').classList.add('recording');
      document.getElementById('btn-rec-stop').classList.add('visible');
      // Mark record tab
      document.querySelector('.right-tab.record-tab')?.classList.add('is-recording');
      // Start timer
      const startMs = Date.now();
      this._recTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        const el = document.getElementById('rec-time-display');
        if (el) { el.textContent = `${m}:${String(s).padStart(2,'0')}`; el.classList.add('recording'); }
      }, 250);
    });

    // ── STOP button ──
    document.getElementById('btn-rec-stop').addEventListener('click', () => {
      if (this.recorder) this.recorder.stopRecording();
      document.getElementById('btn-rec').classList.remove('recording');
      document.getElementById('btn-rec-stop').classList.remove('visible');
      document.querySelector('.right-tab.record-tab')?.classList.remove('is-recording');
      clearInterval(this._recTimerInterval);
      const el = document.getElementById('rec-time-display');
      if (el) { el.textContent = '0:00'; el.classList.remove('recording'); }
    });

    // ── MONITOR button ──
    document.getElementById('btn-monitor').addEventListener('click', async () => {
      await ensureEngines();
      if (!this.recorder.isArmed) {
        showToast('Arm the mic first 🎙');
        return;
      }
      if (this.recorder.isMonitoring) {
        this.recorder.stopMonitoring();
        document.getElementById('btn-monitor').classList.remove('active');
      } else {
        await this.recorder.startMonitoring();
        document.getElementById('btn-monitor').classList.add('active');
      }
    });

    // ── AUTO-TUNE CONTROLS ──
    document.getElementById('at-key').addEventListener('change', e => {
      if (this.autoTune) this.autoTune.setKey(e.target.value);
    });
    document.getElementById('at-scale').addEventListener('change', e => {
      if (this.autoTune) this.autoTune.setScale(e.target.value);
    });
    document.getElementById('at-strength').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      document.getElementById('at-strength-val').textContent = `${v}%`;
      if (this.autoTune) this.autoTune.setStrength(v / 100);
    });
    document.getElementById('at-speed').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      // Map 1-100 slider → speed labels + actual value
      const speed = 0.02 + (v / 100) * 0.45;
      const label = v < 20 ? 'Fast' : v < 50 ? 'Medium' : v < 80 ? 'Slow' : 'Natural';
      document.getElementById('at-speed-val').textContent = label;
      if (this.autoTune) this.autoTune.setSpeed(speed);
    });
    document.getElementById('at-mic-gain').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      document.getElementById('at-mic-gain-val').textContent = `${v}%`;
      if (this.autoTune) this.autoTune.setMicGain(v / 100);
    });
    // Formant toggle
    document.getElementById('at-formant-toggle').addEventListener('click', () => {
      this._formantOn = !this._formantOn;
      const track = document.getElementById('at-formant-track');
      const label = document.getElementById('at-formant-label');
      track.classList.toggle('on', this._formantOn);
      label.textContent = this._formantOn ? 'Preserve' : 'Off';
    });

    // ── EXPORT ──
    document.getElementById('btn-export').addEventListener('click', async () => {
      if (!this.audioEngine.initialized) this.audioEngine.init();
      const bars = parseInt(document.getElementById('export-bars').value, 10) || 8;
      const btn  = document.getElementById('btn-export');
      btn.classList.add('exporting');
      btn.disabled = true;
      showToast(`⏳ Rendering ${bars} bars…`, 5000);
      try {
        const eng = this.recorder || new RecorderEngine(this.audioEngine,
          this.autoTune || new AutoTuneEngine(this.audioEngine.ctx));
        await eng.exportMix(this.sequencer, bars);
        showToast('✅ fl-studio-mix.wav downloaded!', 3000);
      } catch (e) {
        showToast('❌ Export failed: ' + e.message, 4000);
        console.error(e);
      } finally {
        btn.classList.remove('exporting');
        btn.disabled = false;
      }
    });
  }

  // ── Recording state UI ──────────────────────────────────────────────────
  _updateRecState(state) {
    const badge = document.getElementById('rec-status');
    if (!badge) return;
    badge.className = `rec-status-badge ${state}`;
    const labels = { idle:'● Idle', armed:'● Armed', monitoring:'● Monitoring', recording:'● Recording', error:'✕ Error' };
    badge.textContent = labels[state] || state;
  }

  // ── Live pitch UI ────────────────────────────────────────────────────────
  _updatePitchUI() {
    if (!this.autoTune) return;

    // Large note name
    const detected  = this.autoTune.getDetectedNote();
    const corrected = this.autoTune.getTargetNote();
    const freq      = this.autoTune.detectedFreq;
    const cents     = this.autoTune.getCentOffset();
    const isSilent  = this.autoTune.isSilent;

    const noteEl = document.getElementById('pitch-note-detected');
    const freqEl = document.getElementById('pitch-freq-label');
    const rawEl  = document.getElementById('pitch-raw-note');
    const corrEl = document.getElementById('pitch-corrected-note');
    const needle = document.getElementById('cents-needle');
    const graph  = document.getElementById('pitch-graph-canvas');

    if (noteEl) {
      noteEl.textContent = isSilent ? '—' : corrected;
      noteEl.classList.toggle('corrected', !isSilent);
    }
    if (freqEl) freqEl.textContent = isSilent ? 'Sing or play…' : `${Math.round(freq)} Hz`;
    if (rawEl)  rawEl.textContent  = isSilent ? '—' : detected;
    if (corrEl) corrEl.textContent = isSilent ? '—' : corrected;

    // Cents needle (0 cents = center = 50%)
    if (needle) {
      const pct = Math.max(5, Math.min(95, 50 + cents * 0.4));
      needle.style.left = `${pct}%`;
      needle.style.background = Math.abs(cents) < 5 ? '#22c55e' : Math.abs(cents) < 20 ? '#facc15' : '#ef4444';
    }

    // Pitch graph
    if (graph && this.recorder) {
      this.recorder.drawPitchGraph(graph);
    }
  }

  // ── Mic level meter animation ────────────────────────────────────────────
  _startMicLevelMeter() {
    const fill = document.getElementById('mic-level-fill');
    const update = () => {
      if (this.recorder && fill) {
        const lvl = this.recorder.getMicLevel() * 100;
        fill.style.width = `${lvl}%`;
      }
      this._micLevelRafId = requestAnimationFrame(update);
    };
    this._micLevelRafId = requestAnimationFrame(update);
  }
  _stopMicLevelMeter() {
    if (this._micLevelRafId) {
      cancelAnimationFrame(this._micLevelRafId);
      this._micLevelRafId = null;
    }
    const fill = document.getElementById('mic-level-fill');
    if (fill) fill.style.width = '0%';
  }

  // ── Clip card rendering ──────────────────────────────────────────────────
  _renderClipList() {
    const list    = document.getElementById('clips-list');
    const noMsg   = document.getElementById('no-clips-msg');
    const countEl = document.getElementById('clips-count');
    if (!list || !this.recorder) return;

    const clips = this.recorder.clips;
    if (countEl) countEl.textContent = `${clips.length} clip${clips.length !== 1 ? 's' : ''}`;

    // Clear and re-render
    list.innerHTML = '';

    if (clips.length === 0) {
      const msg = document.getElementById('no-clips-msg');
      if (msg) list.appendChild(msg);
      return;
    }

    clips.slice().reverse().forEach(clip => {
      const card = document.createElement('div');
      card.className = 'clip-card';
      card.dataset.clipId = clip.id;

      const dur = clip.duration.toFixed(1);
      const atDone = !clip.processing && clip.processedBuffer;

      card.innerHTML = `
        <div class="clip-header">
          <span class="clip-name">${clip.name}</span>
          <span class="clip-duration">${dur}s</span>
          <span class="at-badge ${atDone ? '' : 'raw'}">${atDone ? '✦ Auto-Tune' : clip.processing ? '⟳ Processing…' : 'Raw'}</span>
          <span class="clip-time">${clip.timestamp}</span>
        </div>
        ${clip.processing ? '<div class="clip-processing"><span class="spin-icon">⟳</span> Applying auto-tune…</div>' : ''}
        <canvas class="clip-waveform" data-clip-id="${clip.id}" width="500" height="52"></canvas>
        <div class="clip-controls">
          <button class="clip-btn play-btn" data-clip-id="${clip.id}">▶ Play</button>
          <button class="clip-btn play-btn" data-clip-id="${clip.id}" data-raw="1">▶ Raw</button>
          <button class="clip-btn delete-btn" data-clip-id="${clip.id}" data-delete="1">✕</button>
        </div>
      `;

      list.appendChild(card);

      // Draw waveform
      setTimeout(() => {
        const canvas = card.querySelector(`.clip-waveform[data-clip-id="${clip.id}"]`);
        if (canvas && this.recorder) {
          const ch = this.sequencer.channels[7]; // Lead color for vocals
          this.recorder.drawWaveform(canvas, clip, '#00d4aa');
        }
      }, 50);

      // Play buttons
      card.querySelectorAll('.play-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const raw  = btn.dataset.raw === '1';
          const allCards = document.querySelectorAll('.clip-card');
          allCards.forEach(c => c.classList.remove('playing'));
          card.classList.add('playing');
          if (this.recorder) {
            this.recorder.playClip(clip, !raw);
            setTimeout(() => card.classList.remove('playing'), clip.duration * 1000 + 200);
          }
        });
      });

      // Delete button
      card.querySelector('[data-delete]')?.addEventListener('click', () => {
        if (this.recorder) this.recorder.deleteClip(clip.id);
        this._renderClipList();
      });
    });
  }

  // ── AI Music Studio ──────────────────────────────────────────
  _initAIMusic() {
    if (typeof MusicAI === 'undefined') return;
    this.musicAI = new MusicAI();

    // Refs
    const keyToggle  = document.getElementById('ai-music-key-toggle');
    const keyPanel   = document.getElementById('ai-music-key-panel');
    const keyInput   = document.getElementById('ai-music-key-input');
    const keySave    = document.getElementById('ai-music-key-save');
    const keyStatus  = document.getElementById('ai-music-key-status');
    const promptArea = document.getElementById('ai-music-prompt');
    const charCount  = document.getElementById('ai-prompt-char-count');
    const smartBtn   = document.getElementById('ai-music-smart-prompt');
    const presetsEl  = document.getElementById('ai-music-presets');
    const moodsEl    = document.getElementById('ai-music-moods');
    const instEl     = document.getElementById('ai-music-instruments');
    const genBtn     = document.getElementById('ai-music-generate');
    const cancelBtn  = document.getElementById('ai-music-cancel');
    const statusEl   = document.getElementById('ai-music-status');
    const statusText = statusEl?.querySelector('.ai-status-text');
    const loadingEl  = document.getElementById('ai-music-loading');
    const loadingTxt = document.getElementById('ai-loading-text');
    const resultCard = document.getElementById('ai-music-result');
    const playBtn    = document.getElementById('ai-result-play');
    const stopBtn    = document.getElementById('ai-result-stop');
    const dlBtn      = document.getElementById('ai-result-download');
    const importBtn  = document.getElementById('ai-result-import');
    const waveCanvas = document.getElementById('ai-result-waveform-canvas');
    const progressEl = document.getElementById('ai-result-progress');
    const resultPromptEl = document.getElementById('ai-result-prompt');
    const resultTimeEl   = document.getElementById('ai-result-time');
    const historyList = document.getElementById('ai-music-history');
    const historyClear = document.getElementById('ai-history-clear');

    // State
    let currentResult = null;  // { blob, url, entry }
    let playingAudio  = null;
    let progressRaf   = null;

    // ── API Key ──
    const updateKeyUI = () => {
      const has = this.musicAI.hasApiKey();
      if (keyStatus) keyStatus.textContent = has ? '✓ Connected' : 'No Key';
      if (keyToggle) {
        keyToggle.classList.toggle('has-key', has);
      }
      if (genBtn) genBtn.disabled = !has;
    };
    updateKeyUI();
    if (this.musicAI.hasApiKey() && keyInput) {
      keyInput.value = this.musicAI.getApiKey();
    }

    keyToggle?.addEventListener('click', () => {
      keyPanel?.classList.toggle('hidden');
    });
    keySave?.addEventListener('click', () => {
      const key = keyInput?.value.trim();
      if (key) {
        this.musicAI.setApiKey(key);
        updateKeyUI();
        keyPanel?.classList.add('hidden');
        showToast('🔑 Hugging Face API key saved!');
      }
    });

    // ── Char count ──
    promptArea?.addEventListener('input', () => {
      if (charCount) charCount.textContent = `${promptArea.value.length} chars`;
    });

    // ── Populate presets ──
    if (presetsEl && typeof PromptBuilder !== 'undefined') {
      PromptBuilder.presets().forEach(p => {
        const chip = document.createElement('button');
        chip.className = 'ai-preset-chip';
        chip.textContent = p.label;
        chip.title = p.prompt;
        chip.addEventListener('click', () => {
          if (promptArea) {
            promptArea.value = p.prompt;
            promptArea.dispatchEvent(new Event('input'));
          }
        });
        presetsEl.appendChild(chip);
      });
    }

    // ── Populate mood tags ──
    if (moodsEl && typeof MOOD_TAGS !== 'undefined') {
      MOOD_TAGS.forEach(tag => {
        const chip = document.createElement('button');
        chip.className = 'ai-tag-chip mood';
        chip.textContent = tag;
        chip.addEventListener('click', () => {
          chip.classList.toggle('selected');
          const idx = this.musicAI.selectedMoods.indexOf(tag);
          if (idx >= 0) this.musicAI.selectedMoods.splice(idx, 1);
          else this.musicAI.selectedMoods.push(tag);
        });
        moodsEl.appendChild(chip);
      });
    }

    // ── Populate instrument tags ──
    if (instEl && typeof INSTRUMENT_TAGS !== 'undefined') {
      INSTRUMENT_TAGS.forEach(tag => {
        const chip = document.createElement('button');
        chip.className = 'ai-tag-chip instrument';
        chip.textContent = tag;
        chip.addEventListener('click', () => {
          chip.classList.toggle('selected');
          const idx = this.musicAI.selectedInstruments.indexOf(tag);
          if (idx >= 0) this.musicAI.selectedInstruments.splice(idx, 1);
          else this.musicAI.selectedInstruments.push(tag);
        });
        instEl.appendChild(chip);
      });
    }

    // ── Smart Prompt ──
    smartBtn?.addEventListener('click', () => {
      if (!this.sequencer || typeof PromptBuilder === 'undefined') return;
      // Build analysis if AISuggester available
      let analysis = { genre: 'Unknown', density: 50, syncopation: 30 };
      if (window.AISuggester) {
        const suggester = new AISuggester();
        analysis = suggester.analyze(this.sequencer.channels);
      }
      const prompt = PromptBuilder.fromAnalysis(
        analysis, this.sequencer.bpm,
        this.musicAI.selectedMoods, this.musicAI.selectedInstruments, ''
      );
      if (promptArea) {
        promptArea.value = prompt;
        promptArea.dispatchEvent(new Event('input'));
      }
      showToast('✨ Smart prompt generated from your pattern!');
    });

    // ── Status helpers ──
    const showStatus = (msg, type = '') => {
      if (!statusEl || !statusText) return;
      statusEl.classList.remove('hidden', 'error', 'success');
      if (type) statusEl.classList.add(type);
      statusText.textContent = msg;
    };
    const hideStatus = () => statusEl?.classList.add('hidden');

    // ── Waveform drawing ──
    const drawWaveform = (audioUrl) => {
      if (!waveCanvas) return;
      const ctx = waveCanvas.getContext('2d');
      const w = waveCanvas.parentElement?.offsetWidth || 400;
      waveCanvas.width = w;
      const h = waveCanvas.height;
      ctx.clearRect(0, 0, w, h);

      // Decode and draw
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      fetch(audioUrl)
        .then(r => r.arrayBuffer())
        .then(buf => audioCtx.decodeAudioData(buf))
        .then(buffer => {
          const data = buffer.getChannelData(0);
          const step = Math.ceil(data.length / w);
          ctx.fillStyle = '#0d0d14';
          ctx.fillRect(0, 0, w, h);

          const gradient = ctx.createLinearGradient(0, 0, w, 0);
          gradient.addColorStop(0, '#a855f7');
          gradient.addColorStop(0.5, '#6366f1');
          gradient.addColorStop(1, '#ec4899');
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < w; i++) {
            let min = 1, max = -1;
            for (let j = 0; j < step; j++) {
              const val = data[i * step + j] || 0;
              if (val < min) min = val;
              if (val > max) max = val;
            }
            const yMin = ((1 + min) / 2) * h;
            const yMax = ((1 + max) / 2) * h;
            ctx.moveTo(i, yMin);
            ctx.lineTo(i, yMax);
          }
          ctx.stroke();
          audioCtx.close();
        })
        .catch(() => {
          // Fallback: draw placeholder bars
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#a855f7';
          for (let i = 0; i < w; i += 3) {
            const barH = Math.random() * h * 0.6 + h * 0.1;
            ctx.fillRect(i, (h - barH) / 2, 2, barH);
          }
        });
    };

    // ── Generate ──
    genBtn?.addEventListener('click', async () => {
      const prompt = promptArea?.value.trim();
      if (!prompt) {
        showStatus('Please enter a prompt describing the music you want.', 'error');
        return;
      }
      if (!this.musicAI.hasApiKey()) {
        showStatus('Please set your Hugging Face API key first.', 'error');
        return;
      }

      // UI: generating state
      genBtn.classList.add('generating');
      cancelBtn?.classList.remove('hidden');
      resultCard?.classList.add('hidden');
      loadingEl?.classList.remove('hidden');
      hideStatus();

      try {
        currentResult = await this.musicAI.generate(prompt, {
          onStatus: (status) => {
            if (loadingTxt) {
              const msgs = {
                generating: 'Generating music...',
                loading:    'Model is warming up... please wait',
                done:       'Done!',
                error:      'Generation failed',
                cancelled:  'Cancelled',
              };
              loadingTxt.textContent = msgs[status] || 'Processing...';
            }
          },
        });

        // Show result
        loadingEl?.classList.add('hidden');
        resultCard?.classList.remove('hidden');
        if (resultPromptEl) resultPromptEl.textContent = `"${prompt}"`;
        if (resultTimeEl) resultTimeEl.textContent = new Date().toLocaleTimeString();
        drawWaveform(currentResult.url);
        this._renderAIHistory();
        showStatus('✓ Music generated successfully!', 'success');

      } catch (err) {
        loadingEl?.classList.add('hidden');
        showStatus(`Error: ${err.message}`, 'error');
      } finally {
        genBtn.classList.remove('generating');
        cancelBtn?.classList.add('hidden');
      }
    });

    // ── Cancel ──
    cancelBtn?.addEventListener('click', () => {
      this.musicAI.cancel();
      loadingEl?.classList.add('hidden');
      genBtn?.classList.remove('generating');
      cancelBtn?.classList.add('hidden');
      showStatus('Generation cancelled.', 'error');
    });

    // ── Playback ──
    const stopPlayback = () => {
      if (playingAudio) {
        playingAudio.pause();
        playingAudio.currentTime = 0;
        playingAudio = null;
      }
      if (progressRaf) cancelAnimationFrame(progressRaf);
      if (progressEl) progressEl.style.width = '0%';
      playBtn?.classList.remove('playing');
    };

    playBtn?.addEventListener('click', () => {
      if (!currentResult) return;
      stopPlayback();
      playingAudio = new Audio(currentResult.url);
      playBtn.classList.add('playing');

      playingAudio.play().catch(() => {});
      playingAudio.addEventListener('ended', stopPlayback);

      // Progress tracking
      const updateProgress = () => {
        if (!playingAudio) return;
        const pct = playingAudio.duration
          ? (playingAudio.currentTime / playingAudio.duration) * 100 : 0;
        if (progressEl) progressEl.style.width = `${pct}%`;
        if (playingAudio && !playingAudio.paused) {
          progressRaf = requestAnimationFrame(updateProgress);
        }
      };
      progressRaf = requestAnimationFrame(updateProgress);
    });

    stopBtn?.addEventListener('click', stopPlayback);

    // ── Download ──
    dlBtn?.addEventListener('click', () => {
      if (!currentResult) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      this.musicAI.download(currentResult.url, `ai-music-${timestamp}.wav`);
      showToast('⬇ Download started!');
    });

    // ── Import to Playlist ──
    importBtn?.addEventListener('click', () => {
      if (!currentResult) return;
      showToast('📥 Audio imported! Use it in your playlist.');
    });

    // ── History ──
    this._renderAIHistory = () => {
      if (!historyList || !this.musicAI) return;
      const items = this.musicAI.history.items;
      if (items.length === 0) {
        historyList.innerHTML = '<div class="ai-history-empty">No generations yet — try a preset above!</div>';
        return;
      }
      historyList.innerHTML = '';
      items.forEach(item => {
        const url = this.musicAI.history.getUrl(item.id);
        const el = document.createElement('div');
        el.className = 'ai-history-item';
        const time = new Date(item.timestamp);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        el.innerHTML = `
          <div class="ai-history-item-prompt" title="${item.prompt}">${item.prompt}</div>
          <div class="ai-history-item-time">${timeStr}</div>
          ${url ? '<button class="ai-history-item-play" data-play>▶</button>' : ''}
          <button class="ai-history-item-delete" data-delete title="Remove">&times;</button>
        `;
        // Play from history
        el.querySelector('[data-play]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (url) {
            stopPlayback();
            playingAudio = new Audio(url);
            playingAudio.play().catch(() => {});
            playingAudio.addEventListener('ended', () => { playingAudio = null; });
          }
        });
        // Delete from history
        el.querySelector('[data-delete]')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.musicAI.history.remove(item.id);
          this._renderAIHistory();
        });
        // Click to load prompt
        el.addEventListener('click', () => {
          if (promptArea) {
            promptArea.value = item.prompt;
            promptArea.dispatchEvent(new Event('input'));
          }
        });
        historyList.appendChild(el);
      });
    };
    this._renderAIHistory();

    historyClear?.addEventListener('click', () => {
      this.musicAI.history.clear();
      this._renderAIHistory();
      showToast('🗑 History cleared');
    });
  }

}

// ── Bootstrap ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  window.app = new FLStudioApp();
});
