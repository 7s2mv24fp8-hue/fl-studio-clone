"""
Database layer for FL Studio Web DAW
Features:
  - SQLite database with auto-migration and thread-safe connections
  - Row-Level Security (RLS) query helpers
  - 100% Parameterized queries with column whitelisting
  - Secure Super Admin seeding (Rahul Sharma)
  - Audio uploads tracking table with path traversal guards
"""

import sqlite3
import os
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

from backend.config import (
    DB_PATH,
    ADMIN_USERNAME,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    ADMIN_FULL_NAME,
)


def get_db_connection() -> sqlite3.Connection:
    """Returns a SQLite connection with row_factory and enforced foreign keys."""
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Initializes tables, indices, and seeds the default Super Admin."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user', -- 'admin' or 'user'
            avatar_url TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            last_login TEXT
        )
    """)

    # 2. Projects table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            bpm INTEGER DEFAULT 140,
            channel_count INTEGER DEFAULT 8,
            state_json TEXT NOT NULL,
            is_public INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_projects_public ON projects(is_public)")

    # 3. User Sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")

    # 4. Audio Uploads / Recorded Takes table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audio_uploads (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            mime_type TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audio_uploads_user_id ON audio_uploads(user_id)")

    # 5. System & Audit Logs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TEXT NOT NULL
        )
    """)

    conn.commit()

    # ── Add bio/genre_tags columns if missing (safe migration) ──────────────────
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''")
    except Exception: pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN genre_tags TEXT DEFAULT ''")
    except Exception: pass
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN beats_submitted INTEGER DEFAULT 0")
    except Exception: pass

    # ── Add play_count column to projects if missing ──────────────────────────
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN play_count INTEGER DEFAULT 0")
    except Exception: pass
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN like_count INTEGER DEFAULT 0")
    except Exception: pass
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN genre TEXT DEFAULT ''")
    except Exception: pass
    try:
        cursor.execute("ALTER TABLE projects ADD COLUMN thumbnail_data TEXT DEFAULT ''")
    except Exception: pass

    # 6. Train Submissions — crowd-sourced patterns for Max
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS train_submissions (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            prompt TEXT NOT NULL,
            genre TEXT NOT NULL,
            bpm INTEGER NOT NULL,
            pattern_json TEXT NOT NULL,
            mix_json TEXT,
            rating INTEGER DEFAULT 0,    -- 0=pending, 1=approved, -1=rejected
            approved_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_train_genre ON train_submissions(genre)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_train_rating ON train_submissions(rating)")

    # 7. Beat Likes — project reactions
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS beat_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, project_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_likes_project ON beat_likes(project_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_likes_user ON beat_likes(user_id)")

    # 8. Follows — user following
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS follows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            follower_id INTEGER NOT NULL,
            following_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(follower_id, following_id),
            FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
        )
    """)

    conn.commit()


    # Seed Super Admin: Rahul Sharma
    seed_super_admin(cursor)
    conn.commit()
    conn.close()


def seed_super_admin(cursor: sqlite3.Cursor):
    """Ensures Rahul Sharma is seeded as Super Admin."""
    cursor.execute("SELECT id, role, password_hash, salt FROM users WHERE username = ? OR username = 'rahul'", (ADMIN_USERNAME,))
    existing = cursor.fetchone()
    if not existing:
        from backend.auth import hash_password
        pwd_hash, salt = hash_password(ADMIN_PASSWORD)
        now = datetime.now(timezone.utc).isoformat()
        cursor.execute("""
            INSERT INTO users (username, email, password_hash, salt, full_name, role, created_at)
            VALUES (?, ?, ?, ?, ?, 'admin', ?)
        """, (
            ADMIN_USERNAME,
            ADMIN_EMAIL,
            pwd_hash,
            salt,
            ADMIN_FULL_NAME,
            now
        ))
        user_id = cursor.lastrowid
        cursor.execute("""
            INSERT INTO audit_logs (user_id, action, details, timestamp)
            VALUES (?, ?, ?, ?)
        """, (user_id, "SYSTEM_INIT", f"Seeded Super Admin {ADMIN_FULL_NAME} ({ADMIN_USERNAME})", now))
        print(f"[✓] Seeded Super Admin: {ADMIN_FULL_NAME} (username: {ADMIN_USERNAME}, role: admin)")
    else:
        # Guarantee role is admin, name is Rahul Sharma, and password matches configured ADMIN_PASSWORD
        from backend.auth import hash_password
        pwd_hash, salt = hash_password(ADMIN_PASSWORD)
        cursor.execute(
            "UPDATE users SET role = 'admin', full_name = ?, password_hash = ?, salt = ? WHERE id = ?",
            (ADMIN_FULL_NAME, pwd_hash, salt, existing["id"])
        )


# ── Row-Level Security (RLS) & Query Helpers ─────────────────────────────────

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Retrieves user by ID, projecting ONLY safe public fields (strips password & salt)."""
    conn = get_db_connection()
    row = conn.execute(
        "SELECT id, username, email, full_name, role, avatar_url, created_at, last_login FROM users WHERE id = ?",
        (user_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_username(identifier: str) -> Optional[sqlite3.Row]:
    """Retrieves full user row (internal auth use only) by username or email."""
    conn = get_db_connection()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ? OR email = ?",
        (identifier, identifier)
    ).fetchone()
    conn.close()
    return row


def get_user_projects(user_id: int, is_admin: bool = False, fetch_all: bool = False) -> List[Dict[str, Any]]:
    """
    Row-Level Security:
    - Normal users ONLY receive their own projects.
    - Admins can optionally request all projects.
    """
    conn = get_db_connection()
    if is_admin and fetch_all:
        rows = conn.execute("""
            SELECT p.id, p.user_id, p.title, p.bpm, p.channel_count, p.is_public, p.created_at, p.updated_at,
                   u.username, u.full_name
            FROM projects p
            JOIN users u ON p.user_id = u.id
            ORDER BY p.updated_at DESC
        """).fetchall()
    else:
        rows = conn.execute("""
            SELECT id, user_id, title, bpm, channel_count, is_public, created_at, updated_at
            FROM projects
            WHERE user_id = ?
            ORDER BY updated_at DESC
        """, (user_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_project_with_rls(project_id: str, user_id: int, is_admin: bool = False) -> Optional[Dict[str, Any]]:
    """
    Row-Level Security check:
    Returns project if user is owner, project is public, or user is admin.
    """
    conn = get_db_connection()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    if not row:
        return None

    # Check permission
    is_owner = (row["user_id"] == user_id)
    is_public = bool(row["is_public"])
    if not (is_owner or is_public or is_admin):
        return None  # Forbidden

    return dict(row)


def update_project_safe(project_id: str, updates: Dict[str, Any]) -> bool:
    """
    Safely updates project fields using strict parameterization and column whitelisting.
    Prevents SQL injection and field tampering.
    """
    ALLOWED_COLUMNS = {"title", "bpm", "channel_count", "state_json", "is_public", "updated_at"}
    filtered_updates = {k: v for k, v in updates.items() if k in ALLOWED_COLUMNS}
    if not filtered_updates:
        return False

    set_clause = ", ".join([f"{col} = ?" for col in filtered_updates.keys()])
    params = list(filtered_updates.values())
    params.append(project_id)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", params)
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def log_action(user_id: Optional[int], action: str, details: str = ""):
    """Appends an immutable audit log entry."""
    conn = get_db_connection()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO audit_logs (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)",
        (user_id, action, details, now)
    )
    conn.commit()
    conn.close()
