/**
 * LinguaContext Pro - PDF Exporter (html2pdf pipeline)
 *
 * Renders a beautiful A4 PDF from an HTML template using html2pdf.js (html2canvas
 * + jsPDF under the hood). This guarantees correct Vietnamese diacritics because
 * text is rendered by the browser with real web fonts (Lora / Inter — both have
 * full Vietnamese support) instead of jsPDF's limited built-in encoding.
 *
 * Structure:
 *   SECTION 1 — VĂN BẢN GỐC & BẢN DỊCH (2 cột song song)
 *     - Left  : full English text with every highlight preserved (color + bold).
 *     - Right : Vietnamese translation, paragraph-aligned.
 *   SECTION 2 — BẢNG TỪ VỰNG ĐẦY ĐỦ
 *     - # | Từ/Cụm từ | Phiên âm (IPA) | Loại | Nghĩa ngữ cảnh | Ví dụ
 *     - Ordered by first appearance in the English text, deduplicated.
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
        const html2pdfFn = window.html2pdf || null;

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
            documentTitle, englishText, vietnameseText,
            englishHTML, vietnameseHTML, highlights, vocabRows
        });

        // Build an off-screen container to render from.
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-99999px';
        container.style.top = '0';
        container.style.width = '794px'; // ~ A4 width at 96dpi
        container.style.background = '#ffffff';
        container.innerHTML = html;
        document.body.appendChild(container);

        const filename = this._sanitizeFilename(documentTitle);

        if (!html2pdfFn) {
            // No html2pdf lib — open a print window as a graceful fallback.
            document.body.removeChild(container);
            return this._exportWithHTMLFallback(data);
        }

        try {
            await html2pdfFn()
                .set({
                    margin: [10, 10, 12, 10],
                    filename,
                    image: { type: 'jpeg', quality: 0.98 },
                    html2canvas: {
                        scale: 2,
                        useCORS: true,
                        letterRendering: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.reading-row', '.vocab-card'] }
                })
                .from(container)
                .save();
            return true;
        } finally {
            if (container.parentNode) container.parentNode.removeChild(container);
        }
    }
