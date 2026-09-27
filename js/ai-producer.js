/**
 * FL Studio Clone — AI Producer (LLM-Powered Beat Making & Mix-Mastering)
 *
 * Four components:
 *  1. GeminiClient   — API client for Google Gemini structured output
 *  2. BeatGenerator  — Applies LLM-generated patterns to the sequencer
 *  3. MixMaster      — Applies LLM-generated mix/master settings
 *  4. AIProducer     — Orchestrator with conversation history & undo
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

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
  { id: 'beat',      icon: '🥁', label: 'Generate Beat',     desc: 'Create drum & melodic patterns' },
  { id: 'mix',       icon: '🎚️', label: 'Mix & Master',      desc: 'Auto-level, pan, EQ, compress' },
  { id: 'variation', icon: '🔄', label: 'Add Variation',     desc: 'Modify current pattern' },
  { id: 'random',    icon: '🎲', label: 'Surprise Me',       desc: 'Random genre & style' },
];

const GEMINI_SYSTEM_PROMPT = `You are an expert music producer AI integrated into a DAW (Digital Audio Workstation). 
You create beats, arrange patterns, and mix-master tracks.

The DAW has 8 channels with 16 steps each:
- Channel 0: Kick (drum)
- Channel 1: Clap (drum)
- Channel 2: Hi-Hat Closed (drum)
- Channel 3: Hi-Hat Open (drum)
- Channel 4: Snare (drum)
- Channel 5: Tom (drum)
- Channel 6: Bass (synth/bass)
- Channel 7: Lead (synth/melody)

Each step can be ON (1) or OFF (0). Velocity is a float from 0.0 to 1.0.

RULES FOR BEAT GENERATION:
- Always create musically coherent patterns
- Kick patterns should anchor the groove
- Snare/Clap typically on beats 2 and 4 (steps 4,12 in 0-indexed) for most genres
- Hi-hats create rhythmic texture
- Bass should complement the kick pattern
- Lead should add melodic interest without clashing with drums
- Use velocity variation for dynamics and groove (accent beats louder)
- Match BPM to the genre (e.g., Trap: 130-160, House: 120-130, Hip-Hop: 80-100)

RULES FOR MIX-MASTERING:
- Set volumes so drums sit well together (kick loudest, hats quieter)
- Pan hi-hats slightly for stereo width
- Bass and kick should be centered (pan = 0)
- Lead can be slightly panned
- Volume values: 0.0 to 1.0
- Pan values: -1.0 (left) to 1.0 (right)

You MUST respond with valid JSON in this exact schema:

{
  "message": "Your friendly explanation of what you created/changed",
  "beat": {
    "bpm": <number 60-200>,
    "channels": [
      {
        "name": "<channel name>",
        "steps": [0 or 1, ... 16 values],
        "velocity": [0.0-1.0, ... 16 values]
      }
    ]
  },
  "mix": {
    "master_volume": <0.0-1.0>,
    "channels": [
      {
        "name": "<channel name>",
        "volume": <0.0-1.0>,
        "pan": <-1.0 to 1.0>,
        "muted": <boolean>
      }
    ]
  },
  "suggestions": ["<suggestion 1>", "<suggestion 2>", ...]
}

Include "beat" only if generating/modifying beats. Include "mix" only if mixing/mastering.
Always include "message" and "suggestions".
If the user just chats or asks questions, return only "message" and "suggestions" with no beat/mix.`;

// ─────────────────────────────────────────────────────────────────────────────
// Shared JSON parsing helper for all LLM clients
function parseLLMJSON(textContent) {
  if (!textContent || typeof textContent !== 'string') {
    throw new Error('Empty or invalid response from AI');
  }
  try {
    return JSON.parse(textContent);
  } catch (_) {
    // 1. Check for markdown code fence ```json ... ```
    const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (__) {}
    }
    // 2. Fallback: extract first { to last }
    const start = textContent.indexOf('{');
    const end = textContent.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(textContent.slice(start, end + 1));
      } catch (___) {}
    }
    throw new Error('Could not parse AI response as JSON. Output was: ' + textContent.slice(0, 100));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LLM CLIENTS (Cloud Gemini, Local Ollama, Local OpenAI-Compatible)
// ─────────────────────────────────────────────────────────────────────────────

class GeminiClient {
  constructor() {
    this.apiKey = localStorage.getItem('fl-studio-gemini-key') || '';
    this.model  = 'gemini-2.0-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
    this._abortCtrl = null;
  }

  setApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem('fl-studio-gemini-key', this.apiKey);
  }

  hasKey() { return this.apiKey.length > 0; }

  async testConnection() {
    if (!this.hasKey()) {
      return { ok: false, message: 'No Gemini API key configured.' };
    }
    try {
      const resp = await fetch(`${this.baseUrl}/${this.model}?key=${this.apiKey}`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return { ok: false, message: err.error?.message || `HTTP ${resp.status}` };
      }
      return { ok: true, message: `Connected to Google Gemini (${this.model})` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (!this.hasKey()) throw new Error('No Gemini API key set');

    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
    };

    onStatus('thinking');

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this._abortCtrl.signal,
      });

      if (resp.status === 429) {
        throw new Error('Rate limit reached. Please wait a moment and try again.');
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Invalid Gemini API key. Check your key at ai.google.dev.');
      }
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textContent) throw new Error('Empty response from Gemini');

      const parsed = parseLLMJSON(textContent);
      onStatus('done');
      this._abortCtrl = null;
      return parsed;

    } catch (err) {
      if (err.name === 'AbortError') {
        onStatus('cancelled');
        throw new Error('Request cancelled');
      }
      onStatus('error');
      this._abortCtrl = null;
      throw err;
    }
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }
}

/**
 * Client for local Ollama instances (e.g. running chatmusician, llama3, mistral, qwen2.5)
 */
class OllamaClient {
  constructor() {
    this.baseUrl = localStorage.getItem('fl-studio-ollama-url') || 'http://localhost:11434';
    this.model   = localStorage.getItem('fl-studio-ollama-model') || 'chatmusician';
    this._abortCtrl = null;
  }

  setConfig(url, model) {
    if (url !== undefined) {
      this.baseUrl = (url.trim() || 'http://localhost:11434').replace(/\/+$/, '');
      localStorage.setItem('fl-studio-ollama-url', this.baseUrl);
    }
    if (model !== undefined) {
      this.model = model.trim() || 'chatmusician';
      localStorage.setItem('fl-studio-ollama-model', this.model);
    }
  }

  async fetchModels() {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return (data.models || []).map(m => m.name);
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error('Could not reach Ollama. Ensure Ollama is running and CORS is enabled via OLLAMA_ORIGINS="*" ollama serve.');
      }
      throw err;
    }
  }

  async testConnection() {
    try {
      const models = await this.fetchModels();
      const hasSelected = models.some(m => m.toLowerCase().includes(this.model.toLowerCase()));
      return {
        ok: true,
        message: `Connected to Ollama! Found ${models.length} model(s).` +
          (hasSelected ? ` (Model "${this.model}" found)` : ` (Tip: '${this.model}' not in local tags, will attempt or choose from list)`),
        models,
      };
    } catch (err) {
      return {
        ok: false,
        message: err.message,
      };
    }
  }

  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    const url = `${this.baseUrl}/api/chat`;
    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      })),
    ];

    const body = {
      model: this.model,
      messages: ollamaMessages,
      format: 'json',
      stream: false,
      options: {
        temperature: 0.8,
      },
    };

    onStatus('thinking');

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this._abortCtrl.signal,
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const textContent = data.message?.content;
      if (!textContent) throw new Error('Empty response from Ollama');

      const parsed = parseLLMJSON(textContent);
      onStatus('done');
      this._abortCtrl = null;
      return parsed;

    } catch (err) {
      if (err.name === 'AbortError') {
        onStatus('cancelled');
        throw new Error('Request cancelled');
      }
      onStatus('error');
      this._abortCtrl = null;
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to Ollama at ${this.baseUrl}. Make sure Ollama is running with CORS enabled (OLLAMA_ORIGINS="*" ollama serve).`);
      }
      throw err;
    }
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }
}

/**
 * Client for OpenAI-compatible local servers (LM Studio, LocalAI, vLLM, text-generation-webui)
 */
class OpenAICompatClient {
  constructor() {
    this.baseUrl = localStorage.getItem('fl-studio-local-openai-url') || 'http://localhost:1234/v1';
    this.model   = localStorage.getItem('fl-studio-local-openai-model') || 'local-model';
    this._abortCtrl = null;
  }

  setConfig(url, model) {
    if (url !== undefined) {
      this.baseUrl = (url.trim() || 'http://localhost:1234/v1').replace(/\/+$/, '');
      localStorage.setItem('fl-studio-local-openai-url', this.baseUrl);
    }
    if (model !== undefined) {
      this.model = model.trim() || 'local-model';
      localStorage.setItem('fl-studio-local-openai-model', this.model);
    }
  }

  async fetchModels() {
    try {
      const resp = await fetch(`${this.baseUrl}/models`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return (data.data || []).map(m => m.id);
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to server at ${this.baseUrl}. Check if your local server is running with CORS enabled.`);
      }
      throw err;
    }
  }

  async testConnection() {
    try {
      const models = await this.fetchModels();
      return {
        ok: true,
        message: `Connected! Found ${models.length} model(s) on local server.`,
        models,
      };
    } catch (err) {
      return {
        ok: false,
        message: err.message,
      };
    }
  }

  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    const url = `${this.baseUrl}/chat/completions`;
    const openAIMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      })),
    ];

    const body = {
      model: this.model,
      messages: openAIMessages,
      response_format: { type: 'json_object' },
      temperature: 0.8,
    };

    onStatus('thinking');

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this._abortCtrl.signal,
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const textContent = data.choices?.[0]?.message?.content;
      if (!textContent) throw new Error('Empty response from local LLM');

      const parsed = parseLLMJSON(textContent);
      onStatus('done');
      this._abortCtrl = null;
      return parsed;

    } catch (err) {
      if (err.name === 'AbortError') {
        onStatus('cancelled');
        throw new Error('Request cancelled');
      }
      onStatus('error');
      this._abortCtrl = null;
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error(`Cannot connect to local LLM server at ${this.baseUrl}. Make sure LM Studio / LocalAI is running and CORS is enabled.`);
      }
      throw err;
    }
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }
}

/**
 * BeYou Built-in Music AI Client — calls the server-side AI endpoint.
 * No API keys, no external LLMs, no configuration needed!
 */
class BeYouClient {
  constructor() {
    this.baseUrl = '';
    this._abortCtrl = null;
  }

  async testConnection() {
    try {
      const resp = await fetch('/health');
      if (!resp.ok) throw new Error(`Server unreachable (HTTP ${resp.status})`);
      const data = await resp.json();
      return { ok: true, message: `✅ Connected to BeYou Music AI Engine (v2)! 20 genres loaded.` };
    } catch (err) {
      return { ok: false, message: `Server connection failed: ${err.message}` };
    }
  }

  async chat(messages, systemPrompt, { onStatus = () => {} } = {}) {
    if (this._abortCtrl) this._abortCtrl.abort();
    this._abortCtrl = new AbortController();

    // Extract the last user message as the main prompt
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    let prompt = lastUserMsg?.text || 'make a beat';

    // Enrich prompt with genre/mood context extracted from system prompt
    if (systemPrompt) {
      const genreMatch = systemPrompt.match(/selected genre\(s\):\s*([^\n]+)/i);
      const moodMatch  = systemPrompt.match(/selected mood\(s\):\s*([^\n]+)/i);
      const bpmMatch   = systemPrompt.match(/BPM:\s*(\d+)/i);

      const contextParts = [];
      if (genreMatch) contextParts.push(genreMatch[1].trim().toLowerCase());
      if (moodMatch)  contextParts.push(moodMatch[1].trim().toLowerCase());
      if (bpmMatch)   contextParts.push(`${bpmMatch[1]} bpm`);

      // Only prepend context if the prompt doesn't already mention genre/BPM
      if (contextParts.length > 0 && !prompt.includes('bpm') && prompt.length < 80) {
        prompt = `${contextParts.join(' ')} ${prompt}`.trim();
      }
    }

    onStatus('composing');

    try {
      const resp = await fetch('/api/ai/produce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: this._abortCtrl.signal,
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody.detail || `Server error HTTP ${resp.status}`);
      }

      const result = await resp.json();
      onStatus('done');
      this._abortCtrl = null;
      return result;

    } catch (err) {
      if (err.name === 'AbortError') {
        onStatus('cancelled');
        throw new Error('Request cancelled');
      }
      onStatus('error');
      this._abortCtrl = null;
      throw err;
    }
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. BEAT GENERATOR
// ─────────────────────────────────────────────────────────────────────────────

class BeatGenerator {
  /**
   * Apply beat data from LLM to the sequencer.
   * @param {object} beatData - { bpm, channels: [{ name, steps, velocity }] }
   * @param {Sequencer} sequencer
   */
  static apply(beatData, sequencer) {
    if (!beatData || !sequencer) return;

    // Set BPM
    if (beatData.bpm && beatData.bpm >= 20 && beatData.bpm <= 300) {
      sequencer.setBPM(beatData.bpm);
    }

    // Apply channel patterns
    if (beatData.channels && Array.isArray(beatData.channels)) {
      beatData.channels.forEach(chData => {
        const chIdx = AI_PRODUCER_CHANNELS.findIndex(
          n => n.toLowerCase() === (chData.name || '').toLowerCase()
        );
        if (chIdx === -1 || !sequencer.channels[chIdx]) return;

        const ch = sequencer.channels[chIdx];

        // Apply steps
        if (chData.steps && Array.isArray(chData.steps)) {
          for (let i = 0; i < Math.min(16, chData.steps.length); i++) {
            ch.steps[i] = chData.steps[i] ? 1 : 0;
          }
        }

        // Apply velocities
        if (chData.velocity && Array.isArray(chData.velocity)) {
          for (let i = 0; i < Math.min(16, chData.velocity.length); i++) {
            ch.velocity[i] = Math.max(0, Math.min(1, chData.velocity[i] || 0.8));
          }
        }
      });
    }
  }

  /**
   * Snapshot the current sequencer state for undo.
   */
  static snapshot(sequencer) {
    return {
      bpm: sequencer.bpm,
      channels: sequencer.channels.map(ch => ({
        name: ch.name,
        steps: [...ch.steps],
        velocity: [...ch.velocity],
        muted: ch.muted,
        solo: ch.solo,
      })),
    };
  }

  /**
   * Restore a snapshot.
   */
  static restore(snapshot, sequencer) {
    if (!snapshot) return;
    sequencer.setBPM(snapshot.bpm);
    snapshot.channels.forEach((snap, i) => {
      const ch = sequencer.channels[i];
      if (!ch) return;
      ch.steps = [...snap.steps];
      ch.velocity = [...snap.velocity];
      ch.muted = snap.muted;
      ch.solo = snap.solo;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MIX MASTER
// ─────────────────────────────────────────────────────────────────────────────

class MixMaster {
  /**
   * Apply mix settings from LLM to the mixer and audio engine.
   * @param {object} mixData - { master_volume, channels: [{ name, volume, pan, muted }] }
   * @param {Sequencer} sequencer
   * @param {AudioEngine} audioEngine
   */
  static apply(mixData, sequencer, audioEngine) {
    if (!mixData || !sequencer) return;

    // Master volume
    if (mixData.master_volume !== undefined && audioEngine) {
      audioEngine.setMasterVolume(Math.max(0, Math.min(1, mixData.master_volume)));
    }

    // Per-channel mix
    if (mixData.channels && Array.isArray(mixData.channels)) {
      mixData.channels.forEach(chMix => {
        const chIdx = AI_PRODUCER_CHANNELS.findIndex(
          n => n.toLowerCase() === (chMix.name || '').toLowerCase()
        );
        if (chIdx === -1 || !sequencer.channels[chIdx]) return;

        const ch = sequencer.channels[chIdx];

        // Volume
        if (chMix.volume !== undefined) {
          ch.volume = Math.max(0, Math.min(1, chMix.volume));
        }

        // Pan
        if (chMix.pan !== undefined) {
          ch.pan = Math.max(-1, Math.min(1, chMix.pan));
        }

        // Mute
        if (chMix.muted !== undefined) {
          ch.muted = !!chMix.muted;
          sequencer.setChannelMute(chIdx, ch.muted);
        }
      });
    }
  }

  /**
   * Snapshot mixer state for undo.
   */
  static snapshot(sequencer, audioEngine) {
    return {
      masterVolume: audioEngine?.masterGain?.gain?.value ?? 0.85,
      channels: sequencer.channels.map(ch => ({
        name: ch.name,
        volume: ch.volume ?? 0.8,
        pan: ch.pan ?? 0,
        muted: ch.muted,
      })),
    };
  }

  /**
   * Restore mixer snapshot.
   */
  static restore(snapshot, sequencer, audioEngine) {
    if (!snapshot) return;
    if (audioEngine && snapshot.masterVolume !== undefined) {
      audioEngine.setMasterVolume(snapshot.masterVolume);
    }
    snapshot.channels.forEach((snap, i) => {
      const ch = sequencer.channels[i];
      if (!ch) return;
      ch.volume = snap.volume;
      ch.pan = snap.pan;
      ch.muted = snap.muted;
      sequencer.setChannelMute(i, snap.muted);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. AI PRODUCER (Orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

class AIProducer {
  constructor() {
    this.beyou       = new BeYouClient();
    this.gemini      = new GeminiClient();
    this.ollama      = new OllamaClient();
    this.localOpenAI = new OpenAICompatClient();

    // Active provider: 'beyou' | 'ollama' | 'local-openai' | 'gemini'
    // Default to 'beyou' (built-in, no config needed)
    const storedProvider = localStorage.getItem('fl-studio-llm-provider');
    if (storedProvider && ['beyou', 'ollama', 'local-openai', 'gemini'].includes(storedProvider)) {
      this.provider = storedProvider;
    } else {
      this.provider = 'beyou';  // Built-in — works out of the box!
    }

    this.conversation = [];    // { role: 'user'|'model', text: string }
    this.isProcessing = false;
    this.undoStack = [];       // Array of { beat, mix } snapshots
    this.maxUndo = 10;

    // Selected tags
    this.selectedGenres = [];
    this.selectedMoods = [];
  }

  // Provider configuration
  setProvider(provider) {
    if (['beyou', 'ollama', 'local-openai', 'gemini'].includes(provider)) {
      this.provider = provider;
      localStorage.setItem('fl-studio-llm-provider', provider);
    }
  }

  getProvider() { return this.provider; }

  getActiveClient() {
    if (this.provider === 'ollama') return this.ollama;
    if (this.provider === 'local-openai') return this.localOpenAI;
    if (this.provider === 'gemini') return this.gemini;
    return this.beyou;  // Default: built-in
  }

  getActiveDisplayName() {
    if (this.provider === 'ollama') return `Ollama (${this.ollama.model})`;
    if (this.provider === 'local-openai') return `Local (${this.localOpenAI.model})`;
    if (this.provider === 'gemini') return 'Gemini Flash';
    return 'BeYou Music AI';
  }

  hasActiveConnection() {
    if (this.provider === 'gemini') return this.gemini.hasKey();
    if (this.provider === 'ollama') return !!this.ollama.baseUrl;
    if (this.provider === 'local-openai') return !!this.localOpenAI.baseUrl;
    return true;  // BeYou built-in is always available!
  }

  async testActiveConnection() {
    return this.getActiveClient().testConnection();
  }

  setApiKey(key) { this.gemini.setApiKey(key); }
  hasApiKey()    { return this.hasActiveConnection(); }
  getApiKey()    { return this.gemini.apiKey; }

  /**
   * Build contextual system prompt including current DAW state.
   */
  _buildSystemPrompt(sequencer) {
    let ctx = GEMINI_SYSTEM_PROMPT;

    // Add current DAW state
    ctx += `\n\nCURRENT DAW STATE:`;
    ctx += `\nBPM: ${sequencer.bpm}`;

    sequencer.channels.forEach((ch, i) => {
      ctx += `\nChannel ${i} (${ch.name}): steps=[${ch.steps.join(',')}] velocity=[${ch.velocity.map(v => v.toFixed(2)).join(',')}] muted=${ch.muted}`;
    });

    // Genre/mood context
    if (this.selectedGenres.length > 0) {
      ctx += `\n\nUser's selected genre(s): ${this.selectedGenres.join(', ')}`;
    }
    if (this.selectedMoods.length > 0) {
      ctx += `\nUser's selected mood(s): ${this.selectedMoods.join(', ')}`;
    }

    return ctx;
  }

  /**
   * Save undo snapshot before making changes.
   */
  _saveUndo(sequencer, audioEngine) {
    const snap = {
      beat: BeatGenerator.snapshot(sequencer),
      mix: MixMaster.snapshot(sequencer, audioEngine),
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  /**
   * Undo the last AI change.
   */
  undo(sequencer, audioEngine) {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    BeatGenerator.restore(snap.beat, sequencer);
    MixMaster.restore(snap.mix, sequencer, audioEngine);
    return true;
  }

  canUndo() { return this.undoStack.length > 0; }

  /**
   * Main produce method — generates beat + mix from a user prompt.
   * @param {string} userPrompt
   * @param {Sequencer} sequencer
   * @param {AudioEngine} audioEngine
   * @param {object} opts
   * @returns {Promise<object>} { message, suggestions, hasBeat, hasMix }
   */
  async produce(userPrompt, sequencer, audioEngine, { onStatus = () => {} } = {}) {
    const activeClient = this.getActiveClient();

    if (this.isProcessing) {
      activeClient.cancel();
      await new Promise(r => setTimeout(r, 150));
    }

    this.isProcessing = true;

    try {
      // Add user message to conversation
      this.conversation.push({ role: 'user', text: userPrompt });

      // Cap conversation length to avoid token limits
      if (this.conversation.length > 20) {
        this.conversation = this.conversation.slice(-16);
      }

      let result = null;

      // Try active client first; fall back to built-in procedural engine on any failure
      if (this.hasActiveConnection()) {
        try {
          const systemPrompt = this._buildSystemPrompt(sequencer);
          result = await activeClient.chat(this.conversation, systemPrompt, { onStatus });
        } catch (err) {
          console.warn('[BeYou AI] Chat failed, switching to procedural fallback:', err.message);
          onStatus('composing');
          result = this._generateProceduralFallback(userPrompt, sequencer, audioEngine);
        }
      } else {
        onStatus('composing');
        result = this._generateProceduralFallback(userPrompt, sequencer, audioEngine);
      }

      // Safety guard — ensure result is always a valid object
      if (!result || typeof result !== 'object') {
        result = this._generateProceduralFallback(userPrompt, sequencer, audioEngine);
      }

      // Add AI response to conversation history
      try {
        this.conversation.push({ role: 'model', text: JSON.stringify(result) });
      } catch (_) { /* JSON.stringify can fail on circular refs — ignore */ }

      // Determine what changed
      const hasBeat = !!(result.beat && result.beat.channels);
      const hasMix  = !!(result.mix  && result.mix.channels);

      // Save undo snapshot before applying
      if (hasBeat || hasMix) {
        try { this._saveUndo(sequencer, audioEngine); } catch (_) {}
      }

      // Apply beat patterns to sequencer
      if (hasBeat) {
        try { BeatGenerator.apply(result.beat, sequencer); } catch (e) {
          console.warn('[BeYou AI] BeatGenerator.apply failed:', e.message);
        }
      }

      // Apply mix settings to mixer/audio engine
      if (hasMix) {
        try { MixMaster.apply(result.mix, sequencer, audioEngine); } catch (e) {
          console.warn('[BeYou AI] MixMaster.apply failed:', e.message);
        }
      }

      return {
        message:     result.message     || '🎵 Beat generated!',
        suggestions: result.suggestions || [],
        hasBeat,
        hasMix,
        bpm: result.beat?.bpm,
      };

    } finally {
      // ALWAYS reset the processing flag — no matter what happens
      this.isProcessing = false;
    }
  }


  /**
   * Deep procedural music knowledge engine:
   * Translates genre, mood, tempo, and prompt nuances into authentic 16-step patterns,
   * humanized velocities, and mix-mastering settings.
   */
  _generateProceduralFallback(userPrompt, sequencer, audioEngine) {
    const p = (userPrompt || '').toLowerCase();

    // 1. Genre classification
    let genre = 'Hip-Hop';
    if (p.includes('drill')) genre = 'Drill';
    else if (p.includes('trap') || p.includes('808')) genre = 'Trap';
    else if (p.includes('phonk') || p.includes('cowbell')) genre = 'Phonk';
    else if (p.includes('synthwave') || p.includes('80s') || p.includes('outrun')) genre = 'Synthwave';
    else if (p.includes('techno') || p.includes('acid') || p.includes('industrial')) genre = 'Techno';
    else if (p.includes('dnb') || p.includes('drum and bass') || p.includes('jungle')) genre = 'Drum & Bass';
    else if (p.includes('reggaeton') || p.includes('dembow') || p.includes('latin')) genre = 'Reggaeton';
    else if (p.includes('afro') || p.includes('amapiano')) genre = 'Afrobeats';
    else if (p.includes('house') || p.includes('club') || p.includes('edm')) genre = 'House';
    else if (p.includes('ambient') || p.includes('calm') || p.includes('relax')) genre = 'Ambient';
    else if (p.includes('lofi') || p.includes('lo-fi') || p.includes('chill') || p.includes('study')) genre = 'Lo-Fi';
    else if (this.selectedGenres.length > 0) genre = this.selectedGenres[0];

    // 2. Fetch seed pattern & BPM constraints
    const seed = (typeof GENRE_SEEDS !== 'undefined' && GENRE_SEEDS[genre]) 
      ? GENRE_SEEDS[genre] 
      : (typeof GENRE_SEEDS !== 'undefined' ? GENRE_SEEDS['Hip-Hop'] : {});
    const preset = (typeof GENRE_PRESETS !== 'undefined' && GENRE_PRESETS[genre]) 
      ? GENRE_PRESETS[genre] 
      : { bpmRange: [90, 120] };

    // 3. Determine BPM
    const bpmMatch = p.match(/(\d{2,3})\s*(?:bpm|tempo)/);
    const bpm = bpmMatch ? parseInt(bpmMatch[1], 10) : Math.round((preset.bpmRange[0] + preset.bpmRange[1]) / 2);

    // 4. Build channels with humanized velocities and dynamic variations
    const channels = [];
    AI_PRODUCER_CHANNELS.forEach((chName) => {
      const baseSteps = seed[chName] ? [...seed[chName]] : new Array(16).fill(0);
      const velocities = baseSteps.map((step, idx) => {
        if (!step) return 0.0;
        const isDownbeat = (idx % 4 === 0);
        const baseVel = isDownbeat ? 0.95 : 0.76;
        const jitter = (Math.random() * 0.14 - 0.07);
        return Math.max(0.3, Math.min(1.0, +(baseVel + jitter).toFixed(2)));
      });

      channels.push({
        name: chName,
        steps: baseSteps,
        velocity: velocities,
      });
    });

    // 5. Build genre-tailored mix settings
    const mixChannels = [
      { name: 'Kick', volume: genre === 'House' || genre === 'Techno' ? 0.95 : 0.90, pan: 0.0, muted: false },
      { name: 'Clap', volume: 0.76, pan: -0.05, muted: false },
      { name: 'Hi-Hat C', volume: 0.68, pan: 0.20, muted: false },
      { name: 'Hi-Hat O', volume: 0.62, pan: 0.25, muted: false },
      { name: 'Snare', volume: genre === 'Drill' ? 0.88 : 0.82, pan: 0.0, muted: false },
      { name: 'Tom', volume: 0.70, pan: -0.15, muted: false },
      { name: 'Bass', volume: genre === 'Trap' || genre === 'Drill' || genre === 'Phonk' ? 0.95 : 0.85, pan: 0.0, muted: false },
      { name: 'Lead', volume: 0.74, pan: 0.10, muted: false },
    ];

    return {
      message: `🎵 BeYou AI Music Engine composed an authentic ${genre} production at ${bpm} BPM with genre-tailored rhythm dynamics and master mixing!`,
      beat: {
        bpm,
        channels,
      },
      mix: {
        master_volume: 0.90,
        channels: mixChannels,
      },
      suggestions: [
        `Try adjusting swing on the hi-hats for an even tighter ${genre} groove`,
        `Add pitch glides in the Piano Roll on the Bass line`,
        `Switch to SONG mode to build verse and hook arrangements`
      ]
    };
  }

  /**
   * Quick action: Full production with genre/mood context.
   */
  async fullProduction(sequencer, audioEngine, opts = {}) {
    const genres = this.selectedGenres.length > 0 ? this.selectedGenres.join(' + ') : 'any genre you think sounds great';
    const moods  = this.selectedMoods.length > 0  ? this.selectedMoods.join(', ')  : 'your choice';
    const prompt = `Create a complete production: Generate a ${genres} beat with a ${moods} mood. Include all drum channels (kick, snare, clap, hi-hats, toms) and melodic channels (bass, lead). Set appropriate BPM for the genre. Also provide mix-master settings with proper volume levels, panning, and balance. Make it sound professional.`;
    return this.produce(prompt, sequencer, audioEngine, opts);
  }

  /**
   * Quick action: Generate beat only.
   */
  async generateBeat(sequencer, audioEngine, opts = {}) {
    const genres = this.selectedGenres.length > 0 ? this.selectedGenres.join(' + ') : 'any genre';
    const moods  = this.selectedMoods.length > 0  ? this.selectedMoods.join(', ')  : 'your choice';
    const prompt = `Generate a ${genres} beat with a ${moods} vibe. Create interesting drum patterns for kick, snare, clap, hi-hats, toms, and melodic patterns for bass and lead. Set the right BPM. Use velocity variation for groove. Don't include mix settings, just the beat.`;
    return this.produce(prompt, sequencer, audioEngine, opts);
  }

  /**
   * Quick action: Mix & master only.
   */
  async mixAndMaster(sequencer, audioEngine, opts = {}) {
    const prompt = `Look at my current beat pattern and create professional mix-master settings. Set appropriate volume levels for each channel, apply panning for stereo width, and ensure the overall balance sounds polished. Don't change the beat patterns, only provide mix settings.`;
    return this.produce(prompt, sequencer, audioEngine, opts);
  }

  /**
   * Quick action: Add variation to current pattern.
   */
  async addVariation(sequencer, audioEngine, opts = {}) {
    const prompt = `Look at my current beat pattern and add creative variation. You can modify the existing pattern to add fills, change some hi-hat patterns, add ghost notes with lower velocity, or add/remove some steps to make it more interesting. Keep the overall feel the same but make it more dynamic.`;
    return this.produce(prompt, sequencer, audioEngine, opts);
  }

  /**
   * Quick action: Surprise random beat.
   */
  async surpriseMe(sequencer, audioEngine, opts = {}) {
    const randomGenre = AI_PRODUCER_GENRES[Math.floor(Math.random() * AI_PRODUCER_GENRES.length)];
    const randomMood = AI_PRODUCER_MOODS[Math.floor(Math.random() * AI_PRODUCER_MOODS.length)];
    const prompt = `Surprise me! Create a unique and creative ${randomGenre} beat with a ${randomMood} mood. Be experimental with the rhythms and patterns. Include both beat and mix-master settings. Make it something unexpected and interesting!`;
    return this.produce(prompt, sequencer, audioEngine, opts);
  }

  /**
   * Clear conversation history.
   */
  clearConversation() {
    this.conversation = [];
    this.undoStack = [];
  }

  cancel() {
    this.getActiveClient().cancel();
    this.isProcessing = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose
// ─────────────────────────────────────────────────────────────────────────────
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
