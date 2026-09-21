/**
 * FL Studio Web DAW — Hardened Backend API Client
 * Enterprise-grade client with XSS escaping, bot honeypot protection,
 * secure audio upload, and Super Admin operations (Rahul Sharma).
 */

class BackendAPI {
  constructor() {
    this.baseUrl = window.location.origin;
    this.tokenKey = 'fl_studio_token';
    this.token = localStorage.getItem(this.tokenKey) || '';
    this.currentUser = null;
    this.isOnline = false;
  }

  get headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * Universal HTML escape utility to protect against XSS injection
   */
  escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async checkHealth() {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
      this.isOnline = res.ok;
      return res.ok;
    } catch (e) {
      this.isOnline = false;
      return false;
    }
  }

  async initSession() {
    const online = await this.checkHealth();
    if (!online) return null;

    if (this.token) {
      try {
        const res = await fetch(`${this.baseUrl}/api/auth/me`, {
          headers: this.headers
        });
        if (res.ok) {
          const data = await res.json();
          this.currentUser = data.user;
          return this.currentUser;
        }
      } catch (e) {
        console.warn('Session verification failed:', e);
      }
    }

    // Auto-login as default Super Admin Rahul Sharma if first time
    return await this.loginDefaultAdmin();
  }

  async loginDefaultAdmin() {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'rahul', password: 'password123', honeypot: null })
      });
      if (res.ok) {
        const data = await res.json();
        this.token = data.token;
        this.currentUser = data.user;
        localStorage.setItem(this.tokenKey, this.token);
        return this.currentUser;
      }
    } catch (e) {
      console.warn('Default admin auto-login unreachable:', e);
    }
    return null;
  }

  async login(username, password, honeypot = null) {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, honeypot })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Login failed' }));
      throw new Error(err.detail || 'Login failed');
    }
    const data = await res.json();
    this.token = data.token;
    this.currentUser = data.user;
    localStorage.setItem(this.tokenKey, this.token);
    return this.currentUser;
  }

  async register(username, email, password, fullName = '', honeypot = null) {
    const res = await fetch(`${this.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        full_name: fullName,
        honeypot
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Registration failed' }));
      throw new Error(err.detail || 'Registration failed');
    }
    const data = await res.json();
    this.token = data.token;
    this.currentUser = data.user;
    localStorage.setItem(this.tokenKey, this.token);
    return this.currentUser;
  }

  async logout() {
    try {
      await fetch(`${this.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: this.headers
      });
    } catch (e) {
      // Ignore network errors on logout
    }
    this.token = '';
    this.currentUser = null;
    localStorage.removeItem(this.tokenKey);
  }

  // ── Project API (Row-Level Security) ───────────────────────────────────────

  async listProjects(all = false) {
    const url = all ? `${this.baseUrl}/api/projects?all=true` : `${this.baseUrl}/api/projects`;
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to list projects' }));
      throw new Error(err.detail || 'Failed to list projects');
    }
    const data = await res.json();
    return data.projects || [];
  }

  async saveProject(title, stateObj, bpm = 140, channelCount = 8) {
    const payload = {
      title: title || 'Untitled Project',
      bpm: parseInt(bpm, 10) || 140,
      channel_count: parseInt(channelCount, 10) || 8,
      state_json: JSON.stringify(stateObj),
      is_public: false
    };
    const res = await fetch(`${this.baseUrl}/api/projects`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to save project' }));
      throw new Error(err.detail || 'Failed to save project');
    }
    return await res.json();
  }

  async getProject(id) {
    const res = await fetch(`${this.baseUrl}/api/projects/${id}`, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Project not found' }));
      throw new Error(err.detail || 'Project not found');
    }
    const data = await res.json();
    return data.project;
  }

  async deleteProject(id) {
    const res = await fetch(`${this.baseUrl}/api/projects/${id}`, {
      method: 'DELETE',
      headers: this.headers
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to delete project' }));
      throw new Error(err.detail || 'Failed to delete project');
    }
    return await res.json();
  }

  // ── Restricted Audio Upload API ────────────────────────────────────────────

  async uploadAudioTake(blob, filename = 'recording.wav') {
    const headers = {
      'Content-Type': blob.type || 'audio/wav',
      'X-File-Name': encodeURIComponent(filename),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}/api/audio/upload`, {
      method: 'POST',
      headers,
      body: blob
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Upload failed');
    }
    return await res.json();
  }

  // ── Admin API (Protected for Super Admin Rahul Sharma) ─────────────────────

  async getAdminStats() {
    const res = await fetch(`${this.baseUrl}/api/admin/stats`, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to fetch admin stats' }));
      throw new Error(err.detail || 'Failed to fetch admin stats');
    }
    return await res.json();
  }

  async getAdminUsers() {
    const res = await fetch(`${this.baseUrl}/api/admin/users`, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to fetch user list' }));
      throw new Error(err.detail || 'Failed to fetch user list');
    }
    const data = await res.json();
    return data.users || [];
  }

  async createAdminUser(userData) {
    const res = await fetch(`${this.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(userData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to create user' }));
      throw new Error(err.detail || 'Failed to create user');
    }
    return await res.json();
  }

  async updateUserRole(userId, role) {
    const res = await fetch(`${this.baseUrl}/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to update role' }));
      throw new Error(err.detail || 'Failed to update role');
    }
    return await res.json();
  }

  async deleteUser(userId) {
    const res = await fetch(`${this.baseUrl}/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: this.headers
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to delete user' }));
      throw new Error(err.detail || 'Failed to delete user');
    }
    return await res.json();
  }

  async getAdminLogs() {
    const res = await fetch(`${this.baseUrl}/api/admin/logs?limit=50`, { headers: this.headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to fetch logs' }));
      throw new Error(err.detail || 'Failed to fetch logs');
    }
    const data = await res.json();
    return data.logs || [];
  }
}

// Global instance
window.backendAPI = new BackendAPI();
