# Subtitle Analyzer – Codebase Assessment

This document summarizes a review of the current Electron project. It highlights structural observations, prioritised refactoring opportunities, code reusability gaps, and notable bugs or risks. Items are grouped to help sequence future work.

## 1. Architecture & Structure
- Single-page Electron renderer (`renderer.js`, ~6.5k lines) combines state, DOM manipulation, business logic, and API calls. Absence of modules or bundling complicates reasoning, reuse, and targeted testing.
- Main process (`main.js`) owns persistence and security-sensitive IPC handlers; logic is solid but mixes diagnostics, UI prompts, and data operations in the same file.
- Styling resides in one `styles.css` with duplicated blocks (e.g., chat vs. study chat).
- README states data lives in localStorage, but the app now persists to files via IPC, which will surprise new contributors.

## 2. Refactoring Opportunities (Prioritised)
1. **Renderer modularisation**
   - Partition into feature modules (uploads, analysis workflow, saved analyses, study mode, chat) with a shared state layer.
   - Introduce a single “store” or context object so UI helpers do not directly access globals.
2. **Typed models & helpers**
   - Define TypeScript interfaces (or JS JSDoc typedefs) for `Project`, `Analysis`, `Expression`, `StudySession` to validate payloads and avoid defensive checks sprinkled throughout.
3. **Renderer ↔ main IPC services**
   - Wrap Electron API calls in a dedicated service module that caches reads (analyses, study sessions) and batches writes. Reduces repeated `loadAnalyses()` per keypress.
4. **UI rendering utilities**
   - Reusable factories for chat bubbles, saved-item rows, expression cards, and accordion blocks would replace the long string templates embedded in logic branches.
5. **Asynchronous workflow**
   - Encapsulate the batch processing pipeline (queue management, placeholder handling, pause/resume) into a controller object. This simplifies cancellation and exposes hooks for progress UI.
6. **Configuration & environment**
   - Centralize constants (file limits, debounce intervals, progress thresholds, model names) in a configuration module and load overrides from `process.env` for production builds.

## 3. Streamlining & Reuse
- **Expression rendering:** `displayExpressions` and `displayStudyExpressions` share 80% logic. Extract shared rendering and inject mode-specific behaviour (tooltips, buttons).
- **Chat components:** The main chat and study chat share styling and message assembly code. A single chat message builder (with configuration for button labels) reduces duplication.
- **Modals:** Warning, rename, and generic modals can be powered by one modal manager that accepts content/handlers, instead of bespoke implementations.
- **Styles:** Consolidate duplicate CSS (e.g., `.chat-message`, `.study-chat-message`, `.add-to-list-btn`) using utility classes or SASS mixins. Also opportunity to split `styles.css` by feature.
- **Logging:** Provide wrapper around `debugLog` that automatically tags the feature/module so downstream logging stays readable after refactoring.

## 4. Quality & Risk Findings
- **Filename validation (fixed):** Trailing spaces or dots were not caught because validation ran on a trimmed string. The rename flows now validate the raw input, reject invalid entries, and use the sanitized value when persisting.
- **Duplicate saved analyses:** Previously, both the analysis pipeline and saved-view rename logic used slightly different duplicate checks. Normalising the validation plus sanitisation removes the divergence.
- **Exit handling:** The main-process `executeJavaScript` checks for unfinished work. Consider replacing this with an explicit renderer-to-main IPC call to avoid failures if the renderer is unresponsive.
- **API quota handling:** `callOpenAI` retries on network/429 errors but lacks cancellation hooks and does not cap `max_tokens` based on prompt length. Recommend computing available tokens dynamically and wiring an `AbortController` for cancellations.
- **DevTools in production:** `mainWindow.webContents.openDevTools()` runs unconditionally. Gate behind `DEBUG_ENABLED` or a CLI flag before shipping.
- **Persistence churn:** Frequent `loadAnalyses()` calls within tight loops (e.g., progress updates, rename) trigger unnecessary disk I/O. Cache results during a single operation and flush once.
- **UI alerts:** `alert()` usage blocks the event loop. Replace with in-app notification modals for better UX and future automation.
- **README drift:** Update documentation to reflect secure filesystem storage, rename limits, and new study mode controls.

## 5. Testing & Tooling Recommendations
- Add automated parsing tests (fixtures for `.vtt`/`.txt`) validating `parseVTT`/`parseTXT`, `isValidSubtitleText`, and batching logic.
- Unit-test `validateFileName`, modal helpers, and the new sanitisation behaviour.
- Introduce linting (`eslint`) and formatting (`prettier`) to enforce consistent style—especially before splitting modules.
- Consider end-to-end smoke tests (Playwright/Spectron alternative) once renderer code is modular.

## 6. Completed Fix
- **Filename sanitisation & rename flows**
  - `validateFileName` now inspects the raw user input for leading/trailing whitespace or dots and returns a sanitized name when valid.
  - Saved analysis and duplicate-name workflows consume the sanitized value to eliminate silent trimming and ensure consistent persistence.

## 7. Suggested Next Steps
1. Plan the renderer decomposition (decide folder layout, module boundaries, and whether to adopt a bundler).
2. Introduce shared data models and migrate hot paths (file projects, saved analyses) to the new store/service abstraction.
3. Replace modal/notification alerts with a unified modal manager.
4. Update README and in-app help to reflect current persistence and limits.
5. Add regression tests around the filename validation changes and core parsers.

This roadmap should be revisited after step 1—once the renderer has clear module boundaries the rest of the cleanup becomes markedly easier.
