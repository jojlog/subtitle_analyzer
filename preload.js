const { contextBridge, ipcRenderer } = require('electron');

// Preload script - exposes IPC methods to renderer securely
// This script runs in a secure context between main and renderer

// Whitelist of allowed IPC channels for security
const ALLOWED_CHANNELS = new Set([
  'save-analyses',
  'load-analyses',
  'save-api-key',
  'load-api-key',
  'delete-api-key',
  'save-theme',
  'load-theme',
  'save-study-sessions',
  'load-study-sessions',
  'check-unfinished-files',
  'cleanup-unfinished-files',
  'renderer-debug-log',
  'save-preview-image',
  'get-thumbnail-path'
]);

// Helper function to safely wrap IPC calls with error handling and channel validation
function safeInvoke(channel, ...args) {
  // Validate channel is in whitelist
  if (!ALLOWED_CHANNELS.has(channel)) {
    console.error(`[SECURITY] Blocked unauthorized IPC channel: ${channel}`);
    return Promise.resolve({ 
      success: false, 
      error: `Unauthorized IPC channel: ${channel}` 
    });
  }

  // Validate arguments (basic type checking)
  if (args.length > 0) {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      // Reject functions and complex objects that could be exploited
      if (typeof arg === 'function') {
        console.error(`[SECURITY] Blocked function argument in IPC call: ${channel}`);
        return Promise.resolve({ 
          success: false, 
          error: 'Functions cannot be passed via IPC' 
        });
      }
    }
  }

  try {
    return ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    console.error(`IPC invoke error for channel "${channel}":`, error);
    return Promise.resolve({ 
      success: false, 
      error: error.message || 'IPC call failed' 
    });
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Saved analyses
  saveAnalyses: (data) => safeInvoke('save-analyses', data),
  loadAnalyses: () => safeInvoke('load-analyses'),
  
  // API key
  saveApiKey: (key) => safeInvoke('save-api-key', key),
  loadApiKey: () => safeInvoke('load-api-key'),
  
  // Theme
  saveTheme: (theme) => safeInvoke('save-theme', theme),
  loadTheme: () => safeInvoke('load-theme'),
  
  // Study sessions
  saveStudySessions: (data) => safeInvoke('save-study-sessions', data),
  loadStudySessions: () => safeInvoke('load-study-sessions'),
  
  // Exit handling
  checkUnfinishedFiles: () => safeInvoke('check-unfinished-files'),
  cleanupUnfinishedFiles: () => safeInvoke('cleanup-unfinished-files'),
  
  // Debug logging to terminal
  debugLog: (level, message, ...args) => {
    try {
      return ipcRenderer.invoke('renderer-debug-log', level, message, ...args);
    } catch (error) {
      // Silently fail for debug logging to avoid recursion
      return Promise.resolve({ success: false });
    }
  },
  
  // Image capture
  savePreviewImage: (analysisId, imageData) => safeInvoke('save-preview-image', analysisId, imageData),
  getThumbnailPath: (analysisId) => safeInvoke('get-thumbnail-path', analysisId)
});

