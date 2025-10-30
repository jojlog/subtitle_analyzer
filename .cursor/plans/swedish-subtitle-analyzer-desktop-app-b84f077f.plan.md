<!-- b84f077f-7e48-429d-9fe6-5aeabd594699 54423229-0812-48d7-9c59-de9e1d49a022 -->
# Fix txt File Support Issues

## Problem

The txt file support was added but files are still showing validation errors, suggesting currentSubtitleData is null or empty when it shouldn't be.

## Root Causes to Fix

1. Case sensitivity: File extension check uses `.endsWith('.txt')` which won't match `.TXT`
2. File input handler might not be calling handleFileSelect correctly
3. parseTXT might be returning empty array in some cases
4. Need to ensure all code paths handle txt files

## Solution

1. Make file extension checks case-insensitive
2. Verify file input handler properly calls handleFileSelect
3. Add error handling and ensure parseTXT always returns valid data
4. Add console logging for debugging

## Implementation Steps

### 1. Make file extension checks case-insensitive

- Update all `.endsWith('.txt')` and `.endsWith('.vtt')` checks to use case-insensitive comparison
- Use `.toLowerCase()` before checking extensions

### 2. Verify file input change handler

- Ensure fileInput change event properly passes the file to handleFileSelect
- Check if there are any conditions that might prevent the handler from running

### 3. Improve parseTXT robustness

- Ensure parseTXT handles empty files gracefully
- Return at least an empty array (not null) to prevent errors
- Handle different line ending formats

### 4. Add error handling

- Add try-catch around file parsing
- Log errors to console for debugging
- Show helpful error messages

### 5. Files to modify

- `/Users/zone/Downloads/subtitle_analyzer/renderer.js` - Fix all file extension checks and improve error handling

### To-dos

- [ ] Make all file extension checks case-insensitive using toLowerCase()
- [ ] Verify fileInput change handler properly calls handleFileSelect
- [ ] Improve parseTXT to handle edge cases and ensure it never returns null
- [ ] Add error handling and logging around file parsing