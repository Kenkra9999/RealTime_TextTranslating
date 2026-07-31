/**
 * LinguaContext Pro - PDF Exporter (html2pdf pipeline & native print fallback)
 *
 * Renders a pristine A4 PDF from a styled HTML template using html2pdf.js.
 * Guarantees 100% correct Vietnamese diacritics and Unicode IPA phonetics
 * rendered by the browser with Google Fonts (Plus Jakarta Sans / Inter).
 *
 * Sections:
 *   SECTION 1 — VĂN BẢN GỐC & BẢN DỊCH (2 cột song song)
 *     - Left  : English text with all color highlights preserved.
 *     - Right : Vietnamese translation paragraph-aligned.
 *   SECTION 2 — BẢNG TỔNG KẾT TỪ VỰNG (ĐẦY ĐỦ - KHÔNG THIẾU)
 *     - Columns: # | Từ / Cụm từ | Phiên âm (IPA) | Loại từ | Nghĩa ngữ cảnh | Ví dụ
 */
class PDFExporter {
    constructor() {
        this._jspdf = null;
    }

    get JSPDF() {
        if (!this._jspdf) {
            this._jspdf = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;
        }
        return this._jspdf;
    }

    // ===================================================================
    // PUBLIC ENTRY POINT
    // ===================================================================
    async exportToPDF(data = {}) {
        const {
            documentTitle = 'Tài Liệu Dịch & Từ Vựng Ngữ Cảnh',
            englishText = '',
            vietnameseText = '',
            englishHTML = '',
            vietnameseHTML = '',
            highlights = [],
            vocabList = []
        } = data;

        const vocabRows = this._buildVocabRows(highlights, vocabList);
        const html = this._buildDocumentHTML({
            documentTitle,
            englishText,
            vietnameseText,
            englishHTML,
            vietnameseHTML,
            highlights,
            vocabRows
        });

        const filename = this._sanitizeFilename(documentTitle);

        // Try direct PDF generation via html2pdf
        if (window.html2pdf) {
            const container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '0';
            container.style.top = '0';
            container.style.width = '794px'; // A4 width at 96dpi
            container.style.zIndex = '99999';
            container.style.background = '#ffffff';
            container.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
            container.innerHTML = html;
            document.body.appendChild(container);

            try {
                const opt = {
                    margin: [10, 10, 12, 10],
                    filename: filename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: {
                        scale: 2,
                        useCORS: true,
                        letterRendering: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.lc-reading-wrap', '.lc-table-row'] }
                };

                await window.html2pdf().set(opt).from(container).save();
                console.log('[PDFExporter] Direct PDF exported via html2pdf successfully');
                return true;
            } catch (err) {
                console.warn('[PDFExporter] html2pdf failed, falling back to print window:', err);
            } finally {
                if (container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }
        }

        // Fallback to printable window / hidden iframe if html2pdf failed or blocked
        return this._exportWithHTMLFallback(data);
    }

    // ===================================================================
    // HTML TEMPLATE BUILDER
    // ===================================================================
    _buildDocumentHTML({ documentTitle, englishText, vietnameseText, englishHTML, vietnameseHTML, highlights, vocabRows }) {
        const dateStr = new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });
        const wordCount = (englishText || '').trim().split(/\s+/).filter(Boolean).length;
        const enHTML = this._buildHighlightedParagraphHTML(englishText, englishHTML, highlights);
        const vnHTML = this._buildTranslationHTML(vietnameseText, vietnameseHTML);
        const rowsHTML = this._buildVocabRowsHTML(vocabRows);

        return `
        <div class="lc-pdf-root">
            ${this._styleBlock()}
            <div class="lc-header">
                <div class="lc-brandbar"></div>
                <div class="lc-brand-row">
                    <div class="lc-app-name">📖 LinguaContext Pro</div>
                    <div class="lc-tagline">Dịch Ngữ Cảnh · Giữ Tô Màu · Sẵn Sàng In</div>
                </div>
                <div class="lc-doc-title">${this._escapeHTML(documentTitle)}</div>
                <div class="lc-meta-bar">
                    <span>Ngày tạo: <strong>${dateStr}</strong></span>
                    <span>Tổng số từ: <strong>${wordCount.toLocaleString('vi-VN')} từ</strong></span>
                    <span>Từ vựng: <strong>${vocabRows.length} mục đầy đủ</strong></span>
                </div>
            </div>

            <div class="lc-section-title"><span class="lc-num">1</span> VĂN BẢN ĐỌC &amp; TỪ VỰNG TÔ ĐẬM <span class="lc-sub">(Giữ nguyên tô màu highlight)</span></div>
            <div class="lc-reading-wrap">
                <div class="lc-reading-head">
                    <div class="lc-col-head lc-col-en"><span class="lc-flag">EN</span> TIẾNG ANH (Tô màu ngữ cảnh)</div>
                    <div class="lc-col-head lc-col-vi"><span class="lc-flag">VI</span> TIẾNG VIỆT (Đối chiếu)</div>
                </div>
                <div class="lc-reading-grid">
                    <div class="lc-col lc-col-en-body">${enHTML}</div>
                    <div class="lc-col lc-col-vi-body">${vnHTML}</div>
                </div>
            </div>

            <div class="lc-section-title lc-section-vocab"><span class="lc-num">2</span> BẢNG TỔNG KẾT TỪ VỰNG (ĐẦY ĐỦ) <span class="lc-sub">(${vocabRows.length} mục — không bỏ sót)</span></div>
            <table class="lc-table">
                <thead>
                    <tr>
                        <th class="lc-th-idx">#</th>
                        <th class="lc-th-word">Từ / Cụm từ</th>
                        <th class="lc-th-ipa">Phiên âm (IPA)</th>
                        <th class="lc-th-cat">Loại từ</th>
                        <th class="lc-th-mean">Nghĩa ngữ cảnh</th>
                        <th class="lc-th-ex">Ví dụ ngữ cảnh</th>
                    </tr>
                </thead>
                <tbody>${rowsHTML}</tbody>
            </table>

            <div class="lc-footer">LinguaContext Pro — Tài liệu xuất tự động · ${dateStr}</div>
        </div>`;
    }

    _styleBlock() {
        return `<style>
            @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
            .lc-pdf-root { font-family: 'Plus Jakarta Sans', 'Segoe UI', Arial, sans-serif; color: #2b231d; font-size: 12.5px; line-height: 1.65; padding: 12px 14px; background: #ffffff; }
            .lc-pdf-root * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .lc-header { position: relative; padding: 10px 0 12px; border-bottom: 2.5px solid #8c5e3c; margin-bottom: 16px; }
            .lc-brandbar { position: absolute; top: -4px; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #8c5e3c, #c08552); }
            .lc-brand-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 4px; }
            .lc-app-name { font-size: 20px; font-weight: 800; color: #8c5e3c; letter-spacing: -.2px; }
            .lc-tagline { font-size: 10px; color: #9a8578; font-weight: 600; }
            .lc-doc-title { font-size: 15.5px; font-weight: 700; color: #4a382c; margin: 8px 0 10px; }
            .lc-meta-bar { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11.5px; color: #7a6a5d; background: #fdfbf7; border: 1px solid #ebdccb; border-radius: 6px; padding: 7px 12px; }
            .lc-meta-bar strong { color: #5c3a21; }
            .lc-section-title { font-size: 13.5px; font-weight: 800; color: #5c3a21; margin: 18px 0 10px; padding-left: 10px; border-left: 4px solid #8c5e3c; display: flex; align-items: center; gap: 8px; }
            .lc-section-vocab { margin-top: 22px; }
            .lc-num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #8c5e3c; color: #fff; border-radius: 50%; font-size: 11px; font-weight: 800; }
            .lc-sub { font-size: 10.5px; font-weight: 600; color: #9a8578; }
            .lc-reading-wrap { border: 1px solid #e8ded3; border-radius: 8px; overflow: hidden; margin-bottom: 12px; }
            .lc-reading-head { display: grid; grid-template-columns: 1fr 1fr; }
            .lc-col-head { padding: 7px 12px; font-size: 11px; font-weight: 800; color: #fff; background: #8c5e3c; letter-spacing: .3px; }
            .lc-col-vi { background: #6b4b2b; }
            .lc-flag { display: inline-block; background: rgba(255,255,255,.22); color: #fff; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 800; margin-right: 4px; }
            .lc-reading-grid { display: grid; grid-template-columns: 1fr 1fr; }
            .lc-col { padding: 12px 14px; font-size: 12.5px; }
            .lc-col-en-body { border-right: 1px solid #e8ded3; background: #fffdf9; }
            .lc-col-vi-body { background: #fcfaf7; }
            .lc-col p { margin: 0 0 10px; text-align: justify; line-height: 1.7; }
            .lc-col p:last-child { margin-bottom: 0; }
            mark { background-color: #fef08a !important; font-weight: 700; color: #0f172a !important; padding: 2px 6px; border-radius: 4px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .lc-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 4px; background: #ffffff; }
            .lc-table th { background-color: #8c5e3c !important; color: #ffffff !important; padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 700; border: 1px solid #72492c; text-transform: uppercase; letter-spacing: .3px; }
            .lc-table td { border: 1px solid #e8ded3; padding: 8px 10px; vertical-align: top; }
            .lc-table tr:nth-child(even) td { background-color: #faf6f0 !important; }
            .lc-th-idx { width: 32px; text-align: center; }
            .lc-th-word { width: 140px; }
            .lc-th-ipa { width: 110px; }
            .lc-th-cat { width: 95px; }
            .lc-th-mean { width: 160px; }
            .lc-td-idx { text-align: center; font-weight: 800; color: #8c7665; }
            .lc-td-word { font-weight: 700; color: #221a14; }
            .lc-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: middle; border: 1px solid rgba(0,0,0,.18); }
            .lc-td-ipa { font-family: 'Plus Jakarta Sans', 'Inter', 'Segoe UI', sans-serif; color: #2563eb; font-weight: 600; letter-spacing: .2px; }
            .lc-badge { display: inline-block; background: #f3eae0; color: #6b472b; padding: 2px 7px; border-radius: 10px; font-size: 10px; font-weight: 700; }
            .lc-td-mean { font-weight: 700; color: #78350f; }
            .lc-td-ex { font-style: italic; color: #4b5563; font-size: 11px; }
            .lc-empty { text-align: center; padding: 16px; color: #9a8578; font-style: italic; }
            .lc-footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e8ded3; font-size: 9.5px; color: #b0a094; text-align: center; }
        </style>`;
    }

    _buildVocabRowsHTML(rows) {
        if (!rows || rows.length === 0) {
            return `<tr><td colspan="6" class="lc-empty">Chưa có từ vựng nào được ghi nhận.</td></tr>`;
        }
        return rows.map((row, idx) => {
            const rawIPA = (row.ipa || '').trim();
            const formattedIPA = rawIPA ? (rawIPA.startsWith('/') ? rawIPA : `/${rawIPA}/`) : '-';
            const color = row.color || '#fef08a';
            return `<tr class="lc-table-row">
                <td class="lc-td-idx">${idx + 1}</td>
                <td class="lc-td-word"><span class="lc-dot" style="background:${this._escapeHTML(color)}"></span>${this._escapeHTML(row.word || '')}</td>
                <td class="lc-td-ipa">${this._escapeHTML(formattedIPA)}</td>
                <td><span class="lc-badge">${this._escapeHTML(row.category || 'Từ vựng')}</span></td>
                <td class="lc-td-mean">${this._escapeHTML(row.contextMeaning || '')}</td>
                <td class="lc-td-ex">${this._escapeHTML(row.example || '')}</td>
            </tr>`;
        }).join('');
    }

    _buildTranslationHTML(vietnameseText = '', vietnameseHTML = '') {
        if (vietnameseHTML && vietnameseHTML.trim()) {
            const tmp = document.createElement('div');
            tmp.innerHTML = vietnameseHTML;
            tmp.querySelectorAll('script, style, button').forEach(el => el.remove());
            const blocks = tmp.querySelectorAll('p, div.paragraph-block');
            if (blocks.length) {
                return Array.from(blocks).map(b => `<p>${this._escapeHTML(b.innerText || b.textContent || '')}</p>`).join('');
            }
            const text = (tmp.innerText || tmp.textContent || '').trim();
            if (text) {
                return text.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${this._escapeHTML(p)}</p>`).join('');
            }
        }
        if (!vietnameseText) return `<p style="color:#9a8578; font-style:italic;">(Chưa có bản dịch)</p>`;
        return vietnameseText.split(/\n\s*\n/).filter(Boolean)
            .map(p => `<p>${this._escapeHTML(p).replace(/\n/g, '<br>')}</p>`).join('');
    }

    _buildHighlightedParagraphHTML(englishText = '', englishHTML = '', highlights = []) {
        if (englishHTML && (englishHTML.includes('<mark') || englishHTML.includes('highlight-mark'))) {
            const tmp = document.createElement('div');
            tmp.innerHTML = englishHTML;
            tmp.querySelectorAll('mark').forEach(m => {
                const bg = (m.style && m.style.backgroundColor) || m.getAttribute('data-color') || '#fef08a';
                m.removeAttribute('class');
                m.removeAttribute('id');
                m.setAttribute('style', `background-color:${bg} !important; font-weight:700; color:#0f172a !important; padding:2px 6px; border-radius:4px; display:inline-block; margin:1px 0;`);
            });
            tmp.querySelectorAll('script, style, button').forEach(el => el.remove());
            const blocks = tmp.querySelectorAll('p, div.paragraph-block');
            if (blocks.length) {
                return Array.from(blocks).map(b => `<p>${b.innerHTML}</p>`).join('');
            }
            return `<p>${tmp.innerHTML}</p>`;
        }

        if (!englishText) return `<p style="color:#9a8578; font-style:italic;">(Chưa có văn bản)</p>`;

        let escaped = this._escapeHTML(englishText);
        const sorted = [...(highlights || [])]
            .filter(h => (h.text || h.word))
            .sort((a, b) => (b.text || b.word || '').length - (a.text || a.word || '').length);

        for (const h of sorted) {
            const word = (h.text || h.word || '').trim();
            if (!word) continue;
            const color = h.color || '#fef08a';
            const regex = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi');
            escaped = escaped.replace(regex, `<mark style="background-color:${color} !important; font-weight:700; color:#0f172a !important; padding:2px 6px; border-radius:4px;">$1</mark>`);
        }

        return escaped.split(/\n\s*\n/).filter(Boolean)
            .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    }

    _dedupeHighlightsByText(highlights = []) {
        const seen = new Set();
        const result = [];
        for (const h of (highlights || [])) {
            const key = ((h && h.text) || (h && h.word) || '').toString().toLowerCase().trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            result.push(h);
        }
        return result;
    }

    _buildVocabRows(highlights = [], vocabList = []) {
        if ((!highlights || highlights.length === 0) && (!vocabList || vocabList.length === 0)) return [];
        const safeWord = (w) => (w || '').toString().trim();
        const seen = new Set();
        const result = [];

        const uniqueHighlights = this._dedupeHighlightsByText(highlights || []);
        for (const h of uniqueHighlights) {
            const word = safeWord(h.text || h.word);
            if (!word || seen.has(word.toLowerCase())) continue;
            seen.add(word.toLowerCase());

            const matchedVocab = (vocabList || []).find(v => {
                const vw = safeWord(v.original || v.term || v.text || v.word);
                return vw && (vw.toLowerCase() === word.toLowerCase() || word.toLowerCase().includes(vw.toLowerCase()) || vw.toLowerCase().includes(word.toLowerCase()));
            });
            const isPhrase = word.includes(' ') || word.includes('-');
            const pos = (window.dictionaryDB && window.dictionaryDB.getPOS) ? window.dictionaryDB.getPOS(word) : 'n.';
            const ipa = matchedVocab?.ipa || ((window.dictionaryDB && window.dictionaryDB.getIPA) ? window.dictionaryDB.getIPA(word) : '');
            const meaning = matchedVocab?.contextMeaning || matchedVocab?.translatedTermInVN || matchedVocab?.meaning || ((window.dictionaryDB && window.dictionaryDB.getMeaning) ? window.dictionaryDB.getMeaning(word) : '');

            result.push({
                word: word,
                color: h.color || '#fef08a',
                category: matchedVocab?.category || (isPhrase ? 'Cụm từ' : pos),
                ipa: ipa,
                contextMeaning: meaning,
                example: matchedVocab?.example || matchedVocab?.exampleEn || `Context for "${word}".`
            });
        }

        for (const v of (vocabList || [])) {
            const word = safeWord(v.original || v.term || v.text || v.word);
            if (!word || seen.has(word.toLowerCase())) continue;
            seen.add(word.toLowerCase());

            const isPhrase = word.includes(' ') || word.includes('-');
            const pos = (window.dictionaryDB && window.dictionaryDB.getPOS) ? window.dictionaryDB.getPOS(word) : 'n.';
            const ipa = v.ipa || ((window.dictionaryDB && window.dictionaryDB.getIPA) ? window.dictionaryDB.getIPA(word) : '');
            const meaning = v.contextMeaning || v.translatedTermInVN || v.meaning || ((window.dictionaryDB && window.dictionaryDB.getMeaning) ? window.dictionaryDB.getMeaning(word) : '');

            result.push({
                word: word,
                color: v.color || '#bbf7d0',
                category: v.category || (isPhrase ? 'Cụm từ' : pos),
                ipa: ipa,
                contextMeaning: meaning,
                example: v.example || v.exampleEn || `Context for "${word}".`
            });
        }

        return result.map((item, idx) => ({ index: idx + 1, ...item }));
    }

    _sanitizeFilename(title) {
        if (!title) return 'LinguaContext_Vocab.pdf';
        let clean = (title || '').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .trim();
        if (!clean) clean = 'LinguaContext_Summary';
        return `${clean}_Vocab.pdf`;
    }

    _escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ===================================================================
    // FALLBACK PRINT WINDOW (Used if html2pdf fails or popups are blocked)
    // ===================================================================
    _exportWithHTMLFallback(data = {}) {
        const {
            documentTitle = 'Tài Liệu Dịch & Từ Vựng Ngữ Cảnh',
            englishText = '',
            vietnameseText = '',
            englishHTML = '',
            vietnameseHTML = '',
            highlights = [],
            vocabList = []
        } = data;

        const vocabRows = this._buildVocabRows(highlights, vocabList);
        const innerHTML = this._buildDocumentHTML({
            documentTitle,
            englishText,
            vietnameseText,
            englishHTML,
            vietnameseHTML,
            highlights,
            vocabRows
        });

        const fullHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>${this._escapeHTML(documentTitle)}</title>
    <style>
        @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 20px; background: #ffffff;">
    <div class="no-print" style="margin-bottom: 16px; padding: 14px; background: #fffbe6; border: 1.5px solid #ffe58f; border-radius: 8px; font-size: 13px; font-family: sans-serif;">
        💡 <strong>Hướng dẫn xuất file PDF đẹp chuẩn:</strong>
        <br>Tại ô <strong>Máy in (Destination)</strong> ➔ Chọn <strong>"Lưu dưới dạng PDF" (Save as PDF)</strong>.
        <br>Tích chọn ô <strong>"Đồ họa nền" (Background graphics)</strong> để hiển thị đầy đủ màu sắc tô đậm.
        <br><button onclick="window.print()" style="margin-top: 8px; padding: 7px 18px; background: #8c5e3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 13px;">🖨️ Lưu Thành File PDF Ngay</button>
    </div>
    ${innerHTML}
    <script>
        setTimeout(function() { window.print(); }, 600);
    <\/script>
</body>
</html>`;

        let printWin = null;
        try {
            printWin = window.open('', '_blank');
        } catch (e) {}

        if (printWin) {
            printWin.document.write(fullHTML);
            printWin.document.close();
            return true;
        } else {
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
            document.body.appendChild(iframe);
            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(fullHTML);
            doc.close();
            setTimeout(() => {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
                setTimeout(() => iframe.remove(), 3500);
            }, 500);
            return true;
        }
    }
}

window.PDFExporter = PDFExporter;
