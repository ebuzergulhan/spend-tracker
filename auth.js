// auth.js — in-app login with a long-lived "remember me" cookie.
// Replaces the browser's username/password popup. No dependencies; uses only
// core req/res methods so it works in Express and in a plain http server.
//
// Configure in .env:  APP_USERNAME=...  APP_PASSWORD=...  (optional SESSION_SECRET=...)
// Without a secret, sessions are signed with a key derived from the password,
// so changing the password logs every device out.

const crypto = require('crypto');

const OPEN_PATHS = new Set(['/favicon.svg', '/icon.svg', '/manifest.json', '/sw.js']);
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function createAuth({ username, password, secret, cookieName = 'st_session', maxAgeDays = 365 } = {}) {
    const enabled = Boolean(username && password);
    const key = secret || crypto.createHash('sha256').update('spend-tracker-session:' + (password || '')).digest('hex');
    const maxAgeSec = maxAgeDays * 24 * 60 * 60;
    const failures = new Map(); // ip -> { count, until }

    const sign = payload => crypto.createHmac('sha256', key).update(payload).digest('base64url');

    function safeEqual(a, b) {
        const ha = crypto.createHash('sha256').update(String(a)).digest();
        const hb = crypto.createHash('sha256').update(String(b)).digest();
        return crypto.timingSafeEqual(ha, hb);
    }

    function makeToken() {
        const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + maxAgeSec * 1000 })).toString('base64url');
        return payload + '.' + sign(payload);
    }

    function verifyToken(token) {
        if (!token || !token.includes('.')) return false;
        const [payload, sig] = token.split('.');
        if (!safeEqual(sig, sign(payload))) return false;
        try {
            const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
            return data.u === username && data.exp > Date.now();
        } catch { return false; }
    }

    function getCookie(req, name) {
        const header = req.headers.cookie || '';
        for (const part of header.split(';')) {
            const i = part.indexOf('=');
            if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
        }
        return null;
    }

    const clientIp = req => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const isHttps = req => Boolean(req.secure) || req.headers['x-forwarded-proto'] === 'https';

    function safeNext(next) {
        if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
        if (next.startsWith('/login') || next.startsWith('/logout')) return '/';
        return next;
    }

    function redirect(res, location, cookie) {
        const headers = { Location: location, 'Cache-Control': 'no-store' };
        if (cookie) headers['Set-Cookie'] = cookie;
        res.writeHead(303, headers);
        res.end();
    }

    function readForm(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
            req.on('end', () => resolve(new URLSearchParams(body)));
            req.on('error', reject);
        });
    }

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function sendLoginPage(res, { next = '/', error = '', status = 200 } = {}) {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Log in · Spend Tracker</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#f5f4ef"><meta name="apple-mobile-web-app-capable" content="yes">
<style>
  *{box-sizing:border-box} body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#f5f4ef;color:#1d1c1a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:16px}
  .card{width:100%;max-width:360px;background:#fff;border:1px solid #e8e5df;border-radius:18px;padding:28px 24px}
  .logo{width:40px;height:40px;border-radius:10px;background:#1d1c1a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;margin-bottom:14px}
  h1{font-size:20px;margin:0 0 4px} p.sub{margin:0 0 20px;color:#8a867f;font-size:13px}
  label{display:block;font-size:12px;font-weight:600;color:#55524d;margin:0 0 6px}
  input{width:100%;height:44px;padding:0 12px;border:1px solid #e8e5df;border-radius:10px;font:inherit;font-size:16px;margin-bottom:14px;background:#fff;color:#1d1c1a}
  input:focus{outline:none;border-color:#b7ab8f}
  button{width:100%;height:46px;border:0;border-radius:10px;background:#1d1c1a;color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer;margin-top:4px}
  .err{background:#fdecea;color:#b3261e;font-size:13px;padding:10px 12px;border-radius:10px;margin-bottom:14px}
  .note{font-size:12px;color:#8a867f;text-align:center;margin-top:14px}
</style></head><body>
<form class="card" method="POST" action="/login">
  <div class="logo">£</div>
  <h1>Spend Tracker</h1>
  <p class="sub">Log in once and this device stays signed in.</p>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="u">Username</label>
  <input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Log in</button>
  <div class="note">You'll stay logged in for a year on this device.</div>
</form>
</body></html>`);
    }

    async function handleLogin(req, res) {
        const ip = clientIp(req);
        const form = await readForm(req);
        const next = safeNext(form.get('next'));
        const now = Date.now();
        let state = failures.get(ip);
        if (state && state.until > now) {
            return sendLoginPage(res, { next, status: 429, error: 'Too many wrong attempts. Try again in 15 minutes.' });
        }
        // Start a fresh count if there's none, the lockout has ended, or the last count is old.
        if (!state || state.until || now - state.first > LOCKOUT_MS) state = { count: 0, first: now, until: 0 };

        const userOk = safeEqual((form.get('username') || '').trim(), username);
        const passOk = safeEqual(form.get('password') || '', password);
        if (userOk && passOk) {
            failures.delete(ip);
            const cookie = `${cookieName}=${makeToken()}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
            return redirect(res, next, cookie);
        }
        state.count += 1;
        if (state.count >= MAX_FAILURES) state.until = now + LOCKOUT_MS;
        if (failures.size > 1000) failures.clear(); // keep memory bounded
        failures.set(ip, state);
        await new Promise(r => setTimeout(r, 600)); // slow down guessing
        sendLoginPage(res, { next, status: 401, error: 'Wrong username or password.' });
    }

    function middleware(req, res, next) {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname;

        if (!enabled) {
            res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Login is not set up yet: add APP_USERNAME and APP_PASSWORD to the .env file and restart the app.');
        }
        if (path === '/login' && req.method === 'GET') {
            if (verifyToken(getCookie(req, cookieName))) return redirect(res, safeNext(url.searchParams.get('next')));
            return sendLoginPage(res, { next: safeNext(url.searchParams.get('next')) });
        }
        if (path === '/login' && req.method === 'POST') {
            return handleLogin(req, res).catch(err => { res.writeHead(500); res.end(err.message); });
        }
        if (path === '/logout') {
            return redirect(res, '/login', `${cookieName}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
        }
        if (OPEN_PATHS.has(path) || verifyToken(getCookie(req, cookieName))) return next();

        const wantsPage = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
        if (wantsPage) return redirect(res, '/login?next=' + encodeURIComponent(req.url));
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not logged in' }));
    }

    return { middleware, enabled };
}

module.exports = createAuth;
