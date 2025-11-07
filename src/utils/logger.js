import { invokeRendererDebug } from '../services/electronBridge.js';

 /**
 * Debug logging helper shared across renderer modules.
 * Mirrors the original behaviour while allowing injection in tests.
 */

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @returns {string}
 */
function getConsoleColor(level) {
    switch (level) {
        case 'debug':
            return '#9CA3AF';
        case 'info':
            return '#2563EB';
        case 'warn':
            return '#F59E0B';
        case 'error':
            return '#DC2626';
        default:
            return '#2563EB';
    }
}

/**
 * Central logging function – writes to the console, pipes to Electron main (if exposed),
 * and renders to the on-screen debug panel when present.
 *
 * @param {string} operation
 * @param {Record<string, any> | any} details
 * @param {'debug'|'info'|'warn'|'error'|'success'} [level='info']
 */
export function debugLog(operation, details = {}, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix =
        level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '✅' : '🔍';

    // Browser console output
    console.log(
        `%c${prefix} [${timestamp}] ${operation}`,
        `color:${getConsoleColor(level)}; font-weight:600`,
        details,
    );

    // Send to Electron main process if bridge is available
    const detailsStr =
        typeof details === 'object' && details !== null ? JSON.stringify(details) : String(details);
    invokeRendererDebug(level, `${operation}`, detailsStr);

    // Log to on-screen debug console when present
    const debugMessages = document.getElementById('debugMessages');
    if (debugMessages) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `debug-message ${level}`;

        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'debug-timestamp';
        timestampSpan.textContent = `[${timestamp}]`;

        const operationSpan = document.createElement('span');
        operationSpan.className = 'debug-operation';
        operationSpan.textContent = `${prefix} ${operation}`;

        const detailsSpan = document.createElement('span');
        detailsSpan.className = 'debug-details';
        detailsSpan.textContent =
            typeof details === 'string' ? details : JSON.stringify(details, null, 2);

        messageDiv.append(timestampSpan, operationSpan, detailsSpan);
        debugMessages.appendChild(messageDiv);
        debugMessages.scrollTop = debugMessages.scrollHeight;

        while (debugMessages.children.length > 200) {
            debugMessages.removeChild(debugMessages.firstChild);
        }
    }
}
