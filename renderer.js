// State management
let currentAnalysis = null;
let currentChatHistory = [];
let currentSubtitleData = null;
let apiKey = null;
let isAnalyzing = false;
let shouldCancelAnalysis = false;

// Multiple files support
let fileProjects = []; // Array of { id, fileName, subtitleData, analysisData, status }
let currentProjectId = null; // ID of currently selected/analyzing project

// Pagination state
let currentPage = 1;
let itemsPerPage = 50;

// DOM elements (will be initialized when DOM is ready)
let uploadArea, fileInput, fileInfo, fileName, analyzeBtn, cancelBtn, resultsSection, uploadSection;
let fileProjectsList; // Container for multiple file projects list
let translationsContent, expressionsContent, chatSection, chatMessages, chatInput, chatSendBtn;
let saveAnalysisBtn, savedAnalysesBtn, savedAnalysesView, savedAnalysesList, editSavedBtn, goBackBtn, closeResultsBtn;
let settingsBtn, settingsView, closeSettingsBtn, apiKeyInput, saveApiKeyBtn, themeSelect;
let homeBtn;
let studyModal, studyTitle, studyItemContent, studyExpressionsSection, studyExpressionsContent, studyChatMessages, studyChatInput, studyChatSendBtn, closeStudyBtn, studyHistoryBtn, saveStudyBtn;
let chatHistoryModal, chatHistoryContent, closeHistoryBtn;

// Study modal state
let currentStudyItem = null;
let currentStudyChatHistory = [];
let isEditMode = false;

// CEFR Level filtering
let selectedLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C3', 'Custom']; // All levels selected by default

// CEFR Level filtering for study modal (separate from main view)
let selectedStudyLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'C3', 'Custom']; // All levels selected by default

// Initialize API key from storage
async function initializeAPIKey() {
    try {
        if (window.electronAPI) {
            const result = await window.electronAPI.loadApiKey();
            if (result.success && result.key) {
                apiKey = result.key;
                return true;
            }
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }
    return false;
}

// Reinitialize API key when loading saved analysis
async function reinitializeAPIKey() {
    try {
        if (window.electronAPI) {
            const result = await window.electronAPI.loadApiKey();
            if (result.success && result.key) {
                apiKey = result.key;
            }
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }
}

// Initialize theme from storage
async function initializeTheme() {
    try {
        let savedTheme = 'dark';
        if (window.electronAPI) {
            const result = await window.electronAPI.loadTheme();
            if (result.success) {
                savedTheme = result.theme;
            }
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
        if (window.electronAPI) {
            await window.electronAPI.saveTheme(theme);
        }
    } catch (error) {
        console.error('Error saving theme:', error);
    }
}

// OpenAI API call function with rate limit handling
async function callOpenAI(messages, model = 'gpt-4o-mini', retryCount = 0) {
    if (!apiKey) {
        throw new Error('API key not set');
    }
    
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000; // 1 second base delay
    
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    temperature: 0.7,
                max_tokens: 16000  // Increased from 4000 to allow larger responses and reduce API calls
                })
            });

        if (!response.ok) {
            const error = await response.json();
            const errorMessage = error.error?.message || 'API request failed';
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
    chatHistoryModal = document.getElementById('chatHistoryModal');
    chatHistoryContent = document.getElementById('chatHistoryContent');
    closeHistoryBtn = document.getElementById('closeHistoryBtn');
    themeSelect = document.getElementById('themeSelect');

    console.log('DOM elements initialized', {
        uploadArea: !!uploadArea,
        settingsBtn: !!settingsBtn,
        savedAnalysesBtn: !!savedAnalysesBtn,
        homeBtn: !!homeBtn,
        studyModal: !!studyModal,
        themeSelect: !!themeSelect
    });
    
    // Initialize API key (loads from .env or encrypted storage)
    initializeAPIKey().catch(err => {
        console.error('Error initializing API key:', err);
    });
    
    // Initialize theme
    initializeTheme().catch(err => {
        console.error('Error initializing theme:', err);
    });

    // Home button functionality
    homeBtn.addEventListener('click', () => {
        // Close any open modals/views
        studyModal.style.display = 'none';
        savedAnalysesView.style.display = 'none';
        settingsView.style.display = 'none';
        
        // If analysis is in progress, preserve data and show progress
        if (isAnalyzing) {
            // Show upload section with file info to display progress
            uploadSection.style.display = 'flex';
            if (fileInfo) {
                fileInfo.style.display = 'flex';
            }
            resultsSection.style.display = 'none';
            chatSection.style.display = 'none';
            // Don't reset data - analysis needs it to continue
            return;
        }
        
        // Reset to home/upload view (only when not analyzing)
        uploadSection.style.display = 'flex';
        resultsSection.style.display = 'none';
        chatSection.style.display = 'none';
        
        // Reset file info and current project (but keep projects list)
        fileInfo.style.display = 'none';
        scriptName.textContent = '';
        currentAnalysis = null;
        currentChatHistory = [];
        currentSubtitleData = null;
        currentProjectId = null;
        
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
            return fileName.endsWith('.vtt') || fileName.endsWith('.txt');
        });
        
        if (validFiles.length > 0) {
            for (const file of validFiles) {
                await handleFileSelect(file);
            }
        } else if (files.length > 0) {
            alert('Please drop .vtt or .txt files only.');
        }
    });

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            const validFiles = files.filter(file => {
                const fileName = file.name.toLowerCase();
                return fileName.endsWith('.vtt') || fileName.endsWith('.txt');
            });
            
            if (validFiles.length > 0) {
                for (const file of validFiles) {
                    await handleFileSelect(file);
                }
            } else {
                alert('Please select .vtt or .txt files only.');
            }
            // Reset input to allow selecting same files again
            e.target.value = '';
        }
    });

async function handleFileSelect(file) {
    try {
        console.log('handleFileSelect called with file:', file.name, 'size:', file.size);
        
        // Validate file
        if (!file) {
            alert('No file selected.');
            return;
        }
        
        // Use FileReader API for both drag-and-drop and file input
        const content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                console.log('File read successfully, content length:', e.target.result.length);
                resolve(e.target.result);
            };
            reader.onerror = (error) => {
                console.error('FileReader error:', error);
                reject(error);
            };
            // Explicitly specify UTF-8 encoding to prevent Swedish characters from being broken
            reader.readAsText(file, 'UTF-8');
        });
        
        // Fix encoding issues before parsing (in case file was already corrupted)
        const fixedContent = fixEncoding(content);
        
        // Detect file type and use appropriate parser (case-insensitive)
        const fileNameLower = file.name.toLowerCase();
        let subtitleData = null;
        
        if (fileNameLower.endsWith('.vtt')) {
            subtitleData = parseVTT(fixedContent);
            console.log('Parsed VTT file, subtitle count:', subtitleData ? subtitleData.length : 0);
        } else if (fileNameLower.endsWith('.txt')) {
            subtitleData = parseTXT(fixedContent);
            console.log('Parsed TXT file, subtitle count:', subtitleData ? subtitleData.length : 0);
        } else {
            alert('Unsupported file type. Please upload a .vtt or .txt file.');
            return;
        }
        
        // Ensure we have valid data
        if (!subtitleData || subtitleData.length === 0) {
            alert(`The file "${file.name}" appears to be empty or could not be parsed. Please check the file contains text and try again.`);
            return;
        }
        
        // Check if file already exists - prevent duplicates
        // Don't remove if currently analyzing - update existing instead
        const existingProject = fileProjects.find(p => p.fileName === file.name);
        if (existingProject) {
            // If not analyzing, update existing project
            if (existingProject.status !== 'analyzing') {
                existingProject.subtitleData = subtitleData;
                existingProject.status = 'ready';
                existingProject.analysisData = null;
            }
            // If analyzing, don't modify it - keep the analyzing one
        } else {
            // Add new project
            const projectId = 'project-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            fileProjects.push({
                id: projectId,
                fileName: file.name,
                subtitleData: subtitleData,
                analysisData: null,
                status: 'ready' // ready, analyzing, completed, error
            });
        }
        
        // Render the file projects list
        renderFileProjectsList();
        
        // Reset state
        currentAnalysis = null;
        currentChatHistory = [];
        resultsSection.style.display = 'none';
        chatSection.style.display = 'none';
        
        console.log('File processed successfully, ready for analysis');
    } catch (error) {
        console.error('Error reading file:', error);
        alert('Error reading file: ' + (error.message || 'Please try again.'));
        currentSubtitleData = null;
        fileInfo.style.display = 'none';
    }
}

// Helper function to format time in seconds to human-readable format
function formatTimeRemaining(seconds) {
    if (seconds < 60) {
        return `~${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        if (secs === 0) {
            return `~${minutes}m`;
        }
        return `~${minutes}m ${secs}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (minutes === 0) {
            return `~${hours}h`;
        }
        return `~${hours}h ${minutes}m`;
    }
}

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
        
        console.log(`Batch ${batchNumber}/${totalBatches} complete: ${batchData.translations?.length || 0} translations (took ${(batchDuration / 1000).toFixed(1)}s)`);
        
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
    const BATCH_SIZE_ENTRIES = 300; // Reduced to prevent timeout - smaller batches process faster
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
    let completedCount = 0;
    let lastProgressUpdate = -1;
    
    // Status is already set to 'analyzing' in analyzeProject before calling this function
    // Just render - no need to deduplicate here as we're only updating existing entries
    renderFileProjectsList();
    
    // Process batches in parallel groups of CONCURRENT_BATCHES
    for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
        // Check for cancellation before processing next batch group
        if (shouldCancelAnalysis) {
            console.log('Analysis cancelled by user');
            break;
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
            
            // Update button text to show progress and time estimate
            if (analyzeBtn) {
                analyzeBtn.textContent = `Analyzing... (Batch ${completedCount}/${batches.length}${timeRemainingText})`;
            }
            
            // Update placeholder progress (throttled: only every 25%)
            if (placeholderId) {
                const progress = Math.round((completedCount / batches.length) * 100);
                // Only update if progress crossed a 25% threshold
                const progressThreshold = Math.floor(progress / 25) * 25;
                if (progressThreshold > lastProgressUpdate) {
                    lastProgressUpdate = progressThreshold;
                    // Update progress asynchronously (non-blocking)
                    setTimeout(async () => {
                        try {
                            // Update current project's progress in the home list
                            if (currentProjectId) {
                                const proj = fileProjects.find(p => p.id === currentProjectId);
                                if (proj) {
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
                            }
                            let saved = [];
                            if (window.electronAPI) {
                                const result = await window.electronAPI.loadAnalyses();
                                if (result.success) {
                                    saved = result.data || [];
                                }
                            }
                            
                            const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                            if (placeholderIndex !== -1) {
                                saved[placeholderIndex].progress = progress;
                                
                                if (window.electronAPI) {
                                    await window.electronAPI.saveAnalyses(saved);
                                }
                                
                                // Refresh saved files view if it's open
                                if (savedAnalysesView && savedAnalysesView.style.display === 'flex') {
                                    await loadSavedAnalyses();
                                }
                            }
                        } catch (error) {
                            console.error('Error updating placeholder progress:', error);
                        }
                    }, 0);
                }
            }
        }
    }
    
    return results;
}

// Deduplicate fileProjects by fileName - keeps only one entry per fileName
// Priority: analyzing > ready > completed > error
// When same priority, prefers the one with matching currentProjectId
// IMPORTANT: This removes ALL duplicates, not just picks one
function deduplicateFileProjects() {
    if (fileProjects.length === 0) return;
    
    const projectMap = new Map();
    const priority = { 'analyzing': 4, 'ready': 3, 'completed': 2, 'error': 1 };
    
    // First pass: collect all projects by fileName
    fileProjects.forEach(project => {
        const existing = projectMap.get(project.fileName);
        if (!existing) {
            projectMap.set(project.fileName, project);
        } else {
            const existingPriority = priority[existing.status] || 0;
            const currentPriority = priority[project.status] || 0;
            
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
                // Same priority - prefer the one with currentProjectId, otherwise keep first found
                if (project.id === currentProjectId && existing.id !== currentProjectId) {
                    projectMap.set(project.fileName, project);
                }
                // Otherwise keep existing (first found)
            }
        }
    });
    
    // Update fileProjects array to remove ALL duplicates
    // This ensures only one entry per fileName exists
    fileProjects = Array.from(projectMap.values());
}

// Render file projects list
function renderFileProjectsList() {
    if (!fileProjectsList) return;
    
    if (fileProjects.length === 0) {
        fileProjectsList.innerHTML = '';
        fileProjectsList.style.display = 'none';
        return;
    }
    
    // Don't filter duplicates - users CAN have multiple files with same name
    // Just render all projects - clicking Start should UPDATE the existing entry, not create new one
    
    fileProjectsList.style.display = 'flex';
    fileProjectsList.innerHTML = fileProjects.map(project => {
        const isAnalyzingProject = project.status === 'analyzing';
        // Only show as queued if it's ready AND another file is analyzing (not this one)
        const isQueued = isAnalyzing && !isAnalyzingProject && project.status === 'ready';
        
        // Build status text and class
        let statusText = '';
        let statusClass = '';
        let estimatedTimeHtml = '';
        
        if (isAnalyzingProject) {
            statusText = `Analyzing${typeof project.progress === 'number' ? ` (${project.progress}%)` : '...'}`;
            statusClass = 'status-analyzing';
            if (project.estimatedTimeRemaining) {
                estimatedTimeHtml = `<div class="file-project-time-estimate">estimated time left: ${project.estimatedTimeRemaining}</div>`;
            }
        } else if (isQueued) {
            statusText = 'queued';
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
                        statusText !== 'Ready' && !isQueued ? 
                        `<span class="file-project-status ${statusClass}">${statusText}</span>` :
                        ''
                    }
                </div>
                <div class="file-project-actions">
                    ${isAnalyzingProject ? 
                        `<div class="action-status-container">
                            <button class="cancel-project-btn analyzing-cancel-btn" data-project-id="${project.id}">cancel</button>
                            ${project.estimatedTimeRemaining ? 
                                `<div class="file-project-time-estimate">expected time left: ${project.estimatedTimeRemaining}</div>` :
                                ''
                            }
                        </div>` :
                        isQueued ? 
                        `<button class="queued-status-btn" disabled>queued</button>` :
                        `<button class="analyze-project-btn" data-project-id="${project.id}">
                            ${project.status === 'completed' ? 'Re-analyze' : 'Start'}
                        </button>`
                    }
                    <button class="remove-project-btn" data-project-id="${project.id}" ${project.status === 'analyzing' ? 'disabled' : ''}>Remove</button>
                </div>
            </div>
        `;
    }).join('');
    
    // Attach event listeners
    fileProjectsList.querySelectorAll('.analyze-project-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const projectId = e.target.dataset.projectId;
            // Analyze this specific project, then continue with queue
            await analyzeProject(projectId);
        });
    });
    
    fileProjectsList.querySelectorAll('.remove-project-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const projectId = e.target.dataset.projectId;
            removeProject(projectId);
        });
    });
    
    fileProjectsList.querySelectorAll('.cancel-project-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const projectId = e.target.dataset.projectId;
            if (currentProjectId === projectId && isAnalyzing) {
                shouldCancelAnalysis = true;
                // Update UI immediately - set project back to ready status
                const project = fileProjects.find(p => p.id === projectId);
                if (project) {
                    project.status = 'ready';
                    delete project.progress;
                    delete project.estimatedTimeRemaining;
                    renderFileProjectsList();
                }
            }
        });
    });
}

// Analyze a specific project
async function analyzeProject(projectId) {
    const project = fileProjects.find(p => p.id === projectId);
    if (!project) return;
    
    if (!apiKey) {
        alert('Please set your OpenAI API key in Settings first.');
        settingsBtn.click();
        return;
    }
    
    if (isAnalyzing) {
        alert('Analysis is already in progress. Please wait for it to complete.');
        return;
    }
    
    // Find and update the EXISTING project - do NOT create new entries
    let targetProject = fileProjects.find(p => p.id === projectId);
    if (!targetProject) {
        console.error('Project not found:', projectId);
        return;
    }
    
    // Set current project
    currentProjectId = targetProject.id;
    currentSubtitleData = targetProject.subtitleData;
    fileName.textContent = targetProject.fileName;
    scriptName.textContent = targetProject.fileName;
    fileInfo.style.display = 'flex';
    
    // Update project status - UPDATE EXISTING entry, do NOT create new one
    targetProject.status = 'analyzing';
    targetProject.progress = 0;
    
    // IMPORTANT: Just update the existing entry, don't create duplicates
    // Users can have multiple files with same name, but clicking Start should UPDATE this specific one
    renderFileProjectsList();
    
    isAnalyzing = true;
    shouldCancelAnalysis = false;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    if (cancelBtn) {
        cancelBtn.style.display = 'inline-block';
    }
    
    // Create placeholder saved analysis entry with processing status
    let placeholderId = null;
    if (targetProject.fileName) {
        try {
            placeholderId = Date.now().toString();
            const placeholderAnalysis = {
                id: placeholderId,
                fileName: targetProject.fileName,
                date: new Date().toISOString(),
                status: 'processing',
                progress: 0,
                analysis: null,
                chatHistory: [],
                subtitleData: null
            };
            
            // Get existing saved analyses
            let saved = [];
            if (window.electronAPI) {
                const result = await window.electronAPI.loadAnalyses();
                if (result.success) {
                    saved = result.data || [];
                }
            }
            
            // Remove any existing placeholder for this file
            saved = saved.filter(item => !(item.fileName === targetProject.fileName && item.status === 'processing'));
            
            // Add placeholder
            saved.push(placeholderAnalysis);
            
            // Keep only last 50 analyses
            if (saved.length > 50) {
                saved.shift();
            }
            
            // Save placeholder (non-blocking)
            if (window.electronAPI) {
                window.electronAPI.saveAnalyses(saved).catch(err => {
                    console.error('Error saving placeholder:', err);
                });
            }
            
            // Refresh saved files view if it's open (non-blocking)
            if (savedAnalysesView && savedAnalysesView.style.display === 'flex') {
                setTimeout(() => loadSavedAnalyses(), 0);
            }
        } catch (error) {
            console.error('Error creating placeholder:', error);
        }
    }
    
    try {
        console.log(`Starting analysis of ${currentSubtitleData.length} subtitle entries for ${targetProject.fileName}...`);
        
        // Process subtitles in batches
        const batchResults = await processSubtitleBatches(currentSubtitleData, placeholderId);
        
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
            const key = expr.word?.toLowerCase() || '';
            if (!expressionsMap.has(key) || !expressionsMap.get(key).meaning) {
                expressionsMap.set(key, expr);
            }
        });
        analysisData.expressions = Array.from(expressionsMap.values());
        
        console.log(`Analysis complete: ${analysisData.translations.length} translations, ${analysisData.expressions.length} expressions`);
        
        // Update project with analysis data
        targetProject.analysisData = analysisData;
        targetProject.status = 'completed';
        delete targetProject.progress;
        delete targetProject.estimatedTimeRemaining;
        
        // Autosave: Automatically save the completed analysis
        try {
            // Get existing saved analyses
            let saved = [];
            if (window.electronAPI) {
                const result = await window.electronAPI.loadAnalyses();
                if (result.success) {
                    saved = result.data || [];
                }
            }
            
            // Update placeholder if it exists, otherwise create new entry
            if (placeholderId) {
                const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                if (placeholderIndex !== -1) {
                    // Update placeholder to completed analysis
                    saved[placeholderIndex] = {
                        id: placeholderId,
                        fileName: targetProject.fileName,
                        date: new Date().toISOString(),
                        analysis: analysisData,
                        chatHistory: currentChatHistory,
                        subtitleData: currentSubtitleData
                        // Note: status and progress fields are removed (no longer processing)
                    };
                } else {
                    // Placeholder not found, create new entry
                    const savedAnalysis = {
                        id: Date.now().toString(),
                        fileName: targetProject.fileName,
                        date: new Date().toISOString(),
                        analysis: analysisData,
                        chatHistory: currentChatHistory,
                        subtitleData: currentSubtitleData
                    };
                    // Remove any existing analyses with the same fileName (keep only latest)
                    saved = saved.filter(item => item.fileName !== targetProject.fileName);
                    saved.push(savedAnalysis);
                }
            } else {
                // No placeholder, create new entry
                const savedAnalysis = {
                    id: Date.now().toString(),
                    fileName: targetProject.fileName,
                    date: new Date().toISOString(),
                    analysis: analysisData,
                    chatHistory: currentChatHistory,
                    subtitleData: currentSubtitleData
                };
                // Remove any existing analyses with the same fileName (keep only latest)
                saved = saved.filter(item => item.fileName !== targetProject.fileName);
                saved.push(savedAnalysis);
            }
            
            // Keep only last 50 analyses
            if (saved.length > 50) {
                saved.shift();
            }
            
            // Save to file storage
            if (window.electronAPI) {
                const saveResult = await window.electronAPI.saveAnalyses(saved);
                if (saveResult.success) {
                    console.log('Analysis autosaved successfully');
                } else {
                    console.error('Error autosaving analysis:', saveResult.error);
                }
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
        currentAnalysis = analysisData;
        displayAnalysis(analysisData);
        
        // Check which view is currently active
        const isInSettings = settingsView.style.display === 'flex';
        const isInSavedAnalyses = savedAnalysesView.style.display === 'flex';
        const isInStudyModal = studyModal && studyModal.style.display !== 'none';
        
        // If analysis completes while user is in saved files view, switch to results
        if (isInSavedAnalyses) {
            savedAnalysesView.style.display = 'none';
            uploadSection.style.display = 'none';
            resultsSection.style.display = 'flex';
            chatSection.style.display = 'none';
            if (expressionsContent && expressionsContent.parentElement) {
                expressionsContent.parentElement.style.display = 'none';
            }
        } else if (!isInSettings && !isInStudyModal) {
            uploadSection.style.display = 'none';
            resultsSection.style.display = 'flex';
            chatSection.style.display = 'none';
            if (expressionsContent && expressionsContent.parentElement) {
                expressionsContent.parentElement.style.display = 'none';
            }
        }
        
        // Initialize chat history
        currentChatHistory = [
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
        
    } catch (error) {
        console.error('Analysis error:', error);
        // Find target project again (it might have changed after deduplication)
        const errorProject = fileProjects.find(p => p.id === currentProjectId) || 
                           fileProjects.find(p => p.fileName === targetFileName);
        if (errorProject) {
            errorProject.status = 'error';
        }
        renderFileProjectsList();
        alert('Error during analysis: ' + error.message);
    } finally {
        // Check if analysis was cancelled
        if (shouldCancelAnalysis) {
            // Find target project again (it might have changed after deduplication)
            const cancelProject = fileProjects.find(p => p.id === currentProjectId) || 
                                fileProjects.find(p => p.fileName === targetFileName);
            if (cancelProject) {
                cancelProject.status = 'ready';
                delete cancelProject.progress;
                delete cancelProject.estimatedTimeRemaining;
                console.log('Analysis cancelled');
            }
        }
        
        isAnalyzing = false;
        shouldCancelAnalysis = false;
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze';
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
        currentProjectId = null;
        renderFileProjectsList();
        
        // Automatically process next file in queue (only if not cancelled)
        if (!shouldCancelAnalysis) {
            processQueue();
        }
    }
}

// Remove a project
function removeProject(projectId) {
    const projectIndex = fileProjects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) return;
    
    // If removing current project, reset
    if (currentProjectId === projectId) {
        currentProjectId = null;
        currentSubtitleData = null;
        currentAnalysis = null;
        fileInfo.style.display = 'none';
        resultsSection.style.display = 'none';
    }
    
    fileProjects.splice(projectIndex, 1);
    renderFileProjectsList();
}

    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (isAnalyzing) {
                shouldCancelAnalysis = true;
            }
        });
    }

// Process files one by one automatically
async function processQueue() {
    // Don't start if already analyzing
    if (isAnalyzing) {
        return;
    }
    
    // Find first ready project and update it (don't create new entries)
    const readyProject = fileProjects.find(p => p.status === 'ready');
    if (readyProject) {
        await analyzeProject(readyProject.id);
        // After analysis completes, check for next file
        processQueue();
    }
}

    // Analyze button - works with current project or starts queue
    analyzeBtn.addEventListener('click', async () => {
        // If currentProjectId is set, use it
        if (currentProjectId) {
            await analyzeProject(currentProjectId);
            return;
        }
        
        // Otherwise, start processing queue
        if (fileProjects.length > 0) {
            await processQueue();
            return;
        }
        
        // Fallback to old behavior if no projects
        if (!currentSubtitleData || currentSubtitleData.length === 0) {
            alert('Please upload a valid .vtt or .txt file first.');
            return;
        }

        if (!apiKey) {
            alert('Please set your OpenAI API key in Settings first.');
            settingsBtn.click();
            return;
        }

        if (isAnalyzing) {
            alert('Analysis is already in progress. Please wait for it to complete.');
            return;
        }

        isAnalyzing = true;
        shouldCancelAnalysis = false;
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';
        if (cancelBtn) {
            cancelBtn.style.display = 'inline-block';
        }
        
        // Create placeholder saved analysis entry with processing status
        let placeholderId = null;
        const currentFileName = fileName.textContent || 'unknown';
        if (currentFileName && currentFileName !== 'unknown') {
            try {
                placeholderId = Date.now().toString();
                const placeholderAnalysis = {
                    id: placeholderId,
                    fileName: currentFileName,
                    date: new Date().toISOString(),
                    status: 'processing',
                    analysis: null,
                    chatHistory: [],
                    subtitleData: null
                };
                
                // Get existing saved analyses
                let saved = [];
                if (window.electronAPI) {
                    const result = await window.electronAPI.loadAnalyses();
                    if (result.success) {
                        saved = result.data || [];
                    }
                }
                
                // Remove any existing placeholder for this file
                saved = saved.filter(item => !(item.fileName === currentFileName && item.status === 'processing'));
                
                // Add placeholder
                saved.push(placeholderAnalysis);
                
                // Keep only last 50 analyses
                if (saved.length > 50) {
                    saved.shift();
                }
                
                // Save placeholder (non-blocking)
                if (window.electronAPI) {
                    window.electronAPI.saveAnalyses(saved).catch(err => {
                        console.error('Error saving placeholder:', err);
                    });
                }
                
                // Refresh saved files view if it's open (non-blocking)
                if (savedAnalysesView && savedAnalysesView.style.display === 'flex') {
                    setTimeout(() => loadSavedAnalyses(), 0);
                }
            } catch (error) {
                console.error('Error creating placeholder:', error);
            }
        }

        try {
            console.log(`Starting analysis of ${currentSubtitleData.length} subtitle entries...`);
            
            // Process subtitles in batches to handle large files
            const batchResults = await processSubtitleBatches(currentSubtitleData, placeholderId);
            
            // Check if analysis was cancelled
            if (shouldCancelAnalysis) {
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
                const key = expr.word?.toLowerCase() || '';
                if (!expressionsMap.has(key) || !expressionsMap.get(key).meaning) {
                    expressionsMap.set(key, expr);
                }
            });
            analysisData.expressions = Array.from(expressionsMap.values());
            
            console.log(`Analysis complete: ${analysisData.translations.length} translations, ${analysisData.expressions.length} expressions`);

            // Update placeholder with actual analysis data
            if (placeholderId) {
                try {
                    let saved = [];
                    if (window.electronAPI) {
                        const result = await window.electronAPI.loadAnalyses();
                        if (result.success) {
                            saved = result.data || [];
                        }
                    }
                    
                    // Find and update placeholder
                    const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                    if (placeholderIndex !== -1) {
                        // Update placeholder to completed analysis (remove status and progress fields)
                        saved[placeholderIndex] = {
                            id: placeholderId,
                            fileName: currentFileName,
                            date: new Date().toISOString(),
                            analysis: analysisData,
                            chatHistory: currentChatHistory,
                            subtitleData: currentSubtitleData
                        };
                        
                        // Save updated analysis
                        if (window.electronAPI) {
                            await window.electronAPI.saveAnalyses(saved);
                        }
                        
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

            currentAnalysis = analysisData;
            displayAnalysis(analysisData);
            
            // Check which view is currently active
            const isInSettings = settingsView.style.display === 'flex';
            const isInSavedAnalyses = savedAnalysesView.style.display === 'flex';
            const isInStudyModal = studyModal && studyModal.style.display !== 'none';
            
            // If analysis completes while user is in saved files view, switch to results
            if (isInSavedAnalyses) {
                savedAnalysesView.style.display = 'none';
                uploadSection.style.display = 'none';
                resultsSection.style.display = 'flex';
                chatSection.style.display = 'none';
                // Hide expressions section
                if (expressionsContent && expressionsContent.parentElement) {
                    expressionsContent.parentElement.style.display = 'none';
                }
            } else if (!isInSettings && !isInStudyModal) {
                // Only auto-switch to results if user is not in another view
                // Show results only (no chat or expressions in main view)
                uploadSection.style.display = 'none';
                resultsSection.style.display = 'flex';
                chatSection.style.display = 'none';
                // Hide expressions section
                if (expressionsContent && expressionsContent.parentElement) {
                    expressionsContent.parentElement.style.display = 'none';
                }
            }
            // If user is in settings, analysis data is already stored
            // and will be shown when they return (handled by closeSettingsBtn)
            
            // Initialize chat history with analysis context
            currentChatHistory = [
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
            isAnalyzing = false;
            shouldCancelAnalysis = false;
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze';
            if (cancelBtn) {
                cancelBtn.style.display = 'none';
            }
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
            if (currentAnalysis) {
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
            if (currentAnalysis) {
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
    if (!message || !apiKey) return;

    // Check for {add- word} pattern
    const addWordMatch = message.match(/\{add-\s*([^}]+)\}/i);
    if (addWordMatch) {
        const wordToAdd = addWordMatch[1].trim();
        await addExpressionFromChat(wordToAdd, 'main');
        chatInput.value = '';
        return;
    }

    // Extract word from message if it's about a specific word
    let wordToSave = null;
    const wordMatch = message.match(/["']([^"']+)["']/); // Extract word in quotes
    if (wordMatch) {
        wordToSave = wordMatch[1];
    }
    
    // Add user message to chat
    addChatMessage('user', message);
    currentChatHistory.push({ role: 'user', content: message });
    
    chatInput.value = '';
    chatSendBtn.disabled = true;
    
    // Show loading
    const loadingId = addChatMessage('assistant', 'Thinking...', null);
    
    try {
        const assistantMessage = await callOpenAI(currentChatHistory);
        
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
        addChatMessage('assistant', assistantMessage, wordToSave);
        
        currentChatHistory.push({ role: 'assistant', content: assistantMessage });
        
    } catch (error) {
        console.error('Chat error:', error);
        removeChatMessage(loadingId);
        addChatMessage('assistant', 'Sorry, I encountered an error. Please try again.', null);
    } finally {
        chatSendBtn.disabled = false;
    }
}

// Add expression from chat using {add- word} command
async function addExpressionFromChat(word, context = 'main') {
    if (!apiKey || !word) {
        console.error('Missing API key or word');
        return;
    }
    
    try {
        // Initialize currentAnalysis if it doesn't exist
        if (!currentAnalysis) {
            currentAnalysis = {
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
        
        if (!currentAnalysis.expressions) {
            currentAnalysis.expressions = [];
        }
        currentAnalysis.expressions.push(newExpression);
        
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
        addChatMessage('assistant', `Added "${word}" to Important Expressions & Words. Meaning: ${meaningResponse.trim()}`, null);
        
    } catch (error) {
        console.error('Error adding expression:', error);
        console.error('Error details:', error.message, error.stack);
        addChatMessage('assistant', `Sorry, I couldn't add "${word}". Please try again.`, null);
    }
}

function addChatMessage(role, content, wordToSave = null) {
    const messageDiv = document.createElement('div');
    const messageId = 'msg-' + Date.now();
    messageDiv.id = messageId;
    messageDiv.className = `chat-message ${role}`;
    
    // Wrap bubble in container for button positioning
    const bubbleContainer = document.createElement('div');
    bubbleContainer.className = 'message-bubble-container';
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = markdownToHtml(content);
    
    bubbleContainer.appendChild(bubble);
    
    // "add on the list +" button is only in study modal, not in main chat
    // Check if this is the study modal chat by checking chatMessages id
    const isStudyChat = chatMessages && chatMessages.id === 'studyChatMessages';
    if (role === 'assistant' && isStudyChat) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'add-to-list-btn';
        saveBtn.textContent = 'add on the list +';
        saveBtn.title = 'Add words from this response to Important Expressions & Words';
        saveBtn.addEventListener('click', async () => {
            // Extract Swedish words from the message content
            // Look for Swedish words (typically in quotes or mentioned in the text)
            // Try multiple patterns to find Swedish words
            let word = null;
            
            // Pattern 1: Quoted words like "word" or 'word'
            const quotedPattern = /["']([\wåäöÅÄÖ\s]+)["']/gi;
            const quotedMatches = [...content.matchAll(quotedPattern)];
            if (quotedMatches.length > 0) {
                word = quotedMatches[0][1].trim();
            }
            
            // Pattern 2: Look for Swedish words with åäö characters
            if (!word) {
                const swedishWordPattern = /\b([\wåäöÅÄÖ]{2,}(?:\s+[\wåäöÅÄÖ]+)*)\b/gi;
                const swedishMatches = [...content.matchAll(swedishWordPattern)];
                // Filter out common English words and look for Swedish-specific patterns
                const swedishWords = swedishMatches
                    .map(m => m[1])
                    .filter(w => /[åäöÅÄÖ]/.test(w) || w.length > 3)
                    .filter(w => !['the', 'and', 'that', 'this', 'with', 'from', 'have', 'been', 'will', 'they', 'there', 'would', 'could', 'should'].includes(w.toLowerCase()));
                if (swedishWords.length > 0) {
                    word = swedishWords[0].trim();
                }
            }
            
            // Pattern 3: Look for "Swedish word: X" patterns
            if (!word) {
                const patternMatch = content.match(/Swedish\s+(?:word|expression|phrase):\s*([^\s,\.]+)/i);
                if (patternMatch) {
                    word = patternMatch[1].trim();
                }
            }
            
            // If still no word found, prompt user
            if (!word) {
                word = prompt('Enter the Swedish word/phrase to add:');
                if (!word || !word.trim()) {
                    return; // User cancelled
                }
                word = word.trim();
            }
            
            // Add the word
            saveBtn.disabled = true;
            saveBtn.textContent = 'saving...';
            
            // This button is only in study modal, so always use study chat function
            await addExpressionFromStudyChat(word);
            
            saveBtn.disabled = false;
            saveBtn.textContent = 'added ✓';
            setTimeout(() => {
                saveBtn.textContent = 'add on the list +';
            }, 2000);
        });
        bubbleContainer.appendChild(saveBtn);
    }
    
    messageDiv.appendChild(bubbleContainer);
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return messageId;
}

function removeChatMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) {
        message.remove();
    }
}

    // Save analysis
    saveAnalysisBtn.addEventListener('click', async () => {
        if (!currentAnalysis) {
            alert('No analysis to save.');
            return;
        }

        const savedAnalysis = {
            id: Date.now().toString(),
            fileName: fileName.textContent,
            date: new Date().toISOString(),
            analysis: currentAnalysis,
            chatHistory: currentChatHistory,
            subtitleData: currentSubtitleData
        };

        try {
            // Get existing saved analyses
            let saved = [];
            if (window.electronAPI) {
                const result = await window.electronAPI.loadAnalyses();
                if (result.success) {
                    saved = result.data || [];
                }
            }
            
            saved.push(savedAnalysis);
            
            // Keep only last 50 analyses
            if (saved.length > 50) {
                saved.shift();
            }
            
            // Save to file storage
            if (window.electronAPI) {
                const saveResult = await window.electronAPI.saveAnalyses(saved);
                if (saveResult.success) {
                    alert('Analysis saved!');
                } else {
                    alert('Error saving analysis: ' + (saveResult.error || 'Unknown error'));
                }
            } else {
                alert('Storage API not available');
            }
        } catch (error) {
            console.error('Error saving analysis:', error);
            alert('Error saving analysis: ' + error.message);
        }
    });

    // Close results button
    if (closeResultsBtn) {
        closeResultsBtn.addEventListener('click', async () => {
            // Navigate to saved analyses view
            resultsSection.style.display = 'none';
            chatSection.style.display = 'none';
            uploadSection.style.display = 'none';
            settingsView.style.display = 'none';
            savedAnalysesView.style.display = 'flex';
            
            // Reset edit mode and load saved analyses
            isEditMode = false;
            await loadSavedAnalyses();
            if (editSavedBtn) {
                updateEditButton();
            }
        });
    }

    // Saved analyses view
    savedAnalysesBtn.addEventListener('click', async () => {
        console.log('Saved analyses button clicked');
        
        // Show warning if analysis is in progress
        if (isAnalyzing) {
            const confirmLeave = confirm('Analysis is in progress. Are you sure you want to leave? The analysis will continue in the background.');
            if (!confirmLeave) {
                return;
            }
        }
        
        isEditMode = false; // Reset edit mode when opening
        await loadSavedAnalyses();
        if (editSavedBtn) {
            updateEditButton();
        }
        savedAnalysesView.style.display = 'flex';
        resultsSection.style.display = 'none';
        uploadSection.style.display = 'none';
        chatSection.style.display = 'none';
        settingsView.style.display = 'none';
        // Note: Analysis continues in background if in progress
        // Progress will be visible when returning to home window
    });

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
                
                const confirmDelete = confirm(`Are you sure you want to delete ${checkedItems.length} saved analysis/analyses?`);
                if (!confirmDelete) {
                    return;
                }
                
                try {
                    // Get IDs of checked items (convert to strings for reliable comparison)
                    const idsToDelete = Array.from(checkedItems).map(cb => String(cb.dataset.itemId));
                    
                    // Load ALL saved analyses (not filtered by fileName)
                    let saved = [];
                    if (window.electronAPI) {
                        const result = await window.electronAPI.loadAnalyses();
                        if (result.success) {
                            saved = result.data || [];
                        }
                    }
                    
                    // Filter out deleted items - ensure ID comparison works correctly
                    // Use strict string comparison to avoid type coercion issues
                    const filtered = saved.filter(item => {
                        const itemId = String(item.id);
                        return !idsToDelete.includes(itemId);
                    });
                    
                    // Save back to file storage
                    if (window.electronAPI) {
                        const saveResult = await window.electronAPI.saveAnalyses(filtered);
                        if (!saveResult.success) {
                            alert('Error deleting analyses: ' + (saveResult.error || 'Unknown error'));
                            return;
                        }
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

async function loadSavedAnalyses() {
    let saved = [];
    try {
        if (window.electronAPI) {
            const result = await window.electronAPI.loadAnalyses();
            if (result.success) {
                saved = result.data || [];
            }
        }
    } catch (error) {
        console.error('Error loading saved analyses:', error);
    }
    
    // Clean up already completed files: remove status/progress fields from items that have analysis data
    let needsCleanup = false;
    saved = saved.map(item => {
        // If item has analysis data but still has processing status, it's actually completed
        if (item.analysis && item.status === 'processing') {
            needsCleanup = true;
            // Create new object without status and progress fields
            const { status, progress, ...cleanedItem } = item;
            return cleanedItem;
        }
        return item;
    });
    
    // Save cleaned data back to storage if cleanup was needed
    if (needsCleanup && window.electronAPI) {
        try {
            await window.electronAPI.saveAnalyses(saved);
        } catch (error) {
            console.error('Error saving cleaned analyses:', error);
        }
    }
    
    savedAnalysesList.innerHTML = '';

    if (saved.length === 0) {
        savedAnalysesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No saved analyses yet.</p>';
        return;
    }

    // Separate processing items from completed items
    const processingItems = saved.filter(item => item.status === 'processing');
    const completedItems = saved.filter(item => !item.status || item.status !== 'processing');
    
    // For completed items: filter duplicates - keep only the latest version of each fileName
    const fileMap = new Map();
    completedItems.forEach(item => {
        const fileName = item.fileName;
        const itemDate = new Date(item.date);
        
        if (!fileMap.has(fileName)) {
            // First occurrence of this fileName
            fileMap.set(fileName, item);
        } else {
            // Compare dates and keep the newer one
            const existingDate = new Date(fileMap.get(fileName).date);
            if (itemDate > existingDate) {
                fileMap.set(fileName, item);
            }
        }
    });
    
    // Convert completed items map to array and sort by date (newest first)
    const filteredCompleted = Array.from(fileMap.values()).sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
    });
    
    // Sort processing items by date (newest first) and combine with completed items
    const sortedProcessing = processingItems.sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
    });
    
    // Show processing items FIRST, then completed items
    const filtered = [...sortedProcessing, ...filteredCompleted];

    if (filtered.length === 0) {
        savedAnalysesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No saved analyses yet.</p>';
        return;
    }

    // Display filtered results (already sorted newest first)
    filtered.forEach(item => {
        const savedItem = document.createElement('div');
        const isProcessing = item.status === 'processing';
        
        // Add processing class if item is processing
        savedItem.className = isProcessing ? 'saved-item saved-item-processing' : 'saved-item';
        
        const date = new Date(item.date);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        // Add checkbox if in edit mode
        const checkboxHtml = isEditMode ? 
            `<input type="checkbox" class="saved-item-checkbox" data-item-id="${escapeHtml(item.id)}">` : '';
        
        if (isProcessing) {
            // Processing item: show fileName and "analyzing (X%)" text, no rename button
            const progress = item.progress || 0;
            savedItem.innerHTML = `
                <div class="saved-item-content-wrapper">
                    ${checkboxHtml}
                    <div class="saved-item-content">
                        <div class="saved-item-top-row">
                            <span class="saved-item-name">${escapeHtml(item.fileName)}</span>
                            <span class="saved-item-processing-text">analyzing (${progress}%)</span>
                        </div>
                        <div class="saved-item-bottom-row">
                            <span class="saved-item-date">${dateStr}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // Completed item: show with rename button and click functionality
            savedItem.innerHTML = `
                <div class="saved-item-content-wrapper">
                    ${checkboxHtml}
                    <div class="saved-item-content">
                        <div class="saved-item-top-row">
                            <span class="saved-item-name">${escapeHtml(item.fileName)}</span>
                            <button class="saved-item-rename-btn" data-item-id="${escapeHtml(item.id)}">rename</button>
                            <input type="text" class="saved-item-rename-input" value="${escapeHtml(item.fileName)}" data-item-id="${escapeHtml(item.id)}" style="display: none;">
                            <button class="saved-item-save-btn" data-item-id="${escapeHtml(item.id)}" style="display: none;">save</button>
                        </div>
                        <div class="saved-item-bottom-row">
                            <span class="saved-item-date">${dateStr}</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Add rename functionality only for completed items
            const renameBtn = savedItem.querySelector('.saved-item-rename-btn');
            const renameInput = savedItem.querySelector('.saved-item-rename-input');
            const nameSpan = savedItem.querySelector('.saved-item-name');
            const saveBtn = savedItem.querySelector('.saved-item-save-btn');
            
            // Function to save the rename
            const saveRename = async () => {
                const newName = renameInput.value.trim();
                if (!newName) {
                    // Restore original if empty
                    renameInput.value = item.fileName;
                    return;
                }
                
                if (newName !== item.fileName) {
                    // Update the item
                    item.fileName = newName;
                    
                    // Save updated analyses
                    try {
                        let saved = [];
                        if (window.electronAPI) {
                            const result = await window.electronAPI.loadAnalyses();
                            if (result.success) {
                                saved = result.data || [];
                            }
                        }
                        
                        // Find and update the item
                        const index = saved.findIndex(s => s.id === item.id);
                        if (index !== -1) {
                            saved[index].fileName = newName;
                            
                            if (window.electronAPI) {
                                await window.electronAPI.saveAnalyses(saved);
                                // Update the displayed name
                                nameSpan.textContent = newName;
                            }
                        }
                    } catch (error) {
                        console.error('Error renaming:', error);
                        alert('Error renaming file: ' + error.message);
                        // Restore original value on error
                        renameInput.value = item.fileName;
                        return;
                    }
                }
                
                // Exit rename mode
                renameBtn.style.display = '';
                nameSpan.style.display = '';
                renameInput.style.display = 'none';
                if (saveBtn) saveBtn.style.display = 'none';
            };
            
            // Function to exit rename mode without saving
            const cancelRename = () => {
                renameInput.value = item.fileName;
                renameBtn.style.display = '';
                nameSpan.style.display = '';
                renameInput.style.display = 'none';
                if (saveBtn) saveBtn.style.display = 'none';
            };
            
            if (renameBtn && renameInput && nameSpan) {
                // Click rename button to show input field
                renameBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    // Hide button and name, show input in place of name
                    renameBtn.style.display = 'none';
                    nameSpan.style.display = 'none';
                    // Move input to replace the name in the top row
                    const topRow = savedItem.querySelector('.saved-item-top-row');
                    topRow.insertBefore(renameInput, renameBtn);
                    renameInput.style.display = 'block';
                    if (saveBtn) saveBtn.style.display = 'block';
                    renameInput.focus();
                    renameInput.select();
                });
                
                // Save button click handler
                if (saveBtn) {
                    saveBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await saveRename();
                    });
                }
                
                // Enter key saves, Escape cancels rename
                renameInput.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        await saveRename();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                    }
                });
                
                // Prevent item click when clicking on rename button, input, or save button
                renameBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                renameInput.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                if (saveBtn) {
                    saveBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                    });
                }
            }
        }
        
        // Add click handler - only if not in edit mode and not processing
        if (!isEditMode && !isProcessing) {
            savedItem.addEventListener('click', async (e) => {
                // Don't trigger if clicking rename button, input, or save button
                if (e.target.classList.contains('saved-item-rename-btn') || 
                    e.target.classList.contains('saved-item-rename-input') ||
                    e.target.classList.contains('saved-item-save-btn')) {
                    return;
                }
                await reopenAnalysis(item);
            });
        } else {
            // In edit mode, clicking the checkbox should toggle it
            const checkbox = savedItem.querySelector('.saved-item-checkbox');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent item click
                });
            }
            // Clicking the item should toggle checkbox
            savedItem.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox' && 
                    !e.target.classList.contains('saved-item-rename-btn') &&
                    !e.target.classList.contains('saved-item-rename-input') &&
                    !e.target.classList.contains('saved-item-save-btn')) {
                    const checkbox = savedItem.querySelector('.saved-item-checkbox');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                    }
                }
            });
        }
        
        savedAnalysesList.appendChild(savedItem);
    });
}

async function reopenAnalysis(savedItem) {
    await reinitializeAPIKey();
    currentAnalysis = savedItem.analysis;
    currentChatHistory = savedItem.chatHistory || [];
    currentSubtitleData = savedItem.subtitleData;
    
    // Apply deduplication to saved analysis (in case it was saved before deduplication was added)
    if (currentAnalysis && currentAnalysis.translations && currentAnalysis.translations.length > 0) {
        const translationsMap = new Map();
        
        currentAnalysis.translations.forEach(trans => {
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
        
        const duplicatesRemoved = currentAnalysis.translations.length - translationsMap.size;
        currentAnalysis.translations = Array.from(translationsMap.values());
        
        if (duplicatesRemoved > 0) {
            console.log(`Deduplication applied to saved analysis: ${currentAnalysis.translations.length} unique translations (removed ${duplicatesRemoved} duplicates)`);
        }
    }
    
    // Reset pagination to first page when reopening saved analysis
    currentPage = 1;
    
    fileName.textContent = savedItem.fileName;
    scriptName.textContent = savedItem.fileName;
    fileInfo.style.display = 'flex';
    
    displayAnalysis(currentAnalysis);
    
    // Chat messages are only restored in study modal, not in main view
    // Chat history is preserved but not displayed in main view
    
    // Show views (no chat or expressions in main view)
    savedAnalysesView.style.display = 'none';
    uploadSection.style.display = 'none';
    resultsSection.style.display = 'flex';
    chatSection.style.display = 'none'; // Hide chat in main view
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
            if (window.electronAPI) {
                const result = await window.electronAPI.loadApiKey();
                if (result.success && result.key) {
                    // Show partially masked key
                    const masked = result.key.substring(0, 7) + '...' + result.key.substring(result.key.length - 4);
                    apiKeyInput.value = masked;
                    apiKeyInput.type = 'text';
                } else {
                    apiKeyInput.value = '';
                    apiKeyInput.type = 'password';
                }
            } else {
                apiKeyInput.value = '';
                apiKeyInput.type = 'password';
            }
        } catch (error) {
            console.error('Error loading API key:', error);
            apiKeyInput.value = '';
            apiKeyInput.type = 'password';
        }
        
        settingsView.style.display = 'flex';
        resultsSection.style.display = 'none';
        uploadSection.style.display = 'none';
        chatSection.style.display = 'none';
        savedAnalysesView.style.display = 'none';
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsView.style.display = 'none';
        if (currentAnalysis) {
            // If analysis completed while in settings, ensure it's displayed
            displayAnalysis(currentAnalysis);
            resultsSection.style.display = 'flex';
            chatSection.style.display = 'none'; // No chat in main view
            // Hide expressions section
            if (expressionsContent && expressionsContent.parentElement) {
                expressionsContent.parentElement.style.display = 'none';
            }
        } else {
            uploadSection.style.display = 'flex';
        }
    });

    saveApiKeyBtn.addEventListener('click', async () => {
        const newApiKey = apiKeyInput.value.trim();
        
        if (!newApiKey) {
            alert('Please enter an API key.');
            return;
        }
        
        // If it's a masked key, don't save it
        if (newApiKey.includes('...')) {
            alert('Please enter a new API key to update.');
            return;
        }
        
        try {
            if (window.electronAPI) {
                const result = await window.electronAPI.saveApiKey(newApiKey);
                if (result.success) {
                    apiKey = newApiKey; // Update local variable
                    alert('API key saved successfully!');
                    apiKeyInput.type = 'password';
                    apiKeyInput.value = '';
                } else {
                    alert('Error saving API key: ' + (result.error || 'Unknown error'));
                }
            } else {
                alert('Storage API not available');
            }
        } catch (error) {
            console.error('Error saving API key:', error);
            alert('Error saving API key: ' + error.message);
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
        showChatHistory(currentStudyChatHistory);
    });

    // Save study session button
    if (saveStudyBtn) {
        saveStudyBtn.addEventListener('click', async () => {
            await saveStudySession();
        });
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
}); // End of DOMContentLoaded

// Helper function to find timestamp for Swedish text
function findTimestampForText(swedishText) {
    if (!currentSubtitleData || !swedishText) return null;
    
    const searchText = swedishText.toLowerCase().trim();
    
    // First try exact match
    for (const cue of currentSubtitleData) {
        if (cue.text && cue.text.toLowerCase().trim() === searchText) {
            return { start: cue.start, end: cue.end };
        }
    }
    
    // Then try partial match (text contains search or search contains text)
    for (const cue of currentSubtitleData) {
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
        for (const cue of currentSubtitleData) {
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
    
    // Display the item
    studyItemContent.innerHTML = '';
    studyExpressionsContent.innerHTML = '';
    studyExpressionsSection.style.display = 'block'; // Always show the section
    
    if (type === 'translation') {
        studyTitle.textContent = 'Line-by-Line Study';
        let html = '';
        
        // Display timestamp at the top
        if (timestamp && timestamp.start) {
            html += `<div class="study-timestamp">${escapeHtml(timestamp.start)}</div>`;
        }
        
        html += `<div class="swedish-text">${escapeHtml(fixEncoding(item.swedish))}</div>`;
        
        if (item.literal) {
            html += `<div class="translation-label">Literal Translation</div>`;
            html += `<div class="translation-text">${escapeHtml(fixEncoding(item.literal))}</div>`;
        }
        
        if (item.natural && item.natural !== item.literal) {
            html += `<div class="translation-label">Natural Translation</div>`;
            html += `<div class="translation-text">${escapeHtml(fixEncoding(item.natural))}</div>`;
        }
        
        studyItemContent.innerHTML = html;
        
        // Display related expressions using displayStudyExpressions() for consistency
        displayStudyExpressions();
        
        // Get related expressions for chat context (used in system message)
        let relatedExpressions = [];
        if (currentAnalysis && currentAnalysis.expressions && currentAnalysis.expressions.length > 0) {
                    const swedishText = item.swedish.toLowerCase();
            relatedExpressions = currentAnalysis.expressions.filter(expr => {
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
        
        studyItemContent.innerHTML = html;
        
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
    
    // Load saved study session if exists (expressions will be restored, but chat stays empty)
    await loadStudySession();
    
    // Ensure chat area remains empty after loading (history is available via Chat history button only)
    studyChatMessages.innerHTML = '';
    studyChatInput.value = '';
}

// Save study session (expressions and chat history)
async function saveStudySession() {
    if (!currentStudyItem || !currentAnalysis) {
        alert('No study session to save.');
        return;
    }

    try {
        // Get expressions associated with this translation
        let associatedExpressions = [];
        if (currentAnalysis.expressions && currentAnalysis.expressions.length > 0) {
            if (currentStudyItem.type === 'translation') {
                const translationIndex = currentStudyItem.index;
                const swedishText = currentStudyItem.item.swedish.toLowerCase();
                
                associatedExpressions = currentAnalysis.expressions.filter(expr => {
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
        let savedSessions = [];
        if (window.electronAPI && window.electronAPI.loadStudySessions) {
            try {
                const result = await window.electronAPI.loadStudySessions();
                if (result && result.success) {
                    savedSessions = result.data || [];
                }
            } catch (error) {
                console.error('Error loading study sessions:', error);
                // Continue with empty array if load fails
                savedSessions = [];
            }
        }

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
        if (window.electronAPI && window.electronAPI.saveStudySessions) {
            try {
                const saveResult = await window.electronAPI.saveStudySessions(savedSessions);
                if (saveResult && saveResult.success) {
                    alert('Study session saved!');
                } else {
                    alert('Error saving study session: ' + (saveResult?.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Error saving study session:', error);
                alert('Error saving study session: ' + error.message);
            }
        } else {
            alert('Storage API not available. Please restart the application.');
        }
    } catch (error) {
        console.error('Error saving study session:', error);
        alert('Error saving study session: ' + error.message);
    }
}

// Load saved study session for current translation
async function loadStudySession() {
    if (!currentStudyItem || !currentAnalysis) {
        return;
    }

    try {
        // Load saved study sessions
        let savedSessions = [];
        if (window.electronAPI && window.electronAPI.loadStudySessions) {
            try {
                const result = await window.electronAPI.loadStudySessions();
                if (result && result.success) {
                    savedSessions = result.data || [];
                }
            } catch (error) {
                console.error('Error loading study sessions:', error);
                // Continue with empty array if load fails
                savedSessions = [];
            }
        }

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
                if (!currentAnalysis.expressions) {
                    currentAnalysis.expressions = [];
                }

                savedSession.expressions.forEach(savedExpr => {
                    // Check if expression already exists
                    const exists = currentAnalysis.expressions.some(expr => 
                        normalizeTextForMatching(expr.word || '') === normalizeTextForMatching(savedExpr.word || '')
                    );

                    if (!exists) {
                        currentAnalysis.expressions.push(savedExpr);
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
    
    if (!currentAnalysis) {
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        return;
    }
    
    studyExpressionsContent.innerHTML = '';
    studyExpressionsSection.style.display = 'block'; // Always show section
    
    if (!currentAnalysis.expressions || currentAnalysis.expressions.length === 0) {
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        return;
    }
    
    // Filter expressions based on current study item
    let expressionsToShow = [];
    
    if (currentStudyItem && currentStudyItem.type === 'translation') {
        // Filter expressions that belong to this translation
        const currentTranslationIndex = currentStudyItem.index;
        const currentSwedishText = currentStudyItem.item.swedish.toLowerCase();
        
        expressionsToShow = currentAnalysis.expressions.filter(expr => {
            // Check if expression is associated with this translation by index
            if (expr.translationIndex !== undefined && expr.translationIndex === currentTranslationIndex) {
                return true;
            }
            
            // Backward compatibility: include expressions where the word appears in the Swedish text
            // (for expressions added before this feature or from main chat without translationIndex)
            if (expr.translationIndex === undefined) {
                const exprWord = expr.word.toLowerCase();
                // Check if the expression word appears in the Swedish text
                return currentSwedishText.includes(exprWord) || exprWord.split(' ').some(w => currentSwedishText.includes(w));
            }
            
            // Exclude expressions associated with other translations
            return false;
        });
    } else {
        // If no study item or it's an expression type, show empty
        expressionsToShow = [];
    }
    
    // Filter expressions by selected levels from main window filter
    expressionsToShow = expressionsToShow.filter(expr => {
        // If expression has no level field, show it (backward compatibility)
        if (!expr.level) {
            return true;
        }
        // Only show expressions matching selected levels from main window filter
        return selectedLevels.includes(expr.level);
    });
    
    if (expressionsToShow.length > 0) {
        expressionsToShow.forEach(expr => {
            const exprDiv = document.createElement('div');
            exprDiv.className = 'study-expression-item';
            
            // Add data attribute for level (for hover popup)
            if (expr.level) {
                exprDiv.setAttribute('data-expression-level', expr.level);
            }
            
            let exprHtml = `<div class="study-expression-header">`;
            exprHtml += `<span class="study-expression-word">${escapeHtml(fixEncoding(expr.word))}</span>`;
            // Level badge removed - will show in hover popup instead
            exprHtml += `</div>`;
            
            // No inline popup markup; we will use a single global fixed-position popup
            
            if (expr.meaning) {
                exprHtml += `<div class="study-expression-meaning">${escapeHtml(fixEncoding(expr.meaning))}</div>`;
            }
            if (expr.example) {
                exprHtml += `<div class="study-expression-example">Example: ${escapeHtml(fixEncoding(expr.example))}</div>`;
            }
            
            exprDiv.innerHTML = exprHtml;

            // Add hover event listeners to show a global (fixed) level popup so it isn't clipped
            if (expr.level) {
                let globalPopup = document.getElementById('globalLevelPopup');
                if (!globalPopup) {
                    globalPopup = document.createElement('div');
                    globalPopup.id = 'globalLevelPopup';
                    globalPopup.className = 'level-popup-global';
                    document.body.appendChild(globalPopup);
                }
                const levelText = `${escapeHtml(expr.level)}`;
                exprDiv.addEventListener('mouseenter', () => {
                    globalPopup.textContent = levelText;
                    // Position to the left of the expression item, vertically centered
                    const rect = exprDiv.getBoundingClientRect();
                    const top = rect.top + (rect.height / 2);
                    const left = rect.left; // anchor at left edge of item
                    globalPopup.style.top = `${top}px`;
                    globalPopup.style.left = `${left}px`;
                    globalPopup.classList.add('show');
                });
                exprDiv.addEventListener('mouseleave', () => {
                    globalPopup.classList.remove('show');
                });
            }
            
            studyExpressionsContent.appendChild(exprDiv);
        });
    } else {
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
    }
}

// Display expressions (refresh the expressions section)
function displayExpressions() {
    // Check if DOM element exists
    if (!expressionsContent) {
        console.error('Expressions content DOM element not found');
        return;
    }
    
    if (!currentAnalysis || !currentAnalysis.expressions) return;
    
    expressionsContent.innerHTML = '';
    
    // Filter expressions based on selected levels
    const filteredExpressions = currentAnalysis.expressions.filter(expr => {
        // If expression has no level field, show it (backward compatibility)
        if (!expr.level) {
            return true;
        }
        // Only show expressions matching selected levels
        return selectedLevels.includes(expr.level);
    });
    
    filteredExpressions.forEach((expr) => {
        const item = document.createElement('div');
        item.className = 'expression-item';
        
        // Find original index in full expressions array
        const originalIndex = currentAnalysis.expressions.findIndex(e => e === expr);
        
        // Find timestamp for expression if it appears in subtitle text
        const timestamp = findTimestampForText(expr.word);
        const timestampStr = timestamp ? formatTimestamp(timestamp) : '';
        
        let html = `<div class="expression-item-content">`;
        if (timestampStr) {
            html += `<div class="expression-timestamp">${escapeHtml(timestampStr)}</div>`;
        } else {
            // Always show timestamp column, even if empty
            html += `<div class="expression-timestamp"></div>`;
        }
        html += `<div class="expression-text-wrapper">`;
        html += `<span class="expression-word">${escapeHtml(fixEncoding(expr.word))}</span>`;
        if (expr.meaning) {
            html += `<span class="expression-meaning">${escapeHtml(fixEncoding(expr.meaning))}</span>`;
        }
        if (expr.example) {
            html += `<div style="margin-top: 4px; font-size: 12px; color: #999;">Example: ${escapeHtml(fixEncoding(expr.example))}</div>`;
        }
        html += `</div></div>`;
        
        item.innerHTML = html;
        item.addEventListener('click', () => openStudyModal('expression', expr, originalIndex));
        expressionsContent.appendChild(item);
    });
}

// Show chat history
function showChatHistory(chatHistory) {
    chatHistoryContent.innerHTML = '';
    
    if (!chatHistory || chatHistory.length === 0) {
        chatHistoryContent.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No chat history yet.</p>';
        chatHistoryModal.style.display = 'flex';
        return;
    }
    
    chatHistory.forEach((msg, index) => {
        if (msg.role === 'system') return; // Skip system messages
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-history-message ${msg.role}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'chat-history-bubble';
        bubble.innerHTML = markdownToHtml(msg.content);
        
        messageDiv.appendChild(bubble);
        chatHistoryContent.appendChild(messageDiv);
    });
    
    chatHistoryModal.style.display = 'flex';
}

// Send study chat message
async function sendStudyChatMessage() {
    const message = studyChatInput.value.trim();
    if (!message || !apiKey || !currentStudyItem) return;

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
    addStudyChatMessage('user', message);
    currentStudyChatHistory.push({ role: 'user', content: message });
    
    studyChatInput.value = '';
    studyChatSendBtn.disabled = true;
    
    // Show loading
    const loadingId = addStudyChatMessage('assistant', 'Thinking...', null);
    
    try {
        const assistantMessage = await callOpenAI(currentStudyChatHistory);
        
        // Extract Swedish word from GPT response using improved detection
        let detectedSwedishWord = null;
        
        // Check if user's question was about a Swedish word/expression
        const userMessage = currentStudyChatHistory[currentStudyChatHistory.length - 1]?.content || '';
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
        removeStudyChatMessage(loadingId);
        addStudyChatMessage('assistant', assistantMessage, wordToSave);
        
        currentStudyChatHistory.push({ role: 'assistant', content: assistantMessage });
        
        // If Swedish word detected and user asked about it, send follow-up message
        if (detectedSwedishWord && isQuestionAboutSwedishWord) {
            const followUpMessage = `Do you want to add "${detectedSwedishWord}" to the list, Important Expressions & Words?`;
            // Store the original GPT response as a data attribute so button can access it
            const followUpId = addStudyChatMessage('assistant', followUpMessage, null);
            // Store the original GPT response content in a custom data attribute
            const followUpElement = document.getElementById(followUpId);
            if (followUpElement) {
                followUpElement.dataset.originalGptResponse = assistantMessage;
            }
            currentStudyChatHistory.push({ role: 'assistant', content: followUpMessage });
        }
        
    } catch (error) {
        console.error('Study chat error:', error);
        removeStudyChatMessage(loadingId);
        addStudyChatMessage('assistant', 'Sorry, I encountered an error. Please try again.', null);
    } finally {
        studyChatSendBtn.disabled = false;
    }
}

// Add expression from study chat
async function addExpressionFromStudyChat(word, gptResponseContent = null) {
    if (!apiKey || !word) {
        console.error('Missing API key or word', { apiKey: !!apiKey, word });
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
        // Initialize currentAnalysis if it doesn't exist
        if (!currentAnalysis) {
            currentAnalysis = {
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
        const existingExpr = currentAnalysis.expressions?.find(
            expr => expr.word?.toLowerCase() === dictionaryForm.toLowerCase()
        );
        if (existingExpr) {
            console.log('Expression already exists:', dictionaryForm);
            addStudyChatMessage('assistant', `"${dictionaryForm}" is already in Important Expressions & Words.`, null);
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
        
        if (!currentAnalysis.expressions) {
            currentAnalysis.expressions = [];
        }
        
        currentAnalysis.expressions.push(newExpression);
        console.log('Added expression to currentAnalysis:', newExpression);
        console.log('Total expressions now:', currentAnalysis.expressions.length);
        
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
        addStudyChatMessage('assistant', `Sorry, I couldn't add "${word}". Error: ${error.message}`, null);
    }
}

function addStudyChatMessage(role, content, wordToSave = null) {
    const messageDiv = document.createElement('div');
    const messageId = 'study-msg-' + Date.now();
    messageDiv.id = messageId;
    messageDiv.className = `study-chat-message ${role}`;
    
    // Wrap bubble in container for button positioning
    const bubbleContainer = document.createElement('div');
    bubbleContainer.className = 'study-message-bubble-container';
    
    const bubble = document.createElement('div');
    bubble.className = 'study-message-bubble';
    bubble.innerHTML = markdownToHtml(content);
    
    bubbleContainer.appendChild(bubble);
    
    // Add "Add" button only for follow-up messages asking to add expression/word
    const isFollowUpMessage = content.toLowerCase().includes('do you want to add') && 
                              content.toLowerCase().includes('to the list');
    
    if (role === 'assistant' && isFollowUpMessage) {
        bubbleContainer.classList.add('has-button');
        const saveBtn = document.createElement('button');
        saveBtn.className = 'add-to-list-btn';
        saveBtn.textContent = 'Add';
        saveBtn.title = 'Add this word/expression to Important Expressions & Words';
        saveBtn.addEventListener('click', async () => {
            try {
                // Extract word from follow-up message: "Do you want to add 'hem' to the list?"
                let word = null;
                
                // Extract word from quotes in the message
                const quotedMatch = content.match(/add\s+['"]([^'"]+)['"]/i);
                if (quotedMatch) {
                    word = quotedMatch[1].trim();
                } else {
                    // Try alternative pattern: "add [word] to"
                    const wordMatch = content.match(/add\s+([^\s]+)/i);
                    if (wordMatch) {
                        word = wordMatch[1].trim().replace(/['"]/g, '');
                    }
                }
                
                if (!word) {
                    alert('Could not extract word from message. Please try again.');
                    return;
                }
                
                // Add the word
                saveBtn.disabled = true;
                saveBtn.textContent = 'saving...';
                
                // Get the original GPT response from the message element's data attribute
                const messageElement = saveBtn.closest('.study-chat-message');
                const originalGptResponse = messageElement?.dataset?.originalGptResponse || null;
                
                // Pass the original GPT response to extract dictionary form and meanings
                await addExpressionFromStudyChat(word, originalGptResponse);
                
                saveBtn.disabled = false;
                saveBtn.textContent = 'added ✓';
                setTimeout(() => {
                    saveBtn.textContent = 'Add';
                }, 2000);
            } catch (error) {
                console.error('Error adding expression:', error);
                saveBtn.disabled = false;
                saveBtn.textContent = 'error, try again';
                setTimeout(() => {
                    saveBtn.textContent = 'Add';
                }, 2000);
            }
        });
        bubbleContainer.appendChild(saveBtn);
    }
    
    messageDiv.appendChild(bubbleContainer);
    studyChatMessages.appendChild(messageDiv);
    
    // Scroll to bottom
    studyChatMessages.scrollTop = studyChatMessages.scrollHeight;
    
    return messageId;
}

function removeStudyChatMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) {
        message.remove();
    }
}

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

