/**
 * LinguaContext Pro - PDF Exporter & Live Typography Customizer Engine
 *
 * Uses UTF-8 Blob URL instantiation AND in-page modal fallback for 100% cross-browser
 * fidelity across Microsoft Edge, Google Chrome, Mozilla Firefox, and Safari.
 * Renders pristine A4 PDF documents with synchronized side-by-side paragraph alignment,
 * full color highlight preservation and bold formatting for BOTH English and translated Vietnamese terms,
 * clean titles (no ### markdown artifacts), and an interactive font & typography toolbar.
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
            vocabList,
            fontFamily
        });

        const filename = this._sanitizeFilename(cleanTitle);
        const fullHTML = this._buildFullStandalonePageHTML(cleanTitle, innerHTML, fontFamily, filename, autoPrint);

        // 1. Always Render into In-Page Preview Modal as instant fallback for Edge/Popup blockers
        const modalEl = document.getElementById('pdfPreviewModal');
        const containerEl = document.getElementById('pdfModalContainer');
        const closeBtn = document.getElementById('btnClosePDFPreviewModal');

        if (modalEl && containerEl) {
            containerEl.innerHTML = `
                <div class="no-print" style="margin-bottom: 16px; padding: 12px 16px; background: #fffbe6; border: 1.5px solid #ffe58f; border-radius: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-family: 'Plus Jakarta Sans', sans-serif;">
                    <div style="font-size: 13.5px; font-weight: 800; color: #8c5e3c;">🎨 Tùy Chỉnh Phông Chữ &amp; In Nhanh:</div>
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <span style="font-size: 12px; font-weight: 700; color: #8c5e3c;">🔤 Phông chữ:</span>
                        <select onchange="document.querySelector('.lc-pdf-root').style.fontFamily = this.value" style="padding: 5px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-weight: 700; font-size: 12.5px; outline: none; background: #fff;">
                            <option value="'Lora', Georgia, serif" selected>Lora (Serif thanh lịch)</option>
                            <option value="'Plus Jakarta Sans', sans-serif">Plus Jakarta Sans</option>
                            <option value="'Merriweather', serif">Merriweather</option>
                            <option value="'Inter', sans-serif">Inter</option>
                            <option value="'Literata', serif">Literata</option>
                            <option value="'Playfair Display', serif">Playfair Display</option>
                        </select>
                        <button onclick="window.print()" style="padding: 7px 16px; background: #8c5e3c; color: #fff; border: none; border-radius: 6px; font-weight: 800; font-size: 13px; cursor: pointer; box-shadow: 0 2px 8px rgba(140,94,60,0.25);">🖨️ In / Lưu PDF</button>
                    </div>
                </div>
                <div style="background: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.05);">
                    ${innerHTML}
                </div>
            `;
            modalEl.style.display = 'flex';
            if (closeBtn) {
                closeBtn.onclick = () => { modalEl.style.display = 'none'; };
            }
            modalEl.onclick = (e) => { if (e.target === modalEl) modalEl.style.display = 'none'; };
        }

        // 2. Open UTF-8 Blob URL Tab
        let win = null;
        try {
            const blob = new Blob([fullHTML], { type: 'text/html;charset=utf-8' });
            const blobURL = URL.createObjectURL(blob);
            win = window.open(blobURL, '_blank');
        } catch (e) {}

        if (win) {
            setTimeout(() => {
                try { win.focus(); } catch (e) {}
            }, 300);
        }

        return true;
    }

    _buildFullStandalonePageHTML(cleanTitle, innerHTML, fontFamily, filename, autoPrint) {
        return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this._escapeHTML(cleanTitle)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;600;700;800&family=Literata:ital,wght@0,400;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Roboto:wght@400;500;700&family=Work+Sans:wght@400;600;700&display=swap">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
    <style>
        @media print {
            body { padding: 0 !important; margin: 0 !important; background: #ffffff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            .no-print { display: none !important; }
            .lc-pdf-wrapper { padding: 0 !important; box-shadow: none !important; border-radius: 0 !important; max-width: 100% !important; border: none !important; }
            @page { margin: 12mm; }
            mark {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
        }
    </style>
</head>
<body style="margin: 0; padding: 24px; background: #f8fafc; color: #1e293b; font-family: ${fontFamily}; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important;">
    <!-- LIVE TYPOGRAPHY & EXPORT CONTROL BAR -->
    <div class="no-print" style="max-width: 860px; margin: 0 auto 20px auto; padding: 16px 20px; background: #fffbe6; border: 1.5px solid #ffe58f; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-bottom: 12px; border-bottom: 1px solid #fed7aa; padding-bottom: 10px;">
            <div>
                <div style="font-size: 15.5px; font-weight: 800; color: #8c5e3c;">🎨 Tùy Chỉnh Phông Chữ &amp; Định Dạng File PDF</div>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Thay đổi kiểu chữ, cỡ chữ và giãn dòng cho vừa mắt trước khi In / Lưu.</div>
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
                    <option value="13.5px" selected>13.5px (Chuẩn vừa vặn)</option>
                    <option value="14px">14px (Vừa phải)</option>
                    <option value="15px">15px (Lớn rõ)</option>
                    <option value="16px">16px (Rất lớn)</option>
                </select>
            </div>

            <!-- Line Height Selector -->
            <div style="display: flex; align-items: center; gap: 6px; background: #ffffff; padding: 6px 12px; border-radius: 8px; border: 1px solid #cbd5e1;">
                <span style="font-size: 12px; font-weight: 700; color: #8c5e3c;">↕️ Giãn dòng:</span>
                <select id="pdfLineHeightSelect" onchange="changePDFLineHeight(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid #94a3b8; font-weight: 700; color: #1e293b; background: #ffffff; cursor: pointer; font-size: 12.5px; outline: none;">
                    <option value="1.6">1.6 (Gọn gàng)</option>
                    <option value="2.1" selected>2.1 (Thoáng mắt Rõ ràng)</option>
                    <option value="2.4">2.4 (Rộng rãi)</option>
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
            var cols = document.querySelectorAll('.lc-reading-p-row td p');
            cols.forEach(function(c) { c.style.fontSize = fontSize; });
        }
        function changePDFLineHeight(lh) {
            var ps = document.querySelectorAll('.lc-reading-p-row td p');
            ps.forEach(function(p) { p.style.lineHeight = lh; });
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
    }

    // ===================================================================
    // HTML TEMPLATE BUILDER
    // ===================================================================
    _buildDocumentHTML({ documentTitle, englishText, vietnameseText, englishHTML, vietnameseHTML, highlights, vocabRows, vocabList, fontFamily }) {
        const dateStr = new Date().toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });
        const wordCount = (englishText || '').trim().split(/\s+/).filter(Boolean).length;
        const font = fontFamily || "'Lora', Georgia, serif";
        const title = this._sanitizeTitle(documentTitle);
        const readingRows = this._buildReadingTableRows(englishText, englishHTML, vietnameseText, vietnameseHTML, highlights, vocabRows, vocabList);
        const vocabRowsHTML = this._buildVocabRowsHTML(vocabRows);

        return `
        <div class="lc-pdf-root" style="font-family: ${font}; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important;">
            ${this._styleBlock(font)}
            <div class="lc-header">
                <div class="lc-brandbar"></div>
                <div class="lc-brand-row">
                    <div class="lc-app-name">📖 LinguaContext Pro</div>
                    <div class="lc-tagline">Dịch Ngữ Cảnh · Giữ Tô Màu · Song Ngữ Đồng Bộ</div>
                </div>
                <div class="lc-doc-title">${this._escapeHTML(title)}</div>
                <div class="lc-meta-bar">
                    <span>Ngày tạo: <strong>${dateStr}</strong></span>
                    <span>Tổng số từ: <strong>${wordCount.toLocaleString('vi-VN')} từ</strong></span>
                    <span>Từ vựng: <strong>${vocabRows.length} mục đầy đủ</strong></span>
                </div>
            </div>

            <div class="lc-section-title"><span class="lc-num">1</span> VĂN BẢN ĐỌC &amp; TỪ VỰNG TÔ ĐẬM <span class="lc-sub">(Tô màu ngữ cảnh 2 bên — Đồng bộ từng đoạn)</span></div>
            <table class="lc-reading-table">
                <thead>
                    <tr>
                        <th class="lc-col-head lc-col-en"><span class="lc-flag">EN</span> TIẾNG ANH (Tô màu ngữ cảnh)</th>
                        <th class="lc-col-head lc-col-vi"><span class="lc-flag">VI</span> TIẾNG VIỆT (Đối chiếu tô màu)</th>
                    </tr>
                </thead>
                <tbody>
                    ${readingRows}
                </tbody>
            </table>

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
                <tbody>${vocabRowsHTML}</tbody>
            </table>

            <div class="lc-footer">LinguaContext Pro — Tài liệu xuất tự động · ${dateStr}</div>
        </div>`;
    }

    _styleBlock(fontFamily) {
        const font = fontFamily || "'Lora', Georgia, serif";
        return `<style>
            @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;600;700;800&family=Literata:ital,wght@0,400;0,600;0,700;1,400&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Roboto:wght@400;500;700&family=Work+Sans:wght@400;600;700&display=swap');
            .lc-pdf-root { font-family: ${font}; color: #2b231d; font-size: 13.5px; line-height: 2.1; padding: 4px 6px; background: #ffffff; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
            .lc-pdf-root * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
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

            /* SIDE-BY-SIDE SYNCHRONIZED PARAGRAPH TABLE */
            .lc-reading-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; border: 1px solid #e8ded3; border-radius: 8px; overflow: hidden; table-layout: fixed; }
            .lc-reading-table th { padding: 9px 14px; font-size: 11.5px; font-weight: 800; color: #fff; background: #8c5e3c; letter-spacing: .3px; text-align: left; width: 50%; }
            .lc-col-vi { background: #6b4b2b !important; }
            .lc-flag { display: inline-block; background: rgba(255,255,255,.22); color: #fff; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 800; margin-right: 4px; }
            .lc-reading-p-row td { border-bottom: 1px solid #e8ded3; vertical-align: top; padding: 16px 18px; font-size: 13.5px; line-height: 2.1; width: 50%; word-spacing: 3px; letter-spacing: 0.35px; -webkit-font-smoothing: antialiased; }
            .lc-reading-p-row:last-child td { border-bottom: none; }
            .lc-col-en-body { border-right: 1px solid #e8ded3; background: #fffdf9; }
            .lc-col-vi-body { background: #fcfaf7; }
            .lc-col-vi-body p, .lc-col-en-body p { margin: 0 0 12px 0 !important; line-height: 2.1 !important; text-align: justify !important; word-spacing: 3px !important; letter-spacing: 0.35px !important; font-size: 13.5px !important; -webkit-font-smoothing: antialiased !important; }
            mark { background: var(--mark-bg, #fef08a) !important; background-color: var(--mark-bg, #fef08a) !important; font-weight: 800 !important; color: #0f172a !important; padding: 3px 8px !important; border-radius: 5px !important; display: inline-block !important; margin: 2px 4px !important; box-shadow: 0 1px 3px rgba(0,0,0,0.12) !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }

            /* VOCAB SUMMARY TABLE */
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

    _getVnTranslationForEnTerm(enTerm, vocabRows = [], vocabList = []) {
        const term = String(enTerm || '').trim().toLowerCase().replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC');
        if (!term) return '';

        // 1. Check vocabRows
        const matchRow = (vocabRows || []).find(r => (r.word || '').toLowerCase().replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC') === term);
        if (matchRow && matchRow.contextMeaning) return matchRow.contextMeaning;

        // 2. Check vocabList
        const matchList = (vocabList || []).find(v => (v.original || v.term || v.text || v.word || '').toLowerCase().replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC') === term);
        if (matchList && (matchList.contextMeaning || matchList.translatedTermInVN || matchList.meaning)) {
            return matchList.contextMeaning || matchList.translatedTermInVN || matchList.meaning;
        }

        // 3. Comprehensive English to Vietnamese Phrase Map
        const BUILTIN_MAP = {
            'increasingly struggles': 'ngày càng đấu tranh',
            'cultivate': 'tu luyện',
            'restraint': 'kiềm chế',
            'disconnect': 'ngắt kết nối',
            'question': 'đặt câu hỏi',
            'incessant demand': 'không ngừng',
            'attention': 'được chú ý',
            'ultimately prove': 'cuối cùng',
            'valuable': 'có giá trị',
            'permanently connected': 'kết nối lâu dài',
            'genuine progress': 'tiến bộ thực sự',
            'accumulation': 'sự tích lũy',
            'technological capabilities': 'năng lực công nghệ',
            'capacity': 'khả năng',
            'ensure': 'đảm bảo',
            'those capabilities': 'những khả năng đó',
            'humanity rather': 'nhân loại',
            'quietly diminishing': 'âm thầm làm suy giảm',
            'qualities': 'phẩm chất',
            'human history': 'lịch sử loài người',
            'witnessed': 'chứng kiến',
            'profound transformation': 'sự biến đổi sâu sắc',
            'technological innovation': 'đổi mới công nghệ',
            'fundamentally altered': 'thay đổi căn bản',
            'consume information': 'tiêu thụ thông tin',
            'world around': 'thế giới xung quanh',
            'smartphones': 'điện thoại thông minh',
            'artificial intelligence': 'trí tuệ nhân tạo',
            'social media': 'mạng xã hội',
            'instantaneous communication': 'giao tiếp tức thời',
            'undoubtedly brought': 'mang lại',
            'unprecedented levels': 'mức độ chưa từng có',
            'apparent progress': 'sự tiến bộ',
            'very technologies': 'công nghệ',
            'social fragmentation': 'phân mảnh xã hội',
            'central paradox': 'nghịch lý trung tâm',
            'technological progress': 'tiến bộ công nghệ',
            'human autonomy': 'quyền tự chủ',
            'simultaneously undermine': 'làm suy yếu',
            'conspicuous manifestations': 'biểu hiện dễ thấy nhất',
            'paradox': 'nghịch lý',
            'people interact': 'mọi người tương tác',
            'nevertheless': 'tuy nhiên',
            'simplistic': 'đơn giản',
            'technological advancement': 'tiến bộ công nghệ',
            'inherently detrimental': 'gây hại',
            'conclusion would': 'kết luận',
            'extraordinary benefits': 'lợi ích phi thường',
            'scientific discovery': 'khám phá khoa học',
            'diagnostic accuracy': 'chẩn đoán chính xác',
            'human ingenuity': 'sự khéo léo',
            'digital education': 'giáo dục kỹ thuật số',
            'provide access': 'cung cấp tiếp cận',
            'otherwise lack': 'thiếu',
            'also played': 'đóng vai trò',
            'humanitarian efforts': 'nỗ lực nhân đạo',
            'rapid coordination': 'phối hợp nhanh',
            'natural disasters': 'thảm họa thiên nhiên'
        };

        if (BUILTIN_MAP[term]) return BUILTIN_MAP[term];

        // 4. Try word-by-word dictionaryDB lookup
        if (window.dictionaryDB && window.dictionaryDB.getMeaning) {
            const m = window.dictionaryDB.getMeaning(term);
            if (m) return m;
        }

        return '';
    }

    _buildReadingTableRows(englishText = '', englishHTML = '', vietnameseText = '', vietnameseHTML = '', highlights = [], vocabRows = [], vocabList = []) {
        const cleanVnSpace = (str) => String(str || '').replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC');

        // 1. Prepare English paragraphs
        let enParas = [];
        if (englishHTML && (englishHTML.includes('<mark') || englishHTML.includes('highlight-mark'))) {
            const tmp = document.createElement('div');
            tmp.innerHTML = englishHTML;
            tmp.querySelectorAll('mark').forEach(m => {
                const bg = (m.style && m.style.backgroundColor) || m.getAttribute('data-color') || '#fef08a';
                m.removeAttribute('class');
                m.removeAttribute('id');
                m.setAttribute('style', `background:${bg} !important; background-color:${bg} !important; font-weight:800 !important; color:#0f172a !important; padding:3px 8px !important; border-radius:5px !important; display:inline-block !important; margin:2px 4px !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important;`);
            });
            tmp.querySelectorAll('script, style, button').forEach(el => el.remove());
            const blocks = tmp.querySelectorAll('p, div.paragraph-block');
            if (blocks.length) {
                enParas = Array.from(blocks).map(b => b.innerHTML.replace(/^#+\s*/g, ''));
            } else {
                enParas = [tmp.innerHTML.replace(/^#+\s*/g, '')];
            }
        } else {
            const cleanEn = (englishText || '').replace(/^#+\s*/gm, '');
            enParas = cleanEn.split(/\n\s*\n/).filter(Boolean).map(p => {
                let pText = cleanVnSpace(p);
                const sorted = [...(highlights || [])]
                    .filter(h => (h.text || h.word))
                    .sort((a, b) => (b.text || b.word || '').length - (a.text || a.word || '').length);
                for (const h of sorted) {
                    const word = cleanVnSpace(h.text || h.word);
                    if (!word) continue;
                    const color = h.color || '#fef08a';
                    const esc = word.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&').replace(/\\\s+/g, '[\\s\\u00A0]+');
                    const regex = new RegExp(`\\b(${esc})\\b`, 'gi');
                    pText = pText.replace(regex, `[[MARK::${color}::$1]]`);
                }
                pText = this._escapeHTML(pText);
                pText = pText.replace(/\[\[MARK::(.*?)::(.*?)\]\]/g, (match, color, inner) => {
                    return `<mark style="background:${color} !important; background-color:${color} !important; font-weight:800 !important; color:#0f172a !important; padding:3px 8px !important; border-radius:5px !important; display:inline-block !important; margin:2px 4px !important; box-shadow:0 1px 3px rgba(0,0,0,0.12) !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important;">${inner}</mark>`;
                });
                return pText;
            });
        }

        // 2. Prepare Vietnamese paragraphs (Keep raw unescaped text for matching)
        let vnParas = [];
        if (vietnameseHTML && (vietnameseHTML.includes('<mark') || vietnameseHTML.includes('highlight-mark'))) {
            const tmp = document.createElement('div');
            tmp.innerHTML = vietnameseHTML;
            tmp.querySelectorAll('mark').forEach(m => {
                const bg = (m.style && m.style.backgroundColor) || m.getAttribute('data-color') || '#fef08a';
                m.removeAttribute('class');
                m.removeAttribute('id');
                m.setAttribute('style', `background:${bg} !important; background-color:${bg} !important; font-weight:800 !important; color:#0f172a !important; padding:3px 8px !important; border-radius:5px !important; display:inline-block !important; margin:2px 4px !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important;`);
            });
            tmp.querySelectorAll('script, style, button').forEach(el => el.remove());
            const blocks = tmp.querySelectorAll('p, div.paragraph-block');
            if (blocks.length) {
                vnParas = Array.from(blocks).map(b => cleanVnSpace(b.innerText || b.textContent || '').replace(/^#+\s*/g, ''));
            } else {
                vnParas = [cleanVnSpace(tmp.innerText || tmp.textContent || '').replace(/^#+\s*/g, '')];
            }
        } else {
            const cleanVn = (vietnameseText || '').replace(/^#+\s*/gm, '');
            vnParas = cleanVn.split(/\n\s*\n/).filter(Boolean).map(p => cleanVnSpace(p));
        }

        // 3. ENRICH VIETNAMESE HIGHLIGHT MATCHING CANDIDATES
        const vnTermMap = [];
        const addVnCandidate = (rawWord, color) => {
            if (!rawWord) return;
            const clean = cleanVnSpace(rawWord).replace(/^#+\s*/g, '');
            if (clean.length < 2) return;
            const parts = clean.split(/[,;\n\/]/).map(s => cleanVnSpace(s)).filter(s => s.length >= 2);
            parts.forEach(part => {
                vnTermMap.push({ term: part, color: color || '#fef08a' });
            });
        };

        (vocabRows || []).forEach(v => {
            const color = v.color || '#fef08a';
            addVnCandidate(v.contextMeaning, color);
            addVnCandidate(v.translatedTermInVN, color);
            addVnCandidate(v.meaning, color);
        });

        (vocabList || []).forEach(v => {
            const color = v.color || '#fef08a';
            addVnCandidate(v.contextMeaning, color);
            addVnCandidate(v.translatedTermInVN, color);
            addVnCandidate(v.meaning, color);
        });

        (highlights || []).forEach(h => {
            const word = cleanVnSpace(h.text || h.word);
            if (!word) return;
            const color = h.color || '#fef08a';

            const vnMeaning = this._getVnTranslationForEnTerm(word, vocabRows, vocabList);
            if (vnMeaning) {
                addVnCandidate(vnMeaning, color);
            }
        });

        // Deduplicate and sort by length descending (longest phrases first)
        const seenVn = new Set();
        const sortedVnItems = [];
        vnTermMap.sort((a, b) => b.term.length - a.term.length);
        for (const item of vnTermMap) {
            const k = item.term.toLowerCase();
            if (!seenVn.has(k)) {
                seenVn.add(k);
                sortedVnItems.push(item);
            }
        }

        // Apply highlights to Vietnamese paragraphs safely using [[MARK::color::text]]
        vnParas = vnParas.map(p => {
            let pText = cleanVnSpace(p);
            for (const item of sortedVnItems) {
                const normT = cleanVnSpace(item.term);
                if (!normT || normT.length < 2) continue;
                const esc = normT.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&').replace(/\\\s+/g, '[\\s\\u00A0]+');
                const regex = new RegExp(`(${esc})`, 'gi');

                pText = pText.split(/(\[\[MARK::.*?:.*?\]\])/g).map(part => {
                    if (part.startsWith('[[MARK::')) return part;
                    return part.replace(regex, `[[MARK::${item.color}::$1]]`);
                }).join('');
            }
            // Escape HTML for remaining unhighlighted text safely
            pText = this._escapeHTML(pText);
            // Replace placeholders back with actual <mark> tags
            pText = pText.replace(/\[\[MARK::(.*?)::(.*?)\]\]/g, (match, color, inner) => {
                return `<mark style="background:${color} !important; background-color:${color} !important; font-weight:800 !important; color:#0f172a !important; padding:3px 8px !important; border-radius:5px !important; display:inline-block !important; margin:2px 4px !important; box-shadow:0 1px 3px rgba(0,0,0,0.12) !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; color-adjust:exact !important;">${inner}</mark>`;
            });
            return pText;
        });

        // 4. Align English and Vietnamese paragraphs into synchronized table rows
        const maxLen = Math.max(enParas.length, vnParas.length);
        if (maxLen === 0) {
            return `<tr>
                <td class="lc-col lc-col-en-body"><p style="color:#9a8578; font-style:italic;">(Chưa có văn bản)</p></td>
                <td class="lc-col lc-col-vi-body"><p style="color:#9a8578; font-style:italic;">(Chưa có bản dịch)</p></td>
            </tr>`;
        }

        let rowsHTML = '';
        for (let i = 0; i < maxLen; i++) {
            const enP = enParas[i] || '';
            const vnP = vnParas[i] || '';
            rowsHTML += `<tr class="lc-reading-p-row">
                <td class="lc-col lc-col-en-body"><p style="margin: 0 0 14px 0 !important; line-height: 2.1 !important; text-align: justify !important; word-spacing: 3px !important; letter-spacing: 0.35px !important; font-size: 13.5px !important;">${enP}</p></td>
                <td class="lc-col lc-col-vi-body"><p style="margin: 0 0 14px 0 !important; line-height: 2.1 !important; text-align: justify !important; word-spacing: 3px !important; letter-spacing: 0.35px !important; font-size: 13.5px !important;">${vnP || '<span style="color:#9a8578; font-style:italic;">(Chưa có bản dịch)</span>'}</p></td>
            </tr>`;
        }

        return rowsHTML;
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

    _dedupeHighlightsByText(highlights = []) {
        const seen = new Set();
        const result = [];
        for (const h of (highlights || [])) {
            const key = ((h && h.text) || (h && h.word) || '').toString().toLowerCase().trim().replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            result.push(h);
        }
        return result;
    }

    _buildVocabRows(highlights = [], vocabList = []) {
        if ((!highlights || highlights.length === 0) && (!vocabList || vocabList.length === 0)) return [];
        const safeWord = (w) => (w || '').toString().trim().replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC');
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
        return String(title).replace(/^#+\s*/g, '').trim().replace(/[\u00A0\u2000-\u200B]/g, ' ').normalize('NFC');
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
