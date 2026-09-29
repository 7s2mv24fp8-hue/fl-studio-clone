#!/usr/bin/env python3
"""
BeYou Studio — Real Music Training Pipeline
============================================

Downloads Google Magenta's Groove MIDI Dataset (real human drumming recordings),
extracts authentic 16-step drum patterns, clusters them by genre/BPM, and
auto-updates beat_ai.py with real learned patterns.

Dataset: https://magenta.tensorflow.org/datasets/groove
License: Creative Commons Attribution 4.0 International (CC BY 4.0)

Usage:
    pip install pretty_midi numpy
    python scripts/train_from_groove.py
"""

import os
import sys
import json
import shutil
import zipfile
import urllib.request
import urllib.error
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Optional

# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKEND_DIR  = PROJECT_ROOT / "backend"
DATA_DIR     = PROJECT_ROOT / "data"
CACHE_DIR    = DATA_DIR / "groove_cache"

PATTERNS_JSON = DATA_DIR / "learned_patterns.json"
BEAT_AI_FILE  = BACKEND_DIR / "beat_ai.py"

# Groove MIDI Dataset (MIDI-only, ~90 MB zipped)
GROOVE_URL      = "https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip"
GROOVE_ZIP_PATH = CACHE_DIR / "groove-v1.0.0-midionly.zip"
GROOVE_EXTRACT  = CACHE_DIR / "groove"

MAX_PATTERNS_PER_GENRE = 5
MIN_TOTAL_HITS         = 8

# ─────────────────────────────────────────────────────────────────────────────
# GM DRUM MAP → BeYou channels
# ─────────────────────────────────────────────────────────────────────────────

GM_DRUM_MAP = {
    35: 'Kick', 36: 'Kick',
    38: 'Snare', 40: 'Snare', 37: 'Snare',
    39: 'Clap',
    42: 'Hi-Hat C', 44: 'Hi-Hat C', 51: 'Hi-Hat C', 53: 'Hi-Hat C', 59: 'Hi-Hat C',
    46: 'Hi-Hat O', 49: 'Hi-Hat O', 57: 'Hi-Hat O',
    41: 'Tom', 43: 'Tom', 45: 'Tom', 47: 'Tom', 48: 'Tom', 50: 'Tom',
}

CHANNELS = ['Kick', 'Clap', 'Hi-Hat C', 'Hi-Hat O', 'Snare', 'Tom', 'Bass', 'Lead']

# ─────────────────────────────────────────────────────────────────────────────
# GENRE CLASSIFICATION
# ─────────────────────────────────────────────────────────────────────────────

GROOVE_STYLE_MAP = {
    'funk': 'r&b', 'soul': 'r&b', 'jazz': 'jazz', 'bossa': 'jazz',
    'blues': 'hip-hop', 'rock': 'rock', 'pop': 'pop', 'country': 'rock',
    'latin': 'latin', 'afro': 'afrobeats', 'reggae': 'reggaeton',
    'hip': 'hip-hop', 'rap': 'hip-hop', 'dance': 'house',
    'electronic': 'electronic', 'ballad': 'lo-fi', 'gospel': 'gospel',
    'punk': 'rock', 'metal': 'rock', 'shuffle': 'jazz',
}

MELODIC_FILLS = {
    'trap':       {'Bass': [1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0], 'Lead': [0,0,1,0,0,0,0,0,0,0,1,0,0,1,0,0]},
    'drill':      {'Bass': [1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0], 'Lead': [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]},
    'hip-hop':    {'Bass': [1,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0], 'Lead': [0,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0]},
    'lo-fi':      {'Bass': [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], 'Lead': [0,0,1,0,0,0,0,1,0,0,1,0,0,0,0,0]},
    'house':      {'Bass': [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0], 'Lead': [0,1,0,0,0,1,0,0,0,1,0,0,0,1,0,0]},
    'techno':     {'Bass': [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0], 'Lead': [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]},
    'dnb':        {'Bass': [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0], 'Lead': [0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1]},
    'reggaeton':  {'Bass': [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], 'Lead': [0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0]},
    'afrobeats':  {'Bass': [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0], 'Lead': [0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0]},
    'synthwave':  {'Bass': [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0], 'Lead': [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0]},
    'phonk':      {'Bass': [1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,0], 'Lead': [0,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0]},
    'ambient':    {'Bass': [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], 'Lead': [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]},
    'r&b':        {'Bass': [1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0], 'Lead': [0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0]},
    'pop':        {'Bass': [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], 'Lead': [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]},
    'rock':       {'Bass': [1,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0], 'Lead': [0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0]},
    'jazz':       {'Bass': [1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0], 'Lead': [0,0,1,0,0,0,0,0,0,0,0,0,0,0,1,0]},
    'uk garage':  {'Bass': [1,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0], 'Lead': [0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0]},
    'electronic': {'Bass': [1,0,0,1,0,0,1,0,0,0,0,1,0,0,1,0], 'Lead': [0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0]},
    'latin':      {'Bass': [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0], 'Lead': [0,0,1,0,0,0,0,1,0,0,1,0,0,1,0,0]},
    'gospel':     {'Bass': [1,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0], 'Lead': [0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,1]},
}

def classify_groove_style(style_str: str) -> str:
    s = style_str.lower()
    for key, genre in GROOVE_STYLE_MAP.items():
        if key in s:
            return genre
    return 'hip-hop'

# ─────────────────────────────────────────────────────────────────────────────
# DOWNLOAD
# ─────────────────────────────────────────────────────────────────────────────

def download_with_progress(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  ⬇  Downloading {url}")
    print(f"     → {dest}")

    def reporthook(count, block_size, total_size):
        if total_size > 0:
            pct = min(100, count * block_size * 100 // total_size)
            mb_done  = count * block_size / 1_048_576
            mb_total = total_size / 1_048_576
            bar = '█' * (pct // 5) + '░' * (20 - pct // 5)
            print(f"\r     [{bar}] {pct:3d}%  {mb_done:.1f}/{mb_total:.1f} MB", end='', flush=True)

    urllib.request.urlretrieve(url, dest, reporthook)
    print()

def ensure_groove_dataset() -> Path:
    if GROOVE_EXTRACT.exists() and any(GROOVE_EXTRACT.rglob("*.mid")):
        print(f"  ✓ Cached at {GROOVE_EXTRACT}")
        return GROOVE_EXTRACT

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not GROOVE_ZIP_PATH.exists():
        download_with_progress(GROOVE_URL, GROOVE_ZIP_PATH)

    print(f"  📦 Extracting…")
    with zipfile.ZipFile(GROOVE_ZIP_PATH, 'r') as zf:
        zf.extractall(GROOVE_EXTRACT)
    print(f"  ✓ Extracted → {GROOVE_EXTRACT}")
    return GROOVE_EXTRACT

# ─────────────────────────────────────────────────────────────────────────────
# MIDI PARSING
# ─────────────────────────────────────────────────────────────────────────────

def try_import_pretty_midi():
    try:
        import pretty_midi
        return pretty_midi
    except ImportError:
        return None

def install_deps():
    import subprocess
    print("  📦 Installing pretty_midi + numpy…")
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pretty_midi', 'numpy', '-q'])

def midi_to_16step_grid(midi_path: Path, pm) -> Optional[Dict[str, List[int]]]:
    try:
        midi = pm.PrettyMIDI(str(midi_path))
    except Exception:
        return None

    drum_track = None
    for inst in midi.instruments:
        if inst.is_drum:
            drum_track = inst
            break

    if drum_track is None or not drum_track.notes:
        return None

    try:
        bpm = midi.estimate_tempo()
    except Exception:
        bpm = 120.0

    bpm = max(40.0, min(220.0, bpm))
    beat_dur = 60.0 / bpm
    step_dur = beat_dur / 4.0

    grid = {ch: [0] * 16 for ch in CHANNELS}

    for note in drum_track.notes:
        channel = GM_DRUM_MAP.get(note.pitch)
        if channel is None:
            continue
        t = note.start % (beat_dur * 4)
        step_idx = int(round(t / step_dur)) % 16
        if note.velocity > 10:
            grid[channel][step_idx] = 1

    return grid

def compute_quality(grid: Dict[str, List[int]]) -> float:
    total_hits = sum(sum(v) for v in grid.values())
    if total_hits < MIN_TOTAL_HITS:
        return 0.0
    kick_on_1     = grid['Kick'][0]
    snare_on_back = max(grid['Snare'][4], grid['Snare'][8])
    hihat_active  = sum(grid['Hi-Hat C']) > 2
    return 0.3 * kick_on_1 + 0.3 * snare_on_back + 0.4 * (1.0 if hihat_active else 0.0)

def deduplicate(patterns):
    seen, unique = set(), []
    for p in patterns:
        key = tuple(p.get('Kick',[])) + tuple(p.get('Snare',[])) + tuple(p.get('Hi-Hat C',[]))
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique

# ─────────────────────────────────────────────────────────────────────────────
# INFO CSV
# ─────────────────────────────────────────────────────────────────────────────

def load_info_csv(groove_root: Path) -> Dict[str, str]:
    results = list(groove_root.rglob("info.csv"))
    if not results:
        return {}
    import csv
    style_map = {}
    with open(results[0], 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            midi_file = row.get('midi_filename', row.get('filename', ''))
            style     = row.get('style', 'unknown')
            if midi_file:
                style_map[Path(midi_file).name] = style
    return style_map

# ─────────────────────────────────────────────────────────────────────────────
# EXTRACTION + SELECTION
# ─────────────────────────────────────────────────────────────────────────────

def extract_patterns(groove_root: Path, pm) -> Dict[str, List]:
    style_map  = load_info_csv(groove_root)
    midi_files = list(groove_root.rglob("*.mid")) + list(groove_root.rglob("*.midi"))
    print(f"  🎵 {len(midi_files)} MIDI files found | {len(style_map)} style tags loaded")

    genre_patterns: Dict[str, List] = defaultdict(list)
    processed = skipped = 0

    for midi_path in midi_files:
        fname     = midi_path.name
        style_tag = style_map.get(fname, midi_path.parent.name)
        genre     = classify_groove_style(style_tag)
        grid      = midi_to_16step_grid(midi_path, pm)
        if grid is None:
            skipped += 1
            continue
        quality = compute_quality(grid)
        if quality < 0.2:
            skipped += 1
            continue
        genre_patterns[genre].append({'grid': grid, 'quality': quality, 'source': fname})
        processed += 1
        if processed % 500 == 0:
            print(f"  ⚙  {processed} patterns extracted…")

    print(f"  ✓ {processed} valid | {skipped} skipped")
    return dict(genre_patterns)

def select_best(genre_patterns: Dict[str, List]) -> Dict[str, List]:
    result = {}
    for genre, patterns in genre_patterns.items():
        sorted_pats = sorted(patterns, key=lambda p: -p['quality'])
        grids       = [p['grid'] for p in sorted_pats]
        unique      = deduplicate(grids)

        # Add melodic channels
        fills = MELODIC_FILLS.get(genre, MELODIC_FILLS['hip-hop'])
        for g in unique:
            if not any(g.get('Bass', [])):
                g['Bass'] = list(fills['Bass'])
            if not any(g.get('Lead', [])):
                g['Lead'] = list(fills['Lead'])

        result[genre] = unique[:MAX_PATTERNS_PER_GENRE]
        print(f"  📊 {genre:12s}: {len(patterns):4d} raw → {len(unique):3d} unique → {len(result[genre])} selected")
    return result

# ─────────────────────────────────────────────────────────────────────────────
# INJECT INTO beat_ai.py
# ─────────────────────────────────────────────────────────────────────────────

def inject_into_beat_ai(selected: Dict[str, List], beat_ai_path: Path) -> None:
    source = beat_ai_path.read_text(encoding='utf-8')

    for genre, patterns in selected.items():
        if not patterns:
            continue

        # Find genre key in source
        marker   = f"'{genre}'"
        g_pos    = source.find(marker)
        if g_pos == -1:
            print(f"  ⚠  '{genre}' not found in beat_ai.py — skipping")
            continue

        # Find 'pattern_sets': [ after genre marker
        area     = source[g_pos: g_pos + 4000]
        ps_local = area.find("'pattern_sets': [")
        if ps_local == -1:
            print(f"  ⚠  pattern_sets not found for '{genre}'")
            continue

        insert_at = g_pos + ps_local + len("'pattern_sets': [")

        block_lines = ["\n"]
        for i, pat in enumerate(patterns, 1):
            block_lines.append(f"            {{   # 🎵 Groove MIDI — real drummer (pattern {i})")
            for ch in CHANNELS:
                steps    = pat.get(ch, [0]*16)
                step_str = ', '.join(str(s) for s in steps)
                block_lines.append(f"                '{ch}':     [{step_str}],")
            block_lines.append("            },")

        injection = '\n'.join(block_lines) + '\n'
        source    = source[:insert_at] + injection + source[insert_at:]
        print(f"  ✅ '{genre}': {len(patterns)} real patterns injected")

    # Header comment
    header = '# [AUTO-TRAINED] Real drum patterns from Groove MIDI Dataset (CC BY 4.0)\n'
    if '# [AUTO-TRAINED]' not in source:
        source = header + source

    beat_ai_path.write_text(source, encoding='utf-8')
    print(f"\n  💾 beat_ai.py updated")

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 65)
    print("  🎵  BeYou Studio — Real Music Training Pipeline")
    print("       Source: Google Magenta Groove MIDI Dataset")
    print("       License: CC BY 4.0")
    print("=" * 65)

    # Ensure pretty_midi
    pm = try_import_pretty_midi()
    if pm is None:
        install_deps()
        pm = try_import_pretty_midi()
    if pm is None:
        print("  ✗ Install failed. Run: pip install pretty_midi numpy")
        sys.exit(1)
    print("  ✓ pretty_midi ready")

    # 1. Download dataset
    print("\n📥 Step 1/4 — Download Groove MIDI Dataset (~90 MB)…")
    try:
        groove_root = ensure_groove_dataset()
    except Exception as e:
        print(f"  ✗ Download failed: {e}")
        sys.exit(1)

    # 2. Extract patterns
    print("\n🎼 Step 2/4 — Extracting drum patterns…")
    genre_patterns = extract_patterns(groove_root, pm)
    if not genre_patterns:
        print("  ✗ No patterns found.")
        sys.exit(1)

    # 3. Select best
    print("\n🏆 Step 3/4 — Selecting top patterns per genre…")
    selected = select_best(genre_patterns)

    # Save JSON
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PATTERNS_JSON.write_text(json.dumps(selected, indent=2))
    print(f"  💾 Patterns saved → {PATTERNS_JSON}")

    # 4. Inject into beat_ai.py
    print("\n✍  Step 4/4 — Updating beat_ai.py…")
    if not BEAT_AI_FILE.exists():
        print(f"  ✗ {BEAT_AI_FILE} not found")
        sys.exit(1)

    backup = BEAT_AI_FILE.with_suffix('.py.bak')
    shutil.copy(BEAT_AI_FILE, backup)
    print(f"  📦 Backup → {backup}")

    inject_into_beat_ai(selected, BEAT_AI_FILE)

    # Summary
    total = sum(len(v) for v in selected.values())
    print("\n" + "=" * 65)
    print(f"  ✅ Done! {total} real patterns across {len(selected)} genres")
    print(f"  🎛  Restart server: python server.py")
    print("=" * 65)

if __name__ == '__main__':
    main()
