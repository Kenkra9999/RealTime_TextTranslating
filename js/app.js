/**
 * LinguaContext Pro - Main Application Controller
 * Orchestrates split pane resizing, text editing, dual highlighting modes, font scaling,
 * AI Auto-Scan (OpenAI ChatGPT & Google Gemini), translation, vocabulary/structure table,
 * speech synthesis, and PDF exporting.
 */
class LinguaApp {
    constructor() {
        this.highlighter = new TextHighlighter({
            onHighlightsChange: (items) => {
                this.updateVietnameseHighlights(items);
                // Re-tag every <mark> with its occurrence index (data-occ) so the
                // "Dò từ khớp" mode can pair EN<->VN occurrences 1-to-1.
                try { this.highlighter.assignOccurrenceIndices(); } catch (e) { /* ignore */ }
                try {
                    if (this.els.translationCanvas) {
                        const allMarks = this.els.translationCanvas.querySelectorAll('mark.highlight-mark');
                        const counts = new Map();
                        const norm = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ').normalize('NFC');
                        allMarks.forEach(m => {
                            const k = norm(m.getAttribute('data-en') || m.getAttribute('data-text') || m.textContent);
                            if (!k) return;
                            const i = counts.get(k) || 0;
                            counts.set(k, i + 1);
                            m.setAttribute('data-occ', String(i));
                        });
                    }
                } catch (e) { /* ignore */ }
                this._onHighlightsLiveUpdate(items);
            }
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

        // Match Tracking Mode state ("Dò từ khớp")
        this.matchModeActive = false;
        this._matchPinnedKey = null;  // English key pinned by a click; cleared on outside click

        this._bindElements();
        this._bindEvents();
        this._initResizer();
        this._initSyncedScroll();
        this._initTypographyControls();
        this._initTheme();
        this._initLookupMode();
        this._initMatchMode();
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

    /**
     * Match Tracking Mode ("Dò từ khớp"). Hovering (or clicking to pin) a highlighted term on
     * EITHER side lights up its counterpart on the other side. Pairing works off a STRICT,
     * EXACT (normalized) English key — no stem/inflection collapsing here, so "witness" and
     * "witnessed" stay two separate pairs and never light each other up.
     *
     * Each English <mark> stores its literal term in data-text (set by the highlighter).
     * Each Vietnamese <mark> stores the EXACT English source term that mapped to it in
     * data-en (set by renderMark). We pair them ONLY by exact match — no fuzzy / stem.
     */
    _initMatchMode() {
        const norm = (s) => (s || '').toString().toLowerCase().trim()
            .replace(/[\u00A0\u2000-\u200B]/g, ' ').replace(/\s+/g, ' ').normalize('NFC');
        this._matchNorm = norm;

        // STRICT key for match-tracking: exact normalized text only.
        // No stem / no inflection collapse — "witness" and "witnessed" are different keys
        // and each pair lights up INDEPENDENTLY (so hover 1 từ chỉ làm sáng đúng 1 cặp,
        // không lan sang từ đồng nghĩa / cùng gốc ở chỗ khác).
        const keyFromMark = (mark) => {
            if (!mark) return '';
            // Prefer data-en (canonical English term this VN span is mapped to) so
            // hovering a VN <mark> always pairs with the EXACT English <mark>.
            const en = mark.getAttribute('data-en');
            const txt = mark.getAttribute('data-text');
            return norm(en || txt || mark.textContent);
        };
        const occFromMark = (mark) => {
            if (!mark) return null;
            const occ = mark.getAttribute('data-occ');
            if (occ == null) return null;
            const n = parseInt(occ, 10);
            return Number.isFinite(n) ? n : null;
        };

        const applyFromMark = (mark) => {
            const k = keyFromMark(mark);
            this._matchWantOcc = occFromMark(mark);
            this._applyMatchHighlight(k);
        };

        const targets = [this.els.readingCanvas, this.els.translationCanvas].filter(Boolean);
        targets.forEach(target => {
            target.addEventListener('mousemove', (e) => {
                if (!this.matchModeActive || this._matchPinnedKey) return;
                const mark = e.target.closest ? e.target.closest('mark.highlight-mark') : null;
                applyFromMark(mark);
            });
            target.addEventListener('mouseleave', () => {
                if (!this.matchModeActive || this._matchPinnedKey) return;
                applyFromMark(null);
            });
            target.addEventListener('click', (e) => {
                if (!this.matchModeActive) return;
                const mark = e.target.closest ? e.target.closest('mark.highlight-mark') : null;
                if (mark) {
                    e.stopPropagation();
                    const key = keyFromMark(mark);
                    // Click same term again to unpin; otherwise pin the new one.
                    if (this._matchPinnedKey === key && this._matchPinnedOcc === occFromMark(mark)) {
                        this._matchPinnedKey = null;
                        this._matchPinnedOcc = null;
                        this._matchWantOcc = null;
                        this._applyMatchHighlight(null);
                    } else {
                        this._matchPinnedKey = key;
                        this._matchPinnedOcc = occFromMark(mark);
                        this._matchWantOcc = this._matchPinnedOcc;
                        this._applyMatchHighlight(key);
                    }
                } else {
                    this._matchPinnedKey = null;
                    this._matchPinnedOcc = null;
                    this._matchWantOcc = null;
                    this._applyMatchHighlight(null);
                }
            });
        });

        document.addEventListener('click', () => {
            if (this.matchModeActive && this._matchPinnedKey) {
                this._matchPinnedKey = null;
                this._matchPinnedOcc = null;
                this._matchWantOcc = null;
                this._applyMatchHighlight(null);
            }
        });
    }

    _setMatchModeActive(active) {
        this.matchModeActive = active;
        [this.els.readingCanvas, this.els.translationCanvas].filter(Boolean).forEach(el => {
            el.classList.toggle('match-mode-active', active);
        });
        if (!active) {
            this._matchPinnedKey = null;
            this._matchPinnedOcc = null;
            this._matchWantOcc = null;
            this._applyMatchHighlight(null);
        }
    }

    /**
     * Adds the .match-active glow class to every highlighted term (both sides) whose STRICT
     * normalized English key exactly equals `key`. NO stem / no fuzzy match — so hovering
     * "moreover" lights up exactly that one EN <mark> and its matching VN <mark> only,
     * never spilling to a synonym / inflection elsewhere in the document.
     */
    _applyMatchHighlight(key) {
        const norm = this._matchNorm || ((s) => (s || '').toString().toLowerCase().trim());
        const want = norm(key);
        const wantOcc = this._matchWantOcc;
        const targets = [this.els.readingCanvas, this.els.translationCanvas].filter(Boolean);
        targets.forEach(target => {
            target.classList.toggle('has-match', !!want);
            target.querySelectorAll('mark.highlight-mark').forEach(mark => {
                if (!want) { mark.classList.remove('match-active'); return; }
                // STRICT exact normalized key — prefer data-en (canonical English key
                // embedded when the VN span was rendered) over the visible text.
                const rawKey = mark.getAttribute('data-en') || mark.getAttribute('data-text') || mark.textContent;
                const mk = norm(rawKey);
                if (mk !== want) { mark.classList.remove('match-active'); return; }
                // Same normalized key — narrow to the SAME occurrence index (if known) so we
                // light up only the ONE pair the user is currently hovering, not every other
                // occurrence of the same word across the document.
                if (wantOcc == null) {
                    mark.classList.add('match-active');
                } else {
                    const markOcc = mark.getAttribute('data-occ');
                    mark.classList.toggle('match-active', markOcc != null && markOcc === String(wantOcc));
                }
            });
        });
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
        const initialPos = dict ? dict.getPOS(word, sentence) : 'n.';
        posEl.textContent = initialPos ? (initialPos.startsWith('[') ? initialPos : `[${initialPos}]`) : '[n.]';
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
            const resPos = result.pos || initialPos;
            posEl.textContent = resPos.startsWith('[') ? resPos : `[${resPos}]`;
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
            btnModeMatch: document.getElementById('btnModeMatch'),

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

        // Mode switch: Select vs Brush Pen vs Dictionary Lookup vs Match Tracking
        const clearModeButtons = () => {
            this.els.btnModeSelect.classList.remove('active');
            this.els.btnModeBrush.classList.remove('active');
            this.els.btnModeLookup.classList.remove('active');
            if (this.els.btnModeMatch) this.els.btnModeMatch.classList.remove('active');
        };

        this.els.btnModeSelect.addEventListener('click', () => {
            clearModeButtons();
            this.els.btnModeSelect.classList.add('active');
            this.highlighter.setMode('select');
            this._setLookupModeActive(false);
            this._setMatchModeActive(false);
        });

        this.els.btnModeBrush.addEventListener('click', () => {
            clearModeButtons();
            this.els.btnModeBrush.classList.add('active');
            this.highlighter.setMode('brush');
            this._setLookupModeActive(false);
            this._setMatchModeActive(false);
            if (this.currentMode === 'edit') {
                this.switchToReadingMode();
            }
        });

        // Dictionary Lookup Mode: hover any word to see meaning, IPA, POS & hear pronunciation
        this.els.btnModeLookup.addEventListener('click', () => {
            clearModeButtons();
            this.els.btnModeLookup.classList.add('active');
            this.highlighter.setMode('lookup');
            this._setMatchModeActive(false);
            this._setLookupModeActive(true);
            if (this.currentMode === 'edit') {
                this.switchToReadingMode();
            }
        });

        // Match Tracking Mode: hover/click a colored English term → its Vietnamese
        // counterpart (same color) lights up on the other side, and vice-versa.
        if (this.els.btnModeMatch) {
            this.els.btnModeMatch.addEventListener('click', () => {
                clearModeButtons();
                this.els.btnModeMatch.classList.add('active');
                this.highlighter.setMode('select');
                this._setLookupModeActive(false);
                this._setMatchModeActive(true);
                if (this.currentMode === 'edit') {
                    this.switchToReadingMode();
                }
            });
        }

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
     * Horizontal resizer between Left Pane (English) and Right Pane (Vietnamese).
     */
    _initResizer() {
        const resizer = this.els.resizer;
        const container = this.els.container;
        const paneLeft = this.els.paneLeft;
        const paneRight = this.els.paneRight;

        if (!resizer || !container || !paneLeft || !paneRight) return;

        const startDrag = (e) => {
            e.preventDefault();
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const containerRect = container.getBoundingClientRect();

            const onMove = (ev) => {
                const clientX = ev.clientX || (ev.touches && ev.touches[0].clientX);
                if (!clientX) return;
                const offset = clientX - containerRect.left;
                let percent = (offset / containerRect.width) * 100;
                if (percent < 15) percent = 15;
                if (percent > 85) percent = 85;

                paneLeft.style.flex = `0 0 ${percent}%`;
                paneRight.style.flex = `1 1 ${100 - percent}%`;
            };

            const onEnd = () => {
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onEnd);
                document.removeEventListener('touchmove', onMove);
                document.removeEventListener('touchend', onEnd);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
        };

        resizer.addEventListener('mousedown', startDrag);
        resizer.addEventListener('touchstart', startDrag, { passive: false });

        resizer.addEventListener('dblclick', () => {
            paneLeft.style.flex = '0 0 50%';
            paneRight.style.flex = '1 1 50%';
        });
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

        // Re-tag every <mark> on the EN side with its occurrence index (data-occ) so the
        // "Dò từ khớp" mode can pair EN<->VN occurrences 1-to-1.
        if (this.highlighter && typeof this.highlighter.assignOccurrenceIndices === 'function') {
            this.highlighter.assignOccurrenceIndices();
        }
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

            // TWO-PASS ALIGNMENT — 100% accuracy guarantee for Vietnamese highlighting:
            //   Pass A (already done): translation carries inline [[H:english]]vn[[/H]] markers.
            //          The AI sometimes forgets to wrap SOME items even though they exist
            //          in the translation.
            //   Pass B (this call): per-paragraph AI alignment via alignHighlightsToTranslation.
            //          We re-ask the AI, for EACH paragraph, to wrap the Vietnamese counterpart
            //          of every highlighted English term with [[H:index]]vn[[/H]] tags. Each
            //          paragraph is tiny (never truncated), the integrity check (skeleton
            //          comparison) guarantees the AI can't reword the text — so the result is
            //          verbatim-and-correct. Anything the first translation pass missed, this
            //          catches. Both markedText and alignments are merged into the renderer so
            //          items with inline markers AND items discovered by per-paragraph AI both
            //          get painted (whichever fires first wins, no doubling).
            let renderText = result.fullTranslation;
            let alignments = [];
            this.currentSourceText = text;

            const hasApiKey = (this.translator.provider === 'openai' && !!this.translator.openaiApiKey)
                || !!this.translator.geminiApiKey;
            if (hasApiKey && highlights.length > 0 && result.vocabList.length > 0) {
                if (this.els.progressText) this.els.progressText.textContent = "Đang đối chiếu từ vựng với bản dịch (pass 2/2)...";
                try {
                    const alignment = await this.translator.alignHighlightsToTranslation(
                        highlights,
                        result.fullTranslation
                    );
                    if (alignment && alignment.markedText && /\[\[H:\d+\]\]/.test(alignment.markedText)) {
                        renderText = alignment.markedText;
                    }
                    alignments = (alignment && alignment.alignments) ? alignment.alignments : [];
                    console.log(`[highlight] Per-paragraph AI alignment placed ${alignments.length} additional items.`);
                } catch (e) {
                    console.warn('Per-paragraph alignment failed, falling back to first-pass markers:', e);
                }
            }

            this.renderTranslationResult(renderText, highlights, result.vocabList, alignments, text);
            this.currentVocabData = result.vocabList;
            this._addVocabSession(text, highlights, result.vocabList, renderText, alignments);

            // Tag every <mark> on BOTH sides with its occurrence index (data-occ). Pairing the
            // Nth EN occurrence with the Nth VN occurrence is what makes the "Dò từ khớp"
            // hover light up exactly one pair instead of every occurrence of the same word.
            try { this.highlighter.assignOccurrenceIndices(); } catch (e) { /* ignore */ }
            try {
                const allMarks = this.els.translationCanvas.querySelectorAll('mark.highlight-mark');
                const counts = new Map();
                const norm = (s) => (s || '').toString().toLowerCase().trim().replace(/\s+/g, ' ').normalize('NFC');
                allMarks.forEach(m => {
                    const k = norm(m.getAttribute('data-en') || m.getAttribute('data-text') || m.textContent);
                    if (!k) return;
                    const i = counts.get(k) || 0;
                    counts.set(k, i + 1);
                    m.setAttribute('data-occ', String(i));
                });
            } catch (e) { /* ignore */ }

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

    renderTranslationResult(translatedText, highlights = [], vocabList = [], alignments = [], sourceText = '') {
        if (!translatedText) return;
        this.currentSourceText = sourceText || this.currentSourceText || '';
        const html = this._computeTranslatedHTML(translatedText, highlights, vocabList, alignments, this.currentSourceText);
        this.els.translationCanvas.innerHTML = html;

        // Keep the ORIGINAL marked translation ([[H:...]] tags intact) so that live
        // re-highlighting and PDF export can rebuild the exact same highlights without
        // having to re-guess Vietnamese positions.
        this.els.translationCanvas.dataset.markedText = translatedText;
        // Persist the English source so live re-highlighting can reuse sentence/paragraph
        // position matching for any vocab item the AI forgot to wrap inline.
        this.els.translationCanvas.dataset.sourceText = this.currentSourceText || '';
        // Persist the alignment map so live re-highlighting (updateVietnameseHighlights)
        // can reuse the exact same Vietnamese positions/colors after the initial render.
        try { this.els.translationCanvas.dataset.alignments = JSON.stringify(alignments || []); } catch (e) { this.els.translationCanvas.dataset.alignments = '[]'; }

        // Store clean raw unhighlighted text for live dynamic re-highlighting
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('mark').forEach(m => {
            const textNode = document.createTextNode(m.textContent);
            m.parentNode.replaceChild(textNode, m);
        });
        this.els.translationCanvas.dataset.rawHtml = tmp.innerHTML;
    }

    /**
     * Builds the Vietnamese translation HTML (paragraphs + <mark> highlights mapped from
     * the English terms). Extracted from renderTranslationResult so it can also be cached
     * on a vocab session for later multi-document PDF export.
     */
    _computeTranslatedHTML(translatedText, highlights = [], vocabList = [], alignments = [], sourceText = '') {
        // NFC-normalize so Unicode composition differences (e.g. "ế" as one vs two codepoints)
        // between the translation and the AI's copied alignment phrases can't silently break the
        // verbatim substring matching — a common reason a term ended up "chưa đủ" (not painted).
        const raw = (translatedText || '').normalize('NFC');

        const norm = (s) => (s || '')
            .toString()
            .toLowerCase()
            .trim()
            .replace(/[\u00A0\u2000-\u200B]/g, ' ')
            .replace(/\s+/g, ' ')
            .normalize('NFC');

// Resolve the authoritative color for an English term. Matching order:
//   1) exact (normalized) highlight.text  — the strongest, colour set on the English side
//   2) exact (normalized) vocab.original   — the AI's own color for that row
//   3) loose stem match against highlights — handles inflection like "witnessed" vs
//      "witness"/"witnessing" where the AI returned a slightly different form than the
//      highlighted word. We only accept it when one side clearly starts with the other
//      (min length 4) so short words don't collide.
//   4) yellow fallback.
        const colorForEnglishTerm = (original) => {
            const o = norm(original);
            if (!o) return '#fef08a';
            const hit = (highlights || []).find(h => norm(h.text || h.word) === o);
            if (hit && hit.color) return hit.color;
            const v = (vocabList || []).find(x => norm(x.original) === o);
            if (v && v.color) return v.color;
            const stem = (a, b) => {
                if (a.length < 4 || b.length < 4) return false;
                const shorter = a.length <= b.length ? a : b;
                const longer = a.length <= b.length ? b : a;
                return longer.startsWith(shorter);
            };
            const loose = (highlights || []).find(h => stem(norm(h.text || h.word), o));
            if (loose && loose.color) return loose.color;
            return '#fef08a';
        };

        // STRONG color resolver — used after buildFillGroups so a group always inherits the
        // REAL English-side colour instead of the #fef08a fallback. When we can't find an
        // exact highlight match we still walk every highlight and pick the closest one (same
        // normalized key, or stem match). This stops the "tiếng Anh màu A, tiếng Việt màu B"
        // symptom where the AI wrapped by text and the text didn't match an exact highlight.
        const resolveGroupColor = (enKey) => {
            const o = norm(enKey);
            if (!o) return '#fef08a';
            // Exact highlight text match
            const exact = (highlights || []).find(h => norm(h.text || h.word) === o);
            if (exact && exact.color) return exact.color;
            // Stem match — the English term might be slightly different from the highlight
            // (inflection / plural) but we still want the highlight's colour.
            const stem = (a, b) => {
                if (a.length < 4 || b.length < 4) return false;
                const shorter = a.length <= b.length ? a : b;
                const longer  = a.length <= b.length ? b : a;
                return longer.startsWith(shorter);
            };
            const loose = (highlights || []).find(h => stem(norm(h.text || h.word), o));
            if (loose && loose.color) return loose.color;
            // Vocab's stored colour
            const v = (vocabList || []).find(x => norm(x.original) === o);
            if (v && v.color) return v.color;
            return '#fef08a';
        };

        // enKey = normalized English source term, embedded as data-en so the "Dò từ khớp"
        // (match-tracking) mode can pair an English highlight with its Vietnamese counterpart.
        //
        // occIdx = occurrence index (0, 1, 2...) of THIS particular occurrence among all
        // <mark> elements that share the same enKey in the document. This is what lets us
        // pair the 1st occurrence of "witness" with the 1st occurrence of "nhân chứng" and
        // the 2nd "witness" with the 2nd "nhân chứng" — instead of all occurrences on both
        // sides lighting up together.
        const renderMark = (color, inner, enKey = '', occIdx = 0) => {
            const transColor = this.highlighter ? this.highlighter._getTranslucentColor(color) : 'rgba(250, 204, 21, 0.62)';
            const enAttr = enKey ? ` data-en="${this._escapeHTML(enKey)}"` : '';
            const occAttr = ` data-occ="${parseInt(occIdx, 10) || 0}"`;
            return `<mark class="highlight-mark" data-color="${color}"${enAttr}${occAttr} style="background-color: ${transColor} !important; background-image: none !important; color: inherit !important; padding: 1px 3px !important; margin: 0 !important; display: inline !important; border-radius: 3px !important; box-shadow: none !important; line-height: inherit !important;">${inner}</mark>`;
        };

        const paragraphs = raw.split(/\n\s*\n/).filter(Boolean);

        // ── HYBRID HIGHLIGHTING ──────────────────────────────────────────────
        // 1) PRIMARY — honour the AI's inline markers [[H:english]]cụm việt[[/H]]:
        //    exact position + exact mapping straight from the AI.
        // 2) FILL-IN — the AI often forgets to wrap SOME items even though they exist
        //    in the translation. For every vocab item that was NOT already wrapped,
        //    fall back to matching translatedTermInVN as a verbatim substring, but only
        //    in the text OUTSIDE the spans the AI already marked. This is why some
        //    English words were highlighted while their Vietnamese counterparts were not.
        // ─────────────────────────────────────────────────────────────────────

        // Canonicalize any English term to the SAME key its highlight uses, so a vocab row
        // ("witnessed") and its highlight ("witness") collapse into ONE group and can never be
        // painted twice. Falls back to the term itself when nothing matches (auto-scan rows).
        const stemMatch = (a, b) => {
            if (a.length < 4 || b.length < 4) return false;
            const shorter = a.length <= b.length ? a : b;
            const longer = a.length <= b.length ? b : a;
            return longer.startsWith(shorter);
        };
        const canonEn = (term) => {
            const o = norm(term);
            if (!o) return '';
            const hit = (highlights || []).find(h => norm(h.text || h.word) === o);
            if (hit) return norm(hit.text || hit.word);
            const loose = (highlights || []).find(h => stemMatch(norm(h.text || h.word), o));
            if (loose) return norm(loose.text || loose.word);
            return o;
        };

        const hasMarkers = /\[\[H:[^\]]*?\]\][\s\S]*?\[\[\/H\]\]/.test(raw);

        // Build ONE fill group per English term (keyed by its canonical English key). Each group
        // holds the color (taken by INDEX from the English highlight → always the exact same
        // color) plus every Vietnamese candidate phrase we know for it, longest first:
        //   A) ALIGNMENT pass — { index, vn }: the authoritative, index-keyed counterpart.
        //   B) vocabList.translatedTermInVN — the AI's own per-row Vietnamese phrase.
        //   C) NEW: anything the AI already wrapped inline for THIS English term in the same
        //      translation. We harvest `[[H:english]]vn[[/H]]` pairs from `raw` to seed the
        //      group, so even if the AI forgot to set translatedTermInVN we still have a
        //      candidate from its OWN inline wrapping.
        //   D) NEW: exampleVi / contextMeaning as a last-resort candidate (long Vietnamese
        //      string containing the term).
        // At render time each group is placed as many times as it can be found (no "first
        // occurrence only"), and is TRIED for every English term across all paragraphs (max
        // coverage → "đủ 100%").
        const buildFillGroups = () => {
            const groups = new Map(); // enKey -> { en, color, candidates: [] }
            const add = (enKey, color, vnRaw) => {
                const vn = (vnRaw || '').toString().normalize('NFC').replace(/^#+\s*/g, '').trim();
                if (!enKey || !vn) return;
                if (!groups.has(enKey)) groups.set(enKey, { en: enKey, color: color || '#fef08a', candidates: [] });
                const g = groups.get(enKey);
                if (color && color !== '#fef08a') g.color = color; // prefer a real English color
                if (!g.candidates.some(c => norm(c) === norm(vn))) g.candidates.push(vn);
            };

            // (C) Harvest every inline `[[H:english]]vn[[/H]]` mapping the AI already wrapped.
            // This is the most reliable fallback: it comes from the AI's own output, verbatim.
            if (hasMarkers) {
                const reInline = /\[\[H:([^\]]*?)\]\]([\s\S]*?)\[\[\/H\]\]/g;
                let m;
                while ((m = reInline.exec(raw)) !== null) {
                    const enRaw = (m[1] || '').trim();
                    const vnRaw = (m[2] || '').trim();
                    if (!enRaw || !vnRaw) continue;
                    // Resolve as index → highlight; otherwise resolve via canonEn
                    const asIdx = Number(enRaw);
                    let color = '#fef08a';
                    let enKey = '';
                    if (Number.isInteger(asIdx) && asIdx >= 0 && (highlights || [])[asIdx]) {
                        const h = highlights[asIdx];
                        color = h.color || '#fef08a';
                        enKey = norm(h.text || h.word);
                    } else {
                        color = colorForEnglishTerm(enRaw);
                        enKey = canonEn(enRaw);
                    }
                    if (enKey) add(enKey, color, vnRaw);
                }
            }

            (alignments || []).forEach(a => {
                const h = (highlights || [])[a.index];
                if (!h) return;
                add(norm(h.text || h.word), h.color || '#fef08a', a.vn);
            });

            (vocabList || []).forEach(v => {
                add(canonEn(v.original), colorForEnglishTerm(v.original), v.translatedTermInVN);
                // (D) exampleVi as a last-resort candidate. exampleVi is a full Vietnamese
                // sentence that contains the term — we keep it AS-IS (no trimming) so the
                // matcher just substring-picks the term inside the sentence. We tag it with
                // a `__sentence` prefix so buildWordRuns treats it differently (no edge-word
                // trimming, no per-word splitting — that would explode "tô lố" everywhere).
                if (v.exampleVi && v.exampleVi !== v.translatedTermInVN) {
                    add(canonEn(v.original), colorForEnglishTerm(v.original), '__SENTENCE__' + v.exampleVi);
                }
            });

            const arr = Array.from(groups.values());
            arr.forEach(g => g.candidates.sort((a, b) => b.length - a.length));
            // Longest primary candidate first so a phrase wins over a word nested inside it.
            arr.sort((A, B) => (B.candidates[0] || '').length - (A.candidates[0] || '').length);
            // Enforce the REAL English-side colour on every group. If a group was built from
            // an AI inline marker that the AI typed as text (e.g. [[H:paradox of progress]])
            // and the exact text didn't match a highlight exactly, `g.color` may have fallen
            // back to '#fef08a'. We now re-resolve from the full highlight list so every
            // Vietnamese mark gets the same colour as its English counterpart.
            arr.forEach(g => { g.color = resolveGroupColor(g.en); });
            return arr;
        };

        const TOKEN_SPLIT = /(\[\[MARK::[^:]*?::[^:]*?::[^:]*?::[\s\S]*?\]\])/g;

        // Vietnamese "function words" that are meaningless to highlight on their own. Used to
        // reject single-word fallback matches so we don't paint stray "của", "và", "một"...
        const STOP_WORDS = new Set(['và','của','là','một','các','những','được','có','cho','với','đã','sẽ','đang','này','đó','khi','thì','mà','ở','trong','ra','vào','lên','xuống','rằng','nên','vì','do','bởi','để','từ','đến','sự','như','nếu','hay','bằng','nhưng','thế','vậy','cũng','chỉ','rồi','vẫn','lại','the','a','an']);

        // Build a SMALL set of candidate phrases for a fill term (longest first). We ONLY try:
        //   1) the full phrase, then
        //   2) variants with at most ONE edge word trimmed (front, back, or both),
        // so if the AI added/dropped a leading/trailing word we still match the core — WITHOUT
        // the runaway sub-phrase explosion that used to paint far too much text ("tô lố").
        //
        // SPECIAL: candidates tagged with `__SENTENCE__` are full Vietnamese sentences from
        // exampleVi — we treat them as atomic (full sentence only, no trimming, no per-word
        // splitting) so we substring-match the term inside, NOT every word of the sentence.
        const buildWordRuns = (phrase) => {
            const isSentence = phrase.startsWith('__SENTENCE__');
            const cleanPhrase = isSentence ? phrase.slice('__SENTENCE__'.length) : phrase;
            const words = cleanPhrase.split(/\s+/).filter(Boolean);
            const n = words.length;
            const candidates = [];
            if (isSentence) {
                // Full sentence only — atomic match.
                candidates.push(cleanPhrase);
            } else if (n <= 1) {
                candidates.push(words.join(' '));
            } else {
                candidates.push(words.join(' '));                    // full
                candidates.push(words.slice(1).join(' '));           // drop front
                candidates.push(words.slice(0, n - 1).join(' '));    // drop back
                if (n >= 3) candidates.push(words.slice(1, n - 1).join(' ')); // drop both
            }
            const runs = [];
            const seen = new Set();
            for (const run of candidates) {
                const key = norm(run);
                if (!run || seen.has(key)) continue;
                const runWordCount = run.split(/\s+/).filter(Boolean).length;
                // A single word is only worth highlighting if it is contentful.
                // (Skipped for __SENTENCE__ since we keep it atomic.)
                if (runWordCount === 1 && !isSentence) {
                    if (run.length < 4) continue;
                    if (STOP_WORDS.has(key)) continue;
                }
                seen.add(key);
                runs.push(run);
            }
            return runs;
        };

        // Try to place ONE group in the given escaped paragraph text. We walk every Vietnamese
        // candidate (longest first), and for each candidate try the full phrase then slightly
        // trimmed variants. Marks EVERY occurrence found OUTSIDE existing MARK tokens — this
        // is the multi-occurrence behaviour the user wants ("đủ & đúng màu" everywhere a term
        // appears, not just at its first appearance).
        // Returns { txt, placeCount }. placeCount tracks how many occurrences we painted so
        // PASS 2 can mark this group as "done" without leaving a useless "unplaced" warning.
        // Turn a Vietnamese phrase into a regex source that is tolerant of (a) whitespace runs,
        // (b) minor diacritic drift — every base vowel also matches its accented variants, and
        // (c) stray punctuation that may sit between the candidate words in the rendered translation
        // (e.g. candidate "hơn nữa" should still match "Hơn nữa," / "(hơn nữa)" / "hơn-nữa").
        // This is the last-resort matcher so a term the AI transcribed with a slightly different
        // accent/tone OR with a stray comma/period still gets highlighted instead of being dropped.
        const VN_VOWELS = {
            a: 'aàáảãạăằắẳẵặâầấẩẫậ', e: 'eèéẻẽẹêềếểễệ', i: 'iìíỉĩị',
            o: 'oòóỏõọôồốổỗộơờớởỡợ', u: 'uùúủũụưừứửữự', y: 'yỳýỷỹỵ', d: 'dđ'
        };
        const looseVnRegexSource = (run) => {
            const escapedHtml = this._escapeHTML(run);
            let out = '';
            for (const ch of escapedHtml) {
                if (/\s/.test(ch)) { out += '[\\s\\u00A0]+'; continue; }
                // Treat common VN punctuation as a "soft separator": zero-or-more allowed so a
                // stray comma/period/parenthesis between two words doesn't kill the match.
                if (/[,.;:!?()\-—–"'\u201C\u201D\u2018\u2019]/.test(ch)) { out += '[\\s,.;:!?()\\-—–"\u201C\u201D\u2018\u2019]*'; continue; }
                const lower = ch.toLowerCase();
                let cls = null;
                for (const base in VN_VOWELS) {
                    if (VN_VOWELS[base].includes(lower)) { cls = VN_VOWELS[base]; break; }
                }
                if (cls) {
                    out += `[${cls}${cls.toUpperCase()}]`;
                } else {
                    out += this._escapeRegExp(ch);
                }
            }
            return out;
        };

        const tryPlaceGroup = (escapedText, group, occStart = 0) => {
            let txt = escapedText;
            const enTok = (group.en || '').replace(/:/g, '');
            let totalPlaced = 0;
            // Each [[MARK::...]] token we emit carries a sequential occurrence index so
            // the 1st Vietnamese match pairs with the 1st English occurrence, the 2nd with
            // the 2nd, etc. (Previously every match shared the same data-en key, so hovering
            // a single English mark lit up every Vietnamese occurrence — the "1 dò hiện 4,5
            // chữ cùng từ" bug the user reported.)
            let occCounter = occStart;
            const placeWith = (regex) => {
                txt = txt.split(TOKEN_SPLIT).map(part => {
                    if (part.startsWith('[[MARK::')) return part;
                    const replaced = part.replace(regex, (match) => {
                        totalPlaced++;
                        const idx = occCounter++;
                        return `[[MARK::${group.color}::${enTok}::${idx}::${match}]]`;
                    });
                    return replaced;
                }).join('');
                return totalPlaced > 0;
            };
            // Strict pass first (exact, whitespace-tolerant) across all candidates & word-runs.
            // We also allow a "soft separator" (zero-or-more punctuation) between words so that
            // candidates like "hơn nữa" still match "Hơn nữa," or "(hơn nữa)" in the rendered
            // Vietnamese text (this fixes the "tiếng Việt vẫn chưa bôi đậm hết" symptom).
            //
            // IMPORTANT — per-candidate short-circuit: for EACH candidate we try its FULL phrase
            // first; only if the full phrase matched NOTHING do we fall back to its trimmed
            // variants (drop-front / drop-back / drop-both). This stops the "tiếng Anh dò cả cụm,
            // tiếng Việt bôi lẻ tẻ" bug where the full phrase matched some occurrences while a
            // trimmed variant matched a DIFFERENT partial span of the same phrase, splitting one
            // Vietnamese cụm into rời rạc fragments. Full phrase wins → whole cụm painted as one.
            const placeCandidateStrict = (candidate) => {
                const runs = buildWordRuns(candidate);
                let placedForCandidate = false;
                runs.forEach((run, idx) => {
                    // idx 0 is always the full phrase. Skip trimmed variants (idx>0) once the
                    // full phrase already landed at least once for this candidate.
                    if (idx > 0 && placedForCandidate) return;
                    const before = totalPlaced;
                    const esc = this._escapeRegExp(this._escapeHTML(run));
                    const escSoft = esc.replace(/ /g, '[\\s,.;:!?()\\-—–"\u201C\u201D\u2018\u2019\u00A0]*');
                    placeWith(new RegExp(`(${escSoft})`, 'i'));
                    if (totalPlaced > before) placedForCandidate = true;
                });
                return placedForCandidate;
            };
            for (const candidate of group.candidates) {
                placeCandidateStrict(candidate);
            }
            // …then a diacritic-tolerant pass as a last resort (also multi-occurrence), same
            // per-candidate full-phrase-first short-circuit so we never mix full + partial.
            for (const candidate of group.candidates) {
                const runs = buildWordRuns(candidate);
                let placedForCandidate = false;
                runs.forEach((run, idx) => {
                    if (idx > 0 && placedForCandidate) return;
                    const before = totalPlaced;
                    placeWith(new RegExp(`(${looseVnRegexSource(run)})`, 'i'));
                    if (totalPlaced > before) placedForCandidate = true;
                });
            }
            // …then a UNIVERSAL CONTENT-WORD fallback: regardless of whether the English term is
            // single-word or multi-word, if every full-phrase pass above failed, fall back to
            // matching every Vietnamese content word (length ≥ 4, not a stop word) on its own.
            // This catches the "tiếng Anh bôi nhưng tiếng Việt không bôi" symptom for any
            // candidate: paraphrase ("sự phát triển" → "tiến bộ"), split ("Nghịch lý của sự
            // tiến bộ" → "Nghịch lý" + "tiến" + "bộ"), or anything in between. We accept the
            // risk of slightly-too-many highlights over the risk of missing the term entirely.
            if (totalPlaced === 0) {
                for (const candidate of group.candidates) {
                    if (candidate.startsWith('__SENTENCE__')) continue;
                    const vnWords = candidate.replace(/^#+\s*/g, '').split(/\s+/).filter(Boolean)
                        .filter(w => w.length >= 4 && !STOP_WORDS.has(w.toLowerCase()));
                    for (const w of vnWords) {
                        const escSoft = this._escapeRegExp(this._escapeHTML(w))
                            .replace(/\\?\s+/g, '[\\s\\u00A0]+');
                        placeWith(new RegExp(`(${escSoft})`, 'i'));
                    }
                }
            }
            return { txt, placeCount: totalPlaced, nextOcc: occCounter };
        };

        // Tracks English keys that PASS 1 already wrapped. PASS 2 still tries them too
        // (multi-occurrence) so a term can be painted in paragraphs where it appears but
        // the inline wrapper didn't reach — `placedEnKeys` here is only used by PASS 3
        // bookkeeping, not as a hard skip.
        const placedEnKeys = new Set();

        // Per-key occurrence counter so every VN <mark> gets a UNIQUE pair-id (enKey + index).
        // This is what lets the "Dò từ khớp" hover light up ONLY the matching EN<->VN pair
        // instead of all occurrences of the same word on both sides at once.
        const perKeyOcc = new Map();
        const nextOcc = (enKey) => {
            const n = perKeyOcc.get(enKey) || 0;
            perKeyOcc.set(enKey, n + 1);
            return n;
        };

        // PASS 1 — walk the AI's inline markers per paragraph, emit MARK tokens, and record
        // which English keys are already satisfied so the fill pass won't re-add them.
        const workingParas = paragraphs.map(p => {
            const cleanP = p.replace(/^#+\s*/g, '');
            let working = '';
            if (hasMarkers) {
                const re = /\[\[H:([^\]]*?)\]\]([\s\S]*?)\[\[\/H\]\]/g;
                let last = 0;
                let m;
                while ((m = re.exec(cleanP)) !== null) {
                    working += this._escapeHTML(cleanP.slice(last, m.index));
                    const keyRaw = (m[1] || '').trim();
                    let color, enKey;
                    const asIdx = Number(keyRaw);
                    if (Number.isInteger(asIdx) && asIdx >= 0 && (highlights || [])[asIdx]) {
                        const h = highlights[asIdx];
                        color = h.color || '#fef08a';
                        enKey = norm(h.text || h.word);
                    } else {
                        color = colorForEnglishTerm(keyRaw);
                        enKey = canonEn(keyRaw);
                    }
                    const innerVn = m[2];
                    const occIdx = nextOcc(enKey);
                    if (enKey) placedEnKeys.add(enKey);
                    working += `[[MARK::${color}::${(enKey || '').replace(/:/g, '')}::${occIdx}::${this._escapeHTML(innerVn)}]]`;
                    last = re.lastIndex;
                }
                working += this._escapeHTML(cleanP.slice(last));
            } else {
                working = this._escapeHTML(cleanP);
            }
            return working;
        });

        // PASS 2 — for every English term the AI did NOT wrap inline, place its Vietnamese
        // counterpart OURSELVES. To "match đúng" (and never paint the wrong occurrence of a
        // repeated word) we bias the search to the paragraph where the English term actually
        // appears in the source, mapping English-paragraph → Vietnamese-paragraph by position.
        // If that preferred paragraph misses, we still scan the rest so no term is ever dropped
        // ("không thiếu từ nào") — then we log any term we genuinely couldn't place.
        //
        // English source paragraphs (same \n\n splitting the translation uses). We locate a
        // term's home paragraph here, then translate that index onto the Vietnamese paragraphs.
        const enParas = (sourceText || '').normalize('NFC').split(/\n\s*\n/).filter(Boolean);
        const enParasNorm = enParas.map(p => norm(p));
        const nEn = enParasNorm.length;
        const nVn = workingParas.length;

        // Map an English paragraph index onto the Vietnamese paragraph list. When both sides have
        // the same paragraph count (the usual case) it's 1:1; otherwise map proportionally.
        const enToVnPara = (enIdx) => {
            if (nEn === 0 || nVn === 0) return 0;
            if (nEn === nVn) return enIdx;
            return Math.min(nVn - 1, Math.round((enIdx / Math.max(1, nEn - 1)) * (nVn - 1)));
        };

        // Preferred Vietnamese-paragraph scan order for a group: the paragraph its English term
        // lives in comes first, then every other paragraph as a safety net.
        const preferredParaOrder = (enKey) => {
            const order = [];
            const seen = new Set();
            for (let e = 0; e < nEn; e++) {
                if (enKey && enParasNorm[e].includes(enKey)) {
                    const v = enToVnPara(e);
                    if (!seen.has(v)) { seen.add(v); order.push(v); }
                }
            }
            for (let i = 0; i < nVn; i++) if (!seen.has(i)) { seen.add(i); order.push(i); }
            return order;
        };

        const groups = buildFillGroups();
        const unplaced = [];
        for (const group of groups) {
            if (!group.en) continue;
            // Multi-paragraph + multi-occurrence: try EVERY paragraph (not just preferred),
            // and let tryPlaceGroup paint every occurrence within each paragraph. A group is
            // only added to `unplaced` when NO paragraph contained ANY occurrence at all.
            // Carry the per-key occurrence counter across paragraphs so PASS-1 occurrences
            // (already-counted in perKeyOcc during PASS 1) keep their natural ordering — that
            // way occurrence #N on the EN side pairs with occurrence #N on the VN side.
            let placedAnywhere = false;
            const startOcc = perKeyOcc.get(group.en) || 0;
            let cursor = startOcc;
            for (const i of preferredParaOrder(group.en)) {
                const { txt, placeCount, nextOcc } = tryPlaceGroup(workingParas[i], group, cursor);
                if (placeCount > 0) {
                    workingParas[i] = txt;
                    placedEnKeys.add(group.en);
                    placedAnywhere = true;
                    cursor = nextOcc;
                    // Don't break — keep scanning other paragraphs so repeated occurrences
                    // (e.g. a 5-paragraph article using "chuyển đổi tư duy" in paragraphs 1, 3, 5)
                    // are ALL painted.
                }
            }
            perKeyOcc.set(group.en, cursor);
            if (!placedAnywhere) unplaced.push(group.en);
        }

        // Coverage report — surfaces any vocab item we couldn't paint (usually because the AI
        // merged/split sentences so the Vietnamese phrase differs from translatedTermInVN).
        if (unplaced.length) {
            console.warn(`[highlight] Chưa tô được ${unplaced.length} cụm (có thể do dịch gộp/tách câu):`, unplaced);
        }

        // PASS 2.5 — MERGE adjacent MARK tokens that belong to the SAME English term
        // (same color + same enKey) when they are separated only by whitespace, stray
        // punctuation, or Vietnamese "function words" (của, sự, và, một…). This is what
        // fixes the "tiếng Anh dò cả cụm nhưng tiếng Việt bị tách rời" bug: a phrase like
        // EN "Paradox of Progress" whose VN counterpart "Nghịch lý của sự tiến bộ" got
        // painted as "Nghịch lý" + "của sự tiến" + (bộ dropped) is re-stitched into ONE
        // contiguous <mark> covering "Nghịch lý của sự tiến bộ". We absorb the in-between
        // gap text (function words / punctuation) into the merged mark so the whole
        // Vietnamese phrase reads as a single highlighted unit — đúng, đủ & cùng màu.
        //
        // IMPROVED v2: instead of merging only the FIRST adjacent pair then restarting,
        // we walk the chain in one pass: starting from a token, keep fusing it with every
        // next same-enKey token whose intervening gap is mergeable, producing ONE fused
        // token. This handles the "Nghịch lý" + "của sự tiến" + "bộ" case (3 fragments →
        // 1 mark) in a single pass instead of needing 3 restarts. Also raises the gap
        // length cap to 120 chars so a full function-word bridge like "của sự phát triển"
        // can still be absorbed.
        const MERGE_TOKEN = /\[\[MARK::([^:]*?)::([^:]*?)::([^:]*?)::([\s\S]*?)\]\]/;
        const mergeAdjacentTokens = (working) => {
            const GAP_MAX = 120;
            const gapIsMergeable = (gap) => {
                if (gap.length > GAP_MAX) return false;
                const plain = gap.replace(/&[a-z]+;/gi, ' ').replace(/<[^>]*>/g, ' ');
                if (!plain.trim()) return true; // pure whitespace
                if (/^[\s,.;:()"'“”‘’\-–—\u00A0]*$/.test(plain)) return true;
                const words = plain.split(/[\s,.;:()"'“”‘’\-–—\u00A0]+/).filter(Boolean);
                if (!words.length) return true;
                return words.every(w => STOP_WORDS.has(w.toLowerCase()));
            };
            let guard = 0;
            for (;;) {
                if (++guard > 500) break; // safety valve
                let merged = false;
                // CHAIN-MERGE: from each token, walk forward and fuse every consecutive same-
                // enKey token whose gap is mergeable, all into one fused mark in a single pass.
                const re = new RegExp(MERGE_TOKEN.source, 'g');
                let m1 = re.exec(working);
                while (m1) {
                    const startIdx = m1.index;
                    let curEnd = startIdx + m1[0].length;
                    let color = m1[1];
                    let enKey = m1[2];
                    let occIdx = m1[3];
                    let fusedInner = m1[4];
                    let fusedAny = false;
                    // Try to extend the chain by absorbing every NEXT same-enKey token whose
                    // gap is mergeable. Stop on the first non-mergeable next token.
                    for (;;) {
                        const re2 = new RegExp(MERGE_TOKEN.source, 'g');
                        re2.lastIndex = curEnd;
                        const m2 = re2.exec(working);
                        if (!m2) break;
                        const gap = working.slice(curEnd, m2.index);
                        const sameTerm = m2[1] === color && norm(m2[2]) === norm(enKey);
                        if (!sameTerm || !gapIsMergeable(gap)) break;
                        fusedInner += gap + m2[4];
                        curEnd = m2.index + m2[0].length;
                        fusedAny = true;
                    }
                    if (fusedAny) {
                        const fusedToken = `[[MARK::${color}::${enKey}::${occIdx}::${fusedInner}]]`;
                        working = working.slice(0, startIdx) + fusedToken + working.slice(curEnd);
                        merged = true;
                        break; // restart scan from the top after each merge
                    }
                    m1 = re.exec(working);
                }
                if (!merged) break;
            }
            return working;
        };
        for (let i = 0; i < workingParas.length; i++) {
            workingParas[i] = mergeAdjacentTokens(workingParas[i]);
        }

        // PASS 2.6 — STRICT RE-COVERAGE + STITCH: scan for groups whose VN candidate still
        // has unmatched words sitting BETWEEN already-painted marks (or right next to them
        // across a gap). For each pair of SAME-enKey marks whose gap is ONLY whitespace /
        // punctuation / Vietnamese function words, extend the LEFT mark forward to absorb
        // the gap + the right mark so the user sees ONE merged mark instead of scattered
        // fragments. This is the "tiếng Việt dịch đơn lẻ độc lập" fix: when one Vietnamese
        // word of a multi-word phrase was left outside any mark because of diacritic drift /
        // punctuation / AI paraphrase, we now retroactively drag it into the existing mark
        // so the user sees the FULL phrase painted instead of scattered fragments.
        //
        // We do this in TWO phases so the chain can keep growing:
        //   Phase A: same-adjacent-token merge (gap ≤ 60 chars, pure whitespace/function words)
        //   Phase B: re-scan for new mergeable pairs after Phase A extended some marks
        // We also accept gaps that contain ONLY punctuation + whitespace (no other marks) up
        // to 200 chars so a paragraph break wrapped in stray punctuation still stitches.
        const recoverStrandedVnWords = (working) => {
            const re = new RegExp(MERGE_TOKEN.source, 'g');
            const tokens = [];
            let m;
            while ((m = re.exec(working)) !== null) {
                tokens.push({
                    color: m[1], enKey: m[2], occIdx: m[3], inner: m[4],
                    start: m.index, end: m.index + m[0].length
                });
            }
            if (tokens.length < 2) return working;
            let mergedSomething = true;
            while (mergedSomething) {
                mergedSomething = false;
                re.lastIndex = 0;
                const fresh = [];
                while ((m = re.exec(working)) !== null) {
                    fresh.push({
                        color: m[1], enKey: m[2], occIdx: m[3], inner: m[4],
                        start: m.index, end: m.index + m[0].length
                    });
                }
                for (let i = 0; i < fresh.length - 1; i++) {
                    const a = fresh[i], b = fresh[i + 1];
                    if (a.color !== b.color || norm(a.enKey) !== norm(b.enKey)) continue;
                    const gap = working.slice(a.end, b.start);
                    if (!gap.length) continue;
                    // Don't cross sentence boundaries (". " / "! " / "? " / "\n\n").
                    if (/[.!?]\s|\n\s*\n/.test(gap)) continue;
                    // Allow either pure whitespace/punctuation OR whitespace/punctuation +
                    // VN function words. Cap at 100 chars (long enough to span a paragraph
                    // break's stray dashes but short enough not to swallow real text).
                    if (gap.length > 100) continue;
                    const plain = gap.replace(/&[a-z]+;/gi, ' ').replace(/<[^>]*>/g, ' ');
                    const words = plain.split(/[\s,.;:()"'“”‘’\-–—\u00A0]+/).filter(Boolean);
                    const onlyPunct = !words.length;
                    const onlyStop = words.length && words.every(w => STOP_WORDS.has(w.toLowerCase()));
                    if (!onlyPunct && !onlyStop) continue;
                    const fusedInner = a.inner + gap + b.inner;
                    const fusedToken = `[[MARK::${a.color}::${a.enKey}::${a.occIdx}::${fusedInner}]]`;
                    working = working.slice(0, a.start) + fusedToken + working.slice(b.end);
                    mergedSomething = true;
                    break; // restart outer while-loop because indices shifted
                }
            }
            return working;
        };
        for (let i = 0; i < workingParas.length; i++) {
            workingParas[i] = recoverStrandedVnWords(workingParas[i]);
        }

        // PASS 3 — convert all intermediate tokens into real <mark> elements.
        // Token shape: [[MARK::color::enKey::occIdx::inner]]
        const formatted = workingParas.map(working => {
            const html = working.replace(/\[\[MARK::([^:]*?)::([^:]*?)::([^:]*?)::([\s\S]*?)\]\]/g, (match, color, enKey, occIdx, inner) => {
                return renderMark(color, inner, enKey, parseInt(occIdx, 10) || 0);
            });
            return `<p class="paragraph-block">${html}</p>`;
        });

        return formatted.join('');
    }

    /**
     * Strips the inline highlight markers [[H:original]]...[[/H]] from a translation,
     * leaving clean human-readable Vietnamese text (used for the plain-text copy stored
     * on sessions and passed to the PDF text fields).
     */
    _stripHighlightMarkers(text) {
        return (text || '').replace(/\[\[H:[^\]]*?\]\]([\s\S]*?)\[\[\/H\]\]/g, '$1');
    }

    updateVietnameseHighlights(highlights = []) {
        if (!this.els.translationCanvas) return;

        // Reuse the alignment map computed at translation time so live re-highlighting
        // keeps the exact same Vietnamese positions/colors.
        let alignments = [];
        try { alignments = JSON.parse(this.els.translationCanvas.dataset.alignments || '[]'); } catch (e) { alignments = []; }
        const sourceText = this.els.translationCanvas.dataset.sourceText || this.currentSourceText || '';

        // Prefer the marked translation (with [[H:...]] tags) so highlight positions come
        // straight from the AI. Fall back to the stripped raw HTML for legacy sessions.
        const markedText = this.els.translationCanvas.dataset.markedText;
        if (markedText && markedText.trim()) {
            this.els.translationCanvas.innerHTML = this._computeTranslatedHTML(
                markedText,
                highlights,
                this.currentVocabData || [],
                alignments,
                sourceText
            );
            return;
        }

        let rawVnHTML = this.els.translationCanvas.dataset.rawHtml;
        if (!rawVnHTML || rawVnHTML.includes('Bản dịch tiếng Việt')) return;

        const tmp = document.createElement('div');
        tmp.innerHTML = rawVnHTML;
        const textContent = Array.from(tmp.querySelectorAll('p, div.paragraph-block'))
            .map(p => p.innerText || p.textContent || '')
            .join('\n\n');

        const updatedHTML = this._computeTranslatedHTML(
            textContent || rawVnHTML,
            highlights,
            this.currentVocabData || [],
            alignments,
            sourceText
        );

        this.els.translationCanvas.innerHTML = updatedHTML;
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
    _addVocabSession(sourceText, highlights = [], vocabList = [], vietnameseMarked = '', alignments = []) {
        const normalized = sourceText.replace(/\s+/g, ' ').trim();
        let session = this.vocabSessions.find(s => s.sourceText === normalized);
        const cleanVn = this._stripHighlightMarkers(vietnameseMarked || '');

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
            if (alignments && alignments.length) session.alignments = alignments;
            if (vietnameseMarked) {
                session.vietnameseMarked = vietnameseMarked;
                session.vietnameseText = cleanVn;
            }
        } else {
            this.sessionCounter++;
            session = {
                id: this.sessionCounter,
                sourceText: normalized,
                preview: normalized.slice(0, 70),
                highlights,
                vocabList,
                alignments: alignments || [],
                vietnameseMarked: vietnameseMarked || '',
                vietnameseText: cleanVn,
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
        if (!englishText && this.els.readingCanvas) {
            englishText = (this.els.readingCanvas.innerText || this.els.readingCanvas.textContent || '').trim();
        }
        let vietnameseText = (this.els.translationCanvas ? this.els.translationCanvas.innerText : '').trim();
        let vietnameseMarked = (this.els.translationCanvas ? (this.els.translationCanvas.dataset.markedText || '') : '');
        let vietnameseHTML = (this.els.translationCanvas ? this.els.translationCanvas.innerHTML : '') || '';
        let rawEnHTML = (this.els.readingCanvas ? this.els.readingCanvas.innerHTML : '') || '';
        let highlights = [];
        let vocabList = [];

        const activeS = (this.vocabSessions && this.vocabSessions.length > 0)
            ? (this.vocabSessions.find(s => s.id === this.activeSessionId) || this.vocabSessions[0])
            : null;

        if (activeS) {
            if (!englishText) englishText = activeS.sourceText || '';
            if (!vietnameseText) vietnameseText = activeS.vietnameseText || '';
            if (!vietnameseMarked) vietnameseMarked = activeS.vietnameseMarked || '';
            if (!vietnameseHTML) vietnameseHTML = activeS.vietnameseHTML || '';
        }

        const sessionHighlights = activeS ? (activeS.highlights || []) : [];
        const canvasHighlights = this.highlighter ? (this.highlighter.getAllHighlightedItems() || []) : [];
        highlights = [...sessionHighlights, ...canvasHighlights];

        const sessionVocab = activeS ? (activeS.vocabList || []) : [];
        const currentVocab = this.currentVocabData || [];
        vocabList = [...sessionVocab, ...currentVocab];

        if (!englishText) {
            alert("Không có nội dung để xem trước PDF. Vui lòng nhập văn bản hoặc dịch một bài viết trước.");
            return;
        }

        const englishHTML = rawEnHTML.trim()
            ? rawEnHTML
            : englishText.split(/\n\s*\n/).filter(Boolean)
                .map(p => `<p class="paragraph-block">${this._escapeHTML(p)}</p>`).join('');

        let title = "Tài Liệu Dịch & Từ Vựng Ngữ Cảnh";

        const activeFont = document.getElementById('fontFamilySelect') ? document.getElementById('fontFamilySelect').value : "'Lora', Georgia, serif";

        // Re-compute fresh, 100% color-synchronized Vietnamese HTML right before PDF preview.
        // Prefer the marked translation (inline [[H:...]] tags) so highlights land exactly where
        // the AI put them; fall back to the plain text for legacy sessions.
        let pdfAlignments = [];
        try { pdfAlignments = JSON.parse(this.els.translationCanvas.dataset.alignments || '[]'); } catch (e) { pdfAlignments = []; }
        if ((!pdfAlignments || !pdfAlignments.length) && activeS && activeS.alignments) pdfAlignments = activeS.alignments;

        const vnSource = vietnameseMarked || vietnameseText;
        if (vnSource) {
            vietnameseHTML = this._computeTranslatedHTML(vnSource, highlights, vocabList, pdfAlignments, englishText || this.currentSourceText || '');
        }

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

        const canvasHighlights = this.highlighter ? (this.highlighter.getAllHighlightedItems() || []) : [];
        const mergedHighlights = [...(session.highlights || []), ...canvasHighlights];
        const mergedVocab = [...(session.vocabList || []), ...(this.currentVocabData || [])];

        let freshVnHTML = session.vietnameseHTML || '';
        const vnSessionSource = session.vietnameseMarked || session.vietnameseText;
        if (vnSessionSource) {
            freshVnHTML = this._computeTranslatedHTML(vnSessionSource, mergedHighlights, mergedVocab, session.alignments || [], session.sourceText || '');
        }

        await this.pdfExporter.previewPDF({
            documentTitle: defaultTitle,
            englishText: session.sourceText || '',
            vietnameseText: session.vietnameseText || '',
            englishHTML: session.readingHTML || session.sourceText || '',
            vietnameseHTML: freshVnHTML,
            vocabList: mergedVocab,
            highlights: mergedHighlights,
            fontFamily: activeFont
        });
    }

    async handleExportPDF() {
        if (!this.pdfExporter) {
            this.pdfExporter = new PDFExporter();
        }
        let englishText = (this.els.inputText ? this.els.inputText.value : '').trim();
        if (!englishText && this.els.readingCanvas) {
            englishText = (this.els.readingCanvas.innerText || this.els.readingCanvas.textContent || '').trim();
        }
        let vietnameseText = (this.els.translationCanvas ? this.els.translationCanvas.innerText : '').trim();
        let vietnameseMarked = (this.els.translationCanvas ? (this.els.translationCanvas.dataset.markedText || '') : '');
        let vietnameseHTML = (this.els.translationCanvas ? this.els.translationCanvas.innerHTML : '') || '';
        let rawEnHTML = (this.els.readingCanvas ? this.els.readingCanvas.innerHTML : '') || '';
        let highlights = [];
        let vocabList = [];

        const activeS = (this.vocabSessions && this.vocabSessions.length > 0)
            ? (this.vocabSessions.find(s => s.id === this.activeSessionId) || this.vocabSessions[0])
            : null;

        if (activeS) {
            if (!englishText) englishText = activeS.sourceText || '';
            if (!vietnameseText) vietnameseText = activeS.vietnameseText || '';
            if (!vietnameseMarked) vietnameseMarked = activeS.vietnameseMarked || '';
            if (!vietnameseHTML) vietnameseHTML = activeS.vietnameseHTML || '';
        }

        const sessionHighlights = activeS ? (activeS.highlights || []) : [];
        const canvasHighlights = this.highlighter ? (this.highlighter.getAllHighlightedItems() || []) : [];
        highlights = [...sessionHighlights, ...canvasHighlights];

        const sessionVocab = activeS ? (activeS.vocabList || []) : [];
        const currentVocab = this.currentVocabData || [];
        vocabList = [...sessionVocab, ...currentVocab];

        if (!englishText) {
            alert("Không có nội dung để xuất PDF. Vui lòng nhập văn bản hoặc dịch một bài viết trước.");
            return;
        }

        let pdfAlignments = [];
        try { pdfAlignments = JSON.parse(this.els.translationCanvas.dataset.alignments || '[]'); } catch (e) { pdfAlignments = []; }
        if ((!pdfAlignments || !pdfAlignments.length) && activeS && activeS.alignments) pdfAlignments = activeS.alignments;

        const vnSource = vietnameseMarked || vietnameseText;
        if (vnSource) {
            vietnameseHTML = this._computeTranslatedHTML(vnSource, highlights, vocabList, pdfAlignments, englishText || this.currentSourceText || '');
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
        const btnHeader = document.getElementById('btnExportPDFHeader');
        const origInline = btnInline ? btnInline.innerHTML : '';
        const origHeader = btnHeader ? btnHeader.innerHTML : '';
        if (btnInline) {
            btnInline.disabled = true;
            btnInline.innerHTML = '<span>⌛ Đang tạo PDF...</span>';
        }
        if (btnHeader) {
            btnHeader.disabled = true;
            btnHeader.innerHTML = '<span>⌛ Đang tạo...</span>';
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
                btnInline.innerHTML = origInline;
            }
            if (btnHeader) {
                btnHeader.disabled = false;
                btnHeader.innerHTML = origHeader;
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
            const enText = session.sourceText || '';
            const vnText = session.vietnameseText || '';
            const vnSource = session.vietnameseMarked || vnText;
            const vnHTML = vnSource
                ? this._computeTranslatedHTML(vnSource, session.highlights || [], session.vocabList || [], session.alignments || [], enText)
                : (session.vietnameseHTML || '');

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
