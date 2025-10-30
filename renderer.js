// State management
let currentAnalysis = null;
let currentChatHistory = [];
let currentSubtitleData = null;
let apiKey = null;
let isAnalyzing = false;

// DOM elements (will be initialized when DOM is ready)
let uploadArea, fileInput, fileInfo, fileName, analyzeBtn, resultsSection, uploadSection;
let translationsContent, expressionsContent, chatSection, chatMessages, chatInput, chatSendBtn;
let saveAnalysisBtn, savedAnalysesBtn, savedAnalysesView, savedAnalysesList, editSavedBtn, goBackBtn, closeResultsBtn;
let settingsBtn, settingsView, closeSettingsBtn, apiKeyInput, saveApiKeyBtn, themeSelect;
let homeBtn;
let studyModal, studyTitle, studyItemContent, studyExpressionsSection, studyExpressionsContent, studyChatMessages, studyChatInput, studyChatSendBtn, closeStudyBtn, studyHistoryBtn;
let chatHistoryModal, chatHistoryContent, closeHistoryBtn;

// Study modal state
let currentStudyItem = null;
let currentStudyChatHistory = [];
let isEditMode = false;

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

// OpenAI API call function
async function callOpenAI(messages, model = 'gpt-4o-mini') {
    if (!apiKey) {
        throw new Error('API key not set');
    }

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
            max_tokens: 4000
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    return data.choices[0].message.content;
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
            // Save previous cue if exists
            if (currentCue && textBuffer.length > 0) {
                currentCue.text = textBuffer.join(' ').trim();
                if (currentCue.text) {
                    subtitles.push(currentCue);
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
            // Accumulate text lines
            textBuffer.push(line);
        }
    }

    // Save last cue
    if (currentCue && textBuffer.length > 0) {
        currentCue.text = textBuffer.join(' ').trim();
        if (currentCue.text) {
            subtitles.push(currentCue);
        }
    }

    return subtitles;
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
            subtitles.push({
                start: '--:--:--',
                end: '--:--:--',
                text: trimmedLine
            });
        }
    });
    
    console.log('parseTXT: Processed', lines.length, 'lines, created', subtitles.length, 'subtitle entries');
    return subtitles;
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
    
    // Initialize theme
    initializeTheme().catch(err => {
        console.error('Error initializing theme:', err);
    });

    // Home button functionality
    homeBtn.addEventListener('click', () => {
        // Don't allow going home if analysis is in progress
        if (isAnalyzing) {
            const confirmLeave = confirm('Analysis is in progress. Are you sure you want to leave? The analysis will continue in the background.');
            if (!confirmLeave) {
                return;
            }
        }
        
        // Close any open modals/views
        studyModal.style.display = 'none';
        savedAnalysesView.style.display = 'none';
        settingsView.style.display = 'none';
        
        // Reset to home/upload view
        uploadSection.style.display = 'flex';
        resultsSection.style.display = 'none';
        chatSection.style.display = 'none';
        
        // Reset file info
        fileInfo.style.display = 'none';
        scriptName.textContent = '';
        currentAnalysis = null;
        currentChatHistory = [];
        currentSubtitleData = null;
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

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const fileName = files[0].name.toLowerCase();
            if (fileName.endsWith('.vtt') || fileName.endsWith('.txt')) {
                await handleFileSelect(files[0]);
            }
        }
    });

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.vtt') || fileName.endsWith('.txt')) {
                await handleFileSelect(file);
            } else {
                alert('Please select a .vtt or .txt file.');
            }
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
            reader.readAsText(file);
        });
        
        // Detect file type and use appropriate parser (case-insensitive)
        const fileNameLower = file.name.toLowerCase();
        if (fileNameLower.endsWith('.vtt')) {
            currentSubtitleData = parseVTT(content);
            console.log('Parsed VTT file, subtitle count:', currentSubtitleData ? currentSubtitleData.length : 0);
        } else if (fileNameLower.endsWith('.txt')) {
            currentSubtitleData = parseTXT(content);
            console.log('Parsed TXT file, subtitle count:', currentSubtitleData ? currentSubtitleData.length : 0);
        } else {
            alert('Unsupported file type. Please upload a .vtt or .txt file.');
            currentSubtitleData = null;
            return;
        }
        
        // Ensure we have valid data
        if (!currentSubtitleData || currentSubtitleData.length === 0) {
            alert('The file appears to be empty or could not be parsed. Please check the file contains text and try again.');
            currentSubtitleData = null;
            fileInfo.style.display = 'none';
            return;
        }
        
        fileName.textContent = file.name;
        scriptName.textContent = file.name;
        fileInfo.style.display = 'flex';
        
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

    // Analyze button
    analyzeBtn.addEventListener('click', async () => {
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
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';

        try {
            // Combine all subtitle text
            let subtitleText = currentSubtitleData.map(cue => cue.text).join('\n');
            
            // Add size limit to prevent extremely large API requests (especially for txt files)
            const MAX_TEXT_LENGTH = 15000;
            let wasTruncated = false;
            
            if (subtitleText.length > MAX_TEXT_LENGTH) {
                subtitleText = subtitleText.substring(0, MAX_TEXT_LENGTH);
                subtitleText += '\n\n[... file truncated due to size limit ...]';
                wasTruncated = true;
                console.warn(`File is very large (${currentSubtitleData.length} entries). Only first ${MAX_TEXT_LENGTH} characters will be analyzed.`);
            }
            
            console.log(`Analyzing ${subtitleText.length} characters from ${currentSubtitleData.length} entries...`);

            // Create analysis prompt
            const analysisPrompt = `Analyze the following Swedish subtitle text and provide:

1. English translations for each significant phrase or sentence. For each translation, provide:
   - The Swedish text
   - Literal English translation
   - Natural English translation (only if significantly different from literal)

2. Important expressions and words with their meanings and usage examples.

${wasTruncated ? 'Note: This text was truncated due to length. Focus on analyzing the beginning portion.\n\n' : ''}Format the response as JSON with this structure:
{
  "translations": [
    {
      "swedish": "Swedish text here",
      "literal": "Literal English translation",
      "natural": "Natural English translation (if different)"
    }
  ],
  "expressions": [
    {
      "word": "Swedish word/phrase",
      "meaning": "English meaning",
      "example": "Usage example"
    }
  ]
}

Swedish subtitle text:
${subtitleText}`;

            const messages = [
                {
                    role: 'system',
                    content: 'You are a Swedish language tutor. Provide clear, accurate translations and explanations.'
                },
                {
                    role: 'user',
                    content: analysisPrompt
                }
            ];

            const content = await callOpenAI(messages);
            
            // Try to parse JSON response
            let analysisData;
            try {
                // Extract JSON from markdown code blocks if present
                const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
                if (jsonMatch) {
                    analysisData = JSON.parse(jsonMatch[1]);
                } else {
                    analysisData = JSON.parse(content);
                }
            } catch (e) {
                // If JSON parsing fails, create a structured response from text
                analysisData = {
                    translations: [],
                    expressions: []
                };
                
                // Try to extract information from text response
                const lines = content.split('\n');
                let currentSection = null;
                
                for (const line of lines) {
                    if (line.toLowerCase().includes('translation')) {
                        currentSection = 'translations';
                    } else if (line.toLowerCase().includes('expression') || line.toLowerCase().includes('word')) {
                        currentSection = 'expressions';
                    }
                }
                
                // Store raw response as fallback
                analysisData.rawResponse = content;
            }

            currentAnalysis = analysisData;
            displayAnalysis(analysisData);
            
            // Check which view is currently active
            const isInSettings = settingsView.style.display === 'flex';
            const isInSavedAnalyses = savedAnalysesView.style.display === 'flex';
            const isInStudyModal = studyModal && studyModal.style.display !== 'none';
            
            // Only auto-switch to results if user is not in another view
            if (!isInSettings && !isInSavedAnalyses && !isInStudyModal) {
                // Show results only (no chat or expressions in main view)
                uploadSection.style.display = 'none';
                resultsSection.style.display = 'flex';
                chatSection.style.display = 'none';
                // Hide expressions section
                if (expressionsContent && expressionsContent.parentElement) {
                    expressionsContent.parentElement.style.display = 'none';
                }
            }
            // If user is in settings/saved analyses, analysis data is already stored
            // and will be shown when they return (handled by closeSettingsBtn)
            
            // Initialize chat history with analysis context
            currentChatHistory = [
                {
                    role: 'system',
                    content: 'You are helping the user understand Swedish subtitles. The user has just analyzed a subtitle file.'
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
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze';
        }
    });

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

// Display analysis results
function displayAnalysis(data) {
    // Display translations
    translationsContent.innerHTML = '';
    
    if (data.rawResponse) {
        // Fallback: display raw response
        translationsContent.innerHTML = `<div class="translation-item"><pre style="white-space: pre-wrap; color: #ccc;">${data.rawResponse}</pre></div>`;
    } else if (data.translations && data.translations.length > 0) {
        data.translations.forEach((trans, index) => {
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
            html += `<div class="swedish-text">${escapeHtml(trans.swedish)}</div>`;
            
            if (trans.literal) {
                html += `<div class="translation-label">Literal Translation</div>`;
                html += `<div class="translation-text">${escapeHtml(trans.literal)}</div>`;
            }
            
            if (trans.natural && trans.natural !== trans.literal) {
                html += `<div class="translation-label">Natural Translation</div>`;
                html += `<div class="translation-text">${escapeHtml(trans.natural)}</div>`;
            }
            html += `</div></div>`;
            
            item.innerHTML = html;
            item.addEventListener('click', () => openStudyModal('translation', trans, index, timestamp));
            translationsContent.appendChild(item);
        });
    } else {
        translationsContent.innerHTML = '<p style="color: #666;">No translations found.</p>';
    }

    // Expressions are only shown in study modal, not in main results view
    // Hide expressions section in main view
    if (expressionsContent && expressionsContent.parentElement) {
        expressionsContent.parentElement.style.display = 'none';
    }
}

// Open study modal with selected item
function openStudyModal(type, item, index, timestamp = null) {
    currentStudyItem = { type, item, index, timestamp };
    currentStudyChatHistory = [];
    
    // Display the item
    studyItemContent.innerHTML = '';
    studyExpressionsContent.innerHTML = '';
    studyExpressionsSection.style.display = 'block'; // Always show the section
    
    if (type === 'translation') {
        studyTitle.textContent = 'Study Translation';
        let html = '';
        
        // Display timestamp at the top
        if (timestamp && timestamp.start) {
            html += `<div class="study-timestamp">${escapeHtml(timestamp.start)}</div>`;
        }
        
        html += `<div class="swedish-text">${escapeHtml(item.swedish)}</div>`;
        
        if (item.literal) {
            html += `<div class="translation-label">Literal Translation</div>`;
            html += `<div class="translation-text">${escapeHtml(item.literal)}</div>`;
        }
        
        if (item.natural && item.natural !== item.literal) {
            html += `<div class="translation-label">Natural Translation</div>`;
            html += `<div class="translation-text">${escapeHtml(item.natural)}</div>`;
        }
        
        studyItemContent.innerHTML = html;
        
        // Find and display related expressions/words
        let relatedExpressions = [];
        if (currentAnalysis && currentAnalysis.expressions && currentAnalysis.expressions.length > 0) {
            const swedishText = item.swedish.toLowerCase();
            relatedExpressions = currentAnalysis.expressions.filter(expr => {
                const word = expr.word.toLowerCase();
                // Check if the expression word appears in the Swedish text
                return swedishText.includes(word) || word.split(' ').some(w => swedishText.includes(w));
            });
            
            if (relatedExpressions.length > 0) {
                relatedExpressions.forEach(expr => {
                    const exprDiv = document.createElement('div');
                    exprDiv.className = 'study-expression-item';
                    
                    let exprHtml = `<div class="study-expression-header">`;
                    exprHtml += `<span class="study-expression-word">${escapeHtml(expr.word)}</span>`;
                    exprHtml += `</div>`;
                    if (expr.meaning) {
                        exprHtml += `<div class="study-expression-meaning">${escapeHtml(expr.meaning)}</div>`;
                    }
                    if (expr.example) {
                        exprHtml += `<div class="study-expression-example">Example: ${escapeHtml(expr.example)}</div>`;
                    }
                    
                    exprDiv.innerHTML = exprHtml;
                    studyExpressionsContent.appendChild(exprDiv);
                });
            } else {
                // Show empty state message
                studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
            }
        } else {
            // Show empty state message
            studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        }
        
        // Initialize chat with context
        const relatedExprsText = relatedExpressions.length > 0
            ? relatedExpressions.map(expr => `${expr.word}: ${expr.meaning || 'N/A'}`).join('; ')
            : '';
        
        currentStudyChatHistory = [
            {
                role: 'system',
                content: `You are helping the user study Swedish. They are looking at this Swedish phrase: "${item.swedish}". Literal translation: "${item.literal || 'N/A'}". ${item.natural && item.natural !== item.literal ? `Natural translation: "${item.natural}".` : ''} ${relatedExprsText ? `Related expressions in this phrase: ${relatedExprsText}.` : ''} Answer their questions about this phrase, grammar, usage, or related vocabulary.`
            }
        ];
    } else if (type === 'expression') {
        studyTitle.textContent = 'Study Expression';
        let html = `<div class="expression-word">${escapeHtml(item.word)}</div>`;
        if (item.meaning) {
            html += `<div class="expression-meaning">${escapeHtml(item.meaning)}</div>`;
        }
        if (item.example) {
            html += `<div style="margin-top: 12px; padding: 12px; background-color: #111; border-radius: 6px; color: #999; font-size: 14px;">Example: ${escapeHtml(item.example)}</div>`;
        }
        
        studyItemContent.innerHTML = html;
        
        // Show empty expressions section for expression type too
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
        
        // Initialize chat with context
        currentStudyChatHistory = [
            {
                role: 'system',
                content: `You are helping the user study Swedish. They are looking at this Swedish expression/word: "${item.word}". Meaning: "${item.meaning || 'N/A'}". ${item.example ? `Example: "${item.example}".` : ''} Answer their questions about this expression, its usage, grammar, synonyms, or related vocabulary.`
            }
        ];
    }
    
    // Clear chat messages
    studyChatMessages.innerHTML = '';
    studyChatInput.value = '';
    
    // Show modal
    studyModal.style.display = 'flex';
}

// Close study modal
function closeStudyModal() {
    studyModal.style.display = 'none';
    currentStudyItem = null;
    currentStudyChatHistory = [];
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
                content: 'You are a Swedish language tutor. Provide clear, concise definitions.'
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
        
        // Create expression object
        const newExpression = {
            word: word,
            meaning: meaningResponse.trim(),
            example: ''
        };
        
        // Add to current analysis expressions
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

// Display expressions (refresh the expressions section)
function displayExpressions() {
    // Check if DOM element exists
    if (!expressionsContent) {
        console.error('Expressions content DOM element not found');
        return;
    }
    
    if (!currentAnalysis || !currentAnalysis.expressions) return;
    
    expressionsContent.innerHTML = '';
    
    currentAnalysis.expressions.forEach((expr, index) => {
        const item = document.createElement('div');
        item.className = 'expression-item';
        
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
        html += `<span class="expression-word">${escapeHtml(expr.word)}</span>`;
        if (expr.meaning) {
            html += `<span class="expression-meaning">${escapeHtml(expr.meaning)}</span>`;
        }
        if (expr.example) {
            html += `<div style="margin-top: 4px; font-size: 12px; color: #999;">Example: ${escapeHtml(expr.example)}</div>`;
        }
        html += `</div></div>`;
        
        item.innerHTML = html;
        item.addEventListener('click', () => openStudyModal('expression', expr, index));
        expressionsContent.appendChild(item);
    });
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
    
    // If we have a current study item (translation), show related expressions
    // Otherwise, show all expressions (for example, when adding from chat)
    let expressionsToShow = [];
    
    if (currentStudyItem && currentStudyItem.type === 'translation') {
        const swedishText = currentStudyItem.item.swedish.toLowerCase();
        expressionsToShow = currentAnalysis.expressions.filter(expr => {
            const word = expr.word.toLowerCase();
            return swedishText.includes(word) || word.split(' ').some(w => swedishText.includes(w));
        });
    } else {
        // If no specific translation context, show all expressions
        expressionsToShow = currentAnalysis.expressions;
    }
    
    if (expressionsToShow.length > 0) {
        expressionsToShow.forEach(expr => {
            const exprDiv = document.createElement('div');
            exprDiv.className = 'study-expression-item';
            
            let exprHtml = `<div class="study-expression-header">`;
            exprHtml += `<span class="study-expression-word">${escapeHtml(expr.word)}</span>`;
            exprHtml += `</div>`;
            if (expr.meaning) {
                exprHtml += `<div class="study-expression-meaning">${escapeHtml(expr.meaning)}</div>`;
            }
            if (expr.example) {
                exprHtml += `<div class="study-expression-example">Example: ${escapeHtml(expr.example)}</div>`;
            }
            
            exprDiv.innerHTML = exprHtml;
            studyExpressionsContent.appendChild(exprDiv);
        });
    } else {
        studyExpressionsContent.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found for this translation.</p>';
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
    bubble.textContent = content;
    
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
        isEditMode = false; // Reset edit mode when opening
        await loadSavedAnalyses();
        if (editSavedBtn) {
            updateEditButton();
        }
        savedAnalysesView.style.display = 'flex';
        resultsSection.style.display = 'none';
        uploadSection.style.display = 'none';
        chatSection.style.display = 'none';
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
                    // Get IDs of checked items
                    const idsToDelete = Array.from(checkedItems).map(cb => cb.dataset.itemId);
                    
                    // Load saved analyses
                    let saved = [];
                    if (window.electronAPI) {
                        const result = await window.electronAPI.loadAnalyses();
                        if (result.success) {
                            saved = result.data || [];
                        }
                    }
                    
                    // Filter out deleted items
                    const filtered = saved.filter(item => !idsToDelete.includes(item.id));
                    
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
    
    savedAnalysesList.innerHTML = '';

    if (saved.length === 0) {
        savedAnalysesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No saved analyses yet.</p>';
        return;
    }

    // Filter duplicates: keep only the latest version of each fileName
    const fileMap = new Map();
    saved.forEach(item => {
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
    
    // Convert map to array and sort by date (newest first)
    const filtered = Array.from(fileMap.values()).sort((a, b) => {
        return new Date(b.date) - new Date(a.date);
    });

    if (filtered.length === 0) {
        savedAnalysesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No saved analyses yet.</p>';
        return;
    }

    // Display filtered results (already sorted newest first)
    filtered.forEach(item => {
        const savedItem = document.createElement('div');
        savedItem.className = 'saved-item';
        
        const date = new Date(item.date);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        // Add checkbox if in edit mode
        const checkboxHtml = isEditMode ? 
            `<input type="checkbox" class="saved-item-checkbox" data-item-id="${escapeHtml(item.id)}">` : '';
        
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
        
        // Add rename functionality
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
        
        // Add click handler - only if not in edit mode
        if (!isEditMode) {
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
        bubble.textContent = msg.content;
        
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
        removeStudyChatMessage(loadingId);
        addStudyChatMessage('assistant', assistantMessage, wordToSave);
        
        currentStudyChatHistory.push({ role: 'assistant', content: assistantMessage });
        
    } catch (error) {
        console.error('Study chat error:', error);
        removeStudyChatMessage(loadingId);
        addStudyChatMessage('assistant', 'Sorry, I encountered an error. Please try again.', null);
    } finally {
        studyChatSendBtn.disabled = false;
    }
}

// Add expression from study chat
async function addExpressionFromStudyChat(word) {
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
                content: 'You are a Swedish language tutor. Provide clear, concise definitions.'
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
        
        // Create expression object
        const newExpression = {
            word: word,
            meaning: meaningResponse.trim(),
            example: ''
        };
        
        // Add to current analysis expressions
        if (!currentAnalysis.expressions) {
            currentAnalysis.expressions = [];
        }
        currentAnalysis.expressions.push(newExpression);
        
        // Update study modal expressions (show all expressions, including the new one)
        // Only call if DOM elements exist (study modal is open)
        if (studyExpressionsContent && studyExpressionsSection) {
            displayStudyExpressions();
        }
        
        // Also update main expressions display if visible
        if (resultsSection && resultsSection.style.display !== 'none' && expressionsContent) {
            displayExpressions();
        }
        
        // Show confirmation (no save button needed for confirmation messages)
        addStudyChatMessage('assistant', `Added "${word}" to Important Expressions & Words. Meaning: ${meaningResponse.trim()}`, null);
        
    } catch (error) {
        console.error('Error adding expression:', error);
        console.error('Error details:', error.message, error.stack);
        addStudyChatMessage('assistant', `Sorry, I couldn't add "${word}". Please try again.`, null);
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
    bubble.textContent = content;
    
    bubbleContainer.appendChild(bubble);
    
    // Add save button for all assistant messages - outside the bubble
    if (role === 'assistant') {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'add-to-list-btn';
        saveBtn.textContent = 'add on the list +';
        saveBtn.title = 'Add words from this response to Important Expressions & Words';
        saveBtn.addEventListener('click', async () => {
            // Extract Swedish words from the message content
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

