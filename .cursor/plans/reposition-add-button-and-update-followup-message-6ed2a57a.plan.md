<!-- 6ed2a57a-6d97-4014-8da0-90c8fd307d6b e31c6fb5-6783-4f18-9f72-fe03e2972b9a -->
# Reposition Add Button and Update Followup Message

## Changes Required

### 1. Move "Add" button to right side of message bubble

- **File**: `renderer.js` (lines 3159-3225)
- Modify `bubbleContainer` structure to display button alongside bubble horizontally
- Change button positioning logic - instead of appending to `bubbleContainer` with column layout, wrap bubble and button in a flex row container
- Update to place button on the right side of the bubble

- **File**: `styles.css` (lines 1069-1114)
- Update `.study-message-bubble-container` to use `flex-direction: row` for horizontal layout
- Adjust `.study-chat-message .add-to-list-btn` positioning to align right next to bubble
- Ensure proper spacing and alignment

### 2. Update followup message format

- **File**: `renderer.js` (line 2821)
- Change from: `Do you want to add "${detectedSwedishWord}" to the list?`
- Change to: `Do you want to add "${detectedSwedishWord}" to the list, Important Expressions & Words?`

### 3. Change confirmation to popup window

- **File**: `renderer.js` (line 3140)
- Replace `addStudyChatMessage('assistant', ...)` confirmation message
- Change to `alert()` popup showing: `Added "${dictionaryForm}"` (just the added message, without the meaning)

## Implementation Details

- Button functionality remains unchanged - only positioning and message format updates
- CSS will need flex row layout for horizontal button placement
- Confirmation popup will use native browser alert dialog

### To-dos

- [ ] Update CSS to position Add button on right side of message bubble (change flex-direction to row, adjust button styles)
- [ ] Update followup message text to include 'Important Expressions & Words'
- [ ] Change confirmation message from chat message to alert popup showing 'Added [word]'