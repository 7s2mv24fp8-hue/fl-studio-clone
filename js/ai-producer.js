/**
 * BeYou Studio — AI Producer v3
 * Human-friendly chat with a real music producer feel.
 * Four clients: BeYou (built-in) | Gemini | Ollama | LM Studio
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const AI_PRODUCER_CHANNELS = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead'];

const AI_PRODUCER_GENRES = [
  'Hip-Hop', 'Trap', 'Drill', 'Lo-Fi', 'House', 'Techno', 'Drum & Bass', 'Reggaeton',
  'Afrobeats', 'Electronic', 'Jazz', 'R&B', 'Pop', 'Rock',
  'Synthwave', 'Ambient', 'Phonk', 'UK Garage',
];

const AI_PRODUCER_MOODS = [
  'Dark', 'Energetic', 'Chill', 'Aggressive', 'Dreamy', 'Groovy',
  'Melancholic', 'Uplifting', 'Minimal', 'Epic', 'Funky', 'Atmospheric',
];

const AI_PRODUCER_ACTIONS = [
  { id: 'full',      icon: '🚀', label: 'Full Production',  desc: 'Beat + Arrangement + Mix' },
  { id: 'beat',      icon: '🥁', label: 'Generate Beat',    desc: 'Create drum & melodic patterns' },
  { id: 'mix',       icon: '🎚️', label: 'Mix & Master',     desc: 'Auto-level, pan, balance' },
  { id: 'variation', icon: '🔄', label: 'Add Variation',    desc: 'Modify current pattern' },
  { id: 'random',    icon: '🎲', label: 'Surprise Me',      desc: 'Random genre & style' },
];

// Prompt starters shown in the chat welcome screen
const PROMPT_STARTERS = [
  { emoji: '🔥', text: 'Dark trap beat at 140 BPM' },
  { emoji: '😌', text: 'Chill lo-fi hip hop groove' },
  { emoji: '🎸', text: 'Hard rock with heavy toms' },
  { emoji: '🌆', text: 'Synthwave 80s retro vibes' },
  { emoji: '🕺', text: 'Funky house, four-on-the-floor' },
  { emoji: '💙', text: 'Emotional R&B at 75 BPM' },
];

const GEMINI_SYSTEM_PROMPT = `You are an expert music producer AI inside a DAW (Digital Audio Workstation).
The DAW has 8 channels (16 steps each): Kick, Clap, Hi-Hat Closed, Hi-Hat Open, Snare, Tom, Bass, Lead.
Steps: 0=off, 1=on. Velocity: 0.0-1.0.

Respond ONLY with valid JSON:
{
  "message": "Casual, friendly 1-2 sentence producer response",
  "beat": { "bpm": <60-200>, "channels": [{"name":"<name>","steps":[16 values],"velocity":[16 values]}] },
  "mix": { "master_volume": <0-1>, "channels": [{"name":"<name>","volume":<0-1>,"pan":<-1 to 1>,"muted":false}] },
  "suggestions": ["short actionable tip 1", "tip 2", "tip 3"]
}
Include "beat" only when generating beats. Include "mix" only when mixing. Always include "message" and "suggestions".
Keep message casual, like a real producer texting — no markdown bold or emoji spam.`;

// ─── JSON parsing helper ─────────────────────────────────────────────────────

function parseLLMJSON(text) {
  if (!text) throw new Error('Empty AI response');
  try { return JSON.parse(text); } catch (_) {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) { try { return JSON.parse(m[1].trim()); } catch (__) {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch (___) {} }
  throw new Error('Could not parse AI response');
}

// ─── 1. GEMINI CLIENT ────────────────────────────────────────────────────────

class GeminiClient {
  constructor() {
    this.apiKey = localStorage.getItem('beyou-gemini-key') || '';
    this.model  = 'gemini-2.0-flash';
    this.base   = 'https://generativelanguage.googleapis.com/v1beta/models';
    this._ctrl  = null;
  }
  setApiKey(k) { this.apiKey = k; localStorage.setItem('beyou-gemini-key', k); }
  hasKey() { return this.apiKey.length > 10; }

  async testConnection() {
    try {
      const r = await fetch(`${this.base}/${this.model}?key=${this.apiKey}`);
      if (!r.ok) { const e = await r.json().catch(() => ({})); return { ok: false, message: e.error?.message || `HTTP ${r.status}` }; }
      return { ok: true, message: '✅ Gemini is connected and ready!' };
    } catch (e) { return { ok: false, message: `Connection failed: ${e.message}` }; }
  }

  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._ctrl) this._ctrl.abort();
    this._ctrl = new AbortController();
    onStatus('thinking');
    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));
    try {
      const r = await fetch(`${this.base}/${this.model}:generateContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this._ctrl.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
        }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
      const d = await r.json();
      onStatus('done');
      this._ctrl = null;
      return parseLLMJSON(d.candidates?.[0]?.content?.parts?.[0]?.text || '');
    } catch (e) {
      if (e.name === 'AbortError') { onStatus('cancelled'); throw new Error('Cancelled'); }
      onStatus('error'); this._ctrl = null; throw e;
    }
  }
  cancel() { if (this._ctrl) { this._ctrl.abort(); this._ctrl = null; } }
}

// ─── 2. OLLAMA CLIENT ────────────────────────────────────────────────────────

class OllamaClient {
  constructor() {
    this.base  = localStorage.getItem('beyou-ollama-url') || 'http://localhost:11434';
    this.model = localStorage.getItem('beyou-ollama-model') || 'chatmusician';
    this._ctrl = null;
  }
  setConfig(url, model) {
    if (url  !== undefined) { this.base  = (url  || 'http://localhost:11434').replace(/\/+$/, ''); localStorage.setItem('beyou-ollama-url', this.base); }
    if (model !== undefined) { this.model = model || 'chatmusician'; localStorage.setItem('beyou-ollama-model', this.model); }
  }
  async fetchModels() {
    const r = await fetch(`${this.base}/api/tags`);
    const d = await r.json();
    return (d.models || []).map(m => m.name);
  }
  async testConnection() {
    try {
      const models = await this.fetchModels();
      return { ok: true, message: `✅ Ollama connected! ${models.length} model(s) available.` };
    } catch (e) { return { ok: false, message: `Can't reach Ollama at ${this.base}. Is it running?` }; }
  }
  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._ctrl) this._ctrl.abort();
    this._ctrl = new AbortController();
    onStatus('thinking');
    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
    ];
    try {
      const r = await fetch(`${this.base}/api/chat`, {
        method: 'POST', signal: this._ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages: ollamaMessages, stream: false, format: 'json' }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      const d = await r.json();
      onStatus('done'); this._ctrl = null;
      return parseLLMJSON(d.message?.content || '');
    } catch (e) {
      if (e.name === 'AbortError') { onStatus('cancelled'); throw new Error('Cancelled'); }
      onStatus('error'); this._ctrl = null;
      if (e.message.includes('fetch') || e.message.includes('Network')) throw new Error(`Can't connect to Ollama at ${this.base}. Run: OLLAMA_ORIGINS="*" ollama serve`);
      throw e;
    }
  }
  cancel() { if (this._ctrl) { this._ctrl.abort(); this._ctrl = null; } }
}

// ─── 3. LOCAL OPENAI-COMPATIBLE CLIENT (LM Studio, LocalAI) ─────────────────

class OpenAICompatClient {
  constructor() {
    this.base  = localStorage.getItem('beyou-local-openai-url') || 'http://localhost:1234/v1';
    this.model = localStorage.getItem('beyou-local-openai-model') || 'local-model';
    this._ctrl = null;
  }
  setConfig(url, model) {
    if (url   !== undefined) { this.base  = (url  || 'http://localhost:1234/v1').replace(/\/+$/, ''); localStorage.setItem('beyou-local-openai-url', this.base); }
    if (model !== undefined) { this.model = model || 'local-model'; localStorage.setItem('beyou-local-openai-model', this.model); }
  }
  async fetchModels() {
    const r = await fetch(`${this.base}/models`);
    const d = await r.json();
    return (d.data || []).map(m => m.id);
  }
  async testConnection() {
    try {
      await this.fetchModels();
      return { ok: true, message: `✅ Local server connected at ${this.base}!` };
    } catch (e) { return { ok: false, message: `Can't reach server at ${this.base}. Is it running with CORS enabled?` }; }
  }
  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._ctrl) this._ctrl.abort();
    this._ctrl = new AbortController();
    onStatus('thinking');
    const body = {
      model: this.model, stream: false, temperature: 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
      ],
      response_format: { type: 'json_object' },
    };
    try {
      const r = await fetch(`${this.base}/chat/completions`, {
        method: 'POST', signal: this._ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `HTTP ${r.status}`); }
      const d = await r.json();
      onStatus('done'); this._ctrl = null;
      return parseLLMJSON(d.choices?.[0]?.message?.content || '');
    } catch (e) {
      if (e.name === 'AbortError') { onStatus('cancelled'); throw new Error('Cancelled'); }
      onStatus('error'); this._ctrl = null; throw e;
    }
  }
  cancel() { if (this._ctrl) { this._ctrl.abort(); this._ctrl = null; } }
}

// ─── 4. BEYOU BUILT-IN CLIENT ────────────────────────────────────────────────

class BeYouClient {
  constructor() { this._ctrl = null; }

  async testConnection() {
    try {
      const r = await fetch('/health');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { ok: true, message: '✅ BeYou Music AI is ready — 20 genres, trained on real drummer data.' };
    } catch (e) { return { ok: false, message: `Server offline: ${e.message}` }; }
  }

  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._ctrl) this._ctrl.abort();
    this._ctrl = new AbortController();

    // Extract last user message and enrich with genre/mood context
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    let prompt = lastUser?.text || 'make a beat';
    if (systemPrompt) {
      const genreM = systemPrompt.match(/selected genre\(s\):\s*([^\n]+)/i);
      const moodM  = systemPrompt.match(/selected mood\(s\):\s*([^\n]+)/i);
      const bpmM   = systemPrompt.match(/BPM:\s*(\d+)/i);
      const parts = [];
      if (genreM) parts.push(genreM[1].trim().toLowerCase());
      if (moodM)  parts.push(moodM[1].trim().toLowerCase());
      if (bpmM)   parts.push(`${bpmM[1]} bpm`);
      if (parts.length > 0 && !prompt.includes('bpm') && prompt.length < 80) {
        prompt = `${parts.join(' ')} ${prompt}`.trim();
      }
    }

    onStatus('composing');
    try {
      const r = await fetch('/api/ai/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: this._ctrl.signal,
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || `Server error HTTP ${r.status}`); }
      const result = await r.json();
      onStatus('done'); this._ctrl = null;
      return result;
    } catch (e) {
      if (e.name === 'AbortError') { onStatus('cancelled'); throw new Error('Cancelled'); }
      onStatus('error'); this._ctrl = null; throw e;
    }
  }
  cancel() { if (this._ctrl) { this._ctrl.abort(); this._ctrl = null; } }
}

// ─── 5. BEAT GENERATOR ───────────────────────────────────────────────────────

class BeatGenerator {
  static apply(beatData, sequencer) {
    if (!beatData || !sequencer) return;
    if (beatData.bpm >= 20 && beatData.bpm <= 300) sequencer.setBPM(beatData.bpm);
    if (!Array.isArray(beatData.channels)) return;
    beatData.channels.forEach(chData => {
      const idx = AI_PRODUCER_CHANNELS.findIndex(n => n.toLowerCase() === (chData.name || '').toLowerCase());
      if (idx === -1 || !sequencer.channels[idx]) return;
      const ch = sequencer.channels[idx];
      if (Array.isArray(chData.steps)) {
        for (let i = 0; i < Math.min(16, chData.steps.length); i++) ch.steps[i] = chData.steps[i] ? 1 : 0;
      }
      if (Array.isArray(chData.velocity)) {
        for (let i = 0; i < Math.min(16, chData.velocity.length); i++) ch.velocity[i] = Math.max(0, Math.min(1, chData.velocity[i] || 0.8));
      }
    });
  }
  static snapshot(sequencer) {
    return {
      bpm: sequencer.bpm,
      channels: sequencer.channels.map(ch => ({ name: ch.name, steps: [...ch.steps], velocity: [...ch.velocity], muted: ch.muted, solo: ch.solo })),
    };
  }
  static restore(snap, sequencer) {
    if (!snap) return;
    sequencer.setBPM(snap.bpm);
    snap.channels.forEach((s, i) => {
      const ch = sequencer.channels[i];
      if (!ch) return;
      ch.steps = [...s.steps]; ch.velocity = [...s.velocity]; ch.muted = s.muted; ch.solo = s.solo;
    });
  }
}

// ─── 6. MIX MASTER ───────────────────────────────────────────────────────────

class MixMaster {
  static apply(mixData, sequencer, audioEngine) {
    if (!mixData) return;
    if (mixData.master_volume != null && audioEngine?.setMasterVolume) audioEngine.setMasterVolume(mixData.master_volume);
    if (!Array.isArray(mixData.channels)) return;
    mixData.channels.forEach(chData => {
      const idx = AI_PRODUCER_CHANNELS.findIndex(n => n.toLowerCase() === (chData.name || '').toLowerCase());
      if (idx === -1 || !sequencer.channels[idx]) return;
      const ch = sequencer.channels[idx];
      if (chData.volume != null) ch.volume = Math.max(0, Math.min(1, chData.volume));
      if (chData.pan   != null) ch.pan    = Math.max(-1, Math.min(1, chData.pan));
      if (chData.muted != null) { ch.muted = chData.muted; sequencer.setChannelMute?.(idx, ch.muted); }
      if (audioEngine?.updateChannelGain) audioEngine.updateChannelGain(idx, ch.volume, ch.pan);
    });
  }
  static snapshot(sequencer, audioEngine) {
    return {
      masterVolume: audioEngine?.masterVolume ?? 0.9,
      channels: sequencer.channels.map(ch => ({ name: ch.name, volume: ch.volume ?? 0.8, pan: ch.pan ?? 0, muted: ch.muted ?? false })),
    };
  }
  static restore(snap, sequencer, audioEngine) {
    if (!snap) return;
    if (audioEngine?.setMasterVolume) audioEngine.setMasterVolume(snap.masterVolume);
    snap.channels.forEach((s, i) => {
      const ch = sequencer.channels[i];
      if (!ch) return;
      ch.volume = s.volume; ch.pan = s.pan; ch.muted = s.muted;
      sequencer.setChannelMute?.(i, s.muted);
      if (audioEngine?.updateChannelGain) audioEngine.updateChannelGain(i, s.volume, s.pan);
    });
  }
}

// ─── 7. AI PRODUCER ORCHESTRATOR ─────────────────────────────────────────────

class AIProducer {
  constructor() {
    this.beyou       = new BeYouClient();
    this.gemini      = new GeminiClient();
    this.ollama      = new OllamaClient();
    this.localOpenAI = new OpenAICompatClient();

    const stored = localStorage.getItem('beyou-llm-provider');
    this.provider = (['beyou','gemini','ollama','local-openai'].includes(stored)) ? stored : 'beyou';

    this.conversation   = [];
    this.isProcessing   = false;
    this.undoStack      = [];
    this.maxUndo        = 10;
    this.selectedGenres = [];
    this.selectedMoods  = [];
  }

  setProvider(p) {
    if (['beyou','gemini','ollama','local-openai'].includes(p)) {
      this.provider = p;
      localStorage.setItem('beyou-llm-provider', p);
    }
  }
  getProvider() { return this.provider; }

  getActiveClient() {
    if (this.provider === 'gemini')      return this.gemini;
    if (this.provider === 'ollama')      return this.ollama;
    if (this.provider === 'local-openai') return this.localOpenAI;
    return this.beyou;
  }

  getActiveDisplayName() {
    if (this.provider === 'gemini')      return 'Gemini Flash';
    if (this.provider === 'ollama')      return `Ollama (${this.ollama.model})`;
    if (this.provider === 'local-openai') return `Local LLM (${this.localOpenAI.model})`;
    return 'BeYou AI';
  }

  hasActiveConnection() {
    if (this.provider === 'gemini') return this.gemini.hasKey();
    return true;
  }

  async testActiveConnection() { return this.getActiveClient().testConnection(); }

  setApiKey(k) { this.gemini.setApiKey(k); }
  getApiKey()  { return this.gemini.apiKey; }

  _buildSystemPrompt(sequencer) {
    let ctx = GEMINI_SYSTEM_PROMPT;
    ctx += `\n\nCURRENT DAW STATE:\nBPM: ${sequencer.bpm}`;
    sequencer.channels.forEach((ch, i) => {
      ctx += `\nCh${i} (${ch.name}): steps=[${ch.steps.join(',')}]`;
    });
    if (this.selectedGenres.length) ctx += `\n\nUser's selected genre(s): ${this.selectedGenres.join(', ')}`;
    if (this.selectedMoods.length)  ctx += `\nUser's selected mood(s): ${this.selectedMoods.join(', ')}`;
    return ctx;
  }

  _saveUndo(sequencer, audioEngine) {
    this.undoStack.push({ beat: BeatGenerator.snapshot(sequencer), mix: MixMaster.snapshot(sequencer, audioEngine) });
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  undo(sequencer, audioEngine) {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    BeatGenerator.restore(snap.beat, sequencer);
    MixMaster.restore(snap.mix, sequencer, audioEngine);
    return true;
  }
  canUndo() { return this.undoStack.length > 0; }

  async produce(userPrompt, sequencer, audioEngine, { onStatus = () => {} } = {}) {
    const client = this.getActiveClient();
    if (this.isProcessing) { client.cancel(); await new Promise(r => setTimeout(r, 150)); }
    this.isProcessing = true;
    try {
      this.conversation.push({ role: 'user', text: userPrompt });
      if (this.conversation.length > 20) this.conversation = this.conversation.slice(-16);

      let result = null;
      if (this.hasActiveConnection()) {
        try {
          result = await client.chat(this.conversation, this._buildSystemPrompt(sequencer), { onStatus });
        } catch (err) {
          console.warn('[BeYou AI] Client failed, using procedural fallback:', err.message);
          onStatus('composing');
          result = this._proceduralFallback(userPrompt);
        }
      } else {
        onStatus('composing');
        result = this._proceduralFallback(userPrompt);
      }

      if (!result || typeof result !== 'object') result = this._proceduralFallback(userPrompt);

      try { this.conversation.push({ role: 'model', text: JSON.stringify(result) }); } catch (_) {}

      const hasBeat = !!(result.beat?.channels);
      const hasMix  = !!(result.mix?.channels);

      if (hasBeat || hasMix) {
        try { this._saveUndo(sequencer, audioEngine); } catch (_) {}
      }
      if (hasBeat) { try { BeatGenerator.apply(result.beat, sequencer); } catch (e) { console.warn('BeatGenerator.apply:', e); } }
      if (hasMix)  { try { MixMaster.apply(result.mix, sequencer, audioEngine); } catch (e) { console.warn('MixMaster.apply:', e); } }

      return { message: result.message || '🎵 Done!', suggestions: result.suggestions || [], hasBeat, hasMix, bpm: result.beat?.bpm };
    } finally {
      this.isProcessing = false;
    }
  }

  // Procedural fallback when no internet / no key
  _proceduralFallback(prompt) {
    const p = (prompt || '').toLowerCase();
    let genre = 'Hip-Hop';
    if (p.includes('trap') || p.includes('808')) genre = 'Trap';
    else if (p.includes('drill')) genre = 'Drill';
    else if (p.includes('house') || p.includes('club')) genre = 'House';
    else if (p.includes('lofi') || p.includes('lo-fi') || p.includes('chill')) genre = 'Lo-Fi';
    else if (p.includes('techno')) genre = 'Techno';
    else if (p.includes('dnb') || p.includes('drum')) genre = 'Drum & Bass';
    else if (p.includes('afro')) genre = 'Afrobeats';
    else if (p.includes('reggaeton') || p.includes('latin')) genre = 'Reggaeton';
    else if (p.includes('synthwave') || p.includes('80s')) genre = 'Synthwave';
    else if (p.includes('phonk')) genre = 'Phonk';
    else if (p.includes('r&b') || p.includes('rnb') || p.includes('soul')) genre = 'R&B';
    else if (p.includes('jazz')) genre = 'Jazz';
    else if (p.includes('rock')) genre = 'Rock';
    else if (p.includes('pop')) genre = 'Pop';
    else if (p.includes('ambient') || p.includes('relax')) genre = 'Ambient';

    const bpmMap = { 'Trap': 140, 'Drill': 142, 'Hip-Hop': 88, 'Lo-Fi': 80, 'House': 126,
                     'Techno': 135, 'Drum & Bass': 174, 'Reggaeton': 95, 'Afrobeats': 102,
                     'Synthwave': 100, 'Phonk': 130, 'R&B': 80, 'Jazz': 110, 'Rock': 120,
                     'Pop': 115, 'Ambient': 75 };
    const bpmM = p.match(/(\d{2,3})\s*(?:bpm|tempo)/);
    const bpm  = bpmM ? parseInt(bpmM[1]) : (bpmMap[genre] || 100);

    // Genre seed patterns
    const seeds = {
      'Trap':      { Kick: [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0], Snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'Hi-Hat C': [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] },
      'Hip-Hop':   { Kick: [1,0,0,1,0,0,0,0,1,0,0,1,0,0,0,0], Snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'Hi-Hat C': [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] },
      'House':     { Kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], Clap: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'Hi-Hat C': [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0] },
      'Drum & Bass':{ Kick: [1,0,0,0,0,0,0,1,0,0,0,0,1,0,0,0], Snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0], 'Hi-Hat C': [1,1,0,1,1,0,1,1,0,1,1,0,1,1,0,1] },
    };
    const seed = seeds[genre] || seeds['Hip-Hop'];

    const channels = AI_PRODUCER_CHANNELS.map(name => {
      const base = (seed[name] || new Array(16).fill(0));
      const steps = base.map(s => s);
      const velocity = steps.map((s, i) => s ? (i % 4 === 0 ? 0.95 : 0.7 + Math.random() * 0.2) : 0);
      return { name, steps, velocity };
    });

    return {
      message: `Got you — ${genre} pattern at ${bpm} BPM. Real patterns are loaded and ready to play.`,
      beat: { bpm, channels },
      suggestions: [
        'Hit Generate Beat again for a different variation',
        'Select a mood above for a more specific feel',
        'Open Piano Roll on the Lead channel to add melody',
      ],
    };
  }

  async fullProduction(sequencer, audioEngine, opts = {}) {
    const genres = this.selectedGenres.length ? this.selectedGenres.join(' + ') : 'any genre you think is hot right now';
    const moods  = this.selectedMoods.length  ? this.selectedMoods.join(', ')   : 'your choice';
    return this.produce(`Full production: ${genres} beat with ${moods} mood. Include all 8 channels and mix settings.`, sequencer, audioEngine, opts);
  }
  async generateBeat(sequencer, audioEngine, opts = {}) {
    const genres = this.selectedGenres.length ? this.selectedGenres.join(' + ') : 'any genre';
    const moods  = this.selectedMoods.length  ? this.selectedMoods.join(', ')   : 'your choice';
    return this.produce(`Generate a ${genres} beat with ${moods} vibe. Hit me with a fresh pattern.`, sequencer, audioEngine, opts);
  }
  async mixAndMaster(sequencer, audioEngine, opts = {}) {
    return this.produce('Mix and master my current beat. Set proper levels, panning, and balance. Just the mix, keep my patterns.', sequencer, audioEngine, opts);
  }
  async addVariation(sequencer, audioEngine, opts = {}) {
    return this.produce('Add variation to my current pattern. Keep the feel but make it more interesting — ghost notes, fills, some syncopation.', sequencer, audioEngine, opts);
  }
  async surpriseMe(sequencer, audioEngine, opts = {}) {
    const g = AI_PRODUCER_GENRES[Math.floor(Math.random() * AI_PRODUCER_GENRES.length)];
    const m = AI_PRODUCER_MOODS[Math.floor(Math.random() * AI_PRODUCER_MOODS.length)];
    return this.produce(`Surprise me — ${g} beat with ${m} mood. Be creative and experimental.`, sequencer, audioEngine, opts);
  }

  clearConversation() { this.conversation = []; this.undoStack = []; }
  cancel() { this.getActiveClient().cancel(); this.isProcessing = false; }
}

// ─── Expose ──────────────────────────────────────────────────────────────────

window.AIProducer          = AIProducer;
window.BeYouClient         = BeYouClient;
window.GeminiClient        = GeminiClient;
window.OllamaClient        = OllamaClient;
window.OpenAICompatClient  = OpenAICompatClient;
window.BeatGenerator       = BeatGenerator;
window.MixMaster           = MixMaster;
window.AI_PRODUCER_GENRES  = AI_PRODUCER_GENRES;
window.AI_PRODUCER_MOODS   = AI_PRODUCER_MOODS;
window.AI_PRODUCER_ACTIONS = AI_PRODUCER_ACTIONS;
window.PROMPT_STARTERS     = PROMPT_STARTERS;
