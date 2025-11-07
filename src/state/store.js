/**
 * @fileoverview Centralised renderer state container with light pub-sub helpers.
 * Designed to help migrate the monolithic renderer into feature modules.
 */

/**
 * @typedef {Object} SubtitleCue
 * @property {string} start
 * @property {string} end
 * @property {string} [text]
 */

/**
 * @typedef {Object} Expression
 * @property {string} word
 * @property {string} [meaning]
 * @property {string} [example]
 * @property {string} [level]
 * @property {number} [translationIndex]
 */

/**
 * @typedef {Object} Analysis
 * @property {Array<{
 *   swedish: string,
 *   literal?: string,
 *   natural?: string,
 *   timestamp?: SubtitleCue
 * }>} translations
 * @property {Expression[]} expressions
 */

/**
 * @typedef {Object} StudySession
 * @property {string} id
 * @property {string} fileName
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {Analysis} analysis
 */

/**
 * @typedef {Object} FileProject
 * @property {string} id
 * @property {string} fileName
 * @property {SubtitleCue[]} subtitleData
 * @property {Analysis | null} [analysisData]
 * @property {'queued' | 'analyzing' | 'ready' | 'completed' | 'error'} status
 * @property {number} [progress]
 * @property {boolean} [isFavorite]
 * @property {number} [currentBatchIndex]
 * @property {Array<any>} [processedBatches]
 * @property {string | null} [pausedAt]
 * @property {string} [estimatedTimeRemaining]
 */

/**
 * @typedef {Object} RendererState
 * @property {Analysis | null} currentAnalysis
 * @property {Array<any>} currentChatHistory
 * @property {SubtitleCue[] | null} currentSubtitleData
 * @property {string | null} apiKey
 * @property {boolean} isAnalyzing
 * @property {boolean} shouldCancelAnalysis
 * @property {boolean} isPaused
 * @property {boolean} isProcessingQueue
 * @property {number[]} progressUpdateTimeouts
 * @property {FileProject[]} fileProjects
 * @property {string | null} currentProjectId
 * @property {string | null} currentPlaceholderId
 */

/** @type {RendererState} */
const state = {
    currentAnalysis: null,
    currentChatHistory: [],
    currentSubtitleData: null,
    apiKey: null,
    isAnalyzing: false,
    shouldCancelAnalysis: false,
    isPaused: false,
    isProcessingQueue: false,
    progressUpdateTimeouts: [],
    fileProjects: [],
    currentProjectId: null,
    currentPlaceholderId: null,
};

/** @type {Set<() => void>} */
const subscribers = new Set();

/**
 * @returns {RendererState}
 */
export function getState() {
    return state;
}

/**
 * @param {(state: RendererState) => void} listener
 * @returns {() => void} unsubscribe fn
 */
export function subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
}

function notify() {
    subscribers.forEach((listener) => {
        try {
            listener(state);
        } catch (error) {
            console.error('State subscriber threw', error);
        }
    });
}

/**
 * @param {Partial<RendererState>} partial
 */
export function setState(partial) {
    Object.assign(state, partial);
    notify();
}

/**
 * @param {keyof RendererState} key
 * @param {RendererState[keyof RendererState]} value
 */
export function setStateValue(key, value) {
    state[key] = value;
    notify();
}

/**
 * Convenience helper for exposing state snapshots to the Electron main process
 * without leaking mutable references.
 * @returns {{ currentAnalysis: Analysis | null; currentChatHistory: any[]; fileProjects: FileProject[]; }}
 */
export function getSerializableState() {
    return {
        currentAnalysis: state.currentAnalysis,
        currentChatHistory: [...state.currentChatHistory],
        fileProjects: [...state.fileProjects],
    };
}

/**
 * Mirror selected state values to the window object for backwards compatibility
 * with legacy code paths. This should be removed once the renderer is fully modularised.
 * @param {Window & typeof globalThis} target
 */
export function exposeStateToWindow(target = window) {
    Object.defineProperties(target, {
        fileProjects: {
            get() {
                return state.fileProjects;
            },
            configurable: true,
        },
        isAnalyzing: {
            get() {
                return state.isAnalyzing;
            },
            set(value) {
                state.isAnalyzing = Boolean(value);
                notify();
            },
            configurable: true,
        },
        isPaused: {
            get() {
                return state.isPaused;
            },
            set(value) {
                state.isPaused = Boolean(value);
                notify();
            },
            configurable: true,
        },
        currentPlaceholderId: {
            get() {
                return state.currentPlaceholderId;
            },
            set(value) {
                state.currentPlaceholderId = value;
                notify();
            },
            configurable: true,
        },
    });
}

/**
 * Replace the internal fileProjects array reference while keeping existing subscribers informed.
 * @param {FileProject[]} projects
 */
export function setFileProjects(projects) {
    state.fileProjects = projects;
    notify();
}

/**
 * Push a project into state in place.
 * @param {FileProject} project
 */
export function addFileProject(project) {
    state.fileProjects.push(project);
    notify();
}

/**
 * Remove projects by predicate.
 * @param {(project: FileProject) => boolean} predicate
 */
export function filterFileProjects(predicate) {
    state.fileProjects = state.fileProjects.filter(predicate);
    notify();
}

/**
 * Reset progress timeout handles and clear them to avoid leaks.
 */
export function clearProgressTimeouts() {
    state.progressUpdateTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    state.progressUpdateTimeouts = [];
}
