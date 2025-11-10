// Load environment variables from .env file (for development)
require('dotenv').config();

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

let mainWindow;

// Debug logging utility
const DEBUG_ENABLED = process.env.DEBUG === 'true' || process.env.DEBUG === '1' || process.env.NODE_ENV === 'development';

function debugLog(level, message, ...args) {
  if (!DEBUG_ENABLED && level !== 'error') {
    return;
  }
  
  const timestamp = new Date().toISOString();
  const levelColors = {
    debug: '\x1b[36m',    // Cyan
    info: '\x1b[32m',     // Green
    warn: '\x1b[33m',     // Yellow
    error: '\x1b[31m',    // Red
    reset: '\x1b[0m'      // Reset
  };
  
  const color = levelColors[level] || levelColors.reset;
  const reset = levelColors.reset;
  const levelUpper = level.toUpperCase().padEnd(5);
  
  const formattedMessage = `[${timestamp}] ${color}${levelUpper}${reset} ${message}`;
  
  if (level === 'error') {
    console.error(formattedMessage, ...args);
  } else if (level === 'warn') {
    console.warn(formattedMessage, ...args);
  } else {
    console.log(formattedMessage, ...args);
  }
}

// Expose debug logger for IPC calls from renderer
const debugLogger = {
  debug: (...args) => debugLog('debug', ...args),
  info: (...args) => debugLog('info', ...args),
  warn: (...args) => debugLog('warn', ...args),
  error: (...args) => debugLog('error', ...args)
};

if (DEBUG_ENABLED) {
  debugLog('info', 'Debug logging enabled');
}

function createWindow() {
  debugLog('debug', 'Creating main window');
  
  // Set icon path based on platform
  const iconPath = process.platform === 'darwin' 
    ? path.join(__dirname, 'build', 'icons', 'mac', 'icon.icns')
    : path.join(__dirname, 'build', 'icons', 'png', '1024x1024.png');
  
  // Load icon using nativeImage for better compatibility
  const appIcon = nativeImage.createFromPath(iconPath);
  if (appIcon.isEmpty()) {
    debugLog('warn', 'Failed to load icon from path', { path: iconPath });
  } else {
    debugLog('debug', 'Icon loaded successfully', { path: iconPath, size: appIcon.getSize() });
  }
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    icon: appIcon.isEmpty() ? iconPath : appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    frame: true
  });

  mainWindow.loadFile('index.html');
  debugLog('info', 'Main window created and loaded');

  // Handle window close with exit confirmation
  mainWindow.on('close', async (event) => {
    debugLog('debug', 'Window close event triggered');
    
    // IMPORTANT: Prevent default close immediately to allow async check
    event.preventDefault();
    
    // Check for unfinished files by calling IPC handler
    try {
      debugLog('info', 'Checking for unfinished files...');
      
      // Use the IPC handler we just created
      const checkResult = await new Promise((resolve) => {
        // We need to call the handler directly since we're in main process
        // But handlers are async, so we'll use executeJavaScript to check
        mainWindow.webContents.executeJavaScript(`
          (() => {
            try {
              // Check for unfinished files in fileProjects
              const fileProjectsArray = window.fileProjects || [];
              const unfinished = fileProjectsArray.filter(p => 
                p && (p.status === 'analyzing' || p.status === 'paused' || p.status === 'queued' || 
                (p.status === 'ready' && window.isAnalyzing === true))
              );
              
              // Also check global analysis state
              const hasActiveAnalysis = window.isAnalyzing === true || window.isPaused === true;
              
              // Check for processing items in saved analyses
              const hasPlaceholder = window.currentPlaceholderId ? true : false;
              
              const totalCount = Math.max(
                unfinished.length,
                hasActiveAnalysis ? 1 : 0,
                hasPlaceholder ? 1 : 0
              );
              
              console.log('🔍 EXIT CHECK:', {
                fileProjectsCount: fileProjectsArray.length,
                unfinishedCount: unfinished.length,
                unfinishedStatuses: unfinished.map(p => ({ name: p.fileName, status: p.status })),
                isAnalyzing: window.isAnalyzing,
                isPaused: window.isPaused,
                hasPlaceholder: hasPlaceholder,
                totalCount: totalCount
              });
              
              return { 
                count: totalCount,
                fileNames: unfinished.map(p => p.fileName),
                hasActiveAnalysis: hasActiveAnalysis,
                hasPlaceholder: hasPlaceholder,
                details: {
                  unfinished: unfinished.length,
                  activeAnalysis: hasActiveAnalysis ? 1 : 0,
                  placeholder: hasPlaceholder ? 1 : 0
                }
              };
            } catch (err) {
              console.error('Error in exit check:', err);
              return { count: 0, fileNames: [], hasActiveAnalysis: false, hasPlaceholder: false, error: err.message };
            }
          })()
        `).then(resolve).catch((err) => {
          debugLog('error', 'Error executing JavaScript for exit check:', err.message);
          console.error('Exit check error:', err);
          resolve({ count: 0, fileNames: [], hasActiveAnalysis: false, hasPlaceholder: false, error: err.message });
        });
      });
      
      debugLog('info', 'Exit check result', checkResult);
      console.log('Exit check result:', checkResult);
      
      if (checkResult && checkResult.count > 0) {
        debugLog('warn', 'Unfinished files detected, showing confirmation dialog', { 
          count: checkResult.count,
          fileNames: checkResult.fileNames,
          hasActiveAnalysis: checkResult.hasActiveAnalysis,
          details: checkResult.details
        });
        
        // Show confirmation dialog
        const { dialog } = require('electron');
        // Per spec: "All ongoing files will be deleted. Continue?"
        const response = await dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Exit Confirmation',
          message: 'All ongoing files will be deleted.',
          detail: `You have ${checkResult.count} file(s) that are currently analyzing, paused, or queued. Continue?`,
          buttons: ['Cancel', 'Exit'],
          defaultId: 0,
          cancelId: 0
        });
        
        debugLog('info', 'Dialog response received', { response: response.response });
        
        if (response.response === 0) {
          // User cancelled - window close already prevented
          debugLog('info', 'Exit cancelled by user');
          return; // Don't close window
        }
        
        // User confirmed - cleanup unfinished files
        debugLog('info', 'User confirmed exit, cleaning up unfinished files');
        try {
          await mainWindow.webContents.executeJavaScript(`
            (() => {
              if (window.cleanupUnfinishedFiles) {
                return window.cleanupUnfinishedFiles();
              }
              return Promise.resolve();
            })()
          `);
          // Wait a bit to ensure cleanup completes
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (cleanupError) {
          debugLog('error', 'Error during cleanup:', cleanupError.message);
        }
        
        // Now allow window to close
        debugLog('info', 'Closing window after cleanup');
        mainWindow.destroy();
      } else {
        debugLog('info', 'No unfinished files detected, allowing exit');
        // No unfinished files, allow close
        mainWindow.destroy();
      }
    } catch (error) {
      debugLog('error', 'Error checking unfinished files during exit:', error.message);
      console.error('Exit handler error:', error);
      // On error, allow exit (safer than blocking)
      mainWindow.destroy();
    }
  });

  // Open DevTools only in development mode
  if (DEBUG_ENABLED || process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  debugLog('info', 'App ready, initializing...');
  
  // Set Dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = path.join(__dirname, 'build', 'icons', 'mac', 'icon.icns');
    const dockIcon = nativeImage.createFromPath(dockIconPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
      debugLog('info', 'Dock icon set', { path: dockIconPath, size: dockIcon.getSize() });
    } else {
      debugLog('warn', 'Failed to load Dock icon', { path: dockIconPath });
    }
  }
  
  createWindow();

  app.on('activate', () => {
    debugLog('debug', 'App activated');
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  debugLog('debug', 'All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// File path helpers
function getDataFilePath(filename) {
  const filePath = path.join(app.getPath('userData'), filename);
  debugLog('debug', `Resolved data file path: ${filename} -> ${filePath}`);
  return filePath;
}

// Encryption helpers for API key
function getEncryptionKey() {
  // Generate a machine-specific key based on app name and user data path
  // This ensures the key is unique per installation but persistent
  const keySource = `${app.getName()}-${app.getPath('userData')}`;
  return crypto.createHash('sha256').update(keySource).digest();
}

function encryptApiKey(apiKey) {
  try {
    debugLog('debug', 'Encrypting API key');
    const algorithm = 'aes-256-gcm';
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    debugLog('debug', 'API key encrypted successfully');
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    debugLog('error', 'Encryption error (key not exposed):', error.message);
    throw new Error('Failed to encrypt API key');
  }
}

function decryptApiKey(encryptedData) {
  try {
    debugLog('debug', 'Decrypting API key');
    const algorithm = 'aes-256-gcm';
    const key = getEncryptionKey();
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    debugLog('debug', 'API key decrypted successfully');
    return decrypted;
  } catch (error) {
    debugLog('error', 'Decryption error (key not exposed):', error.message);
    throw new Error('Failed to decrypt API key');
  }
}

// Set secure file permissions (Unix/Mac only)
async function setSecureFilePermissions(filePath) {
  try {
    // Set file permissions to read/write for owner only (600)
    await fs.chmod(filePath, 0o600);
    debugLog('debug', `Set secure permissions on ${path.basename(filePath)}`);
  } catch (error) {
    // Ignore errors on Windows or if chmod fails
    // File permissions are less critical on Windows
    debugLog('debug', `Could not set permissions on ${path.basename(filePath)} (expected on Windows)`);
  }
}

// IPC Handlers for saved analyses
// Save queue for preventing race conditions
const saveQueue = [];
let isSaving = false;

// Process save queue sequentially
async function processSaveQueue() {
  if (isSaving || saveQueue.length === 0) {
    return;
  }
  
  isSaving = true;
  
  while (saveQueue.length > 0) {
    const { data, resolve, reject } = saveQueue.shift();
    
    try {
      debugLog('debug', 'Processing save from queue', { queueLength: saveQueue.length });
      const result = await saveAnalysesAtomic(data);
      resolve(result);
    } catch (error) {
      debugLog('error', 'Save operation failed', { error: error.message });
      resolve({ success: false, error: error.message });
    }
  }
  
  isSaving = false;
}

// Atomic save function - writes to temp file then renames
async function saveAnalysesAtomic(data) {
  const filePath = getDataFilePath('saved_analyses.json');
  const tempPath = filePath + '.tmp';
  
  try {
    // Write to temp file first
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
    
    // Set permissions on temp file (Unix/Mac only)
    await setSecureFilePermissions(tempPath);
    
    // Atomic rename - if this fails, temp file remains but original is intact
    await fs.rename(tempPath, filePath);
    
    debugLog('info', 'Analyses saved successfully (atomic write)');
    return { success: true };
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath).catch(() => {
        // Ignore errors if temp file doesn't exist
      });
    } catch (cleanupError) {
      debugLog('warn', 'Failed to cleanup temp file', { error: cleanupError.message });
    }
    
    debugLog('error', 'Error saving analyses:', error.message);
    throw error;
  }
}

ipcMain.handle('save-analyses', async (event, data) => {
  return new Promise((resolve, reject) => {
    // Add to queue
    saveQueue.push({ data, resolve, reject });
    
    // Process queue if not already processing
    processSaveQueue().catch((error) => {
      debugLog('error', 'Error processing save queue:', error.message);
    });
  });
});

// JSON recovery function - attempts to recover valid JSON from corrupted file
async function recoverJSONFromCorruptedFile(filePath) {
  try {
    debugLog('warn', 'Attempting JSON recovery from corrupted file');
    
    // Create backup with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = filePath + '.backup.' + timestamp;
    const data = await fs.readFile(filePath, 'utf8');
    await fs.writeFile(backupPath, data, 'utf8');
    debugLog('info', 'Backed up corrupted file', { backupPath });
    
    // Try to find the last valid closing bracket/brace
    let lastValidPos = -1;
    let bracketCount = 0;
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '[') bracketCount++;
      if (char === ']') bracketCount--;
      if (char === '{') braceCount++;
      if (char === '}') braceCount--;
      
      // Check if we've reached a valid end point (array expected)
      if (bracketCount === 0 && braceCount === 0 && i > 0) {
        // Try to parse up to this point
        try {
          const truncated = data.substring(0, i + 1);
          const parsed = JSON.parse(truncated);
          if (Array.isArray(parsed)) {
            lastValidPos = i + 1;
            debugLog('info', 'Found valid JSON at position', { position: lastValidPos, recoveredCount: parsed.length });
          }
        } catch (e) {
          // Not valid yet, continue
        }
      }
    }
    
    // If we found valid JSON, parse it
    if (lastValidPos > 0) {
      const recovered = data.substring(0, lastValidPos);
      const parsed = JSON.parse(recovered);
      debugLog('info', 'Recovered partial data', { count: parsed.length, recovered: true });
      
      // Optionally write back the recovered data
      try {
        await saveAnalysesAtomic(parsed);
        debugLog('info', 'Recovered data written back to file');
      } catch (writeError) {
        debugLog('warn', 'Failed to write recovered data', { error: writeError.message });
      }
      
      return { success: true, data: parsed, recovered: true };
    }
    
    debugLog('warn', 'Could not recover valid JSON from corrupted file');
    return null;
  } catch (recoveryError) {
    debugLog('error', 'Recovery attempt failed', { error: recoveryError.message });
    return null;
  }
}

ipcMain.handle('load-analyses', async () => {
  try {
    debugLog('debug', 'Loading analyses');
    const filePath = getDataFilePath('saved_analyses.json');
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    debugLog('info', 'Analyses loaded successfully', { count: Array.isArray(parsed) ? parsed.length : 'unknown' });
    return { success: true, data: parsed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      debugLog('debug', 'Analyses file not found, returning empty array');
      return { success: true, data: [] };
    }
    
    // JSON parse error - try to recover
    if (error.message && error.message.includes('JSON')) {
      debugLog('warn', 'JSON parse error detected, attempting recovery', { error: error.message });
      const filePath = getDataFilePath('saved_analyses.json');
      const recoveryResult = await recoverJSONFromCorruptedFile(filePath);
      
      if (recoveryResult) {
        return recoveryResult;
      }
      
      // Recovery failed - return empty array
      debugLog('error', 'JSON recovery failed, returning empty array');
      return { success: true, data: [], recovered: false };
    }
    
    debugLog('error', 'Error loading analyses:', error.message);
    return { success: false, error: error.message, data: [] };
  }
});

// IPC Handlers for API key with encryption
ipcMain.handle('save-api-key', async (event, key) => {
  try {
    debugLog('debug', 'Saving API key');
    if (!key || typeof key !== 'string') {
      debugLog('warn', 'Invalid API key provided');
      return { success: false, error: 'Invalid API key' };
    }
    
    const filePath = getDataFilePath('api_key.json');
    const encrypted = encryptApiKey(key);
    
    // Write encrypted data
    await fs.writeFile(filePath, JSON.stringify(encrypted), 'utf8');
    
    // Set secure file permissions
    await setSecureFilePermissions(filePath);
    
    debugLog('info', 'API key saved successfully');
    return { success: true };
  } catch (error) {
    // Don't expose the API key in error messages
    debugLog('error', 'Error saving API key (key not exposed):', error.message);
    return { success: false, error: 'Failed to save API key securely' };
  }
});

ipcMain.handle('load-api-key', async () => {
  try {
    debugLog('debug', 'Loading API key');
    // First, check for API key in encrypted storage (user-entered in app)
    try {
      const filePath = getDataFilePath('api_key.json');
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Check if it's the old format (plain text) or new format (encrypted)
      if (parsed.key && !parsed.encrypted) {
        // Old format - migrate to encrypted format
        debugLog('info', 'Migrating API key from old format to encrypted format');
        const encrypted = encryptApiKey(parsed.key);
        await fs.writeFile(filePath, JSON.stringify(encrypted), 'utf8');
        await setSecureFilePermissions(filePath);
        debugLog('info', 'API key loaded from storage (migrated)');
        return { success: true, key: parsed.key };
      } else if (parsed.encrypted) {
        // New encrypted format
        const decrypted = decryptApiKey(parsed);
        debugLog('info', 'API key loaded from encrypted storage');
        return { success: true, key: decrypted };
      }
    } catch (error) {
      // If no key in storage, fall through to .env check
      if (error.code !== 'ENOENT') {
        debugLog('error', 'Error loading API key from storage (key not exposed):', error.message);
      } else {
        debugLog('debug', 'API key not found in storage, checking .env');
      }
    }
    
    // Fall back to .env file (for development) if no key entered in app
    if (process.env.OPENAI_API_KEY) {
      debugLog('info', 'API key loaded from .env file');
      return { success: true, key: process.env.OPENAI_API_KEY };
    }
    
    // No API key found anywhere
    debugLog('warn', 'No API key found');
    return { success: true, key: null };
  } catch (error) {
    // Don't expose the API key in error messages
    debugLog('error', 'Error loading API key (key not exposed):', error.message);
    return { success: false, error: 'Failed to load API key securely', key: null };
  }
});

ipcMain.handle('delete-api-key', async () => {
  try {
    debugLog('debug', 'Deleting API key');
    const filePath = getDataFilePath('api_key.json');
    await fs.unlink(filePath);
    debugLog('info', 'API key deleted successfully');
    return { success: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, consider it already deleted
      debugLog('debug', 'API key file not found (already deleted)');
      return { success: true };
    }
    debugLog('error', 'Error deleting API key (key not exposed):', error.message);
    return { success: false, error: 'Failed to delete API key' };
  }
});

// IPC Handlers for theme
ipcMain.handle('save-theme', async (event, theme) => {
  try {
    debugLog('debug', 'Saving theme', { theme });
    const filePath = getDataFilePath('theme.json');
    await fs.writeFile(filePath, JSON.stringify({ theme }), 'utf8');
    debugLog('info', 'Theme saved successfully');
    return { success: true };
  } catch (error) {
    debugLog('error', 'Error saving theme:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-theme', async () => {
  try {
    debugLog('debug', 'Loading theme');
    const filePath = getDataFilePath('theme.json');
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    const theme = parsed.theme || 'dark';
    debugLog('info', 'Theme loaded', { theme });
    return { success: true, theme };
  } catch (error) {
    if (error.code === 'ENOENT') {
      debugLog('debug', 'Theme file not found, using default (dark)');
      return { success: true, theme: 'dark' };
    }
    debugLog('error', 'Error loading theme:', error.message);
    return { success: false, error: error.message, theme: 'dark' };
  }
});

// IPC Handlers for saved study sessions
ipcMain.handle('save-study-sessions', async (event, data) => {
  try {
    debugLog('debug', 'Saving study sessions', { count: Array.isArray(data) ? data.length : 'unknown' });
    const filePath = getDataFilePath('saved_study_sessions.json');
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    debugLog('info', 'Study sessions saved successfully');
    return { success: true };
  } catch (error) {
    debugLog('error', 'Error saving study sessions:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-study-sessions', async () => {
  try {
    debugLog('debug', 'Loading study sessions');
    const filePath = getDataFilePath('saved_study_sessions.json');
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    debugLog('info', 'Study sessions loaded successfully', { count: Array.isArray(parsed) ? parsed.length : 'unknown' });
    return { success: true, data: parsed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      debugLog('debug', 'Study sessions file not found, returning empty array');
      return { success: true, data: [] };
    }
    debugLog('error', 'Error loading study sessions:', error.message);
    return { success: false, error: error.message, data: [] };
  }
});

// IPC Handler for renderer debug logs
ipcMain.handle('renderer-debug-log', async (event, level, message, ...args) => {
  debugLog(level, `[Renderer] ${message}`, ...args);
  return { success: true };
});

// IPC Handlers for exit check and cleanup
ipcMain.handle('check-unfinished-files', async () => {
  try {
    debugLog('debug', 'Checking for unfinished files');
    // Send message to renderer to check for unfinished files
    if (mainWindow && mainWindow.webContents) {
      const result = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const unfinished = window.fileProjects ? window.fileProjects.filter(p => 
            p.status === 'analyzing' || p.status === 'paused' || p.status === 'queued'
          ) : [];
          return { count: unfinished.length, fileNames: unfinished.map(p => p.fileName) };
        })()
      `);
      debugLog('info', 'Unfinished files check completed', result);
      return { success: true, ...result };
    }
    return { success: true, count: 0, fileNames: [] };
  } catch (error) {
    debugLog('error', 'Error checking unfinished files:', error.message);
    return { success: false, error: error.message, count: 0, fileNames: [] };
  }
});

ipcMain.handle('cleanup-unfinished-files', async () => {
  try {
    debugLog('debug', 'Cleaning up unfinished files');
    // Send message to renderer to cleanup unfinished files
    if (mainWindow && mainWindow.webContents) {
      await mainWindow.webContents.executeJavaScript(`
        (() => {
          if (window.cleanupUnfinishedFiles) {
            return window.cleanupUnfinishedFiles();
          }
          return Promise.resolve();
        })()
      `);
      debugLog('info', 'Unfinished files cleanup completed');
      return { success: true };
    }
    return { success: true };
  } catch (error) {
    debugLog('error', 'Error cleaning up unfinished files:', error.message);
    return { success: false, error: error.message };
  }
});

