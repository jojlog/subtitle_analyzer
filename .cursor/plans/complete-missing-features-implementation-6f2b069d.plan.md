<!-- 6f2b069d-ec91-4d4c-8195-af81c5bbdda6 ab3bd17e-b361-42c9-8c2b-371761fdbe73 -->
# Fix filestatusworkflow.md Specification Gaps

## Issues to Fix

### Issue 1: Inactive Save Display Format

**Location**: `renderer.js` lines 3979-3990 (`renderInactiveSaves`)

**Problem**:

- Spec requires: `[File Name / Date Created(Status) / Date Edited(-)]`
- Current shows: `[File Name / Status(Progress%) / Date Edited(-)]`
- Status should appear in the "Date Created" column position, not as a separate middle column

**Solution**:

- Modify `renderInactiveSaves` function to match spec format
- Change structure to show status in Date Created position
- Update HTML template to match: `[File Name / Status(Progress%) / Date Edited(-)]` but semantically place status where Date Created would be

**Files**: `renderer.js`

---

### Issue 2: Rename Duplicate Check Missing

**Location**: `renderer.js` lines 4079-4120 (`saveRename` function)

**Problem**:

- Spec requires duplicate filename check on rename with warning: "A file with this name already exists."
- Current implementation only validates filename format, no duplicate check

**Solution**:

- Add duplicate check before saving rename
- Check if new name already exists in saved analyses (excluding current item)
- Show alert: "A file with this name already exists."
- Prevent rename if duplicate found

**Files**: `renderer.js`

---

### Issue 3: Delete Confirmation Message

**Location**: `renderer.js` line 3531

**Problem**:

- Spec requires: "Are you sure you want to permanently delete this file?"
- Current: "Are you sure you want to delete X saved analysis/analyses?"
- Missing "permanently" in message

**Solution**:

- Update confirmation message to match spec
- For single file: "Are you sure you want to permanently delete this file?"
- For multiple files: "Are you sure you want to permanently delete these files?"

**Files**: `renderer.js`

---

### Issue 4: Double-Click Rename

**Location**: `renderer.js` lines 4085-4134 (`renderActiveSaves` function)

**Problem**:

- Spec requires: "Double-click to rename (syncs actual file)"
- Current: Uses single-click "rename" button
- Missing double-click event listener on filename span

**Solution**:

- Add double-click event listener to `.saved-item-name` span in active saves
- On double-click, trigger rename mode (same as rename button click)
- Ensure it works alongside existing rename button functionality

**Files**: `renderer.js`

---

### Issue 5: Exit Message Text

**Location**: `main.js` lines 103-104

**Problem**:

- Spec requires: "All ongoing files will be deleted. Continue?"
- Current: "All ongoing files will be deleted." + detail text
- Message should be more concise and match spec

**Solution**:

- Update `message` to: "All ongoing files will be deleted."
- Update `detail` to: "You have X file(s) that are currently analyzing, paused, or queued. Continue?"
- Or combine into single message matching spec exactly

**Files**: `main.js`

## Implementation Order

1. Issue 1: Inactive Save Display Format (UI change) - COMPLETED
2. Issue 2: Rename Duplicate Check (logic addition) - COMPLETED
3. Issue 3: Delete Confirmation Message (text update) - COMPLETED
4. Issue 4: Double-Click Rename (UX enhancement) - COMPLETED
5. Issue 5: Exit Message Text (text update) - COMPLETED

## Testing Considerations

- Verify inactive saves display correctly with status in Date Created position
- Test rename duplicate check prevents overwriting existing files
- Verify delete confirmation shows "permanently"
- Test double-click rename on active save filenames
- Verify exit dialog message matches spec

### To-dos

- [ ] Fix inactive save display format to show status in Date Created column position as per spec
- [ ] Add duplicate filename check in rename function with proper warning message
- [ ] Update delete confirmation message to include 'permanently' as per spec
- [ ] Add double-click event listener to filename span for rename functionality
- [ ] Update exit confirmation dialog message to match spec exactly