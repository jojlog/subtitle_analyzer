// State management
let currentAnalysis = null;
let currentChatHistory = [];
let currentSubtitleData = null;
let apiKey = null;

// DOM elements (will be initialized when DOM is ready)
let uploadArea, fileInput, fileInfo, fileName, analyzeBtn, resultsSection, uploadSection;
let translationsContent, expressionsContent, chatSection, chatMessages, chatInput, chatSendBtn;
let saveAnalysisBtn, savedAnalysesBtn, savedAnalysesView, savedAnalysesList, closeSavedBtn;
let settingsBtn, settingsView, closeSettingsBtn, apiKeyInput, saveApiKeyBtn;
let homeBtn;
let studyModal, studyTitle, studyItemContent, studyExpressionsSection, studyExpressionsContent, studyChatMessages, studyChatInput, studyChatSendBtn, closeStudyBtn, studyHistoryBtn;
let chatHistoryModal, chatHistoryContent, closeHistoryBtn;

// Study modal state
let currentStudyItem = null;
let currentStudyChatHistory = [];

// Initialize API key from storage
function initializeAPIKey() {
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) {
        apiKey = savedKey;
        return true;
    }
    return false;
}

// Initialize on load
if (initializeAPIKey()) {
    console.log('API key loaded');
} else {
    console.log('API key not found');
}

// Reinitialize API key when loading saved analysis
function reinitializeAPIKey() {
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) {
        apiKey = savedKey;
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
            temperature: 0.7
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded - Initializing...');
    // Initialize DOM elements
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
    savedAnalysesBtn = document.getElementById('savedAnalysesBtn');
    savedAnalysesView = document.getElementById('savedAnalysesView');
    savedAnalysesList = document.getElementById('savedAnalysesList');
    closeSavedBtn = document.getElementById('closeSavedBtn');
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

    console.log('DOM elements initialized', {
        uploadArea: !!uploadArea,
        settingsBtn: !!settingsBtn,
        savedAnalysesBtn: !!savedAnalysesBtn,
        homeBtn: !!homeBtn,
        studyModal: !!studyModal
    });

    // Home button functionality
    homeBtn.addEventListener('click', () => {
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
        if (files.length > 0 && files[0].name.endsWith('.vtt')) {
            await handleFileSelect(files[0]);
        }
    });

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            await handleFileSelect(e.target.files[0]);
        }
    });

async function handleFileSelect(file) {
    try {
        // Use FileReader API for both drag-and-drop and file input
        const content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
        
        currentSubtitleData = parseVTT(content);
        
        fileName.textContent = file.name;
        fileInfo.style.display = 'flex';
        
        // Reset state
        currentAnalysis = null;
        currentChatHistory = [];
        resultsSection.style.display = 'none';
        chatSection.style.display = 'none';
    } catch (error) {
        console.error('Error reading file:', error);
        alert('Error reading file. Please try again.');
    }
}

    // Analyze button
    analyzeBtn.addEventListener('click', async () => {
        if (!currentSubtitleData || currentSubtitleData.length === 0) {
            alert('Please upload a valid .vtt file first.');
            return;
        }

        if (!apiKey) {
            alert('Please set your OpenAI API key in Settings first.');
            settingsBtn.click();
            return;
        }

        analyzeBtn.disabled = true;
        analyzeBtn.textContent = 'Analyzing...';

        try {
            // Combine all subtitle text
            const subtitleText = currentSubtitleData.map(cue => cue.text).join('\n');

            // Create analysis prompt
            const analysisPrompt = `Analyze the following Swedish subtitle text and provide:

1. English translations for each significant phrase or sentence. For each translation, provide:
   - The Swedish text
   - Literal English translation
   - Natural English translation (only if significantly different from literal)

2. Important expressions and words with their meanings and usage examples.

Format the response as JSON with this structure:
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
            
            // Show results and chat
            uploadSection.style.display = 'none';
            resultsSection.style.display = 'flex';
            chatSection.style.display = 'flex';
            
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
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze';
        }
    });

// Helper function to find timestamp for Swedish text
function findTimestampForText(swedishText) {
    if (!currentSubtitleData) return null;
    
    const searchText = swedishText.toLowerCase().trim();
    for (const cue of currentSubtitleData) {
        if (cue.text && cue.text.toLowerCase().includes(searchText) || searchText.includes(cue.text.toLowerCase())) {
            return { start: cue.start, end: cue.end };
        }
    }
    return null;
}

// Format timestamp for display
function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    // VTT format is usually HH:MM:SS.mmm or MM:SS.mmm
    return timestamp.start || '';
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
            if (timestampStr) {
                html += `<div class="translation-timestamp">${escapeHtml(timestampStr)}</div>`;
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

    // Display expressions using helper function
    if (data.expressions && data.expressions.length > 0) {
        displayExpressions();
    } else {
        expressionsContent.innerHTML = '<p style="color: #666;">No expressions found.</p>';
    }
}

// Open study modal with selected item
function openStudyModal(type, item, index, timestamp = null) {
    currentStudyItem = { type, item, index, timestamp };
    currentStudyChatHistory = [];
    
    // Display the item
    studyItemContent.innerHTML = '';
    studyExpressionsContent.innerHTML = '';
    studyExpressionsSection.style.display = 'none';
    
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
                studyExpressionsSection.style.display = 'block';
                relatedExpressions.forEach(expr => {
                    const exprDiv = document.createElement('div');
                    exprDiv.className = 'study-expression-item';
                    
                    let exprHtml = `<span class="study-expression-word">${escapeHtml(expr.word)}</span>`;
                    if (expr.meaning) {
                        exprHtml += `<span class="study-expression-meaning">${escapeHtml(expr.meaning)}</span>`;
                    }
                    if (expr.example) {
                        exprHtml += `<div class="study-expression-example">Example: ${escapeHtml(expr.example)}</div>`;
                    }
                    
                    exprDiv.innerHTML = exprHtml;
                    studyExpressionsContent.appendChild(exprDiv);
                });
            }
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

    // Add user message to chat
    addChatMessage('user', message);
    currentChatHistory.push({ role: 'user', content: message });
    
    chatInput.value = '';
    chatSendBtn.disabled = true;
    
    // Show loading
    const loadingId = addChatMessage('assistant', 'Thinking...');
    
    try {
        const assistantMessage = await callOpenAI(currentChatHistory);
        
        // Remove loading message and add real response
        removeChatMessage(loadingId);
        addChatMessage('assistant', assistantMessage);
        
        currentChatHistory.push({ role: 'assistant', content: assistantMessage });
        
    } catch (error) {
        console.error('Chat error:', error);
        removeChatMessage(loadingId);
        addChatMessage('assistant', 'Sorry, I encountered an error. Please try again.');
    } finally {
        chatSendBtn.disabled = false;
    }
}

// Add expression from chat using {add- word} command
async function addExpressionFromChat(word, context = 'main') {
    if (!apiKey || !word) return;
    
    try {
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
            displayExpressions();
        } else if (context === 'study') {
            // Update study modal expressions if word matches
            if (currentStudyItem && currentStudyItem.type === 'translation') {
                const swedishText = currentStudyItem.item.swedish.toLowerCase();
                if (swedishText.includes(word.toLowerCase())) {
                    displayStudyExpressions();
                }
            }
        }
        
        // Show confirmation
        addChatMessage('assistant', `Added "${word}" to Important Expressions & Words. Meaning: ${meaningResponse.trim()}`);
        
    } catch (error) {
        console.error('Error adding expression:', error);
        addChatMessage('assistant', `Sorry, I couldn't add "${word}". Please try again.`);
    }
}

// Display expressions (refresh the expressions section)
function displayExpressions() {
    if (!currentAnalysis || !currentAnalysis.expressions) return;
    
    expressionsContent.innerHTML = '';
    
    currentAnalysis.expressions.forEach((expr, index) => {
        const item = document.createElement('div');
        item.className = 'expression-item';
        
        let html = `<span class="expression-word">${escapeHtml(expr.word)}</span>`;
        if (expr.meaning) {
            html += `<span class="expression-meaning">${escapeHtml(expr.meaning)}</span>`;
        }
        if (expr.example) {
            html += `<div style="margin-top: 4px; font-size: 12px; color: #999;">Example: ${escapeHtml(expr.example)}</div>`;
        }
        
        item.innerHTML = html;
        item.addEventListener('click', () => openStudyModal('expression', expr, index));
        expressionsContent.appendChild(item);
    });
}

// Display study expressions (refresh study modal expressions)
function displayStudyExpressions() {
    if (!currentAnalysis || !currentAnalysis.expressions || !currentStudyItem) return;
    
    studyExpressionsContent.innerHTML = '';
    
    const swedishText = currentStudyItem.item.swedish.toLowerCase();
    const relatedExpressions = currentAnalysis.expressions.filter(expr => {
        const word = expr.word.toLowerCase();
        return swedishText.includes(word) || word.split(' ').some(w => swedishText.includes(w));
    });
    
    if (relatedExpressions.length > 0) {
        studyExpressionsSection.style.display = 'block';
        relatedExpressions.forEach(expr => {
            const exprDiv = document.createElement('div');
            exprDiv.className = 'study-expression-item';
            
            let exprHtml = `<span class="study-expression-word">${escapeHtml(expr.word)}</span>`;
            if (expr.meaning) {
                exprHtml += `<span class="study-expression-meaning">${escapeHtml(expr.meaning)}</span>`;
            }
            if (expr.example) {
                exprHtml += `<div class="study-expression-example">Example: ${escapeHtml(expr.example)}</div>`;
            }
            
            exprDiv.innerHTML = exprHtml;
            studyExpressionsContent.appendChild(exprDiv);
        });
    }
}

function addChatMessage(role, content) {
    const messageDiv = document.createElement('div');
    const messageId = 'msg-' + Date.now();
    messageDiv.id = messageId;
    messageDiv.className = `chat-message ${role}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = content;
    
    messageDiv.appendChild(bubble);
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
    saveAnalysisBtn.addEventListener('click', () => {
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

        // Get existing saved analyses
        const saved = JSON.parse(localStorage.getItem('saved_analyses') || '[]');
        saved.push(savedAnalysis);
        
        // Keep only last 50 analyses
        if (saved.length > 50) {
            saved.shift();
        }
        
        localStorage.setItem('saved_analyses', JSON.stringify(saved));
        
        alert('Analysis saved!');
    });

    // Saved analyses view
    savedAnalysesBtn.addEventListener('click', () => {
        console.log('Saved analyses button clicked');
        loadSavedAnalyses();
        savedAnalysesView.style.display = 'flex';
        resultsSection.style.display = 'none';
        uploadSection.style.display = 'none';
        chatSection.style.display = 'none';
    });

    closeSavedBtn.addEventListener('click', () => {
        savedAnalysesView.style.display = 'none';
        if (currentAnalysis) {
            resultsSection.style.display = 'flex';
            chatSection.style.display = 'flex';
        } else {
            uploadSection.style.display = 'flex';
        }
    });

function loadSavedAnalyses() {
    const saved = JSON.parse(localStorage.getItem('saved_analyses') || '[]');
    savedAnalysesList.innerHTML = '';

    if (saved.length === 0) {
        savedAnalysesList.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No saved analyses yet.</p>';
        return;
    }

    // Display in reverse order (newest first)
    saved.reverse().forEach(item => {
        const savedItem = document.createElement('div');
        savedItem.className = 'saved-item';
        
        const date = new Date(item.date);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        
        savedItem.innerHTML = `
            <div class="saved-item-header">
                <span class="saved-item-name">${escapeHtml(item.fileName)}</span>
                <span class="saved-item-date">${dateStr}</span>
            </div>
            <div class="saved-item-preview">Click to reopen this analysis</div>
        `;
        
        savedItem.addEventListener('click', () => {
            reopenAnalysis(item);
        });
        
        savedAnalysesList.appendChild(savedItem);
    });
}

function reopenAnalysis(savedItem) {
    reinitializeAPIKey();
    currentAnalysis = savedItem.analysis;
    currentChatHistory = savedItem.chatHistory || [];
    currentSubtitleData = savedItem.subtitleData;
    
    fileName.textContent = savedItem.fileName;
    fileInfo.style.display = 'flex';
    
    displayAnalysis(currentAnalysis);
    
    // Restore chat messages
    chatMessages.innerHTML = '';
    currentChatHistory.forEach(msg => {
        if (msg.role !== 'system' && msg.content) {
            addChatMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
        }
    });
    
    // Show views
    savedAnalysesView.style.display = 'none';
    uploadSection.style.display = 'none';
    resultsSection.style.display = 'flex';
    chatSection.style.display = 'flex';
}

    // Settings
    settingsBtn.addEventListener('click', () => {
        console.log('Settings button clicked');
        const savedKey = localStorage.getItem('openai_api_key');
        if (savedKey) {
            // Show partially masked key
            const masked = savedKey.substring(0, 7) + '...' + savedKey.substring(savedKey.length - 4);
            apiKeyInput.value = masked;
            apiKeyInput.type = 'text';
        } else {
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
            resultsSection.style.display = 'flex';
            chatSection.style.display = 'flex';
        } else {
            uploadSection.style.display = 'flex';
        }
    });

    saveApiKeyBtn.addEventListener('click', () => {
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
        
        localStorage.setItem('openai_api_key', newApiKey);
        apiKey = newApiKey; // Update local variable
        
        alert('API key saved successfully!');
        apiKeyInput.type = 'password';
        apiKeyInput.value = '';
    });

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

    // Add user message to chat
    addStudyChatMessage('user', message);
    currentStudyChatHistory.push({ role: 'user', content: message });
    
    studyChatInput.value = '';
    studyChatSendBtn.disabled = true;
    
    // Show loading
    const loadingId = addStudyChatMessage('assistant', 'Thinking...');
    
    try {
        const assistantMessage = await callOpenAI(currentStudyChatHistory);
        
        // Remove loading message and add real response
        removeStudyChatMessage(loadingId);
        addStudyChatMessage('assistant', assistantMessage);
        
        currentStudyChatHistory.push({ role: 'assistant', content: assistantMessage });
        
    } catch (error) {
        console.error('Study chat error:', error);
        removeStudyChatMessage(loadingId);
        addStudyChatMessage('assistant', 'Sorry, I encountered an error. Please try again.');
    } finally {
        studyChatSendBtn.disabled = false;
    }
}

// Add expression from study chat
async function addExpressionFromStudyChat(word) {
    if (!apiKey || !word) return;
    
    try {
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
        
        // Update study modal expressions
        displayStudyExpressions();
        
        // Show confirmation
        addStudyChatMessage('assistant', `Added "${word}" to Important Expressions & Words. Meaning: ${meaningResponse.trim()}`);
        
    } catch (error) {
        console.error('Error adding expression:', error);
        addStudyChatMessage('assistant', `Sorry, I couldn't add "${word}". Please try again.`);
    }
}

function addStudyChatMessage(role, content) {
    const messageDiv = document.createElement('div');
    const messageId = 'study-msg-' + Date.now();
    messageDiv.id = messageId;
    messageDiv.className = `study-chat-message ${role}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'study-message-bubble';
    bubble.textContent = content;
    
    messageDiv.appendChild(bubble);
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

