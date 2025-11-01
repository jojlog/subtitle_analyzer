# Security Information

This document outlines the security measures implemented in the Swedish Subtitle Analyzer application.

## API Key Storage

### Encryption
- API keys are encrypted using **AES-256-GCM** (Advanced Encryption Standard with Galois/Counter Mode)
- The encryption key is derived from machine-specific data (app name and user data path)
- This ensures that encrypted API keys cannot be decrypted on other machines

### Storage Location
- API keys are stored in Electron's `userData` directory (platform-specific)
  - **macOS**: `~/Library/Application Support/swedish-subtitle-analyzer/`
  - **Windows**: `%APPDATA%/swedish-subtitle-analyzer/`
  - **Linux**: `~/.config/swedish-subtitle-analyzer/`
- This location is outside the project directory and not tracked by version control

### File Permissions
- Sensitive files are protected with owner-only permissions (600) on Unix/Mac systems
- This prevents other users from reading the API key files

## Security Best Practices

### What We Do
✅ Encrypt API keys before storing them on disk  
✅ Use secure file permissions for sensitive files  
✅ Store sensitive data outside the project directory  
✅ Never log or expose API keys in error messages  
✅ Validate API key format before encryption  
✅ Use context isolation and secure IPC in Electron  

### What We Don't Do
❌ Hardcode API keys in source code  
❌ Store API keys in plain text  
❌ Expose API keys in console logs  
❌ Commit sensitive files to version control  
❌ Use weak encryption algorithms  

## .gitignore

The `.gitignore` file ensures that sensitive files are never committed to version control:
- `.env` files and environment variables
- User data files (API keys, saved analyses, etc.)
- IDE and editor files

## Development

When developing this application:
1. Never commit actual API keys to the repository
2. Use your own API key for testing
3. The encryption automatically migrates old plain-text keys to encrypted format
4. Always use secure practices when handling sensitive data

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly rather than creating a public issue.

