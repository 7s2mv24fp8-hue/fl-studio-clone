/**
 * FL Studio Clone — AI Music Generator (Hugging Face MusicGen)
 *
 * Three components:
 *  1. HuggingFaceMusic  — API client for MusicGen inference
 *  2. PromptBuilder     — context-aware prompt generation from DAW state
 *  3. MusicAI           — orchestrator exposing high-level API
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MUSICGEN_MODELS = {
  small:  'facebook/musicgen-small',
  medium: 'facebook/musicgen-medium',
};

const GENRE_PROMPT_MAP = {
  'Hip-Hop':    'hip-hop beat, boom bap drums, deep bass, vinyl crackle',
  'Trap':       'trap beat, 808 bass, rapid hi-hats, dark synths',
  'House':      'house music, four-on-the-floor kick, offbeat hi-hats, deep bass',
  'Drum & Bass':'drum and bass, breakbeat, fast tempo, rolling bass',
  'Reggaeton':  'reggaeton dembow rhythm, latin percussion, bass',
  'Afrobeats':  'afrobeats, african percussion, groovy bass, rhythmic',
  'Lo-Fi':      'lo-fi hip hop, mellow piano, vinyl crackle, chill, relaxing',
  'Electronic': 'electronic music, synthesizers, pulsing bass, arpeggios',
  'Custom':     'instrumental beat, rhythmic, musical',
  'Unknown':    'instrumental beat, rhythmic percussion, bass',
};

const MOOD_TAGS = [
  'energetic', 'chill', 'dark', 'uplifting', 'melancholic', 'aggressive',
  'dreamy', 'groovy', 'atmospheric', 'funky', 'epic', 'minimal',
];

const INSTRUMENT_TAGS = [
  'piano', 'guitar', 'synth', 'strings', 'brass', 'flute', 'organ',
  'bells', 'pad', 'pluck', 'saxophone', 'violin',
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. HUGGING FACE MUSIC CLIENT
// ─────────────────────────────────────────────────────────────────────────────

class HuggingFaceMusic {
  constructor() {
    this.apiKey    = localStorage.getItem('fl-studio-hf-key') || '';
    this.modelId   = MUSICGEN_MODELS.small;
    this.baseUrl   = 'https://api-inference.huggingface.co/models';
    this._abortCtrl = null;
  }

  setApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem('fl-studio-hf-key', this.apiKey);
  }

  hasKey() { return this.apiKey.length > 0; }

  setModel(size) {
    this.modelId = MUSICGEN_MODELS[size] || MUSICGEN_MODELS.small;
  }

  /**
   * Generate music audio from a text prompt.
   * @param {string} prompt - Text description of the music to generate
   * @param {object} opts - Options
   * @param {Function} opts.onStatus - Status callback ('loading' | 'generating' | 'done' | 'error')
   * @returns {Promise<{blob: Blob, url: string}>} Generated audio blob + object URL
   */
  async generate(prompt, { onStatus = () => {} } = {}) {
    if (!this.hasKey()) throw new Error('No Hugging Face API key set');

    // Cancel any in-progress generation
    if (this._abortCtrl) {
      this._abortCtrl.abort();
    }
    this._abortCtrl = new AbortController();

    const url = `${this.baseUrl}/${this.modelId}`;
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        onStatus(attempt === 0 ? 'generating' : 'loading');

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ inputs: prompt }),
          signal: this._abortCtrl.signal,
        });

        // Model loading — wait and retry
        if (resp.status === 503) {
          const body = await resp.json().catch(() => ({}));
          const waitTime = body.estimated_time
            ? Math.min(body.estimated_time * 1000, 30000)
            : (attempt + 1) * 10000;
          onStatus('loading');
          await this._sleep(waitTime);
          continue;
        }

        // Rate limit
        if (resp.status === 429) {
          throw new Error('Rate limit reached. Please wait a minute and try again.');
        }

        // Auth error
        if (resp.status === 401 || resp.status === 403) {
          throw new Error('Invalid or expired Hugging Face API key.');
        }

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${resp.status}`);
        }

        // Success — response is audio binary
        const blob = await resp.blob();
        const audioUrl = URL.createObjectURL(blob);
        onStatus('done');
        this._abortCtrl = null;
        return { blob, url: audioUrl };

      } catch (err) {
        if (err.name === 'AbortError') {
          onStatus('cancelled');
          throw new Error('Generation cancelled');
        }
        lastError = err;
        if (attempt < maxRetries - 1 && err.message.includes('503')) {
          await this._sleep((attempt + 1) * 5000);
        }
      }
    }

    onStatus('error');
    this._abortCtrl = null;
    throw lastError || new Error('Failed to generate music after retries');
  }

  cancel() {
    if (this._abortCtrl) {
      this._abortCtrl.abort();
      this._abortCtrl = null;
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────

class PromptBuilder {
  /**
   * Build a music generation prompt from DAW context.
   */
  static build({ bpm = 120, genre = 'Hip-Hop', density = 50, syncopation = 30,
                  moods = [], instruments = [], userText = '' } = {}) {
    const parts = [];

    // Genre base
    const genreDesc = GENRE_PROMPT_MAP[genre] || GENRE_PROMPT_MAP['Unknown'];
    parts.push(genreDesc);

    // BPM context
    if (bpm < 90) parts.push('slow tempo');
    else if (bpm > 150) parts.push('fast tempo, high energy');
    else if (bpm > 120) parts.push('medium-fast tempo');

    // Density context
    if (density > 70) parts.push('dense, layered');
    else if (density < 30) parts.push('sparse, minimal');

    // Syncopation
    if (syncopation > 60) parts.push('syncopated, off-beat accents');

    // Moods
    if (moods.length > 0) parts.push(moods.join(', '));

    // Instruments
    if (instruments.length > 0) parts.push(instruments.join(', '));

    // User text
    if (userText.trim()) parts.push(userText.trim());

    // Quality suffix
    parts.push('high quality, studio production');

    return parts.join(', ');
  }

  /**
   * Generate a prompt from current AISuggester analysis.
   */
  static fromAnalysis(analysis, bpm, moods = [], instruments = [], userText = '') {
    return PromptBuilder.build({
      bpm,
      genre: analysis.genre || 'Unknown',
      density: analysis.density || 50,
      syncopation: analysis.syncopation || 30,
      moods,
      instruments,
      userText,
    });
  }

  /**
   * Quick preset prompts.
   */
  static presets() {
    return [
      { label: '🎹 Lo-Fi Chill',        prompt: 'lo-fi hip hop, mellow piano, vinyl crackle, chill, relaxing, rainy day, high quality' },
      { label: '🔥 Trap Banger',         prompt: 'trap beat, heavy 808 bass, rapid hi-hats, dark synths, aggressive, high energy, studio quality' },
      { label: '🏠 Deep House',           prompt: 'deep house music, four-on-the-floor kick, warm bass, atmospheric pads, groovy, high quality' },
      { label: '🎸 Acoustic Vibes',       prompt: 'acoustic guitar, warm fingerpicking, gentle percussion, folk, intimate, high quality' },
      { label: '🌌 Ambient Space',        prompt: 'ambient music, ethereal pads, reverb, atmospheric, dreamy, space, cinematic, high quality' },
      { label: '🥁 Drum & Bass Energy',   prompt: 'drum and bass, fast breakbeat, rolling bass, energetic, jungle, high quality' },
      { label: '🎷 Jazz Lounge',          prompt: 'jazz, smooth saxophone, piano chords, upright bass, relaxed, lounge, high quality' },
      { label: '🎮 Retro Synthwave',      prompt: 'synthwave, 80s retro, arpeggiated synth, driving bass, neon, cinematic, high quality' },
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. GENERATION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

class GenerationHistory {
  constructor() {
    this._storageKey = 'fl-studio-music-ai-history';
    this.items = this._load();
    this._blobUrls = new Map();
  }

  add(prompt, blob, url) {
    const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      prompt,
      timestamp: Date.now(),
      size: blob.size,
      type: blob.type,
    };
    this.items.unshift(entry);
    if (this.items.length > 20) this.items.pop();
    this._blobUrls.set(id, url);
    this._save();
    return entry;
  }

  getUrl(id) {
    return this._blobUrls.get(id) || null;
  }

  remove(id) {
    const url = this._blobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this._blobUrls.delete(id);
    }
    this.items = this.items.filter(i => i.id !== id);
    this._save();
  }

  clear() {
    this._blobUrls.forEach(url => URL.revokeObjectURL(url));
    this._blobUrls.clear();
    this.items = [];
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(this.items));
    } catch (e) { /* quota exceeded */ }
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MUSIC AI (orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

class MusicAI {
  constructor() {
    this.hf       = new HuggingFaceMusic();
    this.history  = new GenerationHistory();

    this.isGenerating = false;
    this.currentAudio = null;
    this.selectedMoods = [];
    this.selectedInstruments = [];
  }

  setApiKey(key) { this.hf.setApiKey(key); }
  hasApiKey()    { return this.hf.hasKey(); }
  getApiKey()    { return this.hf.apiKey; }

  async generate(prompt, { onStatus = () => {} } = {}) {
    if (this.isGenerating) {
      this.hf.cancel();
      await new Promise(r => setTimeout(r, 100));
    }

    this.isGenerating = true;
    try {
      const result = await this.hf.generate(prompt, { onStatus });
      const entry = this.history.add(prompt, result.blob, result.url);
      this.isGenerating = false;
      return { ...result, entry };
    } catch (err) {
      this.isGenerating = false;
      throw err;
    }
  }

  async generateFromContext(analysis, bpm, userText = '', { onStatus = () => {} } = {}) {
    const prompt = PromptBuilder.fromAnalysis(
      analysis, bpm, this.selectedMoods, this.selectedInstruments, userText
    );
    return this.generate(prompt, { onStatus });
  }

  play(url) {
    this.stop();
    this.currentAudio = new Audio(url);
    this.currentAudio.play().catch(() => {});
    return this.currentAudio;
  }

  stop() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
  }

  download(url, filename = 'ai-generated-music.wav') {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async toAudioBuffer(blob, audioContext) {
    const arrayBuffer = await blob.arrayBuffer();
    return audioContext.decodeAudioData(arrayBuffer);
  }

  cancel() {
    this.hf.cancel();
    this.isGenerating = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose
// ─────────────────────────────────────────────────────────────────────────────
window.MusicAI          = MusicAI;
window.HuggingFaceMusic = HuggingFaceMusic;
window.PromptBuilder    = PromptBuilder;
window.GenerationHistory = GenerationHistory;
window.MOOD_TAGS        = MOOD_TAGS;
window.INSTRUMENT_TAGS  = INSTRUMENT_TAGS;
