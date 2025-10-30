<!-- 1460e1d5-25fd-4d81-8345-aa64c29025bf c46411ca-26e7-421a-9ff1-657776e822de -->
# Show Processing Files, Fix Filter, and Add Hover Popup

## Requirements

1. Show processing files in saved analyses view (gray boxes, non-clickable) that become normal after completion
2. Fix level filtering in IMPORTANT EXPRESSIONS AND WORDS section in study modal
3. Add hover popup to show CEFR level when hovering over expressions

## Implementation Plan

### 1. Show Processing Files in Saved Analyses View

**File:** `renderer.js`

#### 1.1: Add placeholder creation to `analyzeProject` function

- **Location:** Around line 1189 (after setting `isAnalyzing = true`)
- Create placeholder saved analysis entry with `status: 'processing'` similar to `analyzeBtn` handler (lines 1448-1496)
- Include: `id`, `fileName`, `date`, `status: 'processing'`, `analysis: null`
- Save placeholder to storage and refresh saved analyses view if open

#### 1.2: Update placeholder when analysis completes in `analyzeProject`

- **Location:** Around line 1251 (in autosave section)
- Find and update placeholder by ID, change `status` to `'completed'` or remove status field
- This ensures processing item becomes normal clickable item

#### 1.3: Modify `loadSavedAnalyses` function to show processing items

- **Location:** Around line 2362
- Change filtering logic (lines 2382-2403) to:
- Separate processing items from completed items
- Show processing items FIRST (at top of list)
- For completed items, keep existing fileName deduplication logic
- When displaying items (lines 2411-2510):
- Check if `item.status === 'processing'`
- If processing: add CSS class `saved-item-processing`, remove click handler, disable cursor
- If completed: keep existing click functionality
- Style processing items with gray appearance

**File:** `styles.css`

#### 1.4: Add CSS for processing items

- **Location:** After `.saved-item` styles (around line 726)
- Add `.saved-item-processing` class with:
- Gray background color (darker than normal)
- `cursor: not-allowed` or `cursor: default`
- Reduced opacity or different color scheme
- No hover effects

### 2. Fix Level Filtering in Study Modal Expressions

**File:** `renderer.js`

#### 2.1: Apply level filter in `displayStudyExpressions` function

- **Location:** Around line 3225 (after filtering by translation association)
- Add level filtering step:
- Filter `expressionsToShow` array by `selectedLevels`
- Include expressions with no level (backward compatibility)
- Pattern: `expressionsToShow = expressionsToShow.filter(expr => !expr.level || selectedLevels.includes(expr.level))`

#### 2.2: Add listener to refresh study expressions when filter changes

- **Location:** Around line 1780 (in level checkbox change handler)
- After calling `displayExpressions()`, also call `displayStudyExpressions()` if study modal is open
- Check if `studyModal && studyModal.style.display !== 'none'` before calling

### 3. Add Hover Popup for Level Display

**File:** `renderer.js`

#### 3.1: Modify expression rendering in `displayStudyExpressions`

- **Location:** Around line 3226-3248 (where expressions are rendered)
- Replace `title` attribute approach with custom popup
- For each expression div:
- Add data attribute: `data-expression-level="${expr.level || 'Unknown'}"`
- Create popup element: `<div class="level-popup">Level: ${expr.level}</div>` (initially hidden)
- Add event listeners: `mouseenter` to show popup, `mouseleave` to hide popup
- Position popup relative to expression item

**File:** `styles.css`

#### 3.2: Add CSS for level popup

- **Location:** After `.study-expression-item` styles (around line 1219)
- Add `.level-popup` class with:
- `position: absolute`
- `background-color: var(--bg-secondary)` or dark background
- `border: 1px solid var(--border-color)`
- `border-radius: 4px`
- `padding: 8px 12px`
- `z-index: 1000`
- `box-shadow: 0 2px 8px rgba(0,0,0,0.3)`
- `pointer-events: none`
- `display: none` by default
- Add `.level-popup.show` class with `display: block`
- Add `.study-expression-item` with `position: relative` for popup positioning

#### 3.3: Add JavaScript for popup positioning

- **Location:** In `displayStudyExpressions` function, when creating popup
- Calculate position relative to expression item
- Position popup above or below item (prefer above if near bottom of container)
- Use `getBoundingClientRect()` for accurate positioning

## Testing Checklist

- [ ] Processing files appear in saved analyses view immediately after analysis starts
- [ ] Processing files are gray and non-clickable
- [ ] Processing files become normal clickable items after completion
- [ ] Level filter dropdown works in study modal expressions section
- [ ] Hovering over expression word shows level popup
- [ ] Popup disappears when mouse leaves expression
- [ ] Popup is positioned correctly (doesn't go off-screen)

### To-dos

- [ ] Add placeholder creation to analyzeProject function and update on completion
- [ ] Modify loadSavedAnalyses to show processing items with gray styling and no click handler
- [ ] Add CSS styles for processing items
- [ ] Fix level filtering in displayStudyExpressions function
- [ ] Add listener to refresh study expressions when filter changes
- [ ] Implement hover popup for level display in study expressions
- [ ] Add CSS styles for level popup with positioning