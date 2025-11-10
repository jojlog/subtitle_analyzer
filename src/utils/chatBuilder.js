/**
 * Chat Message Builder - Unified chat message creation
 * Consolidates addChatMessage and addStudyChatMessage logic
 */

/**
 * Create a chat message element
 * @param {Object} options - Message options
 * @param {string} options.role - 'user' or 'assistant'
 * @param {string} options.content - Message content
 * @param {string|null} options.wordToSave - Optional word to save
 * @param {HTMLElement} options.container - Container element
 * @param {string} options.prefix - ID prefix (default: 'msg')
 * @param {boolean} options.showSaveButton - Show save button for assistant messages
 * @param {Function} options.onSaveWord - Callback when save button clicked
 * @returns {string} Message ID
 */
export function createChatMessage({
    role,
    content,
    wordToSave = null,
    container,
    prefix = 'msg',
    showSaveButton = false,
    onSaveWord = null
}) {
    if (!container) {
        console.error('Chat container not provided');
        return null;
    }

    const messageDiv = document.createElement('div');
    const messageId = `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    messageDiv.id = messageId;
    
    // Set appropriate class based on context
    const baseClass = container.id === 'studyChatMessages' ? 'study-chat-message' : 'chat-message';
    messageDiv.className = `${baseClass} ${role}`;
    
    // Create bubble container
    const bubbleContainer = document.createElement('div');
    bubbleContainer.className = container.id === 'studyChatMessages' 
        ? 'study-message-bubble-container' 
        : 'message-bubble-container';
    
    // Create message bubble
    const bubble = document.createElement('div');
    bubble.className = container.id === 'studyChatMessages' 
        ? 'study-message-bubble' 
        : 'message-bubble';
    
    // Import markdownToHtml dynamically to avoid circular dependencies
    // For now, we'll pass it as a parameter or import it
    if (typeof window.markdownToHtml === 'function') {
        bubble.innerHTML = window.markdownToHtml(content);
    } else {
        bubble.textContent = content; // Fallback
    }
    
    bubbleContainer.appendChild(bubble);
    
    // Add save button if needed
    if (role === 'assistant' && showSaveButton && onSaveWord) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'add-to-list-btn';
        saveBtn.textContent = 'add on the list +';
        saveBtn.title = 'Add words from this response to Important Expressions & Words';
        saveBtn.addEventListener('click', () => onSaveWord(content, messageId));
        
        if (container.id === 'studyChatMessages') {
            bubbleContainer.classList.add('has-button');
            bubbleContainer.appendChild(saveBtn);
        } else {
            messageDiv.appendChild(saveBtn);
        }
    }
    
    messageDiv.appendChild(bubbleContainer);
    container.appendChild(messageDiv);
    
    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
    
    return messageId;
}

/**
 * Remove a chat message by ID
 * @param {string} messageId - Message ID to remove
 */
export function removeChatMessage(messageId) {
    const message = document.getElementById(messageId);
    if (message) {
        message.remove();
    }
}




