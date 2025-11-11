<!-- b2860f89-4d27-450e-85fc-5f8b1c4c8725 cee1a114-7e2b-47cb-a7db-ef63263bbbf9 -->
# Associate Expressions with Line Indices

## Problem

Currently, expressions are extracted per batch (multiple lines together) and stored globally without line associations. The study modal filters by word matching, which is inaccurate and shows expressions from other lines.

## Solution

Associate expressions with specific translation line indices during batch processing, and update filtering to show only expressions from the current line. Migrate existing analyses to associate expressions with their source lines.

## Implementation

### 1. Associate expressions with line indices during batch processing

**File:** `renderer.js` (around line 1742-2765)

- In `processSingleBatch()`, after parsing `batchData.expressions`:
- For each expression, determine which translation line(s) it came from by matching the expression word against the Swedish text of each translation in the batch
- Set `translationIndex` on each expression to the index of the matching translation (use global index: `globalEntryIndexStart + translationIndex`)
- If an expression matches multiple lines in the batch, create separate expression entries for each line (or associate with the first match)
- Store `translationText` (the Swedish text) for fallback matching

- In the batch merging logic (around line 2763-2765):
- Preserve `translationIndex` when merging expressions from batches
- Update deduplication logic to consider `translationIndex` (same word can appear in different lines)

### 2. Update expression filtering in study modal

**File:** `renderer.js` (around line 7654-7682)

- In `displayStudyExpressions()`:
- Filter expressions where `expr.translationIndex === currentTranslationIndex`
- Remove the word-matching fallback for expressions with `translationIndex` (they must match exactly)
- Keep word-matching fallback only for expressions without `translationIndex` (backward compatibility for old data)

### 3. Migrate existing analyses

**File:** `renderer.js` (in `loadSavedAnalyses()` or a separate migration function)

- When loading saved analyses:
- Check if expressions have `translationIndex` set
- For expressions without `translationIndex`:
  - Match each expression word against all translations in the analysis
  - Set `translationIndex` to the first matching translation index
  - If no match found, leave `translationIndex` undefined (will use word-matching fallback)
- Save migrated data back to storage

### 4. Update expression deduplication

**File:** `renderer.js` (around line 2789-2797)

- Modify expression deduplication to use `word + translationIndex` as the key instead of just `word`
- This allows the same word to appear in multiple lines as separate expressions

## Key Changes Summary

1. **Expression association**: Set `translationIndex` on expressions during batch processing by matching words against translation Swedish text
2. **Filtering**: Only show expressions where `translationIndex` matches the current line
3. **Migration**: Automatically associate existing expressions with their source lines when loading analyses
4. **Deduplication**: Update to allow same word in different lines

## Notes

- Matching logic should handle verb forms (e.g., "att flytta" should match "flytta" in text)
- For phrases, check if all words appear in the translation text
- Migration runs automatically on load, so existing analyses will be updated gradually

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
- [ ] Modify processSingleBatch() to associate expressions with translation line indices by matching words against Swedish text
- [ ] Update expression deduplication to use word + translationIndex as key, allowing same word in different lines
- [ ] Update displayStudyExpressions() to only show expressions where translationIndex matches current line
- [ ] Add migration logic to associate existing expressions with their source lines when loading analyses