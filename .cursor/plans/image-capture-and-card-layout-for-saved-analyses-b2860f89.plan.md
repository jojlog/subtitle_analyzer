<!-- b2860f89-4d27-450e-85fc-5f8b1c4c8725 95d341fd-7286-4e47-9445-2ed3577b85df -->
# Folder Organization Feature

## Overview

Add folder organization to saved analyses. Folders appear as special items at the top of the list/cards with distinct UI. Clicking a folder filters to show only its contents. Users can create folders via right-click, assign files via drag-and-drop or context menu, and manage folders (rename, delete).

## Data Structure Changes

### Folder Item Structure

Folders are stored as special items in `saved_analyses.json`:

```javascript
{
  id: string,              // Unique folder ID
  type: 'folder',          // Identifies this as a folder
  folderName: string,      // Folder display name
  dateCreated: string,     // ISO timestamp
  dateEdited: string       // ISO timestamp (updated on rename)
}
```

### File Item Structure

Add optional `folderId` property to saved analysis items:

```javascript
{
  // ... existing properties ...
  folderId: string | null  // ID of parent folder, null if no folder
}
```

## Implementation Details

### 1. Data Management (`renderer.js`)

- **Add folder storage functions**:
  - `createFolder(folderName)`: Creates new folder, saves to analyses array
  - `deleteFolder(folderId)`: Deletes folder, optionally moves files out or deletes them
  - `renameFolder(folderId, newName)`: Updates folder name and dateEdited
  - `assignFileToFolder(fileId, folderId)`: Sets file's folderId property
  - `removeFileFromFolder(fileId)`: Sets file's folderId to null
- **Update save/load logic**: Ensure folders are saved/loaded with analyses array
- **Migration**: Add `folderId: null` to existing items without folderId

### 2. View State Management (`renderer.js`)

- **Add folder filter state**:
  - `currentFolderFilter: string | null`: Currently selected folder ID, null = show all
- **Add breadcrumb state**: Track folder navigation path

### 3. Rendering Updates (`renderer.js`)

#### `renderActiveSaves()` - List View

- **Separate folders and files**: Filter items by `type === 'folder'` vs regular items
- **Render folders first**: Sort folders by name, render with `.saved-item-folder` class
- **Folder UI**: Different styling (folder icon, no dates, clickable to filter)
- **Filter files**: If `currentFolderFilter` is set, only show files with matching `folderId`
- **Show files without folders**: If `currentFolderFilter` is null, show all files (including those with `folderId: null`)

#### `renderActiveSavesAsCards()` - Card View

- **Same separation logic**: Folders first, then filtered files
- **Folder card UI**: Distinct card styling (`.saved-card-folder` class)
- **Folder icon**: Use folder SVG icon instead of thumbnail

### 4. Folder Header/Breadcrumb (`index.html`, `renderer.js`)

- **Add breadcrumb section** in `savedAnalysesView`:
  - Shows "All Files" when no filter
  - Shows folder name with "Back" button when filtered
  - Positioned between header and list/cards
- **Update `loadSavedAnalyses()`**: Render breadcrumb based on `currentFolderFilter`

### 5. Context Menu (`renderer.js`, `index.html`, `styles.css`)

- **Add context menu element** in `index.html`
- **Right-click handlers**:
  - On folder: "Rename Folder", "Delete Folder", "Move Files Out"
  - On file: "Move to Folder" (submenu with folder list), "Remove from Folder"
  - On empty space: "New Folder"
- **Context menu functions**:
  - `showContextMenu(event, item)`: Shows menu at cursor position
  - `hideContextMenu()`: Hides menu
  - Handle menu item clicks

### 6. Drag-and-Drop (`renderer.js`, `styles.css`)

- **Make files draggable**: Add `draggable="true"` to file items
- **Make folders drop targets**: Add drop zone styling to folders
- **Drag handlers**:
  - `dragstart`: Store dragged file ID
  - `dragover`: Prevent default, add visual feedback
  - `drop`: Assign file to folder
  - `dragleave`: Remove visual feedback
- **Visual feedback**: Highlight folder on drag-over

### 7. Folder Management Modals (`renderer.js`, `index.html`, `styles.css`)

- **Create folder modal**: Input for folder name, validation
- **Rename folder modal**: Pre-filled with current name
- **Delete folder confirmation**: Ask what to do with files (move out or delete)

### 8. Styling (`styles.css`)

- **Folder items**:
  - `.saved-item-folder`: Distinct styling (different background, folder icon)
  - `.saved-card-folder`: Folder card styling
- **Context menu**:
  - `.context-menu`: Positioning, styling, animations
  - `.context-menu-item`: Hover effects, submenu indicators
- **Drag-and-drop**:
  - `.drag-over`: Highlight on drag-over
  - `.dragging`: Style for dragged item
- **Breadcrumb**:
  - `.folder-breadcrumb`: Container styling
  - `.folder-breadcrumb-back`: Back button styling

### 9. Event Handlers (`renderer.js`)

- **Folder click**: Set `currentFolderFilter`, re-render
- **Breadcrumb "Back"**: Clear `currentFolderFilter`, re-render
- **Context menu items**: Handle create, rename, delete, move operations
- **Drag-and-drop events**: Handle file assignment

## Files to Modify

1. **`renderer.js`**:

   - Add folder data management functions
   - Update `loadSavedAnalyses()` to handle folders
   - Modify `renderActiveSaves()` and `renderActiveSavesAsCards()` to render folders
   - Add context menu logic
   - Add drag-and-drop handlers
   - Add folder management modals
   - Add breadcrumb rendering

2. **`index.html`**:

   - Add context menu structure
   - Add folder breadcrumb section
   - Add folder management modals

3. **`styles.css`**:

   - Add folder item/card styles
   - Add context menu styles
   - Add drag-and-drop visual feedback
   - Add breadcrumb styles

## Migration Strategy

- On load, add `folderId: null` to existing items without this property
- Folders can be created immediately, no migration needed for folder data

## Testing Considerations

- Create folder, verify it appears at top
- Assign file to folder via drag-and-drop
- Assign file to folder via context menu
- Click folder to filter view
- Click "Back" to return to all files
- Rename folder
- Delete folder (with and without files)
- Verify files without folders show normally
- Test in both list and card views

### To-dos

- [ ] Add IPC handlers in main.js for image capture and thumbnail folder management
- [ ] Expose image capture API in preload.js
- [ ] Add captureAnalysisPreview() function in renderer.js
- [ ] Add auto-capture when analysis completes in autosaveAnalysis()
- [ ] Add 'Capture Preview' button in edit mode for manual image capture
- [ ] Add view toggle buttons (List/Card) in saved analyses header
- [ ] Add CSS styles for card grid layout, card items, and thumbnails
- [ ] Add renderActiveSavesAsCards() function and view toggle functionality
- [ ] Add localStorage persistence for view mode preference
- [ ] Add folder data structure: create folder items with type:folder, add folderId to file items, update save/load logic
- [ ] Update renderActiveSaves() and renderActiveSavesAsCards() to separate and render folders first with distinct UI
- [ ] Implement folder filtering: add currentFolderFilter state, filter files by folderId when folder is clicked
- [ ] Add breadcrumb/header section showing current folder or All Files with Back button
- [ ] Implement right-click context menu: create folder, rename/delete folder, move file to folder, remove from folder
- [ ] Implement drag-and-drop: make files draggable, folders drop targets, visual feedback, assign file to folder on drop
- [ ] Add modals for create folder, rename folder, and delete folder confirmation
- [ ] Add CSS styles for folder items/cards, context menu, drag-and-drop feedback, and breadcrumb