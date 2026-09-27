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
    this.aiProducer  = null;

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
    this._bindProjectTitle();
    this._bindMasterKnobs();
    this._bindKeyboard();
    this._bindChannelContextMenu();
    this._bindBottomResize();
    this._initAIMusic();
    this._initAIProducer();
    this._initBackendIntegration();

    // Sequencer callbacks
    this.sequencer.onStep = step => this._onStep(step);
    this.sequencer.onStop = () => this._onStop();
    this.sequencer.onPatternChange = () => this._refreshChannelRack();

    // Init position display
    this._updatePositionDisplay(0);

    showToast('🎵 BeYou Studio loaded — Press Space to play!', 3000);
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

    // Label (click → open piano roll for synth, or preview for audio)
    const label = document.createElement('div');
    label.className = 'channel-label';
    label.textContent = ch.name;
    label.title = ch.type === 'audio' ? 'Recorded Audio Track (Click to audition)' : 'Click to edit in Piano Roll';
    label.style.color = ch.color;

    if (ch.type === 'audio') {
      const audioBadge = document.createElement('span');
      audioBadge.className = 'channel-audio-badge';
      audioBadge.textContent = 'VOCAL';
      label.appendChild(audioBadge);

      const previewBtn = document.createElement('button');
      previewBtn.className = 'ch-preview-btn';
      previewBtn.textContent = '▶';
      previewBtn.title = 'Audition recorded voice take';
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ch.audioBuffer) {
          try {
            const src = this.audioEngine.ctx.createBufferSource();
            src.buffer = ch.audioBuffer;
            src.connect(this.audioEngine.masterCompressor);
            src.start();
            showToast(`▶ Playing ${ch.name}`);
          } catch(err) {
            console.error(err);
          }
        }
      });
      label.appendChild(previewBtn);
    }

    label.addEventListener('click', () => {
      if (ch.type === 'audio' && ch.audioBuffer) {
        try {
          const src = this.audioEngine.ctx.createBufferSource();
          src.buffer = ch.audioBuffer;
          src.connect(this.audioEngine.masterCompressor);
          src.start();
        } catch(err){}
      } else {
        this._selectPianoRollChannel(ci);
        this._switchTab('piano-roll');
      }
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
      // If voice recording is in progress, stop and insert take
      if (this.recorder && this.recorder.isRecording) {
        this._stopVoiceRecording();
      }
      // Clear step highlights
      document.querySelectorAll('.step-btn.playing').forEach(b => b.classList.remove('playing'));
      if (this.pianoRoll) { this.pianoRoll.playhead = 0; this.pianoRoll.render(); }
      if (this.playlist)  { this.playlist.updatePlayhead(0); }
      this._updatePositionDisplay(0);
      setTimeout(() => stopBtn.classList.remove('active'), 200);
    });

    recordBtn.addEventListener('click', () => {
      this._toggleVoiceRecording();
    });

    // Floating recording HUD stop button
    document.getElementById('btn-hud-stop-rec')?.addEventListener('click', () => {
      this._stopVoiceRecording();
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

    // ── ARM button ──
    document.getElementById('btn-arm').addEventListener('click', async () => {
      await this._ensureRecordingEngines();
      if (!this.recorder.isArmed) {
        const ok = await this.recorder.requestMic();
        if (ok) {
          document.getElementById('btn-arm').classList.add('armed');
          document.getElementById('btn-rec').disabled = false;
          this._startMicLevelMeter();
          showToast('🎙️ Microphone armed! Click Record to start singing/speaking.');
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
    document.getElementById('btn-rec').addEventListener('click', () => {
      this._toggleVoiceRecording();
    });

    // ── STOP button ──
    document.getElementById('btn-rec-stop').addEventListener('click', () => {
      this._stopVoiceRecording();
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
          <button class="clip-btn add-to-rack-btn" data-clip-id="${clip.id}" style="color:#00d4aa;font-weight:600;">➕ Add to Rack</button>
          <button class="clip-btn add-to-pl-btn" data-clip-id="${clip.id}" style="color:#38bdf8;font-weight:600;">➕ Playlist</button>
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

      // Add to Rack / Playlist buttons
      card.querySelector('.add-to-rack-btn')?.addEventListener('click', () => {
        this._addVocalClipToProject(clip);
      });
      card.querySelector('.add-to-pl-btn')?.addEventListener('click', () => {
        this._addVocalClipToProject(clip);
        this._switchTab('playlist');
      });

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

    // ── Audio Generator Provider Setup ──
    const audioTabs       = keyPanel?.querySelectorAll('.ai-audio-tab') || [];
    const audioContents   = keyPanel?.querySelectorAll('.ai-audio-content') || [];
    const localUrlInput   = document.getElementById('ai-music-local-url');
    const localTestBtn    = document.getElementById('ai-music-local-test');
    const localSaveBtn    = document.getElementById('ai-music-local-save');
    const audioFeedback   = document.getElementById('ai-music-status-feedback');

    const showAudioFeedback = (msg, type = 'info') => {
      if (!audioFeedback) return;
      audioFeedback.textContent = msg;
      audioFeedback.className = `ai-status-feedback ${type}`;
      audioFeedback.classList.remove('hidden');
    };

    const updateAudioKeyUI = () => {
      const provider = this.musicAI.getProvider();
      const has = this.musicAI.hasApiKey();

      if (keyStatus) {
        if (provider === 'local') keyStatus.textContent = 'Local Server';
        else keyStatus.textContent = has ? 'HF Connected' : 'No Key';
      }

      if (keyToggle) {
        keyToggle.classList.toggle('has-key', has);
      }
      if (genBtn) genBtn.disabled = !has;

      audioTabs.forEach(t => t.classList.toggle('active', t.dataset.audioProvider === provider));
      audioContents.forEach(c => c.classList.toggle('active', c.id === `ai-audio-tab-${provider}`));

      if (localUrlInput) localUrlInput.value = this.musicAI.localAudio.baseUrl;
      if (keyInput) keyInput.value = this.musicAI.getApiKey();
    };

    updateAudioKeyUI();

    audioTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const p = tab.dataset.audioProvider;
        this.musicAI.setProvider(p);
        updateAudioKeyUI();
        if (audioFeedback) audioFeedback.classList.add('hidden');
      });
    });

    localTestBtn?.addEventListener('click', async () => {
      showAudioFeedback('Testing connection to local music server...', 'loading');
      const url = localUrlInput?.value.trim() || 'http://localhost:8000';
      this.musicAI.localAudio.setUrl(url);
      const res = await this.musicAI.localAudio.testConnection();
      showAudioFeedback(res.message, res.ok ? 'success' : 'error');
    });

    localSaveBtn?.addEventListener('click', () => {
      const url = localUrlInput?.value.trim() || 'http://localhost:8000';
      this.musicAI.localAudio.setUrl(url);
      this.musicAI.setProvider('local');
      updateAudioKeyUI();
      keyPanel?.classList.add('hidden');
      showToast('💻 Local music server selected');
    });

    keyToggle?.addEventListener('click', () => {
      keyPanel?.classList.toggle('hidden');
    });

    keySave?.addEventListener('click', () => {
      const key = keyInput?.value.trim();
      if (key) {
        this.musicAI.setApiKey(key);
        this.musicAI.setProvider('hf');
        updateAudioKeyUI();
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

  // ── AI Producer (LLM Chat) ───────────────────────────────────────────────
  _initAIProducer() {
    if (typeof AIProducer === 'undefined') return;
    this.aiProducer = new AIProducer();

    // Refs
    const keyToggle   = document.getElementById('ai-producer-key-toggle');
    const keyPanel    = document.getElementById('ai-producer-key-panel');
    const keyInput    = document.getElementById('ai-producer-key-input');
    const keySave     = document.getElementById('ai-producer-key-save');
    const keyStatus   = document.getElementById('ai-producer-key-status');
    const undoBtn     = document.getElementById('ai-producer-undo');
    const clearBtn    = document.getElementById('ai-producer-clear-chat');
    const actionsEl   = document.getElementById('ai-producer-actions');
    const genresEl    = document.getElementById('ai-producer-genres');
    const moodsEl     = document.getElementById('ai-producer-moods');
    const statusEl    = document.getElementById('ai-producer-status');
    const statusText  = statusEl?.querySelector('.aip-status-text');
    const messagesEl  = document.getElementById('ai-producer-messages');
    const typingEl    = document.getElementById('ai-producer-typing');
    const inputEl     = document.getElementById('ai-producer-input');
    const sendBtn     = document.getElementById('ai-producer-send');

    // ── Multi-Provider Settings ──
    const providerBadge    = document.getElementById('ai-producer-provider-badge');
    const feedbackBanner   = document.getElementById('ai-producer-status-feedback');
    const providerTabs     = keyPanel?.querySelectorAll('.ai-provider-tab') || [];
    const providerContents = keyPanel?.querySelectorAll('.ai-provider-content') || [];

    // Ollama controls
    const ollamaUrlInput   = document.getElementById('ai-ollama-url');
    const ollamaModelInput = document.getElementById('ai-ollama-model');
    const ollamaModelSelect= document.getElementById('ai-ollama-model-select');
    const ollamaScanBtn    = document.getElementById('ai-ollama-scan-btn');
    const ollamaTestBtn    = document.getElementById('ai-ollama-test-btn');
    const ollamaSaveBtn    = document.getElementById('ai-ollama-save-btn');
    const ollamaChips      = keyPanel?.querySelectorAll('#ai-tab-ollama .ai-chip-btn') || [];

    // Local OpenAI controls
    const localOAUrlInput   = document.getElementById('ai-local-openai-url');
    const localOAModelInput = document.getElementById('ai-local-openai-model');
    const localOATestBtn    = document.getElementById('ai-local-openai-test-btn');
    const localOASaveBtn    = document.getElementById('ai-local-openai-save-btn');

    // Gemini controls
    const geminiTestBtn    = document.getElementById('ai-gemini-test-btn');

    const showFeedback = (msg, type = 'info') => {
      if (!feedbackBanner) return;
      feedbackBanner.textContent = msg;
      feedbackBanner.className = `ai-status-feedback ${type}`;
      feedbackBanner.classList.remove('hidden');
    };

    const updateKeyUI = () => {
      const provider = this.aiProducer.getProvider();
      const has = this.aiProducer.hasActiveConnection();

      if (providerBadge) {
        if (provider === 'beyou') providerBadge.textContent = 'BeYou AI';
        else if (provider === 'ollama') providerBadge.textContent = 'Ollama';
        else if (provider === 'local-openai') providerBadge.textContent = 'Local LM';
        else providerBadge.textContent = 'Gemini';
      }

      if (keyStatus) {
        keyStatus.textContent = this.aiProducer.getActiveDisplayName();
      }

      if (keyToggle) {
        keyToggle.classList.toggle('has-key', has);
      }
      if (sendBtn) {
        sendBtn.disabled = false;  // BeYou AI is always available
      }

      // Sync active tab
      providerTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.provider === provider);
      });
      providerContents.forEach(content => {
        content.classList.toggle('active', content.id === `ai-tab-${provider}`);
      });

      // Populate current values
      if (ollamaUrlInput) ollamaUrlInput.value = this.aiProducer.ollama.baseUrl;
      if (ollamaModelInput) ollamaModelInput.value = this.aiProducer.ollama.model;
      if (localOAUrlInput) localOAUrlInput.value = this.aiProducer.localOpenAI.baseUrl;
      if (localOAModelInput) localOAModelInput.value = this.aiProducer.localOpenAI.model;
      if (keyInput) keyInput.value = this.aiProducer.getApiKey();

      // Highlight active model chip
      ollamaChips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.model === this.aiProducer.ollama.model);
      });
    };

    updateKeyUI();

    // Tab switcher
    providerTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const p = tab.dataset.provider;
        this.aiProducer.setProvider(p);
        updateKeyUI();
        if (feedbackBanner) feedbackBanner.classList.add('hidden');
      });
    });

    // Model quick chips
    ollamaChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const m = chip.dataset.model;
        if (ollamaModelInput) ollamaModelInput.value = m;
        this.aiProducer.ollama.setConfig(undefined, m);
        updateKeyUI();
      });
    });

    // Ollama scan models
    ollamaScanBtn?.addEventListener('click', async () => {
      showFeedback('Scanning local Ollama models...', 'loading');
      try {
        const url = ollamaUrlInput?.value.trim() || 'http://localhost:11434';
        this.aiProducer.ollama.setConfig(url, undefined);
        const models = await this.aiProducer.ollama.fetchModels();
        if (models.length === 0) {
          showFeedback('Ollama connected, but no models found. Run "ollama pull chatmusician" in your terminal.', 'info');
        } else {
          if (ollamaModelSelect) {
            ollamaModelSelect.innerHTML = '<option value="">Select installed model...</option>' +
              models.map(m => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`).join('');
            ollamaModelSelect.classList.remove('hidden');
          }
          showFeedback(`✓ Found ${models.length} installed model(s): ${models.slice(0, 4).join(', ')}${models.length > 4 ? '...' : ''}`, 'success');
        }
      } catch (err) {
        showFeedback(`✗ ${err.message}`, 'error');
      }
    });

    // Ollama select model
    ollamaModelSelect?.addEventListener('change', () => {
      const val = ollamaModelSelect.value;
      if (val && ollamaModelInput) {
        ollamaModelInput.value = val;
        this.aiProducer.ollama.setConfig(undefined, val);
        updateKeyUI();
      }
    });

    // Ollama test ping
    ollamaTestBtn?.addEventListener('click', async () => {
      showFeedback('Pinging Ollama server...', 'loading');
      const url = ollamaUrlInput?.value.trim() || 'http://localhost:11434';
      const model = ollamaModelInput?.value.trim() || 'chatmusician';
      this.aiProducer.ollama.setConfig(url, model);
      const res = await this.aiProducer.ollama.testConnection();
      showFeedback(res.message, res.ok ? 'success' : 'error');
    });

    // Ollama save
    ollamaSaveBtn?.addEventListener('click', async () => {
      const url = ollamaUrlInput?.value.trim() || 'http://localhost:11434';
      const model = ollamaModelInput?.value.trim() || 'chatmusician';
      this.aiProducer.ollama.setConfig(url, model);
      this.aiProducer.setProvider('ollama');
      updateKeyUI();
      showToast(`🦙 Ollama active: ${model}`);
      keyPanel?.classList.add('hidden');
    });

    // Local OpenAI test ping
    localOATestBtn?.addEventListener('click', async () => {
      showFeedback('Pinging Local OpenAI server...', 'loading');
      const url = localOAUrlInput?.value.trim() || 'http://localhost:1234/v1';
      const model = localOAModelInput?.value.trim() || 'local-model';
      this.aiProducer.localOpenAI.setConfig(url, model);
      const res = await this.aiProducer.localOpenAI.testConnection();
      showFeedback(res.message, res.ok ? 'success' : 'error');
    });

    // Local OpenAI save
    localOASaveBtn?.addEventListener('click', () => {
      const url = localOAUrlInput?.value.trim() || 'http://localhost:1234/v1';
      const model = localOAModelInput?.value.trim() || 'local-model';
      this.aiProducer.localOpenAI.setConfig(url, model);
      this.aiProducer.setProvider('local-openai');
      updateKeyUI();
      showToast(`🖥️ Local LLM active: ${model}`);
      keyPanel?.classList.add('hidden');
    });

    // Gemini test ping
    geminiTestBtn?.addEventListener('click', async () => {
      const key = keyInput?.value.trim();
      if (!key) {
        showFeedback('Please enter a Gemini API key first.', 'error');
        return;
      }
      showFeedback('Testing Gemini API key...', 'loading');
      this.aiProducer.setApiKey(key);
      const res = await this.aiProducer.gemini.testConnection();
      showFeedback(res.message, res.ok ? 'success' : 'error');
    });

    // Gemini save
    keySave?.addEventListener('click', () => {
      const key = keyInput?.value.trim();
      if (key) {
        this.aiProducer.setApiKey(key);
        this.aiProducer.setProvider('gemini');
        updateKeyUI();
        keyPanel?.classList.add('hidden');
        showToast('🔑 Gemini API key saved!');
      }
    });

    keyToggle?.addEventListener('click', () => keyPanel?.classList.toggle('hidden'));

    // ── Undo ──
    const updateUndoBtn = () => {
      if (undoBtn) undoBtn.disabled = !this.aiProducer.canUndo();
    };
    undoBtn?.addEventListener('click', () => {
      const ok = this.aiProducer.undo(this.sequencer, this.audioEngine);
      if (ok) {
        this._refreshChannelRack();
        if (this.mixer) this.mixer.render();
        document.getElementById('bpm-display').value = this.sequencer.bpm;
        showToast('↩ Reverted to previous state');
        addAIMsg('ai', 'Reverted to the previous state. Your pattern is restored.', {});
      }
      updateUndoBtn();
    });

    // ── Clear chat ──
    clearBtn?.addEventListener('click', () => {
      this.aiProducer.clearConversation();
      if (messagesEl) {
        messagesEl.innerHTML = `
          <div class="aip-welcome-msg">
            <div class="aip-welcome-icon">🤖</div>
            <div class="aip-welcome-title">AI Producer</div>
            <div class="aip-welcome-sub">Describe the beat you want, or use a quick action. I'll create patterns, arrange, and mix-master for you.</div>
          </div>`;
      }
      updateUndoBtn();
      showToast('🗑 Conversation cleared');
    });

    // ── Populate Quick Actions ──
    if (actionsEl && typeof AI_PRODUCER_ACTIONS !== 'undefined') {
      AI_PRODUCER_ACTIONS.forEach(action => {
        const card = document.createElement('div');
        card.className = 'aip-action-card';
        card.dataset.action = action.id;
        card.innerHTML = `
          <div class="aip-action-icon">${action.icon}</div>
          <div class="aip-action-info">
            <div class="aip-action-label">${action.label}</div>
            <div class="aip-action-desc">${action.desc}</div>
          </div>`;
        card.addEventListener('click', () => executeQuickAction(action.id, card));
        actionsEl.appendChild(card);
      });
    }

    // ── Populate Genre chips ──
    if (genresEl && typeof AI_PRODUCER_GENRES !== 'undefined') {
      AI_PRODUCER_GENRES.forEach(genre => {
        const chip = document.createElement('button');
        chip.className = 'aip-tag-chip genre';
        chip.textContent = genre;
        chip.addEventListener('click', () => {
          chip.classList.toggle('selected');
          const idx = this.aiProducer.selectedGenres.indexOf(genre);
          if (idx >= 0) this.aiProducer.selectedGenres.splice(idx, 1);
          else this.aiProducer.selectedGenres.push(genre);
        });
        genresEl.appendChild(chip);
      });
    }

    // ── Populate Mood chips ──
    if (moodsEl && typeof AI_PRODUCER_MOODS !== 'undefined') {
      AI_PRODUCER_MOODS.forEach(mood => {
        const chip = document.createElement('button');
        chip.className = 'aip-tag-chip mood';
        chip.textContent = mood;
        chip.addEventListener('click', () => {
          chip.classList.toggle('selected');
          const idx = this.aiProducer.selectedMoods.indexOf(mood);
          if (idx >= 0) this.aiProducer.selectedMoods.splice(idx, 1);
          else this.aiProducer.selectedMoods.push(mood);
        });
        moodsEl.appendChild(chip);
      });
    }

    // ── Chat message rendering ──
    const addAIMsg = (role, text, result) => {
      // Remove welcome message if present
      const welcome = messagesEl?.querySelector('.aip-welcome-msg');
      if (welcome) welcome.remove();

      const el = document.createElement('div');
      el.className = `aip-msg ${role}`;

      if (role === 'user') {
        el.innerHTML = `
          <div class="aip-msg-avatar">👤</div>
          <div class="aip-msg-body">
            <div class="aip-msg-text">${escapeHTML(text)}</div>
          </div>`;
      } else {
        // AI message with badges and suggestions
        let badges = '';
        if (result?.hasBeat) badges += '<span class="aip-msg-badge beat">🥁 Beat Applied</span>';
        if (result?.hasMix)  badges += '<span class="aip-msg-badge mix">🎚️ Mix Applied</span>';
        if (result?.bpm)     badges += `<span class="aip-msg-badge bpm">♩ ${result.bpm} BPM</span>`;

        let suggestionsHTML = '';
        if (result?.suggestions?.length > 0) {
          suggestionsHTML = '<div class="aip-suggestions">' +
            result.suggestions.map(s => `<button class="aip-suggestion-chip">${escapeHTML(s)}</button>`).join('') +
            '</div>';
        }

        el.innerHTML = `
          <div class="aip-msg-avatar">🤖</div>
          <div class="aip-msg-body">
            <div class="aip-msg-text">${escapeHTML(text)}</div>
            ${badges ? '<div class="aip-msg-actions">' + badges + '</div>' : ''}
            ${suggestionsHTML}
          </div>`;

        // Bind suggestion chips
        el.querySelectorAll('.aip-suggestion-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            if (inputEl) {
              inputEl.value = chip.textContent;
              sendMessage();
            }
          });
        });
      }

      messagesEl?.appendChild(el);
      // Auto-scroll to bottom
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    // ── Escape HTML ──
    const escapeHTML = (str) => {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    };

    // ── Send message ──
    const sendMessage = async () => {
      const text = inputEl?.value.trim();
      if (!text || this.aiProducer.isProcessing) return;

      // Show user message
      addAIMsg('user', text, {});
      if (inputEl) inputEl.value = '';

      // Show typing
      typingEl?.classList.remove('hidden');
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        if (!this.audioEngine.initialized) this.audioEngine.init();
        const result = await this.aiProducer.produce(text, this.sequencer, this.audioEngine, {
          onStatus: (status) => {
            const msgs = {
              thinking:   '🧠 AI is thinking...',
              composing:  '🎵 BeYou AI is composing...',
              generating: '🎶 Generating your beat...',
              done:       '✅ Done!',
              error:      '❌ Error',
              cancelled:  'Cancelled',
            };
            const labelEl = typingEl?.querySelector('.aip-typing-label');
            if (labelEl) labelEl.textContent = msgs[status] || '⚙️ Processing...';
          },
        });

        typingEl?.classList.add('hidden');
        addAIMsg('ai', result.message, result);

        // Refresh DAW UI
        if (result.hasBeat) {
          this._refreshChannelRack();
          document.getElementById('bpm-display').value = this.sequencer.bpm;
        }
        if (result.hasMix && this.mixer) {
          this.mixer.render();
        }
        updateUndoBtn();

      } catch (err) {
        typingEl?.classList.add('hidden');
        addAIMsg('ai', `Error: ${err.message}`, {});
      }
    };

    // ── Quick action executor ──
    const executeQuickAction = async (actionId, card) => {
      if (this.aiProducer.isProcessing) return;

      if (!this.audioEngine.initialized) this.audioEngine.init();

      card?.classList.add('processing');
      typingEl?.classList.remove('hidden');

      // Show action as user message
      const actionLabel = AI_PRODUCER_ACTIONS.find(a => a.id === actionId)?.label || actionId;
      addAIMsg('user', `⚡ ${actionLabel}`, {});

      try {
        let result;
        switch (actionId) {
          case 'full':      result = await this.aiProducer.fullProduction(this.sequencer, this.audioEngine, { onStatus: () => {} }); break;
          case 'beat':      result = await this.aiProducer.generateBeat(this.sequencer, this.audioEngine, { onStatus: () => {} }); break;
          case 'mix':       result = await this.aiProducer.mixAndMaster(this.sequencer, this.audioEngine, { onStatus: () => {} }); break;
          case 'variation':  result = await this.aiProducer.addVariation(this.sequencer, this.audioEngine, { onStatus: () => {} }); break;
          case 'random':    result = await this.aiProducer.surpriseMe(this.sequencer, this.audioEngine, { onStatus: () => {} }); break;
          default:          result = await this.aiProducer.produce(actionId, this.sequencer, this.audioEngine, { onStatus: () => {} });
        }

        typingEl?.classList.add('hidden');
        addAIMsg('ai', result.message, result);

        if (result.hasBeat) {
          this._refreshChannelRack();
          document.getElementById('bpm-display').value = this.sequencer.bpm;
        }
        if (result.hasMix && this.mixer) {
          this.mixer.render();
        }
        updateUndoBtn();

      } catch (err) {
        typingEl?.classList.add('hidden');
        addAIMsg('ai', `Error: ${err.message}`, {});
      } finally {
        card?.classList.remove('processing');
      }
    };

    // ── Input bindings ──
    sendBtn?.addEventListener('click', sendMessage);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    inputEl?.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
    });
  }

  // ── Vocal & Voice Recording Engine ────────────────────────────────
  async _ensureRecordingEngines() {
    if (this.recorder) return this.recorder;
    if (!this.audioEngine.initialized) this.audioEngine.init();
    if (!this.autoTune) {
      this.autoTune = new AutoTuneEngine(this.audioEngine.ctx);
    }
    this.recorder = new RecorderEngine(this.audioEngine, this.autoTune);

    this.recorder.onStateChange = state => this._updateRecState(state);
    this.recorder.onClipAdded = clip => {
      this._renderClipList();
      this._addVocalClipToProject(clip);
    };
    this.recorder.onPitchUpdate = () => this._updatePitchUI();
    return this.recorder;
  }

  async _toggleVoiceRecording() {
    await this._ensureRecordingEngines();
    if (!this.recorder.isRecording) {
      await this._startVoiceRecording();
    } else {
      this._stopVoiceRecording();
    }
  }

  async _startVoiceRecording() {
    await this._ensureRecordingEngines();
    if (!this.recorder.isArmed) {
      showToast('🎙️ Requesting microphone access...');
      const ok = await this.recorder.requestMic();
      if (!ok) {
        showToast('❌ Microphone permission denied');
        return;
      }
      document.getElementById('btn-arm')?.classList.add('armed');
      document.getElementById('btn-rec')?.removeAttribute('disabled');
      this._startMicLevelMeter();
    }

    if (this.recorder.isRecording) return;
    await this.recorder.startRecording();

    this.isRecording = true;
    document.getElementById('btn-record')?.classList.add('active');
    document.getElementById('btn-rec')?.classList.add('recording');
    document.getElementById('btn-rec-stop')?.classList.add('visible');
    document.querySelector('.right-tab.record-tab')?.classList.add('is-recording');

    // Show floating top HUD
    const hud = document.getElementById('top-rec-hud');
    const hudTimer = document.getElementById('rec-hud-timer');
    const recTimeTab = document.getElementById('rec-time-display');
    hud?.classList.remove('hidden');

    const startMs = Date.now();
    clearInterval(this._recTimerInterval);
    this._recTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      const str = `${m}:${String(s).padStart(2, '0')}`;
      if (hudTimer) hudTimer.textContent = str;
      if (recTimeTab) { recTimeTab.textContent = str; recTimeTab.classList.add('recording'); }
    }, 250);

    showToast('🔴 Recording voice... Click Record or Stop when done!');
  }

  _stopVoiceRecording() {
    if (!this.recorder || !this.recorder.isRecording) return;
    this.recorder.stopRecording();
    this.isRecording = false;

    document.getElementById('btn-record')?.classList.remove('active');
    document.getElementById('btn-rec')?.classList.remove('recording');
    document.getElementById('btn-rec-stop')?.classList.remove('visible');
    document.querySelector('.right-tab.record-tab')?.classList.remove('is-recording');
    document.getElementById('top-rec-hud')?.classList.add('hidden');

    clearInterval(this._recTimerInterval);
    const el = document.getElementById('rec-time-display');
    if (el) { el.textContent = '0:00'; el.classList.remove('recording'); }
  }

  _addVocalClipToProject(clip) {
    if (!clip) return;
    const buf = clip.processedBuffer || clip.rawBuffer;
    if (!buf) return;

    // Check if channel already exists
    const existing = this.sequencer.channels.find(ch => ch.clipId === clip.id);
    if (existing) {
      existing.audioBuffer = buf;
      this._buildChannelRack();
      return;
    }

    const steps = Array(16).fill(false);
    steps[0] = true; // Play on step 1

    const newChannel = {
      name: `🎤 ${clip.name}`,
      color: '#00d4aa',
      type: 'audio',
      audioBuffer: buf,
      clipId: clip.id,
      duration: clip.duration,
      steps: steps,
      velocity: Array(16).fill(0.95),
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      notes: []
    };

    this.sequencer.channels.push(newChannel);
    this._buildChannelRack();

    if (this.playlist) {
      this.playlist.syncWithChannels();
    }

    showToast(`🎙️ Recorded voice ("${clip.name}") added to Channel Rack & Playlist!`, 4000);
  }

  // ── Project Name Binding ──────────────────────────────────────────
  _bindProjectTitle() {
    const titlebarInput = document.getElementById('project-title-input');
    const tbInput = document.getElementById('tb-project-title-input');
    const saveTitleInput = document.getElementById('save-project-title');

    const updateTitle = (val) => {
      const cleanVal = val.trim() || 'Untitled Project';
      this.currentProjectTitle = cleanVal;
      document.title = `${cleanVal} — BeYou Studio`;
      if (titlebarInput && titlebarInput.value !== cleanVal) titlebarInput.value = cleanVal;
      if (tbInput && tbInput.value !== cleanVal) tbInput.value = cleanVal;
      if (saveTitleInput) saveTitleInput.value = cleanVal;
    };

    titlebarInput?.addEventListener('input', (e) => updateTitle(e.target.value));
    tbInput?.addEventListener('input', (e) => updateTitle(e.target.value));

    titlebarInput?.addEventListener('change', (e) => {
      updateTitle(e.target.value);
      showToast(`📝 Project renamed: "${this.currentProjectTitle}"`);
    });
    tbInput?.addEventListener('change', (e) => {
      updateTitle(e.target.value);
      showToast(`📝 Project renamed: "${this.currentProjectTitle}"`);
    });
  }

  // ── Project State Serialization ──────────────────────────────────
  serializeState() {
    return {
      title: this.currentProjectTitle || 'Untitled Project',
      bpm: this.sequencer.bpm,
      patternName: this.sequencer.patternName,
      steps: this.sequencer.steps,
      channels: this.sequencer.channels.map(ch => ({
        name: ch.name,
        color: ch.color,
        type: ch.type,
        steps: [...ch.steps],
        velocity: [...ch.velocity],
        volume: ch.volume,
        pan: ch.pan,
        muted: !!ch.muted,
        solo: !!ch.solo,
        notes: ch.notes ? JSON.parse(JSON.stringify(ch.notes)) : [],
        filterFreq: ch.filterFreq || 2000,
        filterRes: ch.filterRes || 1
      })),
      playlist: this.playlist ? {
        tracks: this.playlist.tracks.map(t => ({
          name: t.name,
          color: t.color,
          blocks: t.blocks ? JSON.parse(JSON.stringify(t.blocks)) : []
        }))
      } : null,
      savedAt: new Date().toISOString()
    };
  }

  loadState(state) {
    if (!state) return;
    if (typeof state === 'string') {
      try {
        state = JSON.parse(state);
      } catch (e) {
        console.error('Failed to parse project JSON:', e);
        showToast('❌ Invalid project state file');
        return;
      }
    }

    if (state.title) {
      this.currentProjectTitle = state.title;
      document.title = `${state.title} — BeYou Studio`;
      const titleInput = document.getElementById('project-title-input');
      const tbInput = document.getElementById('tb-project-title-input');
      const saveTitleInput = document.getElementById('save-project-title');
      if (titleInput) titleInput.value = state.title;
      if (tbInput) tbInput.value = state.title;
      if (saveTitleInput) saveTitleInput.value = state.title;
    }

    if (state.bpm) {
      this.sequencer.bpm = state.bpm;
      const bpmEl = document.getElementById('bpm-display');
      if (bpmEl) bpmEl.value = state.bpm;
    }

    if (state.channels && Array.isArray(state.channels)) {
      this.sequencer.channels = state.channels.map(ch => ({
        name: ch.name,
        color: ch.color,
        type: ch.type || 'drum',
        steps: ch.steps || Array(16).fill(false),
        velocity: ch.velocity || Array(16).fill(0.8),
        volume: ch.volume !== undefined ? ch.volume : 1,
        pan: ch.pan !== undefined ? ch.pan : 0,
        muted: !!ch.muted,
        solo: !!ch.solo,
        notes: ch.notes || [],
        filterFreq: ch.filterFreq || 2000,
        filterRes: ch.filterRes || 1
      }));
      this._buildChannelRack();
      if (this.pianoRoll) {
        this.pianoRoll.render();
      }
    }

    if (state.playlist && state.playlist.tracks && this.playlist) {
      this.playlist.tracks = state.playlist.tracks;
      this.playlist.render();
    }

    if (this.mixer) {
      this.mixer.render();
    }

    showToast(`✨ Loaded project: "${this.currentProjectTitle || 'Project'}"`, 3000);
  }

  // ── Backend API & Admin Integration ──────────────────────────────
  _updateUserUI(user) {
    const nameEl = document.getElementById('user-name-display');
    const roleEl = document.getElementById('user-role-tag');
    const adminBtn = document.getElementById('btn-admin-dash');

    if (user) {
      if (nameEl) nameEl.textContent = user.full_name || user.username;
      if (roleEl) {
        roleEl.textContent = user.role.toUpperCase();
        roleEl.className = `role-badge ${user.role === 'admin' ? 'admin' : 'user'}`;
      }
      if (adminBtn) {
        if (user.role === 'admin') {
          adminBtn.classList.remove('hidden');
        } else {
          adminBtn.classList.add('hidden');
        }
      }
    } else {
      if (nameEl) nameEl.textContent = 'Guest';
      if (roleEl) {
        roleEl.textContent = 'OFFLINE';
        roleEl.className = 'role-badge user';
      }
      if (adminBtn) adminBtn.classList.add('hidden');
    }
  }

  _initBackendIntegration() {
    if (!window.backendAPI) return;

    this.currentProjectId = null;
    this.currentProjectTitle = 'Untitled Project';

    // Auto-login session init
    backendAPI.initSession().then(user => {
      this._updateUserUI(user);
      if (user) {
        showToast(`👑 Welcome back, ${user.full_name}! (Role: ${user.role})`, 3500);
      }
    });

    // Wire Modal Close Handlers
    document.querySelectorAll('.fl-modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.close;
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
      });
    });

    // ── Save Project Modal ──
    const saveBtn = document.getElementById('btn-cloud-save');
    const saveModal = document.getElementById('modal-save-project');
    const saveTitleInput = document.getElementById('save-project-title');
    const saveConfirmBtn = document.getElementById('btn-save-project-confirm');
    const savePreviewBpm = document.getElementById('save-preview-bpm');
    const savePreviewChannels = document.getElementById('save-preview-channels');

    saveBtn?.addEventListener('click', () => {
      if (!backendAPI.currentUser) {
        document.getElementById('modal-auth')?.classList.remove('hidden');
        showToast('⚠️ Please sign in to save projects to the database.');
        return;
      }
      if (saveTitleInput) saveTitleInput.value = this.currentProjectTitle || 'My Track';
      if (savePreviewBpm) savePreviewBpm.textContent = this.sequencer.bpm;
      if (savePreviewChannels) savePreviewChannels.textContent = this.sequencer.channels.length;
      saveModal?.classList.remove('hidden');
      saveTitleInput?.focus();
    });

    saveConfirmBtn?.addEventListener('click', async () => {
      const title = saveTitleInput?.value.trim() || 'Untitled Project';
      saveConfirmBtn.disabled = true;
      saveConfirmBtn.textContent = 'Saving...';
      try {
        const stateObj = this.serializeState();
        stateObj.title = title;
        const res = await backendAPI.saveProject(title, stateObj, this.sequencer.bpm, this.sequencer.channels.length);
        this.currentProjectId = res.id;
        this.currentProjectTitle = title;
        document.title = `${title} — BeYou Studio`;
        const titleInput = document.getElementById('project-title-input');
        const tbInput = document.getElementById('tb-project-title-input');
        if (titleInput) titleInput.value = title;
        if (tbInput) tbInput.value = title;
        saveModal?.classList.add('hidden');
        showToast(`💾 Saved project "${title}" to database!`, 3000);
      } catch (err) {
        showToast(`❌ Save error: ${err.message}`, 4000);
      } finally {
        saveConfirmBtn.disabled = false;
        saveConfirmBtn.textContent = 'Save to Cloud';
      }
    });

    // ── Open Cloud Projects Modal ──
    const openBtn = document.getElementById('btn-cloud-open');
    const openModal = document.getElementById('modal-cloud-projects');
    const projContainer = document.getElementById('cloud-proj-container');
    const searchInput = document.getElementById('cloud-proj-search');
    const modalNewSaveBtn = document.getElementById('btn-modal-new-save');

    modalNewSaveBtn?.addEventListener('click', () => {
      openModal?.classList.add('hidden');
      saveBtn?.click();
    });

    const loadProjectsList = async () => {
      if (!projContainer) return;
      projContainer.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:12px;">Loading projects...</div>';
      try {
        const projects = await backendAPI.listProjects();
        if (!projects || projects.length === 0) {
          projContainer.innerHTML = `
            <div style="text-align:center;padding:36px;color:var(--text-muted);font-size:12px;">
              No saved projects yet in database.<br>
              <button onclick="document.getElementById('btn-cloud-save').click(); document.getElementById('modal-cloud-projects').classList.add('hidden');" class="fl-btn-primary" style="margin-top:10px;font-size:11px;">💾 Save Current DAW State</button>
            </div>`;
          return;
        }

        const renderItems = (items) => {
          projContainer.innerHTML = items.map(p => `
            <div class="cloud-proj-card" data-proj-id="${p.id}">
              <div class="cloud-proj-info">
                <div class="cloud-proj-title">${p.title}</div>
                <div class="cloud-proj-meta">
                  <span>BPM: ${p.bpm}</span>
                  <span>Channels: ${p.channel_count}</span>
                  <span>Updated: ${new Date(p.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="fl-btn-primary btn-load-proj" data-proj-id="${p.id}" style="padding:4px 12px;font-size:11px;">Load</button>
                <button class="admin-act-btn danger btn-delete-proj" data-proj-id="${p.id}">🗑</button>
              </div>
            </div>
          `).join('');

          projContainer.querySelectorAll('.btn-load-proj').forEach(b => {
            b.addEventListener('click', async () => {
              const pid = b.dataset.projId;
              try {
                const data = await backendAPI.getProject(pid);
                this.loadState(data.state_json);
                this.currentProjectId = data.id;
                this.currentProjectTitle = data.title;
                openModal?.classList.add('hidden');
              } catch (e) {
                showToast(`❌ Failed to load project: ${e.message}`);
              }
            });
          });

          projContainer.querySelectorAll('.btn-delete-proj').forEach(b => {
            b.addEventListener('click', async (e) => {
              e.stopPropagation();
              const pid = b.dataset.projId;
              if (confirm('Delete this project from database?')) {
                try {
                  await backendAPI.deleteProject(pid);
                  showToast('🗑 Project deleted');
                  loadProjectsList();
                } catch (e) {
                  showToast(`❌ Delete failed: ${e.message}`);
                }
              }
            });
          });
        };

        renderItems(projects);

        searchInput?.addEventListener('input', () => {
          const q = searchInput.value.toLowerCase();
          const filtered = projects.filter(p => p.title.toLowerCase().includes(q));
          renderItems(filtered);
        });

      } catch (err) {
        projContainer.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px;">Failed to load: ${err.message}</div>`;
      }
    };

    openBtn?.addEventListener('click', () => {
      if (!backendAPI.currentUser) {
        document.getElementById('modal-auth')?.classList.remove('hidden');
        showToast('⚠️ Please sign in to access your saved projects.');
        return;
      }
      openModal?.classList.remove('hidden');
      loadProjectsList();
    });

    // ── Super Admin Dashboard ──
    const adminBtn = document.getElementById('btn-admin-dash');
    const adminModal = document.getElementById('modal-admin-dashboard');

    const loadAdminData = async () => {
      try {
        const stats = await backendAPI.getAdminStats();
        document.getElementById('adm-stat-users').textContent = stats.total_users;
        document.getElementById('adm-stat-projects').textContent = stats.total_projects;
        document.getElementById('adm-stat-sessions').textContent = stats.active_sessions;
        document.getElementById('adm-stat-db').textContent = stats.db_size_formatted;
        document.getElementById('adm-stat-engine').textContent = stats.audio_engine;
        document.getElementById('adm-stat-uptime').textContent = `${Math.floor(stats.uptime_seconds / 60)}m ${stats.uptime_seconds % 60}s`;

        // Load users table
        const users = await backendAPI.getAdminUsers();
        const usersTbody = document.getElementById('admin-users-tbody');
        if (usersTbody) {
          usersTbody.innerHTML = users.map(u => `
            <tr>
              <td>${u.id}</td>
              <td style="font-weight:600;color:#fff;">${u.username}</td>
              <td>${u.full_name || '—'}</td>
              <td><span class="role-badge ${u.role}">${u.role.toUpperCase()}</span></td>
              <td>${u.project_count || 0}</td>
              <td>${u.last_login ? new Date(u.last_login).toLocaleTimeString() : 'Never'}</td>
              <td>
                ${u.username === 'rahul' ? '<span style="font-size:10px;color:var(--accent);font-weight:700;">Super Admin</span>' : `
                  <button class="admin-act-btn btn-toggle-role" data-user-id="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">
                    ${u.role === 'admin' ? 'Demote' : 'Make Admin'}
                  </button>
                  <button class="admin-act-btn danger btn-adm-del-user" data-user-id="${u.id}">Delete</button>
                `}
              </td>
            </tr>
          `).join('');

          usersTbody.querySelectorAll('.btn-toggle-role').forEach(btn => {
            btn.addEventListener('click', async () => {
              const uid = btn.dataset.userId;
              const newRole = btn.dataset.role;
              try {
                await backendAPI.updateUserRole(uid, newRole);
                showToast(`Role updated to ${newRole}`);
                loadAdminData();
              } catch (e) {
                showToast(`Error: ${e.message}`);
              }
            });
          });

          usersTbody.querySelectorAll('.btn-adm-del-user').forEach(btn => {
            btn.addEventListener('click', async () => {
              const uid = btn.dataset.userId;
              if (confirm('Permanently delete this user and their projects?')) {
                try {
                  await backendAPI.deleteUser(uid);
                  showToast('User deleted');
                  loadAdminData();
                } catch (e) {
                  showToast(`Error: ${e.message}`);
                }
              }
            });
          });
        }

        // Load all projects table
        const allProjects = await backendAPI.listProjects(true);
        const projTbody = document.getElementById('admin-projects-tbody');
        if (projTbody) {
          projTbody.innerHTML = allProjects.map(p => `
            <tr>
              <td style="font-family:var(--font-mono);font-size:10px;">${p.id}</td>
              <td style="font-weight:600;color:#fff;">${p.title}</td>
              <td>${p.full_name || p.username || 'User #' + p.user_id}</td>
              <td>${p.bpm}</td>
              <td>${new Date(p.updated_at).toLocaleDateString()}</td>
              <td>
                <button class="admin-act-btn danger btn-adm-del-proj" data-proj-id="${p.id}">Delete</button>
              </td>
            </tr>
          `).join('');

          projTbody.querySelectorAll('.btn-adm-del-proj').forEach(btn => {
            btn.addEventListener('click', async () => {
              const pid = btn.dataset.projId;
              if (confirm('Delete this project as Admin?')) {
                try {
                  await backendAPI.deleteProject(pid);
                  showToast('Project deleted by admin');
                  loadAdminData();
                } catch (e) {
                  showToast(`Error: ${e.message}`);
                }
              }
            });
          });
        }

        // Load audit logs
        const logs = await backendAPI.getAdminLogs();
        const logsTbody = document.getElementById('admin-logs-tbody');
        if (logsTbody) {
          logsTbody.innerHTML = logs.map(l => `
            <tr>
              <td style="font-family:var(--font-mono);font-size:10px;">${new Date(l.timestamp).toLocaleTimeString()}</td>
              <td style="color:#a855f7;font-weight:600;">${l.username || 'System'}</td>
              <td><span style="font-family:var(--font-mono);font-size:10px;color:var(--accent);">${l.action}</span></td>
              <td style="color:var(--text-muted);font-size:10px;">${l.details || '—'}</td>
            </tr>
          `).join('');
        }

      } catch (err) {
        showToast(`Admin error: ${err.message}`);
      }
    };

    adminBtn?.addEventListener('click', () => {
      adminModal?.classList.remove('hidden');
      loadAdminData();
    });

    // Admin Tab Switching
    document.querySelectorAll('[data-admin-tab]').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const tabKey = tabBtn.dataset.adminTab;
        document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
        tabBtn.classList.add('active');
        document.getElementById(`admin-tab-${tabKey}`)?.classList.add('active');
      });
    });

    // Admin Add User Form
    const showAddUserBtn = document.getElementById('btn-admin-show-add-user');
    const addUserForm = document.getElementById('admin-add-user-form');
    const cancelAddUserBtn = document.getElementById('adm-cancel-add-user');
    const submitAddUserBtn = document.getElementById('adm-submit-add-user');

    showAddUserBtn?.addEventListener('click', () => {
      addUserForm?.classList.toggle('hidden');
    });
    cancelAddUserBtn?.addEventListener('click', () => {
      addUserForm?.classList.add('hidden');
    });
    submitAddUserBtn?.addEventListener('click', async () => {
      const username = document.getElementById('adm-new-username').value.trim();
      const email = document.getElementById('adm-new-email').value.trim();
      const password = document.getElementById('adm-new-password').value.trim();
      const fullName = document.getElementById('adm-new-fullname').value.trim();

      if (!username || !email || !password) {
        showToast('❌ Please fill in required fields');
        return;
      }

      try {
        await backendAPI.createAdminUser({
          username,
          email,
          password,
          full_name: fullName,
          role: 'user'
        });
        showToast(`✓ Created user: ${username}`);
        addUserForm?.classList.add('hidden');
        loadAdminData();
      } catch (e) {
        showToast(`Error: ${e.message}`);
      }
    });

    // ── Auth Modal & Account Switching ──
    const userBadge = document.getElementById('user-badge');
    const authModal = document.getElementById('modal-auth');
    const authTabLogin = document.getElementById('auth-tab-btn-login');
    const authTabReg = document.getElementById('auth-tab-btn-register');
    const authFormLogin = document.getElementById('auth-form-login');
    const authFormReg = document.getElementById('auth-form-register');
    const quickAdminBtn = document.getElementById('btn-quick-admin-login');
    const loginSubmitBtn = document.getElementById('btn-auth-login-submit');
    const regSubmitBtn = document.getElementById('btn-auth-register-submit');

    userBadge?.addEventListener('click', () => {
      authModal?.classList.remove('hidden');
    });

    authTabLogin?.addEventListener('click', () => {
      authTabLogin.classList.add('active');
      authTabReg.classList.remove('active');
      authFormLogin.classList.remove('hidden');
      authFormReg.classList.add('hidden');
    });

    authTabReg?.addEventListener('click', () => {
      authTabReg.classList.add('active');
      authTabLogin.classList.remove('active');
      authFormReg.classList.remove('hidden');
      authFormLogin.classList.add('hidden');
    });

    quickAdminBtn?.addEventListener('click', async () => {
      try {
        const user = await backendAPI.login('rahul', 'password123');
        this._updateUserUI(user);
        authModal?.classList.add('hidden');
        showToast(`👑 Signed in as Super Admin: ${backendAPI.escapeHtml(user.full_name)}!`, 3500);
      } catch (e) {
        showToast(`Login failed: ${backendAPI.escapeHtml(e.message)}`);
      }
    });

    loginSubmitBtn?.addEventListener('click', async () => {
      const user = document.getElementById('auth-login-user').value.trim();
      const pass = document.getElementById('auth-login-pass').value.trim();
      const hp = document.getElementById('auth-login-hp')?.value || null;
      if (!user || !pass) {
        showToast('Please enter username and password');
        return;
      }
      try {
        const loggedUser = await backendAPI.login(user, pass, hp);
        this._updateUserUI(loggedUser);
        authModal?.classList.add('hidden');
        showToast(`Welcome back, ${backendAPI.escapeHtml(loggedUser.full_name || loggedUser.username)}!`);
      } catch (e) {
        showToast(`Login failed: ${backendAPI.escapeHtml(e.message)}`);
      }
    });

    regSubmitBtn?.addEventListener('click', async () => {
      const u = document.getElementById('auth-reg-user').value.trim();
      const fn = document.getElementById('auth-reg-fullname').value.trim();
      const em = document.getElementById('auth-reg-email').value.trim();
      const pw = document.getElementById('auth-reg-pass').value.trim();
      const hp = document.getElementById('auth-reg-hp')?.value || null;
      if (!u || !em || !pw) {
        showToast('Please fill in required registration fields');
        return;
      }
      try {
        const newUser = await backendAPI.register(u, em, pw, fn, hp);
        this._updateUserUI(newUser);
        authModal?.classList.add('hidden');
        showToast(`Account created! Welcome, ${backendAPI.escapeHtml(newUser.full_name || newUser.username)}!`);
      } catch (e) {
        showToast(`Registration failed: ${backendAPI.escapeHtml(e.message)}`);
      }
    });
  }

}

// ── Bootstrap ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  window.app = new FLStudioApp();
});

