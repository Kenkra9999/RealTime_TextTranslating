/**
 * LinguaContext Pro - Highlighting & Text Selection Engine
 * Handles user text selection, multi-color highlighting, inline color editing,
 * auto-keyword extraction, and Dual Modes (Selection Mode vs Brush Pen Mode).
 */
class TextHighlighter {
    constructor(options = {}) {
        this.container = options.container || null;
        this.onHighlightsChange = options.onHighlightsChange || null;
        this.currentColor = options.defaultColor || '#fff3a8'; // Default soft pastel yellow
        this.mode = 'select'; // 'select' (Mouse selection + popup) vs 'brush' (Instant Pen Highlight)
        this.highlights = new Map(); // id -> { id, text, color, paragraphIdx }
        this.nextId = 1;

        this.colorPalette = [
            { id: 'yellow', hex: '#fef08a', textHex: '#854d0e', label: 'Vàng' },
            { id: 'green',  hex: '#bbf7d0', textHex: '#166534', label: 'Xanh lá' },
            { id: 'blue',   hex: '#bae6fd', textHex: '#075985', label: 'Xanh dương' },
            { id: 'purple', hex: '#e9d5ff', textHex: '#6b21a8', label: 'Tím' },
            { id: 'pink',   hex: '#fecdd3', textHex: '#9f1239', label: 'Hồng' }
        ];

        this._initTooltip();
    }

    setContainer(containerElement) {
        this.container = containerElement;
        this._bindContainerEvents();
    }

    setCurrentColor(colorHex) {
        this.currentColor = colorHex;
    }

    setMode(newMode) {
        this.mode = newMode; // 'select', 'brush', or 'lookup' (hover dictionary mode)
        if (this.container) {
            this.container.classList.toggle('mode-brush-active', this.mode === 'brush');
            this.container.classList.toggle('mode-lookup-active', this.mode === 'lookup');
        }
        this.hideTooltip();
    }

    _initTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'highlight-selection-tooltip glass-card';
        this.tooltip.style.display = 'none';

        let colorButtonsHTML = this.colorPalette.map(c => `
            <button class="color-btn" data-color="${c.hex}" title="${c.label}" style="background-color: ${c.hex}; border-color: ${c.textHex};">
            </button>
        `).join('');

        this.tooltip.innerHTML = `
            <div class="tooltip-palette">
                ${colorButtonsHTML}
            </div>
            <div class="tooltip-divider"></div>
            <button class="tooltip-act-btn highlight-apply-btn" title="Tô màu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Tô màu
            </button>
            <button class="tooltip-act-btn highlight-remove-btn" title="Xóa màu" style="display: none;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Xóa
            </button>
        `;

        document.body.appendChild(this.tooltip);

        // Bind events inside tooltip
        this.tooltip.addEventListener('click', (e) => {
            const colorBtn = e.target.closest('.color-btn');
            if (colorBtn) {
                const hex = colorBtn.dataset.color;
                this.setCurrentColor(hex);
                this.applyHighlightToCurrentSelection(hex);
                this.hideTooltip();
                return;
            }

            const applyBtn = e.target.closest('.highlight-apply-btn');
            if (applyBtn) {
                this.applyHighlightToCurrentSelection(this.currentColor);
                this.hideTooltip();
                return;
            }

            const removeBtn = e.target.closest('.highlight-remove-btn');
            if (removeBtn) {
                this.removeHighlightFromCurrentSelection();
                this.hideTooltip();
                return;
            }
        });
    }

    _bindContainerEvents() {
        if (!this.container) return;

        // Selection event
        this.container.addEventListener('mouseup', (e) => this._handleSelectionChange(e));
        this.container.addEventListener('keyup', (e) => this._handleSelectionChange(e));

        // Click on existing mark -> 2nd click removes highlight!
        this.container.addEventListener('click', (e) => {
            if (this.mode === 'lookup') return; // Lookup mode: clicks/hovers are handled by the dictionary popup, never remove highlights
            const mark = e.target.closest('mark.highlight-mark');
            if (mark) {
                e.stopPropagation();
                if (this.mode === 'brush') {
                    const currentColorHex = (this.currentColor || '').toLowerCase();
                    const markColorHex = (mark.dataset.color || '').toLowerCase();

                    // If clicking with same color -> TOGGLE OFF (remove highlight)!
                    if (markColorHex === currentColorHex) {
                        this.removeMark(mark);
                    } else {
                        // If different color -> update to new color
                        mark.style.backgroundColor = this.currentColor;
                        mark.dataset.color = this.currentColor;
                        const markId = mark.dataset.highlightId;
                        if (this.highlights.has(markId)) {
                            const item = this.highlights.get(markId);
                            item.color = this.currentColor;
                            this.highlights.set(markId, item);
                            this._notifyChange();
                        }
                    }
                } else {
                    // In Select mode: 2nd click on mark removes/un-highlights it!
                    this.removeMark(mark);
                }
            }
        });
    }

    _handleSelectionChange(e) {
        if (this.mode === 'lookup') return; // Lookup mode has its own hover-driven UI, no selection tooltip
        setTimeout(() => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) {
                if (!e.target.closest('.highlight-selection-tooltip') && !e.target.closest('mark.highlight-mark')) {
                    this.hideTooltip();
                }
                return;
            }

            const text = selection.toString().trim();
            if (text.length < 1) {
                this.hideTooltip();
                return;
            }

            const range = selection.getRangeAt(0);
            if (this.container && this.container.contains(range.commonAncestorContainer)) {
                if (this.mode === 'brush') {
                    // BRUSH PEN MODE: Instantly highlight selected text with currentColor!
                    this.applyHighlightToCurrentSelection(this.currentColor);
                    this.hideTooltip();
                } else {
                    // SELECT MODE: Show floating tooltip palette
                    this._positionTooltipNearRange(range);
                    this.tooltip.querySelector('.highlight-remove-btn').style.display = 'none';
                }
            } else {
                this.hideTooltip();
            }
        }, 10);
    }

    _positionTooltipNearRange(range) {
        const rect = range.getBoundingClientRect();
        this.tooltip.style.display = 'flex';
        const tooltipRect = this.tooltip.getBoundingClientRect();

        let top = rect.top + window.scrollY - tooltipRect.height - 10;
        let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);

        if (top < 10) top = rect.bottom + window.scrollY + 10;
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
            left = window.innerWidth - tooltipRect.width - 10;
        }

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }

    _showTooltipForMark(markElement) {
        const rect = markElement.getBoundingClientRect();
        this.tooltip.style.display = 'flex';
        const tooltipRect = this.tooltip.getBoundingClientRect();

        let top = rect.top + window.scrollY - tooltipRect.height - 10;
        let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
        this.tooltip.querySelector('.highlight-remove-btn').style.display = 'inline-flex';
        this.activeMark = markElement;
    }

    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
        this.activeMark = null;
    }

    applyHighlightToCurrentSelection(colorHex) {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            if (this.activeMark) {
                const markId = this.activeMark.dataset.highlightId;
                this.activeMark.style.backgroundColor = colorHex;
                this.activeMark.dataset.color = colorHex;
                if (this.highlights.has(markId)) {
                    const item = this.highlights.get(markId);
                    item.color = colorHex;
                    this.highlights.set(markId, item);
                    this._notifyChange();
                }
            }
            return;
        }

        let range = selection.getRangeAt(0);
        this._expandRangeToWordBoundaries(range);

        const text = range.toString().trim();
        if (!text) return;

        const markId = `hl-${Date.now()}-${this.nextId++}`;
        const mark = document.createElement('mark');
        mark.className = 'highlight-mark';
        mark.dataset.highlightId = markId;
        mark.dataset.color = colorHex;
        mark.dataset.text = text;
        mark.style.backgroundColor = colorHex;
        mark.title = `Từ/Cụm từ đã tô màu: "${text}"`;

        try {
            range.surroundContents(mark);
        } catch (err) {
            const fragment = range.extractContents();
            mark.appendChild(fragment);
            range.insertNode(mark);
        }

        selection.removeAllRanges();

        const paletteObj = this.colorPalette.find(c => c.hex.toLowerCase() === colorHex.toLowerCase()) || this.colorPalette[0];
        this.highlights.set(markId, {
            id: markId,
            text: text,
            color: colorHex,
            textHex: paletteObj.textHex,
            element: mark
        });

        this._notifyChange();
    }

    /**
     * Remove / Un-highlight a specific mark element (Toggle Off)
     */
    removeMark(markElement) {
        if (!markElement) return;
        const markId = markElement.dataset.highlightId;
        const parent = markElement.parentNode;
        if (parent) {
            while (markElement.firstChild) {
                parent.insertBefore(markElement.firstChild, markElement);
            }
            parent.removeChild(markElement);
        }
        if (markId) {
            this.highlights.delete(markId);
        }
        this.hideTooltip();
        this._notifyChange();
    }

    removeHighlightFromCurrentSelection() {
        if (this.activeMark) {
            this.removeMark(this.activeMark);
        }
    }

    clearAllHighlights() {
        if (!this.container) return;
        const marks = Array.from(this.container.querySelectorAll('mark.highlight-mark'));
        marks.forEach(mark => {
            const parent = mark.parentNode;
            while (mark.firstChild) {
                parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
        });
        this.highlights.clear();
        this._notifyChange();
    }

    /**
     * Removes highlight entries whose <mark> element is no longer present in the
     * current container's DOM (e.g. after switching to a brand-new text, which
     * rebuilds readingCanvas from scratch). Without this, stale highlights from a
     * previously viewed text would keep leaking into the vocabulary table of the
     * text currently on screen. Returns a Map of id -> DOM order index for the
     * surviving marks, so callers can sort results to match top-to-bottom reading order.
     */
    _pruneOrphanedHighlights() {
        if (!this.container) return new Map();
        const domOrder = new Map();
        const marksInDom = Array.from(this.container.querySelectorAll('mark.highlight-mark[data-highlight-id]'));

        marksInDom.forEach((mark) => {
            // Skip marks nested inside another highlight mark. These are artifacts of
            // sub-word terms matching inside a longer phrase that was already highlighted
            // (e.g. "climate" inside a "climate change" mark). They look identical on screen
            // (same colour) but would otherwise inflate the vocabulary count with duplicates.
            const nested = mark.parentElement && mark.parentElement.closest('mark.highlight-mark');
            if (nested) {
                this._unwrapMark(mark);
                this.highlights.delete(mark.dataset.highlightId);
            }
        });

        // Re-query after unwrapping so DOM order indices reflect the surviving outer marks only.
        const survivingMarks = Array.from(this.container.querySelectorAll('mark.highlight-mark[data-highlight-id]'))
            .filter(mark => !(mark.parentElement && mark.parentElement.closest('mark.highlight-mark')));
        survivingMarks.forEach((mark, idx) => domOrder.set(mark.dataset.highlightId, idx));

        for (const id of Array.from(this.highlights.keys())) {
            if (!domOrder.has(id)) {
                this.highlights.delete(id);
            }
        }
        return domOrder;
    }

    /**
     * Replaces a <mark> element with its own child contents (text/inner nodes),
     * effectively removing the highlight wrapper while preserving the text. Used to
     * clean up nested highlight marks without disturbing the surrounding content.
     */
    _unwrapMark(mark) {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
    }

    /**
     * Returns all currently-highlighted items, limited strictly to marks that exist
     * in the container's DOM right now, and ordered top-to-bottom as they appear in
     * the text (not by creation order), so the vocabulary table always matches
     * exactly what is visibly highlighted, in reading order.
     */
    getAllHighlightedItems() {
        const domOrder = this._pruneOrphanedHighlights();
        return Array.from(this.highlights.values()).sort((a, b) => {
            const posA = domOrder.has(a.id) ? domOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
            const posB = domOrder.has(b.id) ? domOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
            return posA - posB;
        });
    }

    autoHighlightKeyTerms(container) {
        if (!container) return;
        const text = container.innerText;
        if (!text) return;

        const targetPhrases = [
            "paradigm shift", "state-of-the-art", "cutting-edge", "game-changer",
            "resilient", "resilience", "profound", "ubiquitous", "meticulous",
            "scrutinize", "scrutiny", "pivotal", "synergy", "catalyst", "eloquent",
            "pragmatic", "diligence", "ephemeral", "unprecedented", "exponential",
            "comprehensive", "sustainable", "sustainability", "implementation",
            "foster", "empirical", "ambiguity", "breakthrough", "perspective",
            "collaborate", "collaboration", "leverage", "optimize", "benchmark"
        ];

        let count = 0;
        let colorIdx = 0;

        targetPhrases.forEach(term => {
            const regex = new RegExp(`\\b(${this._escapeRegExp(term)})\\b`, 'gi');
            const paragraphs = container.querySelectorAll('p, div.paragraph-block');
            
            paragraphs.forEach(p => {
                if (p.querySelector('mark')) return;
                if (count >= 50) return;
                let html = p.innerHTML;
                const color = this.colorPalette[colorIdx % this.colorPalette.length];
                let matched = false;

                const segments = html.split(/(<[^>]+>)/g);
                const newSegments = segments.map(segment => {
                    if (segment.startsWith('<')) return segment;
                    return segment.replace(regex, (match) => {
                        const markId = `hl-${Date.now()}-${this.nextId++}`;
                        count++;
                        matched = true;
                        this.highlights.set(markId, {
                            id: markId,
                            text: match,
                            color: color.hex,
                            textHex: color.textHex
                        });
                        return `<mark class="highlight-mark" data-highlight-id="${markId}" data-color="${color.hex}" data-text="${this._escapeHTMLAttr(match)}" style="background-color: ${color.hex};">${match}</mark>`;
                    });
                });

                if (matched) {
                    p.innerHTML = newSegments.join('');
                    colorIdx++;
                }
            });
        });

        this._notifyChange();
        return count;
    }

    /**
     * Smart Word Boundary Expansion
     * Automatically expands selection range to encompass full words instead of partial sub-strings
     */
    _expandRangeToWordBoundaries(range) {
        if (!range) return range;

        const isWordChar = (char) => char && /[\w'-]/i.test(char);

        // Expand start offset to beginning of word
        let startNode = range.startContainer;
        let startOffset = range.startOffset;

        if (startNode.nodeType === Node.TEXT_NODE) {
            const text = startNode.nodeValue;
            while (startOffset > 0 && isWordChar(text.charAt(startOffset - 1))) {
                startOffset--;
            }
            try {
                range.setStart(startNode, startOffset);
            } catch (e) {}
        }

        // Expand end offset to end of word
        let endNode = range.endContainer;
        let endOffset = range.endOffset;

        if (endNode.nodeType === Node.TEXT_NODE) {
            const text = endNode.nodeValue;
            while (endOffset < text.length && isWordChar(text.charAt(endOffset))) {
                endOffset++;
            }
            try {
                range.setEnd(endNode, endOffset);
            } catch (e) {}
        }

        return range;
    }

    /**
     * Highlight custom list of terms returned by AI Auto-Scan.
     * Accepts either plain strings or {text, category} objects.
     * Uses semantic color mapping by category — NOT random/round-robin colors.
     *
     * Category → color:
     *   collocation  → Yellow  (#fff3a8)  Adj+N, N+N, V+N, hyphenated compounds
     *   phrasal_verb → Green   (#c4ecd6)  Phrasal verbs (break down, carry out)
     *   adv_combo    → Blue    (#c8e6f5)  Adv+Verb / Adv+Adj combos
     *   idiom        → Purple  (#ead8f5)  Idioms, fixed phrases, grammar structures
     *   vocabulary   → Pink    (#f5d4e5)  Important standalone words
     */
    highlightCustomTerms(terms = []) {
        if (!this.container || !terms || terms.length === 0) return 0;
        let count = 0;

        const categoryColorMap = {
            // Short keys (offline engine)
            'collocation':  '#fef08a',
            'phrasal_verb': '#bbf7d0',
            'adv_combo':    '#bae6fd',
            'idiom':        '#e9d5ff',
            'grammar':      '#e9d5ff',
            'vocabulary':   '#fecdd3',
            // Vietnamese labels (from AI translation API responses)
            'Cụm từ kết hợp (Collocation)':          '#fef08a',
            'Cụm động từ (Phrasal Verb)':             '#bbf7d0',
            'Trạng từ + Động từ (Adv+Verb)':          '#bae6fd',
            'Trạng từ + Tính từ (Adv+Adj)':           '#bae6fd',
            'Trạng từ + Danh từ (Adv+Noun)':          '#bae6fd',
            'Thành ngữ (Idiom)':                      '#e9d5ff',
            'Cấu trúc ngữ pháp (Structure)':          '#e9d5ff',
            'Giới từ/Liên từ (Prep/Conj)':            '#e9d5ff',
            'Danh từ (Noun)':                         '#fecdd3',
            'Động từ (Verb)':                         '#fecdd3',
            'Tính từ (Adj)':                          '#fecdd3',
            'Trạng từ (Adv)':                         '#fecdd3',
        };
        const defaultColor = '#fef08a';

        // Normalise to [{text, category}]; infer category for bare strings
        const normalized = terms
            .map(t => {
                if (typeof t === 'string') {
                    const isPhrase = /[\s-]/.test(t.trim());
                    return { text: t.trim(), category: isPhrase ? 'collocation' : 'vocabulary' };
                }
                const text = (t.term || t.text || '').trim();
                return { text, category: t.category || 'vocabulary' };
            })
            .filter(t => t.text.length >= 2);

        // Sort longest-first so multi-word phrases get matched before sub-words
        const sorted = [...normalized].sort((a, b) => b.text.length - a.text.length);

        sorted.forEach(({ text: term, category }) => {
            const colorHex = categoryColorMap[category] || defaultColor;
            const paletteObj = this.colorPalette.find(c => c.hex === colorHex) || this.colorPalette[0];
            const regex = new RegExp(`\\b(${this._escapeRegExp(term)})\\b`, 'gi');
            const paragraphs = this.container.querySelectorAll('p, div.paragraph-block');

            paragraphs.forEach(p => {
                let html = p.innerHTML;
                let matched = false;

                // Split on HTML tags so we never modify tag attributes.
                // Track mark nesting depth so sub-word terms don't create nested marks
                // inside a longer phrase that was already highlighted (e.g. after
                // "climate change" is marked, skip re-matching "climate" inside it).
                const segments = html.split(/(<[^>]+>)/g);
                let insideMark = 0;
                const newSegments = segments.map(segment => {
                    if (segment.startsWith('<')) {
                        if (/^<mark\b/i.test(segment)) insideMark++;
                        else if (/^<\/mark>/i.test(segment)) insideMark = Math.max(0, insideMark - 1);
                        return segment;
                    }
                    if (insideMark > 0) return segment;
                    return segment.replace(regex, (match) => {
                        const markId = `hl-${Date.now()}-${this.nextId++}`;
                        count++;
                        matched = true;
                        this.highlights.set(markId, {
                            id: markId,
                            text: match,
                            color: colorHex,
                            textHex: paletteObj.textHex
                        });
                        return `<mark class="highlight-mark" data-highlight-id="${markId}" data-color="${colorHex}" data-text="${this._escapeHTMLAttr(match)}" style="background-color: ${colorHex};">${match}</mark>`;
                    });
                });

                if (matched) {
                    p.innerHTML = newSegments.join('');
                }
            });
        });

        this._notifyChange();
        return count;
    }

    _escapeHTMLAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    _escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    _notifyChange() {
        if (typeof this.onHighlightsChange === 'function') {
            this.onHighlightsChange(this.getAllHighlightedItems());
        }
    }
}

window.TextHighlighter = TextHighlighter;
