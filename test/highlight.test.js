/**
 * Standalone test runner for the bilingual highlight pipeline.
 *
 * Loads `js/app.js` in a sandboxed Node VM with stub `window`, `document`, `localStorage`,
 * invokes the API primitives directly, and asserts:
 *   - _parseAIMarkers        : returns the right {enKey, vnRaw, verified} for each [[H:...]]vn[[/H]]
 *   - _stitchMissingPatches  : inserts new markers without double-wrapping existing ones
 *   - _validateAndRepairMarkers : reports the right missing enKeys + coverage ratio
 *   - _computeTranslatedHTML : renders plain escaped paragraphs (NO <mark> elements)
 *
 * PER USER REQUEST (Aug 1 2026): the VN side no longer renders any highlights — it's just
 * clean translated text. So tests check the renderer output for absence of <mark>, not
 * presence. The pipeline primitives (parser, stitcher, validator) are still tested.
 *
 * Run:  node test/highlight.test.js
 * Exit: 0 on all pass, non-zero on any failure.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_PATH = path.resolve(__dirname, 'fixtures', 'highlight-cases.json');

/* ──────────────── Stub browser globals ──────────────── */

const stubElement = () => ({
  innerHTML: '', dataset: {}, textContent: '', style: {}, children: [],
  appendChild() {}, replaceChild() {}, querySelectorAll: () => [], querySelector: () => null,
  setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, addEventListener() {},
  contains: () => false, cloneNode: () => stubElement(),
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
});

const highlighterInstance = {
  _getTranslucentColor: (color) => `rgba(250, 204, 21, 0.62)`,
  onHighlightsChange: null,
  container: null,
  getAllHighlightedItems: () => [],
  assignOccurrenceIndices() {},
};

const translatorMock = {
  provider: 'gemini',
  geminiApiKey: '',
  openaiApiKey: '',
  openaiModel: '',
  geminiModel: '',
  autoScanEnabled: false,
  useSeparateScanApi: false,
  scanProvider: '',
  scanOpenaiApiKey: '',
  scanOpenaiModel: '',
  scanGeminiApiKey: '',
  scanGeminiModel: '',
};

const documentMock = {
  createElement: () => stubElement(),
  createTextNode: (t) => ({ textContent: String(t) }),
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
  addEventListener() {},
};

const localStorageMock = {
  _data: {},
  getItem(k) { return this._data[k] != null ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; },
};

const sandbox = {
  window: {
    TextHighlighter: function () { return highlighterInstance; },
    LinguaApp: undefined,
    __HIGHLIGHT_DEBUG__: true,
  },
  document: documentMock,
  localStorage: localStorageMock,
  navigator: { userAgent: 'node-test' },
  console: console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('fetch disabled in test')),
  TextHighlighter: function () { return highlighterInstance; },
};
vm.createContext(sandbox);

const appJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const highlighterJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'highlighter.js'), 'utf8');

const APP_TRAILER = `\n;window.LinguaApp = typeof LinguaApp !== 'undefined' ? LinguaApp : undefined;`;
const HIGH_TRAILER = `;window.TextHighlighter = typeof TextHighlighter !== 'undefined' ? TextHighlighter : undefined;`;

vm.runInContext(highlighterJsSrc + HIGH_TRAILER, sandbox, { filename: 'highlighter.js' });
vm.runInContext(appJsSrc + APP_TRAILER, sandbox, { filename: 'app.js' });

function findLinguaApp(sandbox) {
  if (typeof sandbox.LinguaApp === 'function') return sandbox.LinguaApp;
  if (typeof sandbox.window.LinguaApp === 'function') return sandbox.window.LinguaApp;
  for (const k of Object.keys(sandbox)) {
    if (k === 'window' || k === 'document') continue;
    try {
      const v = sandbox[k];
      if (typeof v === 'function' && v.name === 'LinguaApp') return v;
    } catch (e) {}
  }
  try {
    const desc = Object.getOwnPropertyDescriptor(sandbox, 'LinguaApp');
    if (desc && typeof desc.value === 'function') return desc.value;
  } catch (e) {}
  return null;
}
const LinguaApp = findLinguaApp(sandbox);
if (typeof LinguaApp !== 'function') {
  console.error('FAIL: LinguaApp class not loaded.');
  process.exit(1);
}

const app = Object.create(LinguaApp.prototype);
app.highlighter = highlighterInstance;
app.currentSourceText = '';
app.currentVocabData = [];
app.els = { translationCanvas: stubElement(), readingCanvas: stubElement() };
app.translator = translatorMock;

/* ──────────────── Test runner ──────────────── */

const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));

let pass = 0, fail = 0;
const failures = [];

for (const fx of fixtures) {
  const result = runFixture(app, fx);
  const ok = result.failures.length === 0;
  if (ok) {
    pass++;
    console.log(`  ✓ ${fx.id}  (${fx.name})`);
  } else {
    fail++;
    failures.push({ id: fx.id, name: fx.name, errors: result.failures, guards: fx.regressGuard });
    console.log(`  ✗ ${fx.id}  (${fx.name})`);
    result.failures.forEach(f => console.log(`      - ${f}`));
  }
}

console.log(`\n${pass} passed, ${fail} failed (${fixtures.length} total).`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) {
    console.log(`  ${f.id}  regressGuard: ${f.guards || '(none)'}`);
    f.errors.forEach(e => console.log(`    - ${e}`));
  }
  process.exit(1);
}
process.exit(0);

/* ──────────────── Per-fixture runner ──────────────── */

function runFixture(app, fx) {
  const failures = [];
  const exp = fx.expected || {};

  // ── Branch A: fixtures that test _parseAIMarkers directly (no full render) ──
  // These use markedText as input, no patchesToStitch needed.
  const wantsParse = typeof exp.parseMarkersLength === 'number'
                  || exp.firstParsedVnRaw
                  || Array.isArray(exp.parseMarkerEnKeys)
                  || Array.isArray(exp.parsedVnRaws);
  // ── Branch B: fixtures that test _stitchMissingPatches ──
  const wantsStitch = Array.isArray(fx.patchesToStitch)
                   && (exp.stitchContainsMarker
                       || typeof exp.stitchParseMarkersLength === 'number'
                       || exp.stitchDoesNotDoubleWrapWitness);
  // ── Branch C: fixtures that test _validateAndRepairMarkers ──
  const wantsValidate = Array.isArray(exp.validateReportsMissing)
                     || typeof exp.validateMissingCount === 'number'
                     || typeof exp.validateCoverageRatio === 'number';
  // ── Branch D: fixtures that test _computeTranslatedHTML (plain VN output) ──
  const wantsRender = typeof exp.markCountInHtml === 'number'
                   || exp.htmlContainsText
                   || exp.htmlContainsParagraphTag
                   || exp.htmlContainsTextNot;

  let markedText = fx.vnMarked;
  let html = '';
  let parsedMarkers = [];
  let stitchedText = '';
  let validate = null;

  // If we need to stitch, do it first.
  if (Array.isArray(fx.patchesToStitch) && fx.patchesToStitch.length > 0) {
    try {
      markedText = app._stitchMissingPatches(fx.vnMarked, fx.patchesToStitch);
      stitchedText = markedText;
    } catch (err) {
      failures.push(`_stitchMissingPatches threw: ${err.message}`);
      return { failures };
    }
  }

  if (wantsParse || wantsValidate) {
    try {
      parsedMarkers = app._parseAIMarkers(markedText, fx.highlights || [], fx.vocabList || []);
    } catch (err) {
      failures.push(`_parseAIMarkers threw: ${err.message}`);
      return { failures };
    }
  }

  if (wantsValidate && parsedMarkers) {
    validate = app._validateAndRepairMarkers(parsedMarkers, fx.highlights || [], fx.vocabList || []);
  }

  if (wantsRender) {
    try {
      html = app._computeTranslatedHTML(
        markedText, fx.highlights || [], fx.vocabList || [], fx.alignments || [], fx.sourceText || ''
      );
    } catch (err) {
      failures.push(`_computeTranslatedHTML threw: ${err.message}`);
      return { failures };
    }
  }

  // ── Assertions ──

  if (typeof exp.parseMarkersLength === 'number' && parsedMarkers.length !== exp.parseMarkersLength) {
    failures.push(`parseMarkersLength expected ${exp.parseMarkersLength}, got ${parsedMarkers.length}`);
  }
  if (Array.isArray(exp.parseMarkerEnKeys)) {
    const got = parsedMarkers.map(p => p.enKey);
    for (let i = 0; i < exp.parseMarkerEnKeys.length; i++) {
      if (got[i] !== exp.parseMarkerEnKeys[i]) {
        failures.push(`parseMarkerEnKeys[${i}] expected "${exp.parseMarkerEnKeys[i]}", got "${got[i]}"`);
      }
    }
  }
  if (exp.firstParsedVnRaw && (!parsedMarkers[0] || parsedMarkers[0].vnRaw !== exp.firstParsedVnRaw)) {
    failures.push(`firstParsedVnRaw expected "${exp.firstParsedVnRaw}", got "${parsedMarkers[0] && parsedMarkers[0].vnRaw}"`);
  }
  if (Array.isArray(exp.parsedVnRaws)) {
    const got = parsedMarkers.map(p => p.vnRaw);
    for (let i = 0; i < exp.parsedVnRaws.length; i++) {
      if (got[i] !== exp.parsedVnRaws[i]) {
        failures.push(`parsedVnRaws[${i}] expected "${exp.parsedVnRaws[i]}", got "${got[i]}"`);
      }
    }
  }

  // Stitch assertions
  if (exp.stitchContainsMarker && !stitchedText.includes(exp.stitchContainsMarker)) {
    failures.push(`stitched text should contain "${exp.stitchContainsMarker}"; full: ${stitchedText}`);
  }
  if (typeof exp.stitchParseMarkersLength === 'number') {
    const reStitched = app._parseAIMarkers(stitchedText, fx.highlights || [], fx.vocabList || []);
    if (reStitched.length !== exp.stitchParseMarkersLength) {
      failures.push(`stitchParseMarkersLength expected ${exp.stitchParseMarkersLength}, got ${reStitched.length}`);
    }
  }
  if (exp.stitchDoesNotDoubleWrapWitness) {
    // Re-parse and count witness occurrences — must be exactly 1 even though both
    // original + patch tried to add it.
    const reStitched = app._parseAIMarkers(stitchedText, fx.highlights || [], fx.vocabList || []);
    const witnessCount = reStitched.filter(p => (p.enKey || '').toLowerCase() === 'witness').length;
    if (witnessCount > 1) {
      failures.push(`stitchDoesNotDoubleWrapWitness: found ${witnessCount} witness markers after stitch, should be ≤ 1`);
    }
  }

  // Validate assertions
  if (validate) {
    if (Array.isArray(exp.validateReportsMissing)) {
      for (const want of exp.validateReportsMissing) {
        if (!validate.missingEnKeys.includes(want)) {
          failures.push(`validate.missingEnKeys should include "${want}", got [${validate.missingEnKeys.join(',')}]`);
        }
      }
    }
    if (typeof exp.validateMissingCount === 'number' && validate.missingEnKeys.length !== exp.validateMissingCount) {
      failures.push(`validate.missingEnKeys.length expected ${exp.validateMissingCount}, got ${validate.missingEnKeys.length}`);
    }
    if (typeof exp.validateCoverageRatio === 'number') {
      if (Math.abs(validate.coverageRatio - exp.validateCoverageRatio) > 0.005) {
        failures.push(`validate.coverageRatio expected ~${exp.validateCoverageRatio}, got ${validate.coverageRatio}`);
      }
    }
    if (validate.coverageRatio < 0 || validate.coverageRatio > 1) {
      failures.push(`validate.coverageRatio out of [0,1]: got ${validate.coverageRatio}`);
    }
  }

  // Render assertions
  if (typeof exp.markCountInHtml === 'number') {
    const cnt = (html.match(/<mark\b/g) || []).length;
    if (cnt !== exp.markCountInHtml) {
      failures.push(`markCountInHtml expected ${exp.markCountInHtml}, got ${cnt}`);
    }
  }
  if (exp.htmlContainsText && !html.includes(exp.htmlContainsText)) {
    failures.push(`html should contain "${exp.htmlContainsText}"; got: ${html.slice(0, 300)}`);
  }
  if (exp.htmlContainsTextNot && html.includes(exp.htmlContainsTextNot)) {
    failures.push(`html should NOT contain "${exp.htmlContainsTextNot}" (must be HTML-escaped); got: ${html.slice(0, 300)}`);
  }
  if (exp.htmlContainsParagraphTag && !html.includes(exp.htmlContainsParagraphTag)) {
    failures.push(`html should contain paragraph tag "${exp.htmlContainsParagraphTag}"; got: ${html.slice(0, 300)}`);
  }

  return { failures };
}

/* ──────────────── Helpers ──────────────── */

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
