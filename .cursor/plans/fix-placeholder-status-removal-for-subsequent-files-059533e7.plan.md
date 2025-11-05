<!-- 059533e7-97a2-4d72-a624-00612b62dcee 47110dc0-6a2f-49f7-b583-58e5cb5eff47 -->
# Prevent Auto-Display for All Files in Multi-File Queue

## Problem

When processing multiple files via queue, the current implementation displays results after each file completes, interrupting the queue processing. The user wants all files (first and subsequent) to be saved but NOT auto-opened during queue processing.

## Solution

### File: `renderer.js`

#### Fix: Conditional Display Based on Queue Processing

**Location:** Around lines 1994-2000 in `analyzeProject` function, after autosave completes

1. **Detect queue processing**: Check if there are any ready files in the queue OR if we're in the middle of queue processing

- If `fileProjects.some(p => p.status === 'ready')` → Queue processing in progress
- If queue processing: Skip all display/switch logic
- If no ready files: Could be last file or single file - need to distinguish

2. **Better approach**: Since `analyzeProject` is called by `processQueue`, check if there are ready files at the START of analysis, not at the end

- Store flag at start: `const isQueueProcessing = fileProjects.some(p => p.status === 'ready');`
- At the end, if `isQueueProcessing`, skip display

3. **Implementation**:

- At start of `analyzeProject` (after finding targetProject), check for ready files
- Store: `const isInQueue = fileProjects.some(p => p.status === 'ready' && p.id !== targetProject.id);`
- After autosave completes, check this flag
- If `isInQueue === true`: Skip all display/switch logic (just save and continue)
- If `isInQueue === false`: Execute display/switch logic (single file or last file)

**Code changes:**

- Add queue detection at start of `analyzeProject` (around line 1596)
- After final cleanup (around line 1993), check the flag
- Conditionally execute lines 1994-2033 (display and view switching) based on queue state