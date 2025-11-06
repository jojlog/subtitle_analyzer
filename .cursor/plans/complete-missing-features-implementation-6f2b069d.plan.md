<!-- 6f2b069d-ec91-4d4c-8195-af81c5bbdda6 229a38c7-9bc9-4025-8f26-69255da0ae33 -->
# Line-by-Line Study Layout & Interaction Implementation

## Overview

Implement a precise layout system for the Line-by-Line Study modal where sections maintain fixed positions, accordion expansion drives expressions section resizing, and dividers behave according to specification.

## Key Requirements

1. **Timestamp**: Absolutely fixed, no position/margin changes regardless of accordion state
2. **Swedish Text**: Equal top/bottom margins when accordion is collapsed
3. **Accordion Expansion**: When expanded, expressions section shrinks from top (upper divider moves down), but lower divider stays fixed
4. **Expressions Lower Divider**: Draggable, can collapse to show only title
5. **Chat Input**: Fixed to bottom of modal container
6. **Window Size**: Modal container size doesn't change with drags or accordion state

## Implementation Details

### 1. Timestamp Section (Fixed)

**File**: `styles.css`

- Ensure `.study-timestamp-section` has `flex: 0 0 auto` (already correct)
- Verify no margin/padding changes occur based on accordion state
- Position: First child in modal content, always visible

### 2. Swedish Text Section (Equal Margins When Collapsed)

**File**: `styles.css`

- **`.study-item-display .swedish-text-wrapper`**: Add equal `margin-top` and `margin-bottom` when accordion is collapsed
- Calculate: When collapsed, `.translation-accordion` has `padding-top: 16px` and `padding-bottom: 16px` but `max-height: 0`
- Solution: Add `margin-top: 16px` to `.swedish-text-wrapper` to match accordion's padding-top when collapsed
- Ensure `.study-item-display` padding doesn't interfere

### 3. Accordion-Driven Expressions Section Resizing

**Files**: `renderer.js`, `styles.css`

**JavaScript Changes** (`renderer.js`):

- Modify `setupTranslationAccordions()`:
  - When accordion expands: Calculate accordion height, reduce expressions section height from top
  - Store original expressions section height before accordion expansion
  - When accordion collapses: Restore original expressions section height
  - Key: Lower divider position stays fixed (expressions section shrinks from top only)

**CSS Changes** (`styles.css`):

- Add transition to `.study-expressions-section` for smooth height changes
- Ensure expressions section can shrink below content height (overflow: hidden)

### 4. Expressions Lower Divider (Draggable)

**File**: `renderer.js`

- Modify `setupStudyModalResizers()`:
  - Current logic handles `expressions-chat` resizer correctly
  - Ensure minimum height calculation allows collapsing to title only
  - Calculate `minExpressionsHeight` based on title height + padding only
  - When collapsed to minimum, content area should be hidden (overflow: hidden)

### 5. Chat Input Fixed to Modal Bottom

**Files**: `styles.css`, `index.html` (if needed)

**CSS Changes** (`styles.css`):

- **`.study-chat-container`**: Change from `flex: 0 0 auto` to use absolute positioning or ensure it's always at bottom
- **`.study-chat-input-container`**: Ensure it's `flex-shrink: 0` and positioned at bottom of chat container
- Alternative: Use flexbox with `margin-top: auto` on messages to push input to bottom

**Current Structure**:

```
.study-modal-content (flex column)
  ├── .study-timestamp-section (flex: 0 0 auto)
  ├── .study-item-display (flex: 0 0 auto)
  ├── .study-expressions-section (flex: 0 0 auto, height: 200px)
  ├── .study-resizer (flex-shrink: 0)
  └── .study-chat-container (flex: 0 0 auto)
      ├── .study-chat-messages (flex: 0 0 auto, height: 200px)
      └── .study-chat-input-container (flex-shrink: 0)
```

**Required Changes**:

- Ensure `.study-chat-container` uses `display: flex; flex-direction: column`
- `.study-chat-messages` should have `flex: 1 1 auto` with `min-height: 0` to allow shrinking
- `.study-chat-input-container` should be `flex-shrink: 0` to stay fixed at bottom

### 6. Window/Container Size Fixed

**File**: `styles.css`

- Ensure `.study-modal-content` has fixed `max-height: 700px` and `height: 90%`
- Verify no JavaScript changes container dimensions
- Internal scrolling handled by individual sections (expressions, chat messages)

## Implementation Steps

1. **Fix Swedish text margins when collapsed**

   - Add `margin-top: 16px` to `.swedish-text-wrapper` to match accordion padding
   - Verify visual balance

2. **Implement accordion-driven expressions resizing**

   - Modify `setupTranslationAccordions()` to calculate and apply height changes
   - Ensure lower divider stays fixed (expressions shrinks from top)
   - Add smooth transitions

3. **Ensure expressions divider can collapse to title only**

   - Verify `minExpressionsHeight` calculation in `setupStudyModalResizers()`
   - Test that content area hides when collapsed

4. **Fix chat input to modal bottom**

   - Adjust `.study-chat-container` flex properties
   - Ensure `.study-chat-messages` can grow/shrink
   - Keep `.study-chat-input-container` fixed at bottom

5. **Verify timestamp remains fixed**

   - Test that timestamp position doesn't change with accordion state
   - Ensure no margin/padding adjustments affect it

6. **Test modal container size stability**

   - Verify container dimensions don't change during drags
   - Ensure internal scrolling works correctly

### To-dos

- [ ] Add equal top/bottom margins to Swedish text wrapper when accordion is collapsed (margin-top: 16px to match accordion padding-top)
- [ ] Modify setupTranslationAccordions() to shrink expressions section from top when accordion expands, keeping lower divider fixed
- [ ] Ensure expressions lower divider can collapse to show only title (verify minExpressionsHeight calculation)
- [ ] Adjust chat container flex properties to keep input fixed at bottom of modal
- [ ] Verify timestamp section remains fixed regardless of accordion state
- [ ] Test that modal container size remains stable during drags and accordion state changes