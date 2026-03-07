// ─────────────────────────────────────────────────────────────────
//  Infygalaxy IDE — Main Process (src/main.js)
// ─────────────────────────────────────────────────────────────────
const {
  app, BrowserWindow, ipcMain, shell,
  Menu, dialog, nativeTheme, net
} = require('electron');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const crypto  = require('crypto');
const url     = require('url');

// ── Persistent store (electron-store) ────────────────────────────
let store;
try {
  const Store = require('electron-store');
  store = new Store({
    defaults: {
      githubToken: null,
      githubUser:  null,
      windowBounds: { width: 1400, height: 900 },
      anthropicKey: '',
      theme: 'dark'
    }
  });
} catch(e) {
  // Fallback simple store if electron-store not installed yet
  const storePath = path.join(app.getPath('userData'), 'config.json');
  const defaults  = { githubToken: null, githubUser: null, windowBounds: { width: 1400, height: 900 }, anthropicKey: '', theme: 'dark' };
  let data = { ...defaults };
  try { data = { ...defaults, ...JSON.parse(fs.readFileSync(storePath,'utf8')) }; } catch(e2) {}
  store = {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => { data[k] = v; fs.writeFileSync(storePath, JSON.stringify(data, null, 2)); },
    delete: (k) => { delete data[k]; fs.writeFileSync(storePath, JSON.stringify(data, null, 2)); }
  };
}

// ── GitHub OAuth config ───────────────────────────────────────────
// Replace these with your actual GitHub OAuth App credentials
// Create at: https://github.com/settings/developers → OAuth Apps → New
const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID     || 'YOUR_GITHUB_CLIENT_ID';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'YOUR_GITHUB_CLIENT_SECRET';
const OAUTH_REDIRECT_PORT  = 7823;
const OAUTH_REDIRECT_URI   = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;

let mainWindow;
let oauthServer = null;
let oauthState  = null;

// ── Create main window ────────────────────────────────────────────
function createWindow() {
  const saved = store.get('windowBounds', { width: 1400, height: 900 });

  mainWindow = new BrowserWindow({
    width:  saved.width  || 1400,
    height: saved.height || 900,
    minWidth:  900,
    minHeight: 600,
    title: 'Infygalaxy IDE',
    backgroundColor: '#07080f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: true,
    show: false,    // show after ready-to-show for smooth load
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
      webSecurity:      false,   // allow loading local blobs & srcdoc iframes
      allowRunningInsecureContent: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show when ready (prevents white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
  });

  // Persist window size
  mainWindow.on('resize', () => {
    const [width, height] = mainWindow.getSize();
    store.set('windowBounds', { width, height });
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http')) shell.openExternal(u);
    return { action: 'deny' };
  });

  // Custom menu
  buildMenu();
}

// ── App menu ──────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Project',         accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu:new-project') },
        { label: 'Download Project',    accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu:download') },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'GitHub',
      submenu: [
        { label: 'Sign in with GitHub', click: () => startGitHubOAuth() },
        { label: 'Sign Out',            click: () => signOutGitHub() },
        { type: 'separator' },
        { label: 'Push to Repository',  click: () => mainWindow.webContents.send('menu:git-push') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Infygalaxy IDE', click: () => showAbout() },
        { label: 'Report an Issue', click: () => shell.openExternal('https://github.com/infygalaxy/ide/issues') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Infygalaxy IDE',
    message: 'Infygalaxy IDE v1.0.0',
    detail: 'Claude-powered zero-code builder.\nBuild anything. No coding needed.\n\n© 2025 Infygalaxy',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico')
  });
}

// ── GitHub OAuth flow ─────────────────────────────────────────────
function startGitHubOAuth() {
  oauthState = crypto.randomBytes(20).toString('hex');

  // Start local callback server
  if (oauthServer) { try { oauthServer.close(); } catch(e) {} }

  oauthServer = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname !== '/callback') {
      res.end('Not found'); return;
    }

    const { code, state: returnedState } = parsedUrl.query;

    if (returnedState !== oauthState) {
      res.writeHead(400); res.end('State mismatch. Please try again.');
      return;
    }

    // Exchange code for token
    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code, redirect_uri: OAUTH_REDIRECT_URI })
      });
      const tokenData = await tokenRes.json();

      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      const token = tokenData.access_token;

      // Get user info
      const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Infygalaxy-IDE' }
      });
      const userData = await userRes.json();

      // Store
      store.set('githubToken', token);
      store.set('githubUser', { login: userData.login, name: userData.name, avatar_url: userData.avatar_url, email: userData.email });

      // Tell renderer
      mainWindow.webContents.send('github:signed-in', {
        login: userData.login, name: userData.name, avatar_url: userData.avatar_url
      });

      // Success page
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#07080f;color:#e8eaf6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px">
        <div style="font-size:40px">✅</div>
        <div style="font-size:20px;font-weight:700">Signed in as @${userData.login}</div>
        <div style="color:#5c6080">You can close this tab and return to Infygalaxy IDE.</div>
        <script>setTimeout(()=>window.close(),2000)</script>
      </body></html>`);

    } catch(err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h2>OAuth Error</h2><p>${err.message}</p>`);
      mainWindow.webContents.send('github:error', err.message);
    }

    oauthServer.close();
  });

  oauthServer.listen(OAUTH_REDIRECT_PORT, () => {
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}&scope=repo%20user&state=${oauthState}`;
    shell.openExternal(authUrl);
  });
}

function signOutGitHub() {
  store.delete('githubToken');
  store.delete('githubUser');
  mainWindow.webContents.send('github:signed-out');
}

// ── IPC handlers ──────────────────────────────────────────────────

// Store access
ipcMain.handle('store:get', (_, key) => store.get(key));
ipcMain.handle('store:set', (_, key, val) => store.set(key, val));

// GitHub OAuth trigger from renderer
ipcMain.handle('github:login', () => startGitHubOAuth());
ipcMain.handle('github:logout', () => signOutGitHub());
ipcMain.handle('github:get-user', () => store.get('githubUser', null));
ipcMain.handle('github:get-token', () => store.get('githubToken', null));

// GitHub API proxy (avoids CORS in renderer)
ipcMain.handle('github:api', async (_, { method, endpoint, body, token }) => {
  const t = token || store.get('githubToken');
  if (!t) throw new Error('Not authenticated with GitHub');
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method: method || 'GET',
    headers: {
      'Authorization': `Bearer ${t}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'Infygalaxy-IDE',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `GitHub API error ${res.status}`);
  return data;
});

// Push file to GitHub repo
ipcMain.handle('github:push-file', async (_, { repo, path: filePath, content, message, branch }) => {
  const token = store.get('githubToken');
  if (!token) throw new Error('Not signed in to GitHub');

  // Get current SHA if file exists (needed for update)
  let sha;
  try {
    const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch||'main'}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Infygalaxy-IDE' }
    });
    if (existing.ok) {
      const d = await existing.json();
      sha = d.sha;
    }
  } catch(e) {}

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Infygalaxy-IDE'
    },
    body: JSON.stringify({
      message: message || 'feat: built with Infygalaxy IDE',
      content: Buffer.from(content).toString('base64'),
      branch: branch || 'main',
      ...(sha ? { sha } : {})
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Push failed');
  return data;
});

// List user repos
ipcMain.handle('github:list-repos', async () => {
  const token = store.get('githubToken');
  if (!token) throw new Error('Not signed in');
  const res = await fetch('https://api.github.com/user/repos?per_page=50&sort=updated', {
    headers: { 'Authorization': `Bearer ${token}`, 'User-Agent': 'Infygalaxy-IDE' }
  });
  return res.json();
});

// Save file to disk (download)
ipcMain.handle('file:save', async (_, { defaultName, content }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'index.html',
    filters: [{ name: 'HTML Files', extensions: ['html'] }, { name: 'All Files', extensions: ['*'] }]
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, content, 'utf8');
  return { saved: true, filePath };
});

// App ready
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
