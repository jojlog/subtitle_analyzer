<!-- 241f7bf3-5092-413f-b939-41bec3b5978d 265fa37b-2510-496a-ac7d-ded37f5ef98c -->
# Make Expressions Section Line-Specific in Study Modal

## Problem

The "IMPORTANT EXPRESSIONS & WORDS" section currently shows all expressions from all lines, but it should only show expressions relevant to the current translation line being studied.

## Solution

Track which translation each expression belongs to and filter expressions in `displayStudyExpressions()` based on the current study item.

## Implementation

### 1. Add translation association to expressions

**File:** `renderer.js`

- Modify expression creation in `addExpressionFromStudyChat()` (around line 2639) to store the associated translation index:
- When `currentStudyItem` exists and `type === 'translation'`, store `currentStudyItem.index` as `expr.translationIndex`
- Also store the Swedish text (`currentStudyItem.item.swedish`) as `expr.translationText` for fallback matching

- Modify expression creation in `addExpressionFromChat()` (around line 1327) to check if study modal is open:
- If `currentStudyItem` exists and `type === 'translation'`, associate the expression with that translation

### 2. Update displayStudyExpressions() filtering logic

**File:** `renderer.js` (around line 2241)

- Replace the "always show all expressions" logic (lines 2265-2267) with filtering:
- If `currentStudyItem` exists and `type === 'translation'`:
- Filter expressions where `expr.translationIndex === currentStudyItem.index`
- Also include expressions where the word appears in `currentStudyItem.item.swedish` (for backward compatibility with existing expressions that may not have `translationIndex`)
- If no `currentStudyItem` or it's an expression type, show empty or appropriate message

### 3. Preserve existing filtering in openStudyModal

**File:** `renderer.js` (around line 2115)

- Keep the existing filtering logic that shows expressions matching the Swedish text when opening the modal
- After filtering, ensure `displayStudyExpressions()` is called to maintain consistency

### 4. Update expression association when adding from study chat

**File:** `renderer.js` (around line 2649)

- After creating `newExpression`, if `currentStudyItem` exists:
- Set `newExpression.translationIndex = currentStudyItem.index`
- Set `newExpression.translationText = currentStudyItem.item.swedish`

## Key Changes Summary

1. **Expression data structure:** Add `translationIndex` and optionally `translationText` properties to track which translation an expression belongs to
2. **Filtering logic:** Update `displayStudyExpressions()` to filter by current translation instead of showing all expressions
3. **Association on creation:** When adding expressions from study chat, associate them with the current translation
4. **Backward compatibility:** Support filtering by text matching for expressions without `translationIndex` (for existing data)

## Notes

- Expressions added from the main chat (not in study modal) won't have a `translationIndex` and will only appear in study modals where their word appears in the Swedish text
- The main expressions list (`displayExpressions()`) continues to show all expressions globally, unchanged
- Only the study modal's expressions section becomes line-specific

### To-dos

- [ ] Fix cue saving when new timestamp found - remove textBuffer.length > 0 condition (line 139)
- [ ] Fix last cue saving logic - remove textBuffer.length > 0 condition (line 161)
- [ ] Add debug logging to track parsing progress and identify any remaining issues
- [ ] Add translationIndex and translationText to expressions when created from study chat (in addExpressionFromStudyChat)
- [ ] Modify displayStudyExpressions() to filter expressions by currentStudyItem.translationIndex and Swedish text matching
- [ ] Update addExpressionFromChat() to associate expressions with current translation if study modal is open
- [ ] Verify expressions only show for their associated translation line