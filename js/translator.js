/**
 * LinguaContext Pro - Advanced AI Translation & Deep Structure Engine
 * Supports OpenAI ChatGPT, Google Gemini, and Groq (Llama 3.x) APIs.
 * Deep extraction of Nouns, Verbs, Adjectives, Adverbs, Collocations, Phrasal Verbs,
 * Idioms, Adverb+Verb combinations, and Grammar Structures.
 */
class ContextTranslator {
    constructor() {
        this.provider = localStorage.getItem('lingua_ai_provider') || 'groq'; // 'openai' | 'gemini' | 'groq'
        this.geminiApiKey = localStorage.getItem('lingua_gemini_api_key') || '';
        this.geminiModel = localStorage.getItem('lingua_gemini_model') || 'gemini-2.5-pro';

        this.openaiApiKey = localStorage.getItem('lingua_openai_api_key') || '';
        this.openaiModel = localStorage.getItem('lingua_openai_model') || 'gpt-4o';

        // Groq: empty by default — user must paste their key in Settings (the key in this constructor
        // was revoked after being shared publicly on 2026-08-02; never hardcode keys again).
        this.groqApiKey = localStorage.getItem('lingua_groq_api_key') || '';
        // Llama 3.3 is scheduled to be retired by Groq.  Use Groq's current
        // recommended production model for new installs; existing saved model
        // selections are deliberately kept unchanged.
        this.groqModel = localStorage.getItem('lingua_groq_model') || 'openai/gpt-oss-120b';

        this.autoScanEnabled = localStorage.getItem('lingua_auto_scan_ai') !== 'false';

        // Dedicated (separate) API config for the "AI Quét Từ & Cấu Trúc Hay" auto-scan feature
        this.useSeparateScanApi = localStorage.getItem('lingua_use_separate_scan_api') === 'true';
        this.scanProvider = localStorage.getItem('lingua_scan_ai_provider') || 'gemini';
        this.scanGeminiApiKey = localStorage.getItem('lingua_scan_gemini_api_key') || '';
        this.scanGeminiModel = localStorage.getItem('lingua_scan_gemini_model') || 'gemini-2.5-pro';
        this.scanOpenaiApiKey = localStorage.getItem('lingua_scan_openai_api_key') || '';
        this.scanOpenaiModel = localStorage.getItem('lingua_scan_openai_model') || 'gpt-4o';
        this.scanGroqApiKey = localStorage.getItem('lingua_scan_groq_api_key') || '';
        this.scanGroqModel = localStorage.getItem('lingua_scan_groq_model') || 'openai/gpt-oss-120b';
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
        if (this.provider === 'gemini' && this.geminiApiKey) {
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
        if (this.provider === 'groq' && this.groqApiKey) {
            try {
                const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.groqApiKey}`
                    },
                    body: JSON.stringify({
                        model: this.groqModel,
                        messages: [{ role: 'user', content: prompt }],
                        // Groq JSON mode prevents markdown/prose from making a
                        // vocabulary or pronunciation batch impossible to parse.
                        response_format: { type: 'json_object' },
                        temperature: 0
                    })
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                const text = data.choices?.[0]?.message?.content;
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
                            vn: { type: 'string', description: 'Verbatim Vietnamese span found inside markedText.' }
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
            if (this.scanProvider === 'groq' && this.scanGroqApiKey) {
                return { provider: 'groq', apiKey: this.scanGroqApiKey, model: this.scanGroqModel };
            }
        }
        // Fallback to main API config (Groq → OpenAI → Gemini)
        if (this.provider === 'groq' && this.groqApiKey) {
            return { provider: 'groq', apiKey: this.groqApiKey, model: this.groqModel };
        }
        if (this.provider === 'openai' && this.openaiApiKey) {
            return { provider: 'openai', apiKey: this.openaiApiKey, model: this.openaiModel };
        }
        return { provider: 'gemini', apiKey: this.geminiApiKey, model: this.geminiModel };
    }

    /**
     * Lightweight API connectivity check used by the Settings "🧪 Test" button.
     * Each method returns { ok: true, latencyMs } on success or { ok: false, error }.
     * We send a tiny prompt (just "ping") so the round-trip stays fast (<2s typical).
     */
    async pingOpenAI(key, model) {
        if (!key || !key.trim()) return { ok: false, error: 'Chưa nhập API key' };
        const m = model || 'gpt-4o-mini';
        const start = Date.now();
        try {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key.trim()}`
                },
                body: JSON.stringify({
                    model: m,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 4,
                    temperature: 0
                })
            });
            const latencyMs = Date.now() - start;
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try {
                    const errBody = await res.json();
                    if (errBody && errBody.error && errBody.error.message) msg = errBody.error.message;
                } catch (e) { /* not JSON */ }
                return { ok: false, error: msg, latencyMs };
            }
            return { ok: true, latencyMs };
        } catch (e) {
            return { ok: false, error: e.message || 'Lỗi mạng', latencyMs: Date.now() - start };
        }
    }

    async pingGemini(key, model) {
        if (!key || !key.trim()) return { ok: false, error: 'Chưa nhập API key' };
        const m = model || 'gemini-2.5-flash';
        const start = Date.now();
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key.trim()}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: 'ping' }] }],
                    generationConfig: { maxOutputTokens: 4, temperature: 0 }
                })
            });
            const latencyMs = Date.now() - start;
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try {
                    const errBody = await res.json();
                    if (errBody && errBody.error && errBody.error.message) msg = errBody.error.message;
                } catch (e) { /* not JSON */ }
                return { ok: false, error: msg, latencyMs };
            }
            return { ok: true, latencyMs };
        } catch (e) {
            return { ok: false, error: e.message || 'Lỗi mạng', latencyMs: Date.now() - start };
        }
    }

    async pingGroq(key, model) {
        if (!key || !key.trim()) return { ok: false, error: 'Chưa nhập API key' };
        const m = model || 'openai/gpt-oss-120b';
        const start = Date.now();
        try {
            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key.trim()}`
                },
                body: JSON.stringify({
                    model: m,
                    messages: [{ role: 'user', content: 'ping' }],
                    max_tokens: 4,
                    temperature: 0
                })
            });
            const latencyMs = Date.now() - start;
            if (!res.ok) {
                let msg = `HTTP ${res.status}`;
                try {
                    const errBody = await res.json();
                    if (errBody && errBody.error && errBody.error.message) msg = errBody.error.message;
                } catch (e) { /* not JSON */ }
                return { ok: false, error: msg, latencyMs };
            }
            return { ok: true, latencyMs };
        } catch (e) {
            return { ok: false, error: e.message || 'Lỗi mạng', latencyMs: Date.now() - start };
        }
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

    setGroqConfig(key, model) {
        this.groqApiKey = key.trim();
        this.groqModel = model;
        localStorage.setItem('lingua_groq_api_key', this.groqApiKey);
        localStorage.setItem('lingua_groq_model', model);
    }

    setScanGroqConfig(key, model) {
        this.scanGroqApiKey = key.trim();
        this.scanGroqModel = model;
        localStorage.setItem('lingua_scan_groq_api_key', this.scanGroqApiKey);
        localStorage.setItem('lingua_scan_groq_model', model);
    }

    /**
     * Public API test — works for all 3 providers (groq/openai/gemini).
     * Returns { ok: true, model, message } on success, or { ok: false, error } on failure.
     * Designed to be called from UI "Test" buttons in Settings.
     */
    async testApi(provider, apiKey, model) {
        const p = (provider || '').toLowerCase();
        const key = (apiKey || '').trim();
        const m = (model || '').trim();
        if (!key) return { ok: false, error: 'Vui lòng nhập API key trước khi Test.' };
        try {
            if (p === 'groq') {
                const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                    body: JSON.stringify({
                        model: m || 'openai/gpt-oss-120b',
                        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
                        max_tokens: 5,
                        temperature: 0
                    })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    const msg = errData.error?.message || `HTTP ${res.status}`;
                    return { ok: false, error: this._translateApiError(res.status, msg, 'Groq') };
                }
                const data = await res.json();
                if (!data.choices?.[0]?.message?.content) {
                    return { ok: false, error: 'Groq trả về response rỗng — key có thể sai hoặc đã hết hạn.' };
                }
                return { ok: true, model: data.model || m, message: '✅ Kết nối Groq thành công! Key hoạt động tốt.' };
            }
            if (p === 'openai') {
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                    body: JSON.stringify({
                        model: m || 'gpt-4o-mini',
                        messages: [{ role: 'user', content: 'Reply with: OK' }],
                        max_tokens: 5,
                        temperature: 0
                    })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    const msg = errData.error?.message || `HTTP ${res.status}`;
                    return { ok: false, error: this._translateApiError(res.status, msg, 'OpenAI') };
                }
                const data = await res.json();
                if (!data.choices?.[0]?.message?.content) {
                    return { ok: false, error: 'OpenAI trả về response rỗng — key có thể sai hoặc đã hết hạn.' };
                }
                return { ok: true, model: data.model || m, message: '✅ Kết nối OpenAI thành công! Key hoạt động tốt.' };
            }
            if (p === 'gemini') {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${m || 'gemini-2.5-flash'}:generateContent?key=${key}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: 'Reply with the single word: OK' }] }],
                        generationConfig: { maxOutputTokens: 5, temperature: 0 }
                    })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    const msg = errData.error?.message || `HTTP ${res.status}`;
                    return { ok: false, error: this._translateApiError(res.status, msg, 'Gemini') };
                }
                const data = await res.json();
                if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    return { ok: false, error: 'Gemini trả về response rỗng — key có thể sai hoặc đã hết hạn.' };
                }
                return { ok: true, model: m, message: '✅ Kết nối Gemini thành công! Key hoạt động tốt.' };
            }
            return { ok: false, error: 'Provider không hợp lệ (phải là groq, openai hoặc gemini).' };
        } catch (err) {
            return { ok: false, error: this._translateApiError(0, err.message || String(err), provider) };
        }
    }

    _translateApiError(status, rawMsg, provider) {
        const m = (rawMsg || '').toString();
        if (status === 401 || /api key|invalid|unauthor/i.test(m)) {
            return `❌ ${provider}: API key không hợp lệ, sai hoặc đã hết hạn. Vui lòng kiểm tra lại.`;
        }
        if (status === 403 || /permission|forbidden|not enabled/i.test(m)) {
            return `❌ ${provider}: API key không có quyền truy cập model này. Có thể model chưa được bật cho key.`;
        }
        if (status === 404 || /not found|model not found|does not exist/i.test(m)) {
            return `❌ ${provider}: Model "${m}" không tồn tại hoặc bạn không có quyền dùng. Kiểm tra lại tên model.`;
        }
        if (status === 429 || /quota|rate limit|too many/i.test(m)) {
            return `❌ ${provider}: Đã vượt quota / rate limit. Vui lòng đợi hoặc nâng cấp gói.`;
        }
        if (status === 0 || /network|fetch|failed/i.test(m)) {
            return `❌ ${provider}: Lỗi mạng — không kết nối được tới server. Kiểm tra mạng hoặc VPN.`;
        }
        if (status >= 500) {
            return `❌ ${provider}: Server đang lỗi (HTTP ${status}). Thử lại sau vài giây.`;
        }
        return `❌ ${provider}: ${m || `HTTP ${status}`}`;
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
            } else if (this.provider === 'groq' && this.groqApiKey) {
                try {
                    result = await this._translateWithGroq(chunkText, chunkHighlights);
                } catch (err) {
                    console.warn(`Groq API error on chunk ${i + 1}, falling back:`, err);
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

        const prompt = `Bạn là dịch giả & nhà ngôn ngữ học Anh-Việt cao cấp, chuyên biên dịch văn bản học thuật & đời thường với phong cách TỰ NHIÊN, MƯỢT MÀ như người Việt bản xứ — không máy móc, không Google-Translate.

═══════════════════════════════════════
PHẦN 1 — DỊCH ĐOẠN VĂN
═══════════════════════════════════════

Nguyên tắc dịch MƯỢT MÀ & TRUNG THÀNH với ngữ cảnh:

1. ĐỌC KỸ TOÀN BỘ đoạn văn trước khi dịch từng câu — để nắm:
   * Chủ đề chính, giọng văn (trang trọng / thân mật / học thuật / kể chuyện)
   * Các nhân vật, sự kiện, bối cảnh đang được nhắc tới
   * Quan hệ nhân-quả, thời gian, mục đích giữa các câu

2. DỊCH THEO NGHĨA, KHÔNG DỊCH TỪNG TỪ:
   * "I'm feeling under the weather today" → "Hôm nay tôi thấy không được khỏe" (KHÔNG phải "Tôi đang cảm thấy dưới thời tiết")
   * "It took us by storm" → "Nó tạo nên cơn sốt" (KHÔNG phải "Nó đã mang chúng ta bằng bão")
   * "The answer is a resounding no" → "Câu trả lời là một 'không' hoàn toàn dứt khoát" (KHÔNG phải "...là một không vang dội")
   * Chọn từ Việt tương đương sắc thái — ưu tiên cách diễn đạt mà người Việt thực sự dùng trong cùng ngữ cảnh.

3. GIỮ ĐÚNG:
   * Sắc thái trang trọng / thân mật của bản gốc (gọi "bạn" trong văn informal, "quý vị/anh chị" trong văn trang trọng — theo văn phong bài).
   * Mạo từ "the/a" nếu cần dịch sẽ dùng "cái/chiếc/cuốn..." cho rõ nghĩa, hoặc LƯỚT qua nếu tiếng Việt tự nhiên bỏ được.
   * Thì, thể của động từ — phải khớp nguyên văn cấu trúc ngữ pháp gốc.
   * Số ít/số nhiều — "books" dịch "những cuốn sách" (có "những") chứ không phải "cuốn sách".

4. XỬ LÝ CỤM TỪ KHÔNG NÊN DỊCH LITERAL:
   * "look forward to" → "mong đợi / háo hức chờ đợi"
   * "in spite of" → "bất chấp / mặc dù"
   * "take advantage of" → "tận dụng / lợi dụng"
   * "make a difference" → "tạo nên sự khác biệt"
   * "for the time being" → "tạm thời / trong lúc này"
   * "on the other hand" → "mặt khác / ngược lại"
   * "as well as" → "cũng như / không chỉ... mà còn"
   * "due to" → "vì / do"
   * "in addition to" → "ngoài ra / bên cạnh"
   * "a wide range of" → "nhiều loại / đa dạng"
   * "as a result" → "hệ quả là / kết quả là"
   * "in fact" → "thực tế / thực ra"
   * "in order to" → "để / nhằm mục đích"
   * "such as" → "như / chẳng hạn như"
   * "in case of" → "trong trường hợp"
   * "with regard to" → "về / liên quan đến"
   * "as long as" → "miễn là / chỉ cần"
   * "even though" → "mặc dù / dù cho"
   * "rather than" → "thay vì / hơn là"
   * "the fact that" → "việc / rằng" (thường lược bỏ)
   * "There is/are" → "Có..." (không dịch literal "Ở đây có")
   * "It is important to note that" → "Điều đáng chú ý là" (không phải "Nó là quan trọng để chú ý rằng")

5. VỀ VIỆC DÙNG TỪ HÁN-VIỆT:
   * "important" → "quan trọng" (OK)
   * "necessary" → "cần thiết" (OK)
   * "major" → "lớn / chính" (tùy ngữ cảnh)
   * "implement" → "triển khai / thực hiện" (tùy ngữ cảnh)
   * "utilize" → "sử dụng / tận dụng" (không cố dịch "sử dụng hóa")
   * "demonstrate" → "chứng minh / thể hiện"
   * "subsequent" → "sau đó / tiếp theo"

6. VĂN PHONG & SẮC THÁI:
   * Văn báo chí: dùng từ trung tính, mạch lạc, truyền tải thông tin rõ ràng
   * Văn học thuật: dùng từ học thuật chính xác, nhưng vẫn mượt
   * Văn đời thường/kể chuyện: dùng từ khẩu ngữ tự nhiên
   * Câu dài phức tạp tiếng Anh → chia thành 2-3 câu tiếng Việt nếu cần để rõ nghĩa

⚡ QUY TẮC ĐÁNH DẤU TỐI QUAN TRỌNG:
Trong "translatedText", với MỖI item từ vựng bạn phân tích ở dưới, hãy BỌC chính xác cụm từ tiếng Việt tương ứng bằng cặp thẻ: [[H:ENGLISH_ORIGINAL]]cụm tiếng Việt[[/H]]
Trong đó ENGLISH_ORIGINAL là ĐÚNG chuỗi tiếng Anh gốc ở trường "original".
Ví dụ: "humans are walking slowly" → "Những [[H:humans]]con người[[/H]] đang [[H:walking slowly]]đi bộ chậm rãi[[/H]]."
BẮT BUỘC: cụm tiếng Việt nằm giữa 2 thẻ phải là NGHĨA ĐÚNG của cụm tiếng Anh đó tại ĐÚNG vị trí nó xuất hiện. Mỗi item chỉ bọc 1 lần (ở lần xuất hiện đầu tiên). Nếu một cụm tiếng Anh không thực sự xuất hiện trong đoạn thì không bọc.
‼️ CỰC KỲ QUAN TRỌNG: PHẢI bọc thẻ cho TẤT CẢ MỌI item trong "vocabList" — KHÔNG được bỏ sót. Số cặp thẻ [[H:...]]...[[/H]] trong "translatedText" PHẢI BẰNG ĐÚNG số phần tử trong "vocabList". TỰ RÀ SOÁT lại sau khi dịch xong.

═══════════════════════════════════════
PHẦN 2 — PHÂN TÍCH TỪ VỰNG
═══════════════════════════════════════

Danh sách từ/cụm từ/cấu trúc được yêu cầu: [${highlightListStr}]

(Nếu danh sách trống, hãy tự động QUÉT CHI TIẾT VÀ ĐẦY ĐỦ toàn bộ đoạn văn để trích xuất TỐI THIỂU 18-22 mục hay nhất và đa dạng nhất, bao gồm ĐỦ các nhóm: Trạng từ+Động từ, Trạng từ+Tính từ, Trạng từ+Danh từ, Cụm từ kết hợp/Collocations, Cụm động từ/Phrasal Verbs, Thành ngữ/Idioms, TẤT CẢ các Cấu trúc ngữ pháp xuất hiện trong bài dù dễ hay khó, và các Danh từ/Động từ/Tính từ/Trạng từ học thuật hoặc khó khác).

Cho mỗi item, phân tích chi tiết:
   - "original": Từ, Cụm từ hoặc Cấu trúc tiếng Anh (giữ đúng dạng gốc trong bài)
   - "category": Phân loại chính xác trong các nhãn sau: ["Trạng từ + Động từ (Adv+Verb)", "Trạng từ + Tính từ (Adv+Adj)", "Trạng từ + Danh từ (Adv+Noun)", "Cụm từ kết hợp (Collocation)", "Cấu trúc ngữ pháp (Structure)", "Cụm động từ (Phrasal Verb)", "Thành ngữ (Idiom)", "Danh từ (Noun)", "Động từ (Verb)", "Tính từ (Adj)", "Trạng từ (Adv)", "Giới từ/Liên từ (Prep/Conj)"]
   - "ipa": Phiên âm chuẩn IPA
   - "contextMeaning": Nghĩa tiếng Việt CHUẨN XÁC THEO ĐÚNG NGỮ CẢNH bài viết này (không phải nghĩa từ điển chung chung)
   - "translatedTermInVN": Phải là CHÍNH XÁC cụm từ tiếng Việt bạn đã BỌC giữa 2 thẻ [[H:...]]...[[/H]] cho item này (không kèm thẻ)
   - "exampleEn": Một câu ví dụ minh họa tiếng Anh (KHÁC câu trong bài) ngắn gọn, tự nhiên, đúng kiểu người bản xứ nói/viết
   - "exampleVi": Bản dịch tiếng Việt mượt mà của câu ví dụ (KHÔNG dịch máy móc)
   - "explanation": Giải thích NGẮN GỌN bằng TIẾNG VIỆT (1-2 câu, tối đa 60-80 từ) về nghĩa, cách dùng, sắc thái hoặc lưu ý khi dùng.
   - "structures": Mảng 2-3 CẤU TRÚC hay và phổ biến có dùng từ/cụm từ này. Mỗi phần tử:
     * "pattern": Tên cấu trúc (TIẾNG ANH, ngắn gọn, in đậm key word)
     * "exampleEn": Câu tiếng Anh hoàn chỉnh, tự nhiên (10-15 từ) MINH HỌA cấu trúc
     * "exampleVi": Bản dịch tiếng Việt mượt mà của câu exampleEn

═══════════════════════════════════════
PHẦN 3 — ĐỊNH DẠNG JSON
═══════════════════════════════════════

Trả về ĐÚNG định dạng JSON (không kèm markdown block):
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
        { "pattern": "meticulously scrutinize + something", "exampleEn": "The auditor meticulously scrutinized every transaction.", "exampleVi": "Người kiểm toán đã xem xét tỉ mỉ từng giao dịch." },
        { "pattern": "meticulously scrutinize the details/evidence", "exampleEn": "She meticulously scrutinized the evidence before writing her report.", "exampleVi": "Cô ấy đã xem xét tỉ mỉ các bằng chứng trước khi viết báo cáo." },
        { "pattern": "meticulously scrutinize every aspect of", "exampleEn": "The editor meticulously scrutinized every aspect of the manuscript.", "exampleVi": "Biên tập viên đã xem xét tỉ mỉ mọi khía cạnh của bản thảo." }
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
                temperature: 0.3
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

        const prompt = `Bạn là dịch giả & nhà ngôn ngữ học Anh-Việt cao cấp, chuyên biên dịch văn bản học thuật & đời thường với phong cách TỰ NHIÊN, MƯỢT MÀ như người Việt bản xứ.

═══════════════════════════════════════
PHẦN 1 — DỊCH ĐOẠN VĂN
═══════════════════════════════════════

Nguyên tắc dịch MƯỢT MÀ & TRUNG THÀNH với ngữ cảnh:

1. ĐỌC KỸ TOÀN BỘ đoạn văn trước khi dịch từng câu — nắm chủ đề, giọng văn, bối cảnh.
2. DỊCH THEO NGHĨA, KHÔNG DỊCH TỪNG TỪ:
   * "I'm feeling under the weather today" → "Hôm nay tôi thấy không được khỏe" (KHÔNG "Tôi đang cảm thấy dưới thời tiết")
   * "It took us by storm" → "Nó tạo nên cơn sốt"
   * "The answer is a resounding no" → "Câu trả lời là một 'không' hoàn toàn dứt khoát"
3. GIỮ ĐÚNG sắc thái trang trọng/thân mật, thì, thể động từ, số ít/nhiều.
4. XỬ LÝ CỤM TỪ KHÔNG NÊN DỊCH LITERAL:
   * "look forward to" → "mong đợi / háo hức chờ đợi"
   * "in spite of" → "bất chấp / mặc dù"
   * "take advantage of" → "tận dụng / lợi dụng"
   * "make a difference" → "tạo nên sự khác biệt"
   * "for the time being" → "tạm thời"
   * "on the other hand" → "mặt khác"
   * "as well as" → "cũng như / không chỉ... mà còn"
   * "due to" → "vì / do"
   * "in addition to" → "ngoài ra"
   * "a wide range of" → "nhiều loại / đa dạng"
   * "as a result" → "hệ quả là / kết quả là"
   * "in fact" → "thực tế / thực ra"
   * "in order to" → "để / nhằm"
   * "such as" → "như / chẳng hạn như"
   * "with regard to" → "về"
   * "as long as" → "miễn là"
   * "even though" → "mặc dù"
   * "rather than" → "thay vì"
   * "There is/are" → "Có..." (không dịch literal "Ở đây có")
   * "It is important to note that" → "Điều đáng chú ý là"
5. Câu dài phức tạp tiếng Anh → chia thành 2-3 câu tiếng Việt nếu cần để rõ nghĩa.

⚡ QUY TẮC ĐÁNH DẤU:
Trong "translatedText", với MỖI item từ vựng ở dưới, hãy BỌC cụm từ tiếng Việt tương ứng bằng: [[H:ENGLISH_ORIGINAL]]cụm tiếng Việt[[/H]]
ENGLISH_ORIGINAL là ĐÚNG chuỗi gốc ở trường "original".
VD: "humans are walking slowly" → "Những [[H:humans]]con người[[/H]] đang [[H:walking slowly]]đi bộ chậm rãi[[/H]]."
BẮT BUỘC: cụm Việt nằm giữa 2 thẻ phải là NGHĨA ĐÚNG tại ĐÚNG vị trí. Mỗi item chỉ bọc 1 lần (lần xuất hiện đầu tiên).
‼️ CỰC KỲ QUAN TRỌNG: PHẢI bọc thẻ cho TẤT CẢ item trong "vocabList" — KHÔNG bỏ sót. Số cặp thẻ = số phần tử vocabList. TỰ RÀ SOÁT lại trước khi trả.

═══════════════════════════════════════
PHẦN 2 — PHÂN TÍCH TỪ VỰNG
═══════════════════════════════════════

Danh sách từ/cụm từ/cấu trúc được yêu cầu: [${highlightListStr}]

(Nếu danh sách trống, hãy tự động QUÉT CHI TIẾT VÀ ĐẦY ĐỦ toàn bộ đoạn văn để trích xuất TỐI THIỂU 18-22 mục hay nhất và đa dạng nhất, bao gồm ĐỦ các nhóm: Trạng từ+Động từ, Trạng từ+Tính từ, Trạng từ+Danh từ, Cụm từ kết hợp/Collocations, Cụm động từ/Phrasal Verbs, Thành ngữ/Idioms, TẤT CẢ các Cấu trúc ngữ pháp xuất hiện trong bài dù dễ hay khó, và các Danh từ/Động từ/Tính từ/Trạng từ học thuật hoặc khó khác).

Cho mỗi item, phân tích chi tiết:
   - "original": Từ, Cụm từ hoặc Cấu trúc tiếng Anh (giữ đúng dạng trong bài)
   - "category": Phân loại chính xác trong các nhãn: ["Trạng từ + Động từ (Adv+Verb)", "Trạng từ + Tính từ (Adv+Adj)", "Trạng từ + Danh từ (Adv+Noun)", "Cụm từ kết hợp (Collocation)", "Cấu trúc ngữ pháp (Structure)", "Cụm động từ (Phrasal Verb)", "Thành ngữ (Idiom)", "Danh từ (Noun)", "Động từ (Verb)", "Tính từ (Adj)", "Trạng từ (Adv)", "Giới từ/Liên từ (Prep/Conj)"]
   - "ipa": Phiên âm chuẩn IPA
   - "contextMeaning": Nghĩa tiếng Việt CHUẨN XÁC THEO ĐÚNG NGỮ CẢNH bài viết này
   - "translatedTermInVN": CHÍNH XÁC cụm từ tiếng Việt đã bọc giữa 2 thẻ [[H:...]]...[[/H]]
   - "exampleEn": Câu ví dụ tiếng Anh (KHÁC câu trong bài) ngắn gọn, tự nhiên
   - "exampleVi": Bản dịch tiếng Việt mượt mà của câu ví dụ
   - "explanation": Giải thích NGẮN GỌN bằng tiếng Việt (1-2 câu, 60-80 từ)
   - "structures": Mảng 2-3 cấu trúc hay. Mỗi phần tử: "pattern", "exampleEn", "exampleVi"

═══════════════════════════════════════
PHẦN 3 — JSON
═══════════════════════════════════════

Trả về ĐÚNG JSON (không kèm markdown):
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
        { "pattern": "trigger/cause a profound paradigm shift", "exampleEn": "The internet triggered a profound paradigm shift in communication.", "exampleVi": "Internet đã gây ra một sự chuyển đổi tư duy sâu sắc trong giao tiếp." },
        { "pattern": "a profound paradigm shift in + field", "exampleEn": "AI brought a profound paradigm shift in modern healthcare.", "exampleVi": "AI đã mang đến một sự chuyển đổi tư duy sâu sắc trong y tế hiện đại." },
        { "pattern": "mark/represent a profound paradigm shift", "exampleEn": "This discovery marks a profound paradigm shift in biology.", "exampleVi": "Khám phá này đánh dấu một sự chuyển đổi tư duy sâu sắc trong sinh học." }
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
                    temperature: 0.3,
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
    /**
     * Call Groq API (OpenAI-compatible endpoint, Llama 3.3 70B & 3.1 models — Ultra Fast)
     */
    async _translateWithGroq(textChunk, highlights = []) {
        const highlightListStr = highlights.map(h => `"${h.text}"`).join(', ');

        const prompt = `Bạn là dịch giả & nhà ngôn ngữ học Anh-Việt cao cấp, chuyên biên dịch văn bản học thuật & đời thường với phong cách TỰ NHIÊN, MƯỢT MÀ, THOÁT Ý như người Việt bản xứ.

═══════════════════════════════════════
PHẦN 1 — DỊCH ĐOẠN VĂN
═══════════════════════════════════════

Nguyên tắc dịch MƯỢT MÀ & TRUNG THÀNH với ngữ cảnh:

1. ĐỌC KỸ TOÀN BỘ đoạn văn trước khi dịch từng câu — nắm chủ đề, giọng văn, bối cảnh.
2. DỊCH THEO NGHĨA, KHÔNG DỊCH TỪNG TỪ:
   * "I'm feeling under the weather today" → "Hôm nay tôi thấy không được khỏe" (KHÔNG "Tôi đang cảm thấy dưới thời tiết")
   * "It took us by storm" → "Nó tạo nên cơn sốt"
   * "The answer is a resounding no" → "Câu trả lời là một 'không' hoàn toàn dứt khoát"
3. GIỮ ĐÚNG sắc thái trang trọng/thân mật, thì, thể động từ, số ít/nhiều.
4. XỬ LÝ CỤM TỪ KHÔNG NÊN DỊCH LITERAL:
   * "look forward to" → "mong đợi / háo hức chờ đợi"
   * "in spite of" → "bất chấp / mặc dù"
   * "take advantage of" → "tận dụng / lợi dụng"
   * "make a difference" → "tạo nên sự khác biệt"
   * "for the time being" → "tạm thời"
   * "on the other hand" → "mặt khác"
   * "as well as" → "cũng như / không chỉ... mà còn"
   * "due to" → "vì / do"
   * "in addition to" → "ngoài ra"
   * "a wide range of" → "nhiều loại / đa dạng"
   * "as a result" → "hệ quả là / kết quả là"
   * "in fact" → "thực tế / thực ra"
   * "in order to" → "để / nhằm"
   * "such as" → "như / chẳng hạn như"
   * "with regard to" → "về"
   * "as long as" → "miễn là"
   * "even though" → "mặc dù"
   * "rather than" → "thay vì"
   * "There is/are" → "Có..." (không dịch literal "Ở đây có")
   * "It is important to note that" → "Điều đáng chú ý là"
5. Câu dài phức tạp tiếng Anh → chia thành 2-3 câu tiếng Việt nếu cần để rõ nghĩa.

⚡ QUY TẮC ĐÁNH DẤU:
Trong "translatedText", với MỖI item từ vựng ở dưới, hãy BỌC cụm từ tiếng Việt tương ứng bằng: [[H:ENGLISH_ORIGINAL]]cụm tiếng Việt[[/H]]
ENGLISH_ORIGINAL là ĐÚNG chuỗi gốc ở trường "original".
VD: "humans are walking slowly" → "Những [[H:humans]]con người[[/H]] đang [[H:walking slowly]]đi bộ chậm rãi[[/H]]."
BẮT BUỘC: cụm Việt nằm giữa 2 thẻ phải là NGHĨA ĐÚNG tại ĐÚNG vị trí. Mỗi item chỉ bọc 1 lần (lần xuất hiện đầu tiên).
‼️ CỰC KỲ QUAN TRỌNG: PHẢI bọc thẻ cho TẤT CẢ item trong "vocabList" — KHÔNG bỏ sót. Số cặp thẻ = số phần tử vocabList. TỰ RÀ SOÁT lại trước khi trả.

═══════════════════════════════════════
PHẦN 2 — PHÂN TÍCH TỪ VỰNG
═══════════════════════════════════════

Danh sách từ/cụm từ/cấu trúc được yêu cầu: [${highlightListStr}]

(Nếu danh sách trống, hãy tự động QUÉT CHI TIẾT VÀ ĐẦY ĐỦ toàn bộ đoạn văn để trích xuất TỐI THIỂU 25-35 mục hay nhất và đa dạng nhất, bao gồm ĐỦ các nhóm: Trạng từ+Động từ, Trạng từ+Tính từ, Trạng từ+Danh từ, Cụm từ kết hợp/Collocations, Cụm động từ/Phrasal Verbs, Thành ngữ/Idioms, TẤT CẢ các Cấu trúc ngữ pháp xuất hiện trong bài dù dễ hay khó, và các Danh từ/Động từ/Tính từ/Trạng từ học thuật hoặc khó khác).

Cho mỗi item, phân tích chi tiết:
   - "original": Từ, Cụm từ hoặc Cấu trúc tiếng Anh (giữ đúng dạng trong bài)
   - "category": Phân loại chính xác trong các nhãn: ["Trạng từ + Động từ (Adv+Verb)", "Trạng từ + Tính từ (Adv+Adj)", "Trạng từ + Danh từ (Adv+Noun)", "Cụm từ kết hợp (Collocation)", "Cấu trúc ngữ pháp (Structure)", "Cụm động từ (Phrasal Verb)", "Thành ngữ (Idiom)", "Danh từ (Noun)", "Động từ (Verb)", "Tính từ (Adj)", "Trạng từ (Adv)", "Giới từ/Liên từ (Prep/Conj)"]
   - "ipa": Phiên âm chuẩn IPA
   - "contextMeaning": Nghĩa tiếng Việt CHUẨN XÁC THEO ĐÚNG NGỮ CẢNH bài viết này
   - "translatedTermInVN": CHÍNH XÁC cụm từ tiếng Việt đã bọc giữa 2 thẻ [[H:...]]...[[/H]]
   - "exampleEn": Câu ví dụ tiếng Anh (KHÁC câu trong bài) ngắn gọn, tự nhiên
   - "exampleVi": Bản dịch tiếng Việt mượt mà của câu ví dụ
   - "explanation": Giải thích NGẮN GỌN bằng tiếng Việt (1-2 câu, 60-80 từ)
   - "structures": Mảng 2-3 cấu trúc hay. Mỗi phần tử: "pattern", "exampleEn", "exampleVi"

═══════════════════════════════════════
PHẦN 3 — JSON
═══════════════════════════════════════

Trả về ĐÚNG JSON (không kèm markdown):
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
      "explanation": "Dùng khi ai đó xem xét một cái gì cẩn thận và chi tiết đến từng chút, thường để tìm lỗi hay sai sót.",
      "structures": [
        { "pattern": "meticulously scrutinize + something", "exampleEn": "The auditor meticulously scrutinized every transaction.", "exampleVi": "Người kiểm toán đã xem xét tỉ mỉ từng giao dịch." },
        { "pattern": "meticulously scrutinize the details/evidence", "exampleEn": "She meticulously scrutinized the evidence before writing her report.", "exampleVi": "Cô ấy đã xem xét tỉ mỉ các bằng chứng trước khi viết báo cáo." }
      ]
    }
  ]
}

Đoạn văn tiếng Anh:
"""
${textChunk}
"""
`;

        // Keep legacy choices at the end so saved configurations continue to work
        // until Groq actually removes them. New Groq accounts use a supported
        // production model first.
        const modelsToTry = [
            this.groqModel,
            'openai/gpt-oss-120b',
            'qwen/qwen3.6-27b',
            'llama-3.3-70b-versatile',
            'llama-3.1-70b-versatile',
            'llama-3.1-8b-instant'
        ];
        const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));
        let lastError = null;

        for (const groqModelCandidate of uniqueModels) {
            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.groqApiKey}`
                    },
                    body: JSON.stringify({
                        model: groqModelCandidate,
                        messages: [{ role: 'user', content: prompt }],
                        response_format: { type: "json_object" },
                        temperature: 0.3,
                        max_tokens: 8192
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    const rawText = data.choices?.[0]?.message?.content || '';
                    let jsonResult;
                    try {
                        jsonResult = JSON.parse(rawText.replace(/```json|```/g, '').trim());
                    } catch (e) {
                        console.error("Failed to parse Groq JSON:", rawText);
                        throw new Error("Không thể phân tích dữ liệu phản hồi từ Groq.");
                    }

                    return {
                        translatedText: jsonResult.translatedText || "",
                        vocabList: (jsonResult.vocabList || []).map(v => ({
                            ...v,
                            color: this._resolveVocabColor(v.original, highlights)
                        }))
                    };
                }
                const errData = await response.json().catch(() => ({}));
                lastError = new Error(errData.error?.message || `Groq API (${groqModelCandidate}) status: ${response.status}`);
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error("Không thể gọi Groq API với các mô hình khả dụng.");
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

        // Example sentence MUST come from AI (random natural sentence from real life /
        // science / etc.) — we NEVER use a hardcoded template, because a templated
        // sentence repeated for every word looks obviously fake ("The teacher explained
        // the meaning of X to the students.").
        //
        // Strategy:
        // 1. If `_lookupWithAI` already gave a natural-looking example, keep it.
        // 2. Otherwise call `_generateExampleWithAI` with the dedicated example-only
        //    prompt — that prompt explicitly forbids "The word X..." style filler.
        // 3. If the example is still bad after that single retry, retry with up to 3
        //    attempts of a different example-only prompt that uses random topic hints
        //    so the AI picks a different natural sentence each time.
        // 4. If AI is truly unavailable (no API key / network error), set
        //    `result.example = null` and `result.exampleUnavailable = true`. The UI
        //    then shows a hint instead of a fake sentence.
        let exampleRetries = 0;
        const _exampleLooksGood = (s) => s && s.trim() && s.trim().toLowerCase() !== word.toLowerCase() && this._looksLikeNaturalExample(s, cleanWord);
        if (!_exampleLooksGood(result.example)) {
            // First attempt: dedicated example-only prompt.
            let aiEx = await this._generateExampleWithAI(cleanWord).catch(() => null);
            if (_exampleLooksGood(aiEx && aiEx.example)) {
                result.example = aiEx.example.trim();
                result.exampleVi = (aiEx.exampleVi || '').trim() || result.exampleVi;
            } else {
                // Retry up to 3 times with a randomized topic hint so the AI produces a
                // DIFFERENT natural sentence on each attempt (not a fixed template).
                const topicHints = [
                    'everyday conversation', 'a news headline', 'a science textbook',
                    'a travel blog', 'a movie review', 'a recipe blog', 'a sports article',
                    'a history book', 'a tech blog', 'a diary entry', 'a business email',
                    'a children\'s story', 'a weather report', 'a documentary script'
                ];
                while (exampleRetries < 3 && !_exampleLooksGood(result.example)) {
                    const topic = topicHints[(exampleRetries + (cleanWord.length % topicHints.length)) % topicHints.length];
                    aiEx = await this._generateExampleWithAI(cleanWord, topic).catch(() => null);
                    exampleRetries++;
                    if (_exampleLooksGood(aiEx && aiEx.example)) {
                        result.example = aiEx.example.trim();
                        result.exampleVi = (aiEx.exampleVi || '').trim() || result.exampleVi;
                        break;
                    }
                }
                if (!_exampleLooksGood(result.example)) {
                    // AI truly unavailable or kept producing bad examples — signal the UI
                    // to show a hint instead of a fake templated sentence.
                    result.example = null;
                    result.exampleUnavailable = true;
                }
            }
        }

        // Ensure the example has a Vietnamese translation.
        if (result.example && !result.exampleVi) {
            try {
                result.exampleVi = (await this._translateSentenceFree(result.example)) || '';
            } catch (e) { /* ignore */ }
        }

        // Last-resort: if example is still empty, DO NOT use a hardcoded template.
        // Instead signal the UI to show a hint asking the user to configure an API key
        // (otherwise the example would look like an obvious fake "The teacher explained
        // the meaning of X to the students." repeated for every word).
        if (!result.example) {
            result.exampleUnavailable = true;
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
        // Must contain the word (or, for phrases, its first significant token).
        const firstTok = w.split(/\s+/)[0];
        if (!ex.includes(w) && !ex.includes(firstTok)) return false;
        // Reject known placeholder / "AI chêm từ" shapes. The quoted-word
        // patterns use a regex character class so we accept any of " ' " '
        // wrapping the term. Escape the term so regex specials are safe.
        const escW = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const Q = `["'\u201C\u2018]`;                                          // " ' " '
        const sq = `${Q}${escW}${Q}`;
        const bad = [
            new RegExp(`the\\s+word\\s+${sq}`, 'i'),                            // "The word X..."
            new RegExp(`the\\s+phrase\\s+${sq}`, 'i'),                          // "The phrase X..."
            new RegExp(`the\\s+term\\s+${sq}`, 'i'),                            // "The term X..."
            new RegExp(`example\\s+with\\s+${escW}\\b`, 'i'),                   // "Example with X"
            new RegExp(`example\\s+of\\s+${escW}\\b`, 'i'),                     // "Example of X"
            new RegExp(`\\bthis\\s+is\\s+${escW}\\b`, 'i'),                     // "This is X"
            new RegExp(`\\b${escW}\\s+is\\s+commonly\\s+used\\b`, 'i'),         // "X is commonly used"
            new RegExp(`\\b${escW}\\s+is\\s+used\\b`, 'i'),                     // "X is used"
            new RegExp(`\\b${escW}\\s+appears\\s+in\\b`, 'i'),                  // "X appears in"
            new RegExp(`\\bwe\\s+use\\s+${escW}\\b`, 'i'),                      // "We use X..."
            new RegExp(`\\bwe\\s+can\\s+see\\s+${escW}\\b`, 'i'),               // "We can see X..."
            new RegExp(`\\bthe\\s+${escW}\\s+used\\b`, 'i'),                    // "The X used Y to Z..."
            new RegExp(`\\b${escW}\\s+in\\s+a\\s+sentence\\b`, 'i'),            // "... X in a sentence"
            new RegExp(`\\busing\\s+${escW}\\s+in\\b`, 'i'),                    // "Using X in..."
            new RegExp(`\\bhere\\s+is\\s+a\\s+sentence\\b`, 'i'),               // "Here is a sentence with X"
            new RegExp(`\\bshe\\s+used\\s+the\\s+${escW}\\b`, 'i'),             // "She used the word X..."
            new RegExp(`\\bhe\\s+used\\s+the\\s+${escW}\\b`, 'i'),
            new RegExp(`\\bthey\\s+used\\s+the\\s+${escW}\\b`, 'i'),
            new RegExp(`\\bused\\s+the\\s+${escW}\\s+to\\b`, 'i'),              // "Used the X to..."
            new RegExp(`\\bused\\s+${escW}\\s+to\\b`, 'i'),                     // "Used X to..." (singer used however to)
            new RegExp(`\\b${escW}\\s+used\\s+to\\b`, 'i'),                     // "X used to..." (the other ordering)
            new RegExp(`\\bused\\s+${escW}\\s+in\\b`, 'i'),                     // "Used X in..."
            new RegExp(`\\bin\\s+the\\s+${escW}\\b`, 'i'),                       // "In the X..." (chêm từ)
            new RegExp(`\\bteacher\\s+explained\\s+(?:the\\s+)?(?:meaning\\s+of\\s+)?${escW}\\b`, 'i'), // "The teacher explained (the meaning of) X"
            new RegExp(`\\bexplained\\s+(?:the\\s+)?(?:meaning\\s+of\\s+)?${escW}\\b`, 'i')         // "Explained X..." (any form)
        ];
        if (bad.some(re => re.test(ex))) return false;
        return true;
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
    async _generateExampleWithAI(word, topicHint) {
        const hasOpenAI = this.provider === 'openai' && this.openaiApiKey;
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || (!hasOpenAI && !this.groqApiKey));
        const hasGroq = this.groqApiKey && (this.provider === 'groq' || (!hasOpenAI && !hasGemini));
        if (!hasOpenAI && !hasGemini && !hasGroq) return null;

        // When retrying, mix in a topic hint so the AI picks a different natural
        // sentence each time instead of repeating a template.
        const topicLine = topicHint
            ? `\nGỢI Ý NGỮ CẢNH: hãy đặt câu ví dụ vào bối cảnh "${topicHint}" để câu trông tự nhiên và khác biệt mỗi lần.`
            : '';

        const prompt = `Cho 1 câu tiếng Anh TỰ NHIÊN, NGẮN GỌN, DỄ HIỂU (đúng kiểu câu ví dụ trong từ điển Oxford/Cambridge) có chứa "${word}", kèm bản dịch tiếng Việt tự nhiên.${topicLine}

QUY TẮC BẮT BUỘC:
1. Câu tiếng Anh phải là câu ĐỜI THỰC mà người bản xứ sẽ nói/viết — không phải câu ngữ pháp khô khan hay câu minh hoạ "lấy từ điền vào".
2. Câu PHẢI CÓ CHỨA "${word}" một cách tự nhiên (đúng vị trí ngữ pháp, đúng nghĩa phổ biến nhất của từ).
3. KHÔNG ĐƯỢC dùng các mẫu câu kiểu:
   - "The word ${word} means ..." / "The phrase ${word} ..."
   - "Example with ${word}" / "This is ${word}" / "${word} is commonly used"
   - "The X used ${word} to ..." / "We can see ${word} in ..." (câu chêm từ vào cho có)
   - "Using ${word} in a sentence: ..." / "Here is a sentence with ${word}"
   - "The teacher explained the meaning of ${word} to the students." (khuôn mẫu lặp lại)
4. Độ dài: 8-15 từ. Câu càng giống sách báo/tạp chí càng tốt.
5. Bản dịch tiếng Việt phải tự nhiên, truyền đạt đúng nghĩa và giữ nguyên cách dùng "${word}" trong câu gốc.

VÍ DỤ MẪU đúng yêu cầu:
- "eat" → {"example":"I eat breakfast every morning.","exampleVi":"Tôi ăn sáng mỗi buổi sáng."}
- "however" → {"example":"She was tired; however, she kept on working.","exampleVi":"Cô ấy mệt; tuy nhiên, cô vẫn tiếp tục làm việc."}
- "profound transformation" → {"example":"Technology has brought about a profound transformation in modern society.","exampleVi":"Công nghệ đã mang lại một sự biến đổi sâu sắc trong xã hội hiện đại."}

VÍ DỤ MẪU SAI (tuyệt đối KHÔNG làm thế này):
- "however" → {"example":"The singer used however to transition from one song to another.","exampleVi":"..."} ❌ (câu chêm từ vào một cách gượng ép, không tự nhiên)

Trả về ĐÚNG JSON (không kèm markdown, không kèm giải thích): {"example":"...","exampleVi":"..."}`;

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
            if (hasGroq) {
                const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.groqApiKey}` },
                    body: JSON.stringify({
                        model: this.groqModel,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.3
                    })
                });
                if (!res.ok) return null;
                const data = await res.json();
                const rawText = data.choices?.[0]?.message?.content || '{}';
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
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || (!hasOpenAI && !this.groqApiKey));
        const hasGroq = this.groqApiKey && (this.provider === 'groq' || (!hasOpenAI && !hasGemini));
        if (!hasOpenAI && !hasGemini && !hasGroq) return {};

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
                } else if (hasGroq) {
                    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.groqApiKey}` },
                        body: JSON.stringify({
                            model: this.groqModel,
                            messages: [{ role: 'user', content: prompt }],
                            response_format: { type: "json_object" },
                            temperature: 0
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const rawText = data.choices?.[0]?.message?.content || '{}';
                        obj = JSON.parse(rawText.replace(/```json|```/g, '').trim());
                    }
                }
                Object.keys(obj || {}).forEach((k) => {
                    const key = k.trim().toLowerCase();
                    let val = String(obj[k] || '').trim();
                    if (val && !val.startsWith('/')) val = `/${val}`;
                    if (val && !val.endsWith('/')) val = `${val}/`;
                    // Never cache a model echo such as "/perpetual interruption/".
                    // It looks like IPA but is objectively not a transcription.
                    const checked = this._sanitizeAiIpa(val, key);
                    if (checked && checked.length > 2) this._ipaCache.set(key, checked);
                });
            } catch (e) { /* ignore — leave uncached words out */ }
        }

        const out = {};
        uniq.forEach((w) => { if (this._ipaCache.has(w)) out[w] = this._ipaCache.get(w); });
        return out;
    }

    /**
     * Builds a compact glossary for every distinct lexical item in pasted text.
     *
     * The old flow only asked AI about highlighted/key terms, which silently
     * omitted ordinary words from the summary. This method intentionally covers
     * every supplied word form. It first trusts a curated entry, then attempts a
     * dictionary pronunciation for single words, and only then asks the configured
     * AI for a contextual fallback. A missing value stays visibly unresolved instead
     * of being replaced with a made-up rule-based IPA.
     */
    async enrichVocabularyTerms(rawTerms, progressCallback = null) {
        const seen = new Set();
        const terms = (rawTerms || []).map((raw) => {
            const original = (typeof raw === 'string' ? raw : (raw.original || raw.word || raw.text || '')).toString().trim();
            const context = (typeof raw === 'object' && raw ? (raw.context || '') : '').toString().trim();
            return { original, context };
        }).filter(({ original }) => {
            const key = original.toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        if (!terms.length) return [];

        const dict = window.dictionaryDB;
        const entries = terms.map(({ original, context }) => {
            const hasCurated = !!(dict && dict.hasRealEntry && dict.hasRealEntry(original));
            const ipa = hasCurated ? (dict.getIPA(original) || '') : '';
            return {
                original,
                context,
                ipa,
                ipaSource: hasCurated ? 'curated' : '',
                pos: dict && dict.getPOS ? (dict.getPOS(original) || '') : '',
                contextMeaning: dict && dict.getMeaning ? (dict.getMeaning(original) || '') : ''
            };
        });

        // A dictionary reference is used before the LLM for a single word. Phrases
        // are intentionally skipped: their pronunciation depends on the whole phrase
        // and dictionary APIs usually only know individual headwords.
        const referenceCandidates = entries.filter(e => !e.ipa && !/[\s-]/.test(e.original));
        const referenceResults = new Map();
        const CONCURRENCY = 6;
        for (let i = 0; i < referenceCandidates.length; i += CONCURRENCY) {
            const batch = referenceCandidates.slice(i, i + CONCURRENCY);
            const values = await Promise.all(batch.map(async (entry) => ({
                key: entry.original.toLowerCase(),
                ipa: await this._fetchDictionaryIpa(entry.original)
            })));
            values.forEach(({ key, ipa }) => { if (ipa) referenceResults.set(key, ipa); });
        }
        entries.forEach((entry) => {
            const referenceIpa = referenceResults.get(entry.original.toLowerCase());
            if (referenceIpa) {
                entry.ipa = referenceIpa;
                entry.ipaSource = 'dictionary';
            }
        });

        // Ask the selected AI only for missing meanings / pronunciations. Sending
        // the actual sentence lets it choose a sensible meaning for a homograph.
        const needsAi = entries.filter(e => !e.contextMeaning || !e.ipa);
        const remote = await this._fetchVocabularyDetails(needsAi, progressCallback);
        entries.forEach((entry) => {
            const data = remote.get(entry.original.toLowerCase());
            if (!data) return;
            if (!entry.contextMeaning && data.contextMeaning) entry.contextMeaning = data.contextMeaning;
            if (!entry.pos && data.pos) entry.pos = data.pos;
            // AI IPA is retained only as an explicitly-labelled fallback. The UI
            // distinguishes it from a dictionary/curated transcription.
            if (!entry.ipa && data.ipa) {
                entry.ipa = data.ipa;
                entry.ipaSource = 'ai';
            }
        });
        return entries;
    }

    async _fetchDictionaryIpa(word) {
        const clean = (word || '').trim();
        if (!clean || /[\s-]/.test(clean)) return '';
        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`);
            if (!response.ok) return '';
            const data = await response.json();
            const phonetics = Array.isArray(data?.[0]?.phonetics) ? data[0].phonetics : [];
            const candidate = phonetics.find(p => p && p.text && /[\u0250-\u02FF\u1D00-\u1D7F\u02C8\u02CC]/.test(p.text));
            const raw = candidate?.text || '';
            if (!raw) return '';
            const wrapped = raw.startsWith('/') ? raw : `/${raw}/`;
            return this._sanitizeAiIpa(wrapped, clean);
        } catch (e) {
            return '';
        }
    }

    async _fetchVocabularyDetails(entries, progressCallback = null) {
        const output = new Map();
        if (!entries || !entries.length) return output;
        const batchSize = 40;
        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                items: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            original: { type: 'string' },
                            ipa: { type: 'string' },
                            pos: { type: 'string' },
                            contextMeaning: { type: 'string' }
                        },
                        required: ['original', 'ipa', 'pos', 'contextMeaning']
                    }
                }
            },
            required: ['items']
        };
        const allowed = new Set(entries.map(e => e.original.toLowerCase()));
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            if (progressCallback) progressCallback(i, entries.length, `Đang tra ${Math.min(i + batch.length, entries.length)}/${entries.length} từ...`);
            const prompt = `You are an English-Vietnamese dictionary editor. Return JSON only. For EVERY supplied item, copy original exactly, provide a standard IPA pronunciation appropriate to its sentence context, a short POS label, and a concise Vietnamese contextMeaning. Do not invent words and do not omit an item. IPA must use /.../ delimiters and stress marks.\nItems: ${JSON.stringify(batch.map(e => ({ original: e.original, context: e.context || '' })) )}`;
            const parsed = await this._callProviderJson(prompt, schema, 'return_complete_vocabulary');
            const items = Array.isArray(parsed?.items) ? parsed.items : [];
            items.forEach((item) => {
                const original = (item?.original || '').toString().trim();
                const key = original.toLowerCase();
                if (!allowed.has(key) || output.has(key)) return;
                const ipa = this._sanitizeAiIpa(item.ipa || '', original);
                output.set(key, {
                    ipa,
                    pos: (item.pos || '').toString().trim(),
                    contextMeaning: (item.contextMeaning || '').toString().trim()
                });
            });
        }
        return output;
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
        const hasGemini = this.geminiApiKey && (this.provider === 'gemini' || (!hasOpenAI && !this.groqApiKey));
        const hasGroq = this.groqApiKey && (this.provider === 'groq' || (!hasOpenAI && !hasGemini));
        if (!hasOpenAI && !hasGemini && !hasGroq) return null;

        // Per user request: tra từ theo kiểu từ điển THẬT (Oxford/Cambridge). Trả nghĩa phổ biến,
        // ví dụ là câu tiếng Anh TỰ NHIÊN — không phải câu máy móc "The word X..." hay "She used X to...".
        const prompt = `Bạn là từ điển Anh-Việt Oxford/Cambridge. Tra cứu từ/cụm từ cho người học tiếng Anh.

Từ/cụm từ cần tra: "WORD_PLACEHOLDER"

═══════════════════════════════════════
HƯỚNG DẪN TRA TỪ CHI TIẾT — ÁP DỤNG LINH HOẠT
═══════════════════════════════════════

Bạn PHẢI phân tích từ/cụm từ đầu vào rồi quyết định cách trình bày tối ưu:

🅰️ TỪ ĐƠN (1 từ như "eat", "however", "innovation"):
   - "meaning": NGẮN GỌN tiếng Việt (≤8 từ) theo NGHĨA PHỔ BIẾN NHẤT của từ.
   - "breakdown": 1 phần tử (cho chính từ đó).
   - "structures": 2-3 cụm từ collocation phổ biến (vd "innovation in + field", "drive innovation", "technological innovation").

🅱️ CỤM TỪ 2 TỪ (như "take off", "break down", "in spite of"):
   - Đây có thể là:
     * PHRASAL VERB ("take off", "break down") → CỰC KỲ quan trọng nhận diện đúng.
     * COLLOCATION đơn giản ("deeply concerned", "strong influence").
     * IDIOM ("spill the beans", "kick the bucket").
   - "meaning": NGHĨA CẢ CỤM (≤12 từ).
   - "breakdown": PHÂN TÍCH TỪNG TỪ (2 phần tử) — nhưng lưu ý: nếu là phrasal verb/idiom, breakdown chỉ giải thích nghĩa từng từ chứa trong cụm ĐỂ GIÚP NHỚ, không cộng nghĩa lại.
   - "structures": 2-3 câu/cấu trúc phổ biến có chứa cụm này.

🅲️ CỤM TỪ 3+ TỪ hoặc IDIOM DÀI (như "take advantage of", "on the other hand", "spill the beans"):
   - "meaning": NGHĨA CẢ CỤM dạng "sự/việc/... + ..." (≤12 từ).
   - "breakdown": TỪNG TỪ trong cụm (nếu là cụm rời rạc) HOẶC gộp cả cụm thành 1 dòng phân tích (nếu là idiom cố định).
   - "structures": 2-3 câu/cấu trúc PHỔ BIẾN.

🅳️ CỤM TỪ CÓ "THE/OVER/OF" — KHÔNG DỊCH LITERAL:
   - "in spite of" ≠ "trong sự bướng bỉnh của" → "bất chấp / mặc dù"
   - "on the other hand" ≠ "trên bàn tay khác" → "mặt khác"
   - "with regard to" ≠ "với sự liên quan đến" → "về / liên quan đến"
   - "in addition to" → "ngoài ra / bên cạnh"
   - "as a result of" → "do / vì / là hệ quả của"
   - "in front of" → "trước / đằng trước"
   - "because of" → "vì / bởi vì"
   - Luôn dịch NGHĨA CHỨC NĂNG, KHÔNG dịch từng từ.

🅴️ CỤM TỪ CÓ TỪ HÁN-VIỆT PHỔ BIẾN — CẨN THẬN:
   - "make a decision" → "đưa ra quyết định" (KHÔNG "làm một quyết định")
   - "take a look" → "xem qua / nhìn qua"
   - "have a conversation" → "trò chuyện / nói chuyện"
   - "make a difference" → "tạo nên sự khác biệt"
   - "take into account" → "tính đến / xem xét"
   - "pay attention to" → "chú ý đến"
   - "take into consideration" → "cân nhắc"

═══════════════════════════════════════
YÊU CẦU BẮT BUỘC VỀ ĐỊNH DẠNG
═══════════════════════════════════════

1. "ipa": IPA CHUẨN của từ/cả cụm (cụm có ' /' giữa các từ, vd: /ˌtɛkˈnɒlədʒɪkəl ɪnəˈveɪʃən/). Cho cụm 2+ từ: trả IPA đầy đủ cả cụm (có 'ˌ' và 'ˈ' rõ ràng).
2. "pos": TỪ ĐƠN: "n." / "v." / "adj." / "adv." / "prep." / "conj." / "pron." / "interj." / "det." / "aux." CỤM TỪ (2+ từ): "phr." hoặc cụ thể ("n. phr." / "v. phr." / "adj. phr." / "idiom").
3. "meaning": như trên (≤8 từ cho đơn, ≤12 từ cho cụm).
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
5. "example": BẮT BUỘC — MỘT câu tiếng Anh TỰ NHIÊN, NGẮN GỌN, DỄ HIỂU (đúng kiểu câu ví dụ trong từ điển Oxford/Cambridge) CÓ CHỨA đúng từ/cụm từ đang học.
   QUY TẮC CỨNG:
   - Câu phải là câu ĐỜI THỰC người bản xứ sẽ nói/viết — không phải câu ngữ pháp khô khan hay câu chêm từ vào cho có.
   - TUYỆT ĐỐI KHÔNG dùng các mẫu câu SIÊU SAI sau (AI hay mắc):
     • "The word X..." / "The phrase X..." / "The term X..."
     • "Example with X" / "Example of X" / "This is X" / "Here is X"
     • "X is commonly used" / "X is used" / "X appears in"
     • "She/He/They used the word X..." / "She/He/They used X to..." (chêm từ vào gượng ép)
     • "The X used Y to Z..." (câu ngữ pháp khô khan)
     • "Using X in a sentence: ..." / "Here is a sentence with X"
     • "We use X when..." / "We can see X in..."
   - Câu MẪU SAI CỤ THỂ (không được viết y chang):
     • "institutions" → "She used the word 'institutions' in her essay." ❌
     • "however" → "The singer used however to transition from one song to another." ❌
   - Độ dài 8-15 từ. Càng giống sách báo/tạp chí càng tốt.
   MẪU ĐÚNG:
   - "eat" → "I eat breakfast every morning."
   - "however" → "She was tired; however, she kept on working."
   - "institutions" → "The charity works with local institutions to provide food and shelter."
   - "profound transformation" → "Technology has brought about a profound transformation in modern society."
   - "take advantage of" → "She took advantage of the sale to buy new clothes."
6. "exampleVi": bản dịch tiếng Việt TỰ NHIÊN, MƯỢT MÀ của đúng câu example ở trên (KHÔNG dịch máy móc từng từ).
   MẪU: "I eat breakfast every morning." → "Tôi ăn sáng mỗi buổi sáng."
7. "structures": 2-3 cấu trúc / cụm từ / thành ngữ PHỔ BIẾN có chứa hoặc liên quan đến từ. Mỗi cấu trúc: "name", "note" (1 dòng), "example" (câu TỰ NHIÊN), "exampleVi".

Trả về ĐÚNG JSON (không kèm markdown):
{
  "ipa": "phiên âm IPA chuẩn của từ/cụm từ",
  "pos": "loại từ viết tắt",
  "meaning": "nghĩa tiếng Việt ngắn gọn (≤8 từ cho đơn, ≤12 từ cho cụm)",
  "breakdown": [{"word": "từ 1", "ipa": "...", "pos": "...", "meaning": "..."}],
  "example": "câu tiếng Anh TỰ NHIÊN chứa từ",
  "exampleVi": "bản dịch tiếng Việt MƯỢT MÀ của câu example",
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

        if (hasGroq) {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.groqApiKey}` },
                body: JSON.stringify({
                    model: this.groqModel,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.2
                })
            });
            if (!res.ok) throw new Error(`Groq lookup error: ${res.status}`);
            const data = await res.json();
            const rawText = data.choices?.[0]?.message?.content || '{}';
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

            // Example is filled per-word by _enrichVocabExamplesWithAI, called from app.js
            // after this function returns. We don't pre-fill a template because every
            // word would end up showing the same sentence ("\"X\" is used in this
            // context.") which looks fake and gets repeated across the whole vocab list.
            vocabList.push({
                original: item.word,
                color: item.color,
                category: category,
                ipa: item.ipa,
                contextMeaning: meaning,
                translatedTermInVN: meaning,
                example: ""
            });
        }

        return {
            translatedText: translatedText,
            vocabList: vocabList
        };
    }

    /**
     * For every vocab entry that has no example yet, call the AI once with a unique
     * topic hint so each word gets a DIFFERENT natural sentence. Mutates entries in
     * place: entry.example (English) and entry.exampleVi (Vietnamese).
     *
     * @param {Array} vocabList - the vocab entries to enrich
     * @param {Function} [onBatch] - optional callback invoked after each batch finishes
     *                                with the number of items enriched so far. Used by
     *                                the UI to re-render as examples stream in.
     */
    async _enrichVocabExamplesWithAI(vocabList, onBatch = null) {
        if (!Array.isArray(vocabList) || vocabList.length === 0) return;
        const topicHints = [
            'everyday conversation', 'a news headline', 'a science textbook',
            'a travel blog', 'a movie review', 'a recipe blog', 'a sports article',
            'a history book', 'a tech blog', 'a diary entry', 'a business email',
            'a children\'s story', 'a weather report', 'a documentary script',
            'a cooking tutorial', 'a fitness magazine', 'a fashion article',
            'a social media post', 'a forum discussion', 'a song lyric',
            'an academic lecture', 'a TED talk transcript', 'a job interview',
            'a podcast interview', 'a tourist guidebook', 'a bedtime story'
        ];
        const tasks = vocabList.map((entry, idx) => async () => {
            if (!entry || !entry.original) return false;
            if (entry.example && entry.example.trim()) return false;
            const topic = topicHints[idx % topicHints.length];
            try {
                const ai = await this._generateExampleWithAI(entry.original, topic);
                if (ai && ai.example && ai.example.trim()) {
                    entry.example = ai.example.trim();
                    if (ai.exampleVi && ai.exampleVi.trim()) {
                        entry.exampleVi = ai.exampleVi.trim();
                    }
                    return true;
                }
            } catch (_) { /* swallow; popup will show "Chưa có câu ví dụ" */ }
            return false;
        });
        // Run in small parallel batches so we don't hammer the API or block forever.
        const batchSize = 4;
        let totalEnriched = 0;
        for (let i = 0; i < tasks.length; i += batchSize) {
            const batch = tasks.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(fn => fn()));
            totalEnriched += results.filter(Boolean).length;
            if (typeof onBatch === 'function') {
                try { onBatch(totalEnriched, vocabList.length); } catch (_) { }
            }
        }
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
        // Deep-scan mode: cast a comprehensive net so no valuable vocabulary slips through.
        // Extracts ALL collocations, phrasal verbs, adv+adj / adv+v combos, V+N / Adj+N / N+N, idioms,
        // grammar structures, AND standout single-word academic C1/C2 vocabulary regardless of text length.
        const minTerms = Math.max(35, Math.min(90, Math.round(wordCount / 3.5)));
        const maxTerms = Math.max(70, Math.min(160, Math.round(wordCount / 2)));

        const prompt = `
Bạn là nhà ngôn ngữ học và giáo viên tiếng Anh chuyên sâu (C2/CEFR), biên soạn tài liệu học từ vựng CỰC KỲ CHI TIẾT & TOÀN DIỆN, KHÔNG BỎ SÓT bất kỳ từ/cụm từ hay nào trong bài.
Nhiệm vụ: Quét THẬT KỸ, THẬT CHI TIẾT văn bản tiếng Anh dưới đây và trích xuất TỐI THIỂU ${minTerms} và TỐI ĐA ${maxTerms} từ/cụm từ/cấu trúc QUAN TRỌNG VÀ HAY để học. Hãy quét toàn diện, không bỏ lọt các từ vựng học thuật/nâng cao đơn lẻ dù chúng không nằm liền kề nhau trong câu. Mục tiêu là NGƯỜI HỌC có thể đọc văn bản bất kì và được highlight toàn bộ các cụm/từ đáng học — ĐẦY ĐỦ VÀ CHI TIẾT NHẤT.

NHÓM CẦN TRÍCH XUẤT (lấy ĐẦY ĐỦ CẢ 9 NHÓM, không bỏ sót nhóm nào):
1. collocation_adj_noun  — Adj + N: tính từ + danh từ (profound impact, paradigm shift, unprecedented challenges, cutting-edge technology, rigorous methodology, sustainable development, empirical evidence, groundbreaking research)
2. collocation_verb_noun — V + N: động từ + danh từ (carry out research, draw conclusions, shed light on, exert influence, raise awareness, achieve breakthrough, hold significance, play a role)
3. collocation_noun_noun — N + N: danh từ ghép danh từ (carbon emissions, paradigm shift, climate change, energy consumption, knowledge gap, brain drain, feedback loop, life cycle)
4. collocation_adv_adj   — Adv + Adj: trạng từ + tính từ (deeply rooted, highly effective, remarkably efficient, increasingly important, extremely complex, inherently flawed, profoundly influential)
5. collocation_adv_verb  — Adv + V: trạng từ + động từ (gradually reduce, rapidly expand, substantially improve, fundamentally alter, thoroughly examine, consistently demonstrate, dramatically transform)
6. phrasal_verb          — Cụm động từ V + particle/prep (carry out, break down, figure out, give rise to, bring about, come up with, result in, lead to, account for, take into account, set apart, rule out, draw upon)
7. idiom                 — Thành ngữ & cụm giới từ cố định (a drop in the ocean, in light of, on the other hand, by virtue of, with respect to, in the long run, at the expense of, for the sake of)
8. grammar               — Cấu trúc ngữ pháp ĐẶC BIỆT (inverted conditional, cleft sentence, no sooner...than, so...that, such...that, the more...the more, not only...but also, despite/in spite of + N/V-ing, as...as, whereas/while contrastive)
9. vocabulary            — TỪ ĐƠN học thuật/khó/nâng cao C1-C2 (tính từ, động từ, danh từ, trạng từ): LẤY TẤT CẢ các từ học thuật nổi bật xuất hiện trong bài, KỂ CẢ khi chúng đứng riêng lẻ (ví dụ: "pivotal", "sustainable", "resilient", "profound", "meticulous", "ubiquitous", "leverage", "underpin", "underscore", "elucidate", "constitute", "scrutinize", "catalyst"...). Trích xuất DỒN DẬP TẤT CẢ từ học thuật đáng nhớ.

QUY TẮC BẮT BUỘC:
- Tổng cộng ${minTerms}-${maxTerms} mục — PHẢI đạt tối thiểu ${minTerms}, lấy đầy đủ nhất có thể.
- Mỗi mục PHẢI xuất hiện NGUYÊN VĂN trong văn bản (trừ grammar structures).
- KHÔNG lặp lại, KHÔNG lấy từ quá phổ thông/cơ bản (the, is, very, good, big, make, do, have, get, take khi đứng 1 mình).
- Với cụm từ: ưu tiên cụm 2-3 từ; chỉ lấy cụm 4+ từ khi nó thật sự là idiom/cấu trúc cố định.

Trả về JSON (không kèm markdown block), mỗi mục có "text" và "category":
{
  "keyTerms": [
    {"text": "fundamentally altered", "category": "collocation_adv_verb"},
    {"text": "profound impact", "category": "collocation_adj_noun"},
    {"text": "carry out", "category": "phrasal_verb"},
    {"text": "ubiquitous", "category": "vocabulary"},
    {"text": "pivotal", "category": "vocabulary"}
  ]
}

Văn bản:
"""
${chunkText}
"""
`;

        const { provider, apiKey, model } = this._getScanCredentials();
        const aiErrors = [];

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

        // Try Groq first if Groq API key is present or Groq is selected provider
        if ((provider === 'groq' || this.groqApiKey) && (apiKey || this.groqApiKey)) {
            const useKey = provider === 'groq' ? apiKey : this.groqApiKey;
            const primaryModel = provider === 'groq' ? model : this.groqModel;
            const modelsToTry = [primaryModel, 'llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'];
            const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));

            for (const groqModelCandidate of uniqueModels) {
                try {
                    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useKey}` },
                        body: JSON.stringify({
                            model: groqModelCandidate,
                            messages: [{ role: 'user', content: prompt }],
                            response_format: { type: "json_object" },
                            temperature: 0.2,
                            max_tokens: 4096
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        const rawText = data.choices?.[0]?.message?.content || '{}';
                        const json = JSON.parse(rawText.replace(/```json|```/g, '').trim());
                        const terms = normalizeTerms(json.keyTerms);
                        if (terms && terms.length > 0) return terms;
                    }
                    aiErrors.push(`Groq (${groqModelCandidate}): status ${res.status}`);
                } catch (e) {
                    aiErrors.push(`Groq (${groqModelCandidate}): ${e.message}`);
                }
            }
        }

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
                        temperature: 0.2,
                        max_tokens: 4096
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
                        generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 4096 }
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
            return offlineTerms;
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
            { regex: /\bin spite of\b/gi, name: 'in spite of' },
            { regex: /\bregardless of\b/gi, name: 'regardless of' },
            { regex: /\bby virtue of\b/gi, name: 'by virtue of' },
            { regex: /\bin light of\b/gi, name: 'in light of' },
            { regex: /\bon account of\b/gi, name: 'on account of' },
            { regex: /\bas a result of\b/gi, name: 'as a result of' },
            { regex: /\bas a consequence\b/gi, name: 'as a consequence' },
            { regex: /\bwith regard to\b/gi, name: 'with regard to' },
            { regex: /\bin terms of\b/gi, name: 'in terms of' },
            { regex: /\bin addition to\b/gi, name: 'in addition to' },
            { regex: /\bon the other hand\b/gi, name: 'on the other hand' },
            { regex: /\bnotwithstanding\b/gi, name: 'notwithstanding' },
            { regex: /\bby and large\b/gi, name: 'by and large' },
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
        const MAX_TOTAL = 150;
        const MAX_VOCAB = 80;
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
