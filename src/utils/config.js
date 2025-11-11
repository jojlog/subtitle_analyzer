/**
 * Configuration Constants
 * Centralizes all configuration values
 */

export const CONFIG = {
    // File limits
    MAX_FILES: 5,
    MAX_FILENAME_LENGTH: 255,
    
    // Analysis settings
    PROGRESS_UPDATE_THRESHOLD: 25,
    BATCH_SIZE: 50,
    ITEMS_PER_PAGE: 50,
    
    // API settings
    OPENAI_MODEL: 'gpt-4o-mini',
    MAX_TOKENS: 16000,
    TEMPERATURE: 0.7,
    MAX_RETRIES: 3,
    BASE_RETRY_DELAY: 1000,
    
    // UI settings
    STUDY_RESIZER_LOCK_MS: 350,
    DEBOUNCE_DELAY: 300,
    THROTTLE_DELAY: 100,
    
    // Validation
    MIN_API_KEY_LENGTH: 20,
    API_KEY_PREFIX: 'sk-',
    
    // File types
    ALLOWED_FILE_TYPES: ['.vtt', '.txt'],
    
    // CEFR Levels
    CEFR_LEVELS: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C3', 'Custom'],
    
    // Default selected levels
    DEFAULT_SELECTED_LEVELS: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C3', 'Custom']
};





