const { contextBridge } = require('electron');

// Preload script - minimal since we're using FileReader API in renderer
// This script runs in a secure context between main and renderer

