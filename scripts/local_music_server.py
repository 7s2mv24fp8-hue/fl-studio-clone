#!/usr/bin/env python3
"""
Local Music Generation Server for FL Studio Web DAW
===================================================
Provides a local HTTP endpoint for generating music audio locally on your machine
using Meta's AudioCraft (MusicGen) or returning demo stems with full CORS support.

Requirements (Optional for full AudioCraft GPU/MPS acceleration):
    pip install fastapi uvicorn audiocraft torch torchaudio

Usage:
    python scripts/local_music_server.py
    # Runs on http://localhost:8000
"""

import io
import math
import struct
import wave
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="FL Studio Local Music Server")

# Allow Web DAW browser origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerateRequest(BaseModel):
    prompt: str
    duration: int = 10

# Try importing AudioCraft if installed (optional heavy ML dependency)
AUDIOCRAFT_AVAILABLE = False
musicgen_model = None

try:
    import importlib
    MusicGen = getattr(importlib.import_module("audiocraft.models"), "MusicGen")  # type: ignore
    torch = importlib.import_module("torch")  # type: ignore
    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[*] AudioCraft detected. Loading MusicGen small on device: {device}...")
    musicgen_model = MusicGen.get_pretrained('facebook/musicgen-small')
    musicgen_model.set_generation_params(duration=8)
    AUDIOCRAFT_AVAILABLE = True
    print("[✓] MusicGen model loaded successfully!")
except Exception as e:
    print(f"[!] AudioCraft not loaded: {e}")
    print("[*] Running in synthetic WAV generation mode. AudioCraft is optional.")


def generate_synthesized_wav(prompt: str, duration: int = 8, sample_rate: int = 32000) -> bytes:
    """Generates a musical synth groove WAV as a lightweight fallback."""
    num_samples = int(duration * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        
        # Simple beat and chord progression based on prompt length
        bpm = 120
        quarter_note = sample_rate * 60 / bpm
        sixteenth = quarter_note / 4
        
        frames = bytearray()
        for i in range(num_samples):
            t = i / sample_rate
            step = int(i // sixteenth) % 16
            
            # Kick on 0, 4, 8, 12
            kick = math.sin(2 * math.pi * 55 * math.exp(-((i % quarter_note) / 3000))) if (i % quarter_note) < 3000 else 0
            
            # Snare/clap on 4, 12
            snare = (math.sin(i * 0.1) * 0.3 * math.exp(-((i % (quarter_note * 2)) / 5000))) if (step in [4, 12]) else 0
            
            # Bassline root notes (A minor: 110Hz, 130Hz, 146Hz, 98Hz)
            chord_idx = int((t * 0.5) % 4)
            freqs = [110.0, 130.81, 146.83, 98.0]
            bass = 0.4 * math.sin(2 * math.pi * freqs[chord_idx] * t)
            
            val = max(-1.0, min(1.0, (kick * 0.7 + snare * 0.5 + bass * 0.4)))
            sample_val = int(val * 30000)
            frames.extend(struct.pack('<hh', sample_val, sample_val))
            
        wav.writeframes(frames)
    return buf.getvalue()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "audiocraft": AUDIOCRAFT_AVAILABLE,
        "engine": "AudioCraft (MusicGen)" if AUDIOCRAFT_AVAILABLE else "Synthetic Harmonic Fallback",
        "models_available": ["facebook/musicgen-small", "local-synth"]
    }


@app.post("/generate")
def generate_music(req: GenerateRequest):
    print(f"[*] Generating audio for prompt: {req.prompt} ({req.duration}s)")
    try:
        if AUDIOCRAFT_AVAILABLE and musicgen_model:
            musicgen_model.set_generation_params(duration=req.duration)
            wav_tensor = musicgen_model.generate([req.prompt])
            buf = io.BytesIO()
            torchaudio = importlib.import_module("torchaudio")  # type: ignore
            torchaudio.save(buf, wav_tensor[0].cpu(), 32000, format="wav")
            wav_bytes = buf.getvalue()
        else:
            wav_bytes = generate_synthesized_wav(req.prompt, req.duration)

        return Response(content=wav_bytes, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    print("[*] Starting FL Studio Local Music Server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
