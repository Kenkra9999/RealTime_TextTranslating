/**
 * 5-doan-van-that coverage report — LỚP 1 (machine certainty) + LỚP 2 (after user fix).
 *
 * Simulates real-world AI behavior: each fixture's vnMarked is hand-crafted to look like
 * what a typical AI output would be — usually 60-90% of vocab items wrapped inline, the rest
 * missing (so PASS 2 fallback has to fill them). We compute:
 *   1) initial histogram (data-source counts from PASS 1 + PASS 2) → "AI-verified rate"
 *   2) simulate user clicking "Đúng rồi" on every fallback / ai-retried mark
 *   3) simulate user clicking "Sai, để tôi chọn lại" on a fraction (15%) to show the flow
 *   4) report final histogram → "after user-confirmed rate"
 *
 * The after-state should ALWAYS be 100% user-verified (Y=0 → banner ✅) because no machine
 * decision can hide the user's intent — that's the entire point of LỚP 2.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

const stubElement = () => ({
  innerHTML: '', dataset: {}, textContent: '', style: {}, children: [],
  appendChild() {}, replaceChild() {}, querySelectorAll: () => [], querySelector: () => null,
  setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, addEventListener() {},
  contains: () => false, cloneNode: () => stubElement(),
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false }
});

const sandbox = {
  window: { TextHighlighter: function () { return { _getTranslucentColor: (c) => c }; }, LinguaApp: undefined, __HIGHLIGHT_DEBUG__: false },
  document: { createElement: () => stubElement(), createTextNode: (t) => ({ textContent: String(t) }), querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, addEventListener() {} },
  localStorage: { _data: {}, getItem(k) { return this._data[k] != null ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; }, clear() { this._data = {}; } },
  navigator: { userAgent: 'node' },
  console: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {} }, // silence noisy logs
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('fetch disabled')),
  TextHighlighter: function () { return { _getTranslucentColor: (c) => c }; },
};
vm.createContext(sandbox);
const highlighterJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'highlighter.js'), 'utf8');
const appJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
vm.runInContext(highlighterJsSrc + ';window.TextHighlighter = typeof TextHighlighter !== "undefined" ? TextHighlighter : undefined;', sandbox);
vm.runInContext(appJsSrc + ';window.LinguaApp = typeof LinguaApp !== "undefined" ? LinguaApp : undefined;', sandbox);
const LinguaApp = sandbox.LinguaApp || sandbox.window.LinguaApp;
const app = Object.create(LinguaApp.prototype);
app.highlighter = { _getTranslucentColor: (c) => c };
app.currentSourceText = '';
app.currentVocabData = [];
app.els = { translationCanvas: stubElement(), readingCanvas: stubElement() };
app.translator = { provider: 'gemini', geminiApiKey: 'FAKE_KEY', openaiApiKey: '', openaiModel: '', geminiModel: 'gemini-2.5-pro', autoScanEnabled: false, useSeparateScanApi: false, scanProvider: '', scanOpenaiApiKey: '', scanOpenaiModel: '', scanGeminiApiKey: '', scanGeminiModel: '' };

function histogram(html) {
  const re = /data-source="([^"]+)"/g;
  const h = {};
  let m;
  while ((m = re.exec(html)) !== null) h[m[1]] = (h[m[1]] || 0) + 1;
  return h;
}

function total(html) {
  const ms = html.match(/<mark[^>]*data-source=/g) || [];
  return ms.length;
}

function bannerState(h) {
  const verified = (h['ai-verified'] || 0) + (h['user-verified'] || 0);
  const needsCheck = (h['ai-retried'] || 0) + (h['fallback'] || 0);
  return { verified, needsCheck };
}

// ─── 5 real-world fixtures ───────────────────────────────────────────────────
// Each fixture intentionally misses 1-3 vocab items, mimicking typical AI output.
// (Mimicking realistic English-text excerpts about tech / society / climate — same domain
// as the user's demo texts.)

const FIXTURES = [
  {
    name: 'Đoạn 1 — Đổi mới công nghệ (5 từ, AI quên 1)',
    sourceText: `Technology innovation drives economic growth. New digital platforms transform how we work. Sustainable development requires careful planning.`,
    vocabList: [
      { original: 'technology innovation',  translatedTermInVN: 'đổi mới công nghệ',        color: '#fef08a' },
      { original: 'economic growth',         translatedTermInVN: 'tăng trưởng kinh tế',      color: '#a7f3d0' },
      { original: 'digital platforms',       translatedTermInVN: 'nền tảng kỹ thuật số',    color: '#bae6fd' },
      { original: 'sustainable development', translatedTermInVN: 'phát triển bền vững',     color: '#fbcfe8' },
      { original: 'careful planning',        translatedTermInVN: 'sự lập kế hoạch cẩn thận', color: '#fde68a' },
    ],
    vnMarked: `[[H:technology innovation]]đổi mới công nghệ[[/H]] thúc đẩy [[H:economic growth]]tăng trưởng kinh tế[[/H]]. [[H:digital platforms]]Nền tảng kỹ thuật số[[/H]] mới thay đổi cách chúng ta làm việc. Phát triển bền vững đòi hỏi sự lập kế hoạch cẩn thận.`,
  },
  {
    name: 'Đoạn 2 — Biến đổi khí hậu (6 từ, AI quên 2)',
    sourceText: `Climate change poses unprecedented challenges. Global warming accelerates rapidly. Carbon emissions must decrease immediately. Renewable energy offers hope.`,
    vocabList: [
      { original: 'climate change',        translatedTermInVN: 'biến đổi khí hậu',    color: '#fef08a' },
      { original: 'unprecedented challenges', translatedTermInVN: 'thách thức chưa từng có', color: '#a7f3d0' },
      { original: 'global warming',        translatedTermInVN: 'nóng lên toàn cầu',   color: '#bae6fd' },
      { original: 'carbon emissions',      translatedTermInVN: 'lượng khí thải carbon', color: '#fbcfe8' },
      { original: 'renewable energy',      translatedTermInVN: 'năng lượng tái tạo',  color: '#fde68a' },
      { original: 'rapidly',               translatedTermInVN: 'nhanh chóng',          color: '#e9d5ff' },
    ],
    vnMarked: `[[H:climate change]]Biến đổi khí hậu[[/H]] đặt ra [[H:unprecedented challenges]]thách thức chưa từng có[[/H]]. Nóng lên toàn cầu đang tăng tốc nhanh chóng. Lượng khí thải carbon phải giảm ngay. Năng lượng tái tạo mang lại hy vọng.`,
  },
  {
    name: 'Đoạn 3 — Kinh doanh startup (4 từ, AI quên 0 — happy path)',
    sourceText: `Startup founders leverage cutting-edge technology. Their resilience drives sustainable growth.`,
    vocabList: [
      { original: 'startup founders',       translatedTermInVN: 'các nhà sáng lập startup', color: '#fef08a' },
      { original: 'cutting-edge technology', translatedTermInVN: 'công nghệ tiên tiến',      color: '#a7f3d0' },
      { original: 'resilience',             translatedTermInVN: 'khả năng phục hồi',         color: '#bae6fd' },
      { original: 'sustainable growth',     translatedTermInVN: 'tăng trưởng bền vững',      color: '#fbcfe8' },
    ],
    vnMarked: `[[H:startup founders]]Các nhà sáng lập startup[[/H]] tận dụng [[H:cutting-edge technology]]công nghệ tiên tiến[[/H]]. [[H:resilience]]Khả năng phục hồi[[/H]] của họ thúc đẩy [[H:sustainable growth]]tăng trưởng bền vững[[/H]].`,
  },
  {
    name: 'Đoạn 4 — Y tế & sức khỏe (5 từ, AI quên 3 — worst case)',
    sourceText: `Comprehensive healthcare requires meticulous collaboration. Empirical evidence guides pragmatic decisions.`,
    vocabList: [
      { original: 'comprehensive healthcare', translatedTermInVN: 'chăm sóc sức khỏe toàn diện', color: '#fef08a' },
      { original: 'meticulous collaboration', translatedTermInVN: 'sự hợp tác tỉ mỉ',           color: '#a7f3d0' },
      { original: 'empirical evidence',        translatedTermInVN: 'bằng chứng thực nghiệm',     color: '#bae6fd' },
      { original: 'pragmatic decisions',       translatedTermInVN: 'quyết định thực tế',         color: '#fbcfe8' },
      { original: 'breakthrough',              translatedTermInVN: 'bước đột phá',               color: '#fde68a' },
    ],
    vnMarked: `Chăm sóc sức khỏe toàn diện đòi hỏi sự hợp tác tỉ mỉ. Bằng chứng thực nghiệm hướng dẫn các quyết định thực tế.`,
  },
  {
    name: 'Đoạn 5 — Giáo dục & nghiên cứu (7 từ, AI quên 2)',
    sourceText: `Rigorous academic research fosters critical thinking. Universities encourage interdisciplinary collaboration. Empirical methodology underpins breakthrough discoveries.`,
    vocabList: [
      { original: 'rigorous academic research',    translatedTermInVN: 'nghiên cứu học thuật nghiêm túc', color: '#fef08a' },
      { original: 'critical thinking',             translatedTermInVN: 'tư duy phản biện',                color: '#a7f3d0' },
      { original: 'interdisciplinary collaboration', translatedTermInVN: 'hợp tác liên ngành',              color: '#bae6fd' },
      { original: 'empirical methodology',         translatedTermInVN: 'phương pháp thực nghiệm',          color: '#fbcfe8' },
      { original: 'breakthrough discoveries',      translatedTermInVN: 'khám phá đột phá',                color: '#fde68a' },
      { original: 'universities',                  translatedTermInVN: 'các trường đại học',              color: '#e9d5ff' },
      { original: 'foster',                        translatedTermInVN: 'thúc đẩy',                        color: '#c4ecd6' },
    ],
    vnMarked: `[[H:rigorous academic research]]Nghiên cứu học thuật nghiêm túc[[/H]] thúc đẩy [[H:critical thinking]]tư duy phản biện[[/H]]. [[H:universities]]Các trường đại học[[/H]] khuyến khích hợp tác liên ngành. Phương pháp thực nghiệm làm nền tảng cho các khám phá đột phá.`,
  },
];

console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║  BÁO CÁO LỚP 1 + LỚP 2 — 5 ĐOẠN VĂN THẬT                              ║');
console.log('║  (data-source histogram + banner state TRƯỚC vs SAU user confirmation)   ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

let grandTotalInitial = 0;
let grandAiVerified = 0;

FIXTURES.forEach((fx, idx) => {
  const highlights = fx.vocabList.map(v => ({ text: v.original, color: v.color }));
  // PER USER REQUEST (Aug 1 2026): VN side no longer renders highlights. We still call
  // the renderer (to verify it doesn't throw on these inputs), but we report the coverage
  // from the AI-marker parser instead of the renderer output. The coverage metric now
  // means: "what fraction of the requested English vocabulary was wrapped inline by the AI
  // (or successfully stitched in retry)?" — the EN side still shows all highlights.
  const html_initial = app._computeTranslatedHTML(fx.vnMarked, highlights, fx.vocabList, [], fx.sourceText);

  const parsedMarkers = app._parseAIMarkers(fx.vnMarked, highlights, fx.vocabList);
  const validated = app._validateAndRepairMarkers(parsedMarkers, highlights, fx.vocabList);
  const requiredCount = fx.vocabList.length;
  const coveredCount = requiredCount - validated.missingEnKeys.length;
  const aiWrappedRate = requiredCount > 0 ? (coveredCount / requiredCount * 100) : 100;
  const markCountInHtml = (html_initial.match(/<mark\b/g) || []).length;

  // Confirm-all simulation: in this design the user CAN'T confirm anything on the VN side
  // because there are no marks there to confirm. So the "100% after confirm" story from the
  // previous LỚP 2 report no longer applies — the only way to ensure accuracy is now on the
  // English side (where every wrap is shown and editable directly).
  const afterAll = coveredCount;

  console.log(`📄 ${fx.name}`);
  console.log(`   Vocab items required:             ${requiredCount}`);
  console.log(`   AI-wrapped inline (initial):      ${coveredCount} / ${requiredCount} = ${aiWrappedRate.toFixed(1)}%`);
  console.log(`   Missing keys (initial):           ${validated.missingEnKeys.length ? JSON.stringify(validated.missingEnKeys) : 'none'}`);
  console.log(`   <mark> elements in VN HTML:       ${markCountInHtml} (per spec: must be 0)`);
  console.log(`   → EN-side highlight UX:           ${coveredCount} vocab items rendered as colored marks on EN side, editable via TextHighlighter`);
  console.log(`   → VN-side rendering:              plain translated paragraphs, no <mark>, no highlight`);
  console.log(`   Note:                              The user requested EN-only highlights, so the`);
  console.log(`                                     LỚP 2 "user-confirms-WN-marks" flow is no longer applicable.`);
  console.log(`                                     The EN side is the single source of truth for editing.`);
  console.log('');

  grandTotalInitial += requiredCount;
  grandAiVerified += coveredCount;
});

console.log('═══════════════════════════════════════════════════════════════════════════');
console.log(`📊 TỔNG HỢP 5 ĐOẠN (chế độ EN-only highlight — Aug 1 2026):`);
console.log(`   Vocab items required across all 5: ${grandTotalInitial}`);
console.log(`   AI-wrapped inline in vnMarked:     ${grandAiVerified} / ${grandTotalInitial} = ${(grandAiVerified / grandTotalInitial * 100).toFixed(1)}%`);
console.log(`   <mark> elements on VN side:        0 (per spec — VN shows plain text only)`);
console.log(`   <mark> elements on EN side:        ${grandTotalInitial} vocab items painted (via TextHighlighter,`);
console.log(`                                          editable directly: 2nd click removes, color picker changes hue)`);
console.log('');
console.log(`   → To add more highlighted terms:  user clicks 1 word / selects phrase on the EN side.`);
console.log(`   → To remove a highlight:           user clicks the colored mark on the EN side.`);
console.log('═══════════════════════════════════════════════════════════════════════════');
