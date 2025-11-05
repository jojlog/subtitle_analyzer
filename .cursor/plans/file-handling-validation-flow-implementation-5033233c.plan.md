<!-- 5033233c-690d-44af-b2d3-cd7cb23efa5a bf5e8647-69f4-4958-8df9-c997b7cada4b -->
# Verify and Fix SubtitleData Preservation

## Investigation Findings

- SubtitleData IS saved in autosave (line 1909: `subtitleData: currentSubtitleData`)
- SubtitleData IS loaded when reopening (line 3983: `currentSubtitleData = savedItem.subtitleData`)
- SubtitleData IS used for timestamps (line 2665 calls `findTimestampForText` which uses `currentSubtitleData`)

## Potential Issues

1. No logging to verify subtitleData is actually present in saved items
2. No validation to ensure subtitleData exists when reopening
3. No check if subtitleData is lost during fresh data reload

## Solution

### 1. Add subtitleData logging in autosave (`renderer.js` ~line 2052)

- Log whether subtitleData exists in saved items
- Log subtitleData length/count for verification

### 2. Add subtitleData validation in reopenAnalysis (`renderer.js` ~line 3925)

- Check if subtitleData exists when reopening
- Log warning if subtitleData is missing
- Still allow reopening but note that timestamps won't work

### 3. Add logging to verify subtitleData in saved items (`renderer.js` ~line 2056)

- Include subtitleData presence in the debug log
- This helps diagnose if subtitleData is being preserved

## Files to Modify

- `renderer.js`: Autosave logging (~line 2052)
- `renderer.js`: reopenAnalysis validation (~line 3925)

### To-dos

- [ ] Create showEditFileNameDialog() function to handle renaming
- [ ] Add subtitleData logging in autosave to verify it exists in saved items
- [ ] Add subtitleData validation in reopenAnalysis to check if it exists
- [ ] Add subtitleData presence check in debug logs