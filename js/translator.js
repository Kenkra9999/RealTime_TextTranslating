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
     * Common AI-call helper used by EVERY schema-bound endpoint (per-paragraph align + retry
     * patch). Routes to OpenAI or Gemini with provider-native strict-schema enforcement, so
     * the model cannot return prose / markdown — we always get a JSON object matching the
     * supplied `schema`.
     *
     * OpenAI: uses tool-use (function-calling) with `tool_choice: required` pointing at a
     *         single function named `schemaName`. This works on every current model (gpt-4o,
     *         gpt-4o-mini, gpt-4-turbo, gpt-3.5-turbo) — more portable than `response_format:
     *         json_schema` which is only on gpt-4o-2024-08+ and later.
     * Gemini: uses `responseSchema` + `responseMimeType: application/json`. Equivalent
     *         constraint, enforced server-side.
     *
     * Returns the parsed JSON object on success, or `null` on any failure (auth, schema
     * mismatch, network). Caller is responsible for validating the schema shape.
     */
    async _callProviderJson(prompt, schema, schemaName) {
        if (this.provider === 'openai' && this.openaiApiKey) {
            try {
                const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
                    body: JSON.stringify({
                        model: this.openaiModel,
                        messages: [{ role: 'user', content: prompt }],
                        tools: [{
                            type: 'function',
                            function: { name: schemaName, description: 'Return structured data per schema.', parameters: schema, strict: true }
                        }],
                        tool_choice: { type: 'function', function: { name: schemaName } },
                        temperature: 0
                    })
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
                if (!args) return null;
                try { return JSON.parse(args); } catch (e) { return null; }
            } catch (e) { return null; }
        }
        if (this.geminiApiKey) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0,
                            responseMimeType: 'application/json',
                            responseSchema: schema
                        }
                    })
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) return null;
                try { return JSON.parse(text); } catch (e) { return null; }
            } catch (e) { return null; }
        }
        return null;
    }

    /**
     * RETRY-PATCH PASS — fills in markers the first translation+alignment pass missed.
     *
     * WHY: the first translate pass + per-paragraph alignment (above) sometimes STILL misses
     * wrapping some Vietnamese counterparts (typically paraphrased phrases like "sự phát triển"
     * for "progress", or words the AI deemed not relevant). Instead of calling `translateAndAnalyze`
     * again (which costs a full re-translation + double billing), we send a SMALL JSON-patch
     * request listing ONLY the missing English keys + the already-marked Vietnamese text, and
     * ask the AI to return the EXACT Vietnamese span to wrap for each missing key. App.js then
     * stitches the new [[H:key]]…[[/H]] pairs into `markedText` itself (no full re-render).
     *
     * Contract: returns { patches: [{ key, vn, verified }] } — each `vn` is the verbatim
     * Vietnamese span the AI wants to wrap for that `key`. `verified: true` means the span
     * was found verbatim in `markedText` (after stripping existing [[H:...]] tags); `false`
     * means the AI hallucinated and we fell back to the closest substring that still matches
     * (tolerating only whitespace and trailing punctuation). Empty patches array means the AI
     * still couldn't find a counterpart (we give up rather than retry forever — option A from
     * the spec).
     *
     * LIMIT: 1 retry per translate request (caller checks `coverageRatio < 1` and stops
     * regardless of how good the patches look — prevents runaway billing on adversarial inputs).
     */
    async repairMissingMarkers(markedText = '', missingKeys = [], highlights = [], vocabList = []) {
        const empty = { patches: [] };
        const src = (markedText || '').toString();
        if (!src.trim() || !Array.isArray(missingKeys) || missingKeys.length === 0) return empty;

        // Build a map enKey -> highlight index (so the AI can use [[H:index]] form too, but
        // we mostly want it to RETURN spans so we can stitch manually and avoid re-render).
        const norm = (s) => (s || '').toString().toLowerCase().trim()
            .replace(/[\u00A0\u2000-\u200B]/g, ' ')
            .replace(/\s+/g, ' ')
            .normalize('NFC');
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
        // Vocab hint per missing key (translatedTermInVN / exampleVi) so the AI knows what
        // semantic class to look for — even though it ultimately returns its own span.
        const hintsByKey = {};
        (vocabList || []).forEach(v => {
            const k = canonEn(v.original);
            if (!k || !missingKeys.includes(k)) return;
            const hints = [];
            if (v.translatedTermInVN) hints.push(v.translatedTermInVN);
            if (v.exampleVi) hints.push(v.exampleVi);
            if (hints.length) hintsByKey[k] = hints;
        });

        const numbered = missingKeys.map((k, i) => {
            const hints = hintsByKey[k];
            const hintStr = hints && hints.length ? ` (gợi ý cụm Việt có thể có: ${hints.map(h => `"${h.replace(/"/g, "'")}"`).join(' / ')})` : '';
            return `${i}. "${k}"${hintStr}`;
        }).join('\n');

        const prompt = `Bạn là chuyên gia đối chiếu song ngữ Anh-Việt. Dưới đây là MỘT bản dịch tiếng Việt ĐÃ ĐƯỢC BỌC THẺ 1 PHẦN bằng cặp [[H:english]]cụm việt[[/H]], và một DANH SÁCH TỪ TIẾNG ANH CÒN THIẾU thẻ (đánh số từ 0).
Nhiệm vụ: với MỖI từ/cụm tiếng Anh trong danh sách THIẾU mà bạn tìm thấy phần dịch tiếng Việt tương ứng XUẤT HIỆN trong bản dịch (kể cả khi nằm giữa các thẻ [[H:…]]…[[/H]] đã có), hãy trả về đúng cụm tiếng Việt đó (verbatim, giữ nguyên hoa/thường, dấu câu). KHÔNG trả về giải thích, KHÔNG trả về cả câu — CHỈ trả cụm cần bọc.

QUY TẮC BẮT BUỘC:
- Trả về DUY NHẤT JSON (không kèm markdown). Field "patches" là mảng các {key, vn}:
  • key = từ/cụm tiếng Anh (COPY NGUYÊN từ danh sách đánh số bên dưới).
  • vn  = cụm tiếng Việt verbatim đã xuất hiện trong bản dịch. Nếu không tìm thấy thì BỎ QUA key đó (không ép buộc).
- Bọc TRỌN VẸN cả cụm: nếu cụm tiếng Anh là "Paradox of Progress" và tiếng Việt là "Nghịch lý của sự tiến bộ" thì trả về vn = "Nghịch lý của sự tiến bộ" (kể cả hư từ nối ở giữa), KHÔNG trả "Nghịch lý" rồi "tiến bộ" tách rời.
- Tôn trọng trật tự tiếng Việt (đảo thứ tự so với tiếng Anh vẫn OK, vd "nghịch lý của tiến bộ" cho "paradox of progress").
- Chỉ chọn cụm đã THỰC SỰ xuất hiện trong bản dịch. Không bịa.

DANH SÁCH TỪ TIẾNG ANH CÒN THIẾU THẺ:
${numbered}

BẢN DỊCH TIẾNG VIỆT (đã có sẵn thẻ [[H:…]]vn[[/H]] một phần; chỉ dùng để tra cứu vị trí, KHÔNG trả lại):
"""
${src}
"""`;

        // Strict schema — provider-native enforcement (OpenAI tool-use / Gemini responseSchema).
        // `additionalProperties: false` so the model cannot smuggle in stray fields.
        const patchSchema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                patches: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            key: { type: 'string', description: 'English key copied verbatim from the numbered list.' },
                            vn:  { type: 'string', description: 'Verbatim Vietnamese span found inside markedText.' }
                        },
                        required: ['key', 'vn']
                    }
                }
            },
            required: ['patches']
        };

        const parsed = await this._callProviderJson(prompt, patchSchema, 'return_repair_patches');
        if (!parsed) return empty;
        const raw_patches = Array.isArray(parsed.patches) ? parsed.patches : [];
        // Validate: each patch must reference a real missing key, and the vn span must either
        // exist VERBATIM in markedText (verified=true → data-source "ai-verified") OR be close
        // enough to a substring after tolerating whitespace / leading/trailing punctuation
        // (verified=false → data-source "ai-retried", the renderer will still try to use it
        // via fuzzy match and the user will see the ⚠️ marker to confirm manually).
        //
        // Strip the existing [[H:...]] tags from src so "duplicate-of-existing" detection still
        // works — a patch that targets a span INSIDE an existing marker is invalid (would double-wrap).
        const stripped = src.replace(/\[\[H:[^\]]*?\]\]/g, '').replace(/\[\[\/H\]\]/g, '');
        const valid = [];
        for (const p of raw_patches) {
            if (!p || typeof p.key !== 'string' || typeof p.vn !== 'string') continue;
            const key = canonEn(p.key);
            if (!key || !missingKeys.includes(key)) continue;
            const vn = p.vn.trim();
            if (!vn) continue;
            if (stripped.includes(vn)) {
                valid.push({ key, vn, verified: true });
                continue;
            }
            // Tolerate leading/trailing punctuation OR whitespace drift only (no char-level reword).
            // Try collapsing all whitespace in BOTH sides and re-locating. If the AI added a stray
            // space inside ("Hơn nữa ," vs "Hơn nữa,"), we won't accept it — too risky.
            const vnNorm = vn.replace(/\s+/g, ' ').trim();
            const strippedNorm = stripped.replace(/\s+/g, ' ');
            if (strippedNorm.includes(vnNorm)) {
                // Re-locate the actual span to preserve original whitespace/punctuation in the
                // output (we don't want to rewrite the document). Find the first occurrence of
                // the normalised span in the original stripped text.
                const idx = stripped.indexOf(vn);
                let actual = '';
                if (idx >= 0) actual = vn;
                else {
                    // Looser match: locate any span matching pattern `\s*vnNorm\s*` (punct allowed).
                    const re = new RegExp(`(?:^|\\b|[\\s,.;:()])(${vnNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:$|\\b|[\\s,.;:()])`);
                    const m = re.exec(stripped);
                    if (m) actual = m[1];
                }
                if (actual) {
                    valid.push({ key, vn: actual, verified: false });
                    continue;
                }
            }
            // Couldn't verify → drop it (AI hallucinated). Renderer will fall back to string-match.
        }
        return { patches: valid };
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

        // ── PER-ITEM VERIFY (LỚP 1.2) ───────────────────────────────────────────────
        // Skeleton check (parity of letters/digits after stripping all tags) catches any
        // reword, but it does NOT guarantee each individual `vn` actually appears in `para`.
        // The AI can still smuggle in a hallucinated span — e.g. copy "chứng kiến" for an
        // English term whose actual translation in this paragraph was "nhìn thấy". For each
        // alignment, we VERIFY by code that `para` actually contains `vn` (after tolerating
        // whitespace and trailing punctuation only — NO char-level reword is allowed).
        //
        // Failures are retried with a tighter prompt asking the AI for the EXACT verbatim
        // span (max 2 retries), then dropped entirely if still unverifiable. The renderer
        // uses the per-item `verified` flag to tag data-source on each <mark>:
        //   verified=true  → "ai-verified"   (machine is certain — no ⚠️ in UI)
        //   verified=false → "ai-retried"    (machine is uncertain — ⚠️ in UI, user must confirm)
        const verifyVnSpan = (vn, paragraph) => {
            if (!vn) return false;
            if (paragraph.includes(vn)) return true;
            // Tolerate whitespace drift only (no punctuation addition).
            const vnNorm = vn.replace(/\s+/g, ' ');
            const paraNorm = paragraph.replace(/\s+/g, ' ');
            return paraNorm.includes(vnNorm);
        };
        const findClosestSpan = (vn, paragraph) => {
            // Used as a last-ditch fallback: try to locate ANY span in paragraph that matches
            // the core words of vn in order (allowing up to 1 missing word), so the AI's "rough
            // idea" still has a paintable target instead of being silently dropped.
            const words = vn.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
            if (words.length < 2) return '';
            // Sliding window: for every n-1, n, n+1 word window starting at each position.
            for (let len = words.length; len >= Math.max(2, words.length - 1); len--) {
                if (len > words.length) continue;
                for (let i = 0; i + len <= words.length; i++) {
                    const win = words.slice(i, i + len).join(' ');
                    if (paragraph.includes(win)) return win;
                }
            }
            return '';
        };

        const retryOneItem = async (item) => {
            // Up to 2 retries. Tight prompt: only this English term + verbatim span, nothing else.
            const term = (highlights[item.index] && (highlights[item.index].text || highlights[item.index].word)) || '';
            const tightPrompt = `Tìm cụm tiếng Việt CHÍNH XÁC (verbatim, giữ nguyên hoa/thường/dấu câu) là phần dịch của cụm tiếng Anh "${term}" trong đoạn dưới. Trả về DUY NHẤT JSON {"vn": "<cụm verbatim>"} — hoặc {"vn": ""} nếu không có.
ĐOẠN:
"""
${para}
"""`;
            const tightSchema = {
                type: 'object', additionalProperties: false,
                properties: { vn: { type: 'string' } },
                required: ['vn']
            };
            for (let attempt = 0; attempt < 2; attempt++) {
                const r = await this._callProviderJson(tightPrompt, tightSchema, 'return_single_vn');
                if (!r || typeof r.vn !== 'string') continue;
                const cand = r.vn.trim();
                if (!cand) return '';
                if (verifyVnSpan(cand, para)) return cand;
            }
            return '';
        };

        const alignments = extractAlignments(marked);
        // Verify every alignment and tag `verified` accordingly. Failures get a 2-attempt retry;
        // still-unverifiable items keep their `verified=false` so the UI shows ⚠️ for them.
        for (let i = 0; i < alignments.length; i++) {
            const a = alignments[i];
            if (verifyVnSpan(a.vn, para)) {
                a.verified = true;
                continue;
            }
            // Try tight per-item retry.
            const retryVn = await retryOneItem(a);
            if (retryVn) {
                a.vn = retryVn;
                a.verified = true;
                continue;
            }
            // Last-ditch: locate closest window inside para so the renderer still has a target.
            const closest = findClosestSpan(a.vn, para);
            if (closest) {
                a.vn = closest;
                a.verified = false;
            } else {
                a.verified = false; // will be dropped by app.js if no substring match either
            }
        }

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
     * Dictionary Lookup Mode: instant word/phrase lookup.
     * Returns { word, ipa, pos, meaning, example, exampleVi, source }.
     * Always resolves fast — offline dictionary/estimation gives an instant baseline,
     * then (if an AI key is configured) the meaning/example are upgraded with an
     * AI lookup that returns the MOST COMMON dictionary sense (Oxford/Cambridge style)
     * and a NATURAL English example sentence containing the word/phrase.
     *
     * PER USER REQUEST (Aug 1 2026):
     *  - No source-sentence context is sent. The meaning comes from the dictionary,
     *    not from the surrounding sentence the user is reading.
     *  - `example` is a natural English sentence (Oxford/Cambridge style) containing
     *    the word/phrase — NOT "Example with X", NOT something made-up on the fly.
     *  - `exampleVi` is the Vietnamese translation of that example.
     */
    async lookupWord(word, _sentenceContextIgnored = '') {
        const cleanWord = (word || '').trim();
        if (!cleanWord) return null;

        if (!this._lookupCache) this._lookupCache = new Map();
        const cacheKey = `v6|${cleanWord.toLowerCase()}`;
        if (this._lookupCache.has(cacheKey)) return this._lookupCache.get(cacheKey);

        const dict = window.dictionaryDB;
        const isPhrase = cleanWord.includes(' ');

        let result = {
            word: cleanWord,
            isPhrase: isPhrase,
            // Use curated IPA ONLY when the word has a real dictionary entry.
            // Otherwise start from '/.../' so we never persist a wrong estimate;
            // the per-word breakdown below (and `_correctIpaForSession`) will
            // fill the correct value from AI shortly.
            ipa: (dict && dict.hasRealEntry && dict.hasRealEntry(cleanWord))
                ? (dict.getIPA(cleanWord) || '/.../')
                : '/.../',
            pos: isPhrase ? 'phrase' : (dict ? dict.getPOS(cleanWord) : 'n.'),
            meaning: dict ? dict.getMeaning(cleanWord) : null,
            breakdown: [],
            example: null,
            exampleVi: null,
            structures: [],
            source: 'offline'
        };

        try {
            const ai = await this._lookupWithAI(cleanWord, '');
            if (ai) {
                // Reject obviously bad AI IPA — sometimes the model just echoes the
                // raw word/phrase instead of producing a real transcription
                // (e.g. "perpetual interruption" → "/perpetual interruption/").
                // We only accept IPA that contains phonetic symbols OR is shorter
                // than the source word (typical for single-syllable IPA). If the
                // AI's "IPA" is just the source word re-printed between slashes,
                // we throw it away and let the dict + dedicated IPA fetch fix it.
                const sanitizedIpa = this._sanitizeAiIpa(ai.ipa || '', cleanWord);
                result = {
                    word: cleanWord,
                    isPhrase: isPhrase,
                    ipa: sanitizedIpa || result.ipa,
                    pos: ai.pos || result.pos,
                    meaning: ai.meaning || result.meaning,
                    breakdown: Array.isArray(ai.breakdown) ? ai.breakdown : [],
                    example: ai.example || null,
                    exampleVi: ai.exampleVi || null,
                    structures: Array.isArray(ai.structures) ? ai.structures : [],
                    source: 'ai'
                };
                if (!isPhrase && (result.breakdown.length === 0)) {
                    result.breakdown = [{
                        word: cleanWord,
                        ipa: result.ipa,
                        pos: result.pos,
                        meaning: result.meaning
                    }];
                }
            }
        } catch (e) {
            console.warn('AI dictionary lookup failed, using offline fallback:', e);
        }

        if (!result.meaning) {
            try {
                const t = await this._translateSentenceFree(cleanWord);
                if (t && t.trim().toLowerCase() !== cleanWord.toLowerCase()) result.meaning = t;
            } catch (e) { /* ignore */ }
        }

        // Build a per-word breakdown even when AI is unavailable or returned none.
        // For a phrase, split into component words; for a single word, one entry.
        if (!Array.isArray(result.breakdown) || result.breakdown.length === 0) {
            result.breakdown = await this._buildOfflineBreakdown(cleanWord);
        } else {
            // AI gave a breakdown but some meanings/IPA may be missing — fill gaps offline.
            result.breakdown = await this._fillBreakdownGaps(result.breakdown);
        }

// Correct the top-level (header) IPA so it is never a wrong estimate.
// Single word: reuse the (now accurate) breakdown IPA, but only if it's a real
// phonetic string — the breakdown may have been left as '/.../' if neither dict
// nor AI knew it, and we want to keep that placeholder visible.
// Phrase: if AI gave no phrase IPA and the dict has no real entry, ask AI.
const dictHasPhrase = dict && dict.hasRealEntry(cleanWord);
const aiGaveIpa = result.source === 'ai' && result.ipa && !/\.\.\./.test(result.ipa) && !!this._sanitizeAiIpa(result.ipa, cleanWord);
if (!isPhrase && Array.isArray(result.breakdown) && result.breakdown[0] && result.breakdown[0].ipa && !/\.\.\./.test(result.breakdown[0].ipa)) {
    result.ipa = result.breakdown[0].ipa;
} else if (!isPhrase && (!result.ipa || /\.\.\./.test(result.ipa))) {
    // Single word but we still don't have a verified IPA — fetch one now.
    const map = await this._fetchIpaForWords([cleanWord]).catch(() => ({}));
    const fetched = map[cleanWord.toLowerCase()];
    if (fetched && this._sanitizeAiIpa(fetched, cleanWord)) result.ipa = fetched;
} else if (isPhrase && !aiGaveIpa && !dictHasPhrase) {
    const map = await this._fetchIpaForWords([cleanWord]).catch(() => ({}));
    const fetched = map[cleanWord.toLowerCase()];
    if (fetched && this._sanitizeAiIpa(fetched, cleanWord)) result.ipa = fetched;
}

        // Example sentence MUST be a natural, real English sentence containing the
        // word/phrase (per user's required form: "I eat breakfast every morning.").
        // If AI didn't supply one, ask AI again with a focused example-only prompt.
        // Only fall back to a template sentence if AI is truly unavailable.
        if (!result.example || !this._looksLikeNaturalExample(result.example, cleanWord)) {
            const aiEx = await this._generateExampleWithAI(cleanWord).catch(() => null);
            if (aiEx && aiEx.example) {
                result.example = aiEx.example;
                result.exampleVi = aiEx.exampleVi || result.exampleVi;
            }
        }

        // Ensure the example has a Vietnamese translation.
        if (result.example && !result.exampleVi) {
            try {
                result.exampleVi = (await this._translateSentenceFree(result.example)) || '';
            } catch (e) { /* ignore */ }
        }

        // Last-resort fallback ONLY when no AI is configured at all.
        if (!result.example) {
            const en = cleanWord.includes(' ')
                ? `The ${cleanWord} was clearly visible in the report.`
                : `She used the word "${cleanWord}" in her essay.`;
            result.example = en;
            if (!result.exampleVi) {
                try { result.exampleVi = (await this._translateSentenceFree(en)) || en; }
                catch (e) { result.exampleVi = en; }
            }
        }

        this._lookupCache.set(cacheKey, result);
        return result;
    }

    /**
     * Heuristic: a "natural" example must actually contain the looked-up
     * word/phrase and must NOT be one of the placeholder templates the AI
     * sometimes falls back to ("Example with X", "The word X ...", etc.).
     */
    _looksLikeNaturalExample(example, word) {
        if (!example || !word) return false;
        const ex = example.trim().toLowerCase();
        const w = word.trim().toLowerCase();
        if (ex.length < 8) return false;
        // Reject known placeholder shapes.
        const bad = [
            `the word "${w}"`,
            `the phrase "${w}"`,
            `example with ${w}`,
            `this is ${w}`,
            `${w} is commonly used`,
            `${w} appears in`
        ];
        if (bad.some(b => ex.includes(b))) return false;
        // Must contain the word (or, for phrases, its first significant token).
        const firstTok = w.split(/\s+/)[0];
        return ex.includes(w) || ex.includes(firstTok);
    }

    /**
     * Validates IPA returned by the dictionary AI. Sometimes the model just echoes
     * the source word between slashes (e.g. "/perpetual interruption/") instead of
     * producing real phonetic symbols, which we then store as truth and the user
     * sees as a wrong transcription. We only accept IPA that:
     *   - contains at least one phonetic symbol from the IPA alphabet, OR
     *   - is shorter than the source word (typical for short single-syllable IPA),
     *   - AND is not just the source word re-printed inside slashes.
     * Otherwise we return '' so the caller falls back to the dictionary + dedicated
     * IPA fetch rather than showing a fabricated transcription.
     */
    _sanitizeAiIpa(ipa, sourceWord) {
        const out = (ipa || '').trim();
        if (!out) return '';
        const word = (sourceWord || '').trim().toLowerCase();
        if (!word) return out;
        // Strip slashes for comparison.
        const inner = out.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
        // Hard reject: AI echoed the source word (or its first/last token) back.
        if (inner === word) return '';
        const firstTok = word.split(/\s+/)[0];
        const lastTok = word.split(/\s+/).slice(-1)[0];
        if (inner === firstTok || inner === lastTok) return '';
        // Phrase echo: inner is the source phrase with spaces collapsed.
        const collapsed = inner.replace(/\s+/g, ' ');
        const wordCollapsed = word.replace(/\s+/g, ' ');
        if (collapsed === wordCollapsed) return '';
        // Accept when the inner contains any IPA-only symbol (anything outside
        // basic ASCII letters). This catches ə, ʃ, æ, ð, θ, ŋ, ɪ, ʊ, ɛ, etc.
        if (/[^a-z\s]/i.test(inner)) return out;
        // Single-word edge case: short word whose IPA might still be ASCII letters
        // (rare). Accept only when inner is meaningfully shorter than the word
        // (signals the AI actually compressed it).
        if (!word.includes(' ') && inner.length > 0 && inner.length < word.length) return out;
        return '';
    }

    /**
     * Focused AI call that returns ONLY a natural example sentence + its Vietnamese
     * translation for a word/phrase. Used when the main lookup response lacked a
     * usable example. Returns {example, exampleVi} or null when AI unavailable.
     */
    async _generateExampleWithAI(word) {
        const hasOpenAI = this.provider === 'openai' && this.openaiApiKey;
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || !this.openaiApiKey);
        if (!hasOpenAI && !hasGemini) return null;

        const prompt = `Cho 1 câu tiếng Anh TỰ NHIÊN, NGẮN GỌN, DỄ HIỂU (như câu ví dụ trong từ điển Oxford/Cambridge) có chứa "${word}", kèm bản dịch tiếng Việt tự nhiên.
VÍ DỤ MẪU đúng yêu cầu:
- "eat" → {"example":"I eat breakfast every morning.","exampleVi":"Tôi ăn sáng mỗi buổi sáng."}
- "profound transformation" → {"example":"Technology has brought about a profound transformation in modern society.","exampleVi":"Công nghệ đã mang lại một sự biến đổi sâu sắc trong xã hội hiện đại."}
KHÔNG dùng câu mẫu kiểu "The word X...", "Example with X", "This is X".
Trả về ĐÚNG JSON: {"example":"...","exampleVi":"..."}`;

        try {
            if (hasOpenAI) {
                const res = await fetch("https://api.openai.com/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
                    body: JSON.stringify({
                        model: this.openaiModel,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: "json_object" },
                        temperature: 0.3
                    })
                });
                if (!res.ok) return null;
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
                        generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
                    })
                });
                if (!res.ok) return null;
                const data = await res.json();
                const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                return JSON.parse(rawText.replace(/```json|```/g, '').trim());
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    /**
     * Fetches ACCURATE IPA transcriptions from AI for a list of words. Used for
     * words that aren't in the curated offline dictionary (whose IPA would
     * otherwise be a rough estimate). Returns a map { word(lowercase): "/ipa/" }.
     * Returns {} when AI is unavailable or on error.
     */
    async _fetchIpaForWords(words) {
        const uniq = [...new Set((words || [])
            .map(w => (w || '').trim().toLowerCase())
            .filter(Boolean))];
        if (uniq.length === 0) return {};

        const hasOpenAI = this.provider === 'openai' && this.openaiApiKey;
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || !this.openaiApiKey);
        if (!hasOpenAI && !hasGemini) return {};

        if (!this._ipaCache) this._ipaCache = new Map();
        const need = uniq.filter(w => !this._ipaCache.has(w));

        if (need.length > 0) {
            const prompt = `Cho IPA (phiên âm quốc tế) CHUẨN của các từ/cụm từ tiếng Anh sau (giọng Anh-Anh, kèm dấu nhấn ˈ và ˌ, bọc trong dấu /.../). KHÔNG tự bịa — dùng IPA chuẩn như từ điển Cambridge/Oxford.
Danh sách: ${JSON.stringify(need)}
Trả về ĐÚNG JSON dạng: {"word1":"/ipa1/","word2":"/ipa2/"} (key là từ chữ thường, đúng như trong danh sách).`;
            try {
                let obj = {};
                if (hasOpenAI) {
                    const res = await fetch("https://api.openai.com/v1/chat/completions", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.openaiApiKey}` },
                        body: JSON.stringify({
                            model: this.openaiModel,
                            messages: [{ role: 'user', content: prompt }],
                            response_format: { type: "json_object" },
                            temperature: 0
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        obj = JSON.parse(data.choices?.[0]?.message?.content || '{}');
                    }
                } else if (hasGemini) {
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: { temperature: 0, responseMimeType: "application/json" }
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                        obj = JSON.parse(rawText.replace(/```json|```/g, '').trim());
                    }
                }
                Object.keys(obj || {}).forEach((k) => {
                    const key = k.trim().toLowerCase();
                    let val = String(obj[k] || '').trim();
                    if (val && !val.startsWith('/')) val = `/${val}`;
                    if (val && !val.endsWith('/')) val = `${val}/`;
                    if (val && val.length > 2) this._ipaCache.set(key, val);
                });
            } catch (e) { /* ignore — leave uncached words out */ }
        }

        const out = {};
        uniq.forEach((w) => { if (this._ipaCache.has(w)) out[w] = this._ipaCache.get(w); });
        return out;
    }

    /**
     * Splits a word/phrase into component words and builds a breakdown entry for
     * each: {word, ipa, pos, meaning}. Uses the offline dictionary first, then the
     * free translation API for any word whose Vietnamese meaning is missing. This
     * makes the "phân tích từng từ" section work even with no AI key configured.
     */
    async _buildOfflineBreakdown(cleanWord) {
        const dict = window.dictionaryDB;
        // Tokenise on whitespace/hyphen, keep only real words, strip surrounding punctuation.
        const rawTokens = cleanWord.split(/\s+/).filter(Boolean);
        const tokens = rawTokens
            .map(t => t.replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, ''))
            .filter(t => t.length > 0);

        if (tokens.length === 0) return [];

        const entries = tokens.map((tok) => {
            const wordKey = tok.toLowerCase();
            const hasReal = dict && dict.hasRealEntry && dict.hasRealEntry(tok);
            // Use the curated IPA ONLY when the word is a real dictionary entry.
            // Otherwise start from '/.../' so the UI never flashes a wrong estimate;
            // the AI fetch below (or `_correctIpaForSession`) will fill it in shortly.
            const initialIpa = hasReal
                ? (dict.getIPA(tok) || '/.../')
                : '/.../';
            return {
                word: wordKey,
                ipa: initialIpa,
                pos: dict ? dict.getPOS(tok) : 'n.',
                meaning: dict ? dict.getMeaning(tok) : null,
                _needIpa: !hasReal
            };
        });

        // Get accurate IPA from AI for words not in the curated dictionary.
        const wordsNeedingIpa = entries.filter(e => e._needIpa).map(e => e.word);
        const ipaMap = await this._fetchIpaForWords(wordsNeedingIpa).catch(() => ({}));

        // Fill missing per-word meanings via the free translation API (parallel).
        await Promise.all(entries.map(async (e) => {
            if (e._needIpa && ipaMap[e.word]) e.ipa = ipaMap[e.word];
            delete e._needIpa;
            if (!e.meaning) {
                try {
                    const t = await this._translateSentenceFree(e.word);
                    if (t && t.trim().toLowerCase() !== e.word.toLowerCase()) {
                        e.meaning = t.trim();
                    }
                } catch (err) { /* ignore per-word failure */ }
            }
            // No artificial "—" placeholder — leave the meaning empty so the UI
            // shows a clear "đang cập nhật…" state instead of a misleading dash.
            if (!e.meaning) e.meaning = '';
        }));

        return entries;
    }

    /**
     * Fills any missing ipa/pos/meaning in an AI-provided breakdown using the
     * offline dictionary + free translation, so every row is complete.
     */
    async _fillBreakdownGaps(breakdown) {
        const dict = window.dictionaryDB;
        const entries = breakdown.map((b) => {
            const w = (b.word || '').toLowerCase();
            const aiIpa = (b.ipa && b.ipa.trim()) ? b.ipa.trim() : '';
            const hasReal = dict && dict.hasRealEntry && dict.hasRealEntry(w);
            // Use curated dict IPA ONLY when the word is a real dictionary entry.
            // For unknown words start from '/.../' so we never persist a wrong
            // estimate; the AI fetch below will fill it in shortly.
            const ipa = aiIpa || (hasReal && dict.getIPA(w)) || '/.../';
            return {
                word: w,
                ipa,
                pos: (b.pos && b.pos.trim()) ? b.pos.trim() : (dict ? dict.getPOS(w) : 'n.'),
                meaning: (b.meaning && b.meaning.trim()) ? b.meaning.trim() : (dict ? dict.getMeaning(w) : null),
                // Need AI IPA only when AI gave none AND the dictionary has no real entry.
                _needIpa: !aiIpa && !hasReal
            };
        });

        const wordsNeedingIpa = entries.filter(e => e._needIpa).map(e => e.word);
        const ipaMap = await this._fetchIpaForWords(wordsNeedingIpa).catch(() => ({}));

        await Promise.all(entries.map(async (e) => {
            if (e._needIpa && ipaMap[e.word]) e.ipa = ipaMap[e.word];
            delete e._needIpa;
            if (!e.meaning) {
                try {
                    const t = await this._translateSentenceFree(e.word);
                    if (t && t.trim().toLowerCase() !== e.word.toLowerCase()) {
                        e.meaning = t.trim();
                    }
                } catch (err) { /* ignore */ }
            }
            // No artificial "—" placeholder — leave empty so the UI shows
            // "đang cập nhật…" instead of a misleading dash.
            if (!e.meaning) e.meaning = '';
        }));

        return entries;
    }

    /**
     * Calls OpenAI or Gemini (whichever is configured for the main translation API)
     * to get a short, context-aware dictionary entry for a single word/phrase given
     * the sentence it appears in. Returns null if no API key is configured or on error.
     */
    async _lookupWithAI(word, _sentenceIgnored) {
        const hasOpenAI = this.provider === 'openai' && this.openaiApiKey;
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || !this.openaiApiKey);
        if (!hasOpenAI && !hasGemini) return null;

        // PER USER REQUEST (Aug 1 2026): tra từ theo kiểu từ điển THẬT — không phụ thuộc
        // câu đang đọc. Trả nghĩa PHỔ BIẾN, ví dụ là câu tiếng Anh TỰ NHIÊN (như từ
        // điển Oxford/Cambridge, hoặc từ sách/báo thực tế) — KHÔNG phải "Example with X"
        // hay câu AI tự bịa vô nghĩa.
        const prompt = `Bạn là từ điển Anh-Việt Oxford/Cambridge. Tra cứu từ/cụm từ cho người học tiếng Anh.

Từ/cụm từ cần tra: "WORD_PLACEHOLDER"

YÊU CẦU BẮT BUỘC:
1. "ipa": IPA CHUẨN của từ (đơn) hoặc CỦA CẢ CỤM (cụm từ có ' /' giữa các từ, vd: /ˌtɛkˈnɒlədʒɪkəl ɪnəˈveɪʃən/). Cho cụm: trả IPA đầy đủ cả cụm (có 'ˌ' và 'ˈ' rõ ràng).
2. "pos": TỪ ĐƠN: "n." / "v." / "adj." / "adv." / "prep." / "conj." / "pron." / "interj." / "det." / "aux." CỤM TỪ (2+ từ): "phr." hoặc cụ thể ("n. phr." / "v. phr." / "adj. phr." / "idiom").
3. "meaning": TỪ ĐƠN: NGẮN GỌN tiếng Việt (≤8 từ) theo NGHĨA PHỔ BIẾN NHẤT. CỤM TỪ (2+ từ): dịch NGHĨA CẢ CỤM (full phrase), dạng "sự/việc/... + ..." (≤12 từ). KHÔNG dựa vào câu nào — chỉ nghĩa chuẩn từ điển.
4. "breakdown": MẢNG phân tích từng từ (BẮT BUỘC đầy đủ với cụm 2+ từ; từ đơn vẫn trả 1 phần tử). Mỗi phần tử:
   - "word": từ tiếng Anh (chữ thường, đúng dạng gốc)
   - "ipa": IPA chính xác RIÊNG từ đó (vd "profound" → "/prəˈfaʊnd/")
   - "pos": loại từ viết tắt (n. / v. / adj. / adv. / ...), LUÔN có dấu chấm
   - "meaning": nghĩa tiếng Việt RIÊNG từ đó (1-4 từ, dạng từ điển)
   Ví dụ "profound transformation":
   "breakdown": [
     {"word":"profound","ipa":"/prəˈfaʊnd/","pos":"adj.","meaning":"sâu sắc, sâu xa"},
     {"word":"transformation","ipa":"/ˌtrænsfəˈmeɪʃən/","pos":"n.","meaning":"sự biến đổi, sự chuyển đổi"}
   ]
5. "example": BẮT BUỘC — MỘT câu tiếng Anh TỰ NHIÊN, NGẮN GỌN, DỄ HIỂU (kiểu câu ví dụ Oxford/Cambridge) CÓ CHỨA đúng từ/cụm từ. TUYỆT ĐỐI KHÔNG dùng "The word X...", "The phrase X...", "Example with X", "This is X", "X is commonly used". Phải là câu đời thực có nghĩa.
   MẪU ĐÚNG:
   - "eat" → "I eat breakfast every morning."
   - "profound transformation" → "Technology has brought about a profound transformation in modern society."
6. "exampleVi": bản dịch tiếng Việt TỰ NHIÊN của đúng câu example ở trên.
   MẪU: "I eat breakfast every morning." → "Tôi ăn sáng mỗi buổi sáng."
7. "structures": 2-3 cấu trúc / cụm từ / thành ngữ PHỔ BIẾN có chứa hoặc liên quan đến từ. Mỗi cấu trúc: "name", "note" (1 dòng), "example" (câu TỰ NHIÊN), "exampleVi".

Trả về ĐÚNG JSON (không kèm markdown):
{
  "ipa": "phiên âm IPA chuẩn của từ/cụm từ",
  "pos": "loại từ viết tắt",
  "meaning": "nghĩa tiếng Việt ngắn gọn (≤8 từ cho đơn, ≤12 từ cho cụm)",
  "breakdown": [{"word": "từ 1", "ipa": "...", "pos": "...", "meaning": "..."}],
  "example": "câu tiếng Anh TỰ NHIÊN chứa từ",
  "exampleVi": "bản dịch tiếng Việt của câu example",
  "structures": [{"name": "tên cấu trúc", "note": "giải thích 1 dòng", "example": "câu tiếng Anh TỰ NHIÊN", "exampleVi": "bản dịch tiếng Việt"}]
}` .replace(/WORD_PLACEHOLDER/g, word);

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
            const dict = window.dictionaryDB;
            // Use curated IPA ONLY for words actually in the dictionary; otherwise
            // start from '/.../' so we never persist a wrong estimate on the vocab
            // row. `_correctIpaForSession` will fill missing IPAs from AI shortly.
            let ipa = '/.../';
            if (dict && dict.hasRealEntry && dict.hasRealEntry(word)) {
                ipa = dict.getIPA(word) || '/.../';
            }
            let localMeaning = dict ? dict.getMeaning(word) : null;
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
        // Deep-scan mode: cast a much wider net so nothing worth learning slips through.
        // The user (Aug 1 2026) explicitly asked for MORE collocations, phrasal verbs,
        // adv+adj / adv+v combos, V+N / Adj+N / N+N collocations, idioms, AND standout
        // single-word academic vocabulary — even for short chunks we want at LEAST 25
        // items and for medium chunks 50+, capped by the chunk's natural content.
        const minTerms = Math.max(25, Math.min(60, Math.round(wordCount / 5)));
        const maxTerms = Math.max(45, Math.min(110, Math.round(wordCount / 3)));

        const prompt = `
Bạn là nhà ngôn ngữ học và giáo viên tiếng Anh chuyên sâu (C2/CEFR), biên soạn tài liệu học từ vựng cực kỳ kỹ lưỡng, KHÔNG BỎ SÓT bất kỳ từ/cụm từ hay nào.
Nhiệm vụ: Quét THẬT KỸ, THẬT CHI TIẾT văn bản tiếng Anh dưới đây và trích xuất TỐI THIỂU ${minTerms} và TỐI ĐA ${maxTerms} từ/cụm từ/cấu trúc QUAN TRỌNG VÀ HAY để học. Hãy quét toàn diện, đừng bỏ lọt các từ vựng học thuật/nâng cao đơn lẻ dù chúng không nằm liền kề nhau trong câu. Mục tiêu là NGƯỜI HỌC có thể đọc văn bản bất kì và highlight được toàn bộ các cụm/từ đáng học — không bỏ sót một thứ nào.

NHÓM CẦN TRÍCH XUẤT (lấy ĐẦY ĐỦ CẢ 8 NHÓM, không chỉ tập trung 1-2 nhóm):
1. collocation_adj_noun  — Adj + N: tính từ + danh từ (profound impact, paradigm shift, unprecedented challenges, cutting-edge technology, rigorous methodology, sustainable development, empirical evidence, groundbreaking research)
2. collocation_verb_noun — V + N: động từ + danh từ (carry out research, draw conclusions, shed light on, exert influence, raise awareness, achieve breakthrough, hold significance, play a role)
3. collocation_noun_noun — N + N: danh từ ghép danh từ (carbon emissions, paradigm shift, climate change, energy consumption, knowledge gap, brain drain, feedback loop, life cycle)
4. collocation_adv_adj   — Adv + Adj: trạng từ + tính từ (deeply rooted, highly effective, remarkably efficient, increasingly important, extremely complex, inherently flawed, profoundly influential)
5. collocation_adv_verb  — Adv + V: trạng từ + động từ (gradually reduce, rapidly expand, substantially improve, fundamentally alter, thoroughly examine, consistently demonstrate, dramatically transform)
6. phrasal_verb          — Cụm động từ V + particle/prep (carry out, break down, figure out, give rise to, bring about, come up with, result in, lead to, account for, take into account, set apart, rule out, draw upon)
7. idiom                 — Thành ngữ & cụm giới từ cố định (a drop in the ocean, in light of, on the other hand, by virtue of, with respect to, in the long run, at the expense of, for the sake of)
8. grammar               — Cấu trúc ngữ pháp ĐẶC BIỆT (inverted conditional, cleft sentence, no sooner...than, so...that, such...that, the more...the more, not only...but also, despite/in spite of + N/V-ing, as...as, whereas/while contrastive); KHÔNG lấy passive voice hay relative clause đơn giản
9. vocabulary            — TỪ ĐƠN học thuật/khó/nâng cao (tính từ, động từ, danh từ, trạng từ): LẤY TẤT CẢ các từ học thuật/C1-C2/IELTS nổi bật xuất hiện trong bài, KỂ CẢ khi chúng đứng riêng lẻ, không ghép với từ khác (ví dụ: "pivotal", "sustainable", "resilient", "profound", "meticulous", "ubiquitous", "paradigm", "leverage" khi dùng làm động từ, "underpin", "underscore", "elucidate", "constitute"...). KHÔNG giới hạn số lượng ở nhóm này chỉ 3-5 từ — hãy lấy HẾT các từ đáng học, có thể 15-30+ từ nếu bài dài.

QUY TẮC BẮT BUỘC:
- Tổng cộng ${minTerms}-${maxTerms} mục — PHẢI đạt tối thiểu ${minTerms}, đừng trả ít hơn
- Cân bằng giữa cụm từ (nhóm 1-7) và từ vựng đơn lẻ nổi bật (nhóm 9) — KHÔNG bỏ qua từ đơn chỉ vì ưu tiên cụm từ. Ưu tiên cụm từ 60% / từ đơn 40% nếu bài có đủ cả hai.
- Mỗi mục PHẢI xuất hiện NGUYÊN VĂN trong văn bản (trừ grammar structures — đó là cấu trúc mẫu, không cần có nguyên văn)
- KHÔNG lặp lại, KHÔNG lấy từ quá phổ thông/cơ bản (the, is, very, good, big, make, do, have, get, take khi đứng 1 mình)
- Với cụm từ: ưu tiên cụm 2-3 từ; chỉ lấy cụm 4+ từ khi nó thật sự là idiom/cấu trúc cố định nổi tiếng
- Với từ đơn: chỉ lấy từ C1 trở lên hoặc từ chuyên ngành/thuật ngữ học thuật

Trả về JSON (không kèm markdown), mỗi mục có "text" và "category":
{
  "keyTerms": [
    {"text": "fundamentally altered", "category": "collocation_adv_verb"},
    {"text": "profound impact", "category": "collocation_adj_noun"},
    {"text": "carry out", "category": "phrasal_verb"},
    {"text": "in light of", "category": "idiom"},
    {"text": "not only... but also", "category": "grammar"},
    {"text": "ubiquitous", "category": "vocabulary"},
    {"text": "pivotal", "category": "vocabulary"},
    {"text": "sustainable", "category": "vocabulary"},
    {"text": "paradigm shift", "category": "collocation_noun_noun"},
    {"text": "deeply rooted", "category": "collocation_adv_adj"},
    {"text": "draw conclusions", "category": "collocation_verb_noun"},
    {"text": "shed light on", "category": "phrasal_verb"}
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
