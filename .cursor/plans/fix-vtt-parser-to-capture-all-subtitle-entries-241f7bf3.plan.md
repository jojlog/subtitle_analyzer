<!-- 241f7bf3-5092-413f-b939-41bec3b5978d cfaf08de-15e5-4906-9cf6-e1245306321f -->
# Fix displayStudyExpressions Scope Error

## Problem

The `displayStudyExpressions` function is defined inside the `DOMContentLoaded` event listener block (around line 1577), but it's being called from `addExpressionFromStudyChat` which is outside that block (after line 2333). This causes a "displayStudyExpressions is not defined" error.

## Solution

Move `displayStudyExpressions` function outside the `DOMContentLoaded` block to global scope, placing it right after the block ends (after line 2333).

## Implementation Steps

1. **Remove `displayStudyExpressions` from inside DOMContentLoaded** (around line 1577)

- Find the function definition starting at line 1577
- Remove the entire function (lines 1576-1626 approximately)

2. **Add `displayStudyExpressions` to global scope** (after line 2333)

- Place it right after `}); // End of DOMContentLoaded` at line 2333
- This ensures it's accessible to all functions including `addExpressionFromStudyChat`

## Files to Modify

- `/Users/zone/Downloads/subtitle_analyzer/renderer.js` - Move function definition from inside DOMContentLoaded to global scope

## Notes

- The function should remain exactly the same - only its location changes
- Make sure to preserve all comments and code structure
- Verify that `displayExpressions` function (around line 1629) stays in its current location if it's also being called from outside DOMContentLoaded

### To-dos

- [ ] Fix cue saving when new timestamp found - remove textBuffer.length > 0 condition (line 139)
- [ ] Fix last cue saving logic - remove textBuffer.length > 0 condition (line 161)
- [ ] Add debug logging to track parsing progress and identify any remaining issues