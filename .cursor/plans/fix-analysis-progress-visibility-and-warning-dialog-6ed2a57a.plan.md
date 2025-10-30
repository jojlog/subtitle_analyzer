<!-- 6ed2a57a-6d97-4014-8da0-90c8fd307d6b bd67c695-1a33-4930-b704-509935777e63 -->
# Replace Level Checkboxes with Dropdown, Autosave, and Fix Delete Bug

## Step-by-Step Implementation Plan

### Phase 1: Replace Checkboxes with Dropdown Menu

#### Step 1.1: Update HTML structure for dropdown

- **File**: `index.html` (lines 74-110)
- Remove existing `.level-filter-section` with inline checkboxes
- Create new dropdown structure:
  - Add button element: `<button class="level-filter-btn">Filter by CEFR Level: [All ▼]</button>`
  - Add dropdown container: `<div class="level-dropdown" style="display: none;">`
  - Inside dropdown: Add "ALL" checkbox with separator line
  - Add individual level checkboxes (A1, A2, B1, B2, C1, C2, C3, Custom)

#### Step 1.2: Add CSS for dropdown

- **File**: `styles.css`
- Replace `.level-filter-section` styles with dropdown styles
- Style `.level-filter-btn` (button appearance with arrow indicator)
- Style `.level-dropdown` (position absolute, hidden by default, appears on click)
- Style `.level-dropdown-checkbox` (checkboxes inside dropdown)
- Add separator styling after "ALL" option
- Add hover/transition effects

#### Step 1.3: Implement dropd