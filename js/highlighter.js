/**
 * LinguaContext Pro - Highlighting & Text Selection Engine
 * Handles user text selection, multi-color highlighting, inline color editing,
 * auto-keyword extraction, and Dual Modes (Selection Mode vs Brush Pen Mode).
 */
class TextHighlighter {
    constructor(options = {}) {
        this.container = options.container || null;
        this.onHighlightsChange = options.onHighlightsChange || null;
        this.currentColor = options.defaultColor || 'rgba(253, 224, 71, 0.65)'; // Vivid translucent yellow
        this.mode = 'select'; // 'select' (Mouse selection + popup) vs 'brush' (Instant Pen Highlight)
        this.highlights = new Map(); // id -> { id, text, color, paragraphIdx }
        this.nextId = 1;

        this.colorPalette = [
            { id: 'yellow', hex: 'rgba(253, 224, 71, 0.65)', textHex: '#713f12', label: 'Vàng' },
            { id: 'green', hex: 'rgba(74, 222, 128, 0.65)', textHex: '#14532d', label: 'Xanh lá' },
            { id: 'blue', hex: 'rgba(56, 189, 248, 0.65)', textHex: '#0c4a6e', label: 'Xanh dương' },
            { id: 'purple', hex: 'rgba(192, 132, 252, 0.65)', textHex: '#581c87', label: 'Tím' },
            { id: 'pink', hex: 'rgba(251, 113, 133, 0.65)', textHex: '#881337', label: 'Hồng' }
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
                        const transColor = this._getTranslucentColor(this.currentColor);
                        mark.style.backgroundImage = `linear-gradient(180deg, transparent 52%, ${transColor} 52%)`;
                        mark.style.backgroundColor = 'transparent';
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
        const addedAt = Date.now();
        const mark = document.createElement('mark');
        mark.className = 'highlight-mark';
        mark.dataset.highlightId = markId;
        mark.dataset.color = colorHex;
        mark.dataset.text = text;
        mark.dataset.addedAt = String(addedAt);
        const transColor = this._getTranslucentColor(colorHex);
        mark.style.backgroundColor = transColor;
        mark.style.backgroundImage = 'none';
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
            addedAt: addedAt,
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

    /**
     * Returns highlights added strictly after the given timestamp (ms), ordered
     * newest-first (most recently added at the top). Used by the vocabulary table
     * to bubble freshly painted terms up to the top of the summary list.
     * Falls back to current timestamp for older highlights that lack addedAt.
     */
    getHighlightsAddedAfter(cutoff = 0, items = null) {
        const all = items || this.getAllHighlightedItems();
        return all
            .filter(h => (h.addedAt || 0) > cutoff)
            .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
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
                            textHex: color.textHex,
                            addedAt: Date.now()
                        });
                        return `<mark class="highlight-mark" data-highlight-id="${markId}" data-color="${color.hex}" data-text="${this._escapeHTMLAttr(match)}" style="background-color: ${this._getTranslucentColor(color.hex)};">${match}</mark>`;
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
            } catch (e) { }
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
            } catch (e) { }
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
            'collocation': '#fef08a',
            'phrasal_verb': '#bbf7d0',
            'adv_combo': '#bae6fd',
            'idiom': '#e9d5ff',
            'grammar': '#e9d5ff',
            'vocabulary': '#fecdd3',
            // Vietnamese labels (from AI translation API responses)
            'Cụm từ kết hợp (Collocation)': '#fef08a',
            'Cụm động từ (Phrasal Verb)': '#bbf7d0',
            'Trạng từ + Động từ (Adv+Verb)': '#bae6fd',
            'Trạng từ + Tính từ (Adv+Adj)': '#bae6fd',
            'Trạng từ + Danh từ (Adv+Noun)': '#bae6fd',
            'Thành ngữ (Idiom)': '#e9d5ff',
            'Cấu trúc ngữ pháp (Structure)': '#e9d5ff',
            'Giới từ/Liên từ (Prep/Conj)': '#e9d5ff',
            'Danh từ (Noun)': '#fecdd3',
            'Động từ (Verb)': '#fecdd3',
            'Tính từ (Adj)': '#fecdd3',
            'Trạng từ (Adv)': '#fecdd3',
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
                            textHex: paletteObj.textHex,
                            addedAt: Date.now()
                        });
                        const transColor = this._getTranslucentColor(colorHex);
                        return `<mark class="highlight-mark" data-highlight-id="${markId}" data-color="${colorHex}" data-text="${this._escapeHTMLAttr(match)}" style="background-color: ${transColor};">${match}</mark>`;
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

    _getTranslucentColor(hex) {
        // Single source of truth for highlight colour. Every mark — AI-
        // detected, brush-painted, user-verified — flows through here so
        // they all share a high-visibility neon alpha (0.85) that pops
        // brightly on both light and dark backgrounds.
        const ALPHA = 0.85;
        if (!hex || hex === 'transparent') return `rgba(250, 204, 21, ${ALPHA})`;
        const h = String(hex).toLowerCase().trim();
        // Already rgba()/rgb()
        if (h.startsWith('rgba') || h.startsWith('rgb')) {
            return h.replace(/rgba?\(([^)]+)\)/, (m, contents) => {
                const parts = contents.split(',').map(s => s.trim());
                if (parts.length >= 3) {
                    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${ALPHA})`;
                }
                return `rgba(250, 204, 21, ${ALPHA})`;
            });
        }
        // hex / named → rgb → rgba
        let cleanHex = h.replace('#', '');
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(c => c + c).join('');
        }
        if (!/^[0-9a-f]{6}$/.test(cleanHex)) return `rgba(250, 204, 21, ${ALPHA})`;
        const r = parseInt(cleanHex.slice(0, 2), 16);
        const g = parseInt(cleanHex.slice(2, 4), 16);
        const b = parseInt(cleanHex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${ALPHA})`;
    }

    /**
     * Fires the onHighlightsChange callback with the current highlight list.
     * This is called after every highlight mutation (create/remove/recolor/clear).
     * It was previously referenced in 7 places but never defined — which threw
     * "this._notifyChange is not a function" right after a highlight was inserted,
     * aborting the very next line (e.g. getAllHighlightedItems() in handleTranslate),
     * so the English side and the Vietnamese side ended up using different term lists.
     * Wrapped in try/catch so a consumer error can never break highlighting itself.
     */
    _notifyChange() {
        if (typeof this.onHighlightsChange !== 'function') return;
        try {
            this.onHighlightsChange(this.getAllHighlightedItems());
        } catch (err) {
            console.warn('onHighlightsChange callback failed:', err);
        }
    }

    /**
     * Tag every <mark> in the container with `data-occ` = occurrence index among marks that
     * share the same normalized text. Used by the "Dò từ khớp" match-tracking mode to pair
     * EN<->VN marks 1-to-1 (occurrence #N on the English side lights up occurrence #N on the
     * Vietnamese side, instead of lighting up every occurrence of the same word at once).
     * Called by app.js after every rendering pass that touches highlights.
     */
    assignOccurrenceIndices() {
        if (!this.container) return;
        const norm = (s) => (s || '').toString().toLowerCase().trim()
            .replace(/[\u00A0\u2000-\u200B]/g, ' ').replace(/\s+/g, ' ').normalize('NFC');
        const counts = new Map();
        const marks = Array.from(this.container.querySelectorAll('mark.highlight-mark'));
        marks.forEach(mark => {
            // Use data-en first (set by app.js on VN marks), fall back to data-text (set by
            // applyHighlightToCurrentSelection / highlightCustomTerms on EN marks).
            const key = norm(mark.getAttribute('data-en') || mark.getAttribute('data-text') || mark.textContent);
            if (!key) return;
            const idx = counts.get(key) || 0;
            counts.set(key, idx + 1);
            mark.setAttribute('data-occ', String(idx));
        });
    }
}

window.TextHighlighter = TextHighlighter;
