<!-- 12f7cc92-da89-4732-8714-25713ac2948f 32fecc36-6a58-4b67-bfe9-aa9cd96246ef -->
# Create Placeholders for Queued Files and Show Paused Status

## Requirements

1. Queued files should create placeholders in Saved Analyses when they become queued (1-A)
2. Queued files in Home view should show "Paused" status text (not "queued") when paused (2-YES)

## Implementation Plan

### 1. Create Placeholders for Queued Files

**File:** `renderer.js`

**Location:** `analyzeProject()` function (around line 1469-1526)

- **Current behavior:** Only the analyzing file creates a placeholder
- **Change needed:** When a file starts analyzing, create placeholders for all queued files too
- **Implementation:**
- After creating placeholder for analyzing file (line 1480-1505)
- Loop through `fileProjects` array
- Find all files where `status === 'ready'` AND `isAnalyzing && !isAnalyzingProject` (queued condition)
- For each queued file, create a placeholder entry with:
  - `status: 'processing'`
  - `paused: false`
  - `progress: 0`
  - `fileName`: queued file's name
  - Same structure as analyzing file's placeholder
- Add all queued file placeholders to the saved array
- Save to storage

### 2. Update Placeholders for Queued Files When Pause State Changes

**File:** `renderer.js`

**Location:** `updateSavedItemStatusFromPause()` function (around line 2820-2848)

- **Current behavior:** Only updates the current analyzing file's placeholder
- **Change needed:** Also update all queued files' placeholders when pause state changes
- **Implementation:**
- After updating current placeholder (line 2834-2840)
- Find all saved items with `status === 'processing'` AND `paused !== undefined`
- Check if each item corresponds to a queued file in Home view
- For each queued file placeholder, update `paused` field
- Save updated array to storage
- Refresh Saved files view if open

### 3. Show "Paused" Status for Queued Files in Home View When Paused

**File:** `renderer.js`

**Location:** `renderFileProjectsList()` function (around line 1348-1350)

- **Current behavior:** Queued files always show "queued" status text
- **Change needed:** Show "Paused" when `isQueued && isPaused`
- **Implementation:**
- Modify the queued status logic (line 1348-1350)
- Check if `isQueued && isPaused`
- If paused: show statusText as "Paused"
- If not paused: show statusText as "queued"
- Keep statusClass as 'status-ready' for both (or change if needed)

### 4. Clean Up Queued File Placeholders When Processing Starts

**File:** `renderer.js`

**Location:** `analyzeProject()` function (around line 1502)

- **Current behavior:** Only removes placeholder for current analyzing file
- **Change needed:** When a queued file starts processing, remove its old placeholder and update it to analyzing status
- **Implementation:**
- When starting analysis of a queued file (in `analyzeProject`)
- Before creating new placeholder, check if placeholder exists for this file
- If exists and status is 'processing', update it to reflect it's now analyzing
- Update `paused: false` and reset progress
- This ensures smooth transition from queued to analyzing