<!-- 87458c39-8d1e-4490-a9f0-045058c8b7b4 5665625e-4717-44af-b82b-99b699ac5118 -->
# Fix Duplicate File Entries During Processing

## Problem

When processing starts, duplicate entries for the same file are created, showing the same file multiple times in the list with different analyzing statuses.

## Root Cause

The deduplication logic in `renderFileProjectsList` only runs during rendering, but duplicates may already exist in the `fileProjects` array. When a file's status changes to 'analyzing', if there are duplicate entries with the same fileName, both remain in the array.

## Solution

### 1. Add Deduplication Before Status Change

**File:** `renderer.js`
**Location:** `analyzeProject` function (around line 1398)

- Before setting `project.status = 'analyzing'`, remove any other entries with the same `fileName` from `fileProjects`
- Ensure only one entry per fileName exists before processing starts

### 2. Strengthen Deduplication Logic

**File:** `renderer.js`
**Location:** `renderFileProjectsList` function (around line 1266)

- Improve the deduplication logic to be more aggressive
- Always remove duplicates before adding to the map, not just compare
- Ensure the `fileProjects` array is updated synchronously, not just during render

### 3. Add Deduplication Helper Function

**File:** `renderer.js`

- Create a `deduplicateFileProjects()` helper function that:
- Takes the current `fileProjects` array
- Removes all duplicate entries by fileName
- Keeps only the entry with highest priority status (analyzing > ready > completed > error)
- Returns the cleaned array and updates the global `fileProjects`

### 4. Call Deduplication Before Critical Operations

**File:** `renderer.js`

- Call `deduplicateFileProjects()` before:
- Setting status to 'analyzing' in `analyzeProject`
- Rendering the list in `renderFileProjectsList`
- Starting queue processing in `processQueue`

## Implementation Details

- The deduplication should happen synchronously before status changes
- Priority: analyzing > ready > completed > error
- When same priority, prefer the one with matching `currentProjectId` if set
- Update the global `fileProjects` array immediately after deduplication

### To-dos

- [ ] Update both analysis completion handlers to always refresh saved analyses view, regardless of current view state
- [ ] Add cleanup logic in loadSavedAnalyses to remove status/progress fields from already completed files
- [ ] Verify that analysis completion properly removes status and progress fields from saved items