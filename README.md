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

2. (Optional) For development, create a `.env` file in the project root:
```bash
cp .env.example .env
# Then edit .env and add your OpenAI API key:
# OPENAI_API_KEY=sk-your-api-key-here
```
If you have a `.env` file, the API key will be automatically loaded from there. Otherwise, you can enter it through the app's Settings UI.

3. Start the application:
```bash
npm start
```

## Usage

1. **Set API Key**: 
   - **Development**: Create a `.env` file with `OPENAI_API_KEY=sk-your-key-here` (automatically loads on startup)
   - **Production**: Click the settings icon (⚙️) in the header and enter your OpenAI API key (saved encrypted)
2. **Upload File**: Drag and drop a .vtt file or click to browse
3. **Analyze**: Click the "Analyze" button to process the subtitle file
4. **Ask Questions**: Use the chat interface at the bottom to ask follow-up questions
5. **Save**: Click "Save Analysis" to save your work
6. **View Saved**: Click the folder icon (📁) to view and reopen saved analyses

## Requirements

- Node.js and npm
- OpenAI API key (get one at https://platform.openai.com/api-keys)

## Security

- **API Key Encryption**: API keys are encrypted using AES-256-GCM before being stored on disk
- **Secure Storage**: API keys are stored in Electron's secure user data directory, not in the project folder
- **File Permissions**: Sensitive files are protected with secure file permissions (owner-only read/write)
- **No Hardcoded Keys**: No API keys are hardcoded in the source code
- **Secure Error Handling**: API keys are never exposed in error messages or logs

## Notes

- API keys and analyses are stored encrypted in the user's data directory
- Analyses are saved locally and persist between sessions
- Maximum of 50 saved analyses (oldest are removed when limit is reached)

