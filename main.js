// Load environment variables from .env file (for development)
require('dotenv').config();

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

let mainWindow;

// Write queue for saved_analyses.json to prevent corruption from concurrent writes
let saveAnalysesQueue = Promise.resolve();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    titleBarStyle: 'hiddenInset',
    frame: true
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development (comment out for production)
  // mainWindow.webContents.openDevTools(); // Disabled to prevent DevTools from opening automatically
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// File path helpers
function getDataFilePath(filename) {
  return path.join(app.getPath('userData'), filename);
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
    const algorithm = 'aes-256-gcm';
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error('Encryption error (key not exposed):', error.message);
    throw new Error('Failed to encrypt API key');
  }
}

function decryptApiKey(encryptedData) {
  try {
    const algorithm = 'aes-256-gcm';
    const key = getEncryptionKey();
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error (key not exposed):', error.message);
    throw new Error('Failed to decrypt API key');
  }
}

// Set secure file permissions (Unix/Mac only)
async function setSecureFilePermissions(filePath) {
  try {
    // Set file permissions to read/write for owner only (600)
    await fs.chmod(filePath, 0o600);
  } catch (error) {
    // Ignore errors on Windows or if chmod fails
    // File permissions are less critical on Windows
  }
}

// IPC Handlers for saved analyses
// Use a queue to serialize writes and prevent corruption
ipcMain.handle('save-analyses', async (event, data) => {
  // Queue this write operation to ensure no concurrent writes
  saveAnalysesQueue = saveAnalysesQueue.then(async () => {
    try {
      const filePath = getDataFilePath('saved_analyses.json');
      // Validate data before writing
      if (!Array.isArray(data)) {
        console.error('Invalid data format: expected array, got', typeof data);
        return { success: false, error: 'Invalid data format' };
      }
      
      // Create temporary file first, then rename (atomic write)
      const tempPath = filePath + '.tmp';
      const jsonString = JSON.stringify(data, null, 2);
      await fs.writeFile(tempPath, jsonString, 'utf8');
      
      // Atomic rename - this ensures the file is either fully written or not at all
      await fs.rename(tempPath, filePath);
      
      return { success: true };
    } catch (error) {
      console.error('Error saving analyses:', error);
      // Clean up temp file if it exists
      try {
        const tempPath = getDataFilePath('saved_analyses.json.tmp');
        await fs.unlink(tempPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      return { success: false, error: error.message };
    }
  });
  
  return await saveAnalysesQueue;
});

ipcMain.handle('load-analyses', async () => {
  try {
    const filePath = getDataFilePath('saved_analyses.json');
    const data = await fs.readFile(filePath, 'utf8');
    
    // Try to parse JSON, with error recovery
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseError) {
      console.error('JSON parse error, attempting recovery:', parseError.message);
      console.error('Error position:', parseError.message.match(/position (\d+)/)?.[1] || 'unknown');
      
      // Try multiple recovery strategies
      let cleanedData = data.trim();
      
      // Strategy 1: Remove trailing invalid characters after last }
      const lastBrace = cleanedData.lastIndexOf(']');
      if (lastBrace !== -1 && cleanedData.trim().startsWith('[')) {
        // It's an array, find the last ]
        cleanedData = cleanedData.substring(0, lastBrace + 1);
        try {
          parsed = JSON.parse(cleanedData);
          console.log('Recovered JSON by removing trailing characters after array');
          // Save the recovered data
          const tempPath = filePath + '.tmp';
          await fs.writeFile(tempPath, JSON.stringify(parsed, null, 2), 'utf8');
          await fs.rename(tempPath, filePath);
          return { success: true, data: parsed };
        } catch (recoveryError) {
          // Continue to next strategy
        }
      }
      
      // Strategy 2: Try to find and extract valid JSON array
      const arrayMatch = cleanedData.match(/\[[\s\S]*?\]/);
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]);
          console.log('Recovered JSON by extracting array from corrupted file');
          // Save the recovered data
          const tempPath = filePath + '.tmp';
          await fs.writeFile(tempPath, JSON.stringify(parsed, null, 2), 'utf8');
          await fs.rename(tempPath, filePath);
          return { success: true, data: parsed };
        } catch (recoveryError) {
          // Continue to backup strategy
        }
      }
      
      // Strategy 3: Backup corrupted file and return empty array
      console.error('Recovery failed, backing up corrupted file and returning empty array');
      const backupPath = filePath + '.corrupted.' + Date.now();
      try {
        await fs.copyFile(filePath, backupPath);
        console.log('Corrupted file backed up to:', backupPath);
      } catch (backupError) {
        console.error('Failed to backup corrupted file:', backupError.message);
      }
      return { success: true, data: [] };
    }
    
    return { success: true, data: parsed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return { success: true, data: [] };
    }
    console.error('Error loading analyses:', error);
    return { success: false, error: error.message, data: [] };
  }
});

// IPC Handlers for API key with encryption
ipcMain.handle('save-api-key', async (event, key) => {
  try {
    if (!key || typeof key !== 'string') {
      return { success: false, error: 'Invalid API key' };
    }
    
    const filePath = getDataFilePath('api_key.json');
    const encrypted = encryptApiKey(key);
    
    // Write encrypted data
    await fs.writeFile(filePath, JSON.stringify(encrypted), 'utf8');
    
    // Set secure file permissions
    await setSecureFilePermissions(filePath);
    
    return { success: true };
  } catch (error) {
    // Don't expose the API key in error messages
    console.error('Error saving API key (key not exposed):', error.message);
    return { success: false, error: 'Failed to save API key securely' };
  }
});

ipcMain.handle('load-api-key', async () => {
  try {
    // First, check for API key in encrypted storage (user-entered in app)
    try {
      const filePath = getDataFilePath('api_key.json');
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Check if it's the old format (plain text) or new format (encrypted)
      if (parsed.key && !parsed.encrypted) {
        // Old format - migrate to encrypted format
        const encrypted = encryptApiKey(parsed.key);
        await fs.writeFile(filePath, JSON.stringify(encrypted), 'utf8');
        await setSecureFilePermissions(filePath);
        return { success: true, key: parsed.key };
      } else if (parsed.encrypted) {
        // New encrypted format
        const decrypted = decryptApiKey(parsed);
        return { success: true, key: decrypted };
      }
    } catch (error) {
      // If no key in storage, fall through to .env check
      if (error.code !== 'ENOENT') {
        console.error('Error loading API key from storage (key not exposed):', error.message);
      }
    }
    
    // Fall back to .env file (for development) if no key entered in app
    if (process.env.OPENAI_API_KEY) {
      return { success: true, key: process.env.OPENAI_API_KEY };
    }
    
    // No API key found anywhere
    return { success: true, key: null };
  } catch (error) {
    // Don't expose the API key in error messages
    console.error('Error loading API key (key not exposed):', error.message);
    return { success: false, error: 'Failed to load API key securely', key: null };
  }
});

ipcMain.handle('delete-api-key', async () => {
  try {
    const filePath = getDataFilePath('api_key.json');
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist, consider it already deleted
      return { success: true };
    }
    console.error('Error deleting API key (key not exposed):', error.message);
    return { success: false, error: 'Failed to delete API key' };
  }
});

// IPC Handlers for theme
ipcMain.handle('save-theme', async (event, theme) => {
  try {
    const filePath = getDataFilePath('theme.json');
    await fs.writeFile(filePath, JSON.stringify({ theme }), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving theme:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-theme', async () => {
  try {
    const filePath = getDataFilePath('theme.json');
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    return { success: true, theme: parsed.theme || 'dark' };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: true, theme: 'dark' };
    }
    console.error('Error loading theme:', error);
    return { success: false, error: error.message, theme: 'dark' };
  }
});

// IPC Handlers for saved study sessions
ipcMain.handle('save-study-sessions', async (event, data) => {
  try {
    const filePath = getDataFilePath('saved_study_sessions.json');
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving study sessions:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-study-sessions', async () => {
  try {
    const filePath = getDataFilePath('saved_study_sessions.json');
    const data = await fs.readFile(filePath, 'utf8');
    return { success: true, data: JSON.parse(data) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return { success: true, data: [] };
    }
    console.error('Error loading study sessions:', error);
    return { success: false, error: error.message, data: [] };
  }
});

