"""
BeYou Studio — Runtime Pattern Learner
=======================================

Loads real drum patterns extracted from the Groove MIDI Dataset and
blends them with the rule-based beat_ai.py system at runtime.

After running `python scripts/train_from_groove.py`, this module
automatically picks up real patterns from data/learned_patterns.json.
"""

import json
import random
from pathlib import Path
from typing import Dict, List, Optional, Any

_BACKEND_DIR   = Path(__file__).resolve().parent
_PROJECT_ROOT  = _BACKEND_DIR.parent
_PATTERNS_JSON = _PROJECT_ROOT / "data" / "learned_patterns.json"

CHANNELS = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead']

# ─── Cached state ─────────────────────────────────────────────────────────────
_LEARNED_PATTERNS: Optional[Dict[str, List[Dict]]] = None
_TRAINED = False


def _load_patterns() -> Dict[str, List[Dict]]:
    global _LEARNED_PATTERNS, _TRAINED
    if _LEARNED_PATTERNS is not None:
        return _LEARNED_PATTERNS

    if not _PATTERNS_JSON.exists():
        _LEARNED_PATTERNS = {}
        _TRAINED = False
        return _LEARNED_PATTERNS

    try:
        with open(_PATTERNS_JSON, 'r', encoding='utf-8') as f:
            data = json.load(f)
        _LEARNED_PATTERNS = data
        _TRAINED = True
        total = sum(len(v) for v in data.values())
        print(f"[PatternLearner] Loaded {total} real patterns across "
              f"{len(data)} genres from Groove MIDI Dataset")
    except Exception as e:
        print(f"[PatternLearner] Could not load patterns: {e}")
        _LEARNED_PATTERNS = {}
        _TRAINED = False

    return _LEARNED_PATTERNS


def is_trained() -> bool:
    _load_patterns()
    return _TRAINED


def get_learned_pattern(genre: str) -> Optional[Dict[str, List[int]]]:
    patterns = _load_patterns()
    genre_pats = patterns.get(genre, [])
    if not genre_pats:
        return None
    return dict(random.choice(genre_pats))


def blend_patterns(
    rule_based: Dict[str, List[int]],
    learned: Dict[str, List[int]],
    blend: float = 0.6,
) -> Dict[str, List[int]]:
    """
    Blend rule-based and real-drummer patterns step by step.
    blend=0.0 -> 100% rule-based, blend=1.0 -> 100% real data.
    Bass/Lead always stay rule-based (more musical intent).
    """
    result = {}
    for ch in CHANNELS:
        r_steps = rule_based.get(ch, [0] * 16)
        l_steps = learned.get(ch, [0] * 16)
        if ch in ('Bass', 'Lead'):
            result[ch] = list(r_steps)
        else:
            result[ch] = [
                l_steps[i] if random.random() < blend else r_steps[i]
                for i in range(16)
            ]
    return result


def get_best_pattern(
    genre: str,
    rule_based_pattern: Dict[str, List[int]],
    use_real: bool = True,
    blend: float = 0.6,
) -> Dict[str, List[int]]:
    """
    Main API: return the best pattern for a genre,
    blending rule-based + real data when available.
    """
    if not use_real:
        return dict(rule_based_pattern)
    learned = get_learned_pattern(genre)
    if learned is None:
        return dict(rule_based_pattern)
    return blend_patterns(rule_based_pattern, learned, blend)


def get_status() -> Dict[str, Any]:
    patterns = _load_patterns()
    genre_counts = {g: len(p) for g, p in patterns.items()}
    total = sum(genre_counts.values())
    return {
        'trained': _TRAINED,
        'total_learned_patterns': total,
        'genres_with_real_data': list(genre_counts.keys()),
        'patterns_per_genre': genre_counts,
        'data_source': 'Google Magenta Groove MIDI Dataset (CC BY 4.0)' if _TRAINED else None,
        'training_script': 'python scripts/train_from_groove.py',
    }


def inject_pattern(submission: dict) -> bool:
    """
    Injects a crowd-sourced pattern from a Train Max submission directly into
    the learned pattern store so Max can use it immediately.
    Returns True if successful.
    """
    import json as _json
    genre = (submission.get("genre") or "other").lower().strip()
    try:
        raw = submission.get("pattern_json", "{}")
        data = _json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return False

    # Normalise to {channel_name: [0/1, ...]} with 16 steps
    normalised = {}
    if isinstance(data, dict):
        for ch, steps in data.items():
            if isinstance(steps, list):
                # Ensure 16 steps, convert truthy values to 1
                padded = [1 if v else 0 for v in steps[:16]]
                padded += [0] * (16 - len(padded))
                normalised[str(ch).lower().strip()] = padded

    if not normalised:
        return False

    # Load current patterns and append
    patterns = _load_patterns()
    if genre not in patterns:
        patterns[genre] = []
    patterns[genre].append(normalised)

    # Persist
    try:
        PATTERNS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PATTERNS_FILE, "w") as f:
            _json.dump(patterns, f)
        global _TRAINED
        _TRAINED = True
        return True
    except Exception as e:
        print(f"[inject_pattern] Write failed: {e}")
        return False
