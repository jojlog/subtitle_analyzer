<!-- b1d41e89-107e-488c-bad9-ccdc25b955c1 87146ee2-0d5e-4afc-bc0b-302c7fd64693 -->
# nFile Processing & Save View Unified Refactor

## Overview

Major refactor to implement pause/resume workflow, progress tracking, unified save view with inactive/active saves, and enhanced file management.

## Key Changes

### 1. File Upload & Project Management

- **Upload limit**: Maximum 5 files can be uploaded for analysis
- **Project structure enhancement**:
  ```javascript
  {
    id: string,
    fileName: string,
    subtitleData: array,
    analysisData: object | null,
    status: 'ready' | 'queued' | 'analyzing' | 'paused' | 'completed' | 'error',
    progress: 0-100,
    currentBatchIndex: number,
    processedBatches: array,
    pausedAt: timestamp | null
  }
  ```

- **Duplicate check**: On "Start" click, check for duplicate filename in saved analyses → show rename modal if needed

### 2. Status & Progress Management

- **Status flow**: `ready` → `analyzing` → `completed` | `error`
- **Queue system**: `ready` → `queued` when another file is analyzing
- **Pause system**: `analyzing` → `paused` (saves progress, current batch index)
- **Progress tracking**: 0-100% calculated from batch completion, updated every 25% threshold, persisted in project and saved analyses

### 3. Pause/Resume Implementation

- **Pause**: 
  - Sets `status = 'paused'`, preserves `progress` and `currentBatchIndex`
  - ALL queued files also become `paused`
  - Updates Save View (inactive save shows "Paused (X%)")
  - Button changes to "Resume"
- **Resume**:
  - Only resumes the currently paused file (the one that was analyzing)
  - Sets `status = 'analyzing'`, other paused files revert to `queued`
  - Continues from `currentBatchIndex`
  - Button changes to "Pause"
- **Batch processing modification**: Check `isPaused` flag between batches, save state on pause

### 4. Save View Restructure

- **Inactive Saves** (top section, fixed):
  - Display: Analyzing/Paused/Queued files
  - Format: `[File Name / Status(Progress%) / Date Edited(-)]`
  - Not clickable, no rename/edit
  - Always pinned at top, excluded from sorting

- **Active Saves** (scrollable section):
  - Display: Completed files only
  - Format: `[File Name / Date Edited / Date Created]`
  - Clickable to open, double-click to rename
  - Sortable by File Name, Date Edited, Date Created
  - Header fixed at top, list scrollable

### 5. Date Management

- **Fields**: `dateCreated`, `dateEdited` (replaces single `date`)
- **Migration**: On load, convert existing `date` → `dateCreated = dateEdited = date`
- **Update rules**:
  - Autosave: Updates `dateEdited`
  - Manual save: Updates `dateEdited`
  - Rename: Updates `dateEdited`
  - Completed files never revert to analyzing (status stays `completed`)

### 6. UI Changes

- Remove "Re-analyze" button from file projects list
- Add "Pause"/"Resume" button for analyzing/paused files
- Add progress indicator in file projects list
- Add sortable columns header in Save View
- Add duplicate name modal
- Add exit confirmation modal

### 7. Exit Handling

- Check for unfinished files (`analyzing`, `paused`, `queued`) on window close
- Show warning: "All ongoing files will be deleted. Continue?"
- On confirm: Delete unfinished files, clear inactive saves, exit

## Implementation Files

### `renderer.js` - Main logic changes

- Add file upload limit check (5 files)
- Extend project structure with new fields
- Modify `processSubtitleBatches()` for pause/resume support
- Refactor `analyzeProject()` for status management
- Update `renderFileProjectsList()` for new buttons/status
- Refactor `loadSavedAnalyses()` for inactive/active separation
- Add pause/resume functions
- Add duplicate name check & modal
- Add exit handler

### `index.html` - UI structure

- Update Save View structure (header with sortable columns)
- Add inactive saves section
- Add active saves section
- Add progress indicators
- Add pause/resume buttons

### `styles.css` - Styling

- Add styles for inactive saves
- Add sortable header styles
- Add progress indicator styles
- Add paused/queued status styles

### `main.js` - Exit handling

- Override window close handler
- Check for unfinished files
- Show confirmation dialog
- Clean up on exit

## Data Migration

### Saved Analyses Format

```javascript
{
  id: string,
  fileName: string,
  dateCreated: string (ISO),
  dateEdited: string (ISO),
  analysis: object,
  chatHistory: array,
  subtitleData: array,
  // Legacy: date field (for migration)
}
```

### Inactive Saves (temporary, not persisted)

- Created when analysis starts
- Deleted when analysis completes or program exits
- Display in Save View but not saved to file

## Testing Checklist

- [ ] Upload limit enforcement (5 files)
- [ ] Duplicate name check on start
- [ ] Status transitions (ready → queued → analyzing → completed)
- [ ] Pause functionality (saves state, updates UI)
- [ ] Resume functionality (continues from saved state)
- [ ] Progress tracking (0-100%)
- [ ] Save View separation (inactive/active)
- [ ] Date migration (existing files)
- [ ] Date updates (autosave, rename, manual save)
- [ ] Exit handling (warning, cleanup)
- [ ] Re-analyze button removal
- [ ] Sortable columns in Save View

### To-dos

- [ ] Add 5-file upload limit check in handleFileSelect()
- [ ] Extend fileProjects structure with progress, currentBatchIndex, processedBatches, pausedAt fields
- [ ] Update status system: add queued, paused states and update status transitions
- [ ] Add duplicate filename check on Start click with rename modal
- [ ] Implement pauseProject() and resumeProject() functions with state saving
- [ ] Modify processSubtitleBatches() to support pause/resume with state tracking
- [ ] Implement real-time progress tracking (0-100%) and persistence
- [ ] Refactor Save View: separate inactive saves (top) and active saves (scrollable) with header
- [ ] Add migration logic to convert date → dateCreated/dateEdited for existing saved analyses
- [ ] Implement dateEdited updates on autosave, manual save, and rename
- [ ] Update UI: remove Re-analyze button, add Pause/Resume buttons, add progress indicators
- [ ] Add sortable columns (File Name, Date Edited, Date Created) to Save View header
- [ ] Implement exit confirmation dialog in main.js for unfinished files
- [ ] Add CSS styles for inactive saves, progress indicators, paused/queued states, sortable headers