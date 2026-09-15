/**
 * FL Studio Clone — AI Beat Suggester
 *
 * Three components:
 *  1. MarkovLearner  — passively learns from user patterns, generates beats offline
 *  2. GeminiSuggester — calls Google Gemini REST API for intelligent suggestions
 *  3. AISuggester    — orchestrates both; exposes the high-level API used by the app
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_NAMES = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead'];
const CHANNEL_COLORS = ['#ff6a00', '#a855f7', '#06b6d4', '#22c55e', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'];

const GENRE_PRESETS = {
  'Hip-Hop':    { kickBias: 0.7, snareBias: 0.5, hihatDensity: 0.6, bpmRange: [80, 100] },
  'Trap':       { kickBias: 0.6, snareBias: 0.3, hihatDensity: 0.9, bpmRange: [130, 160] },
  'House':      { kickBias: 0.9, snareBias: 0.5, hihatDensity: 0.7, bpmRange: [120, 130] },
  'Drum & Bass':{ kickBias: 0.5, snareBias: 0.7, hihatDensity: 0.8, bpmRange: [160, 180] },
  'Reggaeton':  { kickBias: 0.8, snareBias: 0.6, hihatDensity: 0.5, bpmRange: [90, 100] },
  'Afrobeats':  { kickBias: 0.6, snareBias: 0.5, hihatDensity: 0.7, bpmRange: [100, 115] },
  'Lo-Fi':      { kickBias: 0.5, snareBias: 0.5, hihatDensity: 0.4, bpmRange: [70, 90] },
  'Electronic': { kickBias: 0.8, snareBias: 0.4, hihatDensity: 0.8, bpmRange: [128, 145] },
};

// Classic genre-based seed patterns (fallback)
const GENRE_SEEDS = {
  'Hip-Hop': {
    'Kick':    [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
    'Snare':   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    'Hi-Hat C':[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    'Hi-Hat O':[0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    'Clap':    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    'Tom':     [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
    'Bass':    [1,0,0,1, 0,0,0,0, 1,0,0,0, 0,1,0,0],
    'Lead':    [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
  },
  'Trap': {
    'Kick':    [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
    'Snare':   [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    'Hi-Hat C':[1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    'Hi-Hat O':[0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
    'Clap':    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    'Tom':     [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    'Bass':    [1,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
    'Lead':    [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,0,0,1],
  },
  'House': {
    'Kick':    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    'Snare':   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    'Hi-Hat C':[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    'Hi-Hat O':[0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1],
    'Clap':    [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    'Tom':     [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    'Bass':    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    'Lead':    [0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. MARKOV LEARNER
// ─────────────────────────────────────────────────────────────────────────────

class MarkovLearner {
  constructor() {
    // Per-channel: stepFreq[ch][step] = count of times step was active
    this.stepFreq = CHANNEL_NAMES.map(() => new Array(16).fill(0));
    // Per-channel: coOccurrence[ch][s1][s2] = count step s1 and s2 co-active
    this.coOccurrence = CHANNEL_NAMES.map(() =>
      Array.from({ length: 16 }, () => new Array(16).fill(0))
    );
    // Raw pattern history (capped at 50)
    this.patternHistory = [];
    this.patternCount   = 0;
    this._storageKey    = 'fl-studio-markov-v2';
    this._load();
  }

  // Learn from one pattern snapshot
  learn(channels) {
    const snap = channels.map(ch => [...ch.steps]);
    this.patternHistory.push(snap);
    if (this.patternHistory.length > 50) this.patternHistory.shift();
    this.patternCount++;

    snap.forEach((steps, ci) => {
      steps.forEach((active, si) => {
        if (active) {
          this.stepFreq[ci][si]++;
          steps.forEach((a2, si2) => {
            if (a2 && si2 !== si) this.coOccurrence[ci][si][si2]++;
          });
        }
      });
    });

    this._save();
  }

  // How many patterns have been learned (0–1 confidence, max at 20 patterns)
  confidence() {
    return Math.min(1, this.patternCount / 20);
  }

  // Per-channel activation probability (0–1)
  channelConfidence(channelIdx) {
    const freq = this.stepFreq[channelIdx];
    const total = freq.reduce((a, b) => a + b, 0);
    return Math.min(1, total / Math.max(1, this.patternCount * 4));
  }

  // Generate a new beat from learned probabilities
  generate(channels, strength = 0.7, preserveRatio = 0.3) {
    const result = channels.map((ch, ci) => {
      const steps = new Array(16).fill(0);
      const n = this.patternCount;

      for (let si = 0; si < 16; si++) {
        // Learned probability
        const learnedProb = n > 0 ? this.stepFreq[ci][si] / n : 0;
        // Current pattern's probability
        const currentProb = ch.steps[si] ? 1 : 0;
        // Blend
        const blended = learnedProb * strength + currentProb * (1 - strength);
        // Randomize with temperature
        const temperature = 0.3;
        const prob = blended + (Math.random() - 0.5) * temperature * 2;
        steps[si] = prob > 0.5 ? 1 : 0;
      }

      // Always ensure minimum musical sense: kick on beat 1 if ch is kick-like
      if (ci === 0 && steps.every(s => s === 0)) steps[0] = 1;

      return { name: ch.name, steps };
    });

    return result;
  }

  // Generate from a genre seed + learned patterns
  generateGenre(genre, channels, complexity = 0.5) {
    const seed = GENRE_SEEDS[genre] || GENRE_SEEDS['Hip-Hop'];
    const n = this.patternCount;

    return channels.map((ch, ci) => {
      const seedSteps = seed[ch.name] || new Array(16).fill(0);
      const steps = new Array(16).fill(0);

      for (let si = 0; si < 16; si++) {
        const learnedProb = n > 0 ? this.stepFreq[ci][si] / n : 0;
        const seedProb    = seedSteps[si];
        const mixRatio    = Math.min(0.7, n / 15); // more learned = more influence
        const base = seedProb * (1 - mixRatio) + learnedProb * mixRatio;
        // Complexity adds/removes random hits
        const jitter = (Math.random() - (1 - complexity)) * 0.6;
        steps[si] = (base + jitter) > 0.5 ? 1 : 0;
      }

      return { name: ch.name, steps };
    });
  }

  // Analyze current pattern
  analyze(channels) {
    const totalSteps = channels.reduce((sum, ch) => sum + ch.steps.filter(Boolean).length, 0);
    const density    = totalSteps / (channels.length * 16);
    const syncopation = this._calcSyncopation(channels);
    const genre      = this._guessGenre(channels);

    return {
      density: Math.round(density * 100),
      syncopation: Math.round(syncopation * 100),
      genre,
      totalHits: totalSteps,
      learnedPatterns: this.patternCount,
      confidence: Math.round(this.confidence() * 100),
    };
  }

  _calcSyncopation(channels) {
    // Off-beat step ratio (steps 2,4,6,8,10,12,14,16 = odd indices)
    let offBeat = 0, total = 0;
    channels.forEach(ch => {
      ch.steps.forEach((s, i) => {
        if (s) { total++; if (i % 2 === 1) offBeat++; }
      });
    });
    return total > 0 ? offBeat / total : 0;
  }

  _guessGenre(channels) {
    // Simple heuristic based on kick/snare/hihat patterns
    const kick   = channels.find(c => c.name.toLowerCase().includes('kick'));
    const snare  = channels.find(c => c.name.toLowerCase().includes('snare'));
    const hihat  = channels.find(c => c.name.toLowerCase().includes('hi-hat c'));

    if (!kick || !snare || !hihat) return 'Unknown';

    const kickCount  = kick.steps.filter(Boolean).length;
    const snareCount = snare.steps.filter(Boolean).length;
    const hihatCount = hihat.steps.filter(Boolean).length;

    if (kickCount === 4 && snareCount === 2) return 'House';
    if (kickCount >= 3 && hihatCount >= 12)  return 'Trap';
    if (kickCount <= 2 && snareCount <= 2)   return 'Hip-Hop';
    if (kickCount >= 3 && snareCount >= 3)   return 'Drum & Bass';
    if (hihatCount >= 8)                     return 'Electronic';
    return 'Custom';
  }

  _save() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({
        stepFreq:   this.stepFreq,
        patternCount: this.patternCount,
      }));
    } catch(e) {}
  }

  _load() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.stepFreq)    this.stepFreq    = data.stepFreq;
        if (data.patternCount) this.patternCount = data.patternCount;
      }
    } catch(e) {}
  }

  reset() {
    this.stepFreq      = CHANNEL_NAMES.map(() => new Array(16).fill(0));
    this.coOccurrence  = CHANNEL_NAMES.map(() =>
      Array.from({ length: 16 }, () => new Array(16).fill(0))
    );
    this.patternHistory = [];
    this.patternCount   = 0;
    localStorage.removeItem(this._storageKey);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. GEMINI SUGGESTER
// ─────────────────────────────────────────────────────────────────────────────

class GeminiSuggester {
  constructor() {
    this.apiKey  = localStorage.getItem('fl-studio-gemini-key') || '';
    this.model   = 'gemini-2.0-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  setApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem('fl-studio-gemini-key', this.apiKey);
  }

  hasKey() { return this.apiKey.length > 0; }

  // Encode pattern to readable text
  _encodePattern(channels, bpm) {
    const lines = channels.map(ch => {
      const steps = ch.steps.map((s, i) => {
        const sym = s ? '■' : '·';
        return i > 0 && i % 4 === 0 ? `| ${sym}` : sym;
      }).join(' ');
      return `${ch.name.padEnd(12)}: ${steps}`;
    });
    return `BPM: ${bpm}\n${lines.join('\n')}`;
  }

  // Build the Gemini prompt
  _buildPrompt(channels, bpm, genre, complexity, mode, userNote = '') {
    const patternText = this._encodePattern(channels, bpm);
    const complexityLabel = complexity < 0.33 ? 'Simple' : complexity < 0.66 ? 'Medium' : 'Complex';
    const modeDesc = mode === 'evolve'
      ? 'Create a variation/evolution of the current beat — keep some elements, add fresh ideas'
      : 'Create a completely fresh beat in this style — be creative and surprising';

    return `You are an expert music producer and beat programmer specializing in electronic music production.

CURRENT BEAT PATTERN (■ = hit, · = rest):
${patternText}

PARAMETERS:
- Genre: ${genre}
- Complexity: ${complexityLabel}
- Mode: ${mode === 'evolve' ? 'Evolve (variation)' : 'Fresh (new idea)'}
- ${userNote ? `User note: ${userNote}` : ''}

TASK: ${modeDesc}

Generate exactly 3 different beat suggestions. Each must be unique and musically interesting.

RESPOND WITH ONLY VALID JSON — no markdown, no code blocks, just raw JSON:
{
  "suggestions": [
    {
      "name": "Beat name (2-4 words, creative)",
      "description": "1-2 sentence description of the feel and vibe",
      "genre": "${genre}",
      "bpm": ${bpm},
      "bpmSuggestion": <optional new BPM or same as above>,
      "channels": {
        "Kick":     [16 values, each 0 or 1],
        "Clap":     [16 values, each 0 or 1],
        "Hi-Hat C": [16 values, each 0 or 1],
        "Hi-Hat O": [16 values, each 0 or 1],
        "Snare":    [16 values, each 0 or 1],
        "Tom":      [16 values, each 0 or 1],
        "Bass":     [16 values, each 0 or 1],
        "Lead":     [16 values, each 0 or 1]
      },
      "tips": ["Producer tip 1", "Producer tip 2"]
    }
  ]
}`;
  }

  async suggest(channels, bpm, genre, complexity, mode = 'evolve', userNote = '') {
    if (!this.hasKey()) throw new Error('No API key set');

    const prompt = this._buildPrompt(channels, bpm, genre, complexity, mode, userNote);
    const url = `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: mode === 'evolve' ? 0.7 : 1.0,
        maxOutputTokens: 2000,
        topP: 0.95,
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const msg = errBody?.error?.message || `HTTP ${resp.status}`;
      throw new Error(`Gemini API error: ${msg}`);
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip possible markdown fences
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Try to extract JSON from text
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse Gemini response as JSON');
    }

    // Validate and normalise suggestions
    const suggestions = (parsed.suggestions || [parsed]).map(s => ({
      name:          s.name        || 'AI Beat',
      description:   s.description || '',
      genre:         s.genre       || genre,
      bpm:           s.bpmSuggestion || s.bpm || bpm,
      channels:      this._normalizeChannels(s.channels || {}),
      tips:          s.tips || [],
      source:        'gemini',
    }));

    return suggestions.slice(0, 3);
  }

  _normalizeChannels(raw) {
    const result = {};
    CHANNEL_NAMES.forEach(name => {
      const val = raw[name] || raw[name.replace(' ', '-')] || [];
      result[name] = Array.from({ length: 16 }, (_, i) =>
        val[i] !== undefined ? (val[i] ? 1 : 0) : 0
      );
    });
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AI SUGGESTER (orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

class AISuggester {
  constructor() {
    this.markov  = new MarkovLearner();
    this.gemini  = new GeminiSuggester();

    // UI state
    this.genre      = 'Hip-Hop';
    this.complexity = 0.5;
    this.mode       = 'evolve';  // 'evolve' | 'fresh'
    this.userNote   = '';

    this._learnInterval = null;
    this._learnCounter  = 0;
  }

  // Called every N steps during playback to passively learn
  onPlayStep(channels) {
    this._learnCounter++;
    if (this._learnCounter % 64 === 0) {  // learn every ~4 bars at 120bpm
      this.markov.learn(channels);
    }
  }

  // Explicitly learn current pattern (e.g. when user clicks "Teach this")
  learnNow(channels) {
    this.markov.learn(channels);
    return this.markov.patternCount;
  }

  // Analyze current pattern
  analyze(channels) {
    return this.markov.analyze(channels);
  }

  // Generate suggestions (Gemini if key set, else Markov + genre seeds)
  async suggest(channels, bpm) {
    const hasGemini = this.gemini.hasKey();

    if (hasGemini) {
      // Use Gemini for intelligent suggestions
      const suggestions = await this.gemini.suggest(
        channels, bpm, this.genre, this.complexity, this.mode, this.userNote
      );
      return suggestions;
    } else {
      // Local generation: 3 variations using Markov + genre seeds
      return this._localSuggest(channels, bpm);
    }
  }

  _localSuggest(channels, bpm) {
    const suggestions = [];

    // Suggestion 1: Genre seed + learned blend
    const s1channels = this.markov.generateGenre(this.genre, channels, this.complexity);
    suggestions.push({
      name: `${this.genre} Groove`,
      description: `Classic ${this.genre} pattern${this.markov.patternCount > 0 ? ' blended with your learned style' : ''}.`,
      genre: this.genre,
      bpm,
      channels: this._arraysToDict(s1channels),
      tips: [
        'Try adjusting BPM for the right feel',
        'Add velocity variation for a more human groove',
      ],
      source: 'local',
    });

    // Suggestion 2: Markov variation (if enough patterns learned)
    const strength = this.markov.patternCount > 3 ? 0.6 : 0.3;
    const s2channels = this.markov.generate(channels, strength, 0.4);
    suggestions.push({
      name: this.markov.patternCount > 5 ? 'Learned Variation' : 'Randomized Variation',
      description: this.markov.patternCount > 5
        ? `Generated from your ${this.markov.patternCount} learned patterns — ${Math.round(this.markov.confidence()*100)}% style match.`
        : 'Randomized variation based on your current pattern.',
      genre: this.genre,
      bpm,
      channels: this._arraysToDict(s2channels),
      tips: [
        'Play more patterns to improve AI suggestions',
        `Learned ${this.markov.patternCount} patterns so far`,
      ],
      source: 'local',
    });

    // Suggestion 3: Complex variation (higher density)
    const complexChannels = this.markov.generateGenre(this.genre, channels, Math.min(1, this.complexity + 0.35));
    suggestions.push({
      name: 'Hyped Up',
      description: `Higher energy version — more hits, denser rhythm.`,
      genre: this.genre,
      bpm: Math.min(200, bpm + 4),
      channels: this._arraysToDict(complexChannels),
      tips: ['Good for drops or buildups', 'Consider muting channels for tension'],
      source: 'local',
    });

    return suggestions;
  }

  _arraysToDict(channelArrays) {
    const dict = {};
    channelArrays.forEach(ch => { dict[ch.name] = ch.steps; });
    return dict;
  }

  // Convert a suggestion's channel dict back to sequencer format
  applyToSequencer(suggestion, sequencer) {
    sequencer.channels.forEach(ch => {
      const steps = suggestion.channels[ch.name];
      if (steps) {
        ch.steps = [...steps];
        ch.velocity = ch.steps.map(s => s ? 0.8 + Math.random() * 0.2 : 0.8);
      }
    });
    if (suggestion.bpm && suggestion.bpm !== sequencer.bpm) {
      sequencer.bpm = suggestion.bpm;
    }
  }

  // Channel frequency data for visualization
  getChannelFrequencies() {
    return CHANNEL_NAMES.map((name, i) => ({
      name,
      color: CHANNEL_COLORS[i],
      confidence: this.markov.channelConfidence(i),
      stepFreq: this.markov.stepFreq[i].map(f =>
        Math.min(1, f / Math.max(1, this.markov.patternCount))
      ),
    }));
  }

  setApiKey(key)     { this.gemini.setApiKey(key); }
  hasApiKey()        { return this.gemini.hasKey(); }
  getApiKey()        { return this.gemini.apiKey; }
  setGenre(g)        { this.genre      = g; }
  setComplexity(v)   { this.complexity = v; }
  setMode(m)         { this.mode       = m; }
  setUserNote(n)     { this.userNote   = n; }
  resetLearning()    { this.markov.reset(); }
  getLearnedCount()  { return this.markov.patternCount; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expose
// ─────────────────────────────────────────────────────────────────────────────
window.AISuggester      = AISuggester;
window.MarkovLearner    = MarkovLearner;
window.GeminiSuggester  = GeminiSuggester;
window.GENRE_PRESETS    = GENRE_PRESETS;
window.CHANNEL_NAMES    = CHANNEL_NAMES;
window.CHANNEL_COLORS   = CHANNEL_COLORS;
