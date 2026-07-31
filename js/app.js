/**
 * LinguaContext Pro - Main Application Controller
 * Orchestrates split pane resizing, text editing, dual highlighting modes, font scaling,
 * AI Auto-Scan (OpenAI ChatGPT & Google Gemini), translation, vocabulary/structure table,
 * speech synthesis, and PDF exporting.
 */
class LinguaApp {
    constructor() {
        this.highlighter = new TextHighlighter({
            onHighlightsChange: (items) => this._onHighlightsLiveUpdate(items)
        });
        this.translator = new ContextTranslator();
        this.pdfExporter = new PDFExporter();

        this.currentMode = 'edit'; // 'edit' or 'read'
        this.currentVocabData = [];
        // Each DISTINCT English text (by content) becomes its own collapsible entry:
        // { id, sourceText, preview, highlights, vocabList, expanded }
        // Re-scanning/re-translating the SAME text (AI Scan then Translate, etc.) merges
        // into the same entry rather than creating a duplicate "Văn bản N".
        this.vocabSessions = [];
        this.sessionCounter = 0;
        // Tracks which session's highlights should live-update as the user paints more
        // highlights on the reading canvas after that text was already translated/scanned.
        this.activeSessionId = null;
        this.isTranslating = false;
        this.fontSize = 16; // Default font size in px
        this.fontWeight = parseInt(localStorage.getItem('lingua_font_weight') || '600', 10);
        this.fontFamily = localStorage.getItem('lingua_font_family') || "'Lora', 'Merriweather', Georgia, serif";

        // Dictionary Lookup Mode state
        this.lookupModeActive = false;
        this._lookupHoverWord = null; // last hovered term, to avoid redundant re-fetches
        this._lookupRequestSeq = 0;   // guards against stale async responses overwriting a newer hover
        this._lookupPinned = false;   // true after clicking a word: popup stays put until user clicks elsewhere

        this._bindElements();
        this._bindEvents();
        this._initResizer();
        this._initSyncedScroll();
        this._initTypographyControls();
        this._initTheme();
        this._initLookupMode();
        this._initVocabResizer();
        this._loadSavedSettings();

        // Initial debug snapshot — see heights/scrollability in DevTools console.
        requestAnimationFrame(() => {
            const sec = this.els.vocabSection;
            const acc = this.els.vocabAccordionContainer;
            if (sec && acc) {
                console.log('[VocabLayout@init]', {
                    sectionHeight: sec.getBoundingClientRect().height,
                    accordionHeight: acc.getBoundingClientRect().height,
                    accordionScrollHeight: acc.scrollHeight,
                    accordionOverflowY: getComputedStyle(acc).overflowY,
                    accordionMaxHeight: getComputedStyle(acc).maxHeight
                });
            }
        });
        window.addEventListener('resize', () => {
            const sec = this.els.vocabSection;
            const acc = this.els.vocabAccordionContainer;
            if (sec && acc) {
                console.log('[VocabLayout@resize]', {
                    sectionHeight: sec.getBoundingClientRect().height,
                    accordionHeight: acc.getBoundingClientRect().height,
                    accordionScrollHeight: acc.scrollHeight
                });
            }
        });
    }

    /**
     * Theme switcher. Cycles through four themes in order:
     *   classic → dark → cosmos → sepia → classic ...
     * The first theme is the new default "Vintage Classic" (warm cream, vintage vibe).
     * The data-theme attribute is applied to <html> before first paint via the
     * anti-flash inline script in <head>, so there's no flash of wrong theme.
     */
    _initTheme() {
        const THEMES = [
            { id: 'classic',  icon: '☀️', label: 'Sáng' },
            { id: 'dark',     icon: '🌙', label: 'Tối' },
            { id: 'cosmos',   icon: '🌌', label: 'Vũ trụ' },
            { id: 'sepia',    icon: '📜', label: 'Sepia' },
            { id: 'midnight', icon: '🌑', label: 'Đêm tối' }
        ];
        const applyToggleUI = (themeId) => {
            const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
            if (this.els.themeIcon) this.els.themeIcon.textContent = theme.icon;
            if (this.els.themeLabel) this.els.themeLabel.textContent = theme.label;
            if (this.els.btnThemeToggle) {
                this.els.btnThemeToggle.setAttribute('aria-pressed', String(theme.id !== 'classic'));
                this.els.btnThemeToggle.setAttribute('title', `Đổi theme: hiện tại "${theme.label}" — bấm để chuyển sang theme kế tiếp`);
            }
        };

        const currentAttr = document.documentElement.getAttribute('data-theme');
        const validIds = THEMES.map(t => t.id);
        const currentTheme = validIds.includes(currentAttr) ? currentAttr : 'classic';
        document.documentElement.setAttribute('data-theme', currentTheme);
        applyToggleUI(currentTheme);

        if (this.els.btnThemeToggle) {
            this.els.btnThemeToggle.addEventListener('click', () => {
                // Re-read from the DOM each click so cycling works across multiple toggles
                const liveTheme = document.documentElement.getAttribute('data-theme');
                const idx = THEMES.findIndex(t => t.id === liveTheme);
                const safeIdx = idx === -1 ? 0 : idx;
                const next = THEMES[(safeIdx + 1) % THEMES.length];
                document.documentElement.setAttribute('data-theme', next.id);
                localStorage.setItem('lingua_theme', next.id);
                applyToggleUI(next.id);
                // Hint to any listener that the theme changed (e.g. for re-rendering decorations)
                document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next.id } }));
            });
        }
    }

    /**
     * Dictionary Lookup Mode ("Tra từ"): while active, hovering over any word inside
     * the reading canvas (English source) or translation canvas (Vietnamese side)
     * instantly shows a floating popup with IPA, part-of-speech, context-aware
     * Vietnamese meaning, an example sentence + translation, and a speaker button
     * to hear the pronunciation. Works on ANY word, not just pre-highlighted ones.
     */
    _initLookupMode() {
        // Floating popup element, created once and repositioned/refilled on hover
        this.lookupPopup = document.createElement('div');
        this.lookupPopup.className = 'lookup-popup glass-card';
        this.lookupPopup.style.display = 'none';
        this.lookupPopup.innerHTML = `
            <div class="lookup-popup-header">
                <span class="lookup-popup-word" id="lookupPopupWord">—</span>
                <button class="lookup-popup-audio-btn" id="lookupPopupAudioBtn" title="Nghe phát âm">🔊</button>
            </div>
            <div class="lookup-popup-row">
                <span class="lookup-popup-ipa" id="lookupPopupIpa">/.../</span>
                <span class="lookup-popup-pos" id="lookupPopupPos">—</span>
            </div>
            <div class="lookup-popup-meaning" id="lookupPopupMeaning">
                <span class="lookup-popup-spinner"></span> Đang tra cứu...
            </div>
            <div class="lookup-popup-example-block" id="lookupPopupExampleBlock" style="display:none;">
                <div class="lookup-popup-example-label">💡 Ví dụ minh hoạ</div>
                <div class="lookup-popup-example" id="lookupPopupExample">"..."</div>
                <div class="lookup-popup-example-vi" id="lookupPopupExampleVi">→ ...</div>
            </div>
            <div class="lookup-popup-structures" id="lookupPopupStructures" style="display:none;">
                <div class="lookup-popup-structures-label">📚 Cấu trúc / cụm từ phổ biến</div>
                <div class="lookup-popup-structures-list" id="lookupPopupStructuresList"></div>
            </div>
        `;
        document.body.appendChild(this.lookupPopup);

        this.lookupPopup.querySelector('#lookupPopupAudioBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._lookupHoverWord) this.speak(this._lookupHoverWord);
        });

        // Keep popup open while the mouse is over it (e.g. to click the audio button)
        this.lookupPopup.addEventListener('mouseenter', () => { this._lookupPopupHovered = true; });
        this.lookupPopup.addEventListener('mouseleave', () => {
            this._lookupPopupHovered = false;
            this._scheduleHideLookupPopup();
        });
        // Clicking anywhere inside the popup itself must never count as "clicking elsewhere"
        this.lookupPopup.addEventListener('click', (e) => e.stopPropagation());

        const targets = [this.els.readingCanvas, this.els.translationCanvas].filter(Boolean);
        targets.forEach(target => {
            target.addEventListener('mousemove', (e) => this._handleLookupHover(e, target));
            target.addEventListener('mouseleave', () => this._scheduleHideLookupPopup());
            // Click a word to PIN the popup: it stays open (ignores mouse-leave) until
            // the user clicks somewhere else (another word re-pins on the new word;
            // clicking empty space / outside closes it).
            target.addEventListener('click', (e) => {
                if (!this.lookupModeActive) return;
                const hit = this._getWordAtPoint(e.clientX, e.clientY);
                if (hit) {
                    e.stopPropagation();
                    this._lookupPinned = true;
                    clearTimeout(this._lookupHideTimer);
                    const token = hit.word.toLowerCase() + '@' + Math.round(hit.rect.left) + ',' + Math.round(hit.rect.top);
                    this._lastHoverToken = token;
                    this._showLookupFor(hit.word, hit.sentence, hit.rect);
                } else {
                    this._lookupPinned = false;
                    this._hideLookupPopup();
                }
            });
        });

        // Clicking anywhere outside the popup and outside the lookup targets closes a pinned popup
        document.addEventListener('click', () => {
            if (this._lookupPinned) {
                this._lookupPinned = false;
                this._hideLookupPopup();
            }
        });
    }

    _setLookupModeActive(active) {
        this.lookupModeActive = active;
        [this.els.readingCanvas, this.els.translationCanvas].filter(Boolean).forEach(el => {
            el.classList.toggle('lookup-mode-active', active);
        });
        if (!active) {
            this._lookupPinned = false;
            this._hideLookupPopup();
        }
    }

    _scheduleHideLookupPopup() {
        if (this._lookupPinned) return; // Pinned (clicked) popups only close via an outside click
        clearTimeout(this._lookupHideTimer);
        this._lookupHideTimer = setTimeout(() => {
            if (!this._lookupPopupHovered) this._hideLookupPopup();
        }, 180);
    }

    _hideLookupPopup() {
        if (this.lookupPopup) this.lookupPopup.style.display = 'none';
        this._lookupHoverWord = null;
        this._lastHoverToken = null;
    }

    /**
     * Extracts the word directly under the mouse pointer using caretRangeFromPoint /
     * caretPositionFromPoint (cross-browser), then expands to full word boundaries.
     * Returns { word, sentence, rect } or null if the pointer isn't over a word.
     */
    _getWordAtPoint(clientX, clientY) {
        let node, offset;
        if (document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(clientX, clientY);
            if (!range) return null;
            node = range.startContainer;
            offset = range.startOffset;
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(clientX, clientY);
            if (!pos) return null;
            node = pos.offsetNode;
            offset = pos.offset;
        } else {
            return null;
        }

        if (!node || node.nodeType !== Node.TEXT_NODE) return null;

        const text = node.nodeValue;
        const isWordChar = (ch) => ch && /[A-Za-zÀ-ỹ'-]/.test(ch);
        if (!isWordChar(text.charAt(offset)) && !isWordChar(text.charAt(offset - 1))) return null;

        let start = offset;
        // If pointer lands exactly between two words, prefer the word to the right
        while (start > 0 && isWordChar(text.charAt(start - 1))) start--;
        let end = offset;
        while (end < text.length && isWordChar(text.charAt(end))) end++;

        const word = text.slice(start, end).trim();
        if (!word || word.length < 1) return null;

        // Build a small "sentence" of surrounding context for context-aware AI lookup
        const CONTEXT_RADIUS = 200;
        const ctxStart = Math.max(0, offset - CONTEXT_RADIUS);
        const ctxEnd = Math.min(text.length, offset + CONTEXT_RADIUS);
        let sentenceCtx = text.slice(ctxStart, ctxEnd);
        // Fall back to the full paragraph text if the text node is short (common case,
        // since paragraphs are usually single text nodes here)
        const parentBlock = node.parentElement ? node.parentElement.closest('p, div.paragraph-block') : null;
        if (parentBlock && parentBlock.innerText) sentenceCtx = parentBlock.innerText;

        // Get bounding rect for the hovered word to position the popup precisely
        const wordRange = document.createRange();
        wordRange.setStart(node, start);
        wordRange.setEnd(node, end);
        const rect = wordRange.getBoundingClientRect();

        return { word, sentence: sentenceCtx, rect };
    }

    _handleLookupHover(e, containerEl) {
        if (!this.lookupModeActive || this._lookupPinned) return;
        const clientX = e.clientX;
        const clientY = e.clientY;

        if (this._hoverRafId) return;
        this._hoverRafId = requestAnimationFrame(() => {
            this._hoverRafId = null;
            const hit = this._getWordAtPoint(clientX, clientY);
            if (!hit || !containerEl.contains(e.target)) {
                this._scheduleHideLookupPopup();
                return;
            }

            clearTimeout(this._lookupHideTimer);
            const token = hit.word.toLowerCase() + '@' + Math.round(hit.rect.left) + ',' + Math.round(hit.rect.top);
            if (token === this._lastHoverToken) return;
            this._lastHoverToken = token;

            this._showLookupFor(hit.word, hit.sentence, hit.rect);
        });
    }

    /**
     * Shows the lookup popup for a given word instantly (using the offline dictionary
     * as a fast baseline), then asynchronously upgrades it with context-aware AI data
     * once available (if an API key is configured). Debounced/guarded so a fast-moving
     * mouse never causes an older lookup to clobber a newer one.
     */
    async _showLookupFor(word, sentence, rect) {
        this._lookupHoverWord = word;
        const mySeq = ++this._lookupRequestSeq;

        this._positionLookupPopup(rect);
        this.lookupPopup.style.display = 'block';

        const wordEl = document.getElementById('lookupPopupWord');
        const ipaEl = document.getElementById('lookupPopupIpa');
        const posEl = document.getElementById('lookupPopupPos');
        const meaningEl = document.getElementById('lookupPopupMeaning');
        const exampleBlockEl = document.getElementById('lookupPopupExampleBlock');
        const exampleEl = document.getElementById('lookupPopupExample');
        const exampleViEl = document.getElementById('lookupPopupExampleVi');
        const structuresWrapEl = document.getElementById('lookupPopupStructures');
        const structuresListEl = document.getElementById('lookupPopupStructuresList');

        // Instant offline baseline (dictionary or heuristic IPA estimate)
        const dict = window.dictionaryDB;
        wordEl.textContent = word;
        ipaEl.textContent = dict ? dict.getIPA(word) : '/.../';
        posEl.textContent = dict ? dict.getPOS(word) : '';
        const offlineMeaning = dict ? dict.getMeaning(word) : null;
        meaningEl.innerHTML = offlineMeaning
            ? this._escapeHTML(offlineMeaning)
            : `<span class="lookup-popup-spinner"></span> Đang tra cứu...`;
        // Hide example + structures until the AI (or fallback) returns data
        exampleBlockEl.style.display = 'none';
        exampleEl.textContent = '';
        exampleViEl.textContent = '';
        structuresWrapEl.style.display = 'none';
        structuresListEl.innerHTML = '';

        try {
            const result = await this.translator.lookupWord(word, sentence);
            if (mySeq !== this._lookupRequestSeq) return; // a newer hover superseded this request
            if (!result) return;

            wordEl.textContent = result.word || word;
            ipaEl.textContent = result.ipa || ipaEl.textContent;
            posEl.textContent = result.pos || posEl.textContent;
            meaningEl.textContent = result.meaning || 'Không tìm thấy nghĩa phù hợp';

            // Show the example sentence block only when we have a real example
            // (never the original source sentence — by design, per user request).
            if (result.example && result.example.trim() && result.example.trim().toLowerCase() !== word.toLowerCase()) {
                exampleEl.textContent = `"${result.example.trim()}"`;
                exampleViEl.textContent = result.exampleVi && result.exampleVi.trim()
                    ? `→ ${result.exampleVi.trim()}`
                    : '';
                exampleBlockEl.style.display = 'block';
            }

            // Render the 2-3 common structures, dropping any whose example
            // accidentally echoes the source sentence.
            const structures = Array.isArray(result.structures) ? result.structures : [];
            const srcLower = (sentence || '').trim().toLowerCase();
            const isEcho = (ex) => {
                if (!ex || !srcLower) return false;
                const e = ex.trim().toLowerCase();
                return e === srcLower || (e.length > 30 && srcLower.includes(e));
            };
            const filteredStructures = structures
                .filter(s => !isEcho(s && s.example))
                .slice(0, 3);
            structuresListEl.innerHTML = '';
            if (filteredStructures.length > 0) {
                filteredStructures.forEach((s) => {
                    const card = document.createElement('div');
                    card.className = 'lookup-popup-structure-item';

                    const name = document.createElement('div');
                    name.className = 'lookup-popup-structure-name';
                    name.textContent = s.name || '';

                    const note = document.createElement('div');
                    note.className = 'lookup-popup-structure-note';
                    note.textContent = s.note || '';

                    const ex = document.createElement('div');
                    ex.className = 'lookup-popup-structure-example';
                    ex.textContent = (s.example && s.example.trim()) ? `"${s.example.trim()}"` : '';

                    const exVi = document.createElement('div');
                    exVi.className = 'lookup-popup-structure-example-vi';
                    exVi.textContent = (s.exampleVi && s.exampleVi.trim()) ? `→ ${s.exampleVi.trim()}` : '';

                    card.appendChild(name);
                    if (s.note) card.appendChild(note);
                    if (ex.textContent) card.appendChild(ex);
                    if (exVi.textContent) card.appendChild(exVi);
                    structuresListEl.appendChild(card);
                });
                structuresWrapEl.style.display = 'block';
            }

            // Popup content length may have changed → reposition to stay in-viewport
            this._positionLookupPopup(rect);
        } catch (err) {
            if (mySeq !== this._lookupRequestSeq) return;
            if (!offlineMeaning) meaningEl.textContent = 'Không tra được nghĩa (kiểm tra kết nối mạng).';
        }
    }

    _positionLookupPopup(rect) {
        const popup = this.lookupPopup;
        popup.style.visibility = 'hidden';
        popup.style.display = 'block';
        const popupRect = popup.getBoundingClientRect();

        let top = rect.top + window.scrollY - popupRect.height - 10;
        let left = rect.left + window.scrollX + (rect.width / 2) - (popupRect.width / 2);

        if (top < window.scrollY + 10) top = rect.bottom + window.scrollY + 10;
        if (left < 10) left = 10;
        if (left + popupRect.width > window.innerWidth - 10) {
            left = window.innerWidth - popupRect.width - 10;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;
        popup.style.visibility = 'visible';
    }

    _bindElements() {
        this.els = {
            // Header buttons
            btnTranslate: document.getElementById('btnTranslate'),
            btnAutoHighlight: document.getElementById('btnAutoHighlight'),
            btnLoadSample: document.getElementById('btnLoadSample'),
            btnOpenSettings: document.getElementById('btnOpenSettings'),
            btnClear: document.getElementById('btnClear'),
            colorDots: document.querySelectorAll('.color-dot'),

            // Header collapse toggle
            appHeader: document.querySelector('.app-header'),
            btnToggleHeaderCollapse: document.getElementById('btnToggleHeaderCollapse'),
            btnToggleHeaderExpand: document.getElementById('btnToggleHeaderExpand'),
            vocabSection: document.getElementById('vocabSection'),
            splitContainer: document.getElementById('splitScreenContainer'),
            vocabResizer: document.getElementById('vocabResizer'),

            // Theme toggle
            btnThemeToggle: document.getElementById('btnThemeToggle'),
            themeIcon: document.getElementById('themeIcon'),
            themeLabel: document.getElementById('themeLabel'),

            // Mode Toggle Buttons
            btnModeSelect: document.getElementById('btnModeSelect'),
            btnModeBrush: document.getElementById('btnModeBrush'),
            btnModeLookup: document.getElementById('btnModeLookup'),

            // Font Scaler Buttons
            btnFontDec: document.getElementById('btnFontDec'),
            btnFontInc: document.getElementById('btnFontInc'),
            fontSizeDisplay: document.getElementById('fontSizeDisplay'),

            // Font Weight Slider & Font Family Selector
            fontWeightSlider: document.getElementById('fontWeightSlider'),
            fontWeightDisplay: document.getElementById('fontWeightDisplay'),
            fontFamilySelect: document.getElementById('fontFamilySelect'),

            // Progress bar
            progressContainer: document.getElementById('progressStatusContainer'),
            progressText: document.getElementById('progressStatusText'),
            progressPercent: document.getElementById('progressStatusPercent'),
            progressBarFill: document.getElementById('progressBarFill'),

            // Split screen & Panes
            container: document.getElementById('splitScreenContainer'),
            paneLeft: document.getElementById('paneLeft'),
            paneRight: document.getElementById('paneRight'),
            resizer: document.getElementById('paneResizer'),
            paneBodyLeft: document.getElementById('paneBodyLeft'),
            paneBodyRight: document.getElementById('paneBodyRight'),
            
            // Text controls
            inputText: document.getElementById('inputText'),
            readingCanvas: document.getElementById('readingCanvas'),
            translationCanvas: document.getElementById('translationCanvas'),
            btnToggleMode: document.getElementById('btnToggleMode'),
            wordCountBadge: document.getElementById('wordCountBadge'),
            transStatusBadge: document.getElementById('transStatusBadge'),

            // Vocab accordion (one collapsible entry per translated/scanned document)
            vocabAccordionContainer: document.getElementById('vocabAccordionContainer'),
            vocabEmptyState: document.getElementById('vocabEmptyState'),
            vocabDocCount: document.getElementById('vocabDocCount'),
            highlightCountText: document.getElementById('highlightCountText'),

            // Settings modal
            settingsModal: document.getElementById('settingsModal'),
            selectProvider: document.getElementById('selectProvider'),
            groupOpenAI: document.getElementById('groupOpenAI'),
            groupGemini: document.getElementById('groupGemini'),
            inputOpenAiApiKey: document.getElementById('inputOpenAiApiKey'),
            selectOpenAiModel: document.getElementById('selectOpenAiModel'),
            inputApiKey: document.getElementById('inputApiKey'),
            selectModel: document.getElementById('selectModel'),
            btnCloseSettings: document.getElementById('btnCloseSettings'),
            btnCancelSettings: document.getElementById('btnCancelSettings'),
            btnSaveSettings: document.getElementById('btnSaveSettings'),

            // Dedicated Scan API settings (separate from main translation API)
            chkUseSeparateScanApi: document.getElementById('chkUseSeparateScanApi'),
            groupSeparateScanApi: document.getElementById('groupSeparateScanApi'),
            selectScanProvider: document.getElementById('selectScanProvider'),
            groupScanOpenAI: document.getElementById('groupScanOpenAI'),
            groupScanGemini: document.getElementById('groupScanGemini'),
            inputScanOpenAiApiKey: document.getElementById('inputScanOpenAiApiKey'),
            selectScanOpenAiModel: document.getElementById('selectScanOpenAiModel'),
            inputScanApiKey: document.getElementById('inputScanApiKey'),
            selectScanModel: document.getElementById('selectScanModel'),
        };

        this.highlighter.setContainer(this.els.readingCanvas);
    }

    _bindEvents() {
        // Toggle input vs reading canvas mode
        this.els.btnToggleMode.addEventListener('click', () => this.toggleMode());

        // Paste text button
        const btnPaste = document.getElementById('btnPasteText');
        if (btnPaste) {
            btnPaste.addEventListener('click', async () => {
                this.switchToEditMode();
                try {
                    const text = await navigator.clipboard.readText();
                    if (text && text.trim()) {
                        this.els.inputText.value = text;
                        this.updateWordCount();
                    }
                } catch (e) {}
                this.els.inputText.focus();
            });
        }

        // Update word count on textarea input
        this.els.inputText.addEventListener('input', () => this.updateWordCount());

        // Palette selector change
        this.els.colorDots.forEach(dot => {
            dot.addEventListener('click', (e) => {
                this.els.colorDots.forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                const colorHex = dot.dataset.color;
                this.highlighter.setCurrentColor(colorHex);
            });
        });

        // Mode switch: Select vs Brush Pen vs Dictionary Lookup
        this.els.btnModeSelect.addEventListener('click', () => {
            this.els.btnModeSelect.classList.add('active');
            this.els.btnModeBrush.classList.remove('active');
            this.els.btnModeLookup.classList.remove('active');
            this.highlighter.setMode('select');
            this._setLookupModeActive(false);
        });

        this.els.btnModeBrush.addEventListener('click', () => {
            this.els.btnModeBrush.classList.add('active');
            this.els.btnModeSelect.classList.remove('active');
            this.els.btnModeLookup.classList.remove('active');
            this.highlighter.setMode('brush');
            this._setLookupModeActive(false);
            if (this.currentMode === 'edit') {
                this.switchToReadingMode();
            }
        });

        // Dictionary Lookup Mode: hover any word to see meaning, IPA, POS & hear pronunciation
        this.els.btnModeLookup.addEventListener('click', () => {
            this.els.btnModeLookup.classList.add('active');
            this.els.btnModeSelect.classList.remove('active');
            this.els.btnModeBrush.classList.remove('active');
            this.highlighter.setMode('lookup');
            this._setLookupModeActive(true);
            if (this.currentMode === 'edit') {
                this.switchToReadingMode();
            }
        });

        // Font scaling controls
        this.els.btnFontDec.addEventListener('click', () => this.changeFontSize(-1));
        this.els.btnFontInc.addEventListener('click', () => this.changeFontSize(1));

        // Translate Button
        this.els.btnTranslate.addEventListener('click', () => this.handleTranslate());

        // AI Deep Auto Highlight Button
        this.els.btnAutoHighlight.addEventListener('click', () => this.handleAIAutoScan());

        // Load Sample Button
        this.els.btnLoadSample.addEventListener('click', () => this.loadSampleText());

        // Export & Preview PDF Buttons (header & inline bar)
        const btnPreviewPDFHeader = document.getElementById('btnPreviewPDFHeader');
        if (btnPreviewPDFHeader) {
            btnPreviewPDFHeader.addEventListener('click', () => this.handlePreviewPDF());
        }
        const btnExportPDFHeader = document.getElementById('btnExportPDFHeader');
        if (btnExportPDFHeader) {
            btnExportPDFHeader.addEventListener('click', () => this.handleExportPDF());
        }
        const btnExportPDFInline = document.getElementById('btnExportPDFInline');
        if (btnExportPDFInline) {
            btnExportPDFInline.addEventListener('click', () => this.handleExportPDF());
        }

        // Provider change in settings modal
        this.els.selectProvider.addEventListener('change', (e) => {
            const provider = e.target.value;
            if (provider === 'openai') {
                this.els.groupOpenAI.style.display = 'flex';
                this.els.groupGemini.style.display = 'none';
            } else {
                this.els.groupOpenAI.style.display = 'none';
                this.els.groupGemini.style.display = 'flex';
            }
        });

        // Toggle dedicated Scan API config group
        this.els.chkUseSeparateScanApi.addEventListener('change', (e) => {
            this.els.groupSeparateScanApi.style.display = e.target.checked ? 'flex' : 'none';
        });

        // Provider change for the dedicated Scan API
        this.els.selectScanProvider.addEventListener('change', (e) => {
            const provider = e.target.value;
            if (provider === 'openai') {
                this.els.groupScanOpenAI.style.display = 'flex';
                this.els.groupScanGemini.style.display = 'none';
            } else {
                this.els.groupScanOpenAI.style.display = 'none';
                this.els.groupScanGemini.style.display = 'flex';
            }
        });

        // Settings Modal events
        this.els.btnOpenSettings.addEventListener('click', () => this.openSettings());
        this.els.btnCloseSettings.addEventListener('click', () => this.closeSettings());
        this.els.btnCancelSettings.addEventListener('click', () => this.closeSettings());
        this.els.btnSaveSettings.addEventListener('click', () => this.saveSettings());

        // Clear button
        this.els.btnClear.addEventListener('click', () => {
            if (confirm("Bạn có chắc chắn muốn xóa làm mới văn bản, toàn bộ highlight và các mục tổng kết từ vựng không?")) {
                if (this._closeVocabDetail) this._closeVocabDetail();
                this.els.inputText.value = '';
                this.els.readingCanvas.innerHTML = '';
                this.els.translationCanvas.innerHTML = '<em style="color: var(--text-light);">Bản dịch tiếng Việt và các từ được tô đậm tương ứng sẽ hiển thị ở đây sau khi bạn nhấn "Dịch & Phân Tích".</em>';
                this.highlighter.clearAllHighlights();
                this.vocabSessions = [];
                this.activeSessionId = null;
                this.currentVocabData = [];
                this.renderVocabAccordion();
                this.updateWordCount();
                this.switchToEditMode();
            }
        });

        // Header collapse toggle: hide all toolbar buttons except the 3-bar toggle, the
        // theme switch, and a small "Translate" quick-action, freeing up vertical
        // space for the text panes and the vocab table below.
        if (this.els.btnToggleHeaderCollapse && this.els.appHeader) {
            const setCollapsed = (collapsed) => {
                this.els.appHeader.classList.toggle('header-collapsed', collapsed);
                // Sync the "hidden" attribute for screen readers + the initial DOM state
                if (this.els.btnToggleHeaderCollapse) this.els.btnToggleHeaderCollapse.hidden = collapsed;
                if (this.els.btnToggleHeaderExpand) this.els.btnToggleHeaderExpand.hidden = !collapsed;
                localStorage.setItem('lingua_header_collapsed', collapsed ? '1' : '0');
            };
            this.els.btnToggleHeaderCollapse.addEventListener('click', () => {
                setCollapsed(!this.els.appHeader.classList.contains('header-collapsed'));
            });
            // The X button lives next to the logo in collapsed mode and just re-expands
            if (this.els.btnToggleHeaderExpand) {
                this.els.btnToggleHeaderExpand.addEventListener('click', () => {
                    setCollapsed(false);
                });
            }
            const wasCollapsed = localStorage.getItem('lingua_header_collapsed') === '1';
            setCollapsed(wasCollapsed);
        }
    }

    /**
     * Vertical resizer between the split-screen and the vocab table.
     * Drag the handle up to shrink the split-screen and expand the table (and vice versa).
     * Min/max caps keep both areas usable. Height is remembered in localStorage.
     */
    _initVocabResizer() {
        const resizer = this.els.vocabResizer;
        const split = this.els.splitContainer;
        const section = this.els.vocabSection;
        if (!resizer || !split || !section) return;

        // Restore saved heights.
        // The section uses an explicit `height` so users can drag to resize.
        // The accordion inside is now UNCAP (`max-height: none`), so it grows
        // naturally with content — there's no internal scroll to fight with.
        // Default vocab table height = 460px (sensible starting point).
        const savedVocabH = parseInt(localStorage.getItem('lingua_vocab_height') || '460', 10);
        const savedSplitH = parseInt(localStorage.getItem('lingua_split_height') || '520', 10);
        if (savedVocabH >= 80)  section.style.height = savedVocabH + 'px';
        if (savedSplitH >= 120) split.style.height   = savedSplitH + 'px';

        const startDrag = (e) => {
            e.preventDefault();
            e.stopPropagation();

            resizer.classList.add('dragging');
            document.body.classList.add('vocab-resize-dragging');

            const startY      = e.clientY || (e.touches && e.touches[0].clientY);
            const startSplitH = split.getBoundingClientRect().height;
            const startVocabH = section.getBoundingClientRect().height;

            const onMove = (ev) => {
                const currentY = ev.clientY || (ev.touches && ev.touches[0].clientY);
                const dy = currentY - startY;

                // Kéo XUỐNG → split container dài ra (không giới hạn)
                // Kéo LÊN → vocab table phóng to
                const newSplitH  = Math.max(120, startSplitH + dy);
                const newVocabH  = Math.max(80, startVocabH - dy);

                split.style.height   = newSplitH + 'px';
                section.style.height = newVocabH + 'px';
            };

            const onEnd = () => {
                resizer.classList.remove('dragging');
                document.body.classList.remove('vocab-resize-dragging');

                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);

                localStorage.setItem('lingua_split_height', Math.round(split.getBoundingClientRect().height));
                localStorage.setItem('lingua_vocab_height', Math.round(section.getBoundingClientRect().height));
                // The accordion now uses CSS-only `max-height: 65vh` so it adapts
                // automatically on window resize. No JS-driven refit needed.
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        };

        resizer.addEventListener('mousedown', startDrag);
        resizer.addEventListener('touchstart', startDrag, { passive: false });

        // Double-click → reset to a comfortable default
        resizer.addEventListener('dblclick', () => {
            section.style.height = '460px';
            split.style.height   = '520px';
            localStorage.setItem('lingua_vocab_height', '460');
            localStorage.setItem('lingua_split_height', '520');
        });
    }

    /**
     * AI Deep Auto Scan & Highlight
     * Now with auto-fallback: if API keys expire or fail, automatically uses
     * the powerful offline NLP engine to extract 40-80+ vocabulary items.
     */
    async handleAIAutoScan() {
        if (this.currentMode === 'edit') {
            this.switchToReadingMode();
        }

        const text = this.els.inputText.value.trim();
        if (!text) {
            alert("Vui lòng nhập bài viết tiếng Anh trước khi quét.");
            return;
        }

        this.els.btnAutoHighlight.disabled = true;
        this.els.btnAutoHighlight.textContent = "⌛ Đang AI quét...";
        if (this.els.progressContainer) this.els.progressContainer.style.display = 'block';

        try {
            const aiTerms = await this.translator.autoScanKeyTermsWithAI(text, (current, total, percent, message) => {
                if (this.els.progressText) this.els.progressText.textContent = message;
                if (this.els.progressPercent) this.els.progressPercent.textContent = `${percent}%`;
                if (this.els.progressBarFill) this.els.progressBarFill.style.width = `${percent}%`;
            });
            let count = 0;
            if (aiTerms && aiTerms.length > 0) {
                count = this.highlighter.highlightCustomTerms(aiTerms);
            }
            if (count > 0) {
                // Build vocab data with Vietnamese translations for the scanned terms
                this.els.btnAutoHighlight.textContent = "⌛ Đang dịch nghĩa...";
                const highlights = this.highlighter.getAllHighlightedItems();
                const vocabData = await this._buildVocabDataForTerms(highlights);
                this.currentVocabData = vocabData;
                this._addVocabSession(text, highlights, vocabData);
                alert(`✨ Đã tìm thấy và tô đậm ${count} từ vựng/cụm từ/cấu trúc ngữ pháp hay trong bài!`);
            } else {
                alert(`Không tìm thấy từ vựng phù hợp trong bài viết.`);
            }
        } catch (e) {
            console.warn("AI Auto-Scan error:", e);
            alert(`⚠️ ${e.message || 'Lỗi không xác định'}. Vui lòng kiểm tra API Key trong ⚙️ Cài đặt.`);
            this.openSettings();
        } finally {
            this.els.btnAutoHighlight.disabled = false;
            this.els.btnAutoHighlight.textContent = "✨ AI Quét Từ & Cấu Trúc Hay";
            setTimeout(() => {
                if (this.els.progressContainer) this.els.progressContainer.style.display = 'none';
            }, 1000);
        }
    }

    changeFontSize(delta) {
        this.fontSize = Math.max(13, Math.min(24, this.fontSize + delta));
        document.documentElement.style.setProperty('--reading-font-size', `${this.fontSize}px`);
        if (this.els.fontSizeDisplay) {
            this.els.fontSizeDisplay.textContent = `${this.fontSize}px`;
        }
    }

    /**
     * Typography Controls: Font Weight slider (thickness) & Font Family selector.
     * Applies to both the editable textarea and the reading/translation canvases,
     * and persists the chosen values to localStorage.
     */
    _initTypographyControls() {
        // Apply saved/default values on load
        document.documentElement.style.setProperty('--reading-font-weight', this.fontWeight);
        document.documentElement.style.setProperty('--reading-font-family', this.fontFamily);

        if (this.els.fontWeightSlider) {
            this.els.fontWeightSlider.value = this.fontWeight;
            if (this.els.fontWeightDisplay) this.els.fontWeightDisplay.textContent = this.fontWeight;

            this.els.fontWeightSlider.addEventListener('input', (e) => {
                this.fontWeight = parseInt(e.target.value, 10);
                document.documentElement.style.setProperty('--reading-font-weight', this.fontWeight);
                if (this.els.fontWeightDisplay) this.els.fontWeightDisplay.textContent = this.fontWeight;
                // Update gradient track fill: (val - min) / (max - min) * 100%
                const min = parseInt(e.target.min, 10) || 0;
                const max = parseInt(e.target.max, 10) || 100;
                const pct = ((this.fontWeight - min) / (max - min)) * 100;
                e.target.style.setProperty('--slider-progress', pct + '%');
                localStorage.setItem('lingua_font_weight', this.fontWeight);
            });
            // Initial gradient fill
            const initMin = parseInt(this.els.fontWeightSlider.min, 10) || 0;
            const initMax = parseInt(this.els.fontWeightSlider.max, 10) || 100;
            const initPct = ((this.fontWeight - initMin) / (initMax - initMin)) * 100;
            this.els.fontWeightSlider.style.setProperty('--slider-progress', initPct + '%');
        }

        if (this.els.fontFamilySelect) {
            this.els.fontFamilySelect.value = this.fontFamily;
            this._initCustomFontDropdown();
        }
    }

    /**
     * Builds a fully-themed custom dropdown on top of the native <select>.
     * The native element stays in the DOM (hidden) so its .value is the single
     * source of truth — we just mirror changes to it via `change` events, which
     * the existing handler already listens to.
     */
    _initCustomFontDropdown() {
        const select = this.els.fontFamilySelect;
        const trigger = document.getElementById('fontFamilyTrigger');
        const triggerLabel = document.getElementById('fontFamilyTriggerLabel');
        const dropdown = document.getElementById('fontFamilyDropdown');
        if (!select || !trigger || !triggerLabel || !dropdown) return;

        // Build dropdown items from <option>
        const options = Array.from(select.options);
        dropdown.innerHTML = options.map((opt, i) => {
            const isSel = opt.value === this.fontFamily;
            return `<li role="option" tabindex="0" data-value="${this._escapeHTML(opt.value)}" data-index="${i}" class="${isSel ? 'selected' : ''}">${this._escapeHTML(opt.text)}</li>`;
        }).join('');

        const updateLabel = () => {
            const sel = select.options[select.selectedIndex];
            if (sel) triggerLabel.textContent = sel.text;
        };
        const updateSelectedInDropdown = () => {
            dropdown.querySelectorAll('li').forEach(li => {
                li.classList.toggle('selected', li.dataset.value === select.value);
            });
        };
        updateLabel();
        updateSelectedInDropdown();

        const open = () => {
            dropdown.hidden = false;
            // Force reflow so the CSS transition runs
            void dropdown.offsetWidth;
            dropdown.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
            // Mark the toolbar so any future overflow-clipping can be relaxed
            const toolbar = trigger.closest('.header-toolbar');
            if (toolbar) toolbar.classList.add('dropdown-open');
        };
        const close = () => {
            dropdown.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            const toolbar = trigger.closest('.header-toolbar');
            if (toolbar) toolbar.classList.remove('dropdown-open');
            // Wait for the transition to finish before truly hiding for screen readers
            setTimeout(() => {
                if (!dropdown.classList.contains('open')) dropdown.hidden = true;
            }, 220);
        };
        const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            isOpen() ? close() : open();
        });

        // Hover to peek (visual highlight only — doesn't commit)
        dropdown.querySelectorAll('li').forEach(li => {
            li.addEventListener('mouseenter', () => {
                dropdown.querySelectorAll('li.active').forEach(o => o.classList.remove('active'));
                li.classList.add('active');
            });
            li.addEventListener('mouseleave', () => li.classList.remove('active'));
            const choose = () => {
                const val = li.dataset.value;
                select.value = val;
                // Trigger the native 'change' event so existing handler runs
                select.dispatchEvent(new Event('change', { bubbles: true }));
                updateLabel();
                updateSelectedInDropdown();
                close();
            };
            li.addEventListener('click', choose);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
                if (e.key === 'Escape') { close(); trigger.focus(); }
            });
        });

        // Click outside / Escape closes
        document.addEventListener('click', (e) => {
            if (isOpen() && !dropdown.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
                close();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) close();
        });

        // Keep custom UI in sync if anyone updates the native select programmatically
        select.addEventListener('change', () => {
            updateLabel();
            updateSelectedInDropdown();
        });
    }

    _initResizer() {
        let isDragging = false;
        let resizeRafId = null;

        const onMouseDown = (e) => {
            isDragging = true;
            this.els.resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        };

        const onMouseMove = (e) => {
            if (!isDragging) return;
            const clientX = e.clientX;

            if (resizeRafId) return;
            resizeRafId = requestAnimationFrame(() => {
                resizeRafId = null;
                if (!isDragging) return;
                const containerRect = this.els.container.getBoundingClientRect();
                let mouseX = clientX - containerRect.left;
                
                let minX = containerRect.width * 0.2;
                let maxX = containerRect.width * 0.8;
                mouseX = Math.max(minX, Math.min(maxX, mouseX));

                const leftPercent = (mouseX / containerRect.width) * 100;

                this.els.paneLeft.style.flex = `0 0 ${leftPercent}%`;
                this.els.paneRight.style.flex = `1 1 ${100 - leftPercent}%`;
            });
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                if (resizeRafId) {
                    cancelAnimationFrame(resizeRafId);
                    resizeRafId = null;
                }
                this.els.resizer.classList.remove('dragging');
                document.body.style.cursor = 'default';
                document.body.style.userSelect = 'auto';
            }
        };

        this.els.resizer.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        this.els.resizer.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) onMouseDown(e.touches[0]);
        });
        document.addEventListener('touchmove', (e) => {
            if (isDragging && e.touches.length === 1) onMouseMove(e.touches[0]);
        });
        document.addEventListener('touchend', onMouseUp);

        this.els.resizer.addEventListener('dblclick', () => {
            this.els.paneLeft.style.flex = '0 0 50%';
            this.els.paneRight.style.flex = '1 1 50%';
        });
    }

    _initSyncedScroll() {
        let isLeftScrolling = false;
        let isRightScrolling = false;
        let leftScrollRaf = null;
        let rightScrollRaf = null;

        this.els.paneBodyLeft.addEventListener('scroll', () => {
            if (isRightScrolling) return;
            isLeftScrolling = true;
            if (leftScrollRaf) return;
            leftScrollRaf = requestAnimationFrame(() => {
                leftScrollRaf = null;
                const percentage = this.els.paneBodyLeft.scrollTop / (this.els.paneBodyLeft.scrollHeight - this.els.paneBodyLeft.clientHeight || 1);
                this.els.paneBodyRight.scrollTop = percentage * (this.els.paneBodyRight.scrollHeight - this.els.paneBodyRight.clientHeight);
                setTimeout(() => { isLeftScrolling = false; }, 50);
            });
        });

        this.els.paneBodyRight.addEventListener('scroll', () => {
            if (isLeftScrolling) return;
            isRightScrolling = true;
            if (rightScrollRaf) return;
            rightScrollRaf = requestAnimationFrame(() => {
                rightScrollRaf = null;
                const percentage = this.els.paneBodyRight.scrollTop / (this.els.paneBodyRight.scrollHeight - this.els.paneBodyRight.clientHeight || 1);
                this.els.paneBodyLeft.scrollTop = percentage * (this.els.paneBodyLeft.scrollHeight - this.els.paneBodyLeft.clientHeight);
                setTimeout(() => { isRightScrolling = false; }, 50);
            });
        });
    }

    updateWordCount() {
        const text = this.els.inputText.value.trim();
        const count = text ? text.split(/\s+/).length : 0;
        this.els.wordCountBadge.textContent = `${count.toLocaleString()} từ`;
    }

    toggleMode() {
        if (this.currentMode === 'edit') {
            this.switchToReadingMode();
        } else {
            this.switchToEditMode();
        }
    }

    switchToReadingMode() {
        const text = this.els.inputText.value;
        if (!text.trim()) {
            this.switchToEditMode();
            return;
        }

        this.currentMode = 'read';
        this.els.inputText.style.display = 'none';
        this.els.readingCanvas.style.display = 'block';
        this.els.btnToggleMode.textContent = '✏️ Nhập / Sửa văn bản';

        const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
        this.els.readingCanvas.innerHTML = paragraphs.map(p => `<p class="paragraph-block">${this._escapeHTML(p)}</p>`).join('');
    }

    switchToEditMode() {
        this.currentMode = 'edit';
        this.els.readingCanvas.style.display = 'none';
        this.els.inputText.style.display = 'block';
        this.els.btnToggleMode.textContent = '📖 Chế độ đọc & tô màu';
        setTimeout(() => {
            this.els.inputText.focus();
        }, 50);
    }

    async handleTranslate() {
        if (this.isTranslating) return;

        if (this.currentMode === 'edit') {
            this.switchToReadingMode();
        }

        const text = this.els.inputText.value.trim();
        if (!text) {
            alert("Vui lòng nhập bài viết tiếng Anh để dịch.");
            return;
        }

        this.isTranslating = true;
        this.els.btnTranslate.disabled = true;
        this.els.transStatusBadge.textContent = "Đang quét AI...";
        this.els.progressContainer.style.display = 'block';

        let highlights = this.highlighter.getAllHighlightedItems();

        // If AI Auto-Scan is enabled and no manual highlights exist, run AI scan first!
        if (this.translator.autoScanEnabled && highlights.length === 0) {
            try {
                if (this.els.progressText) this.els.progressText.textContent = "AI đang quét từ vựng & cấu trúc hay...";
                const aiTerms = await this.translator.autoScanKeyTermsWithAI(text, (current, total, percent, message) => {
                    if (this.els.progressText) this.els.progressText.textContent = message;
                    if (this.els.progressPercent) this.els.progressPercent.textContent = `${percent}%`;
                    if (this.els.progressBarFill) this.els.progressBarFill.style.width = `${percent}%`;
                });
                if (aiTerms && aiTerms.length > 0) {
                    this.highlighter.highlightCustomTerms(aiTerms);
                    highlights = this.highlighter.getAllHighlightedItems();
                }
            } catch (e) {
                console.warn("Auto scan error:", e);
            }
        }

        this.els.transStatusBadge.textContent = "Đang dịch...";

        try {
            const result = await this.translator.translateAndAnalyze(
                text,
                highlights,
                (current, total, percent, message) => {
                    if (this.els.progressText) this.els.progressText.textContent = message;
                    if (this.els.progressPercent) this.els.progressPercent.textContent = `${percent}%`;
                    if (this.els.progressBarFill) this.els.progressBarFill.style.width = `${percent}%`;
                }
            );

            this.renderTranslationResult(result.fullTranslation, highlights, result.vocabList);
            this.currentVocabData = result.vocabList;
            this._addVocabSession(text, highlights, result.vocabList);

            this.els.transStatusBadge.textContent = "Hoàn tất";
        } catch (err) {
            console.error("Translation failure:", err);
            alert(`Lỗi xử lý dịch thuật: ${err.message}`);
            this.els.transStatusBadge.textContent = "Lỗi";
        } finally {
            this.isTranslating = false;
            this.els.btnTranslate.disabled = false;
            setTimeout(() => {
                this.els.progressContainer.style.display = 'none';
            }, 1000);
        }
    }

    renderTranslationResult(translatedText, highlights = [], vocabList = []) {
        if (!translatedText) return;
        this.els.translationCanvas.innerHTML = this._computeTranslatedHTML(translatedText, highlights, vocabList);
    }

    /**
     * Builds the Vietnamese translation HTML (paragraphs + <mark> highlights mapped from
     * the English terms). Extracted from renderTranslationResult so it can also be cached
     * on a vocab session for later multi-document PDF export.
     */
    _computeTranslatedHTML(translatedText, highlights = [], vocabList = []) {
        let paragraphs = translatedText.split(/\n\s*\n/).filter(Boolean);
        let formattedHTML = paragraphs.map(p => `<p class="paragraph-block">${this._escapeHTML(p)}</p>`).join('');

        const sortedVocab = [...vocabList].sort((a, b) => {
            const lenA = (a.translatedTermInVN || a.contextMeaning || "").length;
            const lenB = (b.translatedTermInVN || b.contextMeaning || "").length;
            return lenB - lenA;
        });

        sortedVocab.forEach(v => {
            let hlObj = highlights.find(h => 
                h.text.toLowerCase().trim() === v.original.toLowerCase().trim() ||
                h.text.toLowerCase().includes(v.original.toLowerCase().trim()) ||
                v.original.toLowerCase().includes(h.text.toLowerCase().trim())
            );
            const colorHex = v.color || (hlObj ? hlObj.color : (highlights[0] ? highlights[0].color : '#fff3a8'));
            const termInVN = v.translatedTermInVN || v.contextMeaning;

            if (termInVN && termInVN.length > 1) {
                const regex = new RegExp(`(${this._escapeRegExp(termInVN)})`, 'gi');
                formattedHTML = formattedHTML.replace(regex, `<mark class="highlight-mark" style="background-color: ${colorHex};">$1</mark>`);
            }
        });

        return formattedHTML;
    }

    /**
     * Builds highlighted English HTML (paragraphs + <mark> spans) purely from stored
     * source text + highlight list. Used to reconstruct older sessions' reading pane
     * for PDF export, since the live readingCanvas only reflects the current session.
     */
    _buildHighlightedEnglishHTML(sourceText, highlights = []) {
        const paragraphs = sourceText.split(/\n\s*\n/).filter(Boolean);
        let html = paragraphs.map(p => `<p class="paragraph-block">${this._escapeHTML(p)}</p>`).join('');

        const sorted = [...highlights].sort((a, b) => (b.text || '').length - (a.text || '').length);
        sorted.forEach(h => {
            if (!h.text) return;
            const regex = new RegExp(`(${this._escapeRegExp(h.text)})`, 'gi');
            html = html.replace(regex, `<mark class="highlight-mark" style="background-color: ${h.color};">$1</mark>`);
        });
        return html;
    }

    /**
     * Deduplicates a highlight list down to one entry per DISTINCT word/phrase
     * (case-insensitive, trimmed), keeping the first occurrence (top-to-bottom order).
     * A term highlighted 8 times in a long article must count as 1 vocabulary item,
     * not 8 — this is what keeps the summary table's count accurate for long texts.
     */
    _dedupeHighlightsByText(highlights = []) {
        const seen = new Set();
        const result = [];
        for (const h of highlights) {
            const key = (h.text || '').toLowerCase().trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            result.push(h);
        }
        return result;
    }

    /**
     * Merge highlighted terms with their AI/dictionary vocab data into one flat
     * array of display rows, used to build each accordion document's table.
     * Deduplicates so each distinct word/phrase appears as exactly ONE row,
     * regardless of how many times it occurs (and is highlighted) in the text.
     */
    _computeDisplayItems(highlights, vocabList) {
        const uniqueHighlights = this._dedupeHighlightsByText(highlights);
        // Debug: helps diagnose "header shows 157 but table empty"
        try {
            console.log('[DEBUG _computeDisplayItems] inputs:', {
                highlightsRaw: (highlights || []).length,
                highlightsUnique: uniqueHighlights.length,
                vocabListLen: (vocabList || []).length,
                sampleVocab: (vocabList && vocabList[0]) || null,
                sampleHl: uniqueHighlights[0] || null
            });
        } catch (e) {}

        const safePOS = (w) => {
            try { return (window.dictionaryDB && window.dictionaryDB.getPOS) ? window.dictionaryDB.getPOS(w) : ''; }
            catch (e) { return ''; }
        };
        const safeIPA = (w) => {
            try { return (window.dictionaryDB && window.dictionaryDB.getIPA) ? window.dictionaryDB.getIPA(w) : ''; }
            catch (e) { return ''; }
        };
        const safeMeaning = (w) => {
            try { return (window.dictionaryDB && window.dictionaryDB.getMeaning) ? window.dictionaryDB.getMeaning(w) : ''; }
            catch (e) { return ''; }
        };

        const normaliseVocab = (v) => {
            const word = (v.original || v.term || v.text || v.word || v.english || '').toString().trim();
            if (!word) return null;
            return {
                word,
                color: v.color || '#fff3a8',
                category: v.category || (word.includes(' ')
                    ? "Cụm từ kết hợp (Collocation)"
                    : (safePOS(word) || 'vocabulary')),
                ipa: v.ipa || safeIPA(word),
                contextMeaning: v.contextMeaning || v.translatedTermInVN ||
                    v.meaning || v.meaningVi || safeMeaning(word),
                example: v.example || v.exampleEn || ''
            };
        };

        // PREFER the AI's vocab list: it always has full IPA / Vietnamese meaning /
        // example, and survives even when DOM highlights were orphaned (e.g. text
        // pasted without blank-line paragraph breaks). Fall back to highlights only
        // when the AI returned no vocabList for this session.
        if (vocabList && vocabList.length > 0) {
            const out = [];
            const seen = new Set();
            vocabList.forEach((rawV) => {
                const item = normaliseVocab(rawV);
                if (!item) return;
                const key = item.word.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                out.push({ ...item, index: out.length + 1 });
            });
            try {
                console.log('[DEBUG _computeDisplayItems] RETURN from vocabList path, out.length=', out.length, 'first=', out[0] || null);
            } catch (e) {}
            return out;
        }

        const fallbackOut = uniqueHighlights.map((h, idx) => {
            const matchedVocab = (vocabList || []).find(v => {
                const w = (v.original || v.term || v.text || '').toLowerCase().trim();
                const t = (h.text || '').toLowerCase().trim();
                return w && (w === t || t.includes(w) || w.includes(t));
            });
            const word = h.text || '';
            return {
                index: idx + 1,
                word,
                color: h.color || '#fff3a8',
                category: matchedVocab?.category || (word.includes(' ') ? "Cụm từ kết hợp (Collocation)" : safePOS(word)),
                ipa: matchedVocab?.ipa || safeIPA(word),
                contextMeaning: matchedVocab?.contextMeaning || matchedVocab?.translatedTermInVN || safeMeaning(word) || "...",
                example: matchedVocab?.example || matchedVocab?.exampleEn || ""
            };
        });
        try {
            console.log('[DEBUG _computeDisplayItems] RETURN from highlights path, fallbackOut.length=', fallbackOut.length, 'first=', fallbackOut[0] || null);
        } catch (e) {}
        return fallbackOut;
    }

    /**
     * Creates (or updates, if the same text was already processed) the collapsible
     * "document" entry in the vocabulary accordion for the text that was just
     * translated/scanned. Re-running Dịch/AI Quét on the SAME English text (e.g. Scan
     * then Translate on the same paragraph) merges into the same entry instead of
     * creating a duplicate "Văn bản N" — one entry per distinct text, as requested.
     */
    _addVocabSession(sourceText, highlights = [], vocabList = []) {
        const normalized = sourceText.replace(/\s+/g, ' ').trim();
        let session = this.vocabSessions.find(s => s.sourceText === normalized);

        try {
            console.log('[DEBUG _addVocabSession]', {
                sourceTextLen: sourceText.length,
                highlightsLen: (highlights || []).length,
                vocabListLen: (vocabList || []).length,
                firstVocab: (vocabList && vocabList[0]) || null
            });
        } catch (e) {}

        if (session) {
            session.highlights = highlights;
            session.vocabList = vocabList;
            session.expanded = true;
        } else {
            this.sessionCounter++;
            session = {
                id: this.sessionCounter,
                sourceText: normalized,
                preview: normalized.slice(0, 70),
                highlights,
                vocabList,
                expanded: true
            };
            this.vocabSessions.push(session);
        }

        // Collapse all other sessions, only the active one stays expanded
        this.vocabSessions.forEach(s => { if (s !== session) s.expanded = false; });
        this.activeSessionId = session.id;

        this.renderVocabAccordion();
    }

    toggleVocabSession(sessionId) {
        const session = this.vocabSessions.find(s => s.id === sessionId);
        if (!session) return;
        session.expanded = !session.expanded;
        this.renderVocabAccordion();
    }

    removeVocabSession(sessionId) {
        this._closeVocabDetail();
        this.vocabSessions = this.vocabSessions.filter(s => s.id !== sessionId);
        if (this.activeSessionId === sessionId) this.activeSessionId = null;
        this.renderVocabAccordion();
    }

    /**
     * Called whenever the user paints/removes a highlight on the reading canvas.
     * If those highlights belong to the text of an already-summarized session (the
     * "active" session), keep that session's table in sync automatically. New terms
     * show up immediately using dictionary data; click "🔄 Cập nhật nghĩa" on the entry
     * to fetch AI/online translations for any newly highlighted terms.
     */
    _onHighlightsLiveUpdate(items) {
        if (!this.activeSessionId) return;
        const session = this.vocabSessions.find(s => s.id === this.activeSessionId);
        if (!session) return;
        session.highlights = items;
        this.renderVocabAccordion();
    }

    /**
     * Opens a separate scrollable popup window for a single vocabulary item.
     * Shows: English explanation, one EN example sentence + VI translation,
     * plus 2-3 common structures/patterns. Falls back gracefully if AI hasn't
     * populated the explanation/structures yet.
     */
    _showVocabDetail(sessionIdx, itemIdx) {
        const session = this.vocabSessions[sessionIdx];
        if (!session) return;
        const displayItems = this._computeDisplayItems(session.highlights, session.vocabList);
        const item = displayItems[itemIdx];
        if (!item) return;

        // Find the matching AI-supplied row (has exampleEn/exampleVi/explanation/structures)
        const aiRow = session.vocabList.find(v =>
            (v.original || '').toLowerCase().trim() === item.word.toLowerCase().trim() ||
            item.word.toLowerCase().includes((v.original || '').toLowerCase().trim()) ||
            (v.original || '').toLowerCase().includes(item.word.toLowerCase().trim())
        ) || {};

        const exampleEn = aiRow.exampleEn || (item.example ? this._extractEnglishFromExample(item.example) : '');
        const exampleVi = aiRow.exampleVi || '';
        const explanation = aiRow.explanation || '';
        // Normalise structures: accept either array of {pattern, exampleEn, exampleVi}
        // (new schema) or array of plain strings (old schema) for backward compat.
        const rawStructures = Array.isArray(aiRow.structures) ? aiRow.structures.filter(Boolean) : [];
        const structures = rawStructures.map(s => {
            if (typeof s === 'string') {
                return { pattern: s, exampleEn: '', exampleVi: '' };
            }
            return {
                pattern: s.pattern || s.name || '',
                exampleEn: s.exampleEn || s.example || '',
                exampleVi: s.exampleVi || s.exampleTranslation || ''
            };
        }).filter(s => s.pattern || s.exampleEn);

        // Close any existing detail popup first so we never stack them
        this._closeVocabDetail();

        const overlay = document.createElement('div');
        overlay.className = 'vocab-detail-overlay';
        overlay.innerHTML = `
            <div class="vocab-detail-card glass-card" role="dialog" aria-modal="true">
                <div class="vocab-detail-header">
                    <div class="vocab-detail-title-wrap">
                        <span class="vocab-detail-color-dot" style="background-color:${this._escapeHTML(item.color)};"></span>
                        <div>
                            <h3 class="vocab-detail-title">${this._escapeHTML(item.word)}</h3>
                            <div class="vocab-detail-sub">
                                <span class="ipa-text">${this._escapeHTML(item.ipa || '')}</span>
                                <span class="vocab-detail-category category-tag">${this._escapeHTML(item.category)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="vocab-detail-header-actions">
                        <button class="vocab-detail-audio-btn" id="vocabDetailAudioBtn" title="Nghe phát âm">🔊</button>
                        <button class="vocab-detail-close-btn" id="vocabDetailCloseBtn" title="Đóng (Esc)">&times;</button>
                    </div>
                </div>

                <div class="vocab-detail-meaning-box">
                    <div class="vocab-detail-meaning-label">🇻🇳 Nghĩa ngữ cảnh (Tiếng Việt)</div>
                    <div class="vocab-detail-meaning-text">${this._escapeHTML(item.contextMeaning || '')}</div>
                </div>

                <div class="vocab-detail-section vocab-detail-explanation">
                    <div class="vocab-detail-section-label">📘 Giải thích <span class="vocab-detail-section-label-en">(Giải thích ngắn gọn bằng tiếng Việt)</span></div>
                    <div class="vocab-detail-explanation-text">${explanation
                        ? this._escapeHTML(explanation)
                        : '<span class="vocab-detail-empty">Chưa có giải thích chi tiết cho mục này. Hãy bấm "🔄 Cập nhật nghĩa" trên văn bản để AI phân tích sâu hơn.</span>'}</div>
                </div>

                <div class="vocab-detail-section vocab-detail-example">
                    <div class="vocab-detail-section-label">💬 Câu ví dụ <span class="vocab-detail-section-label-en">(English example + Vietnamese translation)</span></div>
                    ${exampleEn
                        ? `<div class="vocab-detail-example-en">"${this._escapeHTML(exampleEn)}"</div>
                           ${exampleVi ? `<div class="vocab-detail-example-vi">→ ${this._escapeHTML(exampleVi)}</div>` : ''}`
                        : '<div class="vocab-detail-empty">Chưa có câu ví dụ cho mục này.</div>'}
                </div>

                <div class="vocab-detail-section vocab-detail-structures">
                    <div class="vocab-detail-section-label">🧩 Cấu trúc / Câu mẫu phổ biến có liên quan <span class="vocab-detail-section-label-en">(Common structures + English example + Vietnamese translation)</span></div>
                    ${structures.length > 0
                        ? `<div class="vocab-detail-structures-list">
                            ${structures.map(s => `
                                <div class="vocab-detail-structure-item">
                                    <div class="vocab-detail-structure-pattern"><span class="vocab-detail-structure-pattern-tag">PATTERN</span> ${this._escapeHTML(s.pattern)}</div>
                                    ${s.exampleEn ? `<div class="vocab-detail-structure-example-en">"${this._escapeHTML(s.exampleEn)}"</div>` : ''}
                                    ${s.exampleVi ? `<div class="vocab-detail-structure-example-vi">→ ${this._escapeHTML(s.exampleVi)}</div>` : ''}
                                </div>
                            `).join('')}
                           </div>`
                        : '<div class="vocab-detail-empty">Chưa có cấu trúc mẫu cho mục này.</div>'}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this._currentVocabDetailOverlay = overlay;

        // Bind close actions
        const close = () => this._closeVocabDetail();
        overlay.querySelector('#vocabDetailCloseBtn').addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(); // click outside the card closes
        });
        overlay.querySelector('#vocabDetailAudioBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.speak(item.word);
        });
        // Esc to close
        this._vocabDetailEscHandler = (e) => {
            if (e.key === 'Escape') close();
        };
        document.addEventListener('keydown', this._vocabDetailEscHandler);
    }

    _closeVocabDetail() {
        if (this._currentVocabDetailOverlay) {
            this._currentVocabDetailOverlay.remove();
            this._currentVocabDetailOverlay = null;
        }
        if (this._vocabDetailEscHandler) {
            document.removeEventListener('keydown', this._vocabDetailEscHandler);
            this._vocabDetailEscHandler = null;
        }
    }

    /**
     * Best-effort split of a legacy "example" string (e.g. "Sentence. (Bản dịch.)")
     * into English / Vietnamese parts. Used as a graceful fallback when the AI's
     * new exampleEn/exampleVi fields are missing (e.g. older sessions).
     */
    _extractEnglishFromExample(raw) {
        if (!raw) return '';
        const s = String(raw).trim().replace(/^["']|["']$/g, '');
        // Split on the LAST parenthetical that looks like a Vietnamese translation
        const m = s.match(/^(.*?)\s*\(([^()]*[\u00C0-\u1EF9\u0111][^()]*)\)\s*\.?$/);
        if (m) return m[1].trim();
        return s;
    }

    /**
     * Re-fetches Vietnamese meanings/IPA/examples for any highlighted terms in this
     * session that don't yet have AI/dictionary vocab data (e.g. highlights added
     * manually after the initial Dịch & Phân Tích / AI Quét run).
     */
    async refreshVocabSession(sessionId) {
        const session = this.vocabSessions.find(s => s.id === sessionId);
        if (!session) return;

        const btn = this.els.vocabAccordionContainer.querySelector(`[data-action="refresh"][data-session-id="${sessionId}"]`);
        if (btn) { btn.disabled = true; btn.textContent = '⌛ Đang cập nhật...'; }

        try {
            const freshVocabData = await this._buildVocabDataForTerms(session.highlights);
            // Keep richer existing entries (from AI translate/scan) and only fill in gaps
            const existingByKey = new Map(session.vocabList.map(v => [v.original.toLowerCase().trim(), v]));
            session.vocabList = freshVocabData.map(v => existingByKey.get(v.original.toLowerCase().trim()) || v);
            if (this.activeSessionId === sessionId) this.currentVocabData = session.vocabList;
            this.renderVocabAccordion();
        } catch (e) {
            console.warn('Refresh vocab session error:', e);
            alert('Không thể cập nhật nghĩa cho một số từ mới. Vui lòng thử lại.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🔄 Cập nhật nghĩa'; }
        }
    }

    renderVocabAccordion() {
        // Count distinct words/phrases per session (not raw highlight occurrences),
        // so a term repeated many times in a long text is counted once.
        // Use the same fallback rule as _computeDisplayItems: count from vocabList
        // when highlights were orphaned (e.g. text has no blank-line paragraph breaks).
        const totalHighlights = this.vocabSessions.reduce((sum, s) => {
            const u = this._dedupeHighlightsByText(s.highlights).length;
            const v = (s.vocabList && s.vocabList.length) || 0;
            return sum + Math.max(u, v > 0 && (u === 0 || u < Math.min(5, v)) ? v : u);
        }, 0);
        this.els.highlightCountText.textContent = totalHighlights;
        if (this.els.vocabDocCount) this.els.vocabDocCount.textContent = this.vocabSessions.length;

        // Clear container
        this.els.vocabAccordionContainer.innerHTML = '';

        if (this.vocabSessions.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'vocab-empty-state';
            empty.id = 'vocabEmptyState';
            empty.textContent = 'Bôi đen tô màu từ vựng/cấu trúc trong văn bản tiếng Anh hoặc bấm "✨ AI Quét Từ & Cấu Trúc Hay" để tổng kết dữ liệu tại đây. Mỗi lần Dịch & Phân Tích một văn bản mới sẽ tạo thêm một mục thu gọn/mở rộng riêng bên dưới.';
            this.els.vocabAccordionContainer.appendChild(empty);
            return;
        }

        this.vocabSessions.forEach((session, sIdx) => {
            let displayItems;
            try {
                displayItems = this._computeDisplayItems(session.highlights, session.vocabList);
            } catch (e) {
                console.error('[renderVocabAccordion] _computeDisplayItems failed:', e, session);
                displayItems = [];
            }

            const docLabel = `Văn bản ${sIdx + 1}`;
            const docItem = document.createElement('div');
            docItem.className = 'vocab-doc-item' + (session.expanded ? ' expanded' : '');
            docItem.dataset.sessionId = session.id;

            // HEADER
            const header = document.createElement('div');
            header.className = 'vocab-doc-header';
            header.dataset.action = 'toggle';
            header.dataset.sessionId = session.id;

            const titleWrap = document.createElement('div');
            titleWrap.className = 'vocab-doc-title-wrap';
            const chevron = document.createElement('span');
            chevron.className = 'vocab-doc-chevron';
            chevron.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
            const title = document.createElement('span');
            title.className = 'vocab-doc-title';
            title.textContent = docLabel + (session.preview ? ' — ' + session.preview + (session.preview.length >= 70 ? '…' : '') : '');
            titleWrap.appendChild(chevron);
            titleWrap.appendChild(title);

            const actions = document.createElement('div');
            actions.className = 'vocab-doc-actions';
            const meta = document.createElement('span');
            meta.className = 'vocab-doc-meta';
            meta.textContent = `${displayItems.length} mục`;

            const exportBtn = document.createElement('button');
            exportBtn.className = 'vocab-doc-export-pdf';
            exportBtn.dataset.action = 'export-pdf';
            exportBtn.dataset.sessionId = session.id;
            exportBtn.title = `Xuất file PDF riêng cho ${docLabel}`;
            exportBtn.innerHTML = '📄 Xuất PDF';

            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'vocab-doc-refresh';
            refreshBtn.dataset.action = 'refresh';
            refreshBtn.dataset.sessionId = session.id;
            refreshBtn.title = 'Quét lại & dịch nghĩa cho các từ vừa tô đậm thêm';
            refreshBtn.textContent = '🔄 Cập nhật nghĩa';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'vocab-doc-delete';
            deleteBtn.dataset.action = 'delete';
            deleteBtn.dataset.sessionId = session.id;
            deleteBtn.title = 'Xóa văn bản này';
            deleteBtn.textContent = '×';

            actions.appendChild(meta);
            actions.appendChild(exportBtn);
            actions.appendChild(refreshBtn);
            actions.appendChild(deleteBtn);

            header.appendChild(titleWrap);
            header.appendChild(actions);

            // BODY (table)
            const body = document.createElement('div');
            body.className = 'vocab-doc-body';
            const bodyInner = document.createElement('div');
            bodyInner.className = 'vocab-doc-body-inner';
            const tableWrapper = document.createElement('div');
            tableWrapper.className = 'table-wrapper';
            const table = document.createElement('table');
            table.className = 'vocab-table';

            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            const headCols = [
                { w: '50px', t: 'STT', align: 'center' },
                { w: '220px', t: 'Từ / Cụm từ / Cấu trúc (English)' },
                { w: '150px', t: 'Loại từ / Cấu trúc' },
                { w: '140px', t: 'Phiên âm (IPA)' },
                { w: '220px', t: 'Nghĩa ngữ cảnh (Tiếng Việt)' },
                { w: '80px', t: 'Phát âm', align: 'center' },
                { w: '100px', t: 'Đọc thêm', align: 'center' }
            ];
            headCols.forEach(c => {
                const th = document.createElement('th');
                th.style.width = c.w;
                if (c.align) th.style.textAlign = c.align;
                th.textContent = c.t;
                headRow.appendChild(th);
            });
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');

            if (displayItems.length === 0) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 7;
                td.style.textAlign = 'center';
                td.style.padding = '20px';
                td.style.color = 'var(--text-light)';
                td.textContent = 'Không có từ vựng/cấu trúc nào được ghi nhận cho văn bản này.';
                tr.appendChild(td);
                tbody.appendChild(tr);
            } else {
                displayItems.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.className = 'vocab-row-clickable';
                    tr.dataset.docSession = sIdx;
                    tr.dataset.itemIndex = item.index - 1;

                    // STT
                    const tdIndex = document.createElement('td');
                    tdIndex.style.textAlign = 'center';
                    tdIndex.style.fontWeight = '600';
                    tdIndex.style.color = 'var(--text-muted)';
                    tdIndex.textContent = item.index;

                    // Word + color dot
                    const tdWord = document.createElement('td');
                    const wordBadge = document.createElement('div');
                    wordBadge.className = 'word-badge';
                    const dot = document.createElement('span');
                    dot.style.display = 'inline-block';
                    dot.style.width = '12px';
                    dot.style.height = '12px';
                    dot.style.borderRadius = '50%';
                    dot.style.backgroundColor = item.color || '#fff3a8';
                    dot.style.border = '1px solid rgba(0,0,0,0.1)';
                    const wordText = document.createElement('span');
                    wordText.textContent = item.word || '';
                    wordBadge.appendChild(dot);
                    wordBadge.appendChild(wordText);
                    tdWord.appendChild(wordBadge);

                    // Category
                    const tdCat = document.createElement('td');
                    const catSpan = document.createElement('span');
                    catSpan.className = 'category-tag';
                    catSpan.textContent = item.category || '';
                    tdCat.appendChild(catSpan);

                    // IPA
                    const tdIPA = document.createElement('td');
                    const ipaSpan = document.createElement('span');
                    ipaSpan.className = 'ipa-text';
                    ipaSpan.textContent = item.ipa || '';
                    tdIPA.appendChild(ipaSpan);

                    // Meaning
                    const tdMean = document.createElement('td');
                    const meanSpan = document.createElement('span');
                    meanSpan.className = 'meaning-text';
                    meanSpan.textContent = item.contextMeaning || '';
                    tdMean.appendChild(meanSpan);

                    // Audio button
                    const tdAudio = document.createElement('td');
                    tdAudio.style.textAlign = 'center';
                    const audioBtn = document.createElement('button');
                    audioBtn.className = 'audio-btn';
                    audioBtn.dataset.word = item.word || '';
                    audioBtn.title = 'Phát âm Web Speech TTS';
                    audioBtn.textContent = '🔊';
                    tdAudio.appendChild(audioBtn);

                    // Detail button
                    const tdDetail = document.createElement('td');
                    tdDetail.style.textAlign = 'center';
                    const detailBtn = document.createElement('button');
                    detailBtn.className = 'vocab-detail-btn';
                    detailBtn.dataset.docSession = sIdx;
                    detailBtn.dataset.itemIndex = item.index - 1;
                    detailBtn.title = 'Xem giải thích tiếng Anh + ví dụ + cấu trúc hay';
                    detailBtn.textContent = '📖 Chi tiết';
                    tdDetail.appendChild(detailBtn);

                    tr.appendChild(tdIndex);
                    tr.appendChild(tdWord);
                    tr.appendChild(tdCat);
                    tr.appendChild(tdIPA);
                    tr.appendChild(tdMean);
                    tr.appendChild(tdAudio);
                    tr.appendChild(tdDetail);
                    tbody.appendChild(tr);
                });
            }
            table.appendChild(tbody);
            tableWrapper.appendChild(table);
            bodyInner.appendChild(tableWrapper);
            body.appendChild(bodyInner);

            docItem.appendChild(header);
            docItem.appendChild(body);
            this.els.vocabAccordionContainer.appendChild(docItem);
        });

        // Bind toggle/delete/audio events (re-bound on every render since innerHTML was replaced)
        this.els.vocabAccordionContainer.querySelectorAll('[data-action="toggle"]').forEach(header => {
            header.addEventListener('click', () => {
                this.toggleVocabSession(parseInt(header.dataset.sessionId, 10));
            });
        });
        this.els.vocabAccordionContainer.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm("Xóa mục tổng kết từ vựng của văn bản này?")) {
                    this.removeVocabSession(parseInt(btn.dataset.sessionId, 10));
                }
            });
        });
        this.els.vocabAccordionContainer.querySelectorAll('[data-action="export-pdf"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportSessionPDF(parseInt(btn.dataset.sessionId, 10));
            });
        });
        this.els.vocabAccordionContainer.querySelectorAll('[data-action="refresh"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.refreshVocabSession(parseInt(btn.dataset.sessionId, 10));
            });
        });
        this.els.vocabAccordionContainer.querySelectorAll('.audio-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.speak(e.currentTarget.dataset.word);
            });
        });
        this.els.vocabAccordionContainer.querySelectorAll('.vocab-detail-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sIdx = parseInt(btn.dataset.docSession, 10);
                const itemIdx = parseInt(btn.dataset.itemIndex, 10);
                this._showVocabDetail(sIdx, itemIdx);
            });
        });
        // Also open detail when clicking anywhere on the row (except action buttons)
        this.els.vocabAccordionContainer.querySelectorAll('tr.vocab-row-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                // Don't trigger if click is on the audio button or detail button (those handle their own)
                if (e.target.closest('.audio-btn') || e.target.closest('.vocab-detail-btn')) return;
                const sIdx = parseInt(row.dataset.docSession, 10);
                const itemIdx = parseInt(row.dataset.itemIndex, 10);
                this._showVocabDetail(sIdx, itemIdx);
            });
        });
        // NOTE: Accordion scrollability is now driven entirely by CSS
        // (`max-height: 65vh; overflow-y: auto` on .vocab-section .vocab-accordion).
        // We don't set pixel heights from JS because that risked overriding the CSS
        // with a value too small to show all rows.
    }

    /**
     * Build vocabulary data with Vietnamese translations for highlighted terms.
     * Uses offline dictionary first, then batch-translates remaining via free API.
     * Deduplicates input first so a term repeated many times in the text is only
     * looked up/translated once (avoids wasted API calls and duplicate table rows).
     */
    async _buildVocabDataForTerms(highlights) {
        const vocabData = [];
        const needTranslation = [];
        const uniqueHighlights = this._dedupeHighlightsByText(highlights);

        for (const h of uniqueHighlights) {
            const word = h.text;
            const dictMeaning = window.dictionaryDB ? window.dictionaryDB.getMeaning(word) : null;
            const ipa = window.dictionaryDB ? window.dictionaryDB.getIPA(word) : "/.../";
            const pos = window.dictionaryDB ? window.dictionaryDB.getPOS(word) : "n.";

            let category = "Từ vựng";
            if (word.includes(' ') || word.includes('-')) {
                category = "Cụm từ kết hợp (Collocation)";
            } else if (pos.includes('v.')) {
                category = "Động từ (Verb)";
            } else if (pos.includes('adj.')) {
                category = "Tính từ (Adj)";
            } else if (pos.includes('adv.')) {
                category = "Trạng từ (Adv)";
            } else {
                category = "Danh từ (Noun)";
            }

            const entry = {
                original: word,
                color: h.color || '#fff3a8',
                category: category,
                ipa: ipa,
                contextMeaning: dictMeaning || null,
                translatedTermInVN: dictMeaning || null,
                example: ""
            };
            vocabData.push(entry);

            if (!dictMeaning) {
                needTranslation.push({ word, entry });
            }
        }

        // Batch translate words without dictionary meanings using free API
        if (needTranslation.length > 0 && this.translator) {
            for (let i = 0; i < needTranslation.length; i += 5) {
                const batch = needTranslation.slice(i, i + 5);
                const promises = batch.map(async ({ word, entry }) => {
                    try {
                        const meaning = await this.translator._translateSentenceFree(word);
                        if (meaning && meaning !== word) {
                            entry.contextMeaning = meaning;
                            entry.translatedTermInVN = meaning;
                        }
                    } catch (e) {
                        // Keep null meaning, will show "..." in table
                    }
                });
                await Promise.all(promises);
            }
        }

        return vocabData;
    }

    speak(text) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
    }

    async handlePreviewPDF() {
        if (!this.pdfExporter) {
            this.pdfExporter = new PDFExporter();
        }
        let englishText = (this.els.inputText ? this.els.inputText.value : '').trim();
        let vietnameseText = (this.els.translationCanvas ? this.els.translationCanvas.innerText : '').trim();
        let vietnameseHTML = (this.els.translationCanvas ? this.els.translationCanvas.innerHTML : '') || '';
        let rawEnHTML = (this.els.readingCanvas ? this.els.readingCanvas.innerHTML : '') || '';
        let highlights = [];
        let vocabList = [];

        // Auto-resolve from active session if the text box is empty
        if (this.vocabSessions && this.vocabSessions.length > 0) {
            const activeS = this.vocabSessions.find(s => s.id === this.activeSessionId) || this.vocabSessions[0];
            if (activeS) {
                if (!englishText) englishText = activeS.sourceText || '';
                if (!vietnameseText) vietnameseText = activeS.vietnameseText || '';
                if (!vietnameseHTML) vietnameseHTML = activeS.vietnameseHTML || '';
                highlights = activeS.highlights || [];
                vocabList = activeS.vocabList || [];
            }
        }

        if (!englishText) {
            alert("Không có nội dung để xem trước PDF. Vui lòng nhập văn bản hoặc dịch một bài viết trước.");
            return;
        }

        if (highlights.length === 0) {
            try {
                highlights = this.highlighter ? (this.highlighter.getAllHighlightedItems() || []) : [];
            } catch (e) {}
        }

        if (vocabList.length === 0) {
            vocabList = this.currentVocabData || [];
        }

        const englishHTML = rawEnHTML.trim()
            ? rawEnHTML
            : englishText.split(/\n\s*\n/).filter(Boolean)
                .map(p => `<p class="paragraph-block">${this._escapeHTML(p)}</p>`).join('');

        let title = "Tài Liệu Dịch & Từ Vựng Ngữ Cảnh";

        const activeFont = document.getElementById('fontFamilySelect') ? document.getElementById('fontFamilySelect').value : "'Lora', Georgia, serif";

        await this.pdfExporter.previewPDF({
            documentTitle: title,
            englishText: englishText,
            vietnameseText: vietnameseText,
            englishHTML: englishHTML,
            vietnameseHTML: vietnameseHTML,
            vocabList: vocabList,
            highlights: highlights,
            fontFamily: activeFont
        });
    }

    async previewSessionPDF(sessionId) {
        if (!this.pdfExporter) {
            this.pdfExporter = new PDFExporter();
        }
        const session = this.vocabSessions.find(s => s.id === sessionId);
        if (!session) {
            alert("Không tìm thấy dữ liệu văn bản này.");
            return;
        }

        const sIdx = this.vocabSessions.indexOf(session);
        const docName = `Văn bản ${sIdx + 1}`;
        const defaultTitle = `${docName}` + (session.preview ? ` — ${session.preview.slice(0, 45)}` : '');
        const activeFont = document.getElementById('fontFamilySelect') ? document.getElementById('fontFamilySelect').value : "'Lora', Georgia, serif";

        await this.pdfExporter.previewPDF({
            documentTitle: defaultTitle,
            englishText: session.sourceText || '',
            vietnameseText: session.vietnameseText || '',
            englishHTML: session.readingHTML || session.sourceText || '',
            vietnameseHTML: session.vietnameseHTML || '',
            vocabList: session.vocabList || [],
            highlights: session.highlights || [],
            fontFamily: activeFont
        });
    }

    async handleExportPDF() {
        if (!this.pdfExporter) {
            this.pdfExporter = new PDFExporter();
        }
        let englishText = (this.els.inputText ? this.els.inputText.value : '').trim();
        let vietnameseText = (this.els.translationCanvas ? this.els.translationCanvas.innerText : '').trim();
        let vietnameseHTML = (this.els.translationCanvas ? this.els.translationCanvas.innerHTML : '') || '';
        let rawEnHTML = (this.els.readingCanvas ? this.els.readingCanvas.innerHTML : '') || '';
        let highlights = [];
        let vocabList = [];

        // Auto-resolve from active session if the text box is empty
        if (this.vocabSessions && this.vocabSessions.length > 0) {
            const activeS = this.vocabSessions.find(s => s.id === this.activeSessionId) || this.vocabSessions[0];
            if (activeS) {
                if (!englishText) englishText = activeS.sourceText || '';
                if (!vietnameseText) vietnameseText = activeS.vietnameseText || '';
                if (!vietnameseHTML) vietnameseHTML = activeS.vietnameseHTML || '';
                highlights = activeS.highlights || [];
                vocabList = activeS.vocabList || [];
            }
        }

        if (!englishText) {
            alert("Không có nội dung để xuất PDF. Vui lòng nhập văn bản hoặc dịch một bài viết trước.");
            return;
        }

        if (highlights.length === 0) {
            try {
                highlights = this.highlighter ? (this.highlighter.getAllHighlightedItems() || []) : [];
            } catch (e) {}
        }

        if (vocabList.length === 0) {
            vocabList = this.currentVocabData || [];
        }

        const englishHTML = rawEnHTML.trim()
            ? rawEnHTML
            : englishText.split(/\n\s*\n/).filter(Boolean)
                .map(p => `<p class="paragraph-block">${this._escapeHTML(p)}</p>`).join('');

        let title = "Tài Liệu Dịch & Từ Vựng Ngữ Cảnh";
        try {
            const userInput = prompt("Nhập tiêu đề tài liệu PDF:", title);
            if (userInput !== null && userInput.trim() !== '') title = userInput.trim();
        } catch (e) {}

        const btnInline = document.getElementById('btnExportPDFInline');
        const originalLabel = btnInline ? btnInline.innerHTML : '';
        if (btnInline) {
            btnInline.disabled = true;
            btnInline.innerHTML = '⌛ Đang tạo...';
        }

        try {
            await this.pdfExporter.exportToPDF({
                documentTitle: title,
                englishText: englishText,
                vietnameseText: vietnameseText,
                englishHTML: englishHTML,
                vietnameseHTML: vietnameseHTML,
                vocabList: vocabList,
                highlights: highlights
            });
        } catch (err) {
            console.warn('[handleExportPDF] error, using print fallback:', err);
            try {
                this.pdfExporter._exportWithHTMLFallback({
                    documentTitle: title,
                    englishText: englishText,
                    vietnameseText: vietnameseText,
                    vocabList: vocabList,
                    highlights: highlights
                });
            } catch (e2) {
                console.error('Fallback export error:', e2);
                alert('Không thể xuất PDF. Vui lòng thử lại.');
            }
        } finally {
            if (btnInline) {
                btnInline.disabled = false;
                btnInline.innerHTML = originalLabel;
            }
        }
    }

    async exportSessionPDF(sessionId) {
        if (!this.pdfExporter) {
            this.pdfExporter = new PDFExporter();
        }
        const session = this.vocabSessions.find(s => s.id === sessionId);
        if (!session) {
            alert("Không tìm thấy dữ liệu văn bản này.");
            return;
        }

        const sIdx = this.vocabSessions.indexOf(session);
        const docName = `Văn bản ${sIdx + 1}`;
        const defaultTitle = `${docName}` + (session.preview ? ` — ${session.preview.slice(0, 45)}` : '');

        let title = defaultTitle;
        try {
            const userInput = prompt(`Nhập tiêu đề file PDF cho ${docName}:`, defaultTitle);
            if (userInput !== null && userInput.trim() !== '') title = userInput.trim();
        } catch (e) {}

        const btn = this.els.vocabAccordionContainer ? this.els.vocabAccordionContainer.querySelector(`[data-action="export-pdf"][data-session-id="${sessionId}"]`) : null;
        const origHTML = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⌛ Đang tạo...';
        }

        try {
            const enHTML = session.englishHTML || this._buildHighlightedEnglishHTML(session.sourceText || '', session.highlights || []);
            const vnHTML = session.vietnameseHTML || '';
            const enText = session.sourceText || '';
            const vnText = session.vietnameseText || '';

            await this.pdfExporter.exportToPDF({
                documentTitle: title,
                englishText: enText,
                vietnameseText: vnText,
                englishHTML: enHTML,
                vietnameseHTML: vnHTML,
                vocabList: session.vocabList || [],
                highlights: session.highlights || []
            });
        } catch (err) {
            console.error('[Export Session PDF] Error:', err);
            alert('Lỗi khi xuất PDF: ' + (err && err.message ? err.message : String(err)));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHTML;
            }
        }
    }

    loadSampleText() {
        const sampleText = `In recent decades, artificial intelligence has triggered a profound paradigm shift across modern global industries. Organizations that leverage state-of-the-art algorithms often experience exponential growth, while those resistant to technological breakthrough risk becoming obsolete.

Building resilient infrastructure is pivotal for sustainable digital transformation. Engineers must meticulously scrutinize software architectures to eliminate ambiguity and optimize performance. Furthermore, fostering a pragmatic culture of collaboration allows teams to navigate complex challenges with unprecedented agility.

Ultimately, the ubiquity of cutting-edge technology acts as a catalyst for innovation. As we embrace these game-changer solutions, maintaining empirical diligence and articulate communication will remain indispensable for future prosperity.`;

        this.els.inputText.value = sampleText;
        this.updateWordCount();
        this.switchToReadingMode();
        this.highlighter.autoHighlightKeyTerms(this.els.readingCanvas);
    }

    openSettings() {
        this.els.selectProvider.value = this.translator.provider;
        if (this.translator.provider === 'openai') {
            this.els.groupOpenAI.style.display = 'flex';
            this.els.groupGemini.style.display = 'none';
        } else {
            this.els.groupOpenAI.style.display = 'none';
            this.els.groupGemini.style.display = 'flex';
        }

        this.els.inputOpenAiApiKey.value = this.translator.openaiApiKey;
        this.els.selectOpenAiModel.value = this.translator.openaiModel;

        this.els.inputApiKey.value = this.translator.geminiApiKey;
        this.els.selectModel.value = this.translator.geminiModel;

        const chk = document.getElementById('chkAutoScanAi');
        if (chk) chk.checked = this.translator.autoScanEnabled;

        // Dedicated Scan API settings
        this.els.chkUseSeparateScanApi.checked = this.translator.useSeparateScanApi;
        this.els.groupSeparateScanApi.style.display = this.translator.useSeparateScanApi ? 'flex' : 'none';
        this.els.selectScanProvider.value = this.translator.scanProvider;
        if (this.translator.scanProvider === 'openai') {
            this.els.groupScanOpenAI.style.display = 'flex';
            this.els.groupScanGemini.style.display = 'none';
        } else {
            this.els.groupScanOpenAI.style.display = 'none';
            this.els.groupScanGemini.style.display = 'flex';
        }
        this.els.inputScanOpenAiApiKey.value = this.translator.scanOpenaiApiKey;
        this.els.selectScanOpenAiModel.value = this.translator.scanOpenaiModel;
        this.els.inputScanApiKey.value = this.translator.scanGeminiApiKey;
        this.els.selectScanModel.value = this.translator.scanGeminiModel;

        this.els.settingsModal.classList.add('active');
    }

    closeSettings() {
        this.els.settingsModal.classList.remove('active');
    }

    saveSettings() {
        const provider = this.els.selectProvider.value;
        this.translator.setProvider(provider);

        const openAiKey = this.els.inputOpenAiApiKey.value.trim();
        const openAiModel = this.els.selectOpenAiModel.value;
        this.translator.setOpenAIConfig(openAiKey, openAiModel);

        const geminiKey = this.els.inputApiKey.value.trim();
        const geminiModel = this.els.selectModel.value;
        this.translator.setGeminiConfig(geminiKey, geminiModel);

        const chk = document.getElementById('chkAutoScanAi');
        if (chk) this.translator.setAutoScanEnabled(chk.checked);

        // Save dedicated Scan API settings
        this.translator.setUseSeparateScanApi(this.els.chkUseSeparateScanApi.checked);
        this.translator.setScanProvider(this.els.selectScanProvider.value);
        this.translator.setScanOpenAIConfig(this.els.inputScanOpenAiApiKey.value.trim(), this.els.selectScanOpenAiModel.value);
        this.translator.setScanGeminiConfig(this.els.inputScanApiKey.value.trim(), this.els.selectScanModel.value);

        // New API settings → invalidate the lookup cache so subsequent hovers
        // re-query the (possibly different) provider with the new prompt rules.
        if (this.translator.clearLookupCache) this.translator.clearLookupCache();

        this.closeSettings();
        alert("Đã lưu cài đặt API thành công!");
    }

    _loadSavedSettings() {
        this.els.selectProvider.value = this.translator.provider;
        this.els.inputOpenAiApiKey.value = this.translator.openaiApiKey;
        this.els.selectOpenAiModel.value = this.translator.openaiModel;
        this.els.inputApiKey.value = this.translator.geminiApiKey;
        this.els.selectModel.value = this.translator.geminiModel;

        const chk = document.getElementById('chkAutoScanAi');
        if (chk) chk.checked = this.translator.autoScanEnabled;

        this.els.chkUseSeparateScanApi.checked = this.translator.useSeparateScanApi;
        this.els.selectScanProvider.value = this.translator.scanProvider;
        this.els.inputScanOpenAiApiKey.value = this.translator.scanOpenaiApiKey;
        this.els.selectScanOpenAiModel.value = this.translator.scanOpenaiModel;
        this.els.inputScanApiKey.value = this.translator.scanGeminiApiKey;
        this.els.selectScanModel.value = this.translator.scanGeminiModel;
    }

    _escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    _escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new LinguaApp();
});
