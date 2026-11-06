const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const context = vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function formatCapturePayload('), html.indexOf('// 共享：把一条抓包记录的完整详情')), context);
const format = context.formatCapturePayload;

test('reading view preserves structure and decodes prompt paragraphs without changing literal escapes', () => {
  const data = { model: 'test', messages: [{ role: 'user', content: [{ type: 'text', text: '# 标题\n\n第一段\n第二段 literal \\n <script>' }] }], stream: true, empty: null };
  const raw = JSON.stringify(data);
  const reading = format(raw);
  assert.ok(reading.includes('messages [1]:\n  [0]:\n    role: user'));
  assert.ok(reading.includes('# 标题\n          \n          第一段\n          第二段 literal \\n <script>'));
  assert.ok(reading.includes('stream: true'));
  assert.ok(reading.includes('empty: null'));
  assert.equal(format(raw, 'raw'), raw);
  assert.deepEqual(JSON.parse(format(raw, 'json')), data);
});

test('SSE response events have readable text while raw and non-JSON data remain exact', () => {
  const raw = 'event: content_block_delta\ndata: {"delta":{"text":"你好\\n世界"}}\n\ndata: [DONE]\n\n';
  assert.ok(format(raw).includes('text:\n      你好\n      世界'));
  assert.equal(format(raw, 'raw'), raw);
  for (const value of ['', '{invalid JSON', '<html>error</html>', 'plain text\nwith newline']) assert.equal(format(value), value);
  assert.equal(format('{}'), '{}');
  assert.equal(format('[]'), '[]');
});
