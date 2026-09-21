"""
Authentication, Authorization & Security Module for FL Studio Web DAW
Features:
  - PBKDF2-HMAC-SHA256 password hashing with 16-byte cryptographic salt
  - Constant-time password & token comparisons (anti-timing attacks)
  - Strict password complexity enforcement
  - In-memory sliding-window IP rate limiting (anti-brute force)
  - Bot honeypot protection
  - Safe user projection (trims password_hash and salt)
  - Role-based authorization (Super Admin: Rahul Sharma)
"""

import hashlib
import os
import re
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Security, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.config import TOKEN_VALID_DAYS, SECRET_KEY, ADMIN_USERNAME, ADMIN_PASSWORD
from backend.db import get_db_connection, get_user_by_id

security = HTTPBearer(auto_error=False)

# ── 1. Sliding Window Rate Limiter ───────────────────────────────────────────

# In-memory IP request history: { "ip:endpoint": [timestamp1, timestamp2, ...] }
_RATE_LIMIT_STORE = defaultdict(list)

def check_rate_limit(request: Request, key_prefix: str = "auth", max_attempts: int = 5, window_seconds: int = 60):
    """
    Enforces rate limiting per client IP address.
    Raises HTTP 429 if max_attempts exceeded within window_seconds.
    """
    # Extract client IP, accounting for Render / reverse-proxy X-Forwarded-For
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "unknown"

    now = time.time()
    rate_key = f"{key_prefix}:{client_ip}"
    
    # Filter out timestamps older than window
    timestamps = [t for t in _RATE_LIMIT_STORE[rate_key] if now - t < window_seconds]
    if len(timestamps) >= max_attempts:
        retry_after = int(window_seconds - (now - timestamps[0]))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Please wait {max(1, retry_after)} seconds before trying again.",
            headers={"Retry-After": str(max(1, retry_after))}
        )
    
    timestamps.append(now)
    _RATE_LIMIT_STORE[rate_key] = timestamps


# ── 2. Bot Protection (Honeypot & User-Agent) ────────────────────────────────

def verify_not_bot(request: Request, honeypot_val: Optional[str] = None):
    """
    Validates that a request is not an automated bot:
    1. Honeypot field must be empty (hidden in UI, only bots fill it).
    2. User-Agent header must exist and not be empty.
    """
    if honeypot_val and len(honeypot_val.strip()) > 0:
        # Detected bot filling hidden field
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Automated submission rejected."
        )

    user_agent = request.headers.get("User-Agent", "").strip()
    if not user_agent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid User-Agent header required."
        )


# ── 3. Password Hashing & Complexity ──────────────────────────────────────────

def validate_password_strength(password: str) -> None:
    """Enforces minimum 8 characters with at least one number or symbol."""
    if not password or len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long."
        )
    if not re.search(r"[0-9!@#$%^&*(),.?\":{}|<>]", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one digit or special character."
        )


def hash_password(password: str) -> tuple[str, str]:
    """Hashes password with PBKDF2-HMAC-SHA256 (100,000 rounds) + 16-byte random salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return key.hex(), salt


def verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """Verifies a password against the stored hash and salt using constant-time comparison."""
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return secrets.compare_digest(key.hex(), stored_hash)


# ── 4. Sessions & Tokens ──────────────────────────────────────────────────────

def create_session(user_id: int) -> str:
    """Generates a cryptographically random session token and stores in DB."""
    token = "fl_" + secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=TOKEN_VALID_DAYS)
    
    conn = get_db_connection()
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        (token, user_id, now.isoformat(), expires.isoformat())
    )
    conn.execute("UPDATE users SET last_login = ? WHERE id = ?", (now.isoformat(), user_id))
    conn.commit()
    conn.close()
    return token


def delete_session(token: str):
    """Logs out by securely revoking session token."""
    conn = get_db_connection()
    conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def safe_user_dict(user_row) -> Optional[dict]:
    """Projects user row into a safe dict, stripping sensitive password_hash and salt."""
    if not user_row:
        return None
    d = dict(user_row)
    d.pop("password_hash", None)
    d.pop("salt", None)
    return d


def authenticate_user(username: str, password: str):
    """Authenticates username/email & password and returns trimmed safe user dict or None."""
    from backend.db import get_user_by_username
    user = get_user_by_username(username)
    if not user:
        return None
    if not verify_password(password, user["password_hash"], user["salt"]):
        return None
    return safe_user_dict(user)


def get_user_from_token(token: str):
    """Resolves session token to user dict if valid and non-expired."""
    if not token or not token.startswith("fl_"):
        return None
    conn = get_db_connection()
    row = conn.execute("SELECT user_id, expires_at FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        conn.close()
        return None
        
    try:
        expires_at = datetime.fromisoformat(row["expires_at"])
    except Exception:
        conn.close()
        return None

    if datetime.now(timezone.utc) > expires_at:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
        return None

    conn.close()
    return get_user_by_id(row["user_id"])


# ── 5. Server-Side Auth Dependencies ──────────────────────────────────────────

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)):
    """FastAPI dependency to extract and verify the current logged in user."""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = get_user_from_token(credentials.credentials)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_admin(user: dict = Security(get_current_user)):
    """FastAPI dependency to enforce Super Admin role (Rahul Sharma)."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required."
        )
    return user
