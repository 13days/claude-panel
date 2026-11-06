const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');

// Exercise the actual CLI stdout handler without starting the panel or a paid request.
function streamHarness(history = null) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf("      let stdout = '', stderr = '', sentText");
  const end = source.indexOf("      child.stderr.on('data'", start);
  assert.ok(start >= 0 && end > start);
  const frames = [];
  const child = { stdout: new PassThrough() };
  child.stdout.setEncoding('utf8');
  vm.runInNewContext(source.slice(start, end), {
    child, clientEnv: {}, cwd: '/tmp', sessionId: 'test-session', sessionMessages: () => history,
    createInputQueue: () => ({ currentId: '', result() {}, control() {} }), activeChats: new Map(),
    cliResultError: require('../cli-result').cliResultError,
    createPermissionBridge: require('../chat-permissions').createPermissionBridge,
    baseHistory: null, baseMessages: [], job: { publish: (event, data) => frames.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) },
    res: { destroyed: false, write: frame => frames.push(frame) },
  });
  const events = () => frames.map(frame => ({
    type: frame.match(/^event: (.*)/)[1],
    data: JSON.parse(frame.match(/\ndata: (.*)/)[1]),
  }));
  const send = msg => child.stdout.write(JSON.stringify(msg) + '\n');
  const partial = event => send({ type: 'stream_event', event });
  return { child, events, send, partial };
}

test('first text delta is emitted before the assistant message or result exists', () => {
  const h = streamHarness();
  h.partial({ type: 'message_start' });
  h.partial({ type: 'content_block_delta', delta: { type: 'text_delta', text: '你' } });
  assert.deepEqual(h.events().filter(e => e.type === 'text').map(e => e.data.text), ['你']);
  assert.equal(h.events().some(e => e.type === 'done'), false);
  h.partial({ type: 'content_block_delta', delta: { type: 'text_delta', text: '好' } });
  h.send({ type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } });
  assert.deepEqual(h.events().filter(e => e.type === 'text').map(e => e.data.text), ['你', '好']);
});

test('raw streaming IDs and final CLI IDs reconcile into one tool call', () => {
  const h = streamHarness();
  h.partial({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'raw-1', name: 'Bash', input: {} } });
  h.send({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'final-1', name: 'Bash', input: { command: 'ls' } }] } });
  h.send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'final-1', content: 'file.txt' }] } });
  assert.deepEqual(h.events().filter(e => e.type === 'tool').map(e => e.data.id), ['raw-1', 'raw-1']);
  assert.deepEqual(h.events().find(e => e.type === 'tool_result').data, { id: 'raw-1', output: 'file.txt', isError: false });
});

test('tool results are recovered from the transcript when the CLI omits them', () => {
  const h = streamHarness({ messages: [{ tools: [{ id: 'final-2', output: 'Recovered output', state: 'done' }] }] });
  h.partial({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'raw-2', name: 'Read', input: {} } });
  h.send({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'final-2', name: 'Read', input: { file_path: 'a' } }] } });
  h.send({ type: 'result', result: 'Done' });
  assert.equal(h.events().find(e => e.type === 'tool_result').data.output, 'Recovered output');
  assert.equal(h.events().find(e => e.type === 'tool_result').data.id, 'raw-2');
});

test('tool input deltas and results retain their call IDs including failures', () => {
  const h = streamHarness();
  h.partial({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-1', name: 'Read', input: {} } });
  h.partial({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"a.txt"}' } });
  h.send({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: 'a.txt' } }] } });
  h.send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'File missing', is_error: true }] } });
  const events = h.events();
  assert.equal(events.find(e => e.type === 'tool_input').data.id, 'call-1');
  assert.deepEqual(events.filter(e => e.type === 'tool').at(-1).data.input, { file_path: 'a.txt' });
  assert.deepEqual(events.find(e => e.type === 'tool_result').data, { id: 'call-1', output: 'File missing', isError: true });
});

test('split UTF-8 chunks preserve the first token and incomplete JSON is held', () => {
  const h = streamHarness();
  const bytes = Buffer.from(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } } }) + '\n');
  const split = bytes.indexOf(Buffer.from('你')) + 1;
  h.child.stdout.write(bytes.subarray(0, split));
  assert.equal(h.events().some(e => e.type === 'text'), false);
  h.child.stdout.write(bytes.subarray(split));
  assert.equal(h.events().find(e => e.type === 'text').data.text, '你好');
});

test('CLI errors[] are surfaced as failures even when result text is empty', () => {
  const h = streamHarness();
  h.send({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Tool execution failed'], result: '' });
  assert.equal(h.events().find(event => event.type === 'error').data.error, 'Tool execution failed');
  assert.equal(h.events().find(event => event.type === 'done').data.isError, true);
  assert.equal(h.events().some(event => event.type === 'text'), false);
});

test('internal interrupt notices do not appear as user prompts in saved sessions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('function transcriptUserText(');
  const end = source.indexOf('function sessionMessages(', start);
  const context = vm.createContext({}); vm.runInContext(source.slice(start, end), context);
  assert.equal(vm.runInContext('transcriptUserText("[Request interrupted by user]")', context), '');
  assert.equal(vm.runInContext('transcriptUserText([{type:"text",text:"[Request interrupted by user for tool use]"}])', context), '');
  assert.equal(vm.runInContext('transcriptUserText("这个目录下有什么")', context), '这个目录下有什么');
});
