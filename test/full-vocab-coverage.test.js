const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const sandbox = {
  window: {},
  document: { addEventListener() {}, createElement() { return {}; }, getElementById() { return null; } },
  localStorage: { getItem() { return null; }, setItem() {} },
  console,
  setTimeout,
  clearTimeout,
  fetch: () => Promise.reject(new Error('network disabled in unit test')),
};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8') + '\n;window.LinguaApp = LinguaApp;',
  sandbox,
  { filename: 'app.js' }
);

const LinguaApp = sandbox.window.LinguaApp;
const app = Object.create(LinguaApp.prototype);
app.completeVocabularyEnabled = true;
app._ipaOverrides = new Map();
app._maybeFetchIpaForWord = () => {};
sandbox.window.dictionaryDB = {
  hasRealEntry: (word) => word.toLowerCase() === 'the',
  getIPA: () => '/ðə/',
  getPOS: (word) => word.toLowerCase() === 'system' ? 'n.' : '',
  getMeaning: (word) => word.toLowerCase() === 'the' ? 'mạo từ xác định' : ''
};
app.translator = {
  enrichVocabularyTerms: async (terms) => terms.map(({ original }) => ({
    original,
    ipa: original.toLowerCase() === 'the' ? '/ðə/' : '/tɛst/',
    ipaSource: original.toLowerCase() === 'the' ? 'curated' : 'ai',
    pos: 'n.',
    contextMeaning: `nghĩa của ${original}`
  }))
};

(async () => {
  const source = "The state-of-the-art system can't re-read this.";
  const words = app._extractAllVocabularyTerms(source).map(item => item.original);
  const expectedWords = ['The', 'state-of-the-art', 'system', "can't", 're-read', 'this'];
  if (JSON.stringify(words) !== JSON.stringify(expectedWords)) {
    throw new Error(`Expected all lexical forms ${expectedWords.join(', ')}, got ${words.join(', ')}`);
  }

  const glossary = await app._buildCompleteVocabulary(source, [{
    original: 'state-of-the-art',
    ipa: '/ˌsteɪt əv ði ˈɑːt/',
    contextMeaning: 'tối tân',
    example: 'It uses state-of-the-art equipment.'
  }]);
  const keys = glossary.map(item => item.original.toLowerCase());
  for (const word of expectedWords.map(word => word.toLowerCase())) {
    if (!keys.includes(word)) throw new Error(`Glossary omitted "${word}"`);
  }
  const phrase = glossary.find(item => item.original.toLowerCase() === 'state-of-the-art');
  if (!phrase || phrase.example !== 'It uses state-of-the-art equipment.') {
    throw new Error('Complete glossary discarded the detailed AI entry for a phrase.');
  }
  if (app._accurateIPA('unverified') !== '') {
    throw new Error('Unverified words must not display a fabricated IPA estimate.');
  }
  console.log('full-vocab-coverage: passed');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
