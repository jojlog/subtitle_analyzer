<!-- 6f2b069d-ec91-4d4c-8195-af81c5bbdda6 a9b7cb3e-2092-4a31-ae7c-2a1a59b48350 -->
# Fix Study Modal Layout Structure

## Problem

The layout broke after changing flex settings. The expressions and chat sections use `flex: 0 0 auto` which prevents proper resizing. Need to restore a classic 3-part flex column structure.

## Solution

Restructure the CSS to create a proper flex hierarchy:

1. **Fixed top**: Header + script line (flex: 0 0 auto)
2. **Resizable middle**: Wrapper containing expressions + resizer + chat messages (flex: 1 1 auto; min-height: 0)
3. **Fixed bottom**: Chat input bar (flex-shrink: 0)

## Changes

### CSS (`styles.css`)

1. **`.study-item-display`** (Script line - already correct):

- Keep `flex: 0 0 auto` (fixed position)
- Keep `overflow: visible` (no scrolling, shows full content)

2. **Create wrapper for resizable middle section**:

- Add new class `.study-resizable-middle` or use existing structure
- Set `flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column;`
- This wrapper will contain: expressions section + resizer + chat messages

3. **`.study-expressions-section`**:

- Change from `flex: 0 0 auto` to `flex: 0 0 auto` (keep fixed size, controlled by height)
- Remove `max-height: none` constraint
- Keep `overflow-y: auto` for scrolling content
- Move `max-height` constraint to `.study-expressions-content` instead

4. **`.study-expressions-content`**:

- Add `max-height: 300px` or similar (move from parent)
- Add `overflow-y: auto` if not already present

5. **`.study-chat-container`**:

- Change from `flex: 0 0 auto` to `flex: 1 1 auto; min-height: 0`
- This allows it to grow/shrink within the resizable middle wrapper

6. **`.study-chat-messages`**:

- Keep `flex: 0 0 auto` (size controlled by height)
- Keep `min-height: 0` (can shrink to 0)
- Keep `overflow-y: auto`

7. **`.study-chat-input-container`**:

- Keep `flex-shrink: 0` (fixed at bottom)
- Already has `display: flex !important` and `visibility: visible !important`

### HTML (`index.html`) - If needed

If the current HTML structure doesn't support the wrapper approach, we may need to:

- Wrap `.study-expressions-section` + `.study-resizer` + `.study-chat-container` (but exclude `.study-chat-input-container`) in a new div
- OR restructure so chat messages are separate from chat container

### JavaScript (`renderer.js`)

The resizing logic should remain mostly the same, but verify:

- Minimum expressions height calculation (heading + padding) is correct
- Chat messages can shrink to 0 (minMessagesHeight = 0)
- The resizing works within the new flex structure

## Verification

After changes:

- Script line shows full content (no scrolling)
- Expressions section can resize with minimum = heading + padding
- Chat messages can shrink to 0 (completely hidden)
- Chat input bar stays fixed at bottom
- Middle section (expressions ↔ chat) can grow/shrink properly