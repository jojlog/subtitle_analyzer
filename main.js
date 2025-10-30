const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow;

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

// IPC Handlers for saved analyses
ipcMain.handle('save-analyses', async (event, data) => {
  try {
    const filePath = getDataFilePath('saved_analyses.json');
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving analyses:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-analyses', async () => {
  try {
    const filePath = getDataFilePath('saved_analyses.json');
    const data = await fs.readFile(filePath, 'utf8');
    return { success: true, data: JSON.parse(data) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // File doesn't exist yet, return empty array
      return { success: true, data: [] };
    }
    console.error('Error loading analyses:', error);
    return { success: false, error: error.message, data: [] };
  }
});

// IPC Handlers for API key
ipcMain.handle('save-api-key', async (event, key) => {
  try {
    const filePath = getDataFilePath('api_key.json');
    await fs.writeFile(filePath, JSON.stringify({ key }), 'utf8');
    return { success: true };
  } catch (error) {
    console.error('Error saving API key:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-api-key', async () => {
  try {
    const filePath = getDataFilePath('api_key.json');
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    return { success: true, key: parsed.key || null };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: true, key: null };
    }
    console.error('Error loading API key:', error);
    return { success: false, error: error.message, key: null };
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

