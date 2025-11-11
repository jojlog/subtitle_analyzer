import { addFileProject, exposeStateToWindow, getState, setFileProjects } from './src/state/store.js';
import { debugLog } from './src/utils/logger.js';
import { electronBridge } from './src/services/electronBridge.js';
import { 
    escapeHtml, 
    validateAnalysisData, 
    validateFileName, 
    validateApiKey,
    formatTimeRemaining 
} from './src/utils/helpers.js';
import { viewManager, VIEWS } from './src/utils/viewManager.js';
import { CONFIG } from './src/utils/config.js';
import { renderExpressions } from './src/utils/expressionRenderer.js';
import { createChatMessage, removeChatMessage } from './src/utils/chatBuilder.js';
import { showWarningModal, showRenameModal, showChatHistoryModal, showChatHistory } from './src/utils/modalManager.js';

// Shared state (work in progress modularisation)
const state = getState();
exposeStateToWindow(window);

// Constants - Now using CONFIG module
const PROGRESS_UPDATE_THRESHOLD = CONFIG.PROGRESS_UPDATE_THRESHOLD;
const STUDY_RESIZER_LOCK_MS = CONFIG.STUDY_RESIZER_LOCK_MS;

// Unique ID generation: timestamp + counter to prevent collisions
let idCounter = 0;
function generateUniqueId() {
    idCounter++;
    return `${Date.now()}-${idCounter}-${Math.random().toString(36).substr(2, 9)}`;
}

// Pagination state
let currentPage = 1;
let itemsPerPage = CONFIG.ITEMS_PER_PAGE;

// DOM elements (will be initialized when DOM is ready)
let uploadArea, fileInput, fileInfo, fileName, scriptName, analyzeBtn, cancelBtn, resultsSection, uploadSection;
let fileProjectsList; // Container for multiple file projects list
let translationsContent, expressionsContent, chatSection, chatMessages, chatInput, chatSendBtn;
let saveAnalysisBtn, savedAnalysesBtn, savedAnalysesView, savedAnalysesList, editSavedBtn, goBackBtn, closeResultsBtn;
let inactiveSavesSection, inactiveSavesList, activeSavesSection, activeSavesList, activeSavesHeader, activeSavesCards;
let listViewBtn, cardViewBtn;
let savedViewMode = 'list'; // 'list' or 'card'
let currentSortColumn = 'dateEdited'; // Default sort by dateEdited
let currentSortDirection = 'desc'; // Default descending (newest first)
let currentFolderFilter = null; // Currently selected folder ID, null = show all
let settingsBtn, settingsView, closeSettingsBtn, apiKeyInput, saveApiKeyBtn, themeSelect;
let homeBtn;
let studyModal, studyTitle, studyItemContent, studyExpressionsSection, studyExpressionsContent, studyChatMessages, studyChatInput, studyChatSendBtn, closeStudyBtn, studyHistoryBtn, saveStudyBtn, studyPrevBtn, studyNextBtn;
let chatHistoryModal, chatHistoryContent, closeHistoryBtn;
let folderBreadcrumb, contextMenu;

// Study modal state
let currentStudyItem = null;
let currentStudyChatHistory = [];
let isEditMode = false;
let studyResizerUnlockTimeout = null;

// CEFR Level filtering
let selectedLevels = [...CONFIG.DEFAULT_SELECTED_LEVELS]; // All levels selected by default

// CEFR Level filtering for study modal (separate from main view)
let selectedStudyLevels = [...CONFIG.DEFAULT_SELECTED_LEVELS]; // All levels selected by default

// Initialize API key from storage
async function initializeAPIKey() {
    try {
        const result = await electronBridge.loadApiKey();
            if (result.success && result.key) {
            state.apiKey = result.key;
                return true;
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }
    return false;
}

// Reinitialize API key when loading saved analysis
async function reinitializeAPIKey() {
    try {
        const result = await electronBridge.loadApiKey();
            if (result.success && result.key) {
            state.apiKey = result.key;
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }
}

// Initialize theme from storage
async function initializeTheme() {
    try {
        let savedTheme = 'dark';
        const result = await electronBridge.loadTheme();
        if (result.success && result.theme) {
                savedTheme = result.theme;
        }
        await applyTheme(savedTheme);
        if (themeSelect) {
            themeSelect.value = savedTheme;
        }
    } catch (error) {
        console.error('Error loading theme:', error);
        applyTheme('dark');
    }
}

// Apply theme
async function applyTheme(theme) {
    // Remove all theme classes
    document.body.classList.remove('theme-light', 'theme-blue', 'theme-green', 'theme-purple');
    
    // Apply selected theme (dark is default, no class needed)
    if (theme !== 'dark') {
        document.body.classList.add(`theme-${theme}`);
    }
    
    // Save to file storage
    try {
        await electronBridge.saveTheme(theme);
    } catch (error) {
        console.error('Error saving theme:', error);
    }
}

async function loadAnalysesSafe() {
    const result = await electronBridge.loadAnalyses();
    if (result.success) {
        return result;
    }
    return { success: false, data: [], error: result.error };
}

async function saveAnalysesSafe(data) {
    const result = await electronBridge.saveAnalyses(data);
    if (!result.success) {
        debugLog('❌ SAVE ANALYSES FAILED', { error: result.error }, 'error');
    }
    return result;
}

async function fetchSavedAnalyses(context = '') {
    const result = await loadAnalysesSafe();
    if (!result.success) {
        debugLog(
            '⚠️ FAILED TO LOAD ANALYSES',
            { error: result.error, context },
            'warn',
        );
        return [];
    }
    return result.data || [];
}

// Folder management functions
async function createFolder(folderName) {
    if (!folderName || !folderName.trim()) {
        return { success: false, error: 'Folder name cannot be empty' };
    }
    
    const trimmedName = folderName.trim();
    const saved = await fetchSavedAnalyses('create-folder');
    
    // Check for duplicate folder name
    const duplicate = saved.find(item => item.type === 'folder' && item.folderName === trimmedName);
    if (duplicate) {
        return { success: false, error: 'Folder with this name already exists' };
    }
    
    const now = new Date().toISOString();
    const newFolder = {
        id: generateUniqueId(),
        type: 'folder',
        folderName: trimmedName,
        dateCreated: now,
        dateEdited: now
    };
    
    // Immediately add folder to UI (optimistic update)
    if (currentFolderFilter === null) {
        addFolderToUI(newFolder);
    }
    
    // Save in background
    saved.push(newFolder);
    const result = await saveAnalysesSafe(saved);
    
    if (result.success) {
        debugLog('✅ FOLDER CREATED', { folderId: newFolder.id, folderName: trimmedName }, 'success');
    } else {
        // If save failed, remove from UI
        removeFolderFromUI(newFolder.id);
        return { success: false, error: 'Failed to save folder' };
    }
    
    return result;
}

// Helper function to add folder to UI immediately
function addFolderToUI(folder) {
    if (savedViewMode === 'list' && activeSavesList) {
        // Add to list view
        const folderItem = document.createElement('div');
        folderItem.className = 'saved-item saved-item-folder';
        folderItem.setAttribute('data-item-id', String(folder.id));
        folderItem.setAttribute('data-folder-id', String(folder.id));
        folderItem.setAttribute('draggable', 'false');
        
        folderItem.innerHTML = `
            <div class="saved-item-content-wrapper">
                <div class="saved-item-content">
                    <div class="saved-item-top-row">
                        <svg class="folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <span class="saved-item-name folder-name">${escapeHtml(folder.folderName)}</span>
                        <span class="saved-item-date-edited"></span>
                        <span class="saved-item-date-created"></span>
                    </div>
                </div>
            </div>
        `;
        
        // Add event handlers
        folderItem.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!isEditMode) {
                currentFolderFilter = folder.id;
                await loadSavedAnalyses();
            }
        });
        
        folderItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, folder);
        });
        
        folderItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            folderItem.classList.add('drag-over');
        });
        
        folderItem.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderItem.classList.remove('drag-over');
        });
        
        folderItem.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderItem.classList.remove('drag-over');
            
            const fileId = e.dataTransfer.getData('text/plain');
            if (fileId) {
                await assignFileToFolder(fileId, folder.id);
            }
        });
        
        // Insert in sorted position (folders should be sorted alphabetically)
        const existingFolders = Array.from(activeSavesList.querySelectorAll('.saved-item-folder'));
        let insertBefore = null;
        
        for (const existingFolder of existingFolders) {
            const existingName = existingFolder.querySelector('.folder-name')?.textContent || '';
            if (folder.folderName.localeCompare(existingName) < 0) {
                insertBefore = existingFolder;
                break;
            }
        }
        
        if (insertBefore) {
            activeSavesList.insertBefore(folderItem, insertBefore);
        } else {
            // Insert after all folders, before first file
            const firstFile = activeSavesList.querySelector('.saved-item-active:not(.saved-item-folder)');
            if (firstFile) {
                activeSavesList.insertBefore(folderItem, firstFile);
            } else {
                activeSavesList.appendChild(folderItem);
            }
        }
    } else if (savedViewMode === 'card' && activeSavesCards) {
        // Add to card view
        (async () => {
            const folderCard = document.createElement('div');
            folderCard.className = 'saved-card saved-card-folder';
            folderCard.setAttribute('data-item-id', String(folder.id));
            folderCard.setAttribute('data-folder-id', String(folder.id));
            folderCard.setAttribute('draggable', 'false');
            
            folderCard.innerHTML = `
                <div class="saved-card-folder-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="saved-card-content">
                    <div class="saved-card-header">
                        <div class="saved-card-name folder-name">${escapeHtml(folder.folderName)}</div>
                    </div>
                </div>
            `;
            
            // Add event handlers
            folderCard.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!isEditMode) {
                    currentFolderFilter = folder.id;
                    await loadSavedAnalyses();
                }
            });
            
            folderCard.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, folder);
            });
            
            folderCard.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                folderCard.classList.add('drag-over');
            });
            
            folderCard.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                folderCard.classList.remove('drag-over');
            });
            
            folderCard.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                folderCard.classList.remove('drag-over');
                
                const fileId = e.dataTransfer.getData('text/plain');
                if (fileId) {
                    await assignFileToFolder(fileId, folder.id);
                }
            });
            
            // Insert in sorted position (folders should be sorted alphabetically)
            const existingFolders = Array.from(activeSavesCards.querySelectorAll('.saved-card-folder'));
            let insertBefore = null;
            
            for (const existingFolder of existingFolders) {
                const existingName = existingFolder.querySelector('.folder-name')?.textContent || '';
                if (folder.folderName.localeCompare(existingName) < 0) {
                    insertBefore = existingFolder;
                    break;
                }
            }
            
            if (insertBefore) {
                activeSavesCards.insertBefore(folderCard, insertBefore);
            } else {
                // Insert after all folders, before first file card
                const firstFileCard = activeSavesCards.querySelector('.saved-card:not(.saved-card-folder)');
                if (firstFileCard) {
                    activeSavesCards.insertBefore(folderCard, firstFileCard);
                } else {
                    activeSavesCards.appendChild(folderCard);
                }
            }
        })();
    }
}

// Helper function to remove folder from UI (if save failed)
function removeFolderFromUI(folderId) {
    const folderItem = document.querySelector(`[data-folder-id="${folderId}"]`);
    if (folderItem) {
        folderItem.remove();
    }
}

async function renameFolder(folderId, newName) {
    if (!newName || !newName.trim()) {
        return { success: false, error: 'Folder name cannot be empty' };
    }
    
    const trimmedName = newName.trim();
    const saved = await fetchSavedAnalyses('rename-folder');
    
    const folderIndex = saved.findIndex(item => item.type === 'folder' && item.id === folderId);
    if (folderIndex === -1) {
        return { success: false, error: 'Folder not found' };
    }
    
    // Check for duplicate folder name (excluding current folder)
    const duplicate = saved.find(item => 
        item.type === 'folder' && 
        item.id !== folderId && 
        item.folderName === trimmedName
    );
    if (duplicate) {
        return { success: false, error: 'Folder with this name already exists' };
    }
    
    saved[folderIndex].folderName = trimmedName;
    saved[folderIndex].dateEdited = new Date().toISOString();
    
    const result = await saveAnalysesSafe(saved);
    
    if (result.success) {
        debugLog('✅ FOLDER RENAMED', { folderId, newName: trimmedName }, 'success');
        await loadSavedAnalyses();
    }
    
    return result;
}

async function deleteFolder(folderId, deleteFiles = false) {
    const saved = await fetchSavedAnalyses('delete-folder');
    
    const folderIndex = saved.findIndex(item => item.type === 'folder' && item.id === folderId);
    if (folderIndex === -1) {
        return { success: false, error: 'Folder not found' };
    }
    
    // Get files in this folder
    const filesInFolder = saved.filter(item => 
        item.type !== 'folder' && item.folderId === folderId
    );
    
    if (deleteFiles) {
        // Delete folder and all files in it
        const fileIds = new Set(filesInFolder.map(f => f.id));
        const filtered = saved.filter(item => 
            item.id !== folderId && !fileIds.has(item.id)
        );
        const result = await saveAnalysesSafe(filtered);
        
        if (result.success) {
            debugLog('✅ FOLDER AND FILES DELETED', { 
                folderId, 
                deletedFiles: filesInFolder.length 
            }, 'success');
            await loadSavedAnalyses();
        }
        return result;
    } else {
        // Remove folder, move files out (set folderId to null)
        saved.forEach(item => {
            if (item.type !== 'folder' && item.folderId === folderId) {
                item.folderId = null;
            }
        });
        
        // Remove folder
        saved.splice(folderIndex, 1);
        const result = await saveAnalysesSafe(saved);
        
        if (result.success) {
            debugLog('✅ FOLDER DELETED, FILES MOVED OUT', { 
                folderId, 
                movedFiles: filesInFolder.length 
            }, 'success');
            await loadSavedAnalyses();
        }
        return result;
    }
}

async function assignFileToFolder(fileId, folderId) {
    const saved = await fetchSavedAnalyses('assign-file-to-folder');
    
    const fileIndex = saved.findIndex(item => 
        item.type !== 'folder' && item.id === fileId
    );
    if (fileIndex === -1) {
        return { success: false, error: 'File not found' };
    }
    
    // Verify folder exists if folderId is not null
    if (folderId !== null) {
        const folderExists = saved.some(item => 
            item.type === 'folder' && item.id === folderId
        );
        if (!folderExists) {
            return { success: false, error: 'Folder not found' };
        }
    }
    
    saved[fileIndex].folderId = folderId;
    const result = await saveAnalysesSafe(saved);
    
    if (result.success) {
        debugLog('✅ FILE ASSIGNED TO FOLDER', { fileId, folderId }, 'success');
        await loadSavedAnalyses();
    }
    
    return result;
}

async function removeFileFromFolder(fileId) {
    return await assignFileToFolder(fileId, null);
}

async function loadStudySessionsSafe() {
    const result = await electronBridge.loadStudySessions();
    if (!result.success) {
        debugLog('⚠️ FAILED TO LOAD STUDY SESSIONS', { error: result.error }, 'warn');
        return [];
    }
    return result.data || [];
}

async function saveStudySessionsSafe(data) {
    const result = await electronBridge.saveStudySessions(data);
    if (!result.success) {
        debugLog('❌ SAVE STUDY SESSIONS FAILED', { error: result.error }, 'error');
    }
    return result;
}

// OpenAI API call function with rate limit handling
async function callOpenAI(messages, model = CONFIG.OPENAI_MODEL, retryCount = 0) {
    if (!state.apiKey) {
        throw new Error('API key not set');
    }
    
    const MAX_RETRIES = CONFIG.MAX_RETRIES;
    const BASE_DELAY = CONFIG.BASE_RETRY_DELAY;
    
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${state.apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: CONFIG.TEMPERATURE,
                    max_tokens: CONFIG.MAX_TOKENS
                })
            });

        if (!response.ok) {
            const error = await response.json();
            const errorMessage = (error && error.error && error.error.message) || 'API request failed';
            const statusCode = response.status;
            
            // Handle rate limiting (429) with exponential backoff
            if (statusCode === 429 && retryCount < MAX_RETRIES) {
                const retryAfter = response.headers.get('retry-after');
                const delay = retryAfter 
                    ? parseInt(retryAfter) * 1000 
                    : BASE_DELAY * Math.pow(2, retryCount);
                
                console.log(`Rate limited. Retrying after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return callOpenAI(messages, model, retryCount + 1);
            }
            
            throw new Error(errorMessage);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        // Retry on network errors with exponential backoff
        if (retryCount < MAX_RETRIES && !error.message.includes('API key')) {
            const delay = BASE_DELAY * Math.pow(2, retryCount);
            console.log(`Network error. Retrying after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return callOpenAI(messages, model, retryCount + 1);
        }
        throw error;
    }
}

// Helper function to check if text is valid subtitle dialogue (not metadata)
function isValidSubtitleText(text) {
    if (!text || typeof text !== 'string') {
        return false;
    }
    
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    
    // Remove common punctuation and whitespace for analysis
    const normalized = trimmed.replace(/[.,\s\-–—…]/g, '');
    
    // Check if text is purely numeric (e.g., "35, 36, 37" or "3581511172")
    if (/^\d+$/.test(normalized)) {
        return false;
    }
    
    // Check if text is mostly numbers with separators (e.g., "35, 36, 37, 38, 39")
    const numericRatio = (normalized.match(/\d/g) || []).length / Math.max(normalized.length, 1);
    if (numericRatio > 0.8 && normalized.length > 5) {
        return false;
    }
    
    // Check if text ends with a long numeric sequence (likely an ID)
    // Pattern: ends with 8+ digits
    if (/\d{8,}$/.test(trimmed)) {
        return false;
    }
    
    // Check if text is a sequence pattern like "35, 36, 37, 38, 39..."
    if (/^\d+[,\s]*\d+[,\s]*\d+[,\s]*\d+/.test(trimmed) && /^\d+[,\s\.]+$/.test(trimmed.replace(/\s/g, ''))) {
        return false;
    }
    
    // Check if text contains actual letters (Swedish or English)
    // This ensures we have dialogue, not just numbers and punctuation
    if (!/[a-zA-ZåäöÅÄÖ]/.test(trimmed)) {
        return false;
    }
    
    return true;
}

// Helper function to fix encoding in translation objects
function fixTranslationEncoding(translation) {
    if (!translation || typeof translation !== 'object') {
        return translation;
    }
    
    const fixed = { ...translation };
    
    if (fixed.swedish && typeof fixed.swedish === 'string') {
        fixed.swedish = fixEncoding(fixed.swedish);
    }
    if (fixed.literal && typeof fixed.literal === 'string') {
        fixed.literal = fixEncoding(fixed.literal);
    }
    if (fixed.natural && typeof fixed.natural === 'string') {
        fixed.natural = fixEncoding(fixed.natural);
    }
    if (fixed.word && typeof fixed.word === 'string') {
        fixed.word = fixEncoding(fixed.word);
    }
    if (fixed.meaning && typeof fixed.meaning === 'string') {
        fixed.meaning = fixEncoding(fixed.meaning);
    }
    if (fixed.example && typeof fixed.example === 'string') {
        fixed.example = fixEncoding(fixed.example);
    }
    
    return fixed;
}

// Helper function to fix encoding issues (UTF-8 misinterpreted as ISO-8859-1)
function fixEncoding(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    
    // Decode HTML entities first (in case text was HTML-encoded)
    let fixed = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#228;/g, 'ä')
        .replace(/&#196;/g, 'Ä')
        .replace(/&#229;/g, 'å')
        .replace(/&#197;/g, 'Å')
        .replace(/&#246;/g, 'ö')
        .replace(/&#214;/g, 'Ö');
    
    // Common UTF-8 to ISO-8859-1 misinterpretations for Swedish characters
    // These patterns occur when UTF-8 text is read as ISO-8859-1 or Windows-1252
    fixed = fixed
        // Fix ä characters (UTF-8: C3 A4, misread as: Ã¤)
        .replace(/Ã¤/g, 'ä')
        .replace(/Ã„/g, 'Ä')
        // Fix å characters (UTF-8: C3 A5, misread as: Ã¥)
        .replace(/Ã¥/g, 'å')
        .replace(/Ã…/g, 'Å')
        .replace(/Ã°/g, 'å')
        // Fix ö characters (UTF-8: C3 B6, misread as: Ã¶)
        .replace(/Ã¶/g, 'ö')
        .replace(/Ã–/g, 'Ö')
        // Fix common double-encoding issues (when already fixed text gets encoded again)
        .replace(/Ã¤/g, 'ä')
        .replace(/Ã¥/g, 'å')
        .replace(/Ã¶/g, 'ö')
        // Fix other common European characters
        .replace(/Ã©/g, 'é')
        .replace(/Ã¨/g, 'è')
        .replace(/Ãª/g, 'ê')
        .replace(/Ã«/g, 'ë')
        .replace(/Ã¡/g, 'á')
        .replace(/Ã /g, 'à')
        .replace(/Ã¢/g, 'â')
        .replace(/Ã£/g, 'ã')
        .replace(/Ã§/g, 'ç')
        .replace(/Ã­/g, 'í')
        .replace(/Ã¬/g, 'ì')
        .replace(/Ã®/g, 'î')
        .replace(/Ã¯/g, 'ï')
        .replace(/Ã³/g, 'ó')
        .replace(/Ã²/g, 'ò')
        .replace(/Ã´/g, 'ô')
        .replace(/Ãµ/g, 'õ')
        .replace(/Ãº/g, 'ú')
        .replace(/Ã¹/g, 'ù')
        .replace(/Ã»/g, 'û')
        .replace(/Ã¼/g, 'ü')
        .replace(/Ã½/g, 'ý')
        .replace(/Ã¿/g, 'ÿ')
        // Fix uppercase variants
        .replace(/Ã‰/g, 'É')
        .replace(/Ãˆ/g, 'È')
        .replace(/ÃŠ/g, 'Ê')
        .replace(/Ã‹/g, 'Ë')
        .replace(/Ã€/g, 'À')
        .replace(/Ã‚/g, 'Â')
        .replace(/Ãƒ/g, 'Ã')
        .replace(/Ã‡/g, 'Ç')
        .replace(/Ã/g, 'Í')
        .replace(/ÃŒ/g, 'Ì')
        .replace(/Ã/g, 'Î')
        .replace(/Ã/g, 'Ï')
        .replace(/Ã"/g, 'Ó')
        .replace(/Ã'/g, 'Ò')
        .replace(/Ã"/g, 'Ô')
        .replace(/Ã•/g, 'Õ')
        .replace(/Ãš/g, 'Ú')
        .replace(/Ã™/g, 'Ù')
        .replace(/Ã›/g, 'Û')
        .replace(/Ã/g, 'Ü')
        .replace(/Ã/g, 'Ý');
    
    return fixed;
}

// Helper function to normalize text for comparison (handles encoding issues and variations)
function normalizeTextForMatching(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Normalize text: lowercase, trim, remove extra whitespace
    let normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    
    // Handle common encoding issues (e.g., Ã_r -> ä, dÃ¥ -> då)
    // This helps match text even if encoding differs
    normalized = normalized
        .replace(/Ã_r/g, 'ä')
        .replace(/Ã¥/g, 'å')
        .replace(/Ã¶/g, 'ö')
        .replace(/Ã„/g, 'ä')
        .replace(/Ã„/g, 'ä')
        .replace(/Ã–/g, 'ö')
        .replace(/Ã°/g, 'å');
    
    // Remove punctuation for fuzzy matching
    normalized = normalized.replace(/[^\wåäöÅÄÖ\s]/g, '');
    
    return normalized;
}

// Helper function to convert markdown to HTML
function markdownToHtml(markdown) {
    if (!markdown || typeof markdown !== 'string') {
        return '';
    }
    
    let html = markdown;
    
    // Store our generated HTML tags with placeholders
    const htmlTags = [];
    let tagIndex = 0;
    
    // Convert headers (lines starting with emoji followed by text) - do this first before escaping
    html = html.replace(/^([📘📗📙📕📓]+)\s+(.+)$/gm, (match, emoji, text) => {
        const placeholder = `__HTMLTAG_${tagIndex++}__`;
        htmlTags.push({ placeholder, html: `<h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #fff;">${emoji} ${text}</h3>` });
        return placeholder;
    });
    
    // Convert checkmark emoji sections (✅ Examples:)
    html = html.replace(/^✅\s+(.+)$/gm, (match, text) => {
        const placeholder = `__HTMLTAG_${tagIndex++}__`;
        htmlTags.push({ placeholder, html: `<div style="margin: 12px 0 8px 0; font-weight: 600; color: #4CAF50;">✅ ${text}</div>` });
        return placeholder;
    });
    
    // Convert bold text (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, (match, text) => {
        const placeholder = `__HTMLTAG_${tagIndex++}__`;
        htmlTags.push({ placeholder, html: `<strong>${text}</strong>` });
        return placeholder;
    });
    
    // Convert numbered lists (1. text)
    html = html.replace(/^(\d+)\.\s+(.+)$/gm, (match, num, text) => {
        const placeholder = `__HTMLTAG_${tagIndex++}__`;
        htmlTags.push({ placeholder, html: `<div style="margin: 4px 0; padding-left: 8px;">${num}. ${text}</div>` });
        return placeholder;
    });
    
    // Convert line breaks to <br> (replace with placeholder first)
    html = html.replace(/\n/g, () => {
        const placeholder = `__HTMLTAG_${tagIndex++}__`;
        htmlTags.push({ placeholder, html: '<br>' });
        return placeholder;
    });
    
    // Wrap quoted text in quotes style
    html = html.replace(/"([^"]+)"/g, (match, text) => {
        const placeholder = `__HTMLTAG_${tagIndex++}__`;
        htmlTags.push({ placeholder, html: `<span style="font-style: italic; color: #ccc;">"${text}"</span>` });
        return placeholder;
    });
    
    // Escape HTML to prevent XSS (but preserve our placeholders)
    html = html
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Restore our HTML tags
    htmlTags.forEach(({ placeholder, html: tagHtml }) => {
        html = html.replace(placeholder, tagHtml);
    });
    
    return html;
}

// Helper function to check if two texts match (with fuzzy matching)
function textsMatch(text1, text2) {
    if (!text1 || !text2) return false;
    
    const norm1 = normalizeTextForMatching(text1);
    const norm2 = normalizeTextForMatching(text2);
    
    // Exact match
    if (norm1 === norm2) return true;
    
    // One contains the other (for partial matches)
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
    
    // Fuzzy match: check if words overlap significantly
    const words1 = norm1.split(/\s+/).filter(w => w.length > 2);
    const words2 = norm2.split(/\s+/).filter(w => w.length > 2);
    
    if (words1.length === 0 || words2.length === 0) return false;
    
    // If most words match, consider it a match
    const matchingWords = words1.filter(w1 => words2.some(w2 => w1 === w2 || w1.includes(w2) || w2.includes(w1)));
    const matchRatio = matchingWords.length / Math.max(words1.length, words2.length);
    
    return matchRatio >= 0.7; // 70% word overlap
}

// VTT Parser
function parseVTT(content) {
    const lines = content.split('\n');
    const subtitles = [];
    let currentCue = null;
    let textBuffer = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Skip WEBVTT header and empty lines
        if (line === 'WEBVTT' || line === '' || line.startsWith('NOTE')) {
            continue;
        }

        // Check if line contains timestamp (--> pattern)
        if (line.includes('-->')) {
            // Save previous cue if exists (only save if it has valid text)
            if (currentCue) {
                let cueText = textBuffer.join(' ').trim();
                // Fix encoding issues in cue text
                cueText = fixEncoding(cueText);
                currentCue.text = cueText;
                // Only save cue if it has valid text content
                if (isValidSubtitleText(currentCue.text)) {
                    subtitles.push(currentCue);
                } else if (currentCue.text) {
                    console.log(`Filtered out cue with invalid text at timestamp ${currentCue.start}`);
                }
            }

            // Parse timestamp
            const [start, end] = line.split('-->').map(s => s.trim());
            currentCue = {
                start: start,
                end: end,
                text: ''
            };
            textBuffer = [];
        } else if (currentCue && line) {
            // Fix encoding issues and then check if valid subtitle text
            const fixedLine = fixEncoding(line);
            if (isValidSubtitleText(fixedLine)) {
                textBuffer.push(fixedLine);
            } else {
                console.log(`Filtered out invalid subtitle text: "${fixedLine.substring(0, 50)}..."`);
            }
        }
    }

    // Save last cue (only save if it has valid text)
    if (currentCue) {
        let cueText = textBuffer.join(' ').trim();
        // Fix encoding issues in cue text
        cueText = fixEncoding(cueText);
        currentCue.text = cueText;
        // Only save cue if it has valid text content
        if (isValidSubtitleText(currentCue.text)) {
            subtitles.push(currentCue);
        } else if (currentCue.text) {
            console.log(`Filtered out cue with invalid text at timestamp ${currentCue.start}`);
        }
    }

    // Deduplicate subtitles by text and timestamp to prevent duplicates
    const subtitleMap = new Map();
    subtitles.forEach(cue => {
        const key = `${cue.start}-${cue.end}-${normalizeTextForMatching(cue.text || '')}`;
        if (!subtitleMap.has(key)) {
            subtitleMap.set(key, cue);
        }
    });
    const deduplicatedSubtitles = Array.from(subtitleMap.values());
    
    console.log('parseVTT: Processed', lines.length, 'lines, created', deduplicatedSubtitles.length, 'subtitle entries', subtitles.length !== deduplicatedSubtitles.length ? `(${subtitles.length - deduplicatedSubtitles.length} duplicates removed)` : '');
    return deduplicatedSubtitles;
}

// TXT Parser - creates empty timestamp placeholders
function parseTXT(content) {
    if (!content || typeof content !== 'string') {
        console.warn('parseTXT: Invalid content provided');
        return [];
    }
    
    // Handle different line ending formats (Windows \r\n, Unix \n, Mac \r)
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedContent.split('\n');
    const subtitles = [];
    
    lines.forEach((line) => {
        const trimmedLine = line.trim();
        // Include non-empty lines
        if (trimmedLine) {
            // Fix encoding issues before adding to subtitles
            const fixedLine = fixEncoding(trimmedLine);
            subtitles.push({
                start: '--:--:--',
                end: '--:--:--',
                text: fixedLine
            });
        }
    });
    
    // Deduplicate subtitles by text to prevent duplicates
    const subtitleMap = new Map();
    subtitles.forEach(cue => {
        const normalizedText = normalizeTextForMatching(cue.text || '');
        if (!subtitleMap.has(normalizedText)) {
            subtitleMap.set(normalizedText, cue);
        }
    });
    const deduplicatedSubtitles = Array.from(subtitleMap.values());
    
    console.log('parseTXT: Processed', lines.length, 'lines, created', deduplicatedSubtitles.length, 'subtitle entries', subtitles.length !== deduplicatedSubtitles.length ? `(${subtitles.length - deduplicatedSubtitles.length} duplicates removed)` : '');
    return deduplicatedSubtitles;
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded - Initializing...');
    // Initialize DOM elements
    scriptName = document.getElementById('scriptName');
    uploadArea = document.getElementById('uploadArea');
    fileInput = document.getElementById('fileInput');
    fileInfo = document.getElementById('fileInfo');
    fileName = document.getElementById('fileName');
    analyzeBtn = document.getElementById('analyzeBtn');
    cancelBtn = document.getElementById('cancelBtn');
    fileProjectsList = document.getElementById('fileProjectsList');
    resultsSection = document.getElementById('resultsSection');
    uploadSection = document.getElementById('uploadSection');
    translationsContent = document.getElementById('translationsContent');
    expressionsContent = document.getElementById('expressionsContent');
    chatSection = document.getElementById('chatSection');
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    chatSendBtn = document.getElementById('chatSendBtn');
    saveAnalysisBtn = document.getElementById('saveAnalysisBtn');
    closeResultsBtn = document.getElementById('closeResultsBtn');
    savedAnalysesBtn = document.getElementById('savedAnalysesBtn');
    savedAnalysesView = document.getElementById('savedAnalysesView');
    savedAnalysesList = document.getElementById('savedAnalysesList');
    inactiveSavesSection = document.getElementById('inactiveSavesSection');
    inactiveSavesList = document.getElementById('inactiveSavesList');
    activeSavesSection = document.getElementById('activeSavesSection');
    activeSavesList = document.getElementById('activeSavesList');
    activeSavesCards = document.getElementById('activeSavesCards');
    listViewBtn = document.getElementById('listViewBtn');
    cardViewBtn = document.getElementById('cardViewBtn');
    
    // Load saved view mode preference
    const savedViewModePref = localStorage.getItem('savedViewMode');
    if (savedViewModePref === 'card' || savedViewModePref === 'list') {
        savedViewMode = savedViewModePref;
    }
    activeSavesHeader = document.getElementById('activeSavesHeader');
    editSavedBtn = document.getElementById('editSavedBtn');
    goBackBtn = document.getElementById('goBackBtn');
    settingsBtn = document.getElementById('settingsBtn');
    settingsView = document.getElementById('settingsView');
    closeSettingsBtn = document.getElementById('closeSettingsBtn');
    apiKeyInput = document.getElementById('apiKeyInput');
    saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    homeBtn = document.getElementById('homeBtn');
    studyModal = document.getElementById('studyModal');
    studyTitle = document.getElementById('studyTitle');
    studyItemContent = document.getElementById('studyItemContent');
    studyExpressionsSection = document.getElementById('studyExpressionsSection');
    studyExpressionsContent = document.getElementById('studyExpressionsContent');
    studyChatMessages = document.getElementById('studyChatMessages');
    studyChatInput = document.getElementById('studyChatInput');
    studyChatSendBtn = document.getElementById('studyChatSendBtn');
    closeStudyBtn = document.getElementById('closeStudyBtn');
    studyHistoryBtn = document.getElementById('studyHistoryBtn');
    saveStudyBtn = document.getElementById('saveStudyBtn');
    studyPrevBtn = document.getElementById('studyPrevBtn');
    studyNextBtn = document.getElementById('studyNextBtn');
    chatHistoryModal = document.getElementById('chatHistoryModal');
    chatHistoryContent = document.getElementById('chatHistoryContent');
    closeHistoryBtn = document.getElementById('closeHistoryBtn');
    themeSelect = document.getElementById('themeSelect');
    folderBreadcrumb = document.getElementById('folderBreadcrumb');
    contextMenu = document.getElementById('contextMenu');
    
    // Modal elements
    const renameModal = document.getElementById('renameModal');
    const renameModalMessage = document.getElementById('renameModalMessage');
    const renameModalInput = document.getElementById('renameModalInput');
    const renameModalCancel = document.getElementById('renameModalCancel');
    const renameModalConfirm = document.getElementById('renameModalConfirm');
    const warningModal = document.getElementById('warningModal');
    const warningModalMessage = document.getElementById('warningModalMessage');
    const warningModalOK = document.getElementById('warningModalOK');
    
    // Rename/Upload Modal elements
    const renameUploadModal = document.getElementById('renameUploadModal');
    const renameUploadInput = document.getElementById('renameUploadInput');
    const imageUploadInput = document.getElementById('imageUploadInput');
    const imageUploadBtn = document.getElementById('imageUploadBtn');
    const imageRemoveBtn = document.getElementById('imageRemoveBtn');
    const imagePreview = document.getElementById('imagePreview');
    const imagePreviewPlaceholder = document.getElementById('imagePreviewPlaceholder');
    const renameUploadCancel = document.getElementById('renameUploadCancel');
    const renameUploadSave = document.getElementById('renameUploadSave');

    // Debug console elements
    const debugBtn = document.getElementById('debugBtn');
    const debugConsole = document.getElementById('debugConsole');
    const clearDebugBtn = document.getElementById('clearDebugBtn');
    const closeDebugBtn = document.getElementById('closeDebugBtn');

    debugLog('🎯 DEBUG SYSTEM INITIALIZED', {
        debugConsoleAvailable: !!debugConsole,
        debugBtnAvailable: !!debugBtn
    });

    console.log('DOM elements initialized', {
        uploadArea: !!uploadArea,
        settingsBtn: !!settingsBtn,
        savedAnalysesBtn: !!savedAnalysesBtn,
        savedAnalysesView: !!savedAnalysesView,
        homeBtn: !!homeBtn,
        studyModal: !!studyModal,
        themeSelect: !!themeSelect
    });
    
    // Debug: Check if savedAnalysesBtn exists
    if (!savedAnalysesBtn) {
        console.error('❌ savedAnalysesBtn NOT FOUND!');
    } else {
        console.log('✅ savedAnalysesBtn found:', savedAnalysesBtn);
    }
    
    if (!savedAnalysesView) {
        console.error('❌ savedAnalysesView NOT FOUND!');
    } else {
        console.log('✅ savedAnalysesView found:', savedAnalysesView);
    }
    
    // Register views with ViewManager
    viewManager.register(VIEWS.UPLOAD, uploadSection);
    viewManager.register(VIEWS.RESULTS, resultsSection);
    viewManager.register(VIEWS.SAVED_ANALYSES, savedAnalysesView);
    viewManager.register(VIEWS.SETTINGS, settingsView);
    viewManager.register(VIEWS.CHAT, chatSection);
    viewManager.register(VIEWS.STUDY_MODAL, studyModal);
    viewManager.register(VIEWS.CHAT_HISTORY_MODAL, chatHistoryModal);
    
    // Initialize API key (loads from .env or encrypted storage)
    initializeAPIKey().catch(err => {
        console.error('Error initializing API key:', err);
    });
    
    // Initialize theme
    initializeTheme().catch(err => {
        console.error('Error initializing theme:', err);
    });

    // Cleanup inactive saves on startup (per spec: inactive saves are temporary, cleared on restart)
    cleanupInactiveSavesOnStartup().catch(err => {
        console.error('Error during startup cleanup:', err);
    });
    
    // Clear study modal heights on startup to return to defaults
    localStorage.removeItem('studyExpressionsHeight');
    localStorage.removeItem('studyChatMessagesHeight');

    // Home button functionality
    homeBtn.addEventListener('click', () => {
        debugLog('🏠 NAVIGATING TO HOME', {
            isAnalyzing: state.isAnalyzing,
            currentView: state.isAnalyzing ? 'analysis_progress' : 'home_reset',
            hasCurrentAnalysis: !!state.currentAnalysis,
            projectCount: state.fileProjects.length
        });

        // Close any open modals/views
        viewManager.hide(VIEWS.STUDY_MODAL);
        viewManager.hide(VIEWS.SAVED_ANALYSES);
        viewManager.hide(VIEWS.SETTINGS);

        // If analysis is in progress, preserve data and show progress
        if (state.isAnalyzing) {
            debugLog('📊 PRESERVING ANALYSIS PROGRESS VIEW', {
                currentProjectId: state.currentProjectId,
                paused: state.isPaused
            });
            // Show upload section - progress is shown in file list, not in fileInfo
            viewManager.show(VIEWS.UPLOAD);
            fileInfo.style.display = 'none'; // Keep hidden - status shown in file list
            // Don't reset data - analysis needs it to continue
            return;
        }

        debugLog('🔄 RESETTING TO HOME VIEW', {
            resettingData: true,
            clearingAnalysis: !!state.currentAnalysis
        });
        // Reset to home/upload view (only when not analyzing)
        viewManager.showHome();
        
        // Reset file info and current project (but keep projects list)
        fileInfo.style.display = 'none';
        scriptName.textContent = '';
        state.currentAnalysis = null;
        state.currentChatHistory = [];
        state.currentSubtitleData = null;
        state.currentProjectId = null;
        
        // Re-render projects list
        renderFileProjectsList();
    });

    // File upload handling
    uploadArea.addEventListener('click', () => {
        console.log('Upload area clicked');
        fileInput.click();
    });

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#ff6600';
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '#333';
    });

    uploadArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#333';

        const files = Array.from(e.dataTransfer.files);
        const validFiles = files.filter(file => {
            const fileName = file.name.toLowerCase();
            return CONFIG.ALLOWED_FILE_TYPES.some(ext => fileName.endsWith(ext));
        });
        
        // Check upload limit before processing
        if (state.fileProjects.length >= CONFIG.MAX_FILES) {
            alert(`You can upload up to ${CONFIG.MAX_FILES} files only.`);
            return;
        }
        
        if (validFiles.length > 0) {
            for (const file of validFiles) {
                // Check limit before each file (in case multiple files dropped)
                if (state.fileProjects.length >= CONFIG.MAX_FILES) {
                    alert(`You can upload up to ${CONFIG.MAX_FILES} files only.`);
                    break;
                }
                await handleFileSelect(file);
            }
        } else if (files.length > 0) {
            alert(`Please drop ${CONFIG.ALLOWED_FILE_TYPES.join(' or ')} files only.`);
        }
    });

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            const validFiles = files.filter(file => {
                const fileName = file.name.toLowerCase();
                return CONFIG.ALLOWED_FILE_TYPES.some(ext => fileName.endsWith(ext));
            });
            
            // Check upload limit before processing
            if (state.fileProjects.length >= CONFIG.MAX_FILES) {
                alert(`You can upload up to ${CONFIG.MAX_FILES} files only.`);
                e.target.value = '';
                return;
            }
            
            if (validFiles.length > 0) {
                for (const file of validFiles) {
                    // Check limit before each file (in case multiple files selected)
                    if (state.fileProjects.length >= CONFIG.MAX_FILES) {
                        alert(`You can upload up to ${CONFIG.MAX_FILES} files only.`);
                        break;
                    }
                    await handleFileSelect(file);
                }
            } else {
                alert(`Please select ${CONFIG.ALLOWED_FILE_TYPES.join(' or ')} files only.`);
            }
            // Reset input to allow selecting same files again
            e.target.value = '';
        }
    });

async function handleFileSelect(file) {
    try {
        debugLog('📁 FILE UPLOAD STARTED', {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            lastModified: new Date(file.lastModified).toISOString()
        });

        // Check upload limit (maximum 5 files)
        if (state.fileProjects.length >= 5) {
            debugLog('❌ FILE UPLOAD FAILED', { 
                reason: 'Upload limit reached', 
                currentCount: state.fileProjects.length,
                maxCount: 5
            }, 'error');
            alert('You can upload up to 5 files only.');
            return;
        }

        // Validate file
        if (!file) {
            debugLog('❌ FILE UPLOAD FAILED', { reason: 'No file selected' }, 'error');
            alert('No file selected.');
            return;
        }
        
        // Use FileReader API for both drag-and-drop and file input
        debugLog('📖 FILE READING STARTED', { fileName: file.name });
        const content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                debugLog('📖 FILE READING COMPLETED', {
                    fileName: file.name,
                    contentLength: e.target.result.length,
                    contentPreview: e.target.result.substring(0, 100) + '...'
                }, 'success');
                resolve(e.target.result);
            };
            reader.onerror = (error) => {
                debugLog('❌ FILE READING FAILED', { fileName: file.name, error: error.message }, 'error');
                reject(error);
            };
            // Explicitly specify UTF-8 encoding to prevent Swedish characters from being broken
            reader.readAsText(file, 'UTF-8');
        });
        
        // Fix encoding issues before parsing (in case file was already corrupted)
        const fixedContent = fixEncoding(content);
        debugLog('🔧 ENCODING FIXED', {
            fileName: file.name,
            originalLength: content.length,
            fixedLength: fixedContent.length,
            encodingChanged: content !== fixedContent
        });

        // Detect file type and use appropriate parser (case-insensitive)
        const fileNameLower = file.name.toLowerCase();
        let subtitleData = null;

        const fileType = CONFIG.ALLOWED_FILE_TYPES.find(ext => fileNameLower.endsWith(ext));

        debugLog('🔍 FILE PARSING STARTED', {
            fileName: file.name,
            fileType: fileType ? fileType.toUpperCase().replace('.', '') : 'UNKNOWN'
        });

        if (fileNameLower.endsWith('.vtt')) {
            subtitleData = parseVTT(fixedContent);
            debugLog('🎬 VTT PARSING COMPLETED', {
                fileName: file.name,
                subtitleCount: subtitleData ? subtitleData.length : 0
            }, 'success');
        } else if (fileNameLower.endsWith('.txt')) {
            subtitleData = parseTXT(fixedContent);
            debugLog('📄 TXT PARSING COMPLETED', {
                fileName: file.name,
                subtitleCount: subtitleData ? subtitleData.length : 0
            }, 'success');
        } else {
            debugLog('❌ UNSUPPORTED FILE TYPE', { fileName: file.name, fileType: fileNameLower }, 'error');
            alert(`Unsupported file type. Please upload a ${CONFIG.ALLOWED_FILE_TYPES.join(' or ')} file.`);
            return;
        }
        
        // Ensure we have valid data
        if (!subtitleData || subtitleData.length === 0) {
            debugLog('❌ EMPTY OR INVALID SUBTITLE DATA', {
                fileName: file.name,
                subtitleDataLength: subtitleData ? subtitleData.length : 0
            }, 'error');
            alert(`The file "${file.name}" appears to be empty or could not be parsed. Please check the file contains text and try again.`);
            return;
        }

        // Check if file already exists - prevent duplicates
        // Don't remove if currently analyzing - update existing instead
        const existingProject = state.fileProjects.find(p => p.fileName === file.name);
        if (existingProject) {
            debugLog('📁 EXISTING PROJECT FOUND', {
                fileName: file.name,
                projectId: existingProject.id,
                currentStatus: existingProject.status,
                willUpdate: existingProject.status !== 'analyzing'
            });

            // If not analyzing, update existing project
            if (existingProject.status !== 'analyzing') {
                existingProject.subtitleData = subtitleData;
                existingProject.status = 'ready';
                existingProject.analysisData = null;
                // Preserve batch tracking fields if they exist, otherwise initialize
                if (existingProject.currentBatchIndex === undefined) {
                    existingProject.currentBatchIndex = 0;
                    existingProject.processedBatches = [];
                    existingProject.pausedAt = null;
                }
                if (existingProject.progress === undefined) {
                    existingProject.progress = 0;
                }
                debugLog('🔄 EXISTING PROJECT UPDATED', {
                    projectId: existingProject.id,
                    fileName: file.name,
                    newStatus: 'ready'
                });
            } else {
                debugLog('⏳ EXISTING PROJECT PRESERVED', {
                    projectId: existingProject.id,
                    fileName: file.name,
                    status: 'analyzing (preserved)'
                });
            }
            
            // Restore isFavorite from saved analyses if available
            try {
                const saved = await fetchSavedAnalyses();
                const savedItem = saved.find(
                    (item) => item.fileName === file.name && item.status !== 'processing',
                );
                        if (savedItem && savedItem.isFavorite !== undefined) {
                            existingProject.isFavorite = savedItem.isFavorite;
                }
            } catch (error) {
                console.error('Error loading favorite status:', error);
            }
        } else {
            // Add new project
            const projectId = 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            let isFavorite = false;
            
            // Check if this file exists in saved analyses and restore favorite status
            try {
                const saved = await fetchSavedAnalyses();
                const savedItem = saved.find(
                    (item) => item.fileName === file.name && item.status !== 'processing',
                );
                        if (savedItem && savedItem.isFavorite !== undefined) {
                            isFavorite = savedItem.isFavorite;
                }
            } catch (error) {
                console.error('Error loading favorite status:', error);
            }
            
            addFileProject({
                id: projectId,
                fileName: file.name,
                subtitleData: subtitleData,
                analysisData: null,
                status: 'ready', // ready, queued, analyzing, paused, completed, error
                progress: 0,
                currentBatchIndex: 0,
                processedBatches: [],
                pausedAt: null,
                isFavorite: isFavorite
            });
            // window.state.fileProjects is auto-synced via getter
            debugLog('➕ NEW PROJECT CREATED', {
                projectId: projectId,
                fileName: file.name,
                status: 'ready',
                totalProjects: state.fileProjects.length
            });
        }
        
        // Render the file projects list
        renderFileProjectsList();

        // Reset state
        state.currentAnalysis = null;
        state.currentChatHistory = [];
        viewManager.hide(VIEWS.RESULTS);
        viewManager.hide(VIEWS.CHAT);

        debugLog('✅ FILE UPLOAD COMPLETED', {
            fileName: file.name,
            projectCount: state.fileProjects.length,
            readyForAnalysis: true
        }, 'success');
    } catch (error) {
        debugLog('❌ FILE UPLOAD ERROR', {
            fileName: (file && file.name) || 'unknown',
            error: error.message || 'Unknown error',
            stack: error.stack
        }, 'error');
        alert('Error reading file: ' + (error.message || 'Please try again.'));
        state.currentSubtitleData = null;
        fileInfo.style.display = 'none';
    }
}

// Helper function to format time in seconds to human-readable format
// Now imported from src/utils/helpers.js - keeping this as a wrapper for backward compatibility
// TODO: Remove this wrapper and use formatTimeRemaining directly from helpers

// Process a single batch with all its logic
async function processSingleBatch(batch, batchIndex, globalEntryIndexStart, totalBatches) {
    const batchNumber = batchIndex + 1;
    const batchStartTime = Date.now();
    
    try {
        // Format batch text with numbered entries (using global index)
        let globalEntryIndex = globalEntryIndexStart;
        const batchText = batch.map((cue, idx) => {
            const entryNumber = globalEntryIndex + 1;
            globalEntryIndex++;
            return `${entryNumber}. ${cue.text}`;
        }).join('\n');
        
        const batchPrompt = `Translate ALL ${batch.length} Swedish subtitle entries below. Return JSON with "translations" array containing exactly ${batch.length} entries.

IMPORTANT: Extract important Swedish words and expressions from the entries. For each expression, assign a CEFR level (A1, A2, B1, B2, C1, C2, or C3) based on the difficulty/complexity of the word or expression.

Format:
{
  "translations": [
    {"swedish": "text", "literal": "translation", "natural": "natural translation (if different)"}
  ],
  "expressions": [
    {"word": "word", "meaning": "meaning", "example": "example", "level": "A1"}
  ]
}

CEFR Level Guidelines:
- A1: Very basic words (hello, yes, no, numbers, simple verbs)
- A2: Basic everyday words (common verbs, nouns, simple phrases)
- B1: Intermediate words (common expressions, moderate complexity)
- B2: Upper-intermediate words (more complex expressions, idioms)
- C1: Advanced words (sophisticated vocabulary, complex phrases)
- C2: Very advanced words (near-native level, nuanced expressions)
- C3: Expert level (highly specialized or literary language)

Extract MORE expressions - aim for 5-15 important words/expressions per batch. Include verbs, nouns, adjectives, phrases, and idiomatic expressions that would be useful for learning Swedish.

Entries:
${batchText}`;

        const messages = [
            {
                role: 'system',
                content: 'You are a Swedish-English translator. Translate ALL entries. Return JSON only.'
            },
            {
                role: 'user',
                content: batchPrompt
            }
        ];

        const content = await callOpenAI(messages);
        
        // Parse batch response
        let batchData;
        try {
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                batchData = JSON.parse(jsonMatch[1]);
            } else {
                batchData = JSON.parse(content);
            }
            
            // Fix encoding for all translations and expressions in batch
            if (batchData.translations && Array.isArray(batchData.translations)) {
                batchData.translations = batchData.translations.map(t => fixTranslationEncoding(t));
            }
            if (batchData.expressions && Array.isArray(batchData.expressions)) {
                batchData.expressions = batchData.expressions.map(e => fixTranslationEncoding(e));
            }
        } catch (e) {
            console.error(`Error parsing batch ${batchNumber}:`, e);
            // Create empty batch data on parse error
            batchData = {
                translations: [],
                expressions: []
            };
        }
        
        // Validate batch got all translations
        const expectedTranslations = batch.length;
        const receivedTranslations = batchData.translations ? batchData.translations.length : 0;
        
        if (receivedTranslations < expectedTranslations) {
            console.warn(`Batch ${batchNumber}: Expected ${expectedTranslations} translations, got ${receivedTranslations}`);
            // Try to translate missing entries
            if (batchData.translations && receivedTranslations > 0) {
                const translatedSwedishTexts = batchData.translations.map(t => t.swedish).filter(Boolean);
                
                const missingEntries = batch.filter(cue => {
                    const cueText = cue.text || '';
                    if (!cueText.trim()) return false;
                    
                    // Check if this entry was translated using improved matching
                    const wasTranslated = translatedSwedishTexts.some(translated => 
                        textsMatch(translated, cueText)
                    );
                    return !wasTranslated;
                });
                
                if (missingEntries.length > 0) {
                    console.log(`Batch ${batchNumber}: Attempting to translate ${missingEntries.length} missing entries...`);
                    try {
                        const missingText = missingEntries.map((cue, idx) => 
                            `${receivedTranslations + idx + 1}. ${cue.text}`
                        ).join('\n');
                        
                        const missingPrompt = `Translate ${missingEntries.length} Swedish entries. Return JSON array:
[{"swedish":"text","literal":"translation","natural":"natural (if different)"}]

Entries:
${missingText}`;
                        
                        const missingContent = await callOpenAI([
                            {
                                role: 'system',
                                content: 'Swedish-English translator. Translate ALL entries. Return JSON only.'
                            },
                            {
                                role: 'user',
                                content: missingPrompt
                            }
                        ]);
                        
                        try {
                            const missingJsonMatch = missingContent.match(/```(?:json)?\s*(\[[\s\S]*\])\s*```/);
                            const missingJson = missingJsonMatch ? missingJsonMatch[1] : missingContent;
                            const missingTranslations = JSON.parse(missingJson);
                            
                            if (Array.isArray(missingTranslations) && missingTranslations.length > 0) {
                                // Fix encoding for all missing translations
                                const fixedMissing = missingTranslations.map(t => fixTranslationEncoding(t));
                                
                                // Check for duplicates before adding
                                const existingSwedishTexts = new Set((batchData.translations || []).map(t => normalizeTextForMatching(t.swedish || '')));
                                const newTranslations = fixedMissing.filter(t => {
                                    const normalizedSwedish = normalizeTextForMatching(t.swedish || '');
                                    if (existingSwedishTexts.has(normalizedSwedish)) {
                                        return false; // Skip duplicate
                                    }
                                    existingSwedishTexts.add(normalizedSwedish);
                                    return true;
                                });
                                
                                if (newTranslations.length > 0) {
                                    batchData.translations.push(...newTranslations);
                                    console.log(`Batch ${batchNumber}: Added ${newTranslations.length} missing translations (${fixedMissing.length - newTranslations.length} duplicates skipped)`);
                                }
                            }
                        } catch (parseError) {
                            console.error(`Batch ${batchNumber}: Failed to parse missing translations:`, parseError);
                        }
                    } catch (missingError) {
                        console.error(`Batch ${batchNumber}: Failed to get missing translations:`, missingError);
                    }
                }
            }
            
            // Only create placeholders for entries that truly don't have translations
            const finalCount = batchData.translations ? batchData.translations.length : 0;
            if (finalCount < expectedTranslations) {
                const translatedSwedishTexts = (batchData.translations || []).map(t => t.swedish).filter(Boolean);
                
                for (const cue of batch) {
                    const cueText = cue.text || '';
                    if (!cueText.trim()) continue;
                    
                    // Check if this entry was translated using improved matching
                    const exists = translatedSwedishTexts.some(translated => 
                        textsMatch(translated, cueText)
                    );
                    
                    if (!exists && isValidSubtitleText(cueText)) {
                        // Only create placeholder for valid subtitle text that truly wasn't translated
                        if (!batchData.translations) {
                            batchData.translations = [];
                        }
                        
                        // Check if this placeholder would be a duplicate
                        const normalizedCueText = normalizeTextForMatching(cueText);
                        const alreadyHasPlaceholder = batchData.translations.some(t => 
                            normalizeTextForMatching(t.swedish || '') === normalizedCueText
                        );
                        
                        if (!alreadyHasPlaceholder) {
                            batchData.translations.push(fixTranslationEncoding({
                                swedish: cue.text,
                                literal: `[Translation needed: ${cue.text}]`,
                                natural: null
                            }));
                        }
                    }
                }
            }
        }
        
        // Deduplicate translations within this batch before adding to results
        if (batchData.translations && batchData.translations.length > 0) {
            const batchTranslationsMap = new Map();
            batchData.translations.forEach(trans => {
                if (trans.swedish) {
                    const normalizedKey = normalizeTextForMatching(trans.swedish);
                    // Keep the first occurrence, or replace placeholder with actual translation
                    if (!batchTranslationsMap.has(normalizedKey)) {
                        batchTranslationsMap.set(normalizedKey, trans);
                    } else {
                        const existing = batchTranslationsMap.get(normalizedKey);
                        // Replace placeholder with actual translation if we have one
                        if (existing.literal && existing.literal.startsWith('[Translation needed:')) {
                            if (trans.literal && !trans.literal.startsWith('[Translation needed:')) {
                                batchTranslationsMap.set(normalizedKey, trans);
                            }
                        }
                    }
                }
            });
            batchData.translations = Array.from(batchTranslationsMap.values());
        }
        
        // Record batch processing time
        const batchEndTime = Date.now();
        const batchDuration = batchEndTime - batchStartTime;
        
        console.log(`Batch ${batchNumber}/${totalBatches} complete: ${(batchData.translations && batchData.translations.length) || 0} translations (took ${(batchDuration / 1000).toFixed(1)}s)`);
        
        return {
            batchData,
            batchIndex,
            batchDuration
        };
        
    } catch (error) {
        console.error(`Error processing batch ${batchNumber}:`, error);
        // Return empty batch data on error
        return {
            batchData: {
                translations: [],
                expressions: []
            },
            batchIndex,
            batchDuration: 0
        };
    }
}

// Process subtitle entries in batches to handle large files
async function processSubtitleBatches(subtitleData, placeholderId = null) {
    const BATCH_SIZE_ENTRIES = CONFIG.BATCH_SIZE; // Reduced to prevent timeout - smaller batches process faster
    const MAX_CHARS_PER_BATCH = 12000; // Reduced to prevent timeout - smaller prompts are faster
    const CONCURRENT_BATCHES = 3; // Process 3 batches in parallel
    const batches = [];
    
    // Split into batches based on entry count and character count
    let currentBatch = [];
    let currentBatchChars = 0;
    
    for (let i = 0; i < subtitleData.length; i++) {
        const entry = subtitleData[i];
        const entryText = entry.text || '';
        const entryChars = entryText.length;
        
        // Start new batch if:
        // 1. Current batch has enough entries, OR
        // 2. Adding this entry would exceed character limit
        if (currentBatch.length >= BATCH_SIZE_ENTRIES || 
            (currentBatchChars + entryChars > MAX_CHARS_PER_BATCH && currentBatch.length > 0)) {
            batches.push([...currentBatch]);
            currentBatch = [];
            currentBatchChars = 0;
        }
        
        currentBatch.push(entry);
        currentBatchChars += entryChars;
    }
    
    // Add final batch if it has entries
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    
    console.log(`Split ${subtitleData.length} entries into ${batches.length} batches`);
    
    // Get current project to track batch index
    const project = state.fileProjects.find(p => p.id === state.currentProjectId);
    const startBatchIndex = project && project.currentBatchIndex ? project.currentBatchIndex : 0;
    
    // Time tracking for estimation
    const batchTimes = [];
    const startTime = Date.now();
    
    // Initial estimate: assume ~3-5 seconds per batch on average (conservative estimate for GPT-4o-mini)
    const ESTIMATED_SECONDS_PER_BATCH = 4;
    const initialEstimatedSeconds = batches.length * ESTIMATED_SECONDS_PER_BATCH;
    
    // Calculate global entry index for each batch (for numbering)
    let globalEntryIndex = 0;
    const batchEntryIndices = batches.map(batch => {
        const startIndex = globalEntryIndex;
        globalEntryIndex += batch.length;
        return startIndex;
    });
    
    // Results array with placeholders to maintain order
    const results = new Array(batches.length);
    let completedCount = startBatchIndex; // Start from saved batch index if resuming
    
    // Restore processed batches if resuming
    if (startBatchIndex > 0 && project && project.processedBatches && project.processedBatches.length > 0) {
        for (let i = 0; i < Math.min(startBatchIndex, project.processedBatches.length); i++) {
            results[i] = project.processedBatches[i];
        }
    }
    
    let lastProgressUpdate = -1;
    
    // Status is already set to 'analyzing' in analyzeProject before calling this function
    // Just render - no need to deduplicate here as we're only updating existing entries
    renderFileProjectsList();
    
    // Process batches in parallel groups of CONCURRENT_BATCHES
    // Start from saved batch index if resuming
    for (let i = startBatchIndex; i < batches.length; i += CONCURRENT_BATCHES) {
        // Check for cancellation before processing next batch group
        if (state.shouldCancelAnalysis) {
            console.log('Analysis cancelled by user');
            break;
        }
        
        // Wait if paused - poll until resume
        while (state.isPaused && !state.shouldCancelAnalysis) {
            // Save pause state atomically - update all fields together
            if (project) {
                // Update all pause state fields atomically to prevent inconsistent state
                const pauseState = {
                    currentBatchIndex: i,
                    progress: Math.round((completedCount / batches.length) * 100),
                    processedBatches: results.slice(0, completedCount).filter(Boolean),
                    pausedAt: new Date().toISOString()
                };
                
                // Apply all updates at once
                Object.assign(project, pauseState);
                
                debugLog('⏸️ PAUSE STATE SAVED', {
                    projectId: project.id,
                    fileName: project.fileName,
                    currentBatchIndex: pauseState.currentBatchIndex,
                    progress: pauseState.progress,
                    processedBatchesCount: pauseState.processedBatches.length
                });
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Check again after pause check
        if (state.shouldCancelAnalysis) {
            console.log('Analysis cancelled by user');
            break;
        }
        
        // Update current batch index after checking pause
        if (project) {
            project.currentBatchIndex = i;
        }
        
        const batchGroup = batches.slice(i, i + CONCURRENT_BATCHES);
        const batchGroupIndices = batchGroup.map((_, groupIdx) => i + groupIdx);
        
        // Process all batches in this group in parallel
        const groupPromises = batchGroup.map((batch, groupIdx) => {
            const batchIndex = i + groupIdx;
            const globalEntryIndexStart = batchEntryIndices[batchIndex];
            return processSingleBatch(batch, batchIndex, globalEntryIndexStart, batches.length);
        });
        
        // Wait for all batches in this group to complete
        const groupResults = await Promise.all(groupPromises);
        
        // Store results in correct order and update progress
        for (const result of groupResults) {
            results[result.batchIndex] = result.batchData;
            batchTimes.push(result.batchDuration);
            completedCount++;
            
            // Update progress tracking
            const batchNumber = result.batchIndex + 1;
            
            // Calculate and update progress
            const progress = Math.round((completedCount / batches.length) * 100);
            
            // Update project progress
            if (project) {
                project.progress = progress;
                project.currentBatchIndex = result.batchIndex + 1; // Next batch to process
                // Save processed batches so far
                project.processedBatches = results.slice(0, completedCount).filter(Boolean);
            }
            
            // Calculate estimated remaining time
            let timeRemainingText = '';
            if (completedCount === 1) {
                // First batch: use initial estimate
                timeRemainingText = ` • ${formatTimeRemaining(initialEstimatedSeconds)} remaining`;
            } else if (batchTimes.length > 0) {
                // Calculate average time per batch based on completed batches
                const avgTimePerBatch = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length;
                const remainingBatches = batches.length - completedCount;
                const estimatedSecondsRemaining = avgTimePerBatch * remainingBatches / 1000;
                timeRemainingText = ` • ${formatTimeRemaining(estimatedSecondsRemaining)} remaining`;
            }
            
            // Update project progress in file list (no need to update analyzeBtn since fileInfo is hidden)
            // Update placeholder progress (throttled: only every PROGRESS_UPDATE_THRESHOLD%)
            if (placeholderId) {
                // Only update if progress crossed a threshold
                const progressThreshold = Math.floor(progress / PROGRESS_UPDATE_THRESHOLD) * PROGRESS_UPDATE_THRESHOLD;
                if (progressThreshold > lastProgressUpdate) {
                    lastProgressUpdate = progressThreshold;
                    // Update progress asynchronously (non-blocking)
                    // Store timeout ID for cleanup
                    const timeoutId = setTimeout(async () => {
                        try {
                            // Check if analysis is still active before updating
                            if (!state.isAnalyzing || state.shouldCancelAnalysis) {
                                return;
                            }
                            
                            // Update current project's progress in the home list
                            if (state.currentProjectId) {
                                const proj = state.fileProjects.find(p => p.id === state.currentProjectId);
                                // Check if project still exists and analysis is still active
                                if (!proj || !state.isAnalyzing || state.shouldCancelAnalysis) {
                                    return;
                                }
                                
                                    proj.progress = progress;
                                   
                                    // Calculate and store estimated time remaining using captured values
                                    const currentBatchTimes = batchTimes.slice(); // Capture current batch times
                                    const totalBatches = batches.length;
                                    const currentCompletedCount = completedCount;
                                    if (currentBatchTimes.length > 0 && totalBatches > currentCompletedCount) {
                                        const avgTimePerBatch = currentBatchTimes.reduce((sum, time) => sum + time, 0) / currentBatchTimes.length;
                                        const remainingBatches = totalBatches - currentCompletedCount;
                                        const estimatedSecondsRemaining = avgTimePerBatch * remainingBatches / 1000;
                                        proj.estimatedTimeRemaining = formatTimeRemaining(estimatedSecondsRemaining);
                                    }
                                    renderFileProjectsList();
                                }
                            
                            // Double-check analysis is still active before saving
                            if (!state.isAnalyzing || state.shouldCancelAnalysis || state.currentPlaceholderId !== placeholderId) {
                                return;
                            }
                            
                            const saved = await fetchSavedAnalyses();
                            
                            const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                            if (placeholderIndex !== -1) {
                                saved[placeholderIndex].progress = progress;
                                saved[placeholderIndex].paused = state.isPaused; // Update pause state
                                
                                const saveResult = await saveAnalysesSafe(saved);
                                    if (!saveResult || !saveResult.success) {
                                    debugLog(
                                        '❌ FAILED TO SAVE PROGRESS UPDATE',
                                        {
                                            placeholderId: placeholderId,
                                            progress: progress,
                                            error: (saveResult && saveResult.error) || 'Unknown error',
                                        },
                                        'error',
                                    );
                                }
                                
                                // Update saved files view if it's open - use in-place update if possible
                                if (viewManager.isVisible(VIEWS.SAVED_ANALYSES)) {
                                    // Try to update in-place first
                                    const updated = updateSavedItemStatus(placeholderId, progress, state.isPaused);
                                    // Only reload if update failed (item might not be rendered yet)
                                    if (!updated) {
                                        await loadSavedAnalyses();
                                    }
                                }
                            }
                        } catch (error) {
                            debugLog('❌ ERROR UPDATING PLACEHOLDER PROGRESS', {
                                placeholderId: placeholderId,
                                progress: progress,
                                error: error.message,
                                stack: error.stack
                            }, 'error');
                        }
                    }, 0);
                    
                    // Store timeout ID for cleanup
                    state.progressUpdateTimeouts.push(timeoutId);
                }
            }
        }
    }
    
    return results;
}

// Deduplicate state.fileProjects by fileName - keeps only one entry per fileName
// Priority: analyzing > ready > completed > error
// When same priority, prefers the one with matching state.currentProjectId
// IMPORTANT: This removes ALL duplicates, not just picks one
// PROTECTION: Never removes the currently analyzing project
function deduplicateFileProjects() {
    if (state.fileProjects.length === 0) return;
    
    const projectMap = new Map();
    const priority = { 'analyzing': 4, 'ready': 3, 'completed': 2, 'error': 1 };
    
    // First pass: collect all projects by fileName
    state.fileProjects.forEach(project => {
        const existing = projectMap.get(project.fileName);
        if (!existing) {
            projectMap.set(project.fileName, project);
        } else {
            const existingPriority = priority[existing.status] || 0;
            const currentPriority = priority[project.status] || 0;
            
            // PROTECTION: Never remove the currently analyzing project
            if (project.id === state.currentProjectId && project.status === 'analyzing') {
                // This is the active analysis - always keep it
                projectMap.set(project.fileName, project);
                return;
            }
            if (existing.id === state.currentProjectId && existing.status === 'analyzing') {
                // Existing is the active analysis - always keep it
                return;
            }
            
            // Always prefer analyzing status if either is analyzing
            if (existing.status === 'analyzing' && project.status !== 'analyzing') {
                // Keep existing analyzing one - discard current
                return;
            } else if (project.status === 'analyzing' && existing.status !== 'analyzing') {
                // Replace with analyzing one - discard existing
                projectMap.set(project.fileName, project);
            } else if (currentPriority > existingPriority) {
                // Higher priority status - replace
                projectMap.set(project.fileName, project);
            } else if (currentPriority === existingPriority) {
                // Same priority - prefer the one with state.currentProjectId, otherwise keep first found
                if (project.id === state.currentProjectId && existing.id !== state.currentProjectId) {
                    projectMap.set(project.fileName, project);
                }
                // Otherwise keep existing (first found)
            }
        }
    });
    
    // Update state.fileProjects array to remove ALL duplicates
    // This ensures only one entry per fileName exists
    setFileProjects(Array.from(projectMap.values()));
}

// Render file projects list
function renderFileProjectsList() {
    if (!fileProjectsList) return;
    
    if (state.fileProjects.length === 0) {
        fileProjectsList.innerHTML = '';
        fileProjectsList.style.display = 'none';
        return;
    }
    
    // Don't filter duplicates - users CAN have multiple files with same name
    // Just render all projects - clicking Start should UPDATE the existing entry, not create new one
    
    fileProjectsList.style.display = 'flex';
    fileProjectsList.innerHTML = state.fileProjects.map(project => {
        const isAnalyzingProject = project.status === 'analyzing';
        // Only show as queued if it's ready AND another file is analyzing (not this one)
        const isQueued = state.isAnalyzing && !isAnalyzingProject && project.status === 'ready';
        
        // Build status text and class
        let statusText = '';
        let statusClass = '';
        let estimatedTimeHtml = '';
        
        if (isAnalyzingProject) {
            // Show paused status if paused, otherwise analyzing
            if (state.isPaused) {
                statusText = `Paused${typeof project.progress === 'number' ? ` (${project.progress}%)` : '...'}`;
            } else {
                statusText = `Analyzing${typeof project.progress === 'number' ? ` (${project.progress}%)` : '...'}`;
            }
            statusClass = 'status-analyzing';
            if (project.estimatedTimeRemaining) {
                estimatedTimeHtml = `<div class="file-project-time-estimate">estimated time left: ${project.estimatedTimeRemaining}</div>`;
            }
        } else if (isQueued) {
            // Show "Paused" if paused, otherwise "queued"
            if (state.isPaused) {
                statusText = 'Paused';
            } else {
                statusText = 'queued';
            }
            statusClass = 'status-ready';
        } else if (project.status === 'completed') {
            statusText = 'Completed';
            statusClass = 'status-completed';
        } else if (project.status === 'error') {
            statusText = 'Error';
            statusClass = 'status-error';
        } else {
            statusText = 'Ready';
            statusClass = 'status-ready';
        }
        
        return `
            <div class="file-project-item" data-project-id="${project.id}">
                <div class="file-project-info">
                    <span class="file-project-name">${escapeHtml(project.fileName)}</span>
                    ${isAnalyzingProject ? 
                        `<span class="file-project-status ${statusClass}">${statusText}</span>` :
                        statusText !== 'Ready' ? 
                        `<span class="file-project-status ${statusClass}">${statusText}</span>` :
                        ''
                    }
                </div>
                <div class="file-project-actions">
                    ${isAnalyzingProject ? 
                        `<div class="action-status-container">
                            <button class="pause-project-btn analyze-project-btn" data-project-id="${project.id}">
                                ${state.isPaused ? 'Resume' : 'Pause'}
                            </button>
                            ${project.estimatedTimeRemaining ? 
                                `<div class="file-project-time-estimate">expected time left: ${project.estimatedTimeRemaining}</div>` :
                                ''
                            }
                        </div>` :
                        // Only show Start button if not queued, or if queued but paused
                        // Completed files don't have action buttons (per plan - no re-analyze)
                        !isQueued || state.isPaused ? 
                        (project.status === 'completed' ? '' : 
                        `<button class="analyze-project-btn" data-project-id="${project.id}">Start</button>`) :
                        ''
                    }
                    ${project.status !== 'analyzing' || state.isPaused ? 
                        `<button class="remove-project-btn" data-project-id="${project.id}">Remove</button>` :
                        ''
                    }
                </div>
            </div>
        `;
    }).join('');
    
    // Attach event listeners
    fileProjectsList.querySelectorAll('.analyze-project-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const projectId = e.target.dataset.projectId;
            // Check if this is a pause button
            if (btn.classList.contains('pause-project-btn')) {
                const project = state.fileProjects.find(p => p.id === state.currentProjectId);
                
                if (!state.isPaused) {
                    // Pause: save current state
                    if (project) {
                        // currentBatchIndex will be saved in processSubtitleBatches when pause is detected
                        project.status = 'paused';
                        project.pausedAt = new Date().toISOString();
                        debugLog('⏸️ PAUSE INITIATED', {
                            projectId: project.id,
                            fileName: project.fileName,
                            currentBatchIndex: project.currentBatchIndex,
                            progress: project.progress
                        });
                    }
                    
                    // Set ALL queued files (status === 'ready') to 'paused'
                    state.fileProjects.forEach(p => {
                        if (p.status === 'ready' && p.id !== state.currentProjectId) {
                            p.status = 'paused';
                            p.pausedAt = new Date().toISOString();
                            debugLog('⏸️ QUEUED FILE PAUSED', {
                                projectId: p.id,
                                fileName: p.fileName
                            });
                        }
                    });
                } else {
                    // Resume: restore analyzing status
                    if (project) {
                        project.status = 'analyzing';
                        project.pausedAt = null;
                        debugLog('▶️ RESUME INITIATED', {
                            projectId: project.id,
                            fileName: project.fileName,
                            currentBatchIndex: project.currentBatchIndex,
                            progress: project.progress
                        });
                    }
                    
                    // Set other paused files back to 'queued'
                    state.fileProjects.forEach(p => {
                        if (p.status === 'paused' && p.id !== state.currentProjectId) {
                            p.status = 'queued';
                            p.pausedAt = null;
                            debugLog('▶️ PAUSED FILE QUEUED', {
                                projectId: p.id,
                                fileName: p.fileName
                            });
                        }
                    });
                }
                
                // Toggle pause state
                state.isPaused = !state.isPaused;
                renderFileProjectsList();
                
                // Update saved item status if placeholder exists
                if (state.currentPlaceholderId) {
                    await updateSavedItemStatusFromPause(state.currentPlaceholderId, state.isPaused);
                }
                
                return;
            }
            // Otherwise, analyze this specific project
            await analyzeProject(projectId);
        });
    });
    
    fileProjectsList.querySelectorAll('.remove-project-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const projectId = e.target.dataset.projectId;
            removeProject(projectId);
        });
    });
}

// Analyze a specific project
async function analyzeProject(projectId) {
    debugLog('🚀 ANALYSIS STARTED', {
        projectId: projectId,
        isAnalyzing: state.isAnalyzing,
        hasApiKey: !!state.apiKey,
        totalProjects: state.fileProjects.length
    });

    const project = state.fileProjects.find(p => p.id === projectId);
    if (!project) {
        debugLog('❌ ANALYSIS FAILED', { projectId: projectId, reason: 'Project not found' }, 'error');
        return;
    }

    const initialFileName = project.fileName || '';

    if (!state.apiKey) {
        debugLog('⚠️ ANALYSIS BLOCKED', { reason: 'No API key set' }, 'warn');
        await showWarningModal('Please set your OpenAI API key in Settings first.');
        settingsBtn.click();
        return;
    }

    if (state.isAnalyzing) {
        debugLog('⚠️ ANALYSIS BLOCKED', { reason: 'Analysis already in progress' }, 'warn');
        // Silently return if analysis is already in progress (button should be disabled)
        return;
    }
    
    // Find and update the EXISTING project - do NOT create new entries
    let targetProject = state.fileProjects.find(p => p.id === projectId);
    if (!targetProject) {
        console.error('Project not found:', projectId);
        return;
    }
    
    // Store targetFileName early for use in error handling
    const targetFileName = targetProject.fileName;
    
    // Check for duplicate filename in saved analyses before starting
    try {
        debugLog('🔍 CHECKING FOR DUPLICATE FILENAME', {
            fileName: targetProject.fileName,
            projectId: targetProject.id
        }, 'info');
        
        const saved = await fetchSavedAnalyses('duplicate-check');
                debugLog('📋 LOADED SAVED ANALYSES', {
                    count: saved.length,
                    completedCount: saved.filter(s => s.analysis && s.status !== 'processing').length,
            savedFileNames: saved.map(s => s.fileName).slice(0, 10)
                }, 'info');
        
        // Check for duplicate filename in completed analyses only (not processing items)
        const duplicateAnalysis = saved.find(item => {
            const isMatch = item.fileName === targetProject.fileName && 
                          item.status !== 'processing' &&
                          item.analysis; // Must have analysis data (completed)
            
            if (item.fileName === targetProject.fileName) {
                debugLog('🔍 CHECKING ITEM', {
                    fileName: item.fileName,
                    status: item.status,
                    hasAnalysis: !!item.analysis,
                    isMatch: isMatch,
                    itemId: item.id
                }, 'info');
            }
            
            return isMatch;
        });
        
        if (duplicateAnalysis) {
            debugLog('⚠️ DUPLICATE FILENAME DETECTED', {
                fileName: targetProject.fileName,
                duplicateId: duplicateAnalysis.id,
                duplicateDateCreated: duplicateAnalysis.dateCreated,
                duplicateStatus: duplicateAnalysis.status,
                duplicateHasAnalysis: !!duplicateAnalysis.analysis
            }, 'warn');
            
            console.log('🎯 ABOUT TO SHOW RENAME MODAL', {
                fileName: targetProject.fileName,
                modalExists: !!document.getElementById('renameModal')
            });
            
            // Show rename modal
            const newName = await showRenameModal(
                `A file with the name "${targetProject.fileName}" already exists in your saved analyses.\n\n` +
                `Please enter a new name for this file, or click Cancel to abort:`,
                targetProject.fileName
            );
            
            const cancelled = newName === null;
            const whitespaceOnly = typeof newName === 'string' && newName.trim() === '';
            
            debugLog('📝 RENAME MODAL RESULT', {
                newName: newName,
                cancelled: cancelled || whitespaceOnly
            }, 'info');
            
            if (cancelled || whitespaceOnly) {
                // User cancelled or entered empty name
                if (!cancelled) {
                    await showWarningModal('Filename cannot be empty.');
                }
                debugLog('❌ ANALYSIS CANCELLED', { reason: 'User cancelled duplicate filename rename' }, 'warn');
                return;
            }
            
            // Validate filename
            const validationResult = validateFileName(newName);
            if (!validationResult.valid) {
                await showWarningModal(validationResult.error);
                return;
            }
            
            const sanitizedName = validationResult.sanitized;
            
            // Check if new name also exists
            const newNameDuplicate = saved.find(item => 
                item.fileName === sanitizedName && 
                item.status !== 'processing' &&
                item.analysis
            );
            
            if (newNameDuplicate) {
                await showWarningModal(`A file with the name "${sanitizedName}" already exists. Please choose a different name.`);
                return;
            }
            
            // Update filename
            targetProject.fileName = sanitizedName;
            debugLog('📝 FILENAME UPDATED', {
                oldName: duplicateAnalysis.fileName,
                newName: sanitizedName,
                projectId: targetProject.id
            });
            
            // Re-render file list to show updated name
            renderFileProjectsList();
        } else {
            debugLog('✅ NO DUPLICATE FILENAME FOUND', {
                fileName: targetProject.fileName,
                totalSaved: saved.length,
                checkedItems: saved.filter(item => item.fileName === targetProject.fileName).length
            }, 'info');
        }
    } catch (error) {
        debugLog('❌ ERROR CHECKING DUPLICATE FILENAME', {
            error: error.message,
            stack: error.stack,
            fileName: targetProject.fileName
        }, 'error');
        console.error('Error checking for duplicate filename:', error);
        // Continue with analysis even if check fails (user can rename later if needed)
    }
    
    // Set current project
    state.currentProjectId = targetProject.id;
    state.currentSubtitleData = targetProject.subtitleData;
    fileName.textContent = targetProject.fileName;
    scriptName.textContent = ''; // Clear header filename - only show when viewing saved analysis
    // Don't show fileInfo at bottom - status is shown in file list instead
    fileInfo.style.display = 'none';

    // Update project status - UPDATE EXISTING entry, do NOT create new one
    targetProject.status = 'analyzing';
    // Initialize batch tracking fields if starting fresh, otherwise preserve if resuming
    if (targetProject.currentBatchIndex === undefined || targetProject.currentBatchIndex === null) {
        targetProject.currentBatchIndex = 0;
        targetProject.processedBatches = [];
        targetProject.pausedAt = null;
    targetProject.progress = 0;
    } else {
        // Resuming from pause - keep currentBatchIndex and processedBatches
        debugLog('▶️ RESUMING FROM PAUSE', {
            projectId: targetProject.id,
            fileName: targetProject.fileName,
            currentBatchIndex: targetProject.currentBatchIndex,
            progress: targetProject.progress,
            processedBatchesCount: (targetProject.processedBatches && targetProject.processedBatches.length) || 0
        });
    }

    debugLog('📋 PROJECT STATUS UPDATED', {
        projectId: targetProject.id,
        fileName: targetProject.fileName,
        status: 'analyzing',
        progress: 0,
        subtitleCount: (targetProject.subtitleData && targetProject.subtitleData.length) || 0
    });

    // IMPORTANT: Just update the existing entry, don't create duplicates
    // Users can have multiple files with same name, but clicking Start should UPDATE this specific one
    renderFileProjectsList();

    state.isAnalyzing = true;
    state.shouldCancelAnalysis = false;
    state.isPaused = false; // Reset pause state when starting analysis
    const analysisStartTime = Date.now(); // Track analysis start time
    // Button status is shown in file list, no need to update analyzeBtn here
    
    // Create placeholder saved analysis entry with processing status
    let placeholderId = null;
    if (targetProject.fileName) {
        try {
            placeholderId = generateUniqueId();
            state.currentPlaceholderId = placeholderId; // Store globally for status updates
            const now = new Date().toISOString();
            const placeholderAnalysis = {
                id: placeholderId,
                fileName: targetProject.fileName,
                dateCreated: now,
                dateEdited: now,
                status: 'processing',
                progress: 0,
                paused: false,
                analysis: null,
                chatHistory: [],
                subtitleData: null
            };

            debugLog('📝 PLACEHOLDER CREATION STARTED', {
                placeholderId: placeholderId,
                fileName: targetProject.fileName,
                projectId: targetProject.id
            });

            // Get existing saved analyses
            let saved = await fetchSavedAnalyses('placeholder-setup');
                debugLog('💾 SAVED ANALYSES LOADED', {
                    savedCount: saved.length,
                loadSuccess: saved.length >= 0
                });

            // Check if this file already has a placeholder (might be a queued file starting)
            const existingPlaceholderIndex = saved.findIndex(item =>
                item.fileName === targetProject.fileName && item.status === 'processing'
            );

            if (existingPlaceholderIndex !== -1) {
                // Update existing placeholder to reflect it's now analyzing (reuse it)
                saved[existingPlaceholderIndex].id = placeholderId;
                saved[existingPlaceholderIndex].fileName = targetProject.fileName; // Ensure fileName matches current project
                saved[existingPlaceholderIndex].paused = false;
                saved[existingPlaceholderIndex].progress = 0;
                const now = new Date().toISOString();
                saved[existingPlaceholderIndex].dateCreated = saved[existingPlaceholderIndex].dateCreated || now;
                saved[existingPlaceholderIndex].dateEdited = now;
                state.currentPlaceholderId = placeholderId; // Store globally for status updates
                debugLog('🔄 EXISTING PLACEHOLDER UPDATED', {
                    placeholderId: placeholderId,
                    fileName: targetProject.fileName,
                    previousId: saved[existingPlaceholderIndex].id
                });
            } else {
                // Remove any other placeholders for this file (cleanup)
                const beforeFilterCount = saved.length;
                saved = saved.filter(item => !(item.fileName === targetProject.fileName && item.status === 'processing'));
                const removedCount = beforeFilterCount - saved.length;
                // Add new placeholder for analyzing file
                saved.push(placeholderAnalysis);
                debugLog('➕ NEW PLACEHOLDER CREATED', {
                    placeholderId: placeholderId,
                    fileName: targetProject.fileName,
                    cleanedPlaceholders: removedCount,
                    totalSaved: saved.length
                });
            }
            
            // Create placeholders for all queued files
            // Note: state.isAnalyzing is set to true just before this section
            state.fileProjects.forEach(project => {
                // Check if this project is queued (ready AND another file is analyzing)
                const isQueuedProject = project.status === 'ready' && state.isAnalyzing && project.id !== targetProject.id;
                if (isQueuedProject && project.fileName) {
                    // Check if placeholder already exists for this queued file
                    const existingPlaceholder = saved.find(item => 
                        item.fileName === project.fileName && item.status === 'processing'
                    );
                    
                    if (!existingPlaceholder) {
                        // Create placeholder for queued file
                        const queuedPlaceholderId = generateUniqueId() + '-' + project.id;
                        const queuedPlaceholder = {
                            id: queuedPlaceholderId,
                            fileName: project.fileName,
                            date: new Date().toISOString(),
                            status: 'processing',
                            progress: 0,
                            paused: false,
                            analysis: null,
                            chatHistory: [],
                            subtitleData: null
                        };
                        saved.push(queuedPlaceholder);
                    }
                }
            });
            
            // Keep only last 50 analyses
            if (saved.length > 50) {
                saved.shift();
            }
            
            // Save placeholder (non-blocking)
            saveAnalysesSafe(saved);
            
            // Refresh saved files view if it's open (non-blocking)
            if (viewManager.isVisible(VIEWS.SAVED_ANALYSES)) {
                setTimeout(() => loadSavedAnalyses(), 0);
            }
        } catch (error) {
            console.error('Error creating placeholder:', error);
        }
    }
    
    try {
        debugLog('⚙️ ANALYSIS PROCESSING STARTED', {
            projectId: targetProject.id,
            fileName: targetProject.fileName,
            subtitleCount: state.currentSubtitleData.length,
            placeholderId: placeholderId
        });

        // Process subtitles in batches
        const batchResults = await processSubtitleBatches(state.currentSubtitleData, placeholderId);

        debugLog('⚙️ ANALYSIS PROCESSING COMPLETED', {
            projectId: targetProject.id,
            fileName: targetProject.fileName,
            batchCount: batchResults.length,
            totalTranslations: batchResults.reduce(
                (sum, batch) => sum + ((batch.translations && batch.translations.length) || 0),
                0,
            ),
            totalExpressions: batchResults.reduce(
                (sum, batch) => sum + ((batch.expressions && batch.expressions.length) || 0),
                0,
            ),
        }, 'success');
        
        // Combine all batch results
        const analysisData = {
            translations: [],
            expressions: []
        };
        
        // Merge translations from all batches
        const allTranslationsBeforeDedup = [];
        batchResults.forEach(batch => {
            if (batch.translations) {
                const fixedTranslations = batch.translations.map(t => fixTranslationEncoding(t));
                allTranslationsBeforeDedup.push(...fixedTranslations);
            }
            if (batch.expressions) {
                const fixedExpressions = batch.expressions.map(e => fixTranslationEncoding(e));
                analysisData.expressions.push(...fixedExpressions);
            }
        });
        
        // Deduplicate translations
        const translationsMap = new Map();
        allTranslationsBeforeDedup.forEach(trans => {
            if (trans.swedish) {
                const fixedSwedish = fixEncoding(trans.swedish.trim());
                const normalizedKey = normalizeTextForMatching(fixedSwedish);
                if (!translationsMap.has(normalizedKey)) {
                    translationsMap.set(normalizedKey, trans);
                } else {
                    const existing = translationsMap.get(normalizedKey);
                    if (existing.literal && existing.literal.startsWith('[Translation needed:')) {
                        if (trans.literal && !trans.literal.startsWith('[Translation needed:')) {
                            translationsMap.set(normalizedKey, trans);
                        }
                    }
                }
            }
        });
        analysisData.translations = Array.from(translationsMap.values());
        
        // Deduplicate expressions
        const expressionsMap = new Map();
        analysisData.expressions.forEach(expr => {
            const key = (expr.word && expr.word.toLowerCase()) || '';
            if (!expressionsMap.has(key) || !expressionsMap.get(key).meaning) {
                expressionsMap.set(key, expr);
            }
        });
        analysisData.expressions = Array.from(expressionsMap.values());

        debugLog('✅ ANALYSIS COMPLETED', {
            projectId: targetProject.id,
            fileName: targetProject.fileName,
            translationsCount: analysisData.translations.length,
            expressionsCount: analysisData.expressions.length,
            processingTime: Date.now() - analysisStartTime
        }, 'success');

        // Update project with analysis data
        targetProject.analysisData = analysisData;
        targetProject.status = 'completed';
        delete targetProject.progress;
        delete targetProject.estimatedTimeRemaining;

        debugLog('📋 PROJECT STATUS COMPLETED', {
            projectId: targetProject.id,
            fileName: targetProject.fileName,
            status: 'completed'
        });
        
        // Autosave: Automatically save the completed analysis
        debugLog('💾 AUTOSAVE STARTED', {
            projectId: targetProject.id,
            fileName: targetProject.fileName,
            placeholderId: placeholderId,
            analysisTranslations: (analysisData.translations && analysisData.translations.length) || 0,
            analysisExpressions: (analysisData.expressions && analysisData.expressions.length) || 0
        });

        try {
            // Get existing saved analyses
            let saved = await fetchSavedAnalyses('autosave');
                debugLog('💾 AUTOSAVE DATA LOADED', {
                    savedCount: saved.length,
                loadSuccess: saved.length >= 0
                });
            
            // Get filename from current project (single source of truth)
            // Try multiple fallback strategies to find project
            let currentProject = state.fileProjects.find(p => p.id === state.currentProjectId);
            if (!currentProject && state.currentProjectId) {
                // Try finding by fileName as fallback
                const targetFileName = targetProject ? targetProject.fileName : undefined;
                if (targetFileName) {
                    currentProject = state.fileProjects.find(p => p.fileName === targetFileName);
                }
            }
            
            if (!currentProject) {
                debugLog('❌ PROJECT NOT FOUND FOR AUTOSAVE', { 
                    currentProjectId: state.currentProjectId,
                    targetFileName: targetProject ? targetProject.fileName : undefined,
                    availableProjects: state.fileProjects.map(p => ({ id: p.id, fileName: p.fileName }))
                }, 'error');
                // Still try to save with filename from targetProject if available
                if (!targetProject || !targetProject.fileName) {
                    debugLog('❌ CANNOT SAVE - NO PROJECT OR FILENAME', {}, 'error');
                return;
            }
            }
            const finalFileName = currentProject ? currentProject.fileName : targetProject.fileName;
            
            // Re-check for duplicates before saving (file may have been renamed during analysis)
            // This ensures we catch any filename changes that occurred after initial check
            const savedForDuplicateCheck = await fetchSavedAnalyses('autosave-duplicate-check');
            
            // Check if duplicate exists (excluding current placeholder)
            const duplicateIndex = savedForDuplicateCheck.findIndex(item =>
                item.fileName === finalFileName &&
                (placeholderId ? item.id !== placeholderId : true) &&
                item.status !== 'processing' // Only check completed analyses
            );

            if (duplicateIndex !== -1) {
                // Duplicate found - show warning and overwrite
                debugLog('⚠️ DUPLICATE FILE DETECTED BEFORE SAVE', {
                    fileName: finalFileName,
                    willOverwrite: true,
                    existingItemId: savedForDuplicateCheck[duplicateIndex].id,
                    note: 'Re-check caught duplicate that may have been created during analysis'
                }, 'warn');
                // Will overwrite when we update/create the entry below
            }
            
            // Use the latest saved data for the save operation
            saved = savedForDuplicateCheck;
            
            // Create the completed analysis entry
            const now = new Date().toISOString();
            let dateCreated = now;
            let dateEdited = now;
            let isFavorite = false;
            
            // If replacing a placeholder, preserve its dateCreated and isFavorite
            if (placeholderId) {
                const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                if (placeholderIndex !== -1) {
                    if (saved[placeholderIndex].dateCreated) {
                        dateCreated = saved[placeholderIndex].dateCreated;
                    }
                    if (saved[placeholderIndex].isFavorite !== undefined) {
                        isFavorite = saved[placeholderIndex].isFavorite;
                    }
                }
            } else {
                // If overwriting an existing entry, preserve its dateCreated and isFavorite
                const overwriteIndex = saved.findIndex(item =>
                    item.fileName === finalFileName &&
                    item.status !== 'processing'
                );
                if (overwriteIndex !== -1) {
                    if (saved[overwriteIndex].dateCreated) {
                        dateCreated = saved[overwriteIndex].dateCreated;
                    }
                    if (saved[overwriteIndex].isFavorite !== undefined) {
                        isFavorite = saved[overwriteIndex].isFavorite;
                    }
                }
            }
            
            // Preserve isFavorite from current project if it exists
            if (currentProject && currentProject.isFavorite !== undefined) {
                isFavorite = currentProject.isFavorite;
            }
            
            const completedAnalysis = {
                id: placeholderId || generateUniqueId(),
                fileName: finalFileName,
                dateCreated: dateCreated,
                dateEdited: dateEdited, // Always update dateEdited on autosave
                analysis: analysisData,
                chatHistory: state.currentChatHistory,
                subtitleData: state.currentSubtitleData,
                isFavorite: isFavorite
            };
            
            // Validate analysis data before saving
            const validation = validateAnalysisData(analysisData);
            if (!validation.valid) {
                debugLog('❌ INVALID ANALYSIS DATA - NOT SAVING', {
                    error: validation.error,
                    fileName: finalFileName,
                    hasTranslations: !!(analysisData && analysisData.translations),
                    hasExpressions: !!(analysisData && analysisData.expressions)
                }, 'error');
                // Don't save invalid data - log error and continue
                return;
            }

            if (placeholderId) {
                const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                if (placeholderIndex !== -1) {
                    // Replace placeholder with completed analysis
                    debugLog('🔄 PLACEHOLDER REPLACED', {
                        placeholderId: placeholderId,
                        fileName: finalFileName
                    });
                    saved[placeholderIndex] = completedAnalysis;
                } else {
                    // Placeholder not found - check for duplicate to overwrite
                    const overwriteIndex = saved.findIndex(item =>
                        item.fileName === finalFileName &&
                        item.status !== 'processing'
                    );
                    if (overwriteIndex !== -1) {
                        // Overwrite duplicate
                        debugLog('🔄 DUPLICATE OVERWRITTEN', {
                            fileName: finalFileName,
                            oldItemId: saved[overwriteIndex].id,
                            newItemId: completedAnalysis.id
                        });
                        saved[overwriteIndex] = completedAnalysis;
                    } else {
                        // Create new entry
                        debugLog('➕ NEW ANALYSIS CREATED', {
                            itemId: completedAnalysis.id,
                            fileName: finalFileName
                        });
                        saved.push(completedAnalysis);
                    }
                }
            } else {
                // No placeholder - check for duplicate to overwrite
                const overwriteIndex = saved.findIndex(item =>
                    item.fileName === finalFileName &&
                    item.status !== 'processing'
                );
                if (overwriteIndex !== -1) {
                    // Overwrite duplicate
                    debugLog('🔄 DUPLICATE OVERWRITTEN', {
                        fileName: finalFileName,
                        oldItemId: saved[overwriteIndex].id,
                        newItemId: completedAnalysis.id
                    });
                    saved[overwriteIndex] = completedAnalysis;
                } else {
                    // Create new entry
                    debugLog('➕ NEW ANALYSIS CREATED', {
                        itemId: completedAnalysis.id,
                        fileName: finalFileName
                    });
                    saved.push(completedAnalysis);
                }
            }
            
            // Keep only last 50 analyses
            if (saved.length > 50) {
                saved.shift();
            }
            
            // Save to file storage
                debugLog('💾 AUTOSAVE EXECUTING', {
                    finalFileName: finalFileName,
                    savedCount: saved.length,
                    placeholderReplaced: !!placeholderId
                });

            const saveResult = await saveAnalysesSafe(saved);
                if (saveResult.success) {
                    debugLog('✅ AUTOSAVE COMPLETED', {
                        finalFileName: finalFileName,
                        savedCount: saved.length,
                        projectId: targetProject.id
                    }, 'success');
                } else {
                    debugLog('❌ AUTOSAVE FAILED', {
                        finalFileName: finalFileName,
                        error: saveResult.error,
                        projectId: targetProject.id
                    }, 'error');
            }
            
            // Always refresh saved files view when analysis completes
            // This ensures the view updates even if user navigates to it later
            if (savedAnalysesView) {
                await loadSavedAnalyses();
            }
        } catch (error) {
            console.error('Error autosaving analysis:', error);
            // Don't show alert for autosave errors - it's automatic background saving
        }
        
        // Set as current analysis
        currentPage = 1;
        state.currentAnalysis = analysisData;
        displayAnalysis(analysisData);
        
        // Don't automatically switch views after analysis completes
        // User can manually view results or saved analyses when ready
        
        // Initialize chat history
        state.currentChatHistory = [
            {
                role: 'system',
                content: `You are helping the user understand Swedish subtitles. The user has just analyzed a subtitle file.

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list.`
            },
            {
                role: 'assistant',
                content: 'I\'ve analyzed your Swedish subtitle file. Feel free to ask me any questions about the translations, expressions, or grammar!'
            }
        ];
        
        // Update render
        renderFileProjectsList();
        
        // Reset pause state on successful completion
        state.isPaused = false;
        state.currentPlaceholderId = null; // Clear placeholder ID
        
    } catch (error) {
        debugLog('❌ ANALYSIS FAILED', {
            projectId: state.currentProjectId,
            fileName: (targetProject && targetProject.fileName) || 'unknown',
            error: error.message,
            stack: error.stack,
            processingTime: Date.now() - analysisStartTime
        }, 'error');

        // Reset pause state on error
        state.isPaused = false;
        state.currentPlaceholderId = null; // Clear placeholder ID on error
        // Find target project again (it might have changed after deduplication)
        // Try multiple fallback strategies
        let errorProject = state.fileProjects.find(p => p.id === state.currentProjectId);
        if (!errorProject && state.currentProjectId) {
            // Try finding by fileName as fallback
            if (initialFileName) {
                errorProject = state.fileProjects.find(p => p.fileName === initialFileName);
            }
        }
        if (errorProject) {
            errorProject.status = 'error';
            debugLog('📋 PROJECT STATUS ERROR', {
                projectId: errorProject.id,
                fileName: errorProject.fileName,
                status: 'error'
            });
        } else {
            debugLog('⚠️ ERROR PROJECT NOT FOUND', {
                currentProjectId: state.currentProjectId,
                targetFileName: initialFileName,
                availableProjects: state.fileProjects.map(p => ({ id: p.id, fileName: p.fileName }))
            }, 'warn');
        }
        renderFileProjectsList();
        alert('Error during analysis: ' + error.message);
    } finally {
        // Clear all pending progress update timeouts
        state.progressUpdateTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        state.progressUpdateTimeouts = [];
        
        // Check if analysis was cancelled
        if (state.shouldCancelAnalysis) {
            // Reset pause state on cancel
            state.isPaused = false;
            state.currentPlaceholderId = null; // Clear placeholder ID on cancel
            // Find target project again (it might have changed after deduplication)
            // Try multiple fallback strategies
            let cancelProject = state.fileProjects.find(p => p.id === state.currentProjectId);
            if (!cancelProject && state.currentProjectId) {
                // Try finding by fileName as fallback
                if (targetFileName) {
                    cancelProject = state.fileProjects.find(p => p.fileName === targetFileName);
                }
            }
            if (cancelProject) {
                cancelProject.status = 'ready';
                delete cancelProject.progress;
                delete cancelProject.estimatedTimeRemaining;
                console.log('Analysis cancelled');
            } else {
                debugLog('⚠️ CANCEL PROJECT NOT FOUND', {
                    currentProjectId: state.currentProjectId,
                    targetFileName: targetFileName,
                    availableProjects: state.fileProjects.map(p => ({ id: p.id, fileName: p.fileName }))
                }, 'warn');
            }
        }
        
        state.isAnalyzing = false;
        state.shouldCancelAnalysis = false;
        // Button status is shown in file list, no need to update analyzeBtn here
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
        fileInfo.style.display = 'none'; // Keep hidden
        state.currentProjectId = null;
        renderFileProjectsList();
        
        // Automatically process next file in queue (only if not cancelled)
        if (!state.shouldCancelAnalysis) {
            processQueue();
        }
    }
}

// Remove a project
function removeProject(projectId) {
    const projectIndex = state.fileProjects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) return;
    
    // If removing current project, reset
    if (state.currentProjectId === projectId) {
        state.currentProjectId = null;
        state.currentSubtitleData = null;
        state.currentAnalysis = null;
        fileInfo.style.display = 'none';
        resultsSection.style.display = 'none';
    }
    
    state.fileProjects.splice(projectIndex, 1);
    // window.state.fileProjects is auto-synced via getter
    renderFileProjectsList();
}

    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (state.isAnalyzing) {
                state.shouldCancelAnalysis = true;
            }
        });
    }

// Process files one by one automatically
async function processQueue() {
    // Don't start if already analyzing or queue is being processed
    if (state.isAnalyzing || state.isProcessingQueue) {
        return;
    }
    
    state.isProcessingQueue = true;
    
    try {
    // Find first ready project and update it (don't create new entries)
    const readyProject = state.fileProjects.find(p => p.status === 'ready');
    if (readyProject) {
        await analyzeProject(readyProject.id);
        // After analysis completes, check for next file
            // Clear flag before recursive call so it can start again
            state.isProcessingQueue = false;
            // Recursive call - will check state.isProcessingQueue flag
        processQueue();
        } else {
            // No more ready projects - clear flag
            state.isProcessingQueue = false;
        }
    } catch (error) {
        // Ensure flag is cleared on error
        state.isProcessingQueue = false;
        console.error('Error in processQueue:', error);
    }
}

    // Analyze button - works with current project or starts queue
    analyzeBtn.addEventListener('click', async () => {
        // If state.currentProjectId is set, use it
        if (state.currentProjectId) {
            await analyzeProject(state.currentProjectId);
            return;
        }
        
        // Otherwise, start processing queue
        if (state.fileProjects.length > 0) {
            await processQueue();
            return;
        }
        
        // Fallback to old behavior if no projects
        if (!state.currentSubtitleData || state.currentSubtitleData.length === 0) {
            alert(`Please upload a valid ${CONFIG.ALLOWED_FILE_TYPES.join(' or ')} file first.`);
            return;
        }

        if (!state.apiKey) {
            alert('Please set your OpenAI API key in Settings first.');
            settingsBtn.click();
            return;
        }

        if (state.isAnalyzing) {
            // Silently return if analysis is already in progress (button should be disabled)
            return;
        }

        state.isAnalyzing = true;
        state.shouldCancelAnalysis = false;
        // Button status is shown in file list (fileInfo is hidden), but keep this for fallback old behavior
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';
        if (cancelBtn) {
            cancelBtn.style.display = 'none'; // Hide cancel button in fileInfo since we use file list
        }
        fileInfo.style.display = 'none'; // Don't show fileInfo at bottom
        
        // Create placeholder saved analysis entry with processing status
        let placeholderId = null;
        const currentFileName = fileName.textContent || 'unknown';
        if (currentFileName && currentFileName !== 'unknown') {
            try {
                placeholderId = generateUniqueId();
                const now = new Date().toISOString();
                const placeholderAnalysis = {
                    id: placeholderId,
                    fileName: currentFileName,
                    dateCreated: now,
                    dateEdited: now,
                    status: 'processing',
                    analysis: null,
                    chatHistory: [],
                    subtitleData: null
                };
                
                // Get existing saved analyses
                let saved = await fetchSavedAnalyses('resume-placeholder');
                
                // Remove any existing placeholder for this file
                saved = saved.filter(item => !(item.fileName === currentFileName && item.status === 'processing'));
                
                // Add placeholder
                saved.push(placeholderAnalysis);
                
                // Keep only last 50 analyses
                if (saved.length > 50) {
                    saved.shift();
                }
                
                // Save placeholder (non-blocking)
                saveAnalysesSafe(saved);
                
                // Refresh saved files view if it's open (non-blocking)
                if (savedAnalysesView && savedAnalysesView.style.display === 'flex') {
                    setTimeout(() => loadSavedAnalyses(), 0);
                }
            } catch (error) {
                console.error('Error creating placeholder:', error);
            }
        }

        try {
            console.log(`Starting analysis of ${state.currentSubtitleData.length} subtitle entries...`);
            
            // Process subtitles in batches to handle large files
            const batchResults = await processSubtitleBatches(state.currentSubtitleData, placeholderId);
            
            // Check if analysis was cancelled
            if (state.shouldCancelAnalysis) {
                console.log('Analysis cancelled by user');
                return;
            }
            
            // Combine all batch results
            const analysisData = {
                translations: [],
                expressions: []
            };
            
            // Merge translations from all batches
            const allTranslationsBeforeDedup = [];
            batchResults.forEach(batch => {
                if (batch.translations) {
                    // Fix encoding for all translations before adding
                    const fixedTranslations = batch.translations.map(t => fixTranslationEncoding(t));
                    allTranslationsBeforeDedup.push(...fixedTranslations);
                }
                if (batch.expressions) {
                    // Fix encoding for all expressions before adding
                    const fixedExpressions = batch.expressions.map(e => fixTranslationEncoding(e));
                    analysisData.expressions.push(...fixedExpressions);
                }
            });
            
            // Deduplicate translations (keep unique by normalized Swedish text)
            const translationsMap = new Map();
            
            allTranslationsBeforeDedup.forEach(trans => {
                if (trans.swedish) {
                    // Ensure encoding is fixed before comparison
                    const fixedSwedish = fixEncoding(trans.swedish.trim());
                    const normalizedKey = normalizeTextForMatching(fixedSwedish);
                    
                    // Only add if not already present, preferring entries with actual translations over placeholders
                    if (!translationsMap.has(normalizedKey)) {
                        translationsMap.set(normalizedKey, trans);
                    } else {
                        const existing = translationsMap.get(normalizedKey);
                        // Replace placeholder with actual translation if we have one
                        if (existing.literal && existing.literal.startsWith('[Translation needed:')) {
                            if (trans.literal && !trans.literal.startsWith('[Translation needed:')) {
                                translationsMap.set(normalizedKey, trans);
                            }
                        }
                    }
                }
            });
            analysisData.translations = Array.from(translationsMap.values());
            
            // Log deduplication results
            const duplicatesRemoved = allTranslationsBeforeDedup.length - analysisData.translations.length;
            console.log(`Deduplication complete: ${analysisData.translations.length} unique translations from ${allTranslationsBeforeDedup.length} total (removed ${duplicatesRemoved} duplicates)`);
            
            // Deduplicate expressions (keep unique by word)
            const expressionsMap = new Map();
            analysisData.expressions.forEach(expr => {
                const key = (expr.word && expr.word.toLowerCase()) || '';
                if (!expressionsMap.has(key) || !expressionsMap.get(key).meaning) {
                    expressionsMap.set(key, expr);
                }
            });
            analysisData.expressions = Array.from(expressionsMap.values());
            
            console.log(`Analysis complete: ${analysisData.translations.length} translations, ${analysisData.expressions.length} expressions`);

            // Update placeholder with actual analysis data
            if (placeholderId) {
                try {
                    let saved = await fetchSavedAnalyses('placeholder-complete');
                    
                    // Find and update placeholder
                    const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                    if (placeholderIndex !== -1) {
                        // Update placeholder to completed analysis (remove status and progress fields)
                        saved[placeholderIndex] = {
                            id: placeholderId,
                            fileName: currentFileName,
                            date: new Date().toISOString(),
                            analysis: analysisData,
                            chatHistory: state.currentChatHistory,
                            subtitleData: state.currentSubtitleData
                        };
                        
                        // Save updated analysis
                        await saveAnalysesSafe(saved);
                        
                        // Always refresh saved files view when analysis completes
                        // This ensures the view updates even if user navigates to it later
                        if (savedAnalysesView) {
                            await loadSavedAnalyses();
                        }
                    }
                } catch (error) {
                    console.error('Error updating placeholder:', error);
                }
            }

            // Reset pagination to first page for new analysis
            currentPage = 1;

            state.currentAnalysis = analysisData;
            displayAnalysis(analysisData);
            
            // Check which view is currently active
            const isInSettings = viewManager.isVisible(VIEWS.SETTINGS);
            const isInSavedAnalyses = viewManager.isVisible(VIEWS.SAVED_ANALYSES);
            const isInStudyModal = studyModal && studyModal.style.display !== 'none';
            
            // If analysis completes while user is in saved files view, switch to results
            if (isInSavedAnalyses) {
                viewManager.showResults();
                // Hide expressions section
                if (expressionsContent && expressionsContent.parentElement) {
                    expressionsContent.parentElement.style.display = 'none';
                }
            } else if (!isInSettings && !isInStudyModal) {
                // Only auto-switch to results if user is not in another view
                // Show results only (no chat or expressions in main view)
                viewManager.showResults();
                // Hide expressions section
                if (expressionsContent && expressionsContent.parentElement) {
                    expressionsContent.parentElement.style.display = 'none';
                }
            }
            // If user is in settings, analysis data is already stored
            // and will be shown when they return (handled by closeSettingsBtn)
            
            // Initialize chat history with analysis context
            state.currentChatHistory = [
                {
                    role: 'system',
                    content: `You are helping the user understand Swedish subtitles. The user has just analyzed a subtitle file.

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list.`
                },
                {
                    role: 'assistant',
                    content: 'I\'ve analyzed your Swedish subtitle file. Feel free to ask me any questions about the translations, expressions, or grammar!'
                }
            ];

        } catch (error) {
            console.error('Analysis error:', error);
            alert('Error during analysis: ' + error.message);
        } finally {
            state.isAnalyzing = false;
            state.shouldCancelAnalysis = false;
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze';
            if (cancelBtn) {
                cancelBtn.style.display = 'none';
            }
            fileInfo.style.display = 'none'; // Keep hidden
        }
    });
    
    // Level filter dropdown functionality
    const levelFilterBtn = document.getElementById('levelFilterBtn');
    const levelDropdown = document.getElementById('levelDropdown');
    const levelAllCheckbox = document.getElementById('levelAllCheckbox');
    const levelCheckboxes = document.querySelectorAll('.level-dropdown-checkbox');
    const levelFilterSection = document.querySelector('.level-filter-section');
    
    // Toggle dropdown
    if (levelFilterBtn && levelDropdown) {
        levelFilterBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = levelDropdown.style.display !== 'none';
            levelDropdown.style.display = isOpen ? 'none' : 'block';
            levelFilterBtn.classList.toggle('open', !isOpen);
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (levelFilterSection && !levelFilterSection.contains(e.target)) {
                levelDropdown.style.display = 'none';
                levelFilterBtn.classList.remove('open');
            }
        });
    }
    
    // Update button text based on selection
    function updateLevelFilterButtonText() {
        if (!levelFilterBtn) return;
        const checkedBoxes = document.querySelectorAll('.level-dropdown-checkbox:checked');
        const allBoxes = document.querySelectorAll('.level-dropdown-checkbox');
        const allLevelBoxes = Array.from(allBoxes).filter(cb => cb.value !== 'ALL');
        const checkedLevelBoxes = Array.from(checkedBoxes).filter(cb => cb.value !== 'ALL');
        
        const btnText = levelFilterBtn.querySelector('.level-filter-btn-text');
        if (checkedLevelBoxes.length === allLevelBoxes.length) {
            btnText.textContent = 'Filter by CEFR Level: All';
        } else if (checkedLevelBoxes.length === 0) {
            btnText.textContent = 'Filter by CEFR Level: None';
        } else {
            btnText.textContent = `Filter by CEFR Level: ${checkedLevelBoxes.length} selected`;
        }
    }
    
    // Handle "ALL" checkbox
    if (levelAllCheckbox) {
        levelAllCheckbox.addEventListener('change', (e) => {
            const allLevelBoxes = Array.from(levelCheckboxes).filter(cb => cb.value !== 'ALL');
            if (e.target.checked) {
                // Select all individual level checkboxes
                allLevelBoxes.forEach(cb => {
                    cb.checked = true;
                    const level = cb.value;
                    if (!selectedLevels.includes(level)) {
                        selectedLevels.push(level);
                    }
                });
            } else {
                // Uncheck all individual level checkboxes
                allLevelBoxes.forEach(cb => {
                    cb.checked = false;
                    selectedLevels = selectedLevels.filter(l => !allLevelBoxes.some(c => c.value === l));
                });
            }
            updateLevelFilterButtonText();
            if (state.currentAnalysis) {
                displayExpressions();
            }
        });
    }
    
    // Handle individual level checkboxes
    levelCheckboxes.forEach(checkbox => {
        if (checkbox.value === 'ALL') return; // Skip ALL checkbox, handled separately
        
        checkbox.addEventListener('change', (e) => {
            const level = e.target.value;
            if (e.target.checked) {
                // Add level to selected levels if not already present
                if (!selectedLevels.includes(level)) {
                    selectedLevels.push(level);
                }
            } else {
                // Remove level from selected levels
                selectedLevels = selectedLevels.filter(l => l !== level);
                // Uncheck "ALL" if any individual checkbox is unchecked
                if (levelAllCheckbox) {
                    levelAllCheckbox.checked = false;
                }
            }
            
            // Check if all individual boxes are checked
            const allLevelBoxes = Array.from(levelCheckboxes).filter(cb => cb.value !== 'ALL');
            const allChecked = allLevelBoxes.every(cb => cb.checked);
            if (levelAllCheckbox) {
                levelAllCheckbox.checked = allChecked;
            }
            
            updateLevelFilterButtonText();
            // Refresh expressions display with new filter
            if (state.currentAnalysis) {
                displayExpressions();
            }
        });
    });
    
    // Initialize button text
    updateLevelFilterButtonText();

// Display analysis results
function displayAnalysis(data) {
    // Display translations
    translationsContent.innerHTML = '';
    
    if (data.rawResponse) {
        // Fallback: display raw response
        translationsContent.innerHTML = `<div class="translation-item"><pre style="white-space: pre-wrap; color: #ccc;">${data.rawResponse}</pre></div>`;
    } else if (data.translations && data.translations.length > 0) {
        // Calculate pagination
        const totalTranslations = data.translations.length;
        const totalPages = Math.ceil(totalTranslations / itemsPerPage);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, totalTranslations);
        const paginatedTranslations = data.translations.slice(startIndex, endIndex);
        
        // Display paginated translations
        paginatedTranslations.forEach((trans, index) => {
            const item = document.createElement('div');
            item.className = 'translation-item';
            
            // Find timestamp for this translation
            const timestamp = findTimestampForText(trans.swedish);
            const timestampStr = timestamp ? formatTimestamp(timestamp) : '';
            
            let html = `<div class="translation-item-content">`;
            // Always show timestamp column, even if empty
            if (timestampStr) {
                html += `<div class="translation-timestamp">${escapeHtml(timestampStr)}</div>`;
            } else {
                html += `<div class="translation-timestamp"></div>`;
            }
            html += `<div class="translation-text-wrapper">`;
            html += `<div class="swedish-text">${escapeHtml(fixEncoding(trans.swedish))}</div>`;
            
            if (trans.literal) {
                html += `<div class="translation-label">Literal Translation</div>`;
                html += `<div class="translation-text">${escapeHtml(fixEncoding(trans.literal))}</div>`;
            }
            
            if (trans.natural && trans.natural !== trans.literal) {
                html += `<div class="translation-label">Natural Translation</div>`;
                html += `<div class="translation-text">${escapeHtml(fixEncoding(trans.natural))}</div>`;
            }
            html += `</div></div>`;
            
            item.innerHTML = html;
            // Use actual global index for study modal
            const globalIndex = startIndex + index;
            item.addEventListener('click', () => openStudyModal('translation', trans, globalIndex, timestamp));
            translationsContent.appendChild(item);
        });
        
        // Add pagination controls if there's more than one page
        if (totalPages > 1) {
            const paginationContainer = document.createElement('div');
            paginationContainer.className = 'pagination-container';
            paginationContainer.innerHTML = `
                <button id="prevPageBtn" class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
                <span class="pagination-info">Page ${currentPage} of ${totalPages}</span>
                <button id="nextPageBtn" class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
            `;
            translationsContent.appendChild(paginationContainer);
            
            // Add event handlers for pagination buttons
            const prevBtn = document.getElementById('prevPageBtn');
            const nextBtn = document.getElementById('nextPageBtn');
            
            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (currentPage > 1) {
                        currentPage--;
                        displayAnalysis(data);
                        // Scroll to top of results
                        translationsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            }
            
            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    if (currentPage < totalPages) {
                        currentPage++;
                        displayAnalysis(data);
                        // Scroll to top of results
                        translationsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            }
        }
    } else {
        translationsContent.innerHTML = '<p style="color: #666;">No translations found.</p>';
    }

    // Expressions are only shown in study modal, not in main results view
    // Hide expressions section in main view
    if (expressionsContent && expressionsContent.parentElement) {
        expressionsContent.parentElement.style.display = 'none';
    }
}

    // Chat functionality
    chatSendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage();
        }
    });

async function sendChatMessage() {
    const message = chatInput.value.trim();
    debugLog('💬 CHAT MESSAGE SENT', {
        messageLength: message.length,
        hasApiKey: !!state.apiKey,
        messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : ''),
        chatHistoryLength: state.currentChatHistory.length
    });

    if (!message || !state.apiKey) {
        if (!message) debugLog('⚠️ CHAT MESSAGE SKIPPED', { reason: 'Empty message' }, 'warn');
        if (!state.apiKey) debugLog('⚠️ CHAT MESSAGE SKIPPED', { reason: 'No API key' }, 'warn');
        return;
    }

    // Check for {add- word} pattern
    const addWordMatch = message.match(/\{add-\s*([^}]+)\}/i);
    if (addWordMatch) {
        const wordToAdd = addWordMatch[1].trim();
        debugLog('➕ CHAT ADD EXPRESSION DETECTED', { wordToAdd: wordToAdd });
        await addExpressionFromChat(wordToAdd, 'main');
        chatInput.value = '';
        return;
    }

    // Extract word from message if it's about a specific word
    let wordToSave = null;
    const wordMatch = message.match(/["']([^"']+)["']/); // Extract word in quotes
    if (wordMatch) {
        wordToSave = wordMatch[1];
        debugLog('📝 CHAT WORD EXTRACTED', { wordToSave: wordToSave });
    }

    // Add user message to chat
    createChatMessage({
        role: 'user',
        content: message,
        container: chatMessages,
        prefix: 'msg',
        markdownToHtml: markdownToHtml
    });
    state.currentChatHistory.push({ role: 'user', content: message });

    debugLog('👤 USER MESSAGE ADDED', {
        messageLength: message.length,
        wordToSave: wordToSave,
        updatedChatHistoryLength: state.currentChatHistory.length
    });

    chatInput.value = '';
    chatSendBtn.disabled = true;
    
    // Show loading
    const loadingId = createChatMessage({
        role: 'assistant',
        content: 'Thinking...',
        container: chatMessages,
        prefix: 'msg',
        markdownToHtml: markdownToHtml
    });
    
    try {
        const assistantMessage = await callOpenAI(state.currentChatHistory);
        
        // Extract word from response if not already extracted
        if (!wordToSave) {
            // Try to find quoted words first
            const responseWordMatch = assistantMessage.match(/["']([^"']+)["']/);
            if (responseWordMatch) {
                wordToSave = responseWordMatch[1];
            } else {
                // Look for patterns like "The word X" or "X means"
                const wordPatternMatch = assistantMessage.match(/(?:word|expression)\s+["']?([\wåäöÅÄÖ]+)["']?/i);
                if (wordPatternMatch) {
                    wordToSave = wordPatternMatch[1];
                } else {
                    // Look for Swedish words (with åäö characters) in the response
                    const swedishWordMatch = assistantMessage.match(/\b([\wåäöÅÄÖ]{3,})\b/);
                    if (swedishWordMatch) {
                        wordToSave = swedishWordMatch[1];
                    }
                }
            }
        }
        
        // Remove loading message and add real response
        removeChatMessage(loadingId);
        createChatMessage({
            role: 'assistant',
            content: assistantMessage,
            container: chatMessages,
            prefix: 'msg',
            markdownToHtml: markdownToHtml,
            onSaveWord: async (word) => {
                await addExpressionFromStudyChat(word);
            }
        });
        
        state.currentChatHistory.push({ role: 'assistant', content: assistantMessage });
        
    } catch (error) {
        console.error('Chat error:', error);
        removeChatMessage(loadingId);
        createChatMessage({
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            container: chatMessages,
            prefix: 'msg',
            markdownToHtml: markdownToHtml
        });
    } finally {
        chatSendBtn.disabled = false;
    }
}

// Add expression from chat using {add- word} command
async function addExpressionFromChat(word, context = 'main') {
    debugLog('➕ ADDING EXPRESSION FROM CHAT', {
        word: word,
        context: context,
        hasApiKey: !!state.apiKey,
        hasCurrentAnalysis: !!state.currentAnalysis
    });

    if (!state.apiKey || !word) {
        debugLog('❌ ADD EXPRESSION FAILED', {
            reason: !state.apiKey ? 'No API key' : 'No word provided',
            word: word,
            hasApiKey: !!state.apiKey
        }, 'error');
        console.error('Missing API key or word');
        return;
    }

    try {
        // Initialize state.currentAnalysis if it doesn't exist
        if (!state.currentAnalysis) {
            debugLog('🔄 INITIALIZING ANALYSIS STRUCTURE', { reason: 'No current analysis existed' });
            state.currentAnalysis = {
                translations: [],
                expressions: []
            };
        }
        
        // Ask GPT for the meaning
        const meaningPrompt = `What does the Swedish word "${word}" mean in English? Provide a brief, clear definition.`;
        const meaningResponse = await callOpenAI([
            {
                role: 'system',
                content: `You are a Swedish language tutor. 

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list. Provide clear, concise definitions.`
            },
            {
                role: 'user',
                content: meaningPrompt
            }
        ]);
        
        // Validate response
        if (!meaningResponse || typeof meaningResponse !== 'string') {
            throw new Error('Invalid response from API');
        }
        
        // Create expression object with "Custom" level for user-added expressions
        const newExpression = fixTranslationEncoding({
            word: word,
            meaning: meaningResponse.trim(),
            example: '',
            level: 'Custom'
        });
        
        // Associate expression with current translation if study modal is open
        if (currentStudyItem && currentStudyItem.type === 'translation') {
            newExpression.translationIndex = currentStudyItem.index;
            newExpression.translationText = currentStudyItem.item.swedish;
            console.log('Associated expression with translation from main chat:', {
                index: currentStudyItem.index,
                swedish: currentStudyItem.item.swedish
            });
        }
        
        if (!state.currentAnalysis.expressions) {
            state.currentAnalysis.expressions = [];
        }
        state.currentAnalysis.expressions.push(newExpression);
        
        // Update expressions display
        if (context === 'main') {
            if (expressionsContent) {
                displayExpressions();
            }
        } else if (context === 'study') {
            // Update study modal expressions if word matches
            if (currentStudyItem && currentStudyItem.type === 'translation') {
                const swedishText = currentStudyItem.item.swedish.toLowerCase();
                if (swedishText.includes(word.toLowerCase())) {
                    if (studyExpressionsContent && studyExpressionsSection) {
                                displayStudyExpressions();
                    }
                }
            }
        }
        
        // Show confirmation (no save button needed for confirmation messages)
        createChatMessage({
            role: 'assistant',
            content: `Added "${word}" to Important Expressions & Words. Meaning: ${meaningResponse.trim()}`,
            container: chatMessages,
            prefix: 'msg',
            markdownToHtml: markdownToHtml
        });
        
    } catch (error) {
        console.error('Error adding expression:', error);
        console.error('Error details:', error.message, error.stack);
        createChatMessage({
            role: 'assistant',
            content: `Sorry, I couldn't add "${word}". Please try again.`,
            container: chatMessages,
            prefix: 'msg',
            markdownToHtml: markdownToHtml
        });
    }
}

// Old chat and modal functions removed - now using modules:
// - createChatMessage, removeChatMessage from src/utils/chatBuilder.js
// - showWarningModal, showRenameModal, showChatHistory from src/utils/modalManager.js

// Utility functions are now imported from src/utils/helpers.js
// Removed duplicate implementations: escapeHtml, validateAnalysisData, validateFileName

    // Save analysis
    saveAnalysisBtn.addEventListener('click', async () => {
        debugLog('💾 MANUAL SAVE INITIATED', {
            hasAnalysis: !!state.currentAnalysis,
            fileName: fileName.textContent,
            translationsCount:
                (state.currentAnalysis &&
                    state.currentAnalysis.translations &&
                    state.currentAnalysis.translations.length) ||
                0,
            expressionsCount:
                (state.currentAnalysis &&
                    state.currentAnalysis.expressions &&
                    state.currentAnalysis.expressions.length) ||
                0,
        });

        if (!state.currentAnalysis) {
            debugLog('❌ MANUAL SAVE FAILED', { reason: 'No analysis to save' }, 'error');
            await showWarningModal('No analysis to save. Please analyze a file first.');
            return;
        }

        const now = new Date().toISOString();
        const savedAnalysis = {
            id: generateUniqueId(),
            fileName: fileName.textContent,
            dateCreated: now,
            dateEdited: now,
            analysis: state.currentAnalysis,
            chatHistory: state.currentChatHistory,
            subtitleData: state.currentSubtitleData
        };

        debugLog('📝 MANUAL SAVE ANALYSIS CREATED', {
            id: savedAnalysis.id,
            fileName: savedAnalysis.fileName,
            date: savedAnalysis.date
        });

        try {
            // Get existing saved analyses
            let saved = await fetchSavedAnalyses('manual-save');
            
            // Check for duplicate filename before saving
            const duplicateIndex = saved.findIndex(item =>
                item.fileName === savedAnalysis.fileName &&
                item.status !== 'processing' && // Only check completed analyses
                item.analysis // Must have analysis data
            );
            
            if (duplicateIndex !== -1) {
                // Duplicate found - ask user if they want to overwrite
                const overwrite = confirm(
                    `A file with the name "${savedAnalysis.fileName}" already exists.\n\n` +
                    `Do you want to overwrite it?`
                );
                
                if (overwrite) {
                    // Overwrite existing entry, preserving dateCreated and isFavorite
                    const existingItem = saved[duplicateIndex];
                    savedAnalysis.dateCreated = existingItem.dateCreated || savedAnalysis.dateCreated;
                    savedAnalysis.isFavorite = existingItem.isFavorite !== undefined ? existingItem.isFavorite : false;
                    savedAnalysis.id = existingItem.id; // Keep the same ID
                    
                    debugLog('🔄 MANUAL SAVE OVERWRITING DUPLICATE', {
                        fileName: savedAnalysis.fileName,
                        existingItemId: existingItem.id,
                        newItemId: savedAnalysis.id
                    }, 'warn');
                    
                    saved[duplicateIndex] = savedAnalysis;
                } else {
                    // User cancelled - don't save
                    debugLog('❌ MANUAL SAVE CANCELLED', { reason: 'User declined to overwrite duplicate' }, 'info');
                    return;
                }
            } else {
                // No duplicate - add new entry
                saved.push(savedAnalysis);
            }
            
            // Keep only last 50 analyses
            if (saved.length > 50) {
                saved.shift();
            }
            
            // Save to file storage
                debugLog('💾 MANUAL SAVE EXECUTING', {
                    totalSavedCount: saved.length,
                    newAnalysisId: savedAnalysis.id
                });

            const saveResult = await saveAnalysesSafe(saved);
                if (saveResult.success) {
                    debugLog('✅ MANUAL SAVE COMPLETED', {
                        totalSavedCount: saved.length,
                        savedAnalysisId: savedAnalysis.id,
                        fileName: savedAnalysis.fileName
                    }, 'success');
                    
                await showWarningModal('Analysis saved successfully!');
                } else {
                    debugLog('❌ MANUAL SAVE FAILED', {
                        error: saveResult.error,
                        savedAnalysisId: savedAnalysis.id
                    }, 'error');
                await showWarningModal('Error saving analysis: ' + (saveResult.error || 'Unknown error'));
            }
        } catch (error) {
            debugLog('❌ MANUAL SAVE ERROR', {
                error: error.message,
                savedAnalysisId: savedAnalysis.id
            }, 'error');
            console.error('Error saving analysis:', error);
            await showWarningModal('Error saving analysis: ' + error.message);
        }
    });

    // Close results button
    if (closeResultsBtn) {
        closeResultsBtn.addEventListener('click', async () => {
            // Navigate to saved analyses view
            viewManager.showSavedAnalyses();
            
            // Reset edit mode and load saved analyses
            isEditMode = false;
            await loadSavedAnalyses();
            if (editSavedBtn) {
                updateEditButton();
            }
        });
    }

    // Saved analyses view
    if (!savedAnalysesBtn) {
        console.error('❌ savedAnalysesBtn element not found! Cannot attach click handler.');
    } else {
        console.log('✅ Saved Analyses button found, attaching click handler');
        
        // Try both addEventListener and onclick as fallback
        const handleSavedAnalysesClick = async (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            console.log('🔥 Saved Analyses button clicked - handler fired!');
            debugLog('📂 NAVIGATING TO SAVED ANALYSES', {
                isAnalyzing: state.isAnalyzing,
                hasCurrentAnalysis: !!state.currentAnalysis,
                projectCount: state.fileProjects.length
            });

            // Show warning if analysis is in progress
            if (state.isAnalyzing) {
                debugLog('⚠️ ANALYSIS IN PROGRESS WARNING', {
                    showingConfirmDialog: true,
                    currentProjectId: state.currentProjectId
                });
                const confirmLeave = confirm('Analysis is in progress. Are you sure you want to leave? The analysis will continue in the background.');
                if (!confirmLeave) {
                    debugLog('❌ NAVIGATION CANCELLED', { reason: 'User declined to leave analysis' });
                    return;
                }
                debugLog('✅ NAVIGATION CONFIRMED', { reason: 'User confirmed leaving analysis' });
            }
            
            isEditMode = false; // Reset edit mode when opening
            
            // Show the view first
            if (!savedAnalysesView) {
                console.error('savedAnalysesView element not found!');
                return;
            }
            
            console.log('Showing saved analyses view');
            console.log('savedAnalysesView before show:', savedAnalysesView.style.display);
            
            // Hide other views manually first
            if (uploadSection) uploadSection.style.display = 'none';
            if (resultsSection) resultsSection.style.display = 'none';
            if (settingsView) settingsView.style.display = 'none';
            
            // Show saved analyses view
            savedAnalysesView.style.display = 'flex';
            console.log('savedAnalysesView after show:', savedAnalysesView.style.display);
            
            // Also use viewManager
            viewManager.showSavedAnalyses();
            
            await loadSavedAnalyses();
            if (editSavedBtn) {
                updateEditButton();
            }
            console.log('Saved analyses view should now be visible');
            // Note: Analysis continues in background if in progress
            // Progress will be visible when returning to home window
        };
        
        // Attach event listener
        savedAnalysesBtn.addEventListener('click', handleSavedAnalysesClick);
        
        // Also set onclick as backup
        savedAnalysesBtn.onclick = handleSavedAnalysesClick;
        
        // Right-click on empty space in saved analyses view to create folder
        if (activeSavesSection) {
            activeSavesSection.addEventListener('contextmenu', async (e) => {
                // Only if clicking on the section itself, not on items
                if (e.target === activeSavesSection || 
                    e.target === activeSavesList || 
                    e.target === activeSavesCards) {
                    e.preventDefault();
                    e.stopPropagation();
                    await showCreateFolderModal();
                }
            });
        }
        
        console.log('✅ Click handler attached to savedAnalysesBtn');
    }

    // Edit/Delete button for saved analyses
    if (editSavedBtn) {
        editSavedBtn.addEventListener('click', async () => {
            if (isEditMode) {
                // Delete mode - delete checked items
                const checkedItems = document.querySelectorAll('.saved-item-checkbox:checked');
                if (checkedItems.length === 0) {
                    alert('Please select at least one item to delete.');
                    return;
                }
                
                // Per spec: "Are you sure you want to permanently delete this file?"
                const itemCount = checkedItems.length;
                const confirmMessage = itemCount === 1 
                    ? 'Are you sure you want to permanently delete this file?'
                    : `Are you sure you want to permanently delete these ${itemCount} files?`;
                const confirmDelete = confirm(confirmMessage);
                if (!confirmDelete) {
                    return;
                }
                
                try {
                    // Get IDs of checked items (convert to strings for reliable comparison)
                    const idsToDelete = Array.from(checkedItems).map(cb => String(cb.dataset.itemId));
                    
                    // Load ALL saved analyses (not filtered by fileName)
                    let saved = await fetchSavedAnalyses('delete-selected');
                    
                    // Filter out deleted items - ensure ID comparison works correctly
                    // Use strict string comparison to avoid type coercion issues
                    const filtered = saved.filter(item => {
                        const itemId = String(item.id);
                        return !idsToDelete.includes(itemId);
                    });
                    
                    // Save back to file storage
                    const saveResult = await saveAnalysesSafe(filtered);
                        if (!saveResult.success) {
                            alert('Error deleting analyses: ' + (saveResult.error || 'Unknown error'));
                            return;
                    }
                    
                    // Exit edit mode and reload
                    isEditMode = false;
                    await loadSavedAnalyses();
                    updateEditButton();
                } catch (error) {
                    console.error('Error deleting analyses:', error);
                    alert('Error deleting analyses: ' + error.message);
                }
            } else {
                // Enter edit mode
                isEditMode = true;
                await loadSavedAnalyses();
                // Ensure goBackBtn is available
                if (!goBackBtn) {
                    goBackBtn = document.getElementById('goBackBtn');
                }
                updateEditButton();
            }
        });
    }

    // Go Back button handler
    if (goBackBtn) {
        goBackBtn.addEventListener('click', async () => {
            // Exit edit mode without deleting
            isEditMode = false;
            await loadSavedAnalyses();
            updateEditButton();
        });
    }
    
    // View toggle buttons
    if (listViewBtn) {
        listViewBtn.addEventListener('click', () => {
            toggleSavedView('list');
        });
    }
    
    if (cardViewBtn) {
        cardViewBtn.addEventListener('click', () => {
            toggleSavedView('card');
        });
    }

function updateEditButton() {
    if (editSavedBtn) {
        if (isEditMode) {
            editSavedBtn.textContent = 'Delete';
            editSavedBtn.className = 'delete-btn';
        } else {
            editSavedBtn.textContent = 'Edit';
            editSavedBtn.className = 'edit-btn';
        }
    }
    
    // Show/hide Go Back button based on edit mode
    if (goBackBtn) {
        if (isEditMode) {
            goBackBtn.style.display = 'inline-block';
        } else {
            goBackBtn.style.display = 'none';
        }
    } else {
        console.warn('goBackBtn not found - button may not be initialized');
    }
}

// Update saved item status in-place without recreating the DOM element
function updateSavedItemStatus(itemId, progress, paused = false) {
    debugLog('📊 PLACEHOLDER STATUS UPDATED', {
        itemId: itemId,
        progress: progress,
        paused: paused,
        statusText: paused ? `paused (${progress}%)` : `analyzing (${progress}%)`
    });

    if (!inactiveSavesList) {
        debugLog('⚠️ PLACEHOLDER STATUS UPDATE SKIPPED', { reason: 'inactiveSavesList not available', itemId: itemId }, 'warn');
        return false;
    }

    // Find the existing saved item element by data-item-id attribute in inactive saves list
    const savedItemElement = inactiveSavesList.querySelector(`[data-item-id="${itemId}"]`);

    if (savedItemElement) {
        const statusText = savedItemElement.querySelector('.saved-item-status');
        if (statusText) {
            // Update the progress text with pause status
            if (paused) {
                statusText.textContent = `paused (${progress}%)`;
            } else {
                statusText.textContent = `analyzing (${progress}%)`;
            }
            debugLog('✅ PLACEHOLDER UI UPDATED', {
                itemId: itemId,
                elementFound: true,
                textUpdated: true
            }, 'success');
            return true;
        } else {
            debugLog('⚠️ PLACEHOLDER STATUS UPDATE SKIPPED', { reason: 'status text element not found', itemId: itemId }, 'warn');
        }
    } else {
        debugLog('⚠️ PLACEHOLDER STATUS UPDATE SKIPPED', { reason: 'saved item element not found', itemId: itemId }, 'warn');
    }

    return false;
}

// Update saved item status when pause state changes
async function updateSavedItemStatusFromPause(itemId, paused) {
    debugLog('⏸️ PLACEHOLDER PAUSE STATUS CHANGED', {
        itemId: itemId,
        paused: paused,
        action: paused ? 'paused' : 'resumed'
    });

    if (!inactiveSavesList) {
        debugLog('⚠️ PLACEHOLDER PAUSE UPDATE SKIPPED', { reason: 'inactiveSavesList not available', itemId: itemId }, 'warn');
        return;
    }

    try {
        // Update saved item in storage
        let saved = await fetchSavedAnalyses('pause-update');
        
        const placeholderIndex = saved.findIndex(item => item.id === itemId);
        if (placeholderIndex !== -1) {
            saved[placeholderIndex].paused = paused;
            debugLog('✅ PLACEHOLDER PAUSE UPDATED', {
                itemId: itemId,
                fileName: saved[placeholderIndex].fileName,
                paused: paused
            }, 'success');
        } else {
            debugLog('⚠️ PLACEHOLDER NOT FOUND FOR PAUSE UPDATE', { itemId: itemId }, 'warn');
        }

        // Also update all queued files' placeholders when pause state changes
        let queuedFilesUpdated = 0;
        saved.forEach((item, index) => {
            if (item.status === 'processing' && item.id !== itemId) {
                // Check if this item corresponds to a queued file in Home view
                const correspondingProject = state.fileProjects.find(p => p.fileName === item.fileName);
                if (correspondingProject && correspondingProject.status === 'ready' && correspondingProject.id !== state.currentProjectId) {
                    // This is a queued file - update its paused state
                    saved[index].paused = paused;
                    queuedFilesUpdated++;
                    debugLog('🔄 QUEUED PLACEHOLDER PAUSE UPDATED', {
                        itemId: item.id,
                        fileName: item.fileName,
                        paused: paused
                    });
                }
            }
        });
        
        await saveAnalysesSafe(saved);
        
        // Update saved files view if it's open - reload to show all updates
        if (viewManager.isVisible(VIEWS.SAVED_ANALYSES)) {
            await loadSavedAnalyses();
        }
    } catch (error) {
        console.error('Error updating saved item pause status:', error);
    }
}

async function loadSavedAnalyses() {
    debugLog('📂 LOADING SAVED ANALYSES', { timestamp: new Date().toISOString() });

    let saved = [];
    try {
        saved = await fetchSavedAnalyses('load-saved-analyses');
                debugLog('✅ SAVED ANALYSES LOADED', {
                    count: saved.length,
            loadSuccess: true
                }, 'success');
    } catch (error) {
        debugLog('❌ SAVED ANALYSES LOAD ERROR', { error: error.message }, 'error');
        console.error('Error loading saved analyses:', error);
    }
    
    // Migrate date fields: convert old `date` field to `dateCreated` and `dateEdited` if needed
    let needsDateMigration = false;
    let migratedCount = 0;
    let needsFolderMigration = false;
    let folderMigratedCount = 0;
    saved = saved.map(item => {
        // If item has old `date` field but no `dateCreated` or `dateEdited`, migrate it
        if (item.date && (!item.dateCreated || !item.dateEdited)) {
            needsDateMigration = true;
            migratedCount++;
            const migratedItem = {
                ...item,
                dateCreated: item.dateCreated || item.date,
                dateEdited: item.dateEdited || item.date
            };
            debugLog('🔄 MIGRATED DATE FIELDS', {
                itemId: item.id,
                fileName: item.fileName,
                hadDate: !!item.date,
                hadDateCreated: !!item.dateCreated,
                hadDateEdited: !!item.dateEdited
            });
            return migratedItem;
        }
        // Ensure dateCreated and dateEdited exist (fallback to current date if missing)
        if (!item.dateCreated || !item.dateEdited) {
            needsDateMigration = true;
            migratedCount++;
            const now = new Date().toISOString();
            const migratedItem = {
                ...item,
                dateCreated: item.dateCreated || item.date || now,
                dateEdited: item.dateEdited || item.date || now
            };
            debugLog('🔄 ADDED MISSING DATE FIELDS', {
                itemId: item.id,
                fileName: item.fileName
            });
            return migratedItem;
        }
        // Migrate folderId: add folderId: null to items without it (non-folder items only)
        if (item.type !== 'folder' && item.folderId === undefined) {
            needsFolderMigration = true;
            folderMigratedCount++;
            return {
                ...item,
                folderId: null
            };
        }
        return item;
    });
    
    // Clean up already completed files: remove status/progress fields from items that have analysis data
    let needsCleanup = false;
    let cleanedCount = 0;
    saved = saved.map(item => {
        // If item has analysis data but still has processing status, it's actually completed
        if (item.analysis && item.status === 'processing') {
            needsCleanup = true;
            cleanedCount++;
            // Create new object without status and progress fields
            const { status, progress, paused, ...cleanedItem } = item;
            debugLog('🧹 CLEANED COMPLETED ANALYSIS', {
                itemId: item.id,
                fileName: item.fileName,
                hadStatus: item.status,
                hadProgress: item.progress
            });
            return cleanedItem;
        }
        return item;
    });

    if (needsDateMigration) {
        debugLog('🔄 DATE MIGRATION COMPLETED', {
            migratedItems: migratedCount,
            totalItems: saved.length
        });
    }

    if (needsFolderMigration) {
        debugLog('🔄 FOLDER MIGRATION COMPLETED', {
            migratedItems: folderMigratedCount,
            totalItems: saved.length
        });
    }

    if (needsCleanup) {
        debugLog('🧹 SAVED ANALYSES CLEANUP COMPLETED', {
            cleanedItems: cleanedCount,
            totalItems: saved.length
        });
    }

    // Save migrated/cleaned data back to storage if needed
    if (needsDateMigration || needsFolderMigration || needsCleanup) {
        try {
            await saveAnalysesSafe(saved);
            debugLog('💾 MIGRATED/CLEANED DATA SAVED', { 
                migratedItems: migratedCount,
                folderMigratedItems: folderMigratedCount,
                cleanedItems: cleanedCount 
            }, 'success');
        } catch (error) {
            console.error('Error saving migrated/cleaned analyses:', error);
        }
    }
    
    // Clear both lists
    if (inactiveSavesList) inactiveSavesList.innerHTML = '';
    if (activeSavesList) activeSavesList.innerHTML = '';

    if (saved.length === 0) {
        if (activeSavesList) {
            activeSavesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No saved analyses yet.</p>';
        }
        if (activeSavesHeader) activeSavesHeader.style.display = 'none';
        return;
    }

    // Separate folders, inactive (processing) items, and active (completed) items
    const folders = saved.filter(item => item.type === 'folder');
    const inactiveItems = saved.filter(item => item.status === 'processing');
    const activeItems = saved.filter(item => {
        // Skip folders
        if (item.type === 'folder') return false;
        // Must have analysis data to be considered completed
        if (!item.analysis) return false;
        // Must not have processing status
        if (item.status === 'processing') return false;
        // Must have fileName
        if (!item.fileName) return false;
        return true;
    });
    
    // Apply folder filter if active
    let filteredActive = activeItems;
    if (currentFolderFilter !== null) {
        filteredActive = activeItems.filter(item => item.folderId === currentFolderFilter);
    }
    
    // Helper function to get date for sorting/comparison (prioritize dateEdited, fallback to dateCreated, then date)
    const getDateForItem = (item) => {
        return item.dateEdited || item.dateCreated || item.date || new Date().toISOString();
    };
    
    // For active items: filter duplicates - keep only the latest version of each fileName
    const fileMap = new Map();
    activeItems.forEach(item => {
        const fileName = item.fileName;
        if (!fileName) return; // Skip items without fileName
        
        const itemDate = new Date(getDateForItem(item));
        
        if (!fileMap.has(fileName)) {
            fileMap.set(fileName, item);
        } else {
            const existing = fileMap.get(fileName);
            const existingDate = new Date(getDateForItem(existing));
            
            // Prioritize items with analysis data if dates are equal or if existing has no analysis
            if (!existing.analysis && item.analysis) {
                fileMap.set(fileName, item);
            } else if (itemDate > existingDate && item.analysis) {
                fileMap.set(fileName, item);
            }
        }
    });
    
    // Convert active items map to array (will be sorted by sortActiveSaves function)
    // Note: filteredActive is already set above if folder filter is active
    if (currentFolderFilter === null) {
        filteredActive = Array.from(fileMap.values());
    } else {
        // Re-apply deduplication to filtered items
        const filteredMap = new Map();
        filteredActive.forEach(item => {
            const fileName = item.fileName;
            if (!fileName) return;
            
            const itemDate = new Date(getDateForItem(item));
            
            if (!filteredMap.has(fileName)) {
                filteredMap.set(fileName, item);
            } else {
                const existing = filteredMap.get(fileName);
                const existingDate = new Date(getDateForItem(existing));
                
                if (!existing.analysis && item.analysis) {
                    filteredMap.set(fileName, item);
                } else if (itemDate > existingDate && item.analysis) {
                    filteredMap.set(fileName, item);
                }
            }
        });
        filteredActive = Array.from(filteredMap.values());
    }
    
    // Sort inactive items by date (newest first)
    const sortedInactive = inactiveItems.sort((a, b) => {
        return new Date(getDateForItem(b)) - new Date(getDateForItem(a));
    });
    
    // Render inactive saves
    renderInactiveSaves(sortedInactive);
    
    // Render folder breadcrumb
    renderFolderBreadcrumb();
    
    // Show/hide header and render active saves
    debugLog('📊 ACTIVE SAVES FILTERING', {
        totalSaved: saved.length,
        foldersCount: folders.length,
        inactiveCount: inactiveItems.length,
        activeBeforeDedup: activeItems.length,
        activeAfterDedup: filteredActive.length,
        activeWithAnalysis: activeItems.filter(i => i.analysis).length,
        currentFolderFilter: currentFolderFilter
    });
    
    if (filteredActive.length > 0 || folders.length > 0) {
        if (activeSavesHeader) activeSavesHeader.style.display = savedViewMode === 'list' ? 'block' : 'none';
        // Update view display before rendering
        updateViewToggleButtons();
        if (savedViewMode === 'card') {
            await renderActiveSavesAsCards(filteredActive, folders);
        } else {
            renderActiveSaves(filteredActive, folders);
        }
    } else {
        if (activeSavesHeader) activeSavesHeader.style.display = 'none';
        if (activeSavesList) {
            activeSavesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No completed analyses yet.</p>';
        }
        if (activeSavesCards) {
            activeSavesCards.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No completed analyses yet.</p>';
        }
        
        // Log why no items are showing
        const itemsWithAnalysis = saved.filter(i => i.analysis && i.status !== 'processing');
        debugLog('⚠️ NO ACTIVE SAVES DISPLAYED', {
            itemsWithAnalysis: itemsWithAnalysis.length,
            itemsWithoutStatus: saved.filter(i => !i.status && i.analysis).length,
            allSavedCount: saved.length
        }, 'warn');
    }
    
    // Setup sorting handlers (only for list view)
    if (savedViewMode === 'list') {
        setupSorting();
    }
    
    // Update view toggle buttons
    updateViewToggleButtons();
    
    return; // Exit early - rendering is done in separate functions
}

// Helper function to render folder breadcrumb
function renderFolderBreadcrumb() {
    if (!folderBreadcrumb) return;
    
    if (currentFolderFilter === null) {
        folderBreadcrumb.style.display = 'none';
        return;
    }
    
    // Get folder name
    (async () => {
        const saved = await fetchSavedAnalyses('breadcrumb');
        const folder = saved.find(item => item.type === 'folder' && item.id === currentFolderFilter);
        
        if (!folder) {
            // Folder not found, reset filter
            currentFolderFilter = null;
            folderBreadcrumb.style.display = 'none';
            await loadSavedAnalyses();
            return;
        }
        
        folderBreadcrumb.style.display = 'flex';
        folderBreadcrumb.innerHTML = `
            <button class="folder-breadcrumb-back" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                <span>All Files</span>
            </button>
            <span class="folder-breadcrumb-separator">/</span>
            <span class="folder-breadcrumb-folder">${escapeHtml(folder.folderName)}</span>
        `;
        
        // Add back button handler
        const backBtn = folderBreadcrumb.querySelector('.folder-breadcrumb-back');
        if (backBtn) {
            backBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                currentFolderFilter = null;
                await loadSavedAnalyses();
            });
        }
    })();
}

// Helper function to render inactive saves (processing/paused/queued)
function renderInactiveSaves(inactiveItems) {
    if (!inactiveSavesList) return;
    
    inactiveSavesList.innerHTML = '';
    
    if (inactiveItems.length === 0) {
        if (inactiveSavesSection) inactiveSavesSection.style.display = 'none';
        return;
    }
    
    if (inactiveSavesSection) inactiveSavesSection.style.display = 'block';
    
    inactiveItems.forEach(item => {
        const savedItem = document.createElement('div');
        savedItem.className = 'saved-item saved-item-inactive';
        savedItem.setAttribute('data-item-id', String(item.id));
        
            const progress = item.progress || 0;
            const paused = item.paused || false;
            
            // Check if this item corresponds to a queued file in the Home view
            let isQueuedInHome = false;
            if (state.isAnalyzing) {
                const correspondingProject = state.fileProjects.find(p => p.fileName === item.fileName);
                if (correspondingProject && correspondingProject.status === 'ready' && correspondingProject.id !== state.currentProjectId) {
                    isQueuedInHome = true;
                }
            }
            
            // Determine status text: paused (queued) > paused (analyzing) > queued > analyzing
            let processingStatusText;
            if (isQueuedInHome && state.isPaused) {
                processingStatusText = 'paused';
            } else if (isQueuedInHome) {
                processingStatusText = 'queued';
            } else if (paused) {
                processingStatusText = `paused (${progress}%)`;
            } else {
                processingStatusText = `analyzing (${progress}%)`;
            }
            
        // Format: File Name / Created(Status) / Last Studied(-)
        // Per spec: Created shows status instead of date
            savedItem.innerHTML = `
                <div class="saved-item-content-wrapper">
                    <div class="saved-item-content">
                        <div class="saved-item-top-row">
                            <span class="saved-item-name">${escapeHtml(item.fileName)}</span>
                        <span class="saved-item-date-created">${processingStatusText}</span>
                        <span class="saved-item-date-edited">-</span>
                        </div>
                    </div>
                </div>
            `;
        
        inactiveSavesList.appendChild(savedItem);
    });
}

// Helper function to render active saves (completed)
function renderActiveSaves(activeItems, folders = []) {
    if (!activeSavesList) return;
    
    activeSavesList.innerHTML = '';
    
    // Render folders first (only if not filtering by folder)
    if (currentFolderFilter === null) {
        const sortedFolders = [...folders].sort((a, b) => {
            return a.folderName.localeCompare(b.folderName);
        });
        
        sortedFolders.forEach(folder => {
            const folderItem = document.createElement('div');
            folderItem.className = 'saved-item saved-item-folder';
            folderItem.setAttribute('data-item-id', String(folder.id));
            folderItem.setAttribute('data-folder-id', String(folder.id));
            folderItem.setAttribute('draggable', 'false');
            
            folderItem.innerHTML = `
                <div class="saved-item-content-wrapper">
                    <div class="saved-item-content">
                        <div class="saved-item-top-row">
                            <svg class="folder-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span class="saved-item-name folder-name">${escapeHtml(folder.folderName)}</span>
                            <span class="saved-item-date-edited"></span>
                            <span class="saved-item-date-created"></span>
                        </div>
                    </div>
                </div>
            `;
            
            // Add click handler to filter by folder
            folderItem.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!isEditMode) {
                    currentFolderFilter = folder.id;
                    await loadSavedAnalyses();
                }
            });
            
            // Add right-click handler for context menu
            folderItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, folder);
            });
            
            // Add drag-and-drop handlers for folders (drop targets)
            folderItem.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                folderItem.classList.add('drag-over');
            });
            
            folderItem.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                folderItem.classList.remove('drag-over');
            });
            
            folderItem.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                folderItem.classList.remove('drag-over');
                
                const fileId = e.dataTransfer.getData('text/plain');
                if (fileId) {
                    await assignFileToFolder(fileId, folder.id);
                }
            });
            
            activeSavesList.appendChild(folderItem);
        });
    }
    
    // Sort active items based on current sort settings
    const sorted = sortActiveSaves(activeItems);
    
    sorted.forEach(item => {
        // Validate analysis data before rendering
        if (item.analysis) {
            const validation = validateAnalysisData(item.analysis);
            if (!validation.valid) {
                debugLog('⚠️ SKIPPING INVALID ANALYSIS IN RENDER', {
                    itemId: item.id,
                    fileName: item.fileName,
                    error: validation.error
                }, 'warn');
                // Skip rendering invalid items
                return;
            }
        }
        
        const savedItem = document.createElement('div');
        savedItem.className = 'saved-item saved-item-active';
        savedItem.setAttribute('data-item-id', String(item.id));
        savedItem.setAttribute('draggable', 'true');
        
        // Format dates
        const dateEdited = item.dateEdited || item.dateCreated || item.date || new Date().toISOString();
        const dateCreated = item.dateCreated || item.dateEdited || item.date || new Date().toISOString();
        const dateEditedObj = new Date(dateEdited);
        const dateCreatedObj = new Date(dateCreated);
        const dateEditedStr = dateEditedObj.toLocaleDateString() + ' ' + dateEditedObj.toLocaleTimeString();
        const dateCreatedStr = dateCreatedObj.toLocaleDateString() + ' ' + dateCreatedObj.toLocaleTimeString();
        
        // Add checkbox if in edit mode
        const checkboxHtml = isEditMode ? 
            `<input type="checkbox" class="saved-item-checkbox" data-item-id="${escapeHtml(item.id)}">` : '';
        
        // Format: File Name / Last Studied / Created
            savedItem.innerHTML = `
                <div class="saved-item-content-wrapper">
                    ${checkboxHtml}
                    <div class="saved-item-content">
                        <div class="saved-item-top-row">
                            <button class="favorite-star-btn ${item.isFavorite ? 'favorite-active' : ''}" data-item-id="${escapeHtml(item.id)}" title="${item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}" type="button">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="${item.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
                                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                                </svg>
                            </button>
                            <span class="saved-item-name">
                                ${escapeHtml(item.fileName)}
                                <button class="saved-item-edit-btn" data-item-id="${escapeHtml(item.id)}" title="Edit File" type="button">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                    </svg>
                                </button>
                            </span>
                        <span class="saved-item-date-edited">${dateEditedStr}</span>
                        <span class="saved-item-date-created">${dateCreatedStr}</span>
                        </div>
                    </div>
                </div>
            `;
            
        // Add click handler for name span - just open analysis
        const nameSpan = savedItem.querySelector('.saved-item-name');
        if (nameSpan) {
            nameSpan.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent savedItem click handler from firing
                if (!isEditMode) {
                    reopenAnalysis(item);
                }
            });
        }
        
        // Add click handler - only if not in edit mode
        if (!isEditMode) {
            savedItem.addEventListener('click', async (e) => {
                // Exclude clicks on name span, favorite button, and edit button (handled separately)
                if (e.target.classList.contains('saved-item-name') ||
                    e.target.closest('.favorite-star-btn') ||
                    e.target.closest('.saved-item-edit-btn')) {
                    return;
                }
                await reopenAnalysis(item);
            });
        } else {
            const checkbox = savedItem.querySelector('.saved-item-checkbox');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => e.stopPropagation());
            }
            savedItem.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox' && 
                    !e.target.classList.contains('saved-item-name') &&
                    !e.target.closest('.favorite-star-btn') &&
                    !e.target.closest('.saved-item-edit-btn')) {
                    const checkbox = savedItem.querySelector('.saved-item-checkbox');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                    }
                }
            });
        }
        
        // Add drag-and-drop handlers
        savedItem.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
            savedItem.classList.add('dragging');
        });
        
        savedItem.addEventListener('dragend', (e) => {
            savedItem.classList.remove('dragging');
            // Remove drag-over class from all folders
            document.querySelectorAll('.saved-item-folder').forEach(f => {
                f.classList.remove('drag-over');
            });
        });
        
        // Add right-click handler for context menu
        savedItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, item);
        });
        
        // Add favorite star button click handler
        const favoriteBtn = savedItem.querySelector('.favorite-star-btn');
        if (favoriteBtn) {
            favoriteBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent triggering the item click
                const itemId = favoriteBtn.dataset.itemId;
                
                try {
                    // Load saved analyses
                    let saved = await fetchSavedAnalyses('toggle-favorite');
                    
                    // Find and update the item
                    const savedItem = saved.find(s => String(s.id) === String(itemId));
                    if (savedItem) {
                        savedItem.isFavorite = !savedItem.isFavorite;
                        
                        // Save back
                        await saveAnalysesSafe(saved);
                            // Reload to update the view
                            await loadSavedAnalyses();
                    }
                } catch (error) {
                    console.error('Error toggling favorite:', error);
                }
            });
        }
        
        // Add edit button click handler
        const editBtn = savedItem.querySelector('.saved-item-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async (e) => {
                e.stopPropagation(); // Prevent triggering the item click
                const itemId = editBtn.dataset.itemId;
                const saved = await fetchSavedAnalyses('edit-item');
                const targetItem = saved.find(s => String(s.id) === String(itemId));
                if (targetItem) {
                    await showRenameUploadModal(targetItem);
                }
            });
        }
        
        activeSavesList.appendChild(savedItem);
    });
}

// Show rename/upload modal
async function showRenameUploadModal(item) {
    return new Promise((resolve) => {
        const renameUploadModal = document.getElementById('renameUploadModal');
        const renameUploadInput = document.getElementById('renameUploadInput');
        const imageUploadInput = document.getElementById('imageUploadInput');
        const imageUploadBtn = document.getElementById('imageUploadBtn');
        const imageRemoveBtn = document.getElementById('imageRemoveBtn');
        const imageDeleteBtn = document.getElementById('imageDeleteBtn');
        const imagePreview = document.getElementById('imagePreview');
        const imagePreviewPlaceholder = document.getElementById('imagePreviewPlaceholder');
        const renameUploadCancel = document.getElementById('renameUploadCancel');
        const renameUploadSave = document.getElementById('renameUploadSave');
        
        if (!renameUploadModal || !renameUploadInput || !imageUploadInput || 
            !imageUploadBtn || !imageRemoveBtn || !imageDeleteBtn || !imagePreview || 
            !imagePreviewPlaceholder || !renameUploadCancel || !renameUploadSave) {
            console.error('Rename/Upload modal elements not found');
            resolve();
            return;
        }
        
        // Set initial values
        renameUploadInput.value = item.fileName || '';
        let selectedImageFile = null;
        let imagePreviewUrl = null;
        
        // Load current thumbnail if exists
        const loadCurrentThumbnail = async () => {
            if (item.thumbnailPath) {
                try {
                    const result = await electronBridge.getThumbnailPath(item.id);
                    if (result.success && result.exists) {
                        const isWindows = navigator.platform.toLowerCase().includes('win');
                        const fileUrl = isWindows 
                            ? `file:///${result.path.replace(/\\/g, '/')}`
                            : `file://${result.path}`;
                        imagePreview.src = fileUrl;
                        imagePreview.style.display = 'block';
                        imagePreviewPlaceholder.style.display = 'none';
                        imageRemoveBtn.style.display = 'block';
                        imagePreviewUrl = fileUrl;
                        // Update delete button visibility after image loads
                        requestAnimationFrame(() => {
                            const currentDeleteBtn = document.getElementById('imageDeleteBtn');
                            if (currentDeleteBtn) {
                                currentDeleteBtn.style.display = 'flex';
                            }
                        });
                    } else {
                        imagePreview.style.display = 'none';
                        imagePreviewPlaceholder.style.display = 'flex';
                        imageRemoveBtn.style.display = 'none';
                    }
                } catch (error) {
                    console.error('Error loading thumbnail:', error);
                    imagePreview.style.display = 'none';
                    imagePreviewPlaceholder.style.display = 'flex';
                    imageRemoveBtn.style.display = 'none';
                }
            } else {
                imagePreview.style.display = 'none';
                imagePreviewPlaceholder.style.display = 'flex';
                imageRemoveBtn.style.display = 'none';
            }
        };
        
        loadCurrentThumbnail();
        
        // Image file input change handler
        const handleImageFileChange = (e) => {
            const file = e.target.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) {
                    showWarningModal('Please select an image file.');
                    return;
                }
                selectedImageFile = file;
                const reader = new FileReader();
                reader.onload = (event) => {
                    imagePreviewUrl = event.target.result;
                    
                    // Get current preview elements (may have been cloned)
                    const currentPreview = document.getElementById('imagePreview');
                    const currentPlaceholder = document.getElementById('imagePreviewPlaceholder');
                    
                    if (currentPreview && currentPlaceholder) {
                        currentPreview.src = imagePreviewUrl;
                        currentPreview.style.display = 'block';
                        currentPlaceholder.style.display = 'none';
                        
                        // Set up error handler
                        currentPreview.onerror = () => {
                            currentPreview.style.display = 'none';
                            currentPlaceholder.style.display = 'flex';
                        };
                    }
                    
                    // Get the current remove button (may have been cloned)
                    const currentRemoveBtn = document.getElementById('imageRemoveBtn');
                    if (currentRemoveBtn) {
                        currentRemoveBtn.style.display = 'block';
                    }
                    // Get the current delete button (may have been cloned)
                    const currentDeleteBtn = document.getElementById('imageDeleteBtn');
                    if (currentDeleteBtn) {
                        currentDeleteBtn.style.display = 'flex';
                    }
                };
                reader.onerror = () => {
                    showWarningModal('Failed to read image file.');
                };
                reader.readAsDataURL(file);
            }
        };
        
        // Remove image handler
        const handleRemoveImage = () => {
            selectedImageFile = null;
            imagePreviewUrl = null;
            imagePreview.src = '';
            imagePreview.style.display = 'none';
            imagePreviewPlaceholder.style.display = 'flex';
            // Get the current remove button (may have been cloned)
            const currentRemoveBtn = document.getElementById('imageRemoveBtn');
            if (currentRemoveBtn) {
                currentRemoveBtn.style.display = 'none';
            }
            const currentDeleteBtn = document.getElementById('imageDeleteBtn');
            if (currentDeleteBtn) {
                currentDeleteBtn.style.display = 'none';
            }
            // Get the current input (may have been cloned)
            const currentInput = document.getElementById('imageUploadInput');
            if (currentInput) {
                currentInput.value = '';
            }
        };
        
        // Delete image handler (same as remove, but triggered by X button)
        const handleDeleteImage = () => {
            handleRemoveImage();
        };
        
        // Cancel handler
        const handleCancel = () => {
            renameUploadModal.style.display = 'none';
            document.removeEventListener('keydown', handleEscape);
            // Clean up preview URL if it was created from file
            if (imagePreviewUrl && imagePreviewUrl.startsWith('data:')) {
                URL.revokeObjectURL(imagePreviewUrl);
            }
            resolve();
        };
        
        // Save handler
        const handleSave = async () => {
            const newName = renameUploadInput.value.trim();
            
            if (!newName) {
                await showWarningModal('File name cannot be empty.');
                return;
            }
            
            // Validate filename
            const validationResult = validateFileName(newName);
            if (!validationResult.valid) {
                await showWarningModal(validationResult.error);
                return;
            }
            
            const sanitizedName = validationResult.sanitized;
            
            try {
                // Load saved analyses
                let saved = await fetchSavedAnalyses('save-rename-upload');
                const index = saved.findIndex(s => String(s.id) === String(item.id));
                
                if (index === -1) {
                    await showWarningModal('Analysis not found.');
                    return;
                }
                
                // Update file name
                if (sanitizedName !== item.fileName) {
                    saved[index].fileName = sanitizedName;
                    saved[index].dateEdited = new Date().toISOString();
                }
                
                // Handle image upload
                if (selectedImageFile) {
                    // Convert file to base64
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                        const imageData = event.target.result;
                        const result = await electronBridge.savePreviewImage(item.id, imageData);
                        if (result.success) {
                            saved[index].thumbnailPath = result.path;
                            await saveAnalysesSafe(saved);
                            
                            // Small delay to ensure file is fully written and accessible
                            await new Promise(resolve => setTimeout(resolve, 100));
                            
                            // Update preview to show saved file immediately
                            try {
                                const thumbnailResult = await electronBridge.getThumbnailPath(item.id);
                                if (thumbnailResult.success && thumbnailResult.exists) {
                                    const isWindows = navigator.platform.toLowerCase().includes('win');
                                    const fileUrl = isWindows 
                                        ? `file:///${thumbnailResult.path.replace(/\\/g, '/')}`
                                        : `file://${thumbnailResult.path}`;
                                    // Add cache busting to force reload
                                    const cacheBustUrl = `${fileUrl}?t=${Date.now()}`;
                                    
                                    // Get current preview elements (may have been cloned)
                                    const currentPreview = document.getElementById('imagePreview');
                                    const currentPlaceholder = document.getElementById('imagePreviewPlaceholder');
                                    
                                    if (currentPreview && currentPlaceholder) {
                                        // Set up error handler in case image fails to load
                                        const handleImageError = () => {
                                            currentPreview.style.display = 'none';
                                            currentPlaceholder.style.display = 'flex';
                                        };
                                        
                                        // Remove old error handler if exists
                                        currentPreview.onerror = null;
                                        currentPreview.onload = null;
                                        
                                        // Set new error handler
                                        currentPreview.onerror = handleImageError;
                                        
                                        // Set image source
                                        currentPreview.src = cacheBustUrl;
                                        currentPreview.style.display = 'block';
                                        currentPlaceholder.style.display = 'none';
                                        imagePreviewUrl = fileUrl;
                                    }
                                }
                            } catch (error) {
                                console.error('Error updating preview after save:', error);
                            }
                            
                            // Revoke data URL if it was used
                            if (imagePreviewUrl && imagePreviewUrl.startsWith('data:')) {
                                URL.revokeObjectURL(imagePreviewUrl);
                            }
                            
                            // Reload saved analyses to update the list
                            await loadSavedAnalyses();
                            
                            renameUploadModal.style.display = 'none';
                            document.removeEventListener('keydown', handleEscape);
                            await showWarningModal('File updated successfully!');
                            resolve();
                        } else {
                            await showWarningModal('Failed to save image: ' + result.error);
                        }
                    };
                    reader.onerror = async () => {
                        await showWarningModal('Failed to read image file.');
                    };
                    reader.readAsDataURL(selectedImageFile);
                } else if (imagePreviewUrl === null) {
                    // Image was removed
                    saved[index].thumbnailPath = null;
                    await saveAnalysesSafe(saved);
                    await loadSavedAnalyses();
                    renameUploadModal.style.display = 'none';
                    document.removeEventListener('keydown', handleEscape);
                    await showWarningModal('File updated successfully!');
                    resolve();
                } else {
                    // Only name changed, no image change
                    await saveAnalysesSafe(saved);
                    await loadSavedAnalyses();
                    renameUploadModal.style.display = 'none';
                    document.removeEventListener('keydown', handleEscape);
                    if (imagePreviewUrl && imagePreviewUrl.startsWith('data:')) {
                        URL.revokeObjectURL(imagePreviewUrl);
                    }
                    await showWarningModal('File updated successfully!');
                    resolve();
                }
            } catch (error) {
                console.error('Error saving rename/upload:', error);
                await showWarningModal('Error updating file: ' + error.message);
            }
        };
        
        // Escape key handler
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        
        // Remove existing listeners by cloning buttons
        const newImageUploadBtn = imageUploadBtn.cloneNode(true);
        imageUploadBtn.parentNode.replaceChild(newImageUploadBtn, imageUploadBtn);
        
        const newImageRemoveBtn = imageRemoveBtn.cloneNode(true);
        imageRemoveBtn.parentNode.replaceChild(newImageRemoveBtn, imageRemoveBtn);
        
        const newImageDeleteBtn = imageDeleteBtn.cloneNode(true);
        imageDeleteBtn.parentNode.replaceChild(newImageDeleteBtn, imageDeleteBtn);
        
        const newCancelBtn = renameUploadCancel.cloneNode(true);
        renameUploadCancel.parentNode.replaceChild(newCancelBtn, renameUploadCancel);
        
        const newSaveBtn = renameUploadSave.cloneNode(true);
        renameUploadSave.parentNode.replaceChild(newSaveBtn, renameUploadSave);
        
        const newImageInput = imageUploadInput.cloneNode(true);
        imageUploadInput.parentNode.replaceChild(newImageInput, imageUploadInput);
        
        // Image upload button handler (must be defined after cloning to use newImageInput)
        const handleImageUpload = () => {
            newImageInput.click();
        };
        
        // Add event listeners
        newImageUploadBtn.addEventListener('click', handleImageUpload);
        newImageRemoveBtn.addEventListener('click', handleRemoveImage);
        newImageDeleteBtn.addEventListener('click', handleDeleteImage);
        newCancelBtn.addEventListener('click', handleCancel);
        newSaveBtn.addEventListener('click', handleSave);
        newImageInput.addEventListener('change', handleImageFileChange);
        document.addEventListener('keydown', handleEscape);
        
        // Show modal
        renameUploadModal.style.display = 'flex';
        renameUploadInput.focus();
        renameUploadInput.select();
        
        // Update delete button visibility after cloning (if image is already loaded)
        requestAnimationFrame(() => {
            const currentDeleteBtn = document.getElementById('imageDeleteBtn');
            const currentPreview = document.getElementById('imagePreview');
            if (currentDeleteBtn && currentPreview && currentPreview.style.display !== 'none' && currentPreview.src) {
                currentDeleteBtn.style.display = 'flex';
            }
        });
    });
}

// Context menu function
async function showContextMenu(event, item) {
    if (!contextMenu) return;
    
    // Hide context menu first
    hideContextMenu();
    
    const isFolder = item.type === 'folder';
    const saved = await fetchSavedAnalyses('context-menu');
    const folders = saved.filter(i => i.type === 'folder');
    
    // Build menu HTML
    let menuHtml = '';
    
    if (isFolder) {
        // Folder context menu
        menuHtml = `
            <div class="context-menu-item" data-action="rename-folder">
                <span>Rename Folder</span>
            </div>
            <div class="context-menu-item" data-action="delete-folder">
                <span>Delete Folder</span>
            </div>
        `;
    } else {
        // File context menu
        menuHtml = `
            <div class="context-menu-item" data-action="move-to-folder">
                <span>Move to Folder</span>
                <span class="context-menu-arrow">▶</span>
            </div>
            <div class="context-menu-submenu" id="folderSubmenu" style="display: none;">
                <div class="context-menu-item" data-action="move-to-none">
                    <span>No Folder</span>
                </div>
                ${folders.map(f => `
                    <div class="context-menu-item" data-action="move-to-folder-item" data-folder-id="${escapeHtml(f.id)}">
                        <span>${escapeHtml(f.folderName)}</span>
                    </div>
                `).join('')}
            </div>
            ${item.folderId ? `
                <div class="context-menu-item" data-action="remove-from-folder">
                    <span>Remove from Folder</span>
                </div>
            ` : ''}
        `;
    }
    
    // Add "New Folder" option for empty space or file menu
    if (!isFolder) {
        menuHtml += `
            <div class="context-menu-separator"></div>
            <div class="context-menu-item" data-action="new-folder">
                <span>New Folder</span>
            </div>
        `;
    }
    
    contextMenu.innerHTML = menuHtml;
    
    // Position menu
    const x = event.clientX;
    const y = event.clientY;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.style.display = 'block';
    
    // Handle menu item clicks
    contextMenu.addEventListener('click', async (e) => {
        const menuItem = e.target.closest('.context-menu-item');
        if (!menuItem) return;
        
        const action = menuItem.dataset.action;
        
        if (action === 'rename-folder') {
            hideContextMenu();
            await showRenameFolderModal(item);
        } else if (action === 'delete-folder') {
            hideContextMenu();
            await showDeleteFolderModal(item);
        } else if (action === 'move-to-folder') {
            // Show submenu
            const submenu = contextMenu.querySelector('#folderSubmenu');
            if (submenu) {
                submenu.style.display = 'block';
                // Position submenu
                const rect = contextMenu.getBoundingClientRect();
                submenu.style.left = `${rect.width}px`;
                submenu.style.top = `${menuItem.offsetTop}px`;
            }
        } else if (action === 'move-to-folder-item') {
            hideContextMenu();
            const folderId = menuItem.dataset.folderId;
            await assignFileToFolder(item.id, folderId);
        } else if (action === 'move-to-none') {
            hideContextMenu();
            await removeFileFromFolder(item.id);
        } else if (action === 'remove-from-folder') {
            hideContextMenu();
            await removeFileFromFolder(item.id);
        } else if (action === 'new-folder') {
            hideContextMenu();
            await showCreateFolderModal();
        }
    });
    
    // Hide menu when clicking outside
    const hideOnClickOutside = (e) => {
        if (!contextMenu.contains(e.target)) {
            hideContextMenu();
            document.removeEventListener('click', hideOnClickOutside);
        }
    };
    
    // Use setTimeout to avoid immediate hide
    setTimeout(() => {
        document.addEventListener('click', hideOnClickOutside);
    }, 0);
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
        contextMenu.innerHTML = '';
    }
}

// Folder modals
async function showCreateFolderModal() {
    return new Promise((resolve) => {
        const modal = document.getElementById('createFolderModal');
        const input = document.getElementById('createFolderInput');
        const cancel = document.getElementById('createFolderCancel');
        const confirm = document.getElementById('createFolderConfirm');
        
        if (!modal || !input || !cancel || !confirm) {
            console.error('Create folder modal elements not found');
            resolve();
            return;
        }
        
        input.value = '';
        
        const handleCancel = () => {
            modal.style.display = 'none';
            document.removeEventListener('keydown', handleEscape);
            resolve();
        };
        
        const handleConfirm = async () => {
            const folderName = input.value.trim();
            if (!folderName) {
                await showWarningModal('Folder name cannot be empty.');
                return;
            }
            
            const result = await createFolder(folderName);
            if (result.success) {
                modal.style.display = 'none';
                document.removeEventListener('keydown', handleEscape);
                resolve();
            } else {
                await showWarningModal(result.error || 'Failed to create folder.');
            }
        };
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        
        // Remove old listeners
        const newCancel = cancel.cloneNode(true);
        cancel.parentNode.replaceChild(newCancel, cancel);
        const newConfirm = confirm.cloneNode(true);
        confirm.parentNode.replaceChild(newConfirm, confirm);
        
        newCancel.addEventListener('click', handleCancel);
        newConfirm.addEventListener('click', handleConfirm);
        document.addEventListener('keydown', handleEscape);
        
        modal.style.display = 'flex';
        input.focus();
    });
}

async function showRenameFolderModal(folder) {
    return new Promise((resolve) => {
        const modal = document.getElementById('renameFolderModal');
        const input = document.getElementById('renameFolderInput');
        const cancel = document.getElementById('renameFolderCancel');
        const confirm = document.getElementById('renameFolderConfirm');
        
        if (!modal || !input || !cancel || !confirm) {
            console.error('Rename folder modal elements not found');
            resolve();
            return;
        }
        
        input.value = folder.folderName || '';
        
        const handleCancel = () => {
            modal.style.display = 'none';
            document.removeEventListener('keydown', handleEscape);
            resolve();
        };
        
        const handleConfirm = async () => {
            const newName = input.value.trim();
            if (!newName) {
                await showWarningModal('Folder name cannot be empty.');
                return;
            }
            
            const result = await renameFolder(folder.id, newName);
            if (result.success) {
                modal.style.display = 'none';
                document.removeEventListener('keydown', handleEscape);
                resolve();
            } else {
                await showWarningModal(result.error || 'Failed to rename folder.');
            }
        };
        
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        
        // Remove old listeners
        const newCancel = cancel.cloneNode(true);
        cancel.parentNode.replaceChild(newCancel, cancel);
        const newConfirm = confirm.cloneNode(true);
        confirm.parentNode.replaceChild(newConfirm, confirm);
        
        newCancel.addEventListener('click', handleCancel);
        newConfirm.addEventListener('click', handleConfirm);
        document.addEventListener('keydown', handleEscape);
        
        modal.style.display = 'flex';
        input.focus();
        input.select();
    });
}

async function showDeleteFolderModal(folder) {
    return new Promise((resolve) => {
        const modal = document.getElementById('deleteFolderModal');
        const message = document.getElementById('deleteFolderMessage');
        const cancel = document.getElementById('deleteFolderCancel');
        const moveOut = document.getElementById('deleteFolderMoveOut');
        const deleteAll = document.getElementById('deleteFolderDeleteAll');
        
        if (!modal || !message || !cancel || !moveOut || !deleteAll) {
            console.error('Delete folder modal elements not found');
            resolve();
            return;
        }
        
        // Get file count
        (async () => {
            const saved = await fetchSavedAnalyses('delete-folder-modal');
            const filesInFolder = saved.filter(item => 
                item.type !== 'folder' && item.folderId === folder.id
            );
            
            message.textContent = `Folder "${folder.folderName}" contains ${filesInFolder.length} file(s). What would you like to do?`;
            
            const handleCancel = () => {
                modal.style.display = 'none';
                document.removeEventListener('keydown', handleEscape);
                resolve();
            };
            
            const handleMoveOut = async () => {
                const result = await deleteFolder(folder.id, false);
                if (result.success) {
                    modal.style.display = 'none';
                    document.removeEventListener('keydown', handleEscape);
                    resolve();
                } else {
                    await showWarningModal(result.error || 'Failed to delete folder.');
                }
            };
            
            const handleDeleteAll = async () => {
                const result = await deleteFolder(folder.id, true);
                if (result.success) {
                    modal.style.display = 'none';
                    document.removeEventListener('keydown', handleEscape);
                    resolve();
                } else {
                    await showWarningModal(result.error || 'Failed to delete folder.');
                }
            };
            
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                }
            };
            
            // Remove old listeners
            const newCancel = cancel.cloneNode(true);
            cancel.parentNode.replaceChild(newCancel, cancel);
            const newMoveOut = moveOut.cloneNode(true);
            moveOut.parentNode.replaceChild(newMoveOut, moveOut);
            const newDeleteAll = deleteAll.cloneNode(true);
            deleteAll.parentNode.replaceChild(newDeleteAll, deleteAll);
            
            newCancel.addEventListener('click', handleCancel);
            newMoveOut.addEventListener('click', handleMoveOut);
            newDeleteAll.addEventListener('click', handleDeleteAll);
            document.addEventListener('keydown', handleEscape);
            
            modal.style.display = 'flex';
        })();
    });
}

// Render active saves as cards
async function renderActiveSavesAsCards(activeItems, folders = []) {
    if (!activeSavesCards) return;
    
    activeSavesCards.innerHTML = '';
    
    // Render folders first (only if not filtering by folder)
    if (currentFolderFilter === null) {
        const sortedFolders = [...folders].sort((a, b) => {
            return a.folderName.localeCompare(b.folderName);
        });
        
        for (const folder of sortedFolders) {
            const folderCard = document.createElement('div');
            folderCard.className = 'saved-card saved-card-folder';
            folderCard.setAttribute('data-item-id', String(folder.id));
            folderCard.setAttribute('data-folder-id', String(folder.id));
            folderCard.setAttribute('draggable', 'false');
            
            folderCard.innerHTML = `
                <div class="saved-card-folder-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="saved-card-content">
                    <div class="saved-card-header">
                        <div class="saved-card-name folder-name">${escapeHtml(folder.folderName)}</div>
                    </div>
                </div>
            `;
            
            // Add click handler to filter by folder
            folderCard.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!isEditMode) {
                    currentFolderFilter = folder.id;
                    await loadSavedAnalyses();
                }
            });
            
            // Add right-click handler for context menu
            folderCard.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e, folder);
            });
            
            // Add drag-and-drop handlers for folders (drop targets)
            folderCard.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                folderCard.classList.add('drag-over');
            });
            
            folderCard.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                folderCard.classList.remove('drag-over');
            });
            
            folderCard.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                folderCard.classList.remove('drag-over');
                
                const fileId = e.dataTransfer.getData('text/plain');
                if (fileId) {
                    await assignFileToFolder(fileId, folder.id);
                }
            });
            
            activeSavesCards.appendChild(folderCard);
        }
    }
    
    // Sort active items based on current sort settings
    const sorted = sortActiveSaves(activeItems);
    
    for (const item of sorted) {
        // Validate analysis data before rendering
        if (item.analysis) {
            const validation = validateAnalysisData(item.analysis);
            if (!validation.valid) {
                debugLog('⚠️ SKIPPING INVALID ANALYSIS IN CARD RENDER', {
                    itemId: item.id,
                    fileName: item.fileName,
                    error: validation.error
                }, 'warn');
                return;
            }
        }
        
        const card = document.createElement('div');
        card.className = 'saved-card';
        card.setAttribute('data-item-id', String(item.id));
        card.setAttribute('draggable', 'true');
        
        // Format dates
        const dateEdited = item.dateEdited || item.dateCreated || item.date || new Date().toISOString();
        const dateCreated = item.dateCreated || item.dateEdited || item.date || new Date().toISOString();
        const dateEditedObj = new Date(dateEdited);
        const dateCreatedObj = new Date(dateCreated);
        const dateEditedStr = dateEditedObj.toLocaleDateString() + ' ' + dateEditedObj.toLocaleTimeString();
        const dateCreatedStr = dateCreatedObj.toLocaleDateString() + ' ' + dateCreatedObj.toLocaleTimeString();
        
        // Get thumbnail path - construct file:// URL for local file
        const thumbnailPath = item.thumbnailPath;
        let thumbnailHtml = '';
        let placeholderHtml = '';
        if (thumbnailPath) {
            // Use Electron's path resolution - construct file:// URL
            // The thumbnailPath is stored as relative path like "thumbnails/{id}.png"
            // We need to resolve it to full path using Electron API
            const result = await electronBridge.getThumbnailPath(item.id);
            if (result.success && result.exists) {
                // Construct file:// URL - on Windows it needs 3 slashes, on Unix 2
                const isWindows = navigator.platform.toLowerCase().includes('win');
                const fileUrl = isWindows 
                    ? `file:///${result.path.replace(/\\/g, '/')}`
                    : `file://${result.path}`;
                // Add cache busting based on file modification time or current time
                // This ensures thumbnails update immediately when changed
                const cacheBustUrl = `${fileUrl}?t=${Date.now()}`;
                thumbnailHtml = `<img src="${cacheBustUrl}" class="saved-card-thumbnail" alt="Preview" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
                placeholderHtml = `<div class="saved-card-thumbnail-placeholder" style="display: none;">No Preview</div>`;
            } else {
                placeholderHtml = `<div class="saved-card-thumbnail-placeholder">No Preview</div>`;
            }
        } else {
            placeholderHtml = `<div class="saved-card-thumbnail-placeholder">No Preview</div>`;
        }
        
        card.innerHTML = `
            ${thumbnailHtml}
            ${placeholderHtml}
            <button class="saved-card-edit-btn" data-item-id="${escapeHtml(item.id)}" title="Edit File" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <div class="saved-card-content">
                <div class="saved-card-header">
                    <div class="saved-card-name">${escapeHtml(item.fileName)}</div>
                    <button class="saved-card-favorite ${item.isFavorite ? 'favorite-active' : ''}" data-item-id="${escapeHtml(item.id)}" title="${item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}" type="button">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="${item.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                        </svg>
                    </button>
                </div>
                <div class="saved-card-dates">
                    <div class="saved-card-date">
                        <span class="saved-card-date-label">Last Studied:</span>
                        <span class="saved-card-date-value">${dateEditedStr}</span>
                    </div>
                    <div class="saved-card-date">
                        <span class="saved-card-date-label">Created:</span>
                        <span class="saved-card-date-value">${dateCreatedStr}</span>
                    </div>
                </div>
            </div>
        `;
        
        // Add drag-and-drop handlers
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.id);
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        
        card.addEventListener('dragend', (e) => {
            card.classList.remove('dragging');
            // Remove drag-over class from all folders
            document.querySelectorAll('.saved-card-folder').forEach(f => {
                f.classList.remove('drag-over');
            });
        });
        
        // Add right-click handler for context menu
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, item);
        });
        
        // Add click handler to open analysis
        card.addEventListener('click', async (e) => {
            // Exclude clicks on favorite button and edit button
            if (e.target.closest('.saved-card-favorite') || e.target.closest('.saved-card-edit-btn')) {
                return;
            }
            await reopenAnalysis(item);
        });
        
        // Add favorite button click handler
        const favoriteBtn = card.querySelector('.saved-card-favorite');
        if (favoriteBtn) {
            favoriteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const itemId = favoriteBtn.dataset.itemId;
                
                try {
                    let saved = await fetchSavedAnalyses('toggle-favorite-card');
                    const savedItem = saved.find(s => String(s.id) === String(itemId));
                    if (savedItem) {
                        savedItem.isFavorite = !savedItem.isFavorite;
                        await saveAnalysesSafe(saved);
                        await loadSavedAnalyses();
                    }
                } catch (error) {
                    console.error('Error toggling favorite:', error);
                }
            });
        }
        
        // Add edit button click handler
        const cardEditBtn = card.querySelector('.saved-card-edit-btn');
        if (cardEditBtn) {
            cardEditBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const itemId = cardEditBtn.dataset.itemId;
                const saved = await fetchSavedAnalyses('edit-card-item');
                const targetItem = saved.find(s => String(s.id) === String(itemId));
                if (targetItem) {
                    await showRenameUploadModal(targetItem);
                }
            });
        }
        
        activeSavesCards.appendChild(card);
    }
}

// Toggle between list and card view
function toggleSavedView(mode) {
    if (mode !== 'list' && mode !== 'card') return;
    
    savedViewMode = mode;
    localStorage.setItem('savedViewMode', mode);
    
    // Update UI
    updateViewToggleButtons();
    
    // Reload to re-render in the new view
    loadSavedAnalyses();
}

// Update view toggle button states
function updateViewToggleButtons() {
    if (listViewBtn && cardViewBtn) {
        if (savedViewMode === 'list') {
            listViewBtn.classList.add('active');
            cardViewBtn.classList.remove('active');
            if (activeSavesList) {
                activeSavesList.style.display = 'flex';
            }
            if (activeSavesCards) {
                activeSavesCards.style.display = 'none';
            }
        } else {
            listViewBtn.classList.remove('active');
            cardViewBtn.classList.add('active');
            if (activeSavesList) {
                activeSavesList.style.display = 'none';
            }
            if (activeSavesCards) {
                activeSavesCards.style.display = 'grid';
            }
        }
    }
}

// Helper function to sort active saves
function sortActiveSaves(items) {
    const getDateForItem = (item) => {
        return item.dateEdited || item.dateCreated || item.date || new Date().toISOString();
    };
    
    return [...items].sort((a, b) => {
        // Favorites first
        const aFavorite = a.isFavorite === true;
        const bFavorite = b.isFavorite === true;
        if (aFavorite && !bFavorite) return -1;
        if (!aFavorite && bFavorite) return 1;
        
        // Then apply the selected sort
        let comparison = 0;
        
        if (currentSortColumn === 'fileName') {
            comparison = a.fileName.localeCompare(b.fileName);
        } else if (currentSortColumn === 'dateEdited') {
            comparison = new Date(getDateForItem(a)) - new Date(getDateForItem(b));
        } else if (currentSortColumn === 'dateCreated') {
            const dateA = new Date(a.dateCreated || a.dateEdited || a.date || new Date().toISOString());
            const dateB = new Date(b.dateCreated || b.dateEdited || b.date || new Date().toISOString());
            comparison = dateA - dateB;
        }
        
        return currentSortDirection === 'asc' ? comparison : -comparison;
    });
}

// Setup sorting handlers
function setupSorting() {
    if (!activeSavesHeader) return;
    
    const sortableColumns = activeSavesHeader.querySelectorAll('.sortable-column');
    sortableColumns.forEach(column => {
        column.addEventListener('click', () => {
            const sortColumn = column.getAttribute('data-sort');
            
            // Update sort direction if clicking same column, otherwise reset to desc
            if (sortColumn === currentSortColumn) {
                currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortColumn = sortColumn;
                currentSortDirection = 'desc';
            }
            
            // Update arrow indicators
            sortableColumns.forEach(col => {
                const arrow = col.querySelector('.sort-arrow');
                if (col.getAttribute('data-sort') === currentSortColumn) {
                    arrow.textContent = currentSortDirection === 'asc' ? '▲' : '▼';
                } else {
                    arrow.textContent = '';
                }
            });
            
            // Reload to apply sort
            loadSavedAnalyses();
        });
    });
    
    // Setup column resizing
    setupColumnResizing();
}

// Setup column resizing functionality
function setupColumnResizing() {
    const sortableHeader = document.getElementById('sortableHeader');
    if (!sortableHeader) return;
    
    const resizers = sortableHeader.querySelectorAll('.column-resizer');
    let isResizing = false;
    let currentResizer = null;
    let startX = 0;
    let startWidths = [];
    let headerRect = null;
    
    // Load saved column widths from localStorage
    const savedWidths = localStorage.getItem('savedAnalysesColumnWidths');
    if (savedWidths) {
        try {
            const widths = JSON.parse(savedWidths);
            if (Array.isArray(widths) && widths.length === 3) {
                document.documentElement.style.setProperty('--col-width-0', `${widths[0]}px`);
                document.documentElement.style.setProperty('--col-width-1', `${widths[1]}px`);
                document.documentElement.style.setProperty('--col-width-2', `${widths[2]}px`);
            }
        } catch (e) {
            console.error('Error loading saved column widths:', e);
        }
    }
    
    resizers.forEach((resizer, index) => {
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            isResizing = true;
            currentResizer = resizer;
            startX = e.clientX;
            headerRect = sortableHeader.getBoundingClientRect();
            
            // Get current column widths
            const columns = sortableHeader.querySelectorAll('.sortable-column');
            startWidths = Array.from(columns).map(col => col.getBoundingClientRect().width);
            
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentResizer) return;
        
        e.preventDefault();
        
        const deltaX = e.clientX - startX;
        const resizerIndex = parseInt(currentResizer.getAttribute('data-column'));
        
        // Get container width and calculate available space
        const containerRect = sortableHeader.getBoundingClientRect();
        const containerPadding = 32; // 16px left + 16px right
        const resizerWidth = 15; // Each resizer column is 15px
        const totalResizerWidth = 2 * resizerWidth; // Two resizers
        const availableWidth = containerRect.width - containerPadding - totalResizerWidth;
        
        // Calculate new widths
        const newWidths = [...startWidths];
        const leftColumnIndex = resizerIndex;
        const rightColumnIndex = resizerIndex + 1;
        
        // Minimum column width (100px)
        const minWidth = 100;
        
        // Adjust left and right columns
        let leftNewWidth = Math.max(minWidth, startWidths[leftColumnIndex] + deltaX);
        let rightNewWidth = Math.max(minWidth, startWidths[rightColumnIndex] - deltaX);
        
        // If resizing the last column (resizerIndex === 1), prevent exceeding container width
        if (resizerIndex === 1) {
            // Calculate total width of all columns
            const totalColumnsWidth = newWidths[0] + leftNewWidth + rightNewWidth;
            
            // If total exceeds available width, constrain the last column
            if (totalColumnsWidth > availableWidth) {
                // Constrain the right column (last column) to fit within available width
                const maxRightWidth = availableWidth - newWidths[0] - leftNewWidth;
                rightNewWidth = Math.max(minWidth, Math.min(rightNewWidth, maxRightWidth));
                
                // Recalculate left column to maintain the delta if possible
                const adjustedLeftWidth = availableWidth - newWidths[0] - rightNewWidth;
                if (adjustedLeftWidth >= minWidth) {
                    leftNewWidth = adjustedLeftWidth;
                }
            }
        }
        
        // Only update if both columns meet minimum width
        if (leftNewWidth >= minWidth && rightNewWidth >= minWidth) {
            newWidths[leftColumnIndex] = leftNewWidth;
            newWidths[rightColumnIndex] = rightNewWidth;
            
            // Verify total doesn't exceed available width
            const totalWidth = newWidths[0] + newWidths[1] + newWidths[2];
            if (totalWidth <= availableWidth) {
                // Apply new widths
                document.documentElement.style.setProperty('--col-width-0', `${newWidths[0]}px`);
                document.documentElement.style.setProperty('--col-width-1', `${newWidths[1]}px`);
                document.documentElement.style.setProperty('--col-width-2', `${newWidths[2]}px`);
            }
        }
    });
    
    // Update max-width constraints on window resize
    function updateMaxWidthConstraints() {
        const containerRect = sortableHeader.getBoundingClientRect();
        if (containerRect.width === 0) return; // Container not visible
        
        const containerPadding = 32; // 16px left + 16px right
        const resizerWidth = 15; // Each resizer column is 15px
        const totalResizerWidth = 2 * resizerWidth; // Two resizers
        const availableWidth = containerRect.width - containerPadding - totalResizerWidth;
        
        // Get current column widths
        const columns = sortableHeader.querySelectorAll('.sortable-column');
        const currentWidths = Array.from(columns).map(col => col.getBoundingClientRect().width);
        const totalCurrentWidth = currentWidths.reduce((sum, w) => sum + w, 0);
        
        // If current total exceeds available width, scale down proportionally
        if (totalCurrentWidth > availableWidth && availableWidth > 0) {
            const scaleFactor = availableWidth / totalCurrentWidth;
            const scaledWidths = currentWidths.map(w => Math.max(100, w * scaleFactor));
            const scaledTotal = scaledWidths.reduce((sum, w) => sum + w, 0);
            
            // Adjust if still exceeds (due to min-width constraint)
            if (scaledTotal > availableWidth) {
                const adjustment = availableWidth - scaledTotal;
                scaledWidths[2] = Math.max(100, scaledWidths[2] + adjustment); // Adjust last column
            }
            
            document.documentElement.style.setProperty('--col-width-0', `${scaledWidths[0]}px`);
            document.documentElement.style.setProperty('--col-width-1', `${scaledWidths[1]}px`);
            document.documentElement.style.setProperty('--col-width-2', `${scaledWidths[2]}px`);
        }
    }
    
    // Listen for window resize to update constraints
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(updateMaxWidthConstraints, 100);
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            
            if (currentResizer) {
                currentResizer.classList.remove('resizing');
            }
            
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save column widths to localStorage
            const columns = sortableHeader.querySelectorAll('.sortable-column');
            const widths = Array.from(columns).map(col => col.getBoundingClientRect().width);
            localStorage.setItem('savedAnalysesColumnWidths', JSON.stringify(widths));
            
            currentResizer = null;
        }
    });
}

async function reopenAnalysis(savedItem) {
    debugLog('🔄 REOPENING SAVED ANALYSIS', {
        itemId: savedItem.id,
        fileName: savedItem.fileName,
        date: savedItem.date,
        hasAnalysis: !!savedItem.analysis,
        translationsCount:
            (savedItem.analysis && savedItem.analysis.translations && savedItem.analysis.translations.length) ||
            0,
        expressionsCount:
            (savedItem.analysis && savedItem.analysis.expressions && savedItem.analysis.expressions.length) ||
            0,
        chatMessagesCount: (savedItem.chatHistory && savedItem.chatHistory.length) || 0,
        hasSubtitleData: !!savedItem.subtitleData
    });

    await reinitializeAPIKey();
    state.currentAnalysis = savedItem.analysis;
    state.currentChatHistory = savedItem.chatHistory || [];
    state.currentSubtitleData = savedItem.subtitleData;
    
    // Apply deduplication to saved analysis (in case it was saved before deduplication was added)
    if (state.currentAnalysis && state.currentAnalysis.translations && state.currentAnalysis.translations.length > 0) {
        const translationsMap = new Map();
        
        state.currentAnalysis.translations.forEach(trans => {
            if (trans.swedish) {
                const fixedSwedish = fixEncoding(trans.swedish.trim());
                const normalizedKey = normalizeTextForMatching(fixedSwedish);
                
                // Only add if not already present, preferring entries with actual translations over placeholders
                if (!translationsMap.has(normalizedKey)) {
                    translationsMap.set(normalizedKey, trans);
                } else {
                    const existing = translationsMap.get(normalizedKey);
                    // Replace placeholder with actual translation if we have one
                    if (existing.literal && existing.literal.startsWith('[Translation needed:')) {
                        if (trans.literal && !trans.literal.startsWith('[Translation needed:')) {
                            translationsMap.set(normalizedKey, trans);
                        }
                    }
                }
            }
        });
        
        const duplicatesRemoved = state.currentAnalysis.translations.length - translationsMap.size;
        state.currentAnalysis.translations = Array.from(translationsMap.values());
        
        if (duplicatesRemoved > 0) {
            console.log(`Deduplication applied to saved analysis: ${state.currentAnalysis.translations.length} unique translations (removed ${duplicatesRemoved} duplicates)`);
        }
    }
    
    // Reset pagination to first page when reopening saved analysis
    currentPage = 1;
    
    fileName.textContent = savedItem.fileName;
    scriptName.textContent = savedItem.fileName;
    fileInfo.style.display = 'flex';
    
    displayAnalysis(state.currentAnalysis);
    
    // Chat messages are only restored in study modal, not in main view
    // Chat history is preserved but not displayed in main view
    
    // Show views (no chat or expressions in main view)
    savedAnalysesView.style.display = 'none';
    viewManager.showResults();
    // Hide expressions section
    if (expressionsContent && expressionsContent.parentElement) {
        expressionsContent.parentElement.style.display = 'none';
    }
    
    // Exit edit mode when reopening
    isEditMode = false;
    if (editSavedBtn) {
        updateEditButton();
    }
}

    // Settings
    settingsBtn.addEventListener('click', async () => {
        console.log('Settings button clicked');
        try {
            const result = await electronBridge.loadApiKey();
                if (result.success && result.key) {
                    // Show partially masked key
                const masked =
                    result.key.substring(0, 7) + '...' + result.key.substring(result.key.length - 4);
                    apiKeyInput.value = masked;
                    apiKeyInput.type = 'text';
            } else {
                apiKeyInput.value = '';
                apiKeyInput.type = 'password';
            }
        } catch (error) {
            console.error('Error loading API key:', error);
            apiKeyInput.value = '';
            apiKeyInput.type = 'password';
        }
        
        viewManager.showSettings();
    });

    closeSettingsBtn.addEventListener('click', () => {
        viewManager.hide(VIEWS.SETTINGS);
        if (state.currentAnalysis) {
            // If analysis completed while in settings, ensure it's displayed
            displayAnalysis(state.currentAnalysis);
            viewManager.showResults();
            // Hide expressions section
            if (expressionsContent && expressionsContent.parentElement) {
                expressionsContent.parentElement.style.display = 'none';
            }
        } else {
            viewManager.showHome();
        }
    });

    // Debug Console
    if (debugBtn) {
        debugBtn.addEventListener('click', () => {
            const isVisible = debugConsole.style.display !== 'none';
            debugConsole.style.display = isVisible ? 'none' : 'flex';
            debugLog('🐛 DEBUG CONSOLE TOGGLED', {
                visible: !isVisible,
                action: isVisible ? 'hidden' : 'shown'
            });
        });
    }

    if (clearDebugBtn) {
        clearDebugBtn.addEventListener('click', () => {
            const debugMessages = document.getElementById('debugMessages');
            if (debugMessages) {
                debugMessages.innerHTML = '';
                debugLog('🧹 DEBUG MESSAGES CLEARED', { action: 'manual_clear' });
            }
        });
    }

    if (closeDebugBtn) {
        closeDebugBtn.addEventListener('click', () => {
            debugConsole.style.display = 'none';
            debugLog('❌ DEBUG CONSOLE CLOSED', { action: 'user_closed' });
        });
    }

    saveApiKeyBtn.addEventListener('click', async () => {
        const newApiKey = apiKeyInput.value.trim();
        
        if (!newApiKey) {
            await showWarningModal('Please enter an API key.');
            return;
        }
        
        // If it's a masked key, don't save it
        if (newApiKey.includes('...')) {
            await showWarningModal('Please enter a new API key to update. The displayed key is masked for security.');
            return;
        }
        
        // Validate API key format
        const validation = validateApiKey(newApiKey);
        if (!validation.valid) {
            await showWarningModal(validation.error);
            return;
        }
        
        try {
            const result = await electronBridge.saveApiKey(newApiKey);
                if (result.success) {
                state.apiKey = newApiKey; // Update local variable
                await showWarningModal('API key saved successfully!');
                    apiKeyInput.type = 'password';
                    apiKeyInput.value = '';
                } else {
                await showWarningModal('Error saving API key: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error saving API key:', error);
            await showWarningModal('Error saving API key: ' + error.message);
        }
    });
    
    // Theme selector
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            const selectedTheme = e.target.value;
            applyTheme(selectedTheme);
        });
    }

    // Study modal functionality
    closeStudyBtn.addEventListener('click', closeStudyModal);
    
    studyChatSendBtn.addEventListener('click', sendStudyChatMessage);
    studyChatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendStudyChatMessage();
        }
    });

    // Study history button
    studyHistoryBtn.addEventListener('click', () => {
        showChatHistory(currentStudyChatHistory, markdownToHtml);
    });

    // Save study session button
    if (saveStudyBtn) {
        saveStudyBtn.addEventListener('click', async () => {
            await saveStudySession();
        });
    }

    // Navigation buttons for line-by-line study
    if (studyPrevBtn) {
        studyPrevBtn.addEventListener('click', navigateToPreviousLine);
    }
    if (studyNextBtn) {
        studyNextBtn.addEventListener('click', navigateToNextLine);
    }

    // Close modal when clicking outside
    studyModal.addEventListener('click', (e) => {
        if (e.target === studyModal) {
            closeStudyModal();
        }
    });

    // Chat history modal
    closeHistoryBtn.addEventListener('click', () => {
        chatHistoryModal.style.display = 'none';
    });

    chatHistoryModal.addEventListener('click', (e) => {
        if (e.target === chatHistoryModal) {
            chatHistoryModal.style.display = 'none';
        }
    });
    
    // Note: Modal event listeners for renameModal and warningModal are handled 
    // within the showRenameModal() and showWarningModal() functions themselves
    // to avoid conflicts with promise-based handlers
    
    // Setup study modal resizers
    setupStudyModalResizers();
}); // End of DOMContentLoaded

// Setup translation accordions
function setupTranslationAccordions() {
    const accordionButtons = document.querySelectorAll('.accordion-btn');
    accordionButtons.forEach(button => {
        button.addEventListener('click', () => {
            const type = button.getAttribute('data-type');
            const accordion = document.querySelector(`.translation-accordion[data-type="${type}"]`);
            if (!accordion) return;
            
            const studyExpressionsSection = document.getElementById('studyExpressionsSection');
            const studyItemDisplay = document.querySelector('.study-item-display');
            const resizer = document.querySelector('.study-resizer[data-resizer="expressions-chat"]');
            const studyChatMessages = document.getElementById('studyChatMessages');
            
            if (!studyExpressionsSection || !studyItemDisplay || !resizer) return;
            
            const isExpanded = accordion.classList.contains('expanded');
            
            // Store current divider position (top of resizer in viewport) - this must never change except during manual drag
            const currentDividerTop = resizer.getBoundingClientRect().top;
            
            // Store current expressions section height
            const currentExpressionsHeight = studyExpressionsSection.getBoundingClientRect().height;
            
            // Store current chat messages height if it has a fixed height
            const currentChatMessagesHeight = studyChatMessages ? studyChatMessages.getBoundingClientRect().height : null;
            
            // Temporarily disable transitions to measure actual study-item-display height change
            const accordionTransition = accordion.style.transition;
            const expressionsTransition = studyExpressionsSection.style.transition;
            const chatMessagesTransition = studyChatMessages ? studyChatMessages.style.transition : '';
            accordion.style.transition = 'none';
            studyExpressionsSection.style.transition = 'none';
            if (studyChatMessages) {
                studyChatMessages.style.transition = 'none';
            }
            
            // Measure current study-item-display height (this includes the accordion)
            const currentItemDisplayHeight = studyItemDisplay.getBoundingClientRect().height;
            
            // Toggle accordion state to measure new height
            if (isExpanded) {
                accordion.classList.remove('expanded');
                button.classList.remove('expanded');
            } else {
                accordion.classList.add('expanded');
                button.classList.add('expanded');
            }
            
            // Force reflow to get new height
            void studyItemDisplay.offsetHeight;
            
            // Measure new study-item-display height
            const newItemDisplayHeight = studyItemDisplay.getBoundingClientRect().height;
            
            // Calculate actual study-item-display height change (round to ensure pixel-perfect precision)
            const itemDisplayHeightChange = Math.round(newItemDisplayHeight - currentItemDisplayHeight);
            
            // Restore accordion to original state
            if (isExpanded) {
                accordion.classList.add('expanded');
                button.classList.add('expanded');
            } else {
                accordion.classList.remove('expanded');
                button.classList.remove('expanded');
            }
            
            // Restore transitions
            accordion.style.transition = accordionTransition;
            studyExpressionsSection.style.transition = expressionsTransition;
            if (studyChatMessages) {
                studyChatMessages.style.transition = chatMessagesTransition || 'height 0.3s ease';
            }
            
            // To keep divider at fixed position, expressions section must shrink/grow by exactly the study-item-display height change
            // Use Math.round to ensure pixel-perfect calculations
            const minExpressionsHeight = 100;
            const newExpressionsHeight = Math.max(
                minExpressionsHeight,
                Math.round(currentExpressionsHeight - itemDisplayHeightChange)
            );
            
            // Apply both changes synchronously in the same block to ensure perfect synchronization
            // Set expressions height first
            studyExpressionsSection.style.height = `${newExpressionsHeight}px`;
            
            // If chat messages has a fixed height, adjust it to maintain divider position
            // When expressions section shrinks by X, chat messages should grow by X (if it has fixed height)
            if (studyChatMessages && currentChatMessagesHeight !== null) {
                const chatMessagesHeightStyle = studyChatMessages.style.height;
                if (chatMessagesHeightStyle && chatMessagesHeightStyle !== 'auto') {
                    const currentChatHeight = parseFloat(chatMessagesHeightStyle) || currentChatMessagesHeight;
                    const newChatMessagesHeight = Math.max(50, Math.round(currentChatHeight + itemDisplayHeightChange));
                    studyChatMessages.style.height = `${newChatMessagesHeight}px`;
                    studyChatMessages.style.flex = '0 0 auto'; // Prevent flex from overriding height
                }
            }
            
            // Immediately toggle accordion state in the same synchronous block
            // Both will animate together with same timing (0.3s ease)
            if (isExpanded) {
                accordion.classList.remove('expanded');
                button.classList.remove('expanded');
            } else {
                accordion.classList.add('expanded');
                button.classList.add('expanded');
            }

            lockStudyResizerTemporarily();
            
            // Save height to localStorage after animation completes
            accordion.addEventListener('transitionend', () => {
                localStorage.setItem('studyExpressionsHeight', newExpressionsHeight);
                updateStudyItemBorder();
            }, { once: true });
            
            // Also update immediately for instant feedback
            requestAnimationFrame(() => {
                updateStudyItemBorder();
            });
        });
    });
}

// Update border position based on study-item-display content
function updateStudyItemBorder() {
    const studyItemDisplay = document.querySelector('.study-item-display');
    const border = document.querySelector('.study-item-border');
    if (studyItemDisplay && border) {
        // Border is already positioned correctly in flex layout,
        // but we ensure it's visible and properly styled
        // The flex layout will automatically position it after study-item-display
    }
}

function lockStudyResizerTemporarily(duration = STUDY_RESIZER_LOCK_MS) {
    const resizer = document.querySelector('.study-resizer[data-resizer="expressions-chat"]');
    if (!resizer) {
        return;
    }

    // Prevent new drags while the accordion animation runs
    resizer.classList.add('locked');
    resizer.setAttribute('aria-disabled', 'true');

    if (studyResizerUnlockTimeout) {
        clearTimeout(studyResizerUnlockTimeout);
    }

    studyResizerUnlockTimeout = setTimeout(() => {
        resizer.classList.remove('locked');
        resizer.removeAttribute('aria-disabled');
        studyResizerUnlockTimeout = null;
    }, duration);
}

// Setup study modal resizers
function setupStudyModalResizers() {
    const resizers = document.querySelectorAll('.study-resizer');
    let isResizing = false;
    let currentResizer = null;
    let startY = 0;
    let startHeights = {};
    
    resizers.forEach(resizer => {
        resizer.addEventListener('mousedown', (e) => {
            if (resizer.classList.contains('locked')) {
                e.preventDefault();
                return;
            }

            e.preventDefault();
            isResizing = true;
            currentResizer = resizer;
            startY = e.clientY;
            
            const resizerType = resizer.getAttribute('data-resizer');
            const studyExpressionsSection = document.getElementById('studyExpressionsSection');
            const studyChatMessages = document.getElementById('studyChatMessages');
            
            // Only handle expressions-chat resizer
            if (resizerType === 'expressions-chat' && studyExpressionsSection && studyChatMessages) {
                startHeights.expressions = studyExpressionsSection.getBoundingClientRect().height;
                startHeights.messages = studyChatMessages.getBoundingClientRect().height;
            }
            
            resizer.classList.add('resizing');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentResizer) return;
        
        e.preventDefault();
        
        const deltaY = e.clientY - startY;
        const resizerType = currentResizer.getAttribute('data-resizer');
        const studyExpressionsSection = document.getElementById('studyExpressionsSection');
        const studyChatMessages = document.getElementById('studyChatMessages');
        
        // Only handle expressions-chat resizer
        if (resizerType === 'expressions-chat' && studyExpressionsSection && studyChatMessages) {
            const minMessagesHeight = 50;
            const minExpressionsHeight = 100;
            
            // Calculate new messages height
            // When dragging UP (deltaY negative), messages should GROW (so subtract negative = add)
            // When dragging DOWN (deltaY positive), messages should SHRINK (so subtract positive = subtract)
            const newMessagesHeight = startHeights.messages - deltaY;
            
            const maxMessagesHeight = startHeights.messages + Math.max(0, startHeights.expressions - minExpressionsHeight);
            const boundedMaxMessagesHeight = Math.max(minMessagesHeight, maxMessagesHeight);
            
            // Constrain the messages height
            const constrainedMessagesHeight = Math.max(
                minMessagesHeight,
                Math.min(newMessagesHeight, boundedMaxMessagesHeight)
            );
            
            // Calculate how much messages actually changed (after constraints)
            const actualMessagesDelta = constrainedMessagesHeight - startHeights.messages;
            
            // Adjust expressions section height opposite to messages change
            // When messages grow (positive delta), expressions shrink (subtract delta)
            // When messages shrink (negative delta), expressions grow (subtract negative = add)
            const newExpressionsHeight = Math.max(
                minExpressionsHeight,
                startHeights.expressions - actualMessagesDelta
            );
            
            studyExpressionsSection.style.height = `${newExpressionsHeight}px`;
            studyChatMessages.style.height = `${constrainedMessagesHeight}px`;
            studyChatMessages.style.flex = '0 0 auto'; // Prevent flex from overriding height
            
            // Save to localStorage
            localStorage.setItem('studyExpressionsHeight', newExpressionsHeight);
            localStorage.setItem('studyChatMessagesHeight', constrainedMessagesHeight);
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            if (currentResizer) {
                currentResizer.classList.remove('resizing');
            }
            currentResizer = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Restore study modal section heights from localStorage
function restoreStudyModalHeights() {
    const studyExpressionsSection = document.getElementById('studyExpressionsSection');
    const studyChatMessages = document.getElementById('studyChatMessages');
    const studyModalContent = document.querySelector('.study-modal-content');
    
    if (studyChatMessages) {
        const savedHeight = localStorage.getItem('studyChatMessagesHeight');
        if (savedHeight) {
            studyChatMessages.style.height = savedHeight + 'px';
            studyChatMessages.style.flex = '0 0 auto'; // Prevent flex from overriding height
        } else {
            // Set chat messages area to minimum height (5% of modal height) by default
            if (studyModalContent) {
                const modalHeight = studyModalContent.getBoundingClientRect().height;
                const defaultHeight = Math.round(modalHeight * 0.05);
                studyChatMessages.style.height = `${Math.max(50, defaultHeight)}px`;
                studyChatMessages.style.flex = '0 0 auto'; // Prevent flex from overriding height
            } else {
                studyChatMessages.style.height = '5%';
                studyChatMessages.style.flex = '0 0 auto'; // Prevent flex from overriding height
            }
        }
    }
    
    if (studyExpressionsSection) {
        const savedHeight = localStorage.getItem('studyExpressionsHeight');
        if (savedHeight) {
            studyExpressionsSection.style.height = savedHeight + 'px';
        } else {
            // Calculate remaining space for expressions section
            if (studyModalContent && studyChatMessages) {
                const modalHeight = studyModalContent.getBoundingClientRect().height;
                const chatMessagesHeight = studyChatMessages.getBoundingClientRect().height;
                // Estimate other fixed sections (header, timestamp, item display, border, resizer, input container)
                const fixedSectionsHeight = 250; // Approximate height of fixed sections including input
                const availableHeight = modalHeight - fixedSectionsHeight - chatMessagesHeight;
                studyExpressionsSection.style.height = `${Math.max(100, availableHeight)}px`;
            } else {
                studyExpressionsSection.style.height = 'auto';
            }
        }
    }
}

// Modal functions
// Old modal functions removed - now using src/utils/modalManager.js
// Old chat functions removed - now using src/utils/chatBuilder.js

// Helper function to find timestamp for Swedish text
function findTimestampForText(swedishText) {
    if (!state.currentSubtitleData || !swedishText) return null;
    
    const searchText = swedishText.toLowerCase().trim();
    
    // First try exact match
    for (const cue of state.currentSubtitleData) {
        if (cue.text && cue.text.toLowerCase().trim() === searchText) {
            return { start: cue.start, end: cue.end };
        }
    }
    
    // Then try partial match (text contains search or search contains text)
    for (const cue of state.currentSubtitleData) {
        if (cue.text) {
            const cueText = cue.text.toLowerCase();
            if (cueText.includes(searchText) || searchText.includes(cueText)) {
                return { start: cue.start, end: cue.end };
            }
        }
    }
    
    // For expressions/words, try word-by-word matching
    const searchWords = searchText.split(/\s+/).filter(w => w.length > 2);
    if (searchWords.length > 0) {
        for (const cue of state.currentSubtitleData) {
            if (cue.text) {
                const cueText = cue.text.toLowerCase();
                const matches = searchWords.filter(word => cueText.includes(word));
                if (matches.length > 0) {
                    return { start: cue.start, end: cue.end };
                }
            }
        }
    }
    
    return null;
}

// Format timestamp for display
function formatTimestamp(timestamp) {
    if (!timestamp) return '--:--:--';
    
    const timestampStr = timestamp.start || '';
    // If timestamp is empty or is the placeholder, return formatted placeholder
    if (!timestampStr || timestampStr === '--:--:--') {
        return '--:--:--';
    }
    
    // VTT format is usually HH:MM:SS.mmm or MM:SS.mmm
    return timestampStr;
}

// Open study modal with selected item
async function openStudyModal(type, item, index, timestamp = null) {
    currentStudyItem = { type, item, index, timestamp };
    currentStudyChatHistory = [];
    
    // Ensure chat container is visible
    const studyChatContainer = document.querySelector('.study-chat-container');
    if (studyChatContainer) {
        studyChatContainer.style.display = 'flex';
        studyChatContainer.style.visibility = 'visible';
    }
    
    // Display the item
    studyItemContent.innerHTML = '';
    studyExpressionsContent.innerHTML = '';
    studyExpressionsSection.style.display = 'block'; // Always show the section
    
    // Get timestamp content element
    const studyTimestampContent = document.getElementById('studyTimestampContent');
    if (studyTimestampContent) {
        studyTimestampContent.innerHTML = '';
    }
    
    if (type === 'translation') {
        studyTitle.textContent = 'Line-by-Line Study';
        let timestampHtml = '';
        let itemHtml = '';
        
        // Display timestamp in separate section
        if (timestamp && timestamp.start) {
            timestampHtml = `<div class="study-timestamp">${escapeHtml(timestamp.start)}</div>`;
        }
        
        // Display Swedish text and translations in item section
        itemHtml += `<div class="swedish-text-wrapper">
            <div class="swedish-text">${escapeHtml(fixEncoding(item.swedish))}</div>
            ${(item.literal || (item.natural && item.natural !== item.literal)) ? `<button class="accordion-btn" data-type="translations" aria-label="Toggle translations">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 9l6 6 6-6"/>
                </svg>
            </button>` : ''}
        </div>`;
        
        if (item.literal || (item.natural && item.natural !== item.literal)) {
            itemHtml += `<div class="translation-accordion" data-type="translations">`;
        if (item.literal) {
                itemHtml += `<div class="translation-label">Literal Translation</div>`;
                itemHtml += `<div class="translation-text">${escapeHtml(fixEncoding(item.literal))}</div>`;
        }
        if (item.natural && item.natural !== item.literal) {
                itemHtml += `<div class="translation-label">Natural Translation</div>`;
                itemHtml += `<div class="translation-text">${escapeHtml(fixEncoding(item.natural))}</div>`;
            }
            itemHtml += `</div>`;
        }
        
        // Set content in separate sections
        if (studyTimestampContent) {
            studyTimestampContent.innerHTML = timestampHtml;
        }
        studyItemContent.innerHTML = itemHtml;
        
        // Setup accordion functionality
        setupTranslationAccordions();
        
        // Update border position after content is set
        requestAnimationFrame(() => {
            updateStudyItemBorder();
        });
        
        // Display related expressions using displayStudyExpressions() for consistency
        displayStudyExpressions();
        
        // Get related expressions for chat context (used in system message)
        let relatedExpressions = [];
        if (state.currentAnalysis && state.currentAnalysis.expressions && state.currentAnalysis.expressions.length > 0) {
                    const swedishText = item.swedish.toLowerCase();
            relatedExpressions = state.currentAnalysis.expressions.filter(expr => {
                // Check by translationIndex first
                if (expr.translationIndex !== undefined && expr.translationIndex === index) {
                    return true;
                }
                // Fallback: check if word appears in Swedish text
                    const word = expr.word.toLowerCase();
                    return swedishText.includes(word) || word.split(' ').some(w => swedishText.includes(w));
            });
        }
        
        // Initialize chat with context
                const relatedExprsText = relatedExpressions.length > 0
                    ? relatedExpressions.map(expr => `${expr.word}: ${expr.meaning || 'N/A'}`).join('; ')
                    : '';
                
        currentStudyChatHistory = [
            {
                    role: 'system',
                content: `You are helping the user study Swedish. They are looking at this Swedish phrase: "${item.swedish}". Literal translation: "${item.literal || 'N/A'}". ${item.natural && item.natural !== item.literal ? `Natural translation: "${item.natural}".` : ''} ${relatedExprsText ? `Related expressions in this phrase: ${relatedExprsText}.` : ''}

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list. Answer their questions about this phrase, grammar, usage, or related vocabulary, always using this format.`
            }
        ];
    } else if (type === 'expression') {
        studyTitle.textContent = 'Study Expression';
        let html = `<div class="expression-word">${escapeHtml(fixEncoding(item.word))}</div>`;
        if (item.meaning) {
            html += `<div class="expression-meaning">${escapeHtml(fixEncoding(item.meaning))}</div>`;
        }
        if (item.example) {
            html += `<div style="margin-top: 12px; padding: 12px; background-color: #111; border-radius: 6px; color: #999; font-size: 14px;">Example: ${escapeHtml(fixEncoding(item.example))}</div>`;
        }
        
        
        // Show empty expressions section for expression type too
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        
        // Initialize chat with context
        currentStudyChatHistory = [
            {
                    role: 'system',
                content: `You are helping the user study Swedish. They are looking at this Swedish expression/word: "${item.word}". Meaning: "${item.meaning || 'N/A'}". ${item.example ? `Example: "${item.example}".` : ''}

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list. Answer their questions about this expression, its usage, grammar, synonyms, or related vocabulary, always using this format.`
            }
        ];
    }
    
    // Clear chat messages and input (for fresh chat start)
    studyChatMessages.innerHTML = '';
    studyChatInput.value = '';
    
    // Show modal
    studyModal.style.display = 'flex';
    
    // Restore saved section heights after modal is visible
    // Use requestAnimationFrame to ensure modal is rendered before calculating heights
    requestAnimationFrame(() => {
        restoreStudyModalHeights();
    });
    
    // Update navigation button states
    updateNavigationButtons();
    
    // Load saved study session if exists (expressions will be restored, but chat stays empty)
    await loadStudySession();
    
    // Ensure chat area remains empty after loading (history is available via Chat history button only)
    studyChatMessages.innerHTML = '';
    studyChatInput.value = '';
}

// Navigate to previous line in line-by-line study
function navigateToPreviousLine() {
    if (!currentStudyItem || currentStudyItem.type !== 'translation' || !state.currentAnalysis) {
        return;
    }
    
    const currentIndex = currentStudyItem.index;
    if (currentIndex <= 0) {
        return; // Already at first line
    }
    
    const previousIndex = currentIndex - 1;
    const previousTranslation = state.currentAnalysis.translations[previousIndex];
    if (!previousTranslation) {
        return;
    }
    
    // Find timestamp for previous translation
    const timestamp = findTimestampForText(previousTranslation.swedish);
    
    // Open study modal with previous line
    openStudyModal('translation', previousTranslation, previousIndex, timestamp);
}

// Navigate to next line in line-by-line study
function navigateToNextLine() {
    if (!currentStudyItem || currentStudyItem.type !== 'translation' || !state.currentAnalysis) {
        return;
    }
    
    const currentIndex = currentStudyItem.index;
    const translations = state.currentAnalysis.translations || [];
    if (currentIndex >= translations.length - 1) {
        return; // Already at last line
    }
    
    const nextIndex = currentIndex + 1;
    const nextTranslation = translations[nextIndex];
    if (!nextTranslation) {
        return;
    }
    
    // Find timestamp for next translation
    const timestamp = findTimestampForText(nextTranslation.swedish);
    
    // Open study modal with next line
    openStudyModal('translation', nextTranslation, nextIndex, timestamp);
}

// Update navigation button states (enable/disable based on position)
function updateNavigationButtons() {
    if (!studyPrevBtn || !studyNextBtn) {
        return;
    }
    
    // Only enable navigation for translation type (line-by-line study)
    if (!currentStudyItem || currentStudyItem.type !== 'translation' || !state.currentAnalysis) {
        studyPrevBtn.disabled = true;
        studyNextBtn.disabled = true;
        return;
    }
    
    const currentIndex = currentStudyItem.index;
    const translations = state.currentAnalysis.translations || [];
    const totalLines = translations.length;
    
    // Disable previous button if at first line
    studyPrevBtn.disabled = currentIndex <= 0;
    
    // Disable next button if at last line
    studyNextBtn.disabled = currentIndex >= totalLines - 1;
}

// Save study session (expressions and chat history)
async function saveStudySession() {
    if (!currentStudyItem || !state.currentAnalysis) {
        alert('No study session to save.');
        return;
    }

    try {
        // Get expressions associated with this translation
        let associatedExpressions = [];
        if (state.currentAnalysis.expressions && state.currentAnalysis.expressions.length > 0) {
            if (currentStudyItem.type === 'translation') {
                const translationIndex = currentStudyItem.index;
                const swedishText = currentStudyItem.item.swedish.toLowerCase();
                
                associatedExpressions = state.currentAnalysis.expressions.filter(expr => {
                    // Check if expression is associated with this translation
                    if (expr.translationIndex !== undefined && expr.translationIndex === translationIndex) {
                        return true;
                    }
                    // Backward compatibility: check if word appears in Swedish text
                    if (expr.translationIndex === undefined) {
                        const exprWord = expr.word.toLowerCase();
                        return swedishText.includes(exprWord) || exprWord.split(' ').some(w => swedishText.includes(w));
                    }
                    return false;
                });
            }
        }

        // Create study session data
        const studySession = {
            id: `${currentStudyItem.index}-${Date.now()}`,
            translationIndex: currentStudyItem.index,
            swedishText: currentStudyItem.item.swedish,
            fileName: fileName.textContent || 'unknown',
            date: new Date().toISOString(),
            expressions: associatedExpressions.map(expr => ({
                word: expr.word,
                meaning: expr.meaning,
                example: expr.example,
                translationIndex: expr.translationIndex,
                translationText: expr.translationText
            })),
            chatHistory: currentStudyChatHistory.filter(msg => msg.role !== 'system') // Don't save system messages
        };

        // Load existing study sessions
        let savedSessions = await loadStudySessionsSafe();

        // Check if session already exists for this translation (replace it)
        const existingIndex = savedSessions.findIndex(s => 
            s.translationIndex === studySession.translationIndex && 
            s.swedishText === studySession.swedishText &&
            s.fileName === studySession.fileName
        );

        if (existingIndex >= 0) {
            savedSessions[existingIndex] = studySession;
        } else {
            savedSessions.push(studySession);
        }

        // Save updated sessions
        const saveResult = await saveStudySessionsSafe(savedSessions);
                if (saveResult && saveResult.success) {
                    alert('Study session saved!');
                } else {
            alert('Error saving study session: ' + ((saveResult && saveResult.error) || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving study session:', error);
        alert('Error saving study session: ' + error.message);
    }
}

// Load saved study session for current translation
async function loadStudySession() {
    if (!currentStudyItem || !state.currentAnalysis) {
        return;
    }

    try {
        // Load saved study sessions
        let savedSessions = await loadStudySessionsSafe();

        // Find session for this translation
        const currentFileName = fileName.textContent || 'unknown';
        const savedSession = savedSessions.find(s => 
            s.translationIndex === currentStudyItem.index &&
            s.swedishText === currentStudyItem.item.swedish &&
            s.fileName === currentFileName
        );

        if (savedSession) {
            // Restore chat history (add system message back) for Chat history button only
            // Do NOT display messages in the main chat area - keep it empty for fresh start
            if (savedSession.chatHistory && savedSession.chatHistory.length > 0) {
                currentStudyChatHistory = [
                    {
                        role: 'system',
                        content: `You are helping the user study Swedish. They are looking at this Swedish phrase: "${currentStudyItem.item.swedish}". Literal translation: "${currentStudyItem.item.literal || 'N/A'}". ${currentStudyItem.item.natural && currentStudyItem.item.natural !== currentStudyItem.item.literal ? `Natural translation: "${currentStudyItem.item.natural}".` : ''}

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list. Answer their questions about this translation, its grammar, vocabulary, or related Swedish language concepts, always using this format.`
                    },
                    ...savedSession.chatHistory
                ];
                // Note: Chat messages are NOT displayed in UI - only stored for Chat history button
            }

            // Restore expressions (merge with existing, avoiding duplicates)
            if (savedSession.expressions && savedSession.expressions.length > 0) {
                if (!state.currentAnalysis.expressions) {
                    state.currentAnalysis.expressions = [];
                }

                savedSession.expressions.forEach(savedExpr => {
                    // Check if expression already exists
                    const exists = state.currentAnalysis.expressions.some(expr => 
                        normalizeTextForMatching(expr.word || '') === normalizeTextForMatching(savedExpr.word || '')
                    );

                    if (!exists) {
                        state.currentAnalysis.expressions.push(savedExpr);
                    }
                });

                // Update display
                displayStudyExpressions();
            }
        }
    } catch (error) {
        console.error('Error loading study session:', error);
    }
}

// Close study modal
function closeStudyModal() {
    studyModal.style.display = 'none';
    currentStudyItem = null;
    currentStudyChatHistory = [];
}

// Display study expressions (refresh study modal expressions)
function displayStudyExpressions() {
    // Check if DOM elements exist
    if (!studyExpressionsContent || !studyExpressionsSection) {
        console.error('Study expressions DOM elements not found');
        return;
    }
    
    if (!state.currentAnalysis) {
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        return;
    }
    
    studyExpressionsSection.style.display = 'block'; // Always show section
    
    if (!state.currentAnalysis.expressions || state.currentAnalysis.expressions.length === 0) {
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        return;
    }
    
    // Filter expressions based on current study item
    let expressionsToShow = [];
    
    if (currentStudyItem && currentStudyItem.type === 'translation') {
        // Filter expressions that belong to this translation
        const currentTranslationIndex = currentStudyItem.index;
        const currentSwedishText = currentStudyItem.item.swedish.toLowerCase();
        
        expressionsToShow = state.currentAnalysis.expressions.filter(expr => {
            // Check if expression is associated with this translation by index
            if (expr.translationIndex !== undefined && expr.translationIndex === currentTranslationIndex) {
                return true;
            }
            
            // Backward compatibility: include expressions where the word appears in the Swedish text
            if (expr.translationIndex === undefined) {
                const exprWord = expr.word.toLowerCase();
                return currentSwedishText.includes(exprWord) || exprWord.split(' ').some(w => currentSwedishText.includes(w));
            }
            
            return false;
        });
    }
    
    // Use unified renderer for study mode
    renderExpressions(studyExpressionsContent, expressionsToShow, {
        mode: 'study',
        onClick: (expr, originalIndex) => {
            // Study mode doesn't navigate, just highlight
        },
        fixEncoding: fixEncoding
    });
}

// Display expressions (refresh the expressions section)
function displayExpressions() {
    if (!expressionsContent) {
        console.error('Expressions content DOM element not found');
        return;
    }
    
    if (!state.currentAnalysis || !state.currentAnalysis.expressions) return;
    
    renderExpressions(expressionsContent, state.currentAnalysis.expressions, {
        mode: 'main',
        selectedLevels: selectedLevels,
        onClick: (expr, originalIndex) => openStudyModal('expression', expr, originalIndex),
        findTimestamp: findTimestampForText,
        formatTimestamp: formatTimestamp,
        fixEncoding: fixEncoding
    });
}

// Show chat history
// Old showChatHistory function removed - now using src/utils/modalManager.js

// Send study chat message
async function sendStudyChatMessage() {
    const message = studyChatInput.value.trim();
    if (!message || !state.apiKey || !currentStudyItem) return;

    // Check for {add- word} pattern
    const addWordMatch = message.match(/\{add-\s*([^}]+)\}/i);
    if (addWordMatch) {
        const wordToAdd = addWordMatch[1].trim();
        await addExpressionFromStudyChat(wordToAdd);
        studyChatInput.value = '';
        return;
    }

    // Extract word from message if it's about a specific word
    let wordToSave = null;
    const wordMatch = message.match(/["']([^"']+)["']/); // Extract word in quotes
    if (wordMatch) {
        wordToSave = wordMatch[1];
    } else if (currentStudyItem && currentStudyItem.type === 'translation') {
        // Try to extract from the Swedish text
        const swedishText = currentStudyItem.item.swedish;
        const words = swedishText.match(/\b\w+\b/g);
        if (words && words.length > 0) {
            // Use first significant word from the translation
            wordToSave = words.find(w => w.length > 3) || words[0];
        }
    }
    
    // Add user message to chat
    createChatMessage({
        role: 'user',
        content: message,
        container: studyChatMessages,
        prefix: 'study-msg',
        markdownToHtml: markdownToHtml
    });
    currentStudyChatHistory.push({ role: 'user', content: message });
    
    studyChatInput.value = '';
    studyChatSendBtn.disabled = true;
    
    // Show loading
    const loadingId = createChatMessage({
        role: 'assistant',
        content: 'Thinking...',
        container: studyChatMessages,
        prefix: 'study-msg',
        markdownToHtml: markdownToHtml
    });
    
    try {
        const assistantMessage = await callOpenAI(currentStudyChatHistory);
        
        // Extract Swedish word from GPT response using improved detection
        let detectedSwedishWord = null;
        
        // Check if user's question was about a Swedish word/expression
        const lastEntry = currentStudyChatHistory[currentStudyChatHistory.length - 1];
        const userMessage = (lastEntry && lastEntry.content) || '';
        const isQuestionAboutSwedishWord = /(?:what|how|explain|tell|about|mean|meaning|word|expression|phrase)/i.test(userMessage) ||
                                          /["']([^"']+)["']/.test(userMessage) ||
                                          /[\wåäöÅÄÖ]{2,}/.test(userMessage);
        
        // Only detect Swedish words if user asked about a word/expression
        if (isQuestionAboutSwedishWord) {
            // Pattern 1: Extract from markdown format "📘 Swedish [Type]: [Word]"
            const markdownPattern = /Swedish\s+(?:Verb|Noun|Adjective|Adverb|Phrase|word|expression|phrase):\s*([^\n]+)/i;
            const markdownMatch = assistantMessage.match(markdownPattern);
            if (markdownMatch) {
                detectedSwedishWord = markdownMatch[1].trim();
                // Clean up: remove any quotes or extra text after the word
                detectedSwedishWord = detectedSwedishWord.replace(/^["']|["']$/g, '').split(/[–\-\n]/)[0].trim();
            }
            
            // Pattern 2: Quoted words like "word" or 'word'
            if (!detectedSwedishWord) {
                const quotedPattern = /["']([\wåäöÅÄÖ\s]+)["']/gi;
                const quotedMatches = [...assistantMessage.matchAll(quotedPattern)];
                if (quotedMatches.length > 0) {
                    // Find the first quoted word that looks like Swedish
                    for (const match of quotedMatches) {
                        const candidate = match[1].trim();
                        // Check if it's likely Swedish (has åäö or looks like a Swedish word)
                        if (/[åäöÅÄÖ]/.test(candidate) || 
                            (candidate.length >= 2 && 
                             !['the', 'and', 'that', 'this', 'with', 'from', 'have', 'been', 'will', 'they', 'there', 'would', 'could', 'should', 'what', 'how', 'why', 'when', 'where', 'who', 'is', 'are', 'was', 'were', 'it', 'he', 'she', 'we', 'you', 'me', 'my', 'your', 'his', 'her', 'our', 'does', 'do', 'did', 'can', 'may', 'must', 'should', 'mean', 'means', 'meaning'].includes(candidate.toLowerCase()))) {
                            detectedSwedishWord = candidate;
                            break;
                        }
                    }
                }
            }
            
            // Pattern 3: Look for Swedish words with åäö characters
            if (!detectedSwedishWord) {
                const swedishWordPattern = /\b([\wåäöÅÄÖ]{2,}(?:\s+[\wåäöÅÄÖ]+)*)\b/gi;
                const swedishMatches = [...assistantMessage.matchAll(swedishWordPattern)];
                const swedishWords = swedishMatches
                    .map(m => m[1])
                    .filter(w => {
                        const lower = w.toLowerCase();
                        // Include if has Swedish characters, or is longer than 2 chars and not a common English word
                        return /[åäöÅÄÖ]/.test(w) || 
                               (w.length >= 2 && 
                                !['the', 'and', 'that', 'this', 'with', 'from', 'have', 'been', 'will', 'they', 'there', 'would', 'could', 'should', 'what', 'how', 'why', 'when', 'where', 'who', 'is', 'are', 'was', 'were', 'it', 'he', 'she', 'we', 'you', 'me', 'my', 'your', 'his', 'her', 'our', 'does', 'do', 'did', 'can', 'may', 'must', 'should', 'mean', 'means', 'meaning', 'english', 'swedish'].includes(lower));
                    });
                if (swedishWords.length > 0) {
                    detectedSwedishWord = swedishWords[0].trim();
                }
            }
            
            // Pattern 4: Look for "Swedish word: X" patterns
            if (!detectedSwedishWord) {
                const patternMatch = assistantMessage.match(/Swedish\s+(?:word|expression|phrase):\s*([^\s,\.\n]+)/i);
                if (patternMatch) {
                    detectedSwedishWord = patternMatch[1].trim();
                }
            }
        }
        
        // Remove loading message and add real response
        removeChatMessage(loadingId);
        const messageId = createChatMessage({
            role: 'assistant',
            content: assistantMessage,
            container: studyChatMessages,
            prefix: 'study-msg',
            markdownToHtml: markdownToHtml,
            onSaveWord: async (word, msgId, originalGptResponse) => {
                await addExpressionFromStudyChat(word, originalGptResponse);
            },
            originalGptResponse: assistantMessage
        });
        
        currentStudyChatHistory.push({ role: 'assistant', content: assistantMessage });
        
        // If Swedish word detected and user asked about it, send follow-up message
        if (detectedSwedishWord && isQuestionAboutSwedishWord) {
            const followUpMessage = `Do you want to add "${detectedSwedishWord}" to the list, Important Expressions & Words?`;
            // Store the original GPT response as a data attribute so button can access it
            const followUpId = createChatMessage({
                role: 'assistant',
                content: followUpMessage,
                container: studyChatMessages,
                prefix: 'study-msg',
                markdownToHtml: markdownToHtml,
                onSaveWord: async (word, msgId, originalGptResponse) => {
                    await addExpressionFromStudyChat(word, originalGptResponse);
                },
                originalGptResponse: assistantMessage
            });
            // Store the original GPT response content in a custom data attribute
            const followUpElement = document.getElementById(followUpId);
            if (followUpElement) {
                followUpElement.dataset.originalGptResponse = assistantMessage;
            }
            currentStudyChatHistory.push({ role: 'assistant', content: followUpMessage });
        }
        
    } catch (error) {
        console.error('Study chat error:', error);
        removeChatMessage(loadingId);
        createChatMessage({
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            container: studyChatMessages,
            prefix: 'study-msg',
            markdownToHtml: markdownToHtml
        });
    } finally {
        studyChatSendBtn.disabled = false;
    }
}

// Add expression from study chat
async function addExpressionFromStudyChat(word, gptResponseContent = null) {
    if (!state.apiKey || !word) {
        console.error('Missing API key or word', { hasApiKey: !!state.apiKey, word });
        alert('Missing API key or word. Please check your settings.');
        return;
    }
    
    // Clean and validate word
    word = word.trim();
    if (!word) {
        console.error('Word is empty after trimming');
        alert('Please enter a valid word.');
        return;
    }
    
    console.log('Adding expression:', word);
    
    try {
        // Initialize state.currentAnalysis if it doesn't exist
        if (!state.currentAnalysis) {
            state.currentAnalysis = {
                translations: [],
                expressions: []
            };
        }
        
        // If we have GPT response content, parse it to extract dictionary form and meanings
        let dictionaryForm = word;
        let meanings = [];
        let wordType = null;
        
        if (gptResponseContent) {
            // Extract word type (Verb, Noun, etc.)
            const typeMatch = gptResponseContent.match(/Swedish\s+(Verb|Noun|Adjective|Adverb|Phrase)/i);
            if (typeMatch) {
                wordType = typeMatch[1].toLowerCase();
            }
            
            // Extract dictionary form for verbs
            if (wordType === 'verb') {
                // Look for "att [verb]" pattern in the response
                const attPattern = /att\s+([\wåäöÅÄÖ]+)/i;
                const attMatch = gptResponseContent.match(attPattern);
                if (attMatch) {
                    dictionaryForm = `att ${attMatch[1]}`;
                        } else {
                    // Look for "the [form] form of the verb '[word]'" pattern
                    // Example: "the imperative form of the verb 'titta'"
                    const verbFormPattern = /(?:the\s+\w+\s+form\s+of\s+)?the\s+verb\s+["']([\wåäöÅÄÖ]+)["']/i;
                    const verbFormMatch = gptResponseContent.match(verbFormPattern);
                    if (verbFormMatch) {
                        dictionaryForm = `att ${verbFormMatch[1].toLowerCase()}`;
                    } else {
                        // Look for "verb '[word]'" pattern - extract the infinitive form
                        const verbPattern = /verb\s+["']([\wåäöÅÄÖ]+)["']/i;
                        const verbMatch = gptResponseContent.match(verbPattern);
                        if (verbMatch) {
                            dictionaryForm = `att ${verbMatch[1].toLowerCase()}`;
                        } else {
                            // Default: add "att" prefix to the word
                            dictionaryForm = `att ${word.toLowerCase()}`;
                        }
                    }
                }
            }
            
            // Extract English meanings from the response
            // Look for patterns like "means 'to look' or 'to watch'" or "which means 'to look' or 'to watch'"
            const meaningPatterns = [
                /which\s+means\s+["']([^"']+)["'](?:\s+or\s+["']([^"']+)["'])?/gi,
                /means\s+["']([^"']+)["'](?:\s+or\s+["']([^"']+)["'])?/gi,
                /["']to\s+([^"']+)["'](?:\s+or\s+["']to\s+([^"']+)["'])?/gi
            ];
            
            for (const pattern of meaningPatterns) {
                const matches = [...gptResponseContent.matchAll(pattern)];
                if (matches.length > 0) {
                    for (const match of matches) {
                        // Skip matches that are in quotes but are Swedish words (check for åäö)
                        if (match[1] && match[1].trim() && !/[åäöÅÄÖ]/.test(match[1])) {
                            const meaning = match[1].trim();
                            // Make sure it starts with "to" for verbs or is a valid English meaning
                            if (wordType === 'verb' && !meaning.startsWith('to ')) {
                                meanings.push(`to ${meaning}`);
                            } else {
                                meanings.push(meaning);
                            }
                        }
                        if (match[2] && match[2].trim() && !/[åäöÅÄÖ]/.test(match[2])) {
                            const meaning = match[2].trim();
                            if (wordType === 'verb' && !meaning.startsWith('to ')) {
                                meanings.push(`to ${meaning}`);
                            } else {
                                meanings.push(meaning);
                            }
                        }
                    }
                    if (meanings.length > 0) break;
                }
            }
            
            // If still no meanings found, try extracting from the sentence structure
            if (meanings.length === 0) {
                // Look for "which means X" pattern more broadly
                const broadMatch = gptResponseContent.match(/which\s+means\s+["']([^"']+)["']/i);
                if (broadMatch && broadMatch[1]) {
                    const meaning = broadMatch[1].trim();
                    if (!/[åäöÅÄÖ]/.test(meaning)) {
                        if (wordType === 'verb' && !meaning.startsWith('to ')) {
                            meanings.push(`to ${meaning}`);
                        } else {
                            meanings.push(meaning);
                        }
                    }
                }
            }
        }
        
        // If no meanings extracted from GPT response or no GPT response provided, ask GPT for the meaning
        let meaningText = meanings.join(' or ');
        if (!meaningText || !gptResponseContent) {
            // If we have gptResponseContent but no meanings, try parsing it again
            if (gptResponseContent && !meaningText) {
                // Already tried parsing above, will proceed to GPT call
            }
            
            // Call GPT to get the meaning and dictionary form
            const meaningPrompt = `What does the Swedish word "${word}" mean in English? Provide the dictionary form (e.g., "att titta" for verbs) and a brief, clear definition.`;
            console.log('Calling OpenAI for meaning...');
            
            try {
                const meaningResponse = await callOpenAI([
                        {
                            role: 'system',
                        content: `You are a Swedish language tutor. 

CRITICAL: Always format your responses using this EXACT markdown structure:

📘 Swedish [Type]: [Word]
(Use appropriate emoji: 📘 for Verb, 📗 for Noun, 📙 for Adjective, 📕 for Adverb, 📓 for Phrase)

"[Word]" is [brief description of form/usage], which means "[English meaning]" in Swedish.

[Context explanation paragraph about how it's used.]

✅ Examples:

	1.	[Swedish example sentence] – [English translation]

	2.	[Swedish example sentence] – [English translation]

	3.	[Swedish example sentence] – [English translation]

You MUST use this exact format for ALL responses. Use tab indentation for the numbered examples list. Provide clear, concise definitions.`
                        },
                        {
                            role: 'user',
                            content: meaningPrompt
                        }
                    ]);
                
                // Validate response
                if (!meaningResponse || typeof meaningResponse !== 'string') {
                    throw new Error('Invalid response from API');
                }
                
                // If we don't have a dictionary form yet, try to extract it from GPT response
                if (dictionaryForm === word && meaningResponse) {
                    // Extract word type
                    const typeMatch = meaningResponse.match(/Swedish\s+(Verb|Noun|Adjective|Adverb|Phrase)/i);
                    if (typeMatch) {
                        wordType = typeMatch[1].toLowerCase();
                    }
                    
                    // Extract dictionary form for verbs
                    if (wordType === 'verb') {
                        const attPattern = /att\s+([\wåäöÅÄÖ]+)/i;
                        const attMatch = meaningResponse.match(attPattern);
                        if (attMatch) {
                            dictionaryForm = `att ${attMatch[1]}`;
                        } else {
                            // Look for verb patterns
                            const verbPattern = /verb\s+["']([\wåäöÅÄÖ]+)["']/i;
                            const verbMatch = meaningResponse.match(verbPattern);
                            if (verbMatch) {
                                dictionaryForm = `att ${verbMatch[1].toLowerCase()}`;
                            } else {
                                dictionaryForm = `att ${word.toLowerCase()}`;
                            }
                        }
                    }
                    
                    // Extract word from markdown format if available
                    const wordMatch = meaningResponse.match(/Swedish\s+(?:Verb|Noun|Adjective|Adverb|Phrase|word|expression|phrase):\s*([^\n]+)/i);
                    if (wordMatch) {
                        const extractedWord = wordMatch[1].trim().replace(/^["']|["']$/g, '').split(/[–\-\n]/)[0].trim();
                        if (extractedWord && extractedWord.length > 0) {
                            if (wordType === 'verb' && !extractedWord.startsWith('att ')) {
                                dictionaryForm = `att ${extractedWord.toLowerCase()}`;
                            } else {
                                dictionaryForm = extractedWord;
                            }
                        }
                    }
                }
                
                // Extract meanings from response
                const meaningPatterns2 = [
                    /means\s+["']([^"']+)["'](?:\s+or\s+["']([^"']+)["'])?/gi,
                    /which\s+means\s+["']([^"']+)["'](?:\s+or\s+["']([^"']+)["'])?/gi
                ];
                
                for (const pattern of meaningPatterns2) {
                    const matches = [...meaningResponse.matchAll(pattern)];
                    if (matches.length > 0) {
                        for (const match of matches) {
                            if (match[1] && match[1].trim() && !/[åäöÅÄÖ]/.test(match[1])) {
                                const meaning = match[1].trim();
                                if (wordType === 'verb' && !meaning.startsWith('to ')) {
                                    meanings.push(`to ${meaning}`);
                                } else {
                                    meanings.push(meaning);
                                }
                            }
                            if (match[2] && match[2].trim() && !/[åäöÅÄÖ]/.test(match[2])) {
                                const meaning = match[2].trim();
                                if (wordType === 'verb' && !meaning.startsWith('to ')) {
                                    meanings.push(`to ${meaning}`);
                                } else {
                                    meanings.push(meaning);
                                }
                            }
                        }
                        if (meanings.length > 0) break;
                    }
                }
                
                meaningText = meanings.length > 0 ? meanings.join(' or ') : meaningResponse.trim();
            } catch (error) {
                console.error('Error calling GPT for meaning:', error);
                throw error; // Re-throw to be caught by outer try-catch
            }
        }
        
        // Clean up dictionary form
        dictionaryForm = dictionaryForm.trim();
        
        // Check if expression already exists (by dictionary form)
        const existingExpr =
            state.currentAnalysis.expressions &&
            state.currentAnalysis.expressions.find(
                expr => (expr.word && expr.word.toLowerCase()) === dictionaryForm.toLowerCase(),
        );
        if (existingExpr) {
            console.log('Expression already exists:', dictionaryForm);
            createChatMessage({
                role: 'assistant',
                content: `"${dictionaryForm}" is already in Important Expressions & Words.`,
                container: studyChatMessages,
                prefix: 'study-msg',
                markdownToHtml: markdownToHtml
            });
            return;
        }
        
        console.log('Creating expression:', { dictionaryForm, meaningText });
        
        // Create expression object with "Custom" level for user-added expressions
        const newExpression = fixTranslationEncoding({
            word: dictionaryForm,
            meaning: meaningText,
            example: '',
            level: 'Custom'
        });
        
        // Associate expression with current translation if study modal is open
        if (currentStudyItem && currentStudyItem.type === 'translation') {
            newExpression.translationIndex = currentStudyItem.index;
            newExpression.translationText = currentStudyItem.item.swedish;
            console.log('Associated expression with translation:', {
                index: currentStudyItem.index,
                swedish: currentStudyItem.item.swedish
            });
        }
        
        if (!state.currentAnalysis.expressions) {
            state.currentAnalysis.expressions = [];
        }
        
        state.currentAnalysis.expressions.push(newExpression);
        console.log('Added expression to state.currentAnalysis:', newExpression);
        console.log('Total expressions now:', state.currentAnalysis.expressions.length);
        
        // Update study modal expressions (show all expressions, including the new one)
        // Only call if DOM elements exist (study modal is open)
        if (studyExpressionsContent && studyExpressionsSection) {
            console.log('Updating study expressions display...');
                    displayStudyExpressions();
        }
        
        // Also update main expressions display if visible
        if (resultsSection && resultsSection.style.display !== 'none' && expressionsContent) {
            console.log('Updating main expressions display...');
                    displayExpressions();
        }
        
        // Show confirmation popup
        alert(`Added "${dictionaryForm}"`);
        
        console.log('Successfully added expression:', dictionaryForm);
        
    } catch (error) {
        console.error('Error adding expression:', error);
        console.error('Error details:', error.message, error.stack);
        alert(`Error adding "${word}": ${error.message}`);
        createChatMessage({
            role: 'assistant',
            content: `Sorry, I couldn't add "${word}". Error: ${error.message}`,
            container: studyChatMessages,
            prefix: 'study-msg',
            markdownToHtml: markdownToHtml
        });
    }
}

// Old addStudyChatMessage and removeStudyChatMessage functions removed - now using src/utils/chatBuilder.js

// Utility functions are now imported from src/utils/helpers.js
// Removed duplicate implementations: escapeHtml, validateAnalysisData, validateFileName

// Cleanup unfinished files (for exit handling)
async function cleanupUnfinishedFiles() {
    debugLog('🧹 CLEANUP UNFINISHED FILES', {
        totalProjects: state.fileProjects.length
    });
    
    // Remove unfinished files from state.fileProjects
    const unfinishedCount = state.fileProjects.filter(p => 
        p.status === 'analyzing' || p.status === 'paused' || p.status === 'queued'
    ).length;
    
    setFileProjects(
        state.fileProjects.filter(
            (p) => p.status !== 'analyzing' && p.status !== 'paused' && p.status !== 'queued',
        ),
    );
    
    // window.state.fileProjects is auto-synced via getter
    
    // Remove inactive saves from saved analyses
    try {
        let saved = await fetchSavedAnalyses('cleanup-unfinished');
        
        // Filter out processing items
        const cleanedSaved = saved.filter(item => item.status !== 'processing');
        
        if (cleanedSaved.length !== saved.length) {
            await saveAnalysesSafe(cleanedSaved);
            debugLog('💾 CLEANED SAVED ANALYSES', {
                removedCount: saved.length - cleanedSaved.length,
                remainingCount: cleanedSaved.length
            });
        }
        
        // Refresh UI if save view is open
        if (viewManager.isVisible(VIEWS.SAVED_ANALYSES)) {
            await loadSavedAnalyses();
        }
        
        // Refresh file projects list
        renderFileProjectsList();
        
        // Reset analysis state
        state.isAnalyzing = false;
        state.isPaused = false;
        state.currentProjectId = null;
        state.currentPlaceholderId = null;
        
        debugLog('✅ CLEANUP COMPLETED', {
            removedProjects: unfinishedCount,
            remainingProjects: state.fileProjects.length
        }, 'success');
    } catch (error) {
        console.error('Error during cleanup:', error);
        debugLog('❌ CLEANUP ERROR', { error: error.message }, 'error');
    }
}

// Cleanup inactive saves on startup (per spec: inactive saves are temporary, cleared on restart)
async function cleanupInactiveSavesOnStartup() {
    try {
        debugLog('🚀 STARTUP CLEANUP INITIATED', {}, 'info');
        
        let saved = await fetchSavedAnalyses('startup-cleanup');
        
        // Remove all processing items (inactive saves should not persist across restarts)
        // Safe: only removes items with status === 'processing' (inactive saves)
        // Active saves don't have status field, so they're preserved
        const cleanedSaved = saved.filter(item => item.status !== 'processing');
        
        if (cleanedSaved.length !== saved.length) {
            await saveAnalysesSafe(cleanedSaved);
                debugLog('🧹 STARTUP CLEANUP COMPLETED', {
                    removedCount: saved.length - cleanedSaved.length,
                    remainingCount: cleanedSaved.length,
                    reason: 'Inactive saves are temporary and cleared on restart (per spec)'
                }, 'success');
        } else {
            debugLog('✅ NO INACTIVE SAVES TO CLEANUP', {}, 'info');
        }
    } catch (error) {
        debugLog('❌ STARTUP CLEANUP ERROR', { error: error.message }, 'error');
        console.error('Error during startup cleanup:', error);
    }
}

// Expose cleanup function to window for IPC access
window.cleanupUnfinishedFiles = cleanupUnfinishedFiles;
