<!-- b2860f89-4d27-450e-85fc-5f8b1c4c8725 35a13eee-bca7-495c-869a-3f9337f62bc6 -->
# Fix Duplicates on Restart and Drag-and-Drop Issues

## Issue 1: Duplicates Temporarily Show on Restart

**Root Cause**: `cleanupInactiveSavesOnStartup()` runs asynchronously without awaiting. When user clicks "Saved Analyses" button immediately after startup, `loadSavedAnalyses()` loads data before deduplication completes, causing duplicates to appear temporarily.

**Solution**:

- Ensure `cleanupInactiveSavesOnStartup()` completes before allowing `loadSavedAnalyses()` to proceed on first load
- Add a flag to track if startup cleanup has completed
- Make `loadSavedAnalyses()` wait for startup cleanup if it hasn't completed yet
- Alternatively, ensure startup cleanup runs synchronously before any UI interactions

**Files to modify**:

- `renderer.js`: 
- Add startup cleanup completion tracking
- Modify `loadSavedAnalyses()` to await startup cleanup on first load
- Or modify startup sequence to await cleanup before allowing UI interactions

## Issue 2: Drag-and-Drop Not Working

**Root Cause**: In Electron, `e.dataTransfer.getData()` in the `drop` event may return empty string if data wasn't set during `dragover`. The code currently only sets data in `dragstart`, which works in browsers but not reliably in Electron.

**Solution**:

- Add `e.dataTransfer.setData()` call in `dragover` event handlers for folder drop targets
- Store the dragged item ID in a variable accessible to both dragstart and dragover
- Ensure data is set in both `dragstart` and `dragover` events

**Files to modify**:

- `renderer.js`:
- In `renderActiveSaves()`: Add `setData` in folder `dragover` handler (around line 4862)
- In `renderActiveSavesAsCards()`: Add `setData` in folder `dragover` handler (around line 5820)
- In `addFolderToUI()`: Add `setData` in folder `dragover` handler for list view (around line 240) and card view (around line 324)
- Store dragged item ID in a way that's accessible to dragover handlers

**Implementation details**:

- Use a module-level variable or closure to store the dragged item ID
- Set data in both `dragstart` (on file items) and `dragover` (on folder drop targets)
- Ensure `getData` in `drop` handler can retrieve the value

## Implementation Steps

1. **Fix startup deduplication timing**:

- Add `let startupCleanupComplete = false;` at module level
- Modify `cleanupInactiveSavesOnStartup()` to set flag when complete
- Modify `loadSavedAnalyses()` to check flag and await cleanup if needed
- Or: Make startup cleanup await before continuing in DOMContentLoaded

2. **Fix drag-and-drop**:

- Add module-level variable: `let draggedItemId = null;`
- In file item `dragstart` handlers: Set `draggedItemId = item.id` and `e.dataTransfer.setData('text/plain', item.id)`
- In folder `dragover` handlers: Add `e.dataTransfer.setData('text/plain', draggedItemId || '')`
- In folder `drop` handlers: Use `e.dataTransfer.getData('text/plain')` or fallback to `draggedItemId`
- Reset `draggedItemId = null` in `dragend` handlers

## Testing

- Restart app and immediately click "Saved Analyses" - should not show duplicates
- Drag file card/item onto folder - should move file into folder
- Drag file from list view onto folder - should work
- Drag file from card view onto folder - should work

### To-dos

- [ ] Add IPC handlers in main.js for image capture and thumbnail folder management
- [ ] Expose image capture API in preload.js
- [ ] Add captureAnalysisPreview() function in renderer.js
- [ ] Add auto-capture when analysis completes in autosaveAnalysis()
- [ ] Add 'Capture Preview' button in edit mode for manual image capture
- [ ] Add view toggle buttons (List/Card) in saved analyses header
- [ ] Add CSS styles for card grid layout, card items, and thumbnails
- [ ] Add renderActiveSavesAsCards() function and view toggle functionality
- [ ] Add localStorage persistence for view mode preference
- [ ] Add startup cleanup completion tracking and ensure loadSavedAnalyses waits for cleanup on first load
- [ ] Add dataTransfer.setData in dragover handlers and store draggedItemId for Electron compatibility
- [ ] Test that duplicates do not appear on restart even when clicking Saved Analyses immediately
- [ ] Test drag-and-drop works in both list and card views for moving files into folders