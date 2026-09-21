# BeYou Studio — Production Web DAW

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/7s2mv24fp8-hue/fl-studio-clone)

> **BeYou Studio** is a full-featured, browser-based Digital Audio Workstation (DAW) and music production suite powered by the Web Audio API, Canvas, Python FastAPI, and AI audio synthesis.

---

## ⚡ 1-Click Cloud Deployment to Render

Click the button above or visit this direct link to deploy **BeYou Studio** immediately:

👉 **[Deploy BeYou Studio on Render](https://render.com/deploy?repo=https://github.com/7s2mv24fp8-hue/fl-studio-clone)**

Render will automatically:
1. Detect [`render.yaml`](render.yaml) Blueprint.
2. Build and launch the Python 3.11 environment.
3. Seed the Super Admin account for **Rahul Sharma**.
4. Generate cryptographically secure keys and provision free automatic SSL/HTTPS.

---

## 🎹 Core Features

- **Multi-Track Step Sequencer**: 8+ drum and synth channels with velocity editing, swing, mute, and solo.
- **Interactive Piano Roll**: Polyphonic piano roll with scale snapping, chord generators, and note resizing.
- **Audio Engine & Mixer**: Real-time mixing console with 3-band parametric EQ, reverb, delay, distortion, and master compressor.
- **Vocal & Live Audio Recording**: Direct microphone capture with auto-tune pitch correction, floating live recording HUD, auto-channel rack insertion, and playlist synchronization.
- **AI Music Synthesis**: Context-aware beat generator and mix-master assistant with server-side Hugging Face proxying (`facebook/musicgen-small`) and fallback synthetic harmonic audio engine.
- **Super Admin & User Management**: Admin dashboard with system metrics, user role management, audit logging, and project synchronization.
- **Cloud Project Persistence**: SQLite embedded database with auto-migration and Row-Level Security.

---

## 🛡️ 20-Point Enterprise Security Controls

1. **Hidden API Keys**: All secrets (`SECRET_KEY`, `HF_TOKEN`) stored in server environment variables.
2. **Purged Git Secrets**: Comprehensive `.gitignore` protecting `.env`, databases, and logs.
3. **Isolated Database Credentials**: Zero database connection strings or internals exposed to clients.
4. **Row-Level Security (RLS)**: Enforced project isolation (`WHERE user_id = :id`) on all database operations.
5. **Cryptographic Password Hashing**: PBKDF2-HMAC-SHA256 (100,000 rounds) + 16-byte random salt.
6. **Server-Side Authentication**: FastAPI dependency injection (`get_current_user`, `require_admin`).
7. **Object-Level Record Locking**: Verified resource ownership before any read, update, or delete.
8. **Field Tampering Blocked**: Pydantic v2 `ConfigDict(extra="forbid")` prevents privilege escalation.
9. **Secure Session Tokens**: 32-byte cryptographically random tokens with constant-time lookup.
10. **Password Complexity**: Minimum 8 characters with digits/symbols strictly validated.
11. **Rate Limiting**: Sliding-window rate limiting on login/register (HTTP 429).
12. **Bot Protection**: Hidden honeypot fields and User-Agent validation (HTTP 400).
13. **Parameterized Queries**: 100% parameterized SQL eliminating SQL injection.
14. **Strict Input Validation**: Bounds checking and regex pattern matching on all API inputs.
15. **XSS Sanitization**: HTML escaping across all client rendering functions.
16. **Restricted File Uploads**: MIME type, extension, path traversal protection, and 15MB size limits.
17. **Trimmed Responses**: Password hashes and salts never exposed in responses.
18. **Security Headers**: CSP, HSTS, X-Content-Type-Options: nosniff, X-Frame-Options: DENY.
19. **Forced HTTPS**: Reverse-proxy protocol detection and automatic redirect.
20. **Audited Dependencies**: Clean, conflict-free dependency tree.

---

## 🛠️ Local Development Quickstart

```bash
# 1. Clone repository
git clone https://github.com/7s2mv24fp8-hue/fl-studio-clone.git
cd fl-studio-clone

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env

# 4. Start server
python server.py
```

Access the application at [http://localhost:8000](http://localhost:8000).

- **Super Admin Username**: `rahul`
- **Default Password**: `password123`
