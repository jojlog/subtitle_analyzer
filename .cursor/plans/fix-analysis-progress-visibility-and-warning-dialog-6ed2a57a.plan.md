<!-- 6ed2a57a-6d97-4014-8da0-90c8fd307d6b f0ff766e-42d1-4eea-bdb8-c78fec740867 -->
# Fix Analysis Progress Visibility and Warning Dialog

## Problem Analysis

1. Warning currently shows when clicking home button during analysis (should only show when opening saved files)
2. Analysis progress (analyzeBtn with "Analyzing..." text) is hidden when saved files view opens
3. Analysis already continues in background but user can't see progress

## Changes Required

### 1. Move warning dialog from homeBtn to savedAnalysesBtn

- **File**: `renderer.js` (lines 588-613)
- Remove the warning check from `homeBtn` click handler
- Allow going home without warning (analysis continues in background anyway)

- **File**: `renderer.js` (lines 1641-1652)
- Add warning check to `savedAnalysesBtn` click handler
- Show warning only when `isAnalyzing === true`
- If user cancels, don't open saved files view
- If user confirms, proceed to open saved files view

### 2. Keep processing status visible during analysis

- **File**: `renderer.js` (lines 1641-1652)
- When opening saved files view during analysis (`isAnalyzing === true`):
- Don't hide `uploadSection` - keep it visible so `analyzeBtn` with "Analyzing..." text remains visible
- Only hide `resultsSection` if it exists and analysis hasn't completed yet
- When opening saved files view when NOT analyzing:
- Keep current behavior (hide both uploadSection and resultsSection)

### 3. Ensure analysis completes and switches to results

- **File**: `renderer.js` (lines 1132-1149)
- When analysis completes while user is in saved files view:
- Automatically switch from saved files view to results view
- Hide savedAnalysesView, show resultsSection
- This ensures user sees completed analysis immediately

### 4. Reset analyzeBtn state properly

- **File**: `renderer.js` (lines 1186-1189)
- Ensure analyzeBtn text and state reset correctly in finally block
- This happens regardless of which view is active

## Implementation Details

- Analysis continues in background via async/await - no changes needed
- Progress is tracked via `isAnalyzing` flag and `analyzeBtn.textContent` updates
- When saved files opens during analysis, uploadSection stays visible showing the analyzing button
- When analysis completes, user is automatically switched to results view