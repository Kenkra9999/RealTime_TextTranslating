/**
 * Standalone test runner for the bilingual highlight pipeline.
 *
 * Loads `js/app.js` in a sandboxed Node VM with stub `window`, `document`, `localStorage`,
 * invokes the (post-refactor) `_computeTranslatedHTML` on each fixture, and asserts:
 *   - minMarkCount    : at least N <mark> elements produced
 *   - trustedMarkCount: matches the AI's inline marker count
 *   - fallbackMarkCount: matches expected fallback (PASS 2) count
 *   - distinctOccIndices: every data-occ is unique per enKey
 *   - exactMarkContent / mergedMarkContentContains: covers the regress guards
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

const stubElement = () => {
  const el = {
    innerHTML: '',
    dataset: {},
    textContent: '',
    style: {},
    children: [],
    appendChild() {},
    replaceChild() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener() {},
    contains: () => false,
    cloneNode: () => stubElement(),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
  return el;
};

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

/* ──────────────── Load app.js into the sandbox ──────────────── */

const appJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const highlighterJsSrc = fs.readFileSync(path.join(ROOT, 'js', 'highlighter.js'), 'utf8');

// Append a self-exposing trailer so the test harness can reach the LinguaApp class.
// In a real browser, `window.app = new LinguaApp()` is set by DOMContentLoaded; for the test
// we just need the class reference.
const APP_TRAILER = `\n;window.LinguaApp = typeof LinguaApp !== 'undefined' ? LinguaApp : undefined;`;
const HIGH_TRAILER = `;window.TextHighlighter = typeof TextHighlighter !== 'undefined' ? TextHighlighter : undefined;`;

vm.runInContext(highlighterJsSrc + HIGH_TRAILER, sandbox, { filename: 'highlighter.js' });
vm.runInContext(appJsSrc + APP_TRAILER, sandbox, { filename: 'app.js' });

// The app.js source is wrapped in either a top-level class declaration or an IIFE. Inspect
// the runInContext result to find LinguaApp.
function findLinguaApp(sandbox) {
  // 1) direct on global
  if (typeof sandbox.LinguaApp === 'function') return sandbox.LinguaApp;
  if (typeof sandbox.window.LinguaApp === 'function') return sandbox.window.LinguaApp;
  // 2) dump sandbox to look for it
  for (const k of Object.keys(sandbox)) {
    if (k === 'window' || k === 'document') continue;
    try {
      const v = sandbox[k];
      if (typeof v === 'function' && v.name === 'LinguaApp') return v;
    } catch (e) {}
  }
  // 3) hidden behind getOwnPropertyDescriptor / non-enumerable
  try {
    const desc = Object.getOwnPropertyDescriptor(sandbox, 'LinguaApp');
    if (desc && typeof desc.value === 'function') return desc.value;
  } catch (e) {}
  return null;
}
const LinguaApp = findLinguaApp(sandbox);
if (typeof LinguaApp !== 'function') {
  console.error('FAIL: LinguaApp class not loaded.');
  console.error('sandbox keys:', Object.keys(sandbox));
  console.error('sandbox.window keys:', Object.keys(sandbox.window));
  console.error('LinguaApp in sandbox:', typeof sandbox.LinguaApp);
  console.error('window.LinguaApp in sandbox:', typeof sandbox.window.LinguaApp);
  process.exit(1);
}

/* ──────────────── Build a minimal app instance ──────────────── */

const app = Object.create(LinguaApp.prototype);
app.highlighter = highlighterInstance;
app.currentSourceText = '';
app.currentVocabData = [];
app.els = {
  translationCanvas: stubElement(),
  readingCanvas: stubElement(),
  fontFamilySelect: null,
};
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
  // If the fixture specifies a list of patches to stitch into the marked text BEFORE rendering,
  // do that now. This mimics what handleTranslate() does between the first render and the retry
  // call: the renderer sees the freshly-stitched markedText and downstream pass counts reflect it.
  let markedText = fx.vnMarked;
  if (Array.isArray(fx.patchesToStitch) && fx.patchesToStitch.length > 0) {
    try {
      markedText = app._stitchMissingPatches(fx.vnMarked, fx.patchesToStitch);
    } catch (err) {
      failures.push(`_stitchMissingPatches threw: ${err.message}`);
      return { failures };
    }
  }

  let html;
  try {
    html = app._computeTranslatedHTML(
      markedText,
      fx.highlights || [],
      fx.vocabList || [],
      fx.alignments || [],
      fx.sourceText || ''
    );
  } catch (err) {
    failures.push(`Threw: ${err.message}`);
    return { failures };
  }

  // Parse the HTML output for <mark> elements
  const marks = extractMarks(html);

  const exp = fx.expected || {};
  if (typeof exp.minMarkCount === 'number' && marks.length < exp.minMarkCount) {
    failures.push(`expected at least ${exp.minMarkCount} <mark>, got ${marks.length}`);
  }

  // Count trusted vs fallback. Trusted count comes from the AI's emitted markers (parsed
  // before the renderer runs) — this is the canonical "what the AI actually marked" count.
  // The renderer adds fallback marks for any extra occurrences it found via string matching,
  // so total = trusted + fallback. We can't reliably count fallback by text-content alone
  // because the fallback may reproduce the same text the AI used (e.g. "nhân chứng" both
  // trusted and fallback).
  //
  // IMPORTANT: when patchesToStitch was applied, the stitched markers are part of the AI
  // markers too (the AI returned the vn spans verbatim). We parse the STITCHED markedText so
  // the trustedCount reflects the post-retry state, not the pre-retry state.
  const parsedMarkers = app._parseAIMarkers(markedText, fx.highlights || [], fx.vocabList || []);
  const trustedCount = parsedMarkers.length;
  const fallbackCount = Math.max(0, marks.length - trustedCount);

  if (typeof exp.trustedMarkCount === 'number' && trustedCount !== exp.trustedMarkCount) {
    failures.push(`expected ${exp.trustedMarkCount} trusted marks, got ${trustedCount}`);
  }
  if (typeof exp.fallbackMarkCount === 'number' && fallbackCount !== exp.fallbackMarkCount) {
    failures.push(`expected ${exp.fallbackMarkCount} fallback marks, got ${fallbackCount}`);
  }

  // Distinct occ indices per enKey
  if (Array.isArray(exp.distinctOccIndices)) {
    const occs = new Set(marks.map(m => `${m.dataEn}::${m.dataOcc}`));
    if (occs.size !== marks.length) {
      failures.push(`data-occ not unique per enKey: ${marks.length} marks, ${occs.size} unique (en,occ) pairs`);
    }
    const allOccs = marks.map(m => parseInt(m.dataOcc, 10)).sort((a,b) => a-b);
    for (const want of exp.distinctOccIndices) {
      if (!allOccs.includes(want)) {
        failures.push(`expected data-occ ${want} to appear; got [${allOccs.join(',')}]`);
      }
    }
  }

  // exactMarkContent
  if (exp.exactMarkContent) {
    const found = marks.some(m => stripWhitespace(m.textContent) === stripWhitespace(exp.exactMarkContent));
    if (!found) {
      failures.push(`expected a mark with text "${exp.exactMarkContent}", got: ${marks.map(m => m.textContent).join(' | ')}`);
    }
  }

  // mergedMarkContentContains
  if (exp.mergedMarkContentContains) {
    const found = marks.some(m => m.textContent.includes(exp.mergedMarkContentContains));
    if (!found) {
      failures.push(`expected a mark containing "${exp.mergedMarkContentContains}", got: ${marks.map(m => m.textContent).join(' | ')}`);
    }
  }

  // firstMarkColor
  if (exp.firstMarkColor && marks[0] && marks[0].dataColor !== exp.firstMarkColor) {
    failures.push(`expected first mark color ${exp.firstMarkColor}, got ${marks[0].dataColor}`);
  }

  // Validate report: missingEnKeys / missingCount / coverageRatio
  const validate = app._validateAndRepairMarkers(
    parsedMarkers,
    fx.highlights || [],
    fx.vocabList || []
  );
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
    const got = validate.coverageRatio;
    const want = exp.validateCoverageRatio;
    if (Math.abs(got - want) > 0.005) {
      failures.push(`validate.coverageRatio expected ~${want}, got ${got}`);
    }
  }
  // Universal invariant: coverageRatio from STAGE 1 must always be in [0, 1].
  // (It can never go above 1 by construction now — covered/required.)
  if (validate.coverageRatio < 0 || validate.coverageRatio > 1) {
    failures.push(`validate.coverageRatio out of [0,1]: got ${validate.coverageRatio}`);
  }

  // No-double-wrap guard: if the fixture stitched patches, count distinct enKeys rendered
  // for each `key` — must be ≤ 1 (we never duplicate an existing marker via a patch that
  // claims a span inside it). The "witness" patch in the stitch-missing-patch fixture is
  // exactly this regression.
  if (Array.isArray(fx.patchesToStitch) && marks.length > 0) {
    const enCounts = new Map();
    for (const m of marks) {
      if (!m.dataEn) continue;
      enCounts.set(m.dataEn, (enCounts.get(m.dataEn) || 0) + 1);
    }
    for (const p of fx.patchesToStitch) {
      const key = (p.key || '').toLowerCase();
      const count = enCounts.get(key) || 0;
      if (count > 1) {
        failures.push(`no-double-wrap: rendered ${count} marks for "${p.key}" after stitch — should be ≤ 1`);
      }
    }
  }

  // LỚP 1.3 — data-source tagging contract: every mark must carry a known data-source.
  const KNOWN_SOURCES = new Set(['ai-verified', 'ai-retried', 'fallback', 'user-verified']);
  if (exp.allMarksHaveDataSource && marks.length > 0) {
    const missing = marks.filter(m => !m.dataSource || !KNOWN_SOURCES.has(m.dataSource));
    if (missing.length) {
      failures.push(`allMarksHaveDataSource: ${missing.length}/${marks.length} marks have unknown/empty data-source`);
    }
  }
  // LỚP 1.3 — histogram of data-source values must match expected.
  if (exp.dataSourceHistogram && typeof exp.dataSourceHistogram === 'object') {
    const hist = {};
    for (const m of marks) {
      const s = m.dataSource || 'unknown';
      hist[s] = (hist[s] || 0) + 1;
    }
    for (const want of Object.keys(exp.dataSourceHistogram)) {
      const got = hist[want] || 0;
      const expCount = exp.dataSourceHistogram[want];
      if (got !== expCount) {
        failures.push(`dataSourceHistogram["${want}"] expected ${expCount}, got ${got} (full: ${JSON.stringify(hist)})`);
      }
    }
    // Also assert NO unexpected sources appear.
    for (const got of Object.keys(hist)) {
      if (!(got in exp.dataSourceHistogram)) {
        failures.push(`dataSourceHistogram: unexpected source "${got}" appeared (${hist[got]}×) — expected only ${JSON.stringify(Object.keys(exp.dataSourceHistogram))}`);
      }
    }
  }
  // LỚP 2.1 — banner state (verified / needsCheck) derived from data-source.
  if (exp.bannerState && typeof exp.bannerState === 'object') {
    let verified = 0, needsCheck = 0;
    for (const m of marks) {
      if (m.dataSource === 'ai-verified' || m.dataSource === 'user-verified') verified++;
      else needsCheck++;
    }
    if (exp.bannerState.verified !== undefined && verified !== exp.bannerState.verified) {
      failures.push(`bannerState.verified expected ${exp.bannerState.verified}, got ${verified}`);
    }
    if (exp.bannerState.needsCheck !== undefined && needsCheck !== exp.bannerState.needsCheck) {
      failures.push(`bannerState.needsCheck expected ${exp.bannerState.needsCheck}, got ${needsCheck}`);
    }
  }

  return { failures };
}

/* ──────────────── Helpers ──────────────── */

function extractMarks(html) {
  const out = [];
  const re = /<mark[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const end = html.indexOf('</mark>', m.index);
    if (end < 0) continue;
    const inner = html.slice(m.index + tag.length, end);
    out.push({
      dataColor: extractAttr(tag, 'data-color') || '',
      dataEn: extractAttr(tag, 'data-en') || '',
      dataOcc: extractAttr(tag, 'data-occ') || '0',
      dataSource: extractAttr(tag, 'data-source') || 'fallback',
      textContent: decodeEntities(inner),
    });
  }
  return out;
}

function extractAttr(tag, name) {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(tag);
  return m ? m[1] : null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripWhitespace(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

function extractAIMarkerTexts(rawText) {
  const out = new Set();
  const re = /\[\[H:[^\]]*?\]\]([\s\S]*?)\[\[\/H\]\]/g;
  let m;
  while ((m = re.exec(rawText)) !== null) {
    out.add(stripWhitespace(m[1]).toLowerCase());
  }
  return out;
}
