/**
 * LinguaContext Pro - PDF Exporter & Live Typography Customizer Engine
 *
 * Provides a live typography customization toolbar directly inside the PDF preview / export window.
 * Allows users to customize Font Family (Lora, Plus Jakarta Sans, Merriweather, Inter, Literata, Playfair Display, Roboto),
 * Font Size (12px, 13px, 14px, 15px, 16px), and Line Height (1.5, 1.75, 2.0) before saving or printing.
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
    // PUBLIC ENTRY POINTS
    // ===================================================================
    async previewPDF(data = {}) {
        return this._openDocumentWindow(data, false);
    }

    async exportToPDF(data = {}) {
        return this._openDocumentWindow(data, true);
    }

    _openDocumentWindow(data = {}, autoPrint = false) {
        const {
            documentTitle = 'Tài Liệu Dịch & Từ Vựng Ngữ Cảnh',
            englishText = '',
            vietnameseText = '',
            englishHTML = '',
            vietnameseHTML = '',
            highlights = [],
            vocabList = [],
            fontFamily = "'Lora', Georgia, serif"
        } = data;

        const cleanTitle = this._sanitizeTitle(documentTitle);
        const vocabRows = this._buildVocabRows(highlights, vocabList);
        const innerHTML = this._buildDocumentHTML({
            documentTitle: cleanTitle,
            englishText,
            vietnameseText,
            englishHTML,
            vietnameseHTML,
            highlights,
            vocabRows,
            fontFamily
        });

        const filename = this._sanitizeFilename(cleanTitle);

        const fullHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this._escapeHTML(cleanTitle)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;600;700;800&family=Literata:ital,wght@0,400;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Roboto:wght@400;500;700&family=Work+Sans:wght@400;600;700&display=swap');
        @media print {
            body { padding: 0 !important; margin: 0 !important; background: #ffffff !important; }
            .no-print { display: none !important; }
            .lc-pdf-wrapper { padding: 0 !important; box-shadow: none !important; border-radius: 0 !important; max-width: 100% !important; border: none !important; }
            @page { margin: 12mm; }
        }
    </style>
</head>
<body style="margin: 0; padding: 24px; background: #f8fafc; color: #1e293b; font-family: ${fontFamily};">
    <!-- LIVE TYPOGRAPHY & EXPORT CONTROL BAR -->
    <div class="no-print" style="max-width: 860px; margin: 0 auto 20px auto; padding: 16px 20px; background: #fffbe6; border: 1.5px solid #ffe58f; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 12px; border-bottom: 1px solid #fed7aa; padding-bottom: 10px;">
            <div>
                <div style="font-size: 15.5px; font-weight: 800; color: #8c5e3c;">🎨 Tùy Chỉnh Phông Chữ &amp; Định Dạng File PDF</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Thay đổi kiểu chữ, cỡ chữ và giãn dòng theo ý muốn trước khi Lưu / In.</div>
            </div>
            <div style="display: flex; gap: 10px;">
                <button onclick="downloadDirectly()" style="padding: 9px 18px; background: #2563eb; color: #ffffff; border: none; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 13px; box-shadow: 0 3px 10px rgba(37,99,235,0.25); display: flex; align-items: center; gap: 6px;">
                    ⬇️ Tải PDF Về Máy
                </button>
                <button onclick="window.print()" style="padding: 9px 18px; background: #8c5e3c; color: #ffffff; border: none; border-radius: 8px; cursor: pointer; font-weight: 800; font-size: 13px; box-shadow: 0 3px 10px rgba(140,94,60,0.25); display: flex; align-items: center; gap: 6px;">
                    🖨️ In / Lưu PDF
                </button>
            </div>
        </div>

        <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
            <!-- Font Selector -->
            <div style="display: flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
                <span style="font-size: 12px; font-weight: 700; color: #8c5e3c;">🔤 Phông chữ:</span>
                <select id="pdfFontSelect" onchange="changePDFFont(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #94a3b8; font-weight: 700; color: #1e293b; background: #ffffff; cursor: pointer; font-size: 12.5px; outline: none;">
                    <option value="'Lora', Georgia, serif" selected>Lora (Serif thanh lịch)</option>
                    <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta Sans (Sans hiện đại)</option>
                    <option value="'Merriweather', serif">Merriweather (Serif đậm nét)</option>
                    <option value="'Inter', sans-serif">Inter (Sans rõ nét)</option>
                    <option value="'Literata', serif">Literata (Serif tinh tế)</option>
                    <option value="'Playfair Display', serif">Playfair Display (Serif nghệ thuật)</option>
                    <option value="'Roboto', sans-serif">Roboto (Sans cổ điển)</option>
                    <option value="'Work Sans', sans-serif">Work Sans (Sans gọn gàng)</option>
                </select>
            </div>

            <!-- Font Size Selector -->
            <div style="display: flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
                <span style="font-size: 12px; font-weight: 700; color: #8c5e3c;">📏 Cỡ chữ:</span>
                <select id="pdfFontSizeSelect" onchange="changePDFFontSize(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #94a3b8; font-weight: 700; color: #1e293b; background: #ffffff; cursor: pointer; font-size: 12.5px; outline: none;">
                    <option value="12px">12px (Nhỏ gọn)</option>
                    <option value="13px" selected>13px (Chuẩn vừa vặn)</option>
                    <option value="14px">14px (Vừa phải)</option>
                    <option value="15px">15px (Lớn rõ)</option>
                    <option value="16px">16px (Rất lớn)</option>
                </select>
            </div>

            <!-- Line Height Selector -->
            <div style="display: flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
                <span style="font-size: 12px; font-weight: 700; color: #8c5e3c;">↕️ Giãn dòng:</span>
                <select id="pdfLineHeightSelect" onchange="changePDFLineHeight(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #94a3b8; font-weight: 700; color: #1e293b; background: #ffffff; cursor: pointer; font-size: 12.5px; outline: none;">
                    <option value="1.5">1.5 (Gọn gàng)</option>
                    <option value="1.75" selected>1.75 (Thoáng mắt)</option>
                    <option value="2.0">2.0 (Rộng rãi)</option>
                </select>
            </div>
        </div>
    </div>

    <!-- DOCUMENT A4 CANVAS -->
    <div id="pdfCaptureTarget" class="lc-pdf-wrapper" style="max-width: 860px; margin: 0 auto; background: #ffffff; padding: 24px 28px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        ${innerHTML}
    </div>

    <script>
        function changePDFFont(fontFamily) {
            var root = document.querySelector('.lc-pdf-root');
            if (root) {
                root.style.fontFamily = fontFamily;
            }
            document.body.style.fontFamily = fontFamily;
        }
        function changePDFFontSize(fontSize) {
            var cols = document.querySelectorAll('.lc-col');
            cols.forEach(function(c) { c.style.fontSize = fontSize; });
        }
        function changePDFLineHeight(lh) {
            var cols = document.querySelectorAll('.lc-col');
            cols.forEach(function(c) { c.style.lineHeight = lh; });
        }
        function downloadDirectly() {
            if (window.html2pdf) {
                var element = document.getElementById('pdfCaptureTarget');
                var opt = {
                    margin: [10, 10, 12, 10],
                    filename: '${filename}',
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                };
                window.html2pdf().set(opt).from(element).save();
            } else {
                window.print();
            }
        }
        ${autoPrint ? "setTimeout(function() { window.print(); }, 800);" : ""}
    <\/script>
</body>
</html>`;

        let win = null;
        try {
            win = window.open('', '_blank');
        } catch (e) {}

        if (win) {
            win.document.write(fullHTML);
            win.document.close();
            return true;
        }

        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; z-index:-9999;';
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(fullHTML);
        doc.close();
        setTimeout(() => {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
            setTimeout(() => iframe.remove(), 4000);
        }, 600);

        return true;
    }

    // ===================================================================
    // HTML TEMPLATE BUILDER
    // ===================================================================
    _buildDocumentHTML({ documentTitle, englishText, vietnameseText, englishHTML, vietnameseHTML, highlights, vocabRows, fontFamily }) {
        const dateStr = new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });
        const wordCount = (englishText || '').trim().split(/\s+/).filter(Boolean).length;
        const enHTML = this._buildHighlightedParagraphHTML(englishText, englishHTML, highlights);
        const vnHTML = this._buildTranslationHTML(vietnameseText, vietnameseHTML);
        const rowsHTML = this._buildVocabRowsHTML(vocabRows);
        const font = fontFamily || "'Lora', Georgia, serif";
        const title = this._sanitizeTitle(documentTitle);

        return `
        <div class="lc-pdf-root" style="font-family: ${font};">
            ${this._styleBlock(font)}
            <div class="lc-header">
                <div class="lc-brandbar"></div>
                <div class="lc-brand-row">
                    <div class="lc-app-name">📖 LinguaContext Pro</div>
                    <div class="lc-tagline">Dịch Ngữ Cảnh · Giữ Tô Màu · Sẵn Sàng In</div>
                </div>
                <div class="lc-doc-title">${this._escapeHTML(title)}</div>
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

    _styleBlock(fontFamily) {
        const font = fontFamily || "'Lora', Georgia, serif";
        return `<style>
            @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;600;700;800&family=Literata:ital,wght@0,400;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Roboto:wght@400;500;700&family=Work+Sans:wght@400;600;700&display=swap');
            .lc-pdf-root { font-family: ${font}; color: #2b231d; font-size: 13px; line-height: 1.75; padding: 4px 6px; background: #ffffff; }
            .lc-pdf-root * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .lc-header { position: relative; padding: 10px 0 12px; border-bottom: 2.5px solid #8c5e3c; margin-bottom: 16px; }
            .lc-brandbar { position: absolute; top: -4px; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #8c5e3c, #c08552); }
            .lc-brand-row { display: flex; justify-content: space-between; align-items: baseline; margin-top: 4px; }
            .lc-app-name { font-size: 20px; font-weight: 800; color: #8c5e3c; letter-spacing: -.2px; }
            .lc-tagline { font-size: 10px; color: #9a8578; font-weight: 600; }
            .lc-doc-title { font-size: 16px; font-weight: 700; color: #4a382c; margin: 8px 0 10px; }
            .lc-meta-bar { display: flex; gap: 18px; flex-wrap: wrap; font-size: 11.5px; color: #7a6a5d; background: #fdfbf7; border: 1px solid #ebdccb; border-radius: 6px; padding: 7px 12px; }
            .lc-meta-bar strong { color: #5c3a21; }
            .lc-section-title { font-size: 14px; font-weight: 800; color: #5c3a21; margin: 20px 0 12px; padding-left: 10px; border-left: 4px solid #8c5e3c; display: flex; align-items: center; gap: 8px; }
            .lc-section-vocab { margin-top: 24px; }
            .lc-num { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #8c5e3c; color: #fff; border-radius: 50%; font-size: 11px; font-weight: 800; }
            .lc-sub { font-size: 11px; font-weight: 600; color: #9a8578; }
            .lc-reading-wrap { border: 1px solid #e8ded3; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
            .lc-reading-head { display: grid; grid-template-columns: 1fr 1fr; }
            .lc-col-head { padding: 8px 14px; font-size: 11.5px; font-weight: 800; color: #fff; background: #8c5e3c; letter-spacing: .3px; }
            .lc-col-vi { background: #6b4b2b; }
            .lc-flag { display: inline-block; background: rgba(255,255,255,.22); color: #fff; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 800; margin-right: 4px; }
            .lc-reading-grid { display: grid; grid-template-columns: 1fr 1fr; }
            .lc-col { padding: 14px 16px; font-size: 13px; line-height: 1.75; }
            .lc-col-en-body { border-right: 1px solid #e8ded3; background: #fffdf9; }
            .lc-col-vi-body { background: #fcfaf7; }
            .lc-col p { margin: 0 0 12px; text-align: justify; }
            .lc-col p:last-child { margin-bottom: 0; }
            mark { background-color: #fef08a !important; font-weight: 700; color: #0f172a !important; padding: 2px 6px; border-radius: 4px; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            .lc-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-top: 4px; background: #ffffff; }
            .lc-table th { background-color: #8c5e3c !important; color: #ffffff !important; padding: 9px 10px; text-align: left; font-size: 11px; font-weight: 700; border: 1px solid #72492c; text-transform: uppercase; letter-spacing: .3px; }
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
            .lc-td-ipa { font-family: 'Plus Jakarta Sans', 'Inter', sans-serif; color: #2563eb; font-weight: 600; letter-spacing: .2px; }
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

    _sanitizeTitle(title) {
        if (!title) return 'Tài Liệu Dịch & Từ Vựng Ngữ Cảnh';
        return String(title).replace(/^#+\s*/g, '').trim();
    }

    _sanitizeFilename(title) {
        if (!title) return 'LinguaContext_Vocab.pdf';
        let clean = (title || '').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .replace(/^#+\s*/g, '')
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
}

window.PDFExporter = PDFExporter;
