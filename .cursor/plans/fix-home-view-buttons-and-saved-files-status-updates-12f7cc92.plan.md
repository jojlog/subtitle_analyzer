<!-- 12f7cc92-da89-4732-8714-25713ac2948f fcf67499-1f24-4bd8-9df5-b146e99ca0ed -->
# Fix Placeholder Replacement to Use Original Filename

## Problem

When analysis completes and a placeholder exists, the code checks for duplicate filenames and prompts the user for a new name. However, placeholders should always be replaced with their original filename since they were created specifically for that file.

## Solution

### 1. Remove Duplicate Check and Prompt for Placeholders

**File:** `renderer.js`
**Location:** Autosave section in `analyzeProject()` function (around lines 1651-1740)

**Current behavior:**

- Checks for duplicates even when placeholder exists
- Prompts user for new filename if duplicate found
- This prevents placeholders from being replaced with their original filename

**Required behavior:**

- When placeholder exists (placeholderId found): Replace placeholder directly with its original filename - no duplicate check, no prompt
- When no placeholder exists (new entry): Check for duplicates and prompt if needed

**Implementation:**

- Split the logic into two paths:

1. **If placeholder exists:** 

- Get the placeholder's fileName directly
- Replace the placeholder with completed analysis using that fileName
- Skip duplicate check and prompt entirely

2. **If no placeholder exists:**

- Get filename from project
- Check for duplicates
- Prompt for new filename if duplicate found
- Create new entry with final filename

**Changes needed:**

- Move duplicate check and prompt logic to only run when `placeholderId` is null or placeholder not found
- When placeholder exists and is found, directly update it with its stored fileName

### To-dos

- [ ] Split autosave logic: if placeholder exists, replace it directly with placeholder's original filename (no duplicate check, no prompt)
- [ ] Keep duplicate check and prompt only for new entries (when no placeholder exists)