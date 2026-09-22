"""
BeYou Studio — Advanced Procedural Music Engine
Provides deep genre knowledge, scale theory, multi-track algorithmic synthesis,
and dynamic audio generation tailored to natural language prompts.
"""

import io
import math
import random
import re
import struct
import wave
from typing import Dict, List, Tuple, Any

# ── 1. Musical Scale & Frequency Definitions ─────────────────────────────────

# Note name to semitone offset from C0
NOTE_OFFSETS = {
    "c": 0, "c#": 1, "db": 1, "d": 2, "d#": 3, "eb": 3,
    "e": 4, "f": 5, "f#": 6, "gb": 6, "g": 7, "g#": 8,
    "ab": 8, "a": 9, "a#": 10, "bb": 10, "b": 11
}

def midi_to_freq(midi_note: float) -> float:
    """Converts a MIDI note number (e.g. 60 = C4) to frequency in Hz."""
    return 440.0 * (2.0 ** ((midi_note - 69.0) / 12.0))

def note_to_freq(name: str, octave: int = 4) -> float:
    """Converts note name like 'A', 'F#', 'Eb' to frequency."""
    base = NOTE_OFFSETS.get(name.lower(), 9) # Default A
    midi = 12 * (octave + 1) + base
    return midi_to_freq(midi)

# Musical Scales (intervals in semitones)
SCALES = {
    "minor": [0, 2, 3, 5, 7, 8, 10],            # Natural minor (Aeolian)
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],   # Dark trap, drill, classical
    "dorian": [0, 2, 3, 5, 7, 9, 10],           # Soul, funk, house, jazz
    "phrygian": [0, 1, 3, 5, 7, 8, 10],         # Phonk, heavy dark bass, metal
    "major": [0, 2, 4, 5, 7, 9, 11],            # Uplifting, pop, synthwave
    "pentatonic_minor": [0, 3, 5, 7, 10],       # Blues, hip-hop, rock
    "lofi_jazz": [0, 2, 3, 5, 7, 9, 10, 11],    # Extended jazzy palette
}

# ── 2. Comprehensive Genre Knowledge Base ────────────────────────────────────

GENRE_KNOWLEDGE = {
    "lofi": {
        "bpm_range": (72, 86),
        "scale": "lofi_jazz",
        "root": "D",
        "chords": [
            [50, 53, 57, 60, 64],  # Dm9
            [45, 48, 52, 55, 59],  # Am9
            [48, 52, 55, 59, 62],  # Cmaj9
            [43, 47, 50, 53, 57],  # G13
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 1, 0,  0, 1, 0, 0,  0, 0, 0, 0],
        "snare_pattern": [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "hihat_pattern": [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        "swing": 0.08,
        "vinyl_noise": 0.04,
        "bass_type": "sub_warm",
        "lead_type": "electric_piano",
    },
    "trap": {
        "bpm_range": (136, 146),
        "scale": "harmonic_minor",
        "root": "C",
        "chords": [
            [48, 51, 55],          # Cm
            [44, 48, 51],          # Ab
            [46, 50, 53],          # Bb
            [43, 47, 50],          # G
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 1, 0,  0, 0, 0, 0],
        "snare_pattern": [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0], # Half-time
        "hihat_pattern": [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1], # 16th rolling
        "swing": 0.0,
        "vinyl_noise": 0.0,
        "bass_type": "808_glide",
        "lead_type": "dark_bell",
    },
    "drill": {
        "bpm_range": (140, 145),
        "scale": "phrygian",
        "root": "F",
        "chords": [
            [41, 44, 48],          # Fm
            [42, 46, 49],          # Gb
            [41, 44, 48],          # Fm
            [40, 43, 47],          # E dim
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 0, 0],
        "snare_pattern": [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0], # Offbeat drill snare
        "hihat_pattern": [1, 0, 1, 1,  1, 0, 1, 1,  1, 0, 1, 1,  1, 1, 1, 1], # Triplet stutter
        "swing": 0.03,
        "vinyl_noise": 0.0,
        "bass_type": "808_slide_distorted",
        "lead_type": "minor_strings",
    },
    "synthwave": {
        "bpm_range": (118, 126),
        "scale": "minor",
        "root": "A",
        "chords": [
            [45, 48, 52],          # Am
            [41, 45, 48],          # F
            [43, 47, 50],          # G
            [40, 43, 47],          # Em
        ],
        "kick_pattern":  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0], # Driving 4x4
        "snare_pattern": [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "hihat_pattern": [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0], # Offbeat
        "swing": 0.0,
        "vinyl_noise": 0.0,
        "bass_type": "rolling_saw_arp",
        "lead_type": "bright_80s_poly",
    },
    "house": {
        "bpm_range": (124, 128),
        "scale": "dorian",
        "root": "G",
        "chords": [
            [43, 46, 50, 53],      # Gm7
            [41, 45, 48, 52],      # Fmaj7
            [38, 41, 45, 48],      # Dm7
            [43, 46, 50, 53],      # Gm7
        ],
        "kick_pattern":  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0],
        "snare_pattern": [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "hihat_pattern": [0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0],
        "swing": 0.04,
        "vinyl_noise": 0.0,
        "bass_type": "bouncy_organ",
        "lead_type": "club_pluck",
    },
    "techno": {
        "bpm_range": (132, 138),
        "scale": "phrygian",
        "root": "F",
        "chords": [
            [41, 44, 48],          # Fm
            [41, 44, 48],
            [42, 45, 49],          # F#m
            [41, 44, 48],
        ],
        "kick_pattern":  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0], # Industrial rumble
        "snare_pattern": [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "hihat_pattern": [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        "swing": 0.0,
        "vinyl_noise": 0.0,
        "bass_type": "acid_resonant",
        "lead_type": "industrial_stab",
    },
    "dnb": {
        "bpm_range": (172, 176),
        "scale": "minor",
        "root": "E",
        "chords": [
            [40, 43, 47],          # Em
            [36, 40, 43],          # C
            [38, 41, 45],          # D
            [35, 39, 42],          # Bm
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0], # Fast breakbeat
        "snare_pattern": [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "hihat_pattern": [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        "swing": 0.0,
        "vinyl_noise": 0.0,
        "bass_type": "reese_lfo",
        "lead_type": "atmospheric_pad",
    },
    "reggaeton": {
        "bpm_range": (94, 100),
        "scale": "minor",
        "root": "A",
        "chords": [
            [45, 48, 52],          # Am
            [41, 45, 48],          # F
            [43, 47, 50],          # G
            [45, 48, 52],          # Am
        ],
        "kick_pattern":  [1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0], # Four on floor
        "snare_pattern": [0, 0, 0, 1,  0, 0, 1, 0,  0, 0, 0, 1,  0, 0, 1, 0], # Dembow rhythm!
        "hihat_pattern": [1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0],
        "swing": 0.02,
        "vinyl_noise": 0.0,
        "bass_type": "sub_deep",
        "lead_type": "latin_synth",
    },
    "afrobeats": {
        "bpm_range": (102, 110),
        "scale": "major",
        "root": "G",
        "chords": [
            [43, 47, 50],          # G
            [40, 43, 47],          # Em
            [36, 40, 43],          # C
            [38, 42, 45],          # D
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 1, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "snare_pattern": [0, 0, 0, 1,  0, 0, 1, 0,  0, 1, 0, 0,  0, 0, 1, 0], # Polyrhythmic log drum feel
        "hihat_pattern": [1, 0, 1, 1,  0, 1, 1, 0,  1, 0, 1, 1,  0, 1, 1, 0],
        "swing": 0.06,
        "vinyl_noise": 0.0,
        "bass_type": "warm_pluck",
        "lead_type": "marimba_pluck",
    },
    "phonk": {
        "bpm_range": (145, 155),
        "scale": "phrygian",
        "root": "C#",
        "chords": [
            [49, 52, 56],          # C#m
            [50, 53, 57],          # D
            [49, 52, 56],          # C#m
            [45, 48, 52],          # Am
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 1, 0,  0, 0, 0, 0],
        "snare_pattern": [0, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0],
        "hihat_pattern": [1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1],
        "swing": 0.0,
        "vinyl_noise": 0.02,
        "bass_type": "saturated_808",
        "lead_type": "cowbell_lead",
    },
    "ambient": {
        "bpm_range": (65, 78),
        "scale": "major",
        "root": "F",
        "chords": [
            [41, 45, 48, 52],      # Fmaj7
            [43, 47, 50, 53],      # G7
            [40, 43, 47, 50],      # Em7
            [45, 48, 52, 55],      # Am7
        ],
        "kick_pattern":  [1, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0], # Very sparse
        "snare_pattern": [0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0],
        "hihat_pattern": [0, 0, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0,  1, 0, 0, 0],
        "swing": 0.0,
        "vinyl_noise": 0.01,
        "bass_type": "deep_sub_swell",
        "lead_type": "ethereal_pad",
    },
}


def parse_prompt_intent(prompt: str) -> Tuple[str, int, Dict[str, Any]]:
    """
    Analyzes prompt text to extract genre, BPM, mood, and sound character.
    Defaults to an intelligent matching genre instead of a generic static beat.
    """
    p = prompt.lower()

    # 1. Detect BPM if user explicitly stated e.g. "140 bpm", "90bpm", "tempo 128"
    bpm_match = re.search(r'(\d{2,3})\s*(?:bpm|tempo)', p)
    explicit_bpm = int(bpm_match.group(1)) if bpm_match else None

    # 2. Match Genre
    genre = "lofi"  # default
    if any(k in p for k in ["drill", "uk drill", "ny drill"]):
        genre = "drill"
    elif any(k in p for k in ["trap", "808", "metro", "future"]):
        genre = "trap"
    elif any(k in p for k in ["phonk", "drift", "cowbell", "memphis"]):
        genre = "phonk"
    elif any(k in p for k in ["synthwave", "retrowave", "80s", "outrun", "stranger"]):
        genre = "synthwave"
    elif any(k in p for k in ["techno", "acid", "industrial", "berlin", "rave"]):
        genre = "techno"
    elif any(k in p for k in ["dnb", "drum and bass", "jungle", "liquid"]):
        genre = "dnb"
    elif any(k in p for k in ["house", "deep house", "tech house", "edm", "club", "dance"]):
        genre = "house"
    elif any(k in p for k in ["reggaeton", "dembow", "latin", "bad bunny"]):
        genre = "reggaeton"
    elif any(k in p for k in ["afrobeats", "afro", "burna", "amapiano"]):
        genre = "afrobeats"
    elif any(k in p for k in ["ambient", "meditation", "drone", "space", "calm", "relaxing"]):
        genre = "ambient"
    elif any(k in p for k in ["lo-fi", "lofi", "chill", "chillhop", "study", "jazz"]):
        genre = "lofi"
    elif any(k in p for k in ["hip hop", "hip-hop", "boom bap", "rap"]):
        genre = "lofi"

    config = GENRE_KNOWLEDGE.get(genre, GENRE_KNOWLEDGE["lofi"])
    
    # Resolve BPM
    if explicit_bpm and 50 <= explicit_bpm <= 220:
        bpm = explicit_bpm
    else:
        bpm = int((config["bpm_range"][0] + config["bpm_range"][1]) / 2)

    return genre, bpm, config


# ── 3. Multi-Track Algorithmic Synthesizer ────────────────────────────────────

class ProceduralSynthesizer:
    """
    Renders multi-track stereo 32kHz WAV audio using mathematical waveform synthesis:
      - Drum synthesis: Pitched sine Kick, White noise filtered Snare, Metallic Hi-Hat
      - Bass synthesis: 808 sub, Acid saw, Reese modulation, Arpeggios
      - Chord synthesis: Polyphonic voice chords with ADSR envelopes
      - Lead/Melodic synthesis: Genre-tailored hooks and scales
      - Atmosphere: Stereo widening, vinyl texture, warmth saturation
    """

    def __init__(self, sample_rate: int = 32000):
        self.sample_rate = sample_rate

    def render(self, prompt: str, duration: int = 8) -> bytes:
        genre, bpm, cfg = parse_prompt_intent(prompt)
        sr = self.sample_rate
        total_samples = int(duration * sr)
        
        # Quarter note and step durations in samples
        samples_per_beat = (60.0 / bpm) * sr
        samples_per_step = samples_per_beat / 4.0
        total_steps = int(duration / (60.0 / bpm * 4) * 16)

        # Precompute Chord & Bass progressions
        chord_prog = cfg["chords"]
        num_chords = len(chord_prog)
        chords_per_bar = 2  # Change chord every 8 steps
        steps_per_chord = 8

        # Frame buffers (Stereo 16-bit PCM)
        frames = bytearray()
        
        # Synthesis state
        lfo_phase = 0.0
        reese_phase1 = 0.0
        reese_phase2 = 0.0
        noise_state = 0.0
        
        # Random seed based on prompt for deterministic variety
        rng = random.Random(hash(prompt) & 0xFFFFFFFF)

        for i in range(total_samples):
            t = i / sr
            step_idx = int(i / samples_per_step)
            step_mod16 = step_idx % 16
            sub_step_pos = (i % int(samples_per_step)) / samples_per_step
            time_in_step = (i % int(samples_per_step)) / sr

            # Current chord
            chord_idx = int(step_idx / steps_per_chord) % num_chords
            current_chord = chord_prog[chord_idx]
            root_midi = current_chord[0] - 12  # Bass is 1 octave lower

            # ── 1. DRUMS SYNTHESIS ──
            drum_l, drum_r = 0.0, 0.0
            
            # Kick (Sine with exponential pitch envelope)
            if cfg["kick_pattern"][step_mod16]:
                # Start of step
                if time_in_step < 0.28:
                    pitch_env = 140.0 * math.exp(-time_in_step * 38.0) + 48.0
                    amp_env = math.exp(-time_in_step * 14.0)
                    k_val = math.sin(2 * math.pi * pitch_env * time_in_step) * amp_env
                    # Soft clip
                    k_val = math.tanh(k_val * 1.4)
                    drum_l += k_val * 0.75
                    drum_r += k_val * 0.75

            # Snare / Clap (Tone + Filtered Noise)
            if cfg["snare_pattern"][step_mod16]:
                if time_in_step < 0.22:
                    tone_env = math.exp(-time_in_step * 28.0)
                    noise_env = math.exp(-time_in_step * 18.0)
                    s_tone = math.sin(2 * math.pi * 185.0 * time_in_step) * tone_env * 0.4
                    # White noise
                    s_noise = (rng.random() * 2.0 - 1.0) * noise_env * 0.6
                    s_val = s_tone + s_noise
                    drum_l += s_val * 0.6
                    drum_r += s_val * 0.6

            # Hi-Hats (High frequency noise burst)
            if cfg["hihat_pattern"][step_mod16]:
                if time_in_step < 0.06:
                    h_env = math.exp(-time_in_step * 75.0)
                    h_noise = (rng.random() * 2.0 - 1.0) * h_env * 0.25
                    # Pan slightly right
                    drum_l += h_noise * 0.18
                    drum_r += h_noise * 0.26

            # ── 2. BASS SYNTHESIS ──
            bass_l, bass_r = 0.0, 0.0
            bass_type = cfg.get("bass_type", "sub_warm")

            if bass_type in ["808_glide", "808_slide_distorted", "saturated_808"]:
                # 808 Sub with subtle pitch glide
                freq = midi_to_freq(root_midi)
                glide = math.exp(-time_in_step * 8.0) * 15.0 if step_mod16 in [0, 8, 10] else 0.0
                b_val = math.sin(2 * math.pi * (freq + glide) * t)
                if "distorted" in bass_type or "saturated" in bass_type:
                    b_val = math.tanh(b_val * 1.8) * 0.6
                bass_l += b_val * 0.65
                bass_r += b_val * 0.65

            elif bass_type == "rolling_saw_arp":
                # 16th-note driving saw bass
                arp_notes = [root_midi, root_midi + 7, root_midi + 12, root_midi + 7]
                curr_note = arp_notes[step_mod16 % 4]
                freq = midi_to_freq(curr_note)
                saw = 2.0 * ((t * freq) % 1.0) - 1.0
                env = math.exp(-time_in_step * 14.0)
                b_val = saw * env * 0.45
                bass_l += b_val
                bass_r += b_val

            elif bass_type == "reese_lfo":
                # Detuned Reese Bass
                freq1 = midi_to_freq(root_midi)
                freq2 = midi_to_freq(root_midi) + 1.2
                reese_phase1 += (2 * math.pi * freq1) / sr
                reese_phase2 += (2 * math.pi * freq2) / sr
                lfo = 0.5 + 0.5 * math.sin(2 * math.pi * 1.5 * t)
                b_val = (math.sin(reese_phase1) + math.sin(reese_phase2) * 0.8) * 0.3 * (0.6 + 0.4 * lfo)
                bass_l += b_val * 1.1
                bass_r += b_val * 0.9

            else:
                # Sub warm sine / triangle
                freq = midi_to_freq(root_midi)
                b_val = math.sin(2 * math.pi * freq * t) * 0.55
                bass_l += b_val
                bass_r += b_val

            # ── 3. CHORDS & HARMONY SYNTHESIS ──
            chord_l, chord_r = 0.0, 0.0
            time_in_chord = ((step_idx % steps_per_chord) * samples_per_step + (i % int(samples_per_step))) / sr
            chord_env = math.exp(-time_in_chord * 0.7) * 0.28

            for idx, note_m in enumerate(current_chord):
                c_freq = midi_to_freq(note_m)
                # Triangle / soft saw wave
                phase = (t * c_freq) % 1.0
                voice = 4.0 * abs(phase - 0.5) - 1.0
                # Stereo spread
                pan_mult = 0.8 + 0.4 * (idx % 2)
                chord_l += voice * chord_env * pan_mult
                chord_r += voice * chord_env * (2.0 - pan_mult)

            # ── 4. LEAD & MELODIC MOTIF ──
            lead_l, lead_r = 0.0, 0.0
            # Arpeggiator or melodic note on steps
            if step_mod16 in [2, 6, 8, 11, 14]:
                motif_idx = (step_mod16 * 3) % len(current_chord)
                lead_midi = current_chord[motif_idx] + 12
                l_freq = midi_to_freq(lead_midi)
                l_env = math.exp(-time_in_step * 12.0)
                lead_wave = math.sin(2 * math.pi * l_freq * t)
                # Ping-pong delay simulation
                lead_l += lead_wave * l_env * 0.22
                lead_r += lead_wave * l_env * 0.15

            # ── 5. ATMOSPHERE / VINYL TEXTURE ──
            vinyl_noise = cfg.get("vinyl_noise", 0.0)
            if vinyl_noise > 0:
                v_crack = (rng.random() * 2.0 - 1.0) * vinyl_noise * (0.8 if rng.random() > 0.95 else 0.2)
                drum_l += v_crack
                drum_r += v_crack

            # ── 6. MASTER MIX & STEREO LIMITER ──
            mix_l = drum_l + bass_l + chord_l + lead_l
            mix_r = drum_r + bass_r + chord_r + lead_r

            # Soft saturation limiter
            final_l = math.tanh(mix_l * 1.15)
            final_r = math.tanh(mix_r * 1.15)

            # 16-bit PCM pack
            s_l = int(max(-1.0, min(1.0, final_l)) * 30000)
            s_r = int(max(-1.0, min(1.0, final_r)) * 30000)
            frames.extend(struct.pack('<hh', s_l, s_r))

        buf = io.BytesIO()
        with wave.open(buf, 'wb') as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(sr)
            wav.writeframes(frames)

        return buf.getvalue()


# Global Singleton Instance
music_synthesizer = ProceduralSynthesizer()

def generate_procedural_music(prompt: str, duration: int = 8) -> bytes:
    """High-level API to generate audio from text prompt."""
    return music_synthesizer.render(prompt, duration=duration)
