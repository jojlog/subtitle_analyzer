# Fix Medium Priority Issues

## Issues to Fix

### Issue 9: Duplicate Filename Check Timing Issue (MEDIUM)
### Issue 10: Pause State Not Saved Atomically (MEDIUM)
### Issue 11: Exit Handler May Not Wait for Cleanup (MEDIUM)
### Issue 12: Window.fileProjects Getter Not Updating on Reassignment (MEDIUM)
### Issue 13: No Validation of Analysis Data Structure (MEDIUM)

## Implementation Plan

### Issue 9: Duplicate Filename Check Timing Issue

**Location**: `renderer.js` lines 1789-1845

**Problem**: Checks for duplicates before analysis starts, but file can be renamed during analysis. No re-check before saving.

**Solution**: Add duplicate check before saving in autosave function

**Changes**:
- In autosave function (around line 2132), re-check for duplicates before saving
- Check if filename changed during analysis
- Handle duplicate case: show warning or auto-rename

### Issue 10: Pause State Not Saved Atomically

**Location**: `renderer.js` lines 1376-1387

**Problem**: `project.currentBatchIndex`, `project.progress`, `project.processedBatches` updated separately. If save fails between updates, state is inconsistent.

**Solution**: Update all pause state fields atomically in a single operation

**Changes**:
- Create helper function `savePauseState(project, batchIndex, progress, processedBatches)`
- Update all fields together
- Consider saving to placeholder as well for persistence

### Issue 11: Exit Handler May Not Wait for Cleanup

**Location**: `main.js` lines 119-125

**Problem**: `cleanupUnfinishedFiles()` is async but not awaited properly. Window may close before cleanup completes.

**Solution**: Properly await the cleanup function

**Changes**:
- Await `executeJavaScript` call that runs cleanup
- Add timeout to prevent hanging
- Ensure cleanup completes before allowing window close

### Issue 12: Window.fileProjects Getter Not Updating on Reassignment

**Location**: `renderer.js` lines 17-21, 5426

**Problem**: When `fileProjects = fileProjects.filter(...)`, new array created. Getter still works but IPC handler may capture stale reference.

**Solution**: The getter already handles this correctly, but verify IPC handler uses getter

**Changes**:
- Verify IPC handler in main.js uses getter correctly
- Ensure `window.fileProjects` is accessed via getter, not cached

### Issue 13: No Validation of Analysis Data Structure

**Location**: `renderer.js` lines 2159-2167, 3812-3850

**Problem**: No validation that `analysis` object has required fields (`translations`, `expressions`).

**Solution**: Add validation before saving and before rendering

**Changes**:
- Add validation function `validateAnalysisData(analysisData)`
- Validate before saving in autosave
- Validate before rendering in `renderActiveSaves`
- Log warnings for invalid data

## Implementation Order

1. Issue 11: Exit handler cleanup (simplest)
2. Issue 13: Analysis data validation (prevents bad data)
3. Issue 9: Duplicate filename re-check (data integrity)
4. Issue 10: Atomic pause state save (state consistency)
5. Issue 12: Verify getter usage (verification)

## Files to Modify

- `renderer.js`: Issues 9, 10, 12, 13
- `main.js`: Issue 11

