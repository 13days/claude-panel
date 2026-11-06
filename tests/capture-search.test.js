const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function findCaptureMatches('), html.indexOf('function clearCaptureSearch(')), context);

test('search includes lazy blocks without opening them, ignores case, and keeps all matches', () => {
  const blocks = ['Skill Skill', 'system SKILL', '原始请求 skill'].map(text => ({ text: () => text, reveal: () => { throw new Error('must remain lazy'); } }));
  const groups = context.findCaptureMatches(blocks, 'skill');
  assert.deepEqual(Array.from(groups, g => [g.start, Array.from(g.offsets)]), [[0, [0, 6]], [2, [7]], [3, [5]]]);
  assert.equal(context.findCaptureMatches(blocks, '').length, 0);
  assert.equal(context.findCaptureMatches(blocks, 'missing').length, 0);
});

test('regex metacharacters and markup are literal search text with correct original offsets', () => {
  for (const query of ['[a].*', '\\path', '<script>', '中文', '🧰']) {
    const groups = context.findCaptureMatches([{ text: () => 'before ' + query + ' after ' + query }], query);
    assert.equal(groups.length, 1);
    assert.deepEqual(Array.from(groups[0].offsets), [7, 14 + query.length]);
  }
});
