/**
 * Unified Expression Renderer
 * Consolidates displayExpressions and displayStudyExpressions logic
 */

import { escapeHtml } from './helpers.js';

/**
 * Render expressions to a container
 * @param {HTMLElement} container - Container element to render into
 * @param {Array} expressions - Array of expressions to render
 * @param {Object} options - Rendering options
 * @param {string} options.mode - 'main' or 'study'
 * @param {Array} options.selectedLevels - Levels to filter by (for main mode)
 * @param {Function} options.onClick - Click handler function
 * @param {Function} options.findTimestamp - Function to find timestamp for expression
 * @param {Function} options.formatTimestamp - Function to format timestamp
 * @param {Function} options.fixEncoding - Function to fix encoding issues
 */
export function renderExpressions(container, expressions, options = {}) {
    const {
        mode = 'main',
        selectedLevels = [],
        onClick = null,
        findTimestamp = null,
        formatTimestamp = null,
        fixEncoding = (text) => text // Default: no encoding fix
    } = options;

    if (!container) {
        console.error('Expression container not provided');
        return;
    }

    if (!expressions || expressions.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; padding: 16px;">No expressions found.</p>';
        return;
    }

    container.innerHTML = '';

    // Filter expressions based on mode
    let filteredExpressions = expressions;
    
    if (mode === 'main' && selectedLevels.length > 0) {
        filteredExpressions = expressions.filter(expr => {
            if (!expr.level) return true; // Backward compatibility
            return selectedLevels.includes(expr.level);
        });
    }
    // Study mode filtering is handled by caller (based on current study item)

    // Render each expression
    filteredExpressions.forEach((expr) => {
        const item = document.createElement('div');
        const itemClass = mode === 'study' ? 'study-expression-item' : 'expression-item';
        item.className = itemClass;

        // Add level attribute for study mode hover popup
        if (mode === 'study' && expr.level) {
            item.setAttribute('data-expression-level', expr.level);
        }

        let html = '';

        if (mode === 'main') {
            // Main mode: timestamp + word + meaning
            const timestamp = findTimestamp ? findTimestamp(expr.word) : null;
            const timestampStr = timestamp && formatTimestamp ? formatTimestamp(timestamp) : '';
            
            html = `<div class="expression-item-content">`;
            html += timestampStr 
                ? `<div class="expression-timestamp">${escapeHtml(timestampStr)}</div>`
                : `<div class="expression-timestamp"></div>`;
            html += `<div class="expression-text-wrapper">`;
            html += `<span class="expression-word">${escapeHtml(fixEncoding(expr.word))}</span>`;
            if (expr.meaning) {
                html += `<span class="expression-meaning">${escapeHtml(fixEncoding(expr.meaning))}</span>`;
            }
            if (expr.example) {
                html += `<div style="margin-top: 4px; font-size: 12px; color: #999;">Example: ${escapeHtml(fixEncoding(expr.example))}</div>`;
            }
            html += `</div></div>`;
        } else {
            // Study mode: word + meaning + example (horizontal layout)
            html = `<div class="study-expression-content">`;
            html += `<span class="study-expression-word">${escapeHtml(fixEncoding(expr.word))}</span>`;
            if (expr.meaning) {
                html += `<span class="study-expression-meaning">${escapeHtml(fixEncoding(expr.meaning))}</span>`;
            }
            if (expr.example) {
                html += `<span class="study-expression-example">${escapeHtml(fixEncoding(expr.example))}</span>`;
            }
            html += `</div>`;
        }

        item.innerHTML = html;

        // Add click handler
        if (onClick) {
            const originalIndex = expressions.findIndex(e => e === expr);
            item.addEventListener('click', () => onClick(expr, originalIndex));
        }

        // Add hover handlers for study mode level popup
        if (mode === 'study' && expr.level) {
            setupLevelHoverPopup(item, expr.level);
        }

        container.appendChild(item);
    });
}

/**
 * Setup level hover popup for study mode expressions
 */
function setupLevelHoverPopup(element, level) {
    let globalPopup = document.getElementById('globalLevelPopup');
    if (!globalPopup) {
        globalPopup = document.createElement('div');
        globalPopup.id = 'globalLevelPopup';
        globalPopup.className = 'level-popup-global';
        document.body.appendChild(globalPopup);
    }

    element.addEventListener('mouseenter', () => {
        globalPopup.textContent = level;
        const rect = element.getBoundingClientRect();
        const top = rect.top + (rect.height / 2);
        const left = rect.left;
        globalPopup.style.top = `${top}px`;
        globalPopup.style.left = `${left}px`;
        globalPopup.classList.add('show');
    });

    element.addEventListener('mouseleave', () => {
        globalPopup.classList.remove('show');
    });
}


