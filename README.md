# Swedish Subtitle Analyzer

A desktop application for analyzing Swedish subtitle files (.vtt) using GPT-4o-mini, providing translations, important expressions, and an interactive chat feature.

## Features

- Upload and parse .vtt subtitle files
- Analyze subtitles with GPT-4o-mini for:
  - English translations (literal and natural)
  - Important expressions and words extraction
- Interactive chat to ask follow-up questions
- Save analyses and chat history
- Reopen saved analyses

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the application:
```bash
npm start
```

## Usage

1. **Set API Key**: Click the settings icon (⚙️) in the header and enter your OpenAI API key
2. **Upload File**: Drag and drop a .vtt file or click to browse
3. **Analyze**: Click the "Analyze" button to process the subtitle file
4. **Ask Questions**: Use the chat interface at the bottom to ask follow-up questions
5. **Save**: Click "Save Analysis" to save your work
6. **View Saved**: Click the folder icon (📁) to view and reopen saved analyses

## Requirements

- Node.js and npm
- OpenAI API key (get one at https://platform.openai.com/api-keys)

## Notes

- Sensitive data (API keys, analyses, study sessions, theme) is stored as JSON files in the Electron `userData` directory. API keys are encrypted at rest.
- Analyses persist between sessions; renaming enforces OS-safe filenames (no leading/trailing spaces or dots, no reserved Windows names).
- Maximum of 50 saved analyses (oldest are removed when limit is reached).

## Development

- Lint: `npm run lint`
- Format: `npm run format`
- The renderer is being modularised; new code should prefer shared store/services in `src/`.
