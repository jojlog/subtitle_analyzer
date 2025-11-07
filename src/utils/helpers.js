/**
 * Utility functions for the subtitle analyzer
 * Consolidates common helper functions for better code organization
 */

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
export function escapeHtml(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Validates analysis data structure
 * @param {object} analysisData - Analysis data to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export function validateAnalysisData(analysisData) {
    if (!analysisData || typeof analysisData !== 'object') {
        return { valid: false, error: 'Analysis data is not an object' };
    }
    
    if (!Array.isArray(analysisData.translations)) {
        return { valid: false, error: 'Analysis data missing translations array' };
    }
    
    if (!Array.isArray(analysisData.expressions)) {
        return { valid: false, error: 'Analysis data missing expressions array' };
    }
    
    // Validate translations structure
    for (let i = 0; i < analysisData.translations.length; i++) {
        const trans = analysisData.translations[i];
        if (!trans || typeof trans !== 'object') {
            return { valid: false, error: `Invalid translation at index ${i}` };
        }
        if (!trans.swedish || typeof trans.swedish !== 'string') {
            return { valid: false, error: `Translation at index ${i} missing Swedish text` };
        }
    }
    
    return { valid: true };
}

/**
 * Validates filename for rename operations
 * @param {string} fileName - Filename to validate
 * @returns {{valid: boolean, error?: string, sanitized?: string}} Validation result
 */
export function validateFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
        return { valid: false, error: 'Filename cannot be empty' };
    }
    
    const hasOuterWhitespace = /^\s|\s$/.test(fileName);
    const hasTrailingDot = /\.$/.test(fileName);
    const trimmed = fileName.trim();
    
    if (trimmed.length === 0) {
        return { valid: false, error: 'Filename cannot be empty' };
    }
    
    const MAX_FILENAME_LENGTH = 255;
    if (trimmed.length > MAX_FILENAME_LENGTH) {
        return { 
            valid: false, 
            error: `Filename cannot exceed ${MAX_FILENAME_LENGTH} characters` 
        };
    }
    
    const invalidChars = /[<>:"|?*\\/]/;
    if (invalidChars.test(trimmed)) {
        return { 
            valid: false, 
            error: 'Filename contains invalid characters: < > : " | ? * \\ /' 
        };
    }
    
    const reservedNames = [
        'CON', 'PRN', 'AUX', 'NUL', 
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];
    const upperName = trimmed.toUpperCase();
    if (reservedNames.includes(upperName)) {
        return { valid: false, error: 'Filename cannot be a reserved Windows name' };
    }
    
    if (trimmed.startsWith('.') || hasTrailingDot || hasOuterWhitespace) {
        return { 
            valid: false, 
            error: 'Filename cannot start with a dot or end with a dot or space' 
        };
    }
    
    return { valid: true, sanitized: trimmed };
}

/**
 * Validates OpenAI API key format
 * @param {string} apiKey - API key to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
export function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        return { valid: false, error: 'API key cannot be empty' };
    }
    
    const trimmed = apiKey.trim();
    
    if (trimmed.length === 0) {
        return { valid: false, error: 'API key cannot be empty' };
    }
    
    // OpenAI API keys typically start with 'sk-' and are 51+ characters
    if (!trimmed.startsWith('sk-')) {
        return { 
            valid: false, 
            error: 'API key should start with "sk-". Please check your OpenAI API key.' 
        };
    }
    
    if (trimmed.length < 20) {
        return { 
            valid: false, 
            error: 'API key appears to be too short. Please check your OpenAI API key.' 
        };
    }
    
    return { valid: true };
}

/**
 * Formats time remaining in a human-readable format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTimeRemaining(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return 'Calculating...';
    }
    
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    
    if (minutes < 60) {
        return remainingSeconds > 0 
            ? `${minutes}m ${remainingSeconds}s`
            : `${minutes}m`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    return remainingMinutes > 0
        ? `${hours}h ${remainingMinutes}m`
        : `${hours}h`;
}

/**
 * Debounce function to limit function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function to limit function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

