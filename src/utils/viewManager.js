/**
 * View Manager - Centralized view state management
 * Consolidates all view show/hide logic to reduce duplication
 */

const VIEWS = {
    UPLOAD: 'upload',
    RESULTS: 'results',
    SAVED_ANALYSES: 'savedAnalyses',
    SETTINGS: 'settings',
    CHAT: 'chat',
    STUDY_MODAL: 'studyModal',
    CHAT_HISTORY_MODAL: 'chatHistoryModal'
};

class ViewManager {
    constructor() {
        this.views = new Map();
        this.currentView = null;
    }

    /**
     * Register a view element
     * @param {string} viewId - View identifier
     * @param {HTMLElement} element - DOM element
     */
    register(viewId, element) {
        if (!element) {
            console.warn(`View element not found for: ${viewId}`);
            return;
        }
        this.views.set(viewId, element);
    }

    /**
     * Show a specific view and hide others
     * @param {string} viewId - View to show
     * @param {string[]} exceptions - Views to keep visible (optional)
     */
    show(viewId, exceptions = []) {
        const element = this.views.get(viewId);
        if (!element) {
            console.warn(`View not registered: ${viewId}`);
            return;
        }

        // Hide all views except exceptions
        this.views.forEach((el, id) => {
            if (id === viewId || exceptions.includes(id)) {
                // Use appropriate display value based on view type
                if (id === VIEWS.SAVED_ANALYSES || id === VIEWS.UPLOAD || id === VIEWS.SETTINGS) {
                    el.style.display = 'flex';
                } else if (id === VIEWS.RESULTS) {
                    el.style.display = 'block';
                } else {
                    el.style.display = 'flex';
                }
            } else {
                el.style.display = 'none';
            }
        });

        this.currentView = viewId;
    }

    /**
     * Hide a specific view
     * @param {string} viewId - View to hide
     */
    hide(viewId) {
        const element = this.views.get(viewId);
        if (element) {
            element.style.display = 'none';
            if (this.currentView === viewId) {
                this.currentView = null;
            }
        }
    }

    /**
     * Check if a view is visible
     * @param {string} viewId - View to check
     * @returns {boolean}
     */
    isVisible(viewId) {
        const element = this.views.get(viewId);
        return element && element.style.display !== 'none';
    }

    /**
     * Get current view
     * @returns {string|null}
     */
    getCurrentView() {
        return this.currentView;
    }

    /**
     * Show home view (upload section)
     */
    showHome() {
        this.show(VIEWS.UPLOAD);
    }

    /**
     * Show results view
     */
    showResults() {
        this.show(VIEWS.RESULTS);
    }

    /**
     * Show saved analyses view
     */
    showSavedAnalyses() {
        this.show(VIEWS.SAVED_ANALYSES);
    }

    /**
     * Show settings view
     */
    showSettings() {
        this.show(VIEWS.SETTINGS);
    }
}

export const viewManager = new ViewManager();
export { VIEWS };
