const { contextBridge, ipcRenderer } = require('electron');

// Preload script - exposes IPC methods to renderer securely
// This script runs in a secure context between main and renderer

contextBridge.exposeInMainWorld('electronAPI', {
  // Saved analyses
  saveAnalyses: (data) => ipcRenderer.invoke('save-analyses', data),
  loadAnalyses: () => ipcRenderer.invoke('load-analyses'),
  
  // API key
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  loadApiKey: () => ipcRenderer.invoke('load-api-key'),
  
  // Theme
  saveTheme: (theme) => ipcRenderer.invoke('save-theme', theme),
  loadTheme: () => ipcRenderer.invoke('load-theme'),
  
  // Study sessions
  saveStudySessions: (data) => ipcRenderer.invoke('save-study-sessions', data),
  loadStudySessions: () => ipcRenderer.invoke('load-study-sessions')
});

