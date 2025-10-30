<!-- b84f077f-7e48-429d-9fe6-5aeabd594699 c74b22ef-29fc-4070-9389-f07464427903 -->
# Add Go Back Button for Edit Mode

## Problem

Users need a way to exit edit mode without deleting items. Currently, the Edit button changes to Delete in edit mode, but there's no way to cancel/exit edit mode.

## Solution

Add a separate "Go Back" button that appears next to the Delete button when in edit mode. Clicking it will exit edit mode without deleting anything.

## Implementation Steps

### 1. Update index.html

- Add a new button `goBackBtn` next to `editSavedBtn` in the saved header
- Initially hide it with `style="display: none;"`

### 2. Update renderer.js

- Declare `goBackBtn` variable in DOM elements section
- Initialize `goBackBtn` in DOMContentLoaded listener
- Add click handler for `goBackBtn` that:
- Sets `isEditMode = false`
- Calls `loadSavedAnalyses()` to refresh the list
- Calls `updateEditButton()` to update button states
- Update `updateEditButton()` function to:
- Show `goBackBtn` when `isEditMode` is true
- Hide `goBackBtn` when `isEditMode` is false
- Update `editSavedBtn` text and class as before

### 3. Update styles.css

- Add styling for `.go-back-btn` class (similar to edit button but with a neutral/secondary color)
- Style the button container to handle left-aligned buttons

### 4. Files to modify

- `/Users/zone/Downloads/subtitle_analyzer/index.html` - Add goBackBtn button
- `/Users/zone/Downloads/subtitle_analyzer/renderer.js` - Add button handler and update edit mode logic
- `/Users/zone/Downloads/subtitle_analyzer/styles.css` - Style the Go Back button

### To-dos

- [ ] Add goBackBtn button element in index.html next to editSavedBtn, initially hidden
- [ ] Add goBackBtn initialization and click handler in renderer.js to exit edit mode
- [ ] Update updateEditButton() function to show/hide goBackBtn based on isEditMode
- [ ] Add CSS styling for .go-back-btn class in styles.css