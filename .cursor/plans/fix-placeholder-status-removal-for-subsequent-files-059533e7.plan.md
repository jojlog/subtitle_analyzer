<!-- 059533e7-97a2-4d72-a624-00612b62dcee c95edf56-eee3-400c-8808-dba26231a595 -->
# Fix Placeholder Status Removal for Subsequent Files

## Problem

When analyzing multiple files sequentially, the first file completes correctly and can be opened. However, the second file (and all subsequent files) shows "analyzing (100%)" status and cannot be opened. This is because the placeholder's `status: 'processing'` field is not being properly removed when the analysis completes.

## Root Cause

In the `analyzeProject` function (used by `processQueue` for subsequent files):

1. **Autosave creates completedAnalysis without explicit status removal** (lines 1890-1897): The `completedAnalysis` object doesn't include `status` or `progress` fields, but the replacement at line 1907 may not fully remove these fields if they were previously set.

2. **Placeholder may not be found** (lines 1908-1929): If `placeholderIndex === -1`, a new entry is created but the original placeholder with `status: 'processing'` remains in the saved array, causing the issue.

3. **Missing explicit cleanup**: Unlike the `analyzeBtn` handler (lines 2330-2367) which explicitly updates the placeholder after autosave, `analyzeProject` doesn't have this second cleanup pass.

## Solution

### File: `renderer.js`

#### Fix 1: Explicitly remove status/progress when replacing placeholder

**Location:** Around line 1907 in `analyzeProject` function

When replacing the placeholder with completed analysis, explicitly create an object that excludes `status`, `progress`, and `paused` fields:

```1899:1907:renderer.js
if (placeholderId) {
    const placeholderIndex = saved.findIndex(item => item.id === placeholderId);
    if (placeholderIndex !== -1) {
        // Replace placeholder with completed analysis (explicitly remove status and progress fields)
        saved[placeholderIndex] = {
            id: placeholderId,
            fileName: finalFileName,
            date: new Date().toISOString(),
            analysis: analysisData,
            chatHistory: currentChatHistory,
            subtitleData: currentSubtitleData
            // Explicitly omit status, progress, paused fields
        };
```

#### Fix 2: Remove orphaned processing placeholders when placeholder not found

**Location:** Around line 1908-1929 in `analyzeProject` function

If placeholder is not found by ID, search for any processing placeholders with the same fileName and remove them before creating the new entry:

```1908:1929:renderer.js
} else {
    // Placeholder not found by ID - remove any processing placeholders for this file
    // This handles cases where placeholder ID doesn't match (race conditions, etc.)
    const processingIndex = saved.findIndex(item =>
        item.fileName === finalFileName && item.status === 'processing'
    );
    if (processingIndex !== -1) {
        // Remove the orphaned processing placeholder
        saved.splice(processingIndex, 1);
        debugLog('🧹 REMOVED ORPHANED PROCESSING PLACEHOLDER', {
            fileName: finalFileName,
            removedItemId: saved[processingIndex]?.id
        });
    }
    
    // Check for duplicate to overwrite
    const overwriteIndex = saved.findIndex(item =>
        item.fileName === finalFileName &&
        item.status !== 'processing'
    );
    if (overwriteIndex !== -1) {
        // Overwrite duplicate
        saved[overwriteIndex] = completedAnalysis;
    } else {
        // Create new entry
        saved.push(completedAnalysis);
    }
}
```

#### Fix 3: Add final placeholder cleanup pass (same as analyzeBtn handler)

**Location:** After line 1988 in `analyzeProject` function, before line 1994

Add a cleanup pass similar to lines 2330-2367 in the `analyzeBtn` handler to ensure placeholder is updated even if autosave path had issues:

```1988:1992:renderer.js
            // Always refresh saved files view when analysis completes
            // This ensures the view updates even if user navigates to it later
            if (savedAnalysesView) {
                await loadSavedAnalyses();
            }
        } catch (error) {
            console.error('Error autosaving analysis:', error);
            // Don't show alert for autosave errors - it's automatic background saving
        }
        
        // Final cleanup: Ensure placeholder is properly updated (backup cleanup)
        if (placeholderId) {
            try {
                let saved = [];
                if (window.electronAPI) {
                    const result = await window.electronAPI.loadAnalyses();
                    if (result.success) {
                        saved = result.data || [];
                    }
                }
                
                // Find placeholder by ID or by fileName+status
                let placeholderIndex = saved.findIndex(item => item.id === placeholderId);
                if (placeholderIndex === -1) {
                    // Fallback: find by fileName and processing status
                    placeholderIndex = saved.findIndex(item =>
                        item.fileName === finalFileName && item.status === 'processing'
                    );
                }
                
                if (placeholderIndex !== -1) {
                    // Ensure placeholder is updated with completed analysis (remove status fields)
                    const currentItem = saved[placeholderIndex];
                    if (currentItem.status === 'processing' || !currentItem.analysis) {
                        // Update placeholder to completed analysis
                        saved[placeholderIndex] = {
                            id: placeholderId,
                            fileName: finalFileName,
                            date: new Date().toISOString(),
                            analysis: analysisData,
                            chatHistory: currentChatHistory,
                            subtitleData: currentSubtitleData
                            // Explicitly omit status, progress, paused fields
                        };
                        
                        // Save updated analysis
                        if (window.electronAPI) {
                            await window.electronAPI.saveAnalyses(saved);
                        }
                        
                        // Refresh saved files view
                        if (savedAnalysesView) {
                            await loadSavedAnalyses();
                        }
                    }
                }
            } catch (error) {
                console.error('Error in final placeholder cleanup:', error);
            }
        }
```

## Implementation Notes

- All three fixes work together to ensure placeholders are properly cleaned up
- Fix 1 ensures the replacement object doesn't inherit status fields
- Fix 2 handles cases where placeholder ID doesn't match
- Fix 3 is a safety net that ensures cleanup happens even if autosave path had issues
- The cleanup logic explicitly creates objects without status/progress/paused fields, ensuring they're not accidentally inherited

### To-dos

- [ ] Fix autosave placeholder replacement to search by fileName+status when ID not found
- [ ] Update duplicate check logic to handle processing placeholders correctly
- [ ] Add defensive checks in second placeholder update path
- [ ] Improve cleanup logic with better logging and progress-based checks
- [ ] Verify placeholderId is preserved correctly throughout analysis flow