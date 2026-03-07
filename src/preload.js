// ─────────────────────────────────────────────────────────────────
//  Infygalaxy IDE — Preload Script (src/preload.js)
//  Secure contextBridge between Electron main & renderer
// ─────────────────────────────────────────────────────────────────
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('infyAPI', {

  // ── Persistent store ──────────────────────────────────────────
  store: {
    get: (key)      => ipcRenderer.invoke('store:get', key),
    set: (key, val) => ipcRenderer.invoke('store:set', key, val)
  },

  // ── GitHub OAuth & API ────────────────────────────────────────
  github: {
    login:     ()               => ipcRenderer.invoke('github:login'),
    logout:    ()               => ipcRenderer.invoke('github:logout'),
    getUser:   ()               => ipcRenderer.invoke('github:get-user'),
    getToken:  ()               => ipcRenderer.invoke('github:get-token'),
    api:       (opts)           => ipcRenderer.invoke('github:api', opts),
    pushFile:  (opts)           => ipcRenderer.invoke('github:push-file', opts),
    listRepos: ()               => ipcRenderer.invoke('github:list-repos'),

    // Events from main process
    onSignedIn:  (cb) => ipcRenderer.on('github:signed-in',  (_, data) => cb(data)),
    onSignedOut: (cb) => ipcRenderer.on('github:signed-out', ()        => cb()),
    onError:     (cb) => ipcRenderer.on('github:error',      (_, msg)  => cb(msg))
  },

  // ── File system (save dialog) ─────────────────────────────────
  file: {
    save: (opts) => ipcRenderer.invoke('file:save', opts)
  },

  // ── App menu events ───────────────────────────────────────────
  menu: {
    onNewProject: (cb) => ipcRenderer.on('menu:new-project', cb),
    onDownload:   (cb) => ipcRenderer.on('menu:download',    cb),
    onGitPush:    (cb) => ipcRenderer.on('menu:git-push',    cb)
  }
});
