<!-- 6f2b069d-ec91-4d4c-8195-af81c5bbdda6 8ffb1004-a9c4-4b80-b957-beb84f850650 -->
# Study Modal Layout Fixes Implementation Plan

## Current State Analysis

### Layout Structure:

- `.study-modal-content`: Flex column container (fixed height: 90%, max-height: 700px)
- `.study-timestamp-section`: Fixed at top (flex: 0 0 auto)
- `.study-item-display`: Contains Swedish text + accordion (flex: 0 0 auto)
- `.study-expressions-section`: Expressions list (flex: 0 0 auto, height: 200px)
- `.study-resizer`: Divider between expressions and chat (flex-shrink: 0)
- `.study-chat-container`: Chat area (flex: 1 1 auto)
- `.study-chat-messages`: Messages area (flex: 1 1 auto)
- `.study-chat-input-container`: Input bar (flex-shrink: 0, position: sticky)

### Current Issues:

1. **Accordion expand/collapse**: Code attempts to fix divider but may have timing issues
2. **Chat input**: Uses `position: sticky` which may not work perfectly with flex layout
3. **Resizer**: Sets fixed `height` on `.study-chat-messages` which conflicts with `flex: 1 1 auto`

## Implementation Strategy

### Feature 1: Divider Stays Fixed During Accordion Operations

**Problem**: When accordion expands, `.study-item-display` grows, pushing divider down. Current code tries to compensate but may have timing issues.

**Solution**:

- Improve height calculation accuracy
- Ensure expressions section height adjustment happens synchronously with accordion state change
- Use a flag to prevent resizer from interfering during accordion operations

**Files to modify**: `renderer.js`

- Add `isAccordionAnimating` flag in `setupTranslationAccordions()`
- Set flag to `true` during accordion expand/collapse
- Clear flag after transitions complete
- In `setupStudyModalResizers()`, check flag and prevent resizing if accordion is animating

### Feature 2: Chat Input Fixed at Bottom

**Problem**: `position: sticky` may not work reliably with flex layout. Need true fixed positioning relative to modal container.

**Solution**:

- Ensure `.study-chat-container` uses flex layout properly
- Keep `.study-chat-input-container` with `flex-shrink: 0` (already correct)
- Remove `position: sticky` and rely on flexbox to keep it at bottom
- Ensure `.study-chat-messages` can shrink/grow while input stays fixed

**Files to modify**: `styles.css`

- Verify `.study-chat-container` has `flex: 1 1 auto` and `min-height: 0`
- Verify `.study-chat-messages` has `flex: 1 1 auto` and `min-height: 0`
- Verify `.study-chat-input-container` has `flex-shrink: 0`
- Remove `position: sticky` from `.study-chat-input-container` if present

### Feature 3: Divider Draggable (Except During Accordion Operations)

**Problem**: Resizer sets fixed `height` on `.study-chat-messages` which conflicts with `flex: 1 1 auto`. Need to override flex during resize.

**Solution**:

- When resizing starts: Capture current heights, override flex with `flex: 0 0 auto`
- During resize: Set fixed heights on both sections
- When resizing ends: Keep fixed heights (saved to localStorage)
- On restore: Apply saved heights with flex override
- Prevent resizing if accordion is animating (using flag from Feature 1)

**Files to modify**: `renderer.js`

- In `setupStudyModalResizers()` mousedown: Override `.study-chat-messages` flex to `0 0 auto`
- In mousemove: Set fixed heights (already done)
- In mouseup: Keep flex override, save heights
- In `restoreStudyModalHeights()`: Apply flex override if saved height exists
- Add check for `isAccordionAnimating` flag before allowing resize

## Detailed Implementation Steps

### Step 1: Add Accordion Animation Flag

**File**: `renderer.js`

- In `setupTranslationAccordions()`, create module-level variable `let isAccordionAnimating = false`
- Set to `true` at start of expand/collapse
- Set to `false` after transitions complete (in requestAnimationFrame callback)

### Step 2: Prevent Resizer During Accordion Animation

**File**: `renderer.js`

- In `setupStudyModalResizers()` mousedown handler, check `isAccordionAnimating`
- If true, return early (prevent resize start)
- Also check in mousemove handler as safety

### Step 3: Fix Chat Input Positioning

**File**: `styles.css`

- Verify `.study-chat-input-container` does NOT have `position: sticky`
- Ensure it only has `flex-shrink: 0`
- Verify `.study-chat-container` uses flex column layout correctly

### Step 4: Fix Resizer to Work with Flex Layout

**File**: `renderer.js`

- In `setupStudyModalResizers()` mousedown:
- Set `.study-chat-messages.style.flex = '0 0 auto'` to override default flex
- Capture current height
- In mousemove: Continue setting fixed heights (already correct)
- In mouseup: Keep flex override, save heights
- In `restoreStudyModalHeights()`:
- If saved height exists: Set `flex: 0 0 auto` and `height: ${savedHeight}px`
- If no saved height: Use default `flex: 1 1 auto`

### Step 5: Improve Accordion Height Calculation

**File**: `renderer.js`

- Ensure height difference calculation accounts for padding-top of expanded accordion
- Verify the calculation uses the actual container height change, not just accordion element height

### Step 6: Test Edge Cases

- Test accordion expand/collapse while resizing (should be prevented)
- Test resizing after accordion operations (should work)
- Test modal open with saved heights (should restore correctly)
- Test chat input stays fixed during all operations

### To-dos

- [ ] Add isAccordionAnimating flag in setupTranslationAccordions() to track accordion animation state
- [ ] Prevent resizer from starting/continuing when isAccordionAnimating is true
- [ ] Verify and fix chat input container CSS to ensure it stays fixed at bottom using flexbox only
- [ ] Update resizer to override flex property on chat messages during resize and restore
- [ ] Verify and improve accordion height difference calculation for accurate divider positioning
- [ ] Update restoreStudyModalHeights() to properly handle flex override when restoring saved heights