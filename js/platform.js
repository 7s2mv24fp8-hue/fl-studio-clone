/**
 * BeYou Studio Platform Layer
 * Covers: Explore feed · Public Profiles · Train Max · Likes · Follow
 */

/* ── API helpers ──────────────────────────────────────────────────────────── */
const API = (() => {
  const authHeader = () => {
    const t = localStorage.getItem('bs_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  const get = (path) =>
    fetch(path, { headers: { ...authHeader() } }).then(r => r.json());

  const post = (path, body) =>
    fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    }).then(r => r.json());

  const put = (path, body = {}) =>
    fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    }).then(r => r.json());

  return { get, post, put };
})();


/* ── PLATFORM singleton ───────────────────────────────────────────────────── */
window.Platform = class Platform {

  constructor() {
    this._currentProfile = null;
    this._exploreBeats   = [];
    this._trainStatus    = null;
  }

  init() {
    this._attachNavLinks();
    this._syncAuthState();
    // auto-fetch explore once on load
    this._initExplore();
  }

  /* ── Auth sync ─────────────────────────────────────────────────────────── */
  _syncAuthState() {
    const token = localStorage.getItem('bs_token');
    const user  = this._getStoredUser();

    // Update nav avatar
    const avatarEl  = document.getElementById('plat-nav-avatar');
    const loginLink = document.getElementById('plat-nav-login');
    const profileLink = document.getElementById('plat-nav-profile');
    const trainLink = document.getElementById('plat-nav-train');

    if (token && user) {
      if (avatarEl)    { avatarEl.textContent = user.full_name?.[0]?.toUpperCase() || user.username?.[0]?.toUpperCase() || '?'; avatarEl.style.display = 'flex'; }
      if (loginLink)   loginLink.style.display = 'none';
      if (profileLink) { profileLink.style.display = 'flex'; profileLink.href = `/profile/${user.username}`; }
      if (trainLink)   trainLink.style.display = 'flex';
    } else {
      if (avatarEl)    avatarEl.style.display = 'none';
      if (loginLink)   loginLink && (loginLink.style.display = 'flex');
      if (profileLink) profileLink && (profileLink.style.display = 'none');
      if (trainLink)   trainLink  && (trainLink.style.display  = 'none');
    }
  }

  _getStoredUser() {
    try { return JSON.parse(localStorage.getItem('bs_user') || 'null'); } catch { return null; }
  }


  /* ── Nav wiring ─────────────────────────────────────────────────────────── */
  _attachNavLinks() {
    // Explore tab inside DAW
    document.getElementById('plat-explore-tab')?.addEventListener('click', () => this.openExplore());
    // Train Max button
    document.getElementById('plat-train-btn')?.addEventListener('click', () => this.openTrainMax());
    // Profile open
    document.getElementById('plat-nav-avatar')?.addEventListener('click', () => {
      const u = this._getStoredUser();
      if (u) this.openProfile(u.username);
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════
     EXPLORE
  ═══════════════════════════════════════════════════════════════════════ */

  async _initExplore() {
    // Populate genre filter from server
    try {
      const { genres } = await API.get('/api/explore/genres');
      const gf = document.getElementById('explore-genre-filter');
      if (gf && genres) {
        genres.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.genre; opt.textContent = `${g.genre} (${g.count})`;
          gf.appendChild(opt);
        });
      }
    } catch {}
  }

  async openExplore() {
    this._showModal('explore-modal');
    await this.loadExplore();
  }

  async loadExplore(genre = '', sort = 'recent') {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="plat-loading"><div class="plat-spinner"></div><span>Loading beats...</span></div>';

    try {
      const qs = new URLSearchParams({ sort, ...(genre ? { genre } : {}) });
      const { beats } = await API.get(`/api/explore?${qs}`);
      this._exploreBeats = beats || [];
      this._renderExploreGrid(beats || []);
    } catch (e) {
      grid.innerHTML = `<div class="plat-error">Could not load beats: ${e.message}</div>`;
    }
  }

  _renderExploreGrid(beats) {
    const grid = document.getElementById('explore-grid');
    if (!grid) return;
    if (!beats.length) {
      grid.innerHTML = '<div class="plat-empty"><span>🎵</span><p>No beats published yet.<br>Be the first!</p></div>';
      return;
    }
    grid.innerHTML = '';
    beats.forEach(b => {
      const card = document.createElement('div');
      card.className = 'explore-card';
      card.innerHTML = `
        <div class="ec-waveform">${this._fakeBars()}</div>
        <div class="ec-body">
          <div class="ec-title">${esc(b.title)}</div>
          <div class="ec-meta">
            <span class="ec-genre">${esc(b.genre || 'Beat')}</span>
            <span class="ec-bpm">♩ ${b.bpm} BPM</span>
          </div>
          <div class="ec-author" data-username="${esc(b.username)}">
            <span class="ec-avatar">${b.full_name?.[0]?.toUpperCase() || '?'}</span>
            <span>${esc(b.full_name || b.username)}</span>
          </div>
          <div class="ec-stats">
            <button class="ec-like-btn" data-id="${b.id}" title="Like">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="ec-like-count">${b.like_count || 0}</span>
            </button>
            <span class="ec-plays">▶ ${b.play_count || 0}</span>
          </div>
        </div>`;
      // Author click → profile
      card.querySelector('.ec-author').addEventListener('click', () =>
        this.openProfile(b.username)
      );
      // Like button
      card.querySelector('.ec-like-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleLike(b.id, card);
      });
      // Card click → load beat into DAW
      card.querySelector('.ec-waveform').addEventListener('click', () => {
        this._loadBeatIntoDaw(b.id, b.title);
      });
      grid.appendChild(card);
    });
  }

  _fakeBars() {
    const bars = Array.from({length: 28}, () => {
      const h = 20 + Math.random() * 60;
      return `<div class="ec-bar" style="height:${h}%;animation-delay:${(Math.random()*0.8).toFixed(2)}s"></div>`;
    });
    return bars.join('');
  }

  async _toggleLike(projectId, card) {
    if (!localStorage.getItem('bs_token')) {
      this._toast('Login to like beats!');
      return;
    }
    try {
      const res = await API.post(`/api/beats/${projectId}/like`, {});
      const countEl = card.querySelector('.ec-like-count');
      const likeBtn = card.querySelector('.ec-like-btn');
      if (countEl) countEl.textContent = res.like_count ?? 0;
      likeBtn?.classList.toggle('liked', res.liked);
    } catch {}
  }

  async _loadBeatIntoDaw(projectId, title) {
    this._closeModal('explore-modal');
    this._toast(`Loading "${title}" into DAW...`);
    try {
      const beat = await API.get(`/api/beats/${projectId}/public`);
      if (beat.state_json) {
        const state = JSON.parse(beat.state_json);
        if (window.app) {
          window.app.sequencer?.loadState?.(state.sequencer || state);
          window.app._refreshChannelRack?.();
          if (state.bpm && document.getElementById('bpm-display'))
            document.getElementById('bpm-display').value = state.bpm;
          this._toast(`✅ "${title}" loaded!`);
        }
      }
    } catch (e) {
      this._toast('Could not load beat: ' + e.message);
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     PUBLIC PROFILE
  ═══════════════════════════════════════════════════════════════════════ */

  async openProfile(username) {
    this._showModal('profile-modal');
    const body = document.getElementById('profile-modal-body');
    if (body) body.innerHTML = '<div class="plat-loading"><div class="plat-spinner"></div><span>Loading profile...</span></div>';

    try {
      const data = await API.get(`/api/profile/${username}`);
      this._renderProfile(data, body);
    } catch (e) {
      if (body) body.innerHTML = `<div class="plat-error">Profile not found</div>`;
    }
  }

  _renderProfile(data, container) {
    const { user, beats, stats, is_following } = data;
    const me = this._getStoredUser();
    const isMe = me && me.username === user.username;

    const genreTags = (user.genre_tags || '').split(',').filter(Boolean)
      .map(g => `<span class="prof-tag">${esc(g)}</span>`).join('');

    container.innerHTML = `
      <div class="prof-header">
        <div class="prof-avatar-lg">${user.full_name?.[0]?.toUpperCase() || '?'}</div>
        <div class="prof-info">
          <div class="prof-name">${esc(user.full_name || user.username)}
            ${user.role === 'admin' ? '<span class="prof-crown">👑</span>' : ''}
          </div>
          <div class="prof-handle">@${esc(user.username)}</div>
          <div class="prof-bio">${esc(user.bio || 'No bio yet.')}</div>
          <div class="prof-tags">${genreTags || '<span class="prof-tag muted">No genres yet</span>'}</div>
        </div>
        <div class="prof-actions">
          ${isMe
            ? `<button class="prof-edit-btn" id="prof-edit-btn">✏️ Edit Profile</button>`
            : `<button class="prof-follow-btn ${is_following ? 'following' : ''}" 
                data-username="${esc(user.username)}">
                ${is_following ? '✓ Following' : '+ Follow'}
              </button>`
          }
        </div>
      </div>
      <div class="prof-stats-row">
        <div class="prof-stat"><span class="ps-val">${stats.beat_count}</span><span class="ps-lbl">Beats</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.total_likes}</span><span class="ps-lbl">Likes</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.total_plays}</span><span class="ps-lbl">Plays</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.follower_count}</span><span class="ps-lbl">Followers</span></div>
        <div class="prof-stat"><span class="ps-val">${stats.submissions_to_max || 0}</span><span class="ps-lbl">Max Trains</span></div>
      </div>
      <div class="prof-beats-section">
        <div class="prof-section-title">Public Beats</div>
        <div class="prof-beats-grid" id="prof-beats-grid">
          ${beats.length ? '' : '<div class="plat-empty"><span>🎵</span><p>No public beats yet</p></div>'}
        </div>
      </div>
      ${isMe ? `
      <div class="prof-edit-section hidden" id="prof-edit-section">
        <div class="prof-section-title">Edit Profile</div>
        <div class="prof-form">
          <label>Display Name</label>
          <input class="plat-input" id="edit-fullname" placeholder="Your name" value="${esc(user.full_name || '')}">
          <label>Bio <span class="char-hint">(max 500)</span></label>
          <textarea class="plat-input plat-textarea" id="edit-bio" placeholder="Tell the world about your sound..." maxlength="500">${esc(user.bio || '')}</textarea>
          <label>Genres <span class="char-hint">(comma-separated, max 5)</span></label>
          <input class="plat-input" id="edit-genres" placeholder="trap, drill, lofi, afrobeats" value="${esc(user.genre_tags || '')}">
          <button class="plat-btn-primary" id="prof-save-btn">Save Changes</button>
          <div id="prof-save-status" class="plat-status hidden"></div>
        </div>
      </div>` : ''}`;

    // Render beats grid
    const bg = container.querySelector('#prof-beats-grid');
    if (bg && beats.length) {
      beats.forEach(b => {
        const card = document.createElement('div');
        card.className = 'prof-beat-card';
        card.innerHTML = `
          <div class="pbc-title">${esc(b.title)}</div>
          <div class="pbc-meta">
            <span class="pbc-genre">${esc(b.genre || 'Beat')}</span>
            <span>♩ ${b.bpm} BPM</span>
          </div>
          <div class="pbc-stats">
            <span>♥ ${b.like_count}</span>
            <span>▶ ${b.play_count}</span>
          </div>
          <button class="pbc-load-btn" data-id="${b.id}" data-title="${esc(b.title)}">Load into DAW</button>`;
        card.querySelector('.pbc-load-btn').addEventListener('click', e => {
          this._loadBeatIntoDaw(e.target.dataset.id, e.target.dataset.title);
        });
        bg.appendChild(card);
      });
    }

    // Follow button
    container.querySelector('.prof-follow-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!localStorage.getItem('bs_token')) { this._toast('Please log in first'); return; }
      const res = await API.post(`/api/users/${btn.dataset.username}/follow`, {});
      btn.classList.toggle('following', res.following);
      btn.textContent = res.following ? '✓ Following' : '+ Follow';
    });

    // Edit button
    container.querySelector('#prof-edit-btn')?.addEventListener('click', () => {
      container.querySelector('#prof-edit-section')?.classList.toggle('hidden');
    });

    // Save profile
    container.querySelector('#prof-save-btn')?.addEventListener('click', async () => {
      const status = container.querySelector('#prof-save-status');
      const payload = {
        full_name: container.querySelector('#edit-fullname')?.value.trim(),
        bio: container.querySelector('#edit-bio')?.value.trim(),
        genre_tags: container.querySelector('#edit-genres')?.value.trim(),
      };
      try {
        status.textContent = 'Saving...';
        status.className = 'plat-status loading';
        status.classList.remove('hidden');
        await API.put('/api/profile', payload);
        // Update local cache
        const u = this._getStoredUser();
        if (u) {
          u.full_name = payload.full_name || u.full_name;
          localStorage.setItem('bs_user', JSON.stringify(u));
        }
        status.textContent = '✓ Profile saved!';
        status.className = 'plat-status success';
        this._syncAuthState();
      } catch (e) {
        status.textContent = 'Error saving: ' + e.message;
        status.className = 'plat-status error';
      }
    });
  }


  /* ═══════════════════════════════════════════════════════════════════════
     TRAIN MAX
  ═══════════════════════════════════════════════════════════════════════ */

  async openTrainMax() {
    if (!localStorage.getItem('bs_token')) {
      this._toast('Log in to contribute to Max!');
      return;
    }
    this._showModal('train-modal');
    // fetch training status
    try {
      const s = await API.get('/api/train/status');
      this._trainStatus = s;
      this._renderTrainStatus(s);
    } catch {}
  }

  _renderTrainStatus(s) {
    const el = document.getElementById('train-stats-panel');
    if (!el) return;
    el.innerHTML = `
      <div class="train-stat-row">
        <div class="train-stat"><span class="ts-val">${s.global_approved_patterns}</span><span class="ts-lbl">Patterns taught to Max</span></div>
        <div class="train-stat"><span class="ts-val">${s.your_submissions}</span><span class="ts-lbl">Your submissions</span></div>
        <div class="train-stat"><span class="ts-val">${s.your_approved}</span><span class="ts-lbl">Approved</span></div>
        <div class="train-stat"><span class="ts-val">${s.your_pending}</span><span class="ts-lbl">Pending review</span></div>
      </div>
      <div class="train-level-bar">
        <div class="train-level-label">Max's knowledge</div>
        <div class="train-level-track">
          <div class="train-level-fill" style="width:${Math.min(100, s.global_approved_patterns)}%"></div>
        </div>
        <div class="train-level-hint">${s.max_trained ? '🧠 Max is learning from community patterns!' : 'Be the first to train Max!'}</div>
      </div>`;
  }

  async submitCurrentBeatToTrain() {
    const genre = document.getElementById('train-genre-input')?.value.trim();
    const prompt = document.getElementById('train-prompt-input')?.value.trim();
    const status = document.getElementById('train-submit-status');

    if (!genre || !prompt) {
      if (status) { status.textContent = 'Please fill in genre and description'; status.className = 'plat-status error'; status.classList.remove('hidden'); }
      return;
    }

    // Grab current DAW state
    let pattern_json = '{}';
    let mix_json = null;
    try {
      if (window.app?.sequencer) {
        const state = window.app.sequencer.getState?.() || {};
        pattern_json = JSON.stringify(state.channels || state || {});
      }
    } catch {}

    const bpm = parseInt(document.getElementById('bpm-display')?.value || '120', 10);

    try {
      if (status) { status.textContent = 'Submitting...'; status.className = 'plat-status loading'; status.classList.remove('hidden'); }
      const res = await API.post('/api/train/submit', { prompt, genre, bpm, pattern_json, mix_json });
      if (status) { status.textContent = res.message || 'Submitted!'; status.className = 'plat-status success'; }
      this._toast('🧠 Pattern submitted to train Max!');
      // Refresh stats
      const s = await API.get('/api/train/status');
      this._renderTrainStatus(s);
    } catch (e) {
      if (status) { status.textContent = e.message || 'Error submitting'; status.className = 'plat-status error'; }
    }
  }


  /* ═══════════════════════════════════════════════════════════════════════
     CLOUD SAVE — wire existing project buttons to real API
  ═══════════════════════════════════════════════════════════════════════ */

  async cloudSaveCurrentProject() {
    if (!localStorage.getItem('bs_token')) {
      this._toast('Log in to save to cloud');
      return;
    }
    const title = document.getElementById('tb-proj-input')?.value.trim() || 'Untitled';
    const bpm   = parseInt(document.getElementById('bpm-display')?.value || '140', 10);
    const chCount = window.app?.sequencer?.channels?.length || 8;

    let state_json = '{}';
    try {
      if (window.app?.sequencer) {
        state_json = JSON.stringify({
          bpm,
          channels: window.app.sequencer.getState?.()?.channels || [],
          sequencer: window.app.sequencer.getState?.() || {},
        });
      }
    } catch {}

    try {
      const res = await API.post('/api/projects', {
        title, bpm, channel_count: chCount, state_json, is_public: false,
      });
      this._toast(`☁️ "${title}" saved to cloud!`);
      return res.id;
    } catch (e) {
      this._toast('Cloud save failed: ' + e.message);
    }
  }

  async publishCurrentBeat() {
    const projectId = window._lastSavedProjectId;
    if (!projectId) {
      this._toast('Save to cloud first, then publish!');
      return;
    }
    const genre = window.app?.aiProducer?.selectedGenres?.[0] || 'Beat';
    const res = await API.put(`/api/projects/${projectId}/publish`, { is_public: true, genre });
    if (res.ok) this._toast('🌐 Beat is now public on Explore!');
  }


  /* ═══════════════════════════════════════════════════════════════════════
     MODAL SYSTEM
  ═══════════════════════════════════════════════════════════════════════ */

  _showModal(id) {
    document.querySelectorAll('.plat-modal').forEach(m => m.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
    document.getElementById('plat-modal-overlay')?.classList.remove('hidden');
  }

  _closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
    const anyOpen = [...document.querySelectorAll('.plat-modal')].some(m => !m.classList.contains('hidden'));
    if (!anyOpen) document.getElementById('plat-modal-overlay')?.classList.add('hidden');
  }

  closeAll() {
    document.querySelectorAll('.plat-modal').forEach(m => m.classList.add('hidden'));
    document.getElementById('plat-modal-overlay')?.classList.add('hidden');
  }


  /* ─── helpers ─────────────────────────────────────────────────────────── */
  _toast(msg, dur = 3000) {
    let t = document.getElementById('plat-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'plat-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('visible'), dur);
  }
};

/* ── Escape helper ────────────────────────────────────────────────────────── */
function esc(str = '') {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ── Auto-init on DOMContentLoaded ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  window.platform = new Platform();
  window.platform.init();

  // Wire overlay close
  document.getElementById('plat-modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) window.platform.closeAll();
  });

  // Wire explore filter controls
  document.getElementById('explore-sort-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    document.querySelectorAll('#explore-sort-tabs [data-sort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const genre = document.getElementById('explore-genre-filter')?.value || '';
    window.platform.loadExplore(genre, btn.dataset.sort);
  });

  document.getElementById('explore-genre-filter')?.addEventListener('change', e => {
    const sort = document.querySelector('#explore-sort-tabs .active')?.dataset.sort || 'recent';
    window.platform.loadExplore(e.target.value, sort);
  });

  // Wire train submit
  document.getElementById('train-submit-btn')?.addEventListener('click', () => {
    window.platform.submitCurrentBeatToTrain();
  });

  // Wire cloud save btn
  document.getElementById('plat-cloud-save-btn')?.addEventListener('click', async () => {
    const id = await window.platform.cloudSaveCurrentProject();
    if (id) window._lastSavedProjectId = id;
  });

  // Wire publish btn
  document.getElementById('plat-publish-btn')?.addEventListener('click', () => {
    window.platform.publishCurrentBeat();
  });
});
