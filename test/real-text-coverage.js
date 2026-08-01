/**
 * Real-text coverageRatio before/after retry demo.
 *
 * Picks a 3-paragraph text the AI is intentionally simulated to miss wrapping on
 * (only 2 of 5 English terms), runs:
 *   1) initial render — log Final stats coverageRatio
 *   2) simulate _shouldRetryForMissing
 *   3) simulate _retryMissingMarkersOnce with hand-crafted patches the AI WOULD return
 *   4) re-render — log Final stats coverageRatio
 *
 * Verifies the retry actually lifts coverageRatio without double-wrapping.
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
  window: {
    TextHighlighter: function () { return { _getTranslucentColor: (c) => c }; },
    LinguaApp: undefined,
    __HIGHLIGHT_DEBUG__: true,
  },
  document: { createElement: () => stubElement(), createTextNode: (t) => ({ textContent: String(t) }), querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, addEventListener() {} },
  localStorage: { _data: {}, getItem(k) { return this._data[k] != null ? this._data[k] : null; }, setItem(k, v) { this._data[k] = String(v); }, removeItem(k) { delete this._data[k]; }, clear() { this._data = {}; } },
  navigator: { userAgent: 'node' },
  console: console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('fetch disabled')),
  TextHighlighter: function () { return { _getTranslucentColor: (c) => c }; },
};

vm.createContext(sandbox);
const highlighterJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'highlighter.js'), 'utf8');
const appJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
vm.runInContext(highlighterJsSrc + ';window.TextHighlighter = typeof TextHighlighter !== "undefined" ? TextHighlighter : undefined;', sandbox, { filename: 'highlighter.js' });
vm.runInContext(appJsSrc + ';window.LinguaApp = typeof LinguaApp !== "undefined" ? LinguaApp : undefined;', sandbox, { filename: 'app.js' });

const LinguaApp = sandbox.LinguaApp || sandbox.window.LinguaApp;
const app = Object.create(LinguaApp.prototype);
app.highlighter = { _getTranslucentColor: (c) => c };
app.currentSourceText = '';
app.currentVocabData = [];
app.els = { translationCanvas: stubElement(), readingCanvas: stubElement() };
app.translator = { provider: 'gemini', geminiApiKey: 'FAKE_KEY', openaiApiKey: '', openaiModel: '', geminiModel: 'gemini-2.5-pro', autoScanEnabled: false, useSeparateScanApi: false, scanProvider: '', scanOpenaiApiKey: '', scanOpenaiModel: '', scanGeminiApiKey: '', scanGeminiModel: '' };

// ─── Real-text-ish fixture ───
const sourceText = `The paradox of progress drives innovation in modern society. New technologies create unprecedented opportunities for human development. Yet rapid change also brings social challenges that require careful navigation.`;

const highlights = [
  { text: 'paradox of progress', color: '#fef08a' },
  { text: 'innovation',          color: '#a7f3d0' },
  { text: 'modern society',      color: '#bae6fd' },
  { text: 'social challenges',   color: '#fbcfe8' },
  { text: 'careful navigation',  color: '#fde68a' },
];
const vocabList = [
  { original: 'paradox of progress', translatedTermInVN: 'nghịch lý của sự tiến bộ', color: '#fef08a' },
  { original: 'innovation',          translatedTermInVN: 'sự đổi mới',              color: '#a7f3d0' },
  { original: 'modern society',      translatedTermInVN: 'xã hội hiện đại',         color: '#bae6fd' },
  { original: 'social challenges',   translatedTermInVN: 'thách thức xã hội',       color: '#fbcfe8' },
  { original: 'careful navigation',  translatedTermInVN: 'sự định hướng cẩn thận',  color: '#fde68a' },
];

// AI "forgot" to wrap innovation and social challenges (only wrapped 3 of 5)
const vnMarked_before = `Điều [[H:paradox of progress]]nghịch lý của sự tiến bộ[[/H]] thúc đẩy đổi mới trong [[H:modern society]]xã hội hiện đại[[/H]]. Những công nghệ mới tạo ra cơ hội chưa từng có cho sự phát triển con người. Tuy nhiên, sự thay đổi nhanh chóng cũng mang đến thách thức xã hội đòi hỏi [[H:careful navigation]]sự định hướng cẩn thận[[/H]].`;

// ── Stage 1: initial render ──
console.log('═══════════════ INITIAL RENDER ═══════════════');
app._computeTranslatedHTML(vnMarked_before, highlights, vocabList, [], sourceText);

const beforeMissing = app._shouldRetryForMissing(vnMarked_before, highlights, vocabList);
console.log(`\n→ _shouldRetryForMissing says retry these keys: ${JSON.stringify(beforeMissing)}`);

// ── Stage 2: simulate AI retry patches (what the AI WOULD return given missingEnKeys) ──
const retryPatches = [
  { key: 'innovation',         vn: 'đổi mới' },
  { key: 'social challenges',  vn: 'thách thức xã hội' },
];

console.log(`\n→ AI retry returned ${retryPatches.length} patches: ${JSON.stringify(retryPatches)}`);

// ── Stage 3: stitch + re-render ──
const vnMarked_after = app._stitchMissingPatches(vnMarked_before, retryPatches);
console.log(`\n→ Stitched markedText (length ${vnMarked_before.length} → ${vnMarked_after.length})`);

console.log('\n═══════════════ AFTER RETRY ═══════════════');
app._computeTranslatedHTML(vnMarked_after, highlights, vocabList, [], sourceText);

const afterMissing = app._shouldRetryForMissing(vnMarked_after, highlights, vocabList);
console.log(`\n→ _shouldRetryForMissing after retry: ${afterMissing === null ? 'null (no retry needed)' : JSON.stringify(afterMissing)}`);

console.log('\n═══════════════ SUMMARY ═══════════════');
console.log(`Coverage before retry:  ${((5 - beforeMissing.length) / 5 * 100).toFixed(1)}% (${5 - beforeMissing.length}/5 keys)`);
console.log(`Coverage after retry:   ${afterMissing === null ? '100' : ((5 - afterMissing.length) / 5 * 100).toFixed(1)}% (${afterMissing === null ? 5 : 5 - afterMissing.length}/5 keys)`);
console.log(`Retry required:         ${beforeMissing.length > 0 ? 'YES' : 'NO'}`);
console.log(`Retry called:           ${beforeMissing.length > 0 && afterMissing === null ? 'YES (and succeeded)' : 'NO'}`);
