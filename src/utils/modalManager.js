/**
 * Modal Manager - Unified modal handling
 * Consolidates warning, rename, and chat history modal logic
 */

/**
 * Show a warning modal
 * @param {string} message - Warning message to display
 * @returns {Promise<void>}
 */
export function showWarningModal(message) {
    return new Promise((resolve) => {
        const warningModal = document.getElementById('warningModal');
        const warningModalMessage = document.getElementById('warningModalMessage');
        const warningModalOK = document.getElementById('warningModalOK');
        
        if (!warningModal || !warningModalMessage || !warningModalOK) {
            console.error('Warning modal elements not found');
            alert(message); // Fallback to alert
            resolve();
            return;
        }
        
        warningModalMessage.textContent = message;
        warningModal.style.display = 'flex';
        
        // Remove existing listeners
        const newOKBtn = warningModalOK.cloneNode(true);
        warningModalOK.parentNode.replaceChild(newOKBtn, warningModalOK);
        
        // Add new listener
        newOKBtn.addEventListener('click', () => {
            warningModal.style.display = 'none';
            resolve();
        });
        
        // Close on escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                warningModal.style.display = 'none';
                document.removeEventListener('keydown', handleEscape);
                resolve();
            }
        };
        document.addEventListener('keydown', handleEscape);
    });
}

/**
 * Show a rename modal
 * @param {string} message - Modal message
 * @param {string} currentName - Current name (default value)
 * @returns {Promise<string|null>} Returns the new name or null if cancelled
 */
export function showRenameModal(message, currentName = '') {
    return new Promise((resolve) => {
        const renameModal = document.getElementById('renameModal');
        const renameModalMessage = document.getElementById('renameModalMessage');
        const renameModalInput = document.getElementById('renameModalInput');
        const renameModalCancel = document.getElementById('renameModalCancel');
        const renameModalConfirm = document.getElementById('renameModalConfirm');
        
        if (!renameModal || !renameModalMessage || !renameModalInput || 
            !renameModalCancel || !renameModalConfirm) {
            console.error('Rename modal elements not found');
            const newName = prompt(message, currentName);
            resolve(newName ? newName.trim() : null);
            return;
        }
        
        renameModalMessage.textContent = message;
        renameModalInput.value = currentName || '';
        renameModalInput.select();
        renameModal.style.display = 'flex';
        
        // Remove existing listeners
        const newCancelBtn = renameModalCancel.cloneNode(true);
        renameModalCancel.parentNode.replaceChild(newCancelBtn, renameModalCancel);
        
        const newConfirmBtn = renameModalConfirm.cloneNode(true);
        renameModalConfirm.parentNode.replaceChild(newConfirmBtn, renameModalConfirm);
        
        // Cancel handler
        const handleCancel = () => {
            renameModal.style.display = 'none';
            document.removeEventListener('keydown', handleEscape);
            resolve(null);
        };
        newCancelBtn.addEventListener('click', handleCancel);
        
        // Confirm handler
        const handleConfirm = () => {
            const newName = renameModalInput.value.trim();
            renameModal.style.display = 'none';
            document.removeEventListener('keydown', handleEscape);
            resolve(newName || null);
        };
        newConfirmBtn.addEventListener('click', handleConfirm);
        
        // Enter key handler
        renameModalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleConfirm();
            } else if (e.key === 'Escape') {
                handleCancel();
            }
        });
        
        // Escape key handler
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        document.addEventListener('keydown', handleEscape);
        
        // Focus input
        renameModalInput.focus();
    });
}

/**
 * Show chat history modal
 * @param {Array} chatHistory - Array of chat messages
 * @param {Function} markdownToHtml - Optional function to convert markdown to HTML
 */
export function showChatHistoryModal(chatHistory, markdownToHtml = null) {
    const chatHistoryModal = document.getElementById('chatHistoryModal');
    const chatHistoryContent = document.getElementById('chatHistoryContent');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    
    if (!chatHistoryModal || !chatHistoryContent) {
        console.error('Chat history modal elements not found');
        return;
    }
    
    chatHistoryContent.innerHTML = '';
    
    if (!chatHistory || chatHistory.length === 0) {
        chatHistoryContent.innerHTML = '<p style="color: #666; text-align: center; padding: 24px;">No chat history yet.</p>';
        chatHistoryModal.style.display = 'flex';
        return;
    }
    
    // Render chat history
    chatHistory.forEach((msg, index) => {
        if (msg.role === 'system') return; // Skip system messages
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-history-message ${msg.role}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'chat-history-bubble';
        
        if (markdownToHtml && typeof markdownToHtml === 'function') {
            bubble.innerHTML = markdownToHtml(msg.content);
        } else {
            bubble.textContent = msg.content;
        }
        
        messageDiv.appendChild(bubble);
        chatHistoryContent.appendChild(messageDiv);
    });
    
    chatHistoryModal.style.display = 'flex';
    
    // Close button handler
    if (closeHistoryBtn) {
        const handleClose = () => {
            chatHistoryModal.style.display = 'none';
        };
        
        // Remove existing listeners
        const newCloseBtn = closeHistoryBtn.cloneNode(true);
        closeHistoryBtn.parentNode.replaceChild(newCloseBtn, closeHistoryBtn);
        newCloseBtn.addEventListener('click', handleClose);
        
        // Escape key handler
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                chatHistoryModal.style.display = 'none';
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }
}

/**
 * Show chat history modal (alias for showChatHistoryModal)
 * @param {Array} chatHistory - Array of chat messages
 * @param {Function} markdownToHtml - Optional function to convert markdown to HTML
 */
export function showChatHistory(chatHistory, markdownToHtml = null) {
    showChatHistoryModal(chatHistory, markdownToHtml);
}

/**
 * Hide all modals
 */
export function hideAllModals() {
    const modals = ['warningModal', 'renameModal', 'chatHistoryModal'];
    modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    });
}

