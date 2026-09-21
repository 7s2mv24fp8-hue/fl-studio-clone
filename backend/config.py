"""
Configuration and Environment Management for FL Studio Web DAW
Provides zero-dependency .env loading and centralized security configurations.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
ENV_FILE = BASE_DIR / ".env"

def load_env_file():
    """Lightweight .env parser with zero external dependencies."""
    if not ENV_FILE.exists():
        return
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception as e:
        print(f"[!] Warning reading .env: {e}")

load_env_file()

# Environment & Server
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").lower()
IS_PRODUCTION = ENVIRONMENT == "production"
PORT = int(os.environ.get("PORT", 8000))
HOST = os.environ.get("HOST", "0.0.0.0")

# Security Secrets
SECRET_KEY = os.environ.get("SECRET_KEY", "fl_studio_production_secret_key_change_me_in_prod")
TOKEN_VALID_DAYS = int(os.environ.get("TOKEN_VALID_DAYS", 30))

# Super Admin Seed (Rahul Sharma)
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "rahul")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "rahul@flstudio.local")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "password123")
ADMIN_FULL_NAME = os.environ.get("ADMIN_FULL_NAME", "Rahul Sharma")

# External AI Keys (Hidden on server, never exposed to client)
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()

# Database
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_PATH = BASE_DIR / "fl_studio.db"

# Upload Restrictions
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_SIZE = 15 * 1024 * 1024  # 15 Megabytes
ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".ogg", ".flac", ".m4a"}
ALLOWED_AUDIO_MIMES = {
    "audio/wav", "audio/x-wav", "audio/wave",
    "audio/mpeg", "audio/mp3",
    "audio/ogg", "audio/vorbis",
    "audio/flac", "audio/x-flac",
    "audio/m4a", "audio/mp4",
    "application/octet-stream", # for raw audio recordings
}
