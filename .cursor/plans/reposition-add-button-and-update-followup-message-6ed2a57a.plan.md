<!-- 6ed2a57a-6d97-4014-8da0-90c8fd307d6b 018826a8-535e-4b20-aea3-6c96b0b02fa1 -->
# Fix Warning Location and Preserve Analysis Progress

## Issues Identified

1. **Warning appears on wrong button**: Currently shows on home button (line 588-595), should show on saved analyses button (line 1652)
2. **Progress not preserved**: `currentAnalysis` is only set at the END of all batch processing (line 1129), so partial progress is lost if user navigates away

## Changes Required

### 1. Move warning from home button to saved analyses button

- **File**: `renderer.js`
- **Remove** warning check from `homeBtn` click handler (lines 589-595)
- **Add** warning check to `savedAnalysesBtn` click handler (before line 1655)
- Use same confirmation dialog text: "Analysis is in progress. Are you sure you want to leave? The analysis will continue in the background."
- If user cancels, don't open saved analyses view

### 2. Preserve analysis progress incrementally

- **File**: `renderer.js`
- **Initialize `currentAnalysis`** at start of analysis (after line 1056, before batch processing)
  - Set to empty structure: `{ translations: [], expressions: [] }`
- **Update `currentAnalysis` incrementally** after each batch completes (in `processSubtitleBatches` function, after each batch result is processed, around line 944-980)
  - Merge completed batch results into `currentAnalysis.translations` and `currentAnalysis.expressions`
  - Call `displayAnalysis(currentAnalysis)` after each batch to show progress
- **Ensure progress is visible** when user navigates back during analysis
  - Results section should show partial results if `currentAnalysis` exists and `isAnalyzing` is true

### 3. Display progress during analysis

- **File**: `renderer.js`
- After each batch completes, update display with current progress
- Ensure `displayAnalysis()` can handle partial/incomplete analysis data gracefully

## Implementation Details

- Warning: Simple move of confirmation check from one event handler to another
- Progress: Initialize `currentAnalysis` early, update it after each batch in the loop (line 792-980 area), call `displayAnalysis()` incrementally
- No changes to other functions, designs, or layouts
- Keep all existing functionality intact