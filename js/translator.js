/**
 * LinguaContext Pro - Advanced AI Translation & Deep Structure Engine
 * Supports both OpenAI ChatGPT API (GPT-4o, GPT-4o-mini, GPT-4-turbo)
 * and Google Gemini API (Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 1.5 Flash).
 * Deep extraction of Nouns, Verbs, Adjectives, Adverbs, Collocations, Phrasal Verbs,
 * Idioms, Adverb+Verb combinations, and Grammar Structures.
 */
class ContextTranslator {
    constructor() {
        this.provider = localStorage.getItem('lingua_ai_provider') || 'gemini'; // 'openai' or 'gemini'
        this.geminiApiKey = localStorage.getItem('lingua_gemini_api_key') || '';
        // Default to the most accurate model (Pro) rather than the fast/cheap one, for best translation quality
        this.geminiModel = localStorage.getItem('lingua_gemini_model') || 'gemini-2.5-pro';

        this.openaiApiKey = localStorage.getItem('lingua_openai_api_key') || '';
        this.openaiModel = localStorage.getItem('lingua_openai_model') || 'gpt-4o';
        this.autoScanEnabled = localStorage.getItem('lingua_auto_scan_ai') !== 'false';

        // Dedicated (separate) API config for the "AI Quét Từ & Cấu Trúc Hay" auto-scan feature
        this.useSeparateScanApi = localStorage.getItem('lingua_use_separate_scan_api') === 'true';
        this.scanProvider = localStorage.getItem('lingua_scan_ai_provider') || 'gemini';
        this.scanGeminiApiKey = localStorage.getItem('lingua_scan_gemini_api_key') || '';
        this.scanGeminiModel = localStorage.getItem('lingua_scan_gemini_model') || 'gemini-2.5-pro';
        this.scanOpenaiApiKey = localStorage.getItem('lingua_scan_openai_api_key') || '';
        this.scanOpenaiModel = localStorage.getItem('lingua_scan_openai_model') || 'gpt-4o';
    }

    /**
     * Resolves the highlight color for an AI vocab item, matching its English "original"
     * back to the highlighted English term. Uses collapse-whitespace + inflection-tolerant
     * matching so "witnessed" still gets the color of the highlighted "witness" (and vice
     * versa). Falls back to yellow only when nothing plausibly matches. This keeps the
     * English highlight color and the Vietnamese highlight color identical.
     */
    _resolveVocabColor(originalTerm, highlights = []) {
        const norm = (s) => (s || '').toString().toLowerCase().trim()
            .replace(/[\u00A0\u2000-\u200B]/g, ' ')
            .replace(/\s+/g, ' ')
            .normalize('NFC');
        const o = norm(originalTerm);
        if (!o) return '#fef08a';
        const exact = highlights.find(h => norm(h.text || h.word) === o);
        if (exact && exact.color) return exact.color;
        const stem = (a, b) => {
            if (a.length < 4 || b.length < 4) return false;
            const shorter = a.length <= b.length ? a : b;
            const longer = a.length <= b.length ? b : a;
            return longer.startsWith(shorter);
        };
        const loose = highlights.find(h => stem(norm(h.text || h.word), o));
        if (loose && loose.color) return loose.color;
        return '#fef08a';
    }

    /**
     * DEDICATED ALIGNMENT PASS (marker-injection, PER-PARAGRAPH).
     *
     * WHY PER-PARAGRAPH: asking the AI to re-emit the WHOLE translation with tags fails on long
     * texts — the answer gets truncated or lightly reworded, and a single altered character used
     * to make us discard the ENTIRE marked document (→ big gaps). Instead we split the translation
     * into paragraphs and align each one on its own, in parallel:
     *   • each task is tiny → never truncated, near-perfect verbatim copy;
     *   • the integrity check runs per paragraph → a bad paragraph only loses ITS OWN tags, every
     *     other paragraph stays fully highlighted;
     *   • we don't force every index into every paragraph → no over-painting.
     *
     * The AI wraps each highlight's Vietnamese counterpart in [[H:index]]…[[/H]]. The index makes
     * the renderer take the color straight from highlights[index] (exact, never fuzzy) and the
     * position from where the tag sits (exact). Returns { markedText, alignments }:
     *   - markedText = paragraphs re-joined, tagged where trustworthy (plain where not);
     *   - alignments = [{ index, vn }] harvested from EVERY paragraph attempt (fill-in fallback).
     */
    async alignHighlightsToTranslation(highlights = [], translatedText = '') {
        const empty = { markedText: '', alignments: [] };
        const cleanVn = (translatedText || '').toString().trim();
        if (!Array.isArray(highlights) || highlights.length === 0 || !cleanVn) return empty;

        const paragraphs = cleanVn.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        if (paragraphs.length === 0) return empty;

        const results = await Promise.all(
            paragraphs.map(p => this._alignParagraphMarkers(highlights, p).catch(() => ({ marked: '', alignments: [] })))
        );

        // Rebuild the document: use the tagged paragraph when it passed the integrity check,
        // otherwise the original plain paragraph (app.js fill-in will paint it via alignments).
        const markedParas = results.map((r, i) => (r && r.marked) ? r.marked : paragraphs[i]);
        const markedText = markedParas.join('\n\n');

        // Collect alignments from all attempts, de-duped by index (keep the first / shortest vn).
        const byIndex = new Map();
        results.forEach(r => (r && r.alignments ? r.alignments : []).forEach(a => {
            const prev = byIndex.get(a.index);
            if (!prev || a.vn.length < prev.vn.length) byIndex.set(a.index, a);
        }));
        const alignments = Array.from(byIndex.values());

        const anyTagged = /\[\[H:\d+\]\][\s\S]*?\[\[\/H\]\]/.test(markedText);
        return { markedText: anyTagged ? markedText : '', alignments };
    }

    /**
     * Aligns ONE paragraph: asks the AI to return that paragraph verbatim with [[H:index]] tags
     * around the Vietnamese counterparts of whichever highlighted English terms appear in it.
     * Returns { marked, alignments }. `marked` is '' when the returned text failed the integrity
     * check (tags stripped must still equal the original paragraph); alignments are still returned
     * so the app can fall back to substring fill-in.
     */
    async _alignParagraphMarkers(highlights, paragraph) {
        const fail = { marked: '', alignments: [] };
        const para = (paragraph || '').toString().trim();
        if (!para) return fail;

        const numbered = highlights
            .map((h, i) => `${i}. "${(h.text || h.word || '').toString().replace(/"/g, "'").trim()}"`)
            .join('\n');

        const prompt = `Bạn là chuyên gia đối chiếu song ngữ Anh-Việt. Dưới đây là MỘT ĐOẠN bản dịch tiếng Việt và một DANH SÁCH CỤM TỪ TIẾNG ANH được đánh số (từ 0).
Nhiệm vụ: TRẢ LẠI CHÍNH XÁC đoạn tiếng Việt đó (giữ nguyên từng ký tự, dấu câu, chữ hoa/thường), NHƯNG với MỖI cụm tiếng Anh trong danh sách mà có phần dịch XUẤT HIỆN trong đoạn này, hãy bọc phần dịch tương ứng bằng cặp thẻ đánh số: [[H:INDEX]]cụm tiếng Việt[[/H]] — INDEX là ĐÚNG số thứ tự của cụm tiếng Anh.

Ví dụ: danh sách có "0. \"humans\"", "1. \"walking slowly\"" và đoạn là "Những con người đang đi bộ chậm rãi." → trả về:
"Những [[H:0]]con người[[/H]] đang [[H:1]]đi bộ chậm rãi[[/H]]."

QUY TẮC BẮT BUỘC:
- ‼️ TUYỆT ĐỐI KHÔNG sửa/dịch lại/thêm/bớt bất kỳ chữ nào. CHỈ được CHÈN cặp thẻ [[H:INDEX]] và [[/H]]. Xóa hết thẻ đi thì phải GIỐNG HỆT đoạn gốc 100%.
- Bọc thẻ cho MỌI cụm tiếng Anh mà bạn tìm thấy phần dịch tương ứng trong đoạn này. Hãy tìm KỸ, đừng bỏ sót cụm nào đang có mặt trong đoạn.
- KHÔNG bắt buộc phải dùng hết mọi index: cụm nào KHÔNG xuất hiện trong đoạn này thì BỎ QUA (đừng bọc bừa, đừng bọc cụm không liên quan).
- Bọc đúng cụm tiếng Việt LIỀN MẠCH, sát nghĩa nhất của riêng cụm đó (không bọc cả câu, không lấn sang cụm khác). INDEX phải TRÙNG đúng nghĩa của cụm. Các thẻ KHÔNG được chồng chéo.
- ‼️ BỌC TRỌN VẸN CẢ CỤM: nếu cụm tiếng Anh là một cụm nhiều chữ (VD "Paradox of Progress", "technological innovation", "instantaneous communication") thì phải bọc TOÀN BỘ cụm tiếng Việt tương ứng LIỀN MẠCH gồm CẢ các hư từ nối ở giữa (của, sự, và, các, những…). VD "Nghịch lý của sự tiến bộ" phải bọc trọn "[[H:i]]Nghịch lý của sự tiến bộ[[/H]]" — KHÔNG được bọc lẻ "Nghịch lý" rồi bỏ "của sự tiến bộ", KHÔNG được tách thành nhiều mảnh rời. Lưu ý tiếng Việt có thể ĐẢO thứ tự so với tiếng Anh (adj+noun ↔ noun+adj) — vẫn bọc trọn cụm liền mạch theo trật tự tiếng Việt.

Trả về DUY NHẤT JSON (không kèm markdown), field "marked" là đoạn đã chèn thẻ:
{
  "marked": "…đoạn tiếng Việt đã chèn thẻ [[H:index]]…[[/H]]…"
}

DANH SÁCH CỤM TỪ TIẾNG ANH:
${numbered}

ĐOẠN BẢN DỊCH (giữ nguyên, chỉ chèn thẻ):
"""
${para}
"""`;

        const skeleton = (s) => (s || '').toString().toLowerCase().normalize('NFC')
            .replace(/\[\[h:\d+\]\]|\[\[\/h\]\]/gi, '')
            .replace(/[^\p{L}\p{N}]/gu, '');

        const extractAlignments = (marked) => {
            const out = [];
            const re = /\[\[H:(\d+)\]\]([\s\S]*?)\[\[\/H\]\]/g;
            let m;
            while ((m = re.exec(marked)) !== null) {
                const index = Number(m[1]);
                const vn = (m[2] || '').trim();
                if (Number.isInteger(index) && index >= 0 && index < highlights.length && vn) {
                    out.push({ index, vn });
                }
            }
            return out;
        };

        let raw = '';
        if (this.provider === 'openai' && this.openaiApiKey) {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
                body: JSON.stringify({
                    model: this.openaiModel,
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: 'json_object' },
                    temperature: 0
                })
            });
            if (!resp.ok) return fail;
            const data = await resp.json();
            raw = data.choices?.[0]?.message?.content || '';
        } else if (this.geminiApiKey) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, responseMimeType: 'application/json' }
                })
            });
            if (!resp.ok) return fail;
            const data = await resp.json();
            raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            return fail;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch (e) {
            return fail;
        }
        const marked = (parsed && typeof parsed.marked === 'string') ? parsed.marked : '';
        if (!marked) return fail;

        const alignments = extractAlignments(marked);
        // Integrity check on THIS paragraph only. If the AI reworded it, drop the tagged text but
        // keep the alignments so the app can still substring-fill them onto the original paragraph.
        const ok = skeleton(marked) === skeleton(para);
        return { marked: ok ? marked : '', alignments };
    }

    setUseSeparateScanApi(enabled) {
        this.useSeparateScanApi = !!enabled;
        localStorage.setItem('lingua_use_separate_scan_api', this.useSeparateScanApi);
    }

    setScanProvider(provider) {
        this.scanProvider = provider;
        localStorage.setItem('lingua_scan_ai_provider', provider);
    }

    setScanGeminiConfig(key, model) {
        this.scanGeminiApiKey = key.trim();
        this.scanGeminiModel = model;
        localStorage.setItem('lingua_scan_gemini_api_key', this.scanGeminiApiKey);
        localStorage.setItem('lingua_scan_gemini_model', model);
    }

    setScanOpenAIConfig(key, model) {
        this.scanOpenaiApiKey = key.trim();
        this.scanOpenaiModel = model;
        localStorage.setItem('lingua_scan_openai_api_key', this.scanOpenaiApiKey);
        localStorage.setItem('lingua_scan_openai_model', model);
    }

    /**
     * Returns the effective { provider, apiKey, model } to use for the Auto-Scan feature.
     * Falls back to the main translation API config if the separate scan API is not enabled/configured.
     */
    _getScanCredentials() {
        if (this.useSeparateScanApi) {
            if (this.scanProvider === 'openai' && this.scanOpenaiApiKey) {
                return { provider: 'openai', apiKey: this.scanOpenaiApiKey, model: this.scanOpenaiModel };
            }
            if (this.scanProvider === 'gemini' && this.scanGeminiApiKey) {
                return { provider: 'gemini', apiKey: this.scanGeminiApiKey, model: this.scanGeminiModel };
            }
        }
        // Fallback to main API config
        if (this.provider === 'openai' && this.openaiApiKey) {
            return { provider: 'openai', apiKey: this.openaiApiKey, model: this.openaiModel };
        }
        return { provider: 'gemini', apiKey: this.geminiApiKey, model: this.geminiModel };
    }

    setAutoScanEnabled(enabled) {
        this.autoScanEnabled = !!enabled;
        localStorage.setItem('lingua_auto_scan_ai', this.autoScanEnabled);
    }

    setProvider(provider) {
        this.provider = provider;
        localStorage.setItem('lingua_ai_provider', provider);
    }

    setGeminiConfig(key, model) {
        this.geminiApiKey = key.trim();
        this.geminiModel = model;
        localStorage.setItem('lingua_gemini_api_key', this.geminiApiKey);
        localStorage.setItem('lingua_gemini_model', model);
    }

    setOpenAIConfig(key, model) {
        this.openaiApiKey = key.trim();
        this.openaiModel = model;
        localStorage.setItem('lingua_openai_api_key', this.openaiApiKey);
        localStorage.setItem('lingua_openai_model', model);
    }

    chunkText(text, maxWordsPerChunk = 600) {
        const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
        const chunks = [];
        let currentChunk = [];
        let currentWordCount = 0;

        for (const p of paragraphs) {
            const wordCount = p.split(/\s+/).length;
            if (currentWordCount + wordCount > maxWordsPerChunk && currentChunk.length > 0) {
                chunks.push(currentChunk.join('\n\n'));
                currentChunk = [p];
                currentWordCount = wordCount;
            } else {
                currentChunk.push(p);
                currentWordCount += wordCount;
            }
        }
        if (currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n\n'));
        }
        return chunks.length > 0 ? chunks : [text];
    }

    async translateAndAnalyze(text, highlightedItems = [], progressCallback = null) {
        if (!text || !text.trim()) {
            throw new Error("Vui lòng nhập văn bản tiếng Anh để dịch.");
        }

        const chunks = this.chunkText(text);
        if (progressCallback) {
            progressCallback(0, chunks.length, 5, `Bắt đầu xử lý ${chunks.length} phần văn bản...`);
        }

        let completedCount = 0;
        const chunkLower = chunks.map(c => c.toLowerCase());
        const chunkPromises = chunks.map(async (chunkText, i) => {
            // Case-insensitive membership: a highlight like "Witnessed" (capitalised at the
            // start of a sentence) must still be attached to a chunk that contains "witnessed".
            const cl = chunkLower[i];
            const chunkHighlights = highlightedItems.filter(item => cl.includes((item.text || '').toLowerCase()));

            let result;
            if (this.provider === 'openai' && this.openaiApiKey) {
                try {
                    result = await this._translateWithOpenAI(chunkText, chunkHighlights);
                } catch (err) {
                    console.warn(`OpenAI API error on chunk ${i + 1}, falling back:`, err);
                    result = await this._translateWithFallback(chunkText, chunkHighlights);
                }
            } else if (this.geminiApiKey) {
                try {
                    result = await this._translateWithGemini(chunkText, chunkHighlights);
                } catch (err) {
                    console.warn(`Gemini API error on chunk ${i + 1}, falling back:`, err);
                    result = await this._translateWithFallback(chunkText, chunkHighlights);
                }
            } else {
                result = await this._translateWithFallback(chunkText, chunkHighlights);
            }

            completedCount++;
            if (progressCallback) {
                const percent = Math.round((completedCount / chunks.length) * 100);
                progressCallback(completedCount, chunks.length, percent, `Đang xử lý song song phần ${completedCount}/${chunks.length}...`);
            }

            return { index: i, result };
        });

        const chunkResults = await Promise.all(chunkPromises);
        // Preserve original paragraph sequence
        chunkResults.sort((a, b) => a.index - b.index);

        let fullTranslatedParagraphs = [];
        let combinedVocabList = [];

        for (const item of chunkResults) {
            if (item.result.translatedText) {
                fullTranslatedParagraphs.push(item.result.translatedText);
            }
            if (item.result.vocabList && Array.isArray(item.result.vocabList)) {
                combinedVocabList.push(...item.result.vocabList);
            }
        }

        if (progressCallback) {
            progressCallback(chunks.length, chunks.length, 100, "Hoàn tất xử lý!");
        }

        const uniqueVocabMap = new Map();
        combinedVocabList.forEach(v => {
            if (!v) return;
            const key = (v.original || v.term || v.text || v.word || v.english || '').toString().toLowerCase().trim();
            if (!key) return;
            if (!uniqueVocabMap.has(key)) {
                uniqueVocabMap.set(key, v);
            }
        });

        const finalVocab = Array.from(uniqueVocabMap.values()).map(v => {
            const word = (v.original || v.term || v.text || v.word || v.english || '').toString().trim();
            if (word && !v.original) v.original = word;
            return v;
        });

        return {
            fullTranslation: fullTranslatedParagraphs.join('\n\n'),
            vocabList: finalVocab
        };
    }

    /**
     * Call OpenAI ChatGPT API (gpt-4o, gpt-4o-mini, gpt-4-turbo)
     */
    async _translateWithOpenAI(textChunk, highlights = []) {
        const url = "https://api.openai.com/v1/chat/completions";
        const highlightListStr = highlights.map(h => `"${h.text}"`).join(', ');

        const prompt = `
Bạn là một chuyên gia dịch thuật và nhà ngôn ngữ học Tiếng Anh - Tiếng Việt cao cấp, chuyên biên soạn tài liệu học từ vựng chuyên sâu.
Nhiệm vụ:
1. Dịch đoạn văn tiếng Anh bên dưới sang tiếng Việt mượt mà, tự nhiên và CHUẨN XÁC NGHĨA TRONG NGỮ CẢNH.
   ⚡ QUY TẮC ĐÁNH DẤU TỐI QUAN TRỌNG: Ngay TRONG "translatedText", với MỖI item từ vựng bạn phân tích ở dưới, hãy BỌC chính xác cụm từ tiếng Việt tương ứng bằng cặp thẻ: [[H:ENGLISH_ORIGINAL]]cụm tiếng Việt[[/H]]
   Trong đó ENGLISH_ORIGINAL là ĐÚNG chuỗi tiếng Anh gốc ở trường "original" của item đó (giữ nguyên chữ thường, không dấu ngoặc).
   Ví dụ: câu tiếng Anh "humans are walking slowly" → dịch "Những [[H:humans]]con người[[/H]] đang [[H:walking slowly]]đi bộ chậm rãi[[/H]]."
   BẮT BUỘC: cụm tiếng Việt nằm giữa 2 thẻ phải là NGHĨA ĐÚNG của cụm tiếng Anh đó tại ĐÚNG vị trí nó xuất hiện trong câu. KHÔNG bọc nhầm sang từ khác. Mỗi item chỉ cần bọc 1 lần (ở lần xuất hiện đầu tiên). Nếu một cụm tiếng Anh không thực sự xuất hiện trong đoạn thì không bọc.
   ‼️ CỰC KỲ QUAN TRỌNG: BẮT BUỘC phải bọc thẻ cho TẤT CẢ MỌI item trong "vocabList" — TUYỆT ĐỐI KHÔNG được bỏ sót bất kỳ item nào. Số cặp thẻ [[H:...]]...[[/H]] trong "translatedText" PHẢI BẰNG ĐÚNG số phần tử trong "vocabList". Sau khi dịch xong, hãy TỰ RÀ SOÁT lại: mỗi item ở vocabList đều phải có đúng 1 cặp thẻ tương ứng trong bản dịch. Nếu thiếu, hãy thêm vào cho đủ trước khi trả kết quả.
2. Phân tích chi tiết danh sách từ/cụm từ/cấu trúc được yêu cầu: [${highlightListStr}] (Nếu danh sách trống, hãy tự động QUÉT CHI TIẾT VÀ ĐẦY ĐỦ toàn bộ đoạn văn để trích xuất TỐI THIỂU 15-20 mục hay nhất và đa dạng nhất, bao gồm ĐỦ các nhóm: Trạng từ+Động từ, Trạng từ+Tính từ, Trạng từ+Danh từ, Cụm từ kết hợp/Collocations, Cụm động từ/Phrasal Verbs, Thành ngữ/Idioms, TẤT CẢ các Cấu trúc ngữ pháp xuất hiện trong bài dù dễ hay khó, và các Danh từ/Động từ/Tính từ/Trạng từ học thuật hoặc khó khác. Không bỏ sót mục nào đáng học).
3. Cho mỗi item, phân tích chi tiết:
   - "original": Từ, Cụm từ hoặc Cấu trúc tiếng Anh
   - "category": Phân loại chính xác trong các nhãn sau: ["Trạng từ + Động từ (Adv+Verb)", "Trạng từ + Tính từ (Adv+Adj)", "Trạng từ + Danh từ (Adv+Noun)", "Cụm từ kết hợp (Collocation)", "Cấu trúc ngữ pháp (Structure)", "Cụm động từ (Phrasal Verb)", "Thành ngữ (Idiom)", "Danh từ (Noun)", "Động từ (Verb)", "Tính từ (Adj)", "Trạng từ (Adv)", "Giới từ/Liên từ (Prep/Conj)"]
   - "ipa": Phiên âm chuẩn IPA
   - "contextMeaning": Nghĩa tiếng Việt chuẩn xác nhất theo đúng ngữ cảnh bài viết này
   - "translatedTermInVN": Phải là CHÍNH XÁC cụm từ tiếng Việt bạn đã BỌC giữa 2 thẻ [[H:...]]...[[/H]] cho item này trong "translatedText" (không kèm thẻ).
   - "exampleEn": Một câu ví dụ minh họa tiếng Anh (KHÁC câu trong bài) ngắn gọn, tự nhiên
   - "exampleVi": Bản dịch tiếng Việt của câu ví dụ trên
   - "explanation": Giải thích NGẮN GỌN bằng TIẾNG VIỆT (1-2 câu, tối đa 60-80 từ) về nghĩa, cách dùng, sắc thái hoặc lưu ý khi dùng từ/cụm từ này. Nếu là collocation/idiom/structure thì giải thích ý nghĩa + cách dùng. Nếu là từ đơn thì giải thích nghĩa chính + cách dùng phổ biến.
   - "structures": Mảng 2-3 CẤU TRÚC hay và phổ biến có dùng từ/cụm từ này. Mỗi phần tử là 1 OBJECT gồm 3 trường:
     * "pattern": Tên cấu trúc / công thức (TIẾNG ANH, ngắn gọn, in đậm key word). Ví dụ: "meticulously scrutinize + something" hoặc "trigger a profound paradigm shift in + field"
     * "exampleEn": Một câu tiếng Anh hoàn chỉnh, tự nhiên, ngắn gọn (10-15 từ) MINH HỌA đúng cấu trúc đó và có chứa từ/cụm từ đang học
     * "exampleVi": Bản dịch tiếng Việt mượt mà của câu exampleEn
     Nếu là từ đơn/collocation thì cho các cấu trúc/câu chứa nó. Nếu là grammar structure thì cho 2-3 biến thể/ví dụ chính cấu trúc đó.

Trả về ĐÚNG định dạng JSON sau (không kèm markdown block ngoài):
{
  "translatedText": "Người kiểm toán đã [[H:meticulously scrutinize]]xem xét tỉ mỉ[[/H]] mọi giao dịch...",
  "vocabList": [
    {
      "original": "meticulously scrutinize",
      "category": "Trạng từ + Động từ (Adv+Verb)",
      "ipa": "/məˈtɪk.jə.ləs.li ˈskruː.tɪ.naɪz/",
      "contextMeaning": "xem xét và soi kỹ một cách tỉ mỉ",
      "translatedTermInVN": "xem xét tỉ mỉ",
      "exampleEn": "The auditor meticulously scrutinized every transaction.",
      "exampleVi": "Người kiểm toán đã xem xét tỉ mỉ từng giao dịch.",
      "explanation": "Dùng khi ai đó xem xét một cái gì cẩn thận và chi tiết đến từng chút, thường để tìm lỗi hay sai sót. Phổ biến trong ngữ cảnh học thuật, pháp lý và kiểm soát chất lượng.",
      "structures": [
        {
          "pattern": "meticulously scrutinize + something",
          "exampleEn": "The auditor meticulously scrutinized every transaction.",
          "exampleVi": "Người kiểm toán đã xem xét tỉ mỉ từng giao dịch."
        },
        {
          "pattern": "meticulously scrutinize the details/evidence",
          "exampleEn": "She meticulously scrutinized the evidence before writing her report.",
          "exampleVi": "Cô ấy đã xem xét tỉ mỉ các bằng chứng trước khi viết báo cáo."
        },
        {
          "pattern": "meticulously scrutinize every aspect of",
          "exampleEn": "The editor meticulously scrutinized every aspect of the manuscript.",
          "exampleVi": "Biên tập viên đã xem xét tỉ mỉ mọi khía cạnh của bản thảo."
        }
      ]
    }
  ]
}

Đoạn văn tiếng Anh:
"""
${textChunk}
"""
`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.openaiApiKey}`
            },
            body: JSON.stringify({
                model: this.openaiModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `OpenAI API Error status: ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content || '';
        const jsonResult = JSON.parse(rawText);

        return {
            translatedText: jsonResult.translatedText || "",
            vocabList: (jsonResult.vocabList || []).map(v => ({
                ...v,
                color: this._resolveVocabColor(v.original, highlights)
            }))
        };
    }

    /**
     * Call Google Gemini API
     */
    async _translateWithGemini(textChunk, highlights = []) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
        const highlightListStr = highlights.map(h => `"${h.text}"`).join(', ');

        const prompt = `
Bạn là một chuyên gia dịch thuật và nhà ngôn ngữ học Tiếng Anh - Tiếng Việt cao cấp, chuyên biên soạn tài liệu học từ vựng chuyên sâu.
Nhiệm vụ:
1. Dịch đoạn văn tiếng Anh bên dưới sang tiếng Việt mượt mà, tự nhiên và CHUẨN XÁC NGHĨA TRONG NGỮ CẢNH.
   ⚡ QUY TẮC ĐÁNH DẤU TỐI QUAN TRỌNG: Ngay TRONG "translatedText", với MỖI item từ vựng bạn phân tích ở dưới, hãy BỌC chính xác cụm từ tiếng Việt tương ứng bằng cặp thẻ: [[H:ENGLISH_ORIGINAL]]cụm tiếng Việt[[/H]]
   Trong đó ENGLISH_ORIGINAL là ĐÚNG chuỗi tiếng Anh gốc ở trường "original" của item đó (giữ nguyên chữ thường, không dấu ngoặc).
   Ví dụ: câu tiếng Anh "humans are walking slowly" → dịch "Những [[H:humans]]con người[[/H]] đang [[H:walking slowly]]đi bộ chậm rãi[[/H]]."
   BẮT BUỘC: cụm tiếng Việt nằm giữa 2 thẻ phải là NGHĨA ĐÚNG của cụm tiếng Anh đó tại ĐÚNG vị trí nó xuất hiện trong câu. KHÔNG bọc nhầm sang từ khác. Mỗi item chỉ cần bọc 1 lần (ở lần xuất hiện đầu tiên). Nếu một cụm tiếng Anh không thực sự xuất hiện trong đoạn thì không bọc.
   ‼️ CỰC KỲ QUAN TRỌNG: BẮT BUỘC phải bọc thẻ cho TẤT CẢ MỌI item trong "vocabList" — TUYỆT ĐỐI KHÔNG được bỏ sót bất kỳ item nào. Số cặp thẻ [[H:...]]...[[/H]] trong "translatedText" PHẢI BẰNG ĐÚNG số phần tử trong "vocabList". Sau khi dịch xong, hãy TỰ RÀ SOÁT lại: mỗi item ở vocabList đều phải có đúng 1 cặp thẻ tương ứng trong bản dịch. Nếu thiếu, hãy thêm vào cho đủ trước khi trả kết quả.
2. Phân tích chi tiết danh sách từ/cụm từ/cấu trúc được yêu cầu: [${highlightListStr}] (Nếu danh sách trống, hãy tự động QUÉT CHI TIẾT VÀ ĐẦY ĐỦ toàn bộ đoạn văn để trích xuất TỐI THIỂU 15-20 mục hay nhất và đa dạng nhất, bao gồm ĐỦ các nhóm: Trạng từ+Động từ, Trạng từ+Tính từ, Trạng từ+Danh từ, Cụm từ kết hợp/Collocations, Cụm động từ/Phrasal Verbs, Thành ngữ/Idioms, TẤT CẢ các Cấu trúc ngữ pháp xuất hiện trong bài dù dễ hay khó, và các Danh từ/Động từ/Tính từ/Trạng từ học thuật hoặc khó khác. Không bỏ sót mục nào đáng học).
3. Cho mỗi item, phân tích chi tiết:
   - "original": Từ, Cụm từ hoặc Cấu trúc tiếng Anh
   - "category": Phân loại chính xác trong các nhãn sau: ["Trạng từ + Động từ (Adv+Verb)", "Trạng từ + Tính từ (Adv+Adj)", "Trạng từ + Danh từ (Adv+Noun)", "Cụm từ kết hợp (Collocation)", "Cấu trúc ngữ pháp (Structure)", "Cụm động từ (Phrasal Verb)", "Thành ngữ (Idiom)", "Danh từ (Noun)", "Động từ (Verb)", "Tính từ (Adj)", "Trạng từ (Adv)", "Giới từ/Liên từ (Prep/Conj)"]
   - "ipa": Phiên âm chuẩn IPA (nếu là từ/cụm từ)
   - "contextMeaning": Nghĩa tiếng Việt chuẩn xác nhất theo đúng ngữ cảnh bài viết này
   - "translatedTermInVN": Phải là CHÍNH XÁC cụm từ tiếng Việt bạn đã BỌC giữa 2 thẻ [[H:...]]...[[/H]] cho item này trong "translatedText" (không kèm thẻ).
   - "exampleEn": Một câu ví dụ minh họa tiếng Anh (KHÁC câu trong bài) ngắn gọn, tự nhiên
   - "exampleVi": Bản dịch tiếng Việt của câu ví dụ trên
   - "explanation": Giải thích NGẮN GỌN bằng TIẾNG VIỆT (1-2 câu, tối đa 60-80 từ) về nghĩa, cách dùng, sắc thái hoặc lưu ý khi dùng từ/cụm từ này. Nếu là collocation/idiom/structure thì giải thích ý nghĩa + cách dùng. Nếu là từ đơn thì giải thích nghĩa chính + cách dùng phổ biến.
   - "structures": Mảng 2-3 CẤU TRÚC hay và phổ biến có dùng từ/cụm từ này. Mỗi phần tử là 1 OBJECT gồm 3 trường:
     * "pattern": Tên cấu trúc / công thức (TIẾNG ANH, ngắn gọn, in đậm key word). Ví dụ: "meticulously scrutinize + something" hoặc "trigger a profound paradigm shift in + field"
     * "exampleEn": Một câu tiếng Anh hoàn chỉnh, tự nhiên, ngắn gọn (10-15 từ) MINH HỌA đúng cấu trúc đó và có chứa từ/cụm từ đang học
     * "exampleVi": Bản dịch tiếng Việt mượt mà của câu exampleEn
     Nếu là từ đơn/collocation thì cho các cấu trúc/câu chứa nó. Nếu là grammar structure thì cho 2-3 biến thể/ví dụ chính cấu trúc đó.

Trả về ĐÚNG định dạng JSON sau (không kèm markdown block ngoài):
{
  "translatedText": "Internet đã gây ra một sự [[H:profound paradigm shift]]chuyển đổi tư duy sâu sắc[[/H]]...",
  "vocabList": [
    {
      "original": "profound paradigm shift",
      "category": "Cụm từ kết hợp (Collocation)",
      "ipa": "/prəˈfaʊnd ˈpær.ə.daɪm ʃɪft/",
      "contextMeaning": "sự chuyển đổi mô hình/tư duy sâu sắc",
      "translatedTermInVN": "chuyển đổi tư duy sâu sắc",
      "exampleEn": "The internet caused a profound paradigm shift in communication.",
      "exampleVi": "Internet đã gây ra một sự chuyển đổi tư duy sâu sắc trong giao tiếp.",
      "explanation": "Chỉ sự thay đổi sâu sắc và mang tính nền tảng trong cách mọi người nghĩ hay tiếp cận một lĩnh vực. 'Profound' nhấn mạnh chiều sâu; 'paradigm shift' xuất phát từ thuyết cách mạng khoa học của Thomas Kuhn.",
      "structures": [
        {
          "pattern": "trigger/cause a profound paradigm shift",
          "exampleEn": "The internet triggered a profound paradigm shift in communication.",
          "exampleVi": "Internet đã gây ra một sự chuyển đổi tư duy sâu sắc trong giao tiếp."
        },
        {
          "pattern": "a profound paradigm shift in + field",
          "exampleEn": "AI brought a profound paradigm shift in modern healthcare.",
          "exampleVi": "AI đã mang đến một sự chuyển đổi tư duy sâu sắc trong y tế hiện đại."
        },
        {
          "pattern": "mark/represent a profound paradigm shift",
          "exampleEn": "This discovery marks a profound paradigm shift in biology.",
          "exampleVi": "Khám phá này đánh dấu một sự chuyển đổi tư duy sâu sắc trong sinh học."
        }
      ]
    }
  ]
}

Đoạn văn tiếng Anh:
"""
${textChunk}
"""
`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `Gemini API Error status: ${response.status}`);
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        let jsonResult;
        try {
            jsonResult = JSON.parse(rawText.replace(/```json|```/g, '').trim());
        } catch (e) {
            console.error("Failed to parse Gemini JSON:", rawText);
            throw new Error("Không thể phân tích dữ liệu phản hồi từ AI.");
        }

        return {
            translatedText: jsonResult.translatedText || "",
            vocabList: (jsonResult.vocabList || []).map(v => ({
                ...v,
                color: this._resolveVocabColor(v.original, highlights)
            }))
        };
    }

    /**
     * Multi-source free translation: tries Google Translate → MyMemory → Lingva → raw text fallback
     */
    async _translateSentenceFree(text) {
        const chunk = text.substring(0, 500);

        // Source 1: Google Translate (unofficial public endpoint, no key needed, most reliable)
        try {
            const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(chunk)}`);
            if (res.ok) {
                const data = await res.json();
                const t = (data?.[0] || []).map(seg => seg[0]).join('');
                if (t && t.trim() && t.toUpperCase() !== chunk.toUpperCase()) return t;
            }
        } catch (e) { console.warn('Google Translate fail:', e); }

        // Source 2: MyMemory
        try {
            const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=en|vi`);
            if (res.ok) {
                const data = await res.json();
                const t = data.responseData?.translatedText;
                if (t && t.toUpperCase() !== chunk.toUpperCase() && !t.includes('MYMEMORY WARNING')) return t;
            }
        } catch (e) { console.warn('MyMemory fail:', e); }

        // Source 3: Lingva Translate (free, no key needed)
        try {
            const res = await fetch(`https://lingva.ml/api/v1/en/vi/${encodeURIComponent(chunk)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.translation) return data.translation;
            }
        } catch (e) { console.warn('Lingva fail:', e); }

        return text; // Return original if all fail
    }

    /**
     * Dictionary Lookup Mode: instant, context-aware word/phrase lookup.
     * Returns { word, ipa, pos, meaning, example, exampleVi, source }.
     * Always resolves fast — offline dictionary/estimation gives an instant baseline,
     * then (if an AI key is configured) the meaning/example are upgraded with a
     * context-aware AI lookup that considers the surrounding sentence.
     */
    async lookupWord(word, sentenceContext = '') {
        const cleanWord = (word || '').trim();
        if (!cleanWord) return null;

        if (!this._lookupCache) this._lookupCache = new Map();
        // Cache key MUST include the source sentence: the same word in two
        // different contexts may have two different *meanings*, and the AI
        // picks the meaning that matches the current sentence. Sharing a cache
        // entry across sentences would return a stale, wrong-context meaning.
        // Version prefix invalidates entries cached by older code (which used
        // to echo back the source sentence into `example`).
        const cacheKey = `v3|${cleanWord.toLowerCase()}|${(sentenceContext || '').toLowerCase()}`;
        if (this._lookupCache.has(cacheKey)) return this._lookupCache.get(cacheKey);

        const dict = window.dictionaryDB;
        let result = {
            word: cleanWord,
            ipa: dict ? dict.getIPA(cleanWord) : '/.../',
            pos: dict ? dict.getPOS(cleanWord) : '',
            meaning: dict ? dict.getMeaning(cleanWord) : null,
            example: null,
            exampleVi: null,
            structures: [],
            source: 'offline'
        };

        // Try context-aware AI lookup (uses main translation API credentials).
        // sentenceContext is sent to the AI so it can pick the *right* meaning, but
        // we DON'T display the original sentence back to the user — they want
        // concise Vietnamese meaning + clean example sentences instead.
        try {
            const ai = await this._lookupWithAI(cleanWord, sentenceContext);
            if (ai) {
                result = {
                    word: cleanWord,
                    ipa: ai.ipa || result.ipa,
                    pos: ai.pos || result.pos,
                    meaning: ai.meaning || result.meaning,
                    example: ai.example || null,
                    exampleVi: ai.exampleVi || null,
                    structures: Array.isArray(ai.structures) ? ai.structures : [],
                    source: 'ai'
                };
            }
        } catch (e) {
            console.warn('AI dictionary lookup failed, using offline fallback:', e);
        }

        // If still missing a meaning/translation, use quick free-translate fallback
        if (!result.meaning) {
            try {
                const t = await this._translateSentenceFree(cleanWord);
                if (t && t.trim().toLowerCase() !== cleanWord.toLowerCase()) result.meaning = t;
            } catch (e) { /* ignore */ }
        }

        // Hard-guard: if the AI (or any layer) accidentally returned the
        // *source sentence* as the example, strip it. The user has been
        // explicit that they never want the original sentence echoed back.
        if (sentenceContext && result.example) {
            const ex = (result.example || '').trim();
            const src = (sentenceContext || '').trim();
            if (ex === src || src.includes(ex) || ex.includes(src)) {
                console.warn('[lookupWord] AI returned source sentence as example — discarding.');
                result.example = null;
                result.exampleVi = null;
            }
        }

        // If we still don't have a usable example, build a minimal seed from
        // the word itself. We *never* fall back to the source sentence —
        // the user explicitly asked us NOT to echo the original sentence back.
        if (!result.example) {
            try {
                const en = cleanWord.includes(' ') ? cleanWord : `Example with ${cleanWord}.`;
                result.example = en;
                if (!result.exampleVi) {
                    const seed = cleanWord.includes(' ') ? cleanWord : `Use "${cleanWord}" in a sentence.`;
                    result.exampleVi = (await this._translateSentenceFree(seed)) || seed;
                }
            } catch (e) { /* ignore */ }
        }

        this._lookupCache.set(cacheKey, result);
        return result;
    }

    /**
     * Calls OpenAI or Gemini (whichever is configured for the main translation API)
     * to get a short, context-aware dictionary entry for a single word/phrase given
     * the sentence it appears in. Returns null if no API key is configured or on error.
     */
    async _lookupWithAI(word, sentence) {
        const hasOpenAI = this.provider === 'openai' && this.openaiApiKey;
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || !this.openaiApiKey);
        if (!hasOpenAI && !hasGemini) return null;

        // IMPORTANT: the user's request is explicit — DON'T echo back the original
        // sentence. Instead, give:
        //  1. A *concise Vietnamese explanation* of the word in context.
        //  2. ONE *fresh* English example sentence that illustrates the word.
        //  3. Its Vietnamese translation.
        //  4. 2-3 *common grammatical structures / collocations / idioms* that
        //     frequently go with this word (e.g. "make progress", "be keen on",
        //     "run out of", "as ... as", etc.), each with its own example sentence
        //     and Vietnamese translation.
        //
        // Note on prompt layout: we keep the SOURCE sentence outside the JSON
        // template (above it) so the model doesn't accidentally treat it as
        // a fill-in slot and echo it back into `example`.
        const prompt = `Bạn là từ điển Anh-Việt. Tra nghĩa từ/cụm từ cho người học tiếng Anh.

========================================
CONTEXT (for choosing the right meaning only — DO NOT echo this sentence back into the JSON):
"SENTENCE_PLACEHOLDER"
========================================

Từ/cụm từ cần tra: "WORD_PLACEHOLDER"

YÊU CẦU BẮT BUỘC (không thể bỏ qua):
1. BỎ QUA hoàn toàn câu trong khung CONTEXT ở trên. KHÔNG được đưa nó vào "example". Phải viết MỘT câu tiếng Anh HOÀN TOÀN MỚI để minh hoạ cách dùng từ.
2. "meaning": giải thích NGẮN GỌN bằng tiếng Việt (tối đa 8 từ) theo đúng ngữ cảnh câu trên.
3. "example": một câu tiếng Anh MỚI (KHÁC câu trong khung CONTEXT) minh hoạ từ này. Ưu tiên câu ngắn gọn, tự nhiên, đời thường.
4. "exampleVi": bản dịch tiếng Việt của câu example.
5. "structures": danh sách 2-3 cấu trúc / cụm từ / thành ngữ PHỔ BIẾN có chứa hoặc liên quan đến từ "WORD_PLACEHOLDER" (ví dụ: make + word, word + with, be + word + to, as ... as ..., run out of word, ...). Mỗi cấu trúc gồm:
   - "name": tên cấu trúc (ví dụ: "make progress", "be keen on st", "run out of st")
   - "note": giải thích ngắn gọn bằng tiếng Việt (1 dòng)
   - "example": câu tiếng Anh minh hoạ cấu trúc đó (cũng KHÁC câu trong CONTEXT)
   - "exampleVi": bản dịch tiếng Việt
   Chỉ chọn cấu trúc thật sự phổ biến và phù hợp với từ đang tra.

Trả về ĐÚNG JSON (không kèm markdown, không giải thích thêm):
{
  "ipa": "phiên âm IPA chuẩn của từ",
  "pos": "loại từ viết tắt (n. / v. / adj. / adv. / phr. / idiom ...)",
  "meaning": "nghĩa tiếng Việt ngắn gọn, chính xác theo ngữ cảnh (≤8 từ)",
  "example": "câu tiếng Anh MỚI minh hoạ từ (KHÔNG ĐƯỢC lặp lại câu trong khung CONTEXT)",
  "exampleVi": "bản dịch tiếng Việt của câu example",
  "structures": [
    {
      "name": "tên cấu trúc / cụm từ phổ biến",
      "note": "giải thích ngắn gọn tiếng Việt (1 dòng)",
      "example": "câu tiếng Anh minh hoạ (KHÔNG ĐƯỢC lặp lại câu trong CONTEXT)",
      "exampleVi": "bản dịch tiếng Việt của câu trên"
    }
  ]
}`.replace('SENTENCE_PLACEHOLDER', sentence || word).replace(/WORD_PLACEHOLDER/g, word);

        if (hasOpenAI) {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
                body: JSON.stringify({
                    model: this.openaiModel,
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: "json_object" },
                    temperature: 0.2
                })
            });
            if (!res.ok) throw new Error(`OpenAI lookup error: ${res.status}`);
            const data = await res.json();
            return JSON.parse(data.choices?.[0]?.message?.content || '{}');
        }

        if (hasGemini) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
                })
            });
            if (!res.ok) throw new Error(`Gemini lookup error: ${res.status}`);
            const data = await res.json();
            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            return JSON.parse(rawText.replace(/```json|```/g, '').trim());
        }

        return null;
    }

    /**
     * Invalidate the lookup cache (e.g. after a prompt upgrade that changes
     * the shape of cached responses). Safe to call any time — subsequent
     * lookups will simply rebuild the cache.
     */
    clearLookupCache() {
        if (this._lookupCache) this._lookupCache.clear();
        this._lookupCache = new Map();
    }

    async _translateWithFallback(textChunk, highlights = []) {
        let translatedText = "";
        try {
            const paragraphs = textChunk.split(/\n\s*\n/).filter(Boolean);
            const paragraphPromises = paragraphs.map(async (p) => {
                if (p.length > 500) {
                    const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
                    const sentencePromises = sentences.map(s => this._translateSentenceFree(s.trim()));
                    const transSentences = await Promise.all(sentencePromises);
                    return transSentences.join(' ');
                } else {
                    return await this._translateSentenceFree(p);
                }
            });
            const translatedParagraphs = await Promise.all(paragraphPromises);
            translatedText = translatedParagraphs.join('\n\n');
        } catch (err) {
            console.warn("All translation sources failed:", err);
            translatedText = textChunk;
        }

        const vocabList = [];
        const itemsToProcess = highlights.length > 0 ? highlights : this._extractKeywordsFromChunk(textChunk);

        const wordsToTranslate = [];
        const processedItems = [];

        for (const item of itemsToProcess) {
            const word = item.text || item;
            const ipa = window.dictionaryDB ? window.dictionaryDB.getIPA(word) : "/.../";
            let localMeaning = window.dictionaryDB ? window.dictionaryDB.getMeaning(word) : null;
            const catInfo = item.category || null;

            processedItems.push({ word, ipa, localMeaning, color: item.color || '#fef08a', category: catInfo });
            if (!localMeaning) {
                wordsToTranslate.push(word);
            }
        }

        // Translate missing meanings in parallel (batches of 10 for faster response)
        const translatedMeanings = new Map();
        const batchSize = 10;
        for (let i = 0; i < wordsToTranslate.length; i += batchSize) {
            const batch = wordsToTranslate.slice(i, i + batchSize);
            const promises = batch.map(async (w) => {
                try {
                    return { word: w, meaning: await this._translateSentenceFree(w) };
                } catch (e) {
                    return { word: w, meaning: w };
                }
            });
            const results = await Promise.all(promises);
            results.forEach(r => translatedMeanings.set(r.word, r.meaning));
        }

        for (const item of processedItems) {
            const meaning = item.localMeaning || translatedMeanings.get(item.word) || item.word;

            let category = item.category || "Từ vựng";
            if (!item.category) {
                const pos = window.dictionaryDB ? window.dictionaryDB.getPOS(item.word) : 'n.';
                if (item.word.includes(' ')) {
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
            }

            vocabList.push({
                original: item.word,
                color: item.color,
                category: category,
                ipa: item.ipa,
                contextMeaning: meaning,
                translatedTermInVN: meaning,
                example: `"${item.word}" is used in this context.`
            });
        }

        return {
            translatedText: translatedText,
            vocabList: vocabList
        };
    }

    async autoScanKeyTermsWithAI(text, progressCallback = null) {
        if (!text || !text.trim()) return [];

        const chunks = this.chunkText(text, 500);
        let allTerms = [];
        let anyChunkSucceeded = false;
        const chunkErrors = [];
        let completedCount = 0;

        if (progressCallback) {
            progressCallback(0, chunks.length, 5, `Bắt đầu quét từ vựng trên ${chunks.length} phần văn bản...`);
        }

        const scanPromises = chunks.map(async (chunk, i) => {
            try {
                const chunkTerms = await this._scanTextChunkWithAI(chunk);
                completedCount++;
                if (progressCallback) {
                    const percent = Math.round((completedCount / chunks.length) * 100);
                    progressCallback(completedCount, chunks.length, percent, `Đang quét từ vựng song song (${completedCount}/${chunks.length})...`);
                }
                return { index: i, terms: chunkTerms || [] };
            } catch (e) {
                console.warn(`Auto-Scan: chunk ${i + 1}/${chunks.length} failed:`, e);
                chunkErrors.push(e.message || String(e));
                completedCount++;
                if (progressCallback) {
                    const percent = Math.round((completedCount / chunks.length) * 100);
                    progressCallback(completedCount, chunks.length, percent, `Đang quét từ vựng song song (${completedCount}/${chunks.length})...`);
                }
                return { index: i, terms: [] };
            }
        });

        const scanResults = await Promise.all(scanPromises);
        scanResults.sort((a, b) => a.index - b.index);

        for (const item of scanResults) {
            if (item.terms && item.terms.length > 0) {
                allTerms.push(...item.terms);
                anyChunkSucceeded = true;
            }
        }

        if (progressCallback) {
            progressCallback(chunks.length, chunks.length, 100, "Hoàn tất quét toàn bài!");
        }

        if (!anyChunkSucceeded && allTerms.length === 0) {
            throw new Error(chunkErrors[0] || "Tất cả API đều lỗi và không thể quét offline.");
        }

        // Dedupe across chunks while preserving first-seen (top-to-bottom) order
        const seen = new Set();
        const deduped = [];
        for (const t of allTerms) {
            const key = t.text.toLowerCase().trim();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(t);
        }
        return deduped;
    }

    /**
     * Scans a SINGLE chunk of text (called by autoScanKeyTermsWithAI for each piece of a
     * possibly-long document). Tries the configured AI provider(s) first; if all AI sources
     * fail for this chunk, falls back to the offline NLP engine for just this chunk.
     */
    async _scanTextChunkWithAI(chunkText) {
        if (!chunkText || !chunkText.trim()) return [];

        const wordCount = chunkText.trim().split(/\s+/).length;
        // Deep-scan mode: cast a much wider net so nothing worth learning slips through
        // (single powerful adjectives/verbs like "pivotal", "sustainable", "resilient" included).
        const minTerms = Math.max(10, Math.min(35, Math.round(wordCount / 9)));
        const maxTerms = Math.max(20, Math.min(70, Math.round(wordCount / 5)));

        const prompt = `
Bạn là nhà ngôn ngữ học và giáo viên tiếng Anh chuyên sâu (C2/CEFR), biên soạn tài liệu học từ vựng cực kỳ kỹ lưỡng, KHÔNG BỎ SÓT bất kỳ từ/cụm từ hay nào.
Nhiệm vụ: Quét THẬT KỸ, THẬT CHI TIẾT văn bản tiếng Anh dưới đây và trích xuất TỐI THIỂU ${minTerms} và TỐI ĐA ${maxTerms} từ/cụm từ/cấu trúc QUAN TRỌNG VÀ HAY để học. Hãy quét toàn diện, đừng bỏ lọt các từ vựng học thuật/nâng cao đơn lẻ dù chúng không nằm liền kề nhau trong câu.

NHÓM CẦN TRÍCH XUẤT (lấy ĐẦY ĐỦ CẢ 6 NHÓM, không chỉ tập trung 1-2 nhóm):
1. collocation — Cụm từ kết hợp: Adj+N, V+N, N+N, Adv+Adj (profound impact, carry out a task, paradigm shift, highly effective)
2. phrasal_verb — Cụm động từ: V + particle (carry out, break down, figure out, give rise to)
3. adv_combo — Trạng từ + Động từ/Tính từ: Adv + V, Adv + Adj (gradually reduce, deeply rooted, remarkably efficient)
4. idiom — Thành ngữ & cụm giới từ cố định (a drop in the ocean, in light of, on the other hand, by virtue of)
5. grammar — Cấu trúc ngữ pháp ĐẶC BIỆT (inverted conditional, cleft sentence, no sooner...than, so...that, such...that; KHÔNG lấy passive voice hay relative clause đơn giản)
6. vocabulary — TỪ ĐƠN học thuật/khó/nâng cao (tính từ, động từ, danh từ, trạng từ): LẤY TẤT CẢ các từ học thuật/C1-C2/IELTS nổi bật xuất hiện trong bài, KỂ CẢ khi chúng đứng riêng lẻ, không ghép với từ khác (ví dụ: "pivotal", "sustainable", "resilient", "profound", "meticulous", "ubiquitous", "paradigm", "leverage" khi dùng làm động từ...). KHÔNG giới hạn số lượng ở nhóm này chỉ 3-5 từ — hãy lấy HẾT các từ đáng học, có thể 10-20+ từ nếu bài dài.

QUY TẮC:
- Tổng cộng ${minTerms}-${maxTerms} mục
- Cân bằng giữa cụm từ (nhóm 1-4) và từ vựng đơn lẻ nổi bật (nhóm 6) — KHÔNG bỏ qua từ đơn chỉ vì ưu tiên cụm từ
- Mỗi mục PHẢI xuất hiện NGUYÊN VĂN trong văn bản (trừ grammar structures)
- KHÔNG lặp lại, KHÔNG lấy từ quá phổ thông/cơ bản (the, is, very, good, big...)

Trả về JSON (không kèm markdown), mỗi mục có "text" và "category":
{
  "keyTerms": [
    {"text": "carry out", "category": "phrasal_verb"},
    {"text": "profound impact", "category": "collocation"},
    {"text": "in light of", "category": "idiom"},
    {"text": "not only... but also", "category": "grammar"},
    {"text": "ubiquitous", "category": "vocabulary"},
    {"text": "pivotal", "category": "vocabulary"},
    {"text": "sustainable", "category": "vocabulary"}
  ]
}

Văn bản:
"""
${chunkText}
"""
`;

        const { provider, apiKey, model } = this._getScanCredentials();

        // Try AI APIs first, then auto-fallback to offline NLP engine
        const aiErrors = [];

        // Helper to normalize AI response: handles both string[] and {text,category}[]
        const normalizeTerms = (raw) => {
            if (!Array.isArray(raw) || raw.length === 0) return null;
            return raw.map(item => {
                if (typeof item === 'string') {
                    const isPhrase = /[\s-]/.test(item.trim());
                    return { text: item.trim(), category: isPhrase ? 'collocation' : 'vocabulary' };
                }
                const text = (item.text || item.term || '').trim();
                if (!text) return null;
                return { text, category: item.category || 'vocabulary' };
            }).filter(Boolean);
        };

        // Try OpenAI
        if ((provider === 'openai' || this.openaiApiKey) && (apiKey || this.openaiApiKey)) {
            const useKey = provider === 'openai' ? apiKey : this.openaiApiKey;
            const useModel = provider === 'openai' ? model : this.openaiModel;
            try {
                const res = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useKey}` },
                    body: JSON.stringify({
                        model: useModel,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: "json_object" },
                        temperature: 0.2
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const json = JSON.parse(data.choices?.[0]?.message?.content || '{}');
                    const terms = normalizeTerms(json.keyTerms);
                    if (terms && terms.length > 0) return terms;
                }
                aiErrors.push('OpenAI: ' + res.status);
            } catch (e) {
                aiErrors.push('OpenAI: ' + e.message);
            }
        }

        // Try Gemini
        if ((provider === 'gemini' || this.geminiApiKey) && (apiKey || this.geminiApiKey)) {
            const useKey = provider === 'gemini' ? apiKey : this.geminiApiKey;
            const useModel = provider === 'gemini' ? model : this.geminiModel;
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${useKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                    const json = JSON.parse(rawText.replace(/```json|```/g, '').trim());
                    const terms = normalizeTerms(json.keyTerms);
                    if (terms && terms.length > 0) return terms;
                }
                aiErrors.push('Gemini: status ' + res.status);
            } catch (e) {
                aiErrors.push('Gemini: ' + e.message);
            }
        }

        // ALL API SOURCES FAILED → Auto-fallback to offline NLP engine
        console.warn('All AI APIs failed for this chunk, using offline NLP engine. Errors:', aiErrors);
        const offlineTerms = this._extractKeywordsFromChunk(chunkText);
        if (offlineTerms.length > 0) {
            return offlineTerms; // Returns [{text, category}] objects with semantic category keys
        }

        throw new Error(aiErrors[0] || "Tất cả API đều lỗi và không thể quét offline.");
    }

    /**
     * Smart offline NLP extraction engine - QUALITY over QUANTITY.
     * Returns {text, category} objects with semantic categories:
     *   'collocation', 'phrasal_verb', 'adv_combo', 'idiom', 'grammar', 'vocabulary'
     * Prioritizes multi-word phrases, limits to 15-30 important items.
     */
    _extractKeywordsFromChunk(text) {
        if (!text || !text.trim()) return [];
        const results = [];
        const addedLower = new Set();

        const addTerm = (term, category) => {
            const clean = term.trim().replace(/\s+/g, ' ');
            if (clean.length < 2) return;
            const key = clean.toLowerCase();
            if (addedLower.has(key)) return;
            addedLower.add(key);
            results.push({ text: clean, category });
        };

        // Normalize text for matching
        const sentences = text.replace(/\n/g, ' ').match(/[^.!?]+[.!?]*/g) || [text];
        const words = text.match(/\b[a-zA-Z][a-zA-Z'-]*[a-zA-Z]\b|\b[a-zA-Z]\b/g) || [];
        const wordsLower = words.map(w => w.toLowerCase());

        // ── 1. PHRASAL VERBS ──
        const phrasalParticles = ['up', 'out', 'off', 'on', 'in', 'down', 'away', 'over', 'back', 'through', 'along', 'around', 'about', 'across', 'into', 'upon', 'forth', 'aside'];
        const commonVerbs = ['give', 'take', 'make', 'come', 'go', 'get', 'set', 'put', 'run', 'turn', 'bring', 'carry', 'break', 'call', 'cut', 'fall', 'hold', 'keep', 'look', 'pick', 'pull', 'push', 'stand', 'throw', 'work', 'figure', 'find', 'hand', 'hang', 'lay', 'leave', 'let', 'live', 'move', 'pass', 'pay', 'play', 'point', 'reach', 'rule', 'show', 'shut', 'sort', 'speak', 'split', 'step', 'stick', 'think', 'try', 'use', 'wear', 'wind', 'write', 'blow', 'build', 'burn', 'check', 'clean', 'clear', 'close', 'cool', 'count', 'cross', 'deal', 'die', 'do', 'draw', 'dress', 'drop', 'eat', 'end', 'face', 'feed', 'fill', 'fit', 'fix', 'fly', 'follow', 'grow', 'head', 'heat', 'help', 'hit', 'jump', 'kick', 'knock', 'lead', 'lie', 'lift', 'light', 'line', 'lock', 'log', 'mark', 'mix', 'open', 'opt', 'own', 'pack', 'phase', 'pile', 'plug', 'print', 'rip', 'roll', 'round', 'sell', 'send', 'settle', 'sign', 'sit', 'slow', 'snap', 'speed', 'start', 'stay', 'sum', 'switch', 'tag', 'tear', 'tie', 'top', 'track', 'trade', 'trip', 'wake', 'walk', 'warm', 'wash', 'watch', 'wipe', 'wrap', 'zoom', 'adapt', 'belong', 'refer', 'result'];
        for (let i = 0; i < wordsLower.length - 1; i++) {
            if (commonVerbs.includes(wordsLower[i]) && phrasalParticles.includes(wordsLower[i + 1])) {
                addTerm(`${words[i]} ${words[i + 1]}`, 'phrasal_verb');
            }
        }

        // ── 2. ADVERB + VERB / ADVERB + ADJECTIVE COMBOS ──
        const adverbSuffixes = ['ly'];
        const isAdverb = (w) => {
            const l = w.toLowerCase();
            if (l.length < 4) return false;
            if (adverbSuffixes.some(s => l.endsWith(s)) && !['family', 'only', 'early', 'likely', 'lonely', 'friendly', 'daily', 'ugly', 'holy', 'rally', 'ally', 'belly', 'bully', 'folly', 'jelly', 'jolly', 'lily', 'silly', 'supply', 'reply', 'apply', 'fly', 'rely'].includes(l)) return true;
            return ['also', 'always', 'never', 'often', 'usually', 'sometimes', 'rarely', 'seldom', 'already', 'still', 'yet', 'just', 'ever', 'almost', 'quite', 'rather', 'very', 'too', 'enough', 'well', 'even', 'perhaps', 'thus', 'hence', 'therefore', 'however', 'moreover', 'furthermore', 'meanwhile', 'nonetheless', 'nevertheless', 'otherwise', 'indeed', 'certainly', 'mainly', 'merely'].includes(l);
        };
        const isVerb = (w) => {
            const l = w.toLowerCase();
            if (['is', 'are', 'was', 'were', 'am', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'must'].includes(l)) return false;
            return l.endsWith('ed') || l.endsWith('ing') || l.endsWith('ize') || l.endsWith('ise') || l.endsWith('ate') || l.endsWith('ify') || l.endsWith('en') ||
                   (window.dictionaryDB?.getPOS(w) || '').includes('v.');
        };
        const isAdj = (w) => {
            const l = w.toLowerCase();
            return l.endsWith('ive') || l.endsWith('ous') || l.endsWith('ful') || l.endsWith('less') || l.endsWith('ible') || l.endsWith('able') || l.endsWith('ial') || l.endsWith('ical') || l.endsWith('al') || l.endsWith('ent') || l.endsWith('ant') || l.endsWith('ic') ||
                   (window.dictionaryDB?.getPOS(w) || '').includes('adj.');
        };

        for (let i = 0; i < wordsLower.length - 1; i++) {
            if (isAdverb(words[i])) {
                if (isVerb(words[i + 1]) && words[i + 1].length >= 4) {
                    addTerm(`${words[i]} ${words[i + 1]}`, 'adv_combo');
                } else if (isAdj(words[i + 1]) && words[i + 1].length >= 4) {
                    addTerm(`${words[i]} ${words[i + 1]}`, 'adv_combo');
                }
            }
        }

        // ── 3. ADJECTIVE + NOUN COLLOCATIONS ──
        const isNoun = (w) => {
            const l = w.toLowerCase();
            if (l.length < 4) return false;
            return l.endsWith('tion') || l.endsWith('sion') || l.endsWith('ment') || l.endsWith('ness') || l.endsWith('ity') || l.endsWith('ence') || l.endsWith('ance') || l.endsWith('ism') || l.endsWith('ist') || l.endsWith('ogy') || l.endsWith('ure') || l.endsWith('dom') ||
                   (window.dictionaryDB?.getPOS(w) || '').includes('n.');
        };

        for (let i = 0; i < wordsLower.length - 1; i++) {
            if (isAdj(words[i]) && words[i].length >= 5 && isNoun(words[i + 1]) && words[i + 1].length >= 5) {
                addTerm(`${words[i]} ${words[i + 1]}`, 'collocation');
            }
        }

        // ── 4. NOUN + NOUN COMPOUNDS ──
        for (let i = 0; i < wordsLower.length - 1; i++) {
            if (isNoun(words[i]) && words[i].length >= 5 && isNoun(words[i + 1]) && words[i + 1].length >= 5) {
                addTerm(`${words[i]} ${words[i + 1]}`, 'collocation');
            }
        }

        // ── 5. VERB + NOUN COLLOCATIONS (make/take/have/give/do + noun) ──
        const lightVerbs = ['make', 'makes', 'made', 'take', 'takes', 'took', 'give', 'gives', 'gave', 'keep', 'keeps', 'kept', 'hold', 'holds', 'held', 'pay', 'pays', 'paid', 'build', 'builds', 'built', 'foster', 'fosters', 'leverage', 'leverages', 'drive', 'drives', 'drove'];
        for (let i = 0; i < wordsLower.length - 1; i++) {
            if (lightVerbs.includes(wordsLower[i])) {
                let j = i + 1;
                if (['a', 'an', 'the'].includes(wordsLower[j]) && j + 1 < wordsLower.length) j++;
                if (isNoun(words[j]) && words[j].length >= 4) {
                    const phrase = words.slice(i, j + 1).join(' ');
                    addTerm(phrase, 'collocation');
                }
            }
        }

        // ── 6. HYPHENATED COMPOUNDS (state-of-the-art, cutting-edge, etc.) ──
        const hyphenated = text.match(/\b[a-zA-Z]+-[a-zA-Z]+(?:-[a-zA-Z]+)*\b/g) || [];
        hyphenated.forEach(h => {
            if (h.length >= 6) addTerm(h, 'collocation');
        });

        // ── 7. ACADEMIC WORD LIST (AWL) - comprehensive list for vocabulary extraction ──
        const academicWords = new Set([
            'analyze', 'analyse', 'approach', 'area', 'assess', 'assessment', 'assume', 'authority',
            'available', 'benefit', 'concept', 'consist', 'constitute', 'context', 'contract', 'contribute',
            'create', 'data', 'define', 'derive', 'distribute', 'economy', 'environment', 'establish',
            'estimate', 'evident', 'export', 'factor', 'finance', 'formula', 'function', 'identify',
            'income', 'indicate', 'individual', 'interpret', 'involve', 'issue', 'labour', 'legal',
            'legislate', 'major', 'method', 'occur', 'percent', 'period', 'policy', 'principle',
            'proceed', 'process', 'require', 'research', 'respond', 'role', 'section', 'sector',
            'significant', 'similar', 'source', 'specific', 'strategy', 'structure', 'theory', 'vary',
            'achieve', 'acquire', 'adapt', 'adequate', 'affect', 'alternative', 'annual', 'apparent',
            'appropriate', 'aspect', 'assist', 'category', 'chapter', 'commission', 'community',
            'complex', 'compute', 'conclude', 'conduct', 'consequence', 'construct', 'consume',
            'credit', 'culture', 'design', 'distinct', 'element', 'equate', 'evaluate', 'feature',
            'final', 'focus', 'impact', 'injure', 'institute', 'invest', 'item', 'journal',
            'maintain', 'normal', 'obtain', 'participate', 'perceive', 'positive', 'potential',
            'previous', 'primary', 'purchase', 'range', 'region', 'regulate', 'relevant', 'reside',
            'resource', 'restrict', 'secure', 'select', 'site', 'seek', 'survey', 'text',
            'tradition', 'transfer', 'transform', 'demonstrate', 'document', 'dominate', 'emphasis',
            'ensure', 'exclude', 'framework', 'fund', 'illustrate', 'immigrate', 'imply', 'initial',
            'instance', 'interact', 'justify', 'layer', 'link', 'locate', 'maximize', 'minor',
            'negate', 'outcome', 'partner', 'philosophy', 'physical', 'proportion', 'publish',
            'react', 'register', 'rely', 'remove', 'scheme', 'sequence', 'shift', 'specify',
            'sufficient', 'task', 'technical', 'technique', 'technology', 'valid', 'volume',
            'access', 'accurate', 'acknowledge', 'aggregate', 'allocate', 'alter', 'amend',
            'analogy', 'anticipate', 'arbitrary', 'automate', 'bias', 'capacity', 'cease',
            'coherent', 'coincide', 'collapse', 'colleague', 'commence', 'compatible', 'compensate',
            'compile', 'complement', 'comprehensive', 'comprise', 'conceive', 'concurrent', 'confine',
            'confirm', 'conform', 'consent', 'considerable', 'contrary', 'controversy', 'converse',
            'criteria', 'crucial', 'currency', 'deduce', 'denote', 'detect', 'deviate', 'device',
            'differentiate', 'dimension', 'diminish', 'discrete', 'discriminate', 'displace', 'dispose',
            'distort', 'diverse', 'domain', 'domestic', 'dynamic', 'eliminate', 'empirical', 'enable',
            'encounter', 'enormous', 'entity', 'equip', 'erode', 'ethnic', 'evident', 'evolve',
            'exceed', 'exploit', 'extract', 'facilitate', 'fluctuate', 'fundamental', 'furthermore',
            'generate', 'globe', 'guarantee', 'hence', 'hierarchy', 'hypothesis', 'ideology',
            'ignorance', 'incentive', 'incidence', 'incline', 'incorporate', 'index', 'induce',
            'inevitable', 'infrastructure', 'inherent', 'inhibit', 'initiate', 'innovate', 'input',
            'insert', 'integral', 'integrate', 'integrity', 'intelligence', 'intense', 'intervene',
            'intrinsic', 'invoke', 'isolate', 'levy', 'liberal', 'license', 'likewise', 'logic',
            'manifest', 'manipulate', 'mature', 'mediate', 'medium', 'migrate', 'military', 'minimal',
            'ministry', 'modify', 'monitor', 'motive', 'mutual', 'neutral', 'nonetheless', 'norm',
            'notion', 'notwithstanding', 'nuclear', 'objective', 'obligate', 'occupy', 'offset',
            'ongoing', 'orient', 'overlap', 'overseas', 'panel', 'paradigm', 'paragraph', 'parameter',
            'passive', 'persist', 'perspective', 'phase', 'phenomenon', 'plus', 'practitioner',
            'precede', 'precise', 'predominant', 'preliminary', 'presume', 'prevalent', 'principal',
            'prior', 'priority', 'prohibit', 'project', 'promote', 'protocol', 'psychology', 'pursue',
            'qualitative', 'radical', 'random', 'ratio', 'recover', 'refine', 'regime', 'reinforce',
            'release', 'reluctance', 'resolve', 'restore', 'restrain', 'retain', 'reveal', 'revenue',
            'reverse', 'revise', 'revolution', 'rigid', 'route', 'scenario', 'scope', 'simulate',
            'sole', 'somewhat', 'submit', 'subordinate', 'subsequent', 'subsidy', 'substitute',
            'successor', 'supplement', 'suspend', 'sustain', 'symbol', 'target', 'temporary', 'terminate',
            'theme', 'thereby', 'thesis', 'trace', 'transit', 'trigger', 'ultimate', 'undergo',
            'underlie', 'undertake', 'uniform', 'unify', 'unique', 'utilize', 'vehicle', 'via',
            'violate', 'virtual', 'visible', 'visual', 'welfare', 'whereas', 'whereby',
            // Additional high-frequency academic & IELTS vocabulary
            'abundant', 'accumulate', 'adjacent', 'advocate', 'aesthetic', 'affiliate', 'aggregate',
            'albeit', 'allocate', 'ambiguous', 'analogous', 'anomaly', 'apparatus', 'articulate',
            'attribute', 'augment', 'authentic', 'autonomous', 'benchmark', 'bureaucracy', 'catalyst',
            'chronic', 'circumscribe', 'clandestine', 'cognition', 'compelling', 'complacent',
            'complement', 'compliance', 'compulsory', 'conceivable', 'conducive', 'configuration',
            'congestion', 'conjecture', 'consecutive', 'consolidate', 'conspicuous', 'constraint',
            'contemplate', 'contingent', 'conventional', 'converge', 'correlation', 'counterpart',
            'culminate', 'cumulative', 'curriculum', 'dearth', 'debris', 'decipher', 'deficit',
            'degradation', 'deliberate', 'demographic', 'deplete', 'deteriorate', 'detrimental',
            'deviation', 'dichotomy', 'dilemma', 'discourse', 'discrepancy', 'disseminate',
            'dissolution', 'diverge', 'doctrine', 'drought', 'durable', 'efficacy', 'elaborate',
            'elicit', 'eloquent', 'emancipate', 'embark', 'encompass', 'endeavor', 'endorse',
            'enhance', 'enigma', 'entail', 'entrepreneur', 'epoch', 'equilibrium', 'erratic',
            'escalate', 'exacerbate', 'exemplify', 'exempt', 'exert', 'exodus', 'expenditure',
            'explicit', 'exponential', 'facade', 'facet', 'feasible', 'fiscal', 'fledgling',
            'fluctuation', 'foremost', 'formidable', 'foster', 'fragile', 'frivolous', 'futile',
            'genesis', 'globalization', 'governance', 'gratuitous', 'gregarious', 'haphazard',
            'heterogeneous', 'holistic', 'homogeneous', 'hypothetical', 'ideological', 'illicit',
            'imminent', 'impair', 'imperative', 'implausible', 'implicit', 'impose', 'improvise',
            'inadvertent', 'inception', 'indigenous', 'indispensable', 'inertia', 'infer', 'influx',
            'innovative', 'instigate', 'intangible', 'interim', 'intermittent', 'intractable',
            'inundate', 'invoke', 'irrevocable', 'juxtapose', 'kinetic', 'labyrinth', 'latent',
            'legitimate', 'lethal', 'leverage', 'lucrative', 'magnitude', 'mandatory', 'marginal',
            'meticulous', 'mitigate', 'monetary', 'monopoly', 'multifaceted', 'nascent',
            'negligible', 'niche', 'nomenclature', 'nominal', 'nostalgia', 'nuance', 'obsolete',
            'optimal', 'optimize', 'orchestrate', 'orthodox', 'oscillate', 'outweigh', 'overt',
            'panacea', 'paradox', 'paramount', 'peripheral', 'perpetuate', 'pertinent', 'pivotal',
            'plausible', 'plight', 'polarize', 'pragmatic', 'precarious', 'precedent', 'predicament',
            'predominantly', 'prerequisite', 'prevalent', 'pristine', 'proactive', 'procrastinate',
            'profound', 'proliferate', 'propensity', 'prospective', 'prototype', 'provisional',
            'proximity', 'prudent', 'ramification', 'rationale', 'reciprocal', 'reconcile',
            'redundant', 'refute', 'relentless', 'relinquish', 'reminiscent', 'render', 'repercussion',
            'replicate', 'repudiate', 'requisite', 'resilient', 'resurgence', 'rhetoric', 'rigorous',
            'robust', 'rudimentary', 'salient', 'sanction', 'saturate', 'scrutinize', 'seminal',
            'solitary', 'sporadic', 'stagnant', 'stakeholder', 'stipulate', 'stringent', 'subjective',
            'subordinate', 'substantiate', 'subtle', 'superfluous', 'supplement', 'surge', 'surplus',
            'susceptible', 'sustainable', 'synergy', 'synthesize', 'tangible', 'tentative',
            'transcend', 'transparent', 'trivial', 'ubiquitous', 'underpin', 'unprecedented',
            'unwarranted', 'uphold', 'utilitarian', 'venture', 'versatile', 'viable', 'vigorous',
            'vindicate', 'volatile', 'vulnerable', 'watershed', 'zealous',
            // Nature / biology specific
            'habitat', 'species', 'predator', 'prey', 'adaptation', 'ecosystem', 'biodiversity',
            'conservation', 'extinction', 'fauna', 'flora', 'herbivore', 'carnivore', 'omnivore',
            'migration', 'breeding', 'offspring', 'territory', 'population', 'organism',
            'mammal', 'reptile', 'amphibian', 'vertebrate', 'invertebrate', 'aquatic',
            'terrestrial', 'tropical', 'temperate', 'arid', 'indigenous', 'endemic',
            'ancestor', 'descendant', 'evolution', 'genetic', 'chromosome', 'mutation',
            'natural selection', 'survival', 'diversity', 'classify', 'taxonomy',
            'dominance', 'symbiosis', 'parasite', 'decompose', 'photosynthesis',
            'tolerance', 'resilience', 'abundance', 'scarcity', 'forage', 'graze',
            'domesticate', 'livestock', 'pasture', 'browse', 'ruminant', 'bovid'
        ]);

        // Find academic words present in text
        const textLower = text.toLowerCase();
        const textWordsUnique = [...new Set(wordsLower)];
        textWordsUnique.forEach(w => {
            if (w.length >= 5 && academicWords.has(w)) {
                const idx = wordsLower.indexOf(w);
                const originalWord = idx >= 0 ? words[idx] : w;
                addTerm(originalWord, 'vocabulary');
            }
        });

        // ── 8. WORDS WITH ACADEMIC SUFFIXES (catch anything the list missed) ──
        const academicSuffixes = [
            'tion', 'sion', 'ment', 'ness', 'ity', 'ence', 'ance', 'ism', 'ist',
            'ive', 'ous', 'ful', 'less', 'ible', 'able', 'ical', 'ial',
            'ize', 'ise', 'ate', 'ify',
            'ogy', 'ure', 'dom', 'ship'
        ];
        textWordsUnique.forEach(w => {
            if (w.length >= 8 && !addedLower.has(w)) {
                const hasAcademicSuffix = academicSuffixes.some(s => w.endsWith(s));
                if (hasAcademicSuffix) {
                    const idx = wordsLower.indexOf(w);
                    const originalWord = idx >= 0 ? words[idx] : w;
                    addTerm(originalWord, 'vocabulary');
                }
            }
        });

        // ── 9. LESS COMMON / LONGER WORDS (likely important vocabulary) ──
        const commonStopWords = new Set([
            'the', 'and', 'that', 'this', 'with', 'from', 'they', 'have', 'been',
            'were', 'will', 'would', 'could', 'should', 'their', 'there', 'which',
            'when', 'what', 'where', 'who', 'whom', 'whose', 'these', 'those',
            'than', 'then', 'them', 'some', 'such', 'into', 'over', 'also',
            'more', 'most', 'very', 'much', 'many', 'each', 'every', 'both',
            'same', 'other', 'another', 'about', 'after', 'before', 'between',
            'under', 'above', 'below', 'while', 'during', 'through', 'because',
            'since', 'until', 'though', 'although', 'however', 'still', 'just',
            'only', 'even', 'well', 'back', 'being', 'does', 'done', 'going',
            'come', 'came', 'went', 'gone', 'said', 'told', 'made', 'found',
            'know', 'knew', 'known', 'take', 'took', 'taken', 'give', 'gave',
            'given', 'like', 'look', 'see', 'saw', 'seen', 'way', 'may',
            'might', 'shall', 'can', 'not', 'but', 'for', 'are', 'was',
            'his', 'her', 'its', 'our', 'your', 'any', 'all', 'had',
            'has', 'him', 'how', 'man', 'new', 'now', 'old', 'one',
            'two', 'three', 'out', 'own', 'part', 'per', 'say', 'she',
            'too', 'use', 'used', 'using'
        ]);

        textWordsUnique.forEach(w => {
            if (w.length >= 8 && !addedLower.has(w) && !commonStopWords.has(w)) {
                const idx = wordsLower.indexOf(w);
                const originalWord = idx >= 0 ? words[idx] : w;
                addTerm(originalWord, 'vocabulary');
            }
        });

        // ── 10. SPECIAL GRAMMAR STRUCTURES (advanced/non-trivial only) ──
        const structurePatterns = [
            { regex: /\bnot only\b[^.]*?\bbut also\b/gi, name: 'not only... but also' },
            { regex: /\bthe more\b[^.]*?\bthe more\b/gi, name: 'the more... the more' },
            { regex: /\bthe \w+er\b[^,]*?,\s*\bthe \w+er\b/gi, name: 'the + comparative... the + comparative' },
            { regex: /\bneither\b[^.]*?\bnor\b/gi, name: 'neither... nor' },
            { regex: /\bhad\s+(?:I|he|she|we|they|it)\s+\w+/gi, name: 'inverted conditional (Had + S + V3)' },
            { regex: /\bwere\s+(?:I|he|she|we|they|it)\s+to\b/gi, name: 'subjunctive (Were + S + to V)' },
            { regex: /\bno sooner\b[^.]*?\bthan\b/gi, name: 'no sooner... than' },
            { regex: /\bhardly\b[^.]*?\bwhen\b/gi, name: 'hardly... when' },
            { regex: /\bscarcely\b[^.]*?\bwhen\b/gi, name: 'scarcely... when' },
            { regex: /\bso\s+\w+\s+that\b/gi, name: 'so + adj/adv + that' },
            { regex: /\bsuch\s+(?:a|an)?\s*\w+\s+(?:\w+\s+)?that\b/gi, name: 'such + noun + that' },
        ];
        for (const sp of structurePatterns) {
            if (sp.regex.test(text)) addTerm(sp.name, 'grammar');
            sp.regex.lastIndex = 0;
        }

        // ── 11. FIXED PREPOSITIONAL PHRASES (idiom-level, not basic ones) ──
        const fixedPhrases = [
            { regex: /\bin spite of\b/gi,         name: 'in spite of' },
            { regex: /\bregardless of\b/gi,        name: 'regardless of' },
            { regex: /\bby virtue of\b/gi,         name: 'by virtue of' },
            { regex: /\bin light of\b/gi,          name: 'in light of' },
            { regex: /\bon account of\b/gi,        name: 'on account of' },
            { regex: /\bas a result of\b/gi,       name: 'as a result of' },
            { regex: /\bas a consequence\b/gi,     name: 'as a consequence' },
            { regex: /\bwith regard to\b/gi,       name: 'with regard to' },
            { regex: /\bin terms of\b/gi,          name: 'in terms of' },
            { regex: /\bin addition to\b/gi,       name: 'in addition to' },
            { regex: /\bon the other hand\b/gi,    name: 'on the other hand' },
            { regex: /\bnotwithstanding\b/gi,      name: 'notwithstanding' },
            { regex: /\bby and large\b/gi,         name: 'by and large' },
            { regex: /\ball things considered\b/gi, name: 'all things considered' },
        ];
        for (const fp of fixedPhrases) {
            if (fp.regex.test(text)) addTerm(fp.name, 'idiom');
            fp.regex.lastIndex = 0;
        }

        // Sort: phrases (multi-word) first, then by text appearance order
        results.sort((a, b) => {
            const aIsPhrase = /\s/.test(a.text) ? 0 : 1;
            const bIsPhrase = /\s/.test(b.text) ? 0 : 1;
            if (aIsPhrase !== bIsPhrase) return aIsPhrase - bIsPhrase;
            const idxA = textLower.indexOf(a.text.toLowerCase());
            const idxB = textLower.indexOf(b.text.toLowerCase());
            return (idxA === -1 ? 9999 : idxA) - (idxB === -1 ? 9999 : idxB);
        });

        // Deep-scan mode: keep a much larger pool and don't starve standalone vocabulary
        // (previously capped at 8, which silently dropped good words like "pivotal"/"sustainable").
        const MAX_TOTAL = 70;
        const MAX_VOCAB = 30;
        const filtered = [];
        let vocabCount = 0;
        for (const item of results) {
            if (filtered.length >= MAX_TOTAL) break;
            if (item.category === 'vocabulary') {
                if (vocabCount >= MAX_VOCAB) continue;
                vocabCount++;
            }
            filtered.push(item);
        }

        return filtered;
    }
}

window.ContextTranslator = ContextTranslator;
