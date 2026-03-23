/**
 * NarrowScore — shared frontend module.
 * Auth state, API client, utilities.
 */

const API = window.location.origin;

// Auth state
let _token = localStorage.getItem('ns_token');
let _username = localStorage.getItem('ns_username');

// Check URL for token (from OAuth callback)
const params = new URLSearchParams(window.location.search);
if (params.get('token')) {
  _token = params.get('token');
  _username = params.get('username');
  localStorage.setItem('ns_token', _token);
  localStorage.setItem('ns_username', _username);
  window.history.replaceState({}, '', window.location.pathname);
}

const NS = {
  get token() { return _token; },
  get username() { return _username; },
  get isLoggedIn() { return !!_token; },

  login() {
    window.location.href = `${API}/auth/github`;
  },

  logout() {
    _token = null;
    _username = null;
    localStorage.removeItem('ns_token');
    localStorage.removeItem('ns_username');
    window.location.reload();
  },

  async api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (_token) headers['Authorization'] = `Bearer ${_token}`;
    const res = await fetch(`${API}${path}`, { ...options, headers });
    if (res.status === 401) {
      _token = null;
      localStorage.removeItem('ns_token');
    }
    return res.json();
  },

  // Tier colors
  tierColor(tier) {
    const colors = { S: '#ffd700', A: '#00ffaa', B: '#00ccff', C: '#aaaacc', D: '#ff8844', F: '#ff4444' };
    return colors[tier] || '#aaaacc';
  },

  scoreColor(score) {
    if (score >= 90) return '#ffd700';
    if (score >= 75) return '#00ffaa';
    if (score >= 60) return '#00ccff';
    if (score >= 40) return '#aaaacc';
    if (score >= 20) return '#ff8844';
    return '#ff4444';
  },

  formatMoney(n) {
    if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  },

  formatTokens(n) {
    if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return Math.round(n/1e3) + 'K';
    return n.toString();
  },

  timeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    if (s < 604800) return Math.floor(s/86400) + 'd ago';
    return new Date(date).toLocaleDateString();
  },

  // Render bottom nav with active state
  renderNav(activePage) {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return;
    nav.querySelectorAll('a').forEach(a => {
      a.classList.toggle('active', a.dataset.page === activePage);
    });

    // Desktop nav too
    const topNav = document.querySelector('.top-nav nav');
    if (topNav) {
      topNav.querySelectorAll('a').forEach(a => {
        a.classList.toggle('active', a.dataset.page === activePage);
      });
    }

    // Update auth links
    document.querySelectorAll('.auth-link').forEach(el => {
      if (NS.isLoggedIn) {
        el.textContent = `@${_username}`;
        el.href = `/profile.html?u=${_username}`;
      } else {
        el.textContent = 'Login';
        el.href = '#';
        el.onclick = (e) => { e.preventDefault(); NS.login(); };
      }
    });
  },
};

window.NS = NS;
