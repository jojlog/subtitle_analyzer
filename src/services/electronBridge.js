/**
 * Thin wrapper around the preload-exposed Electron IPC surface.
 * Centralising access simplifies testing and future batching/caching logic.
 */

function getBridge() {
    return window.electronAPI || null;
}

function isCallable(api, method) {
    return api && typeof api[method] === 'function';
}

async function callBridge(method, ...args) {
    const api = getBridge();
    if (!isCallable(api, method)) {
        return { success: false, error: `Electron bridge unavailable for ${method}` };
    }

    try {
        return await api[method](...args);
    } catch (error) {
        return { success: false, error: error?.message || 'Unknown IPC error' };
    }
}

export const electronBridge = {
    isAvailable() {
        return Boolean(getBridge());
    },
    async loadAnalyses() {
        return callBridge('loadAnalyses');
    },
    async saveAnalyses(data) {
        return callBridge('saveAnalyses', data);
    },
    async loadStudySessions() {
        return callBridge('loadStudySessions');
    },
    async saveStudySessions(data) {
        return callBridge('saveStudySessions', data);
    },
    async loadTheme() {
        return callBridge('loadTheme');
    },
    async saveTheme(theme) {
        return callBridge('saveTheme', theme);
    },
    async loadApiKey() {
        return callBridge('loadApiKey');
    },
    async saveApiKey(key) {
        return callBridge('saveApiKey', key);
    },
    async deleteApiKey() {
        return callBridge('deleteApiKey');
    },
    async checkUnfinishedFiles() {
        return callBridge('checkUnfinishedFiles');
    },
    async cleanupUnfinishedFiles() {
        return callBridge('cleanupUnfinishedFiles');
    },
    async savePreviewImage(analysisId, imageData) {
        return callBridge('savePreviewImage', analysisId, imageData);
    },
    async getThumbnailPath(analysisId) {
        return callBridge('getThumbnailPath', analysisId);
    },
};

export async function invokeRendererDebug(level, message, details) {
    const api = getBridge();
    if (!isCallable(api, 'debugLog')) return;
    try {
        await api.debugLog(level, message, details);
    } catch {
        // ignore bridge errors
    }
}
