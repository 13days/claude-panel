const test = require('node:test');
const assert = require('node:assert/strict');
const { createInputQueue } = require('../chat-session');

function harness() {
  const writes = [], turns = [], warnings = [];
  let idle = 0;
  const child = { stdin: { destroyed: false, writableEnded: false, write: data => writes.push(JSON.parse(data)) } };
  const queue = createInputQueue({ child, onTurn: id => turns.push(id), onIdle: () => idle++, onWarning: message => warnings.push(message) });
  return { queue, writes, turns, warnings, child, get idle() { return idle; } };
}
const message = text => ({ type: 'user', message: { role: 'user', content: text } });

test('continuous inputs queue without closing stdin or starting overlapping turns', async () => {
  const h = harness();
  h.queue.submit('first', message('first'));
  h.queue.submit('second', message('second'));
  h.queue.submit('third', message('third'));
  assert.deepEqual(h.turns, ['first']);
  assert.equal(h.queue.result(), 'first'); await Promise.resolve();
  assert.deepEqual(h.turns, ['first', 'second']);
  assert.equal(h.queue.result(), 'second'); await Promise.resolve();
  assert.deepEqual(h.turns, ['first', 'second', 'third']);
  h.queue.result(); await Promise.resolve();
  assert.equal(h.idle, 1);
  h.queue.submit('fourth', message('fourth'));
  assert.equal(h.queue.currentId, 'fourth');
  assert.equal(h.writes.length, 4);
});

test('steering sends a real interrupt and waits for the current result before continuing', async () => {
  const h = harness();
  h.queue.submit('first', message('first'));
  h.queue.submit('steer', message('new direction'), true);
  h.queue.submit('third', message('more context'), true);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].request.subtype, 'interrupt');
  assert.equal(h.queue.interrupted, true);
  assert.equal(h.queue.currentId, 'first');
  h.queue.result(); await Promise.resolve();
  assert.equal(h.queue.currentId, 'steer');
  assert.equal(h.writes[2].message.content, 'new direction');
  h.queue.result(); await Promise.resolve();
  assert.equal(h.queue.currentId, 'third');
});

test('duplicate submissions are idempotent; rejected interrupts remain queued; disconnect discards pending work', async () => {
  const h = harness();
  h.queue.submit('first', message('first'));
  h.queue.submit('first', message('first'));
  h.queue.submit('second', message('second'), true);
  const requestId = h.writes[1].request_id;
  h.queue.control({ type: 'control_response', response: { request_id: requestId, subtype: 'error' } });
  assert.equal(h.warnings.length, 1);
  assert.equal(h.queue.currentId, 'first');
  assert.equal(h.queue.interrupted, false, 'rejected interrupts must preserve the active reply and errors');
  h.queue.stop(); h.queue.result(); await Promise.resolve();
  assert.deepEqual(h.turns, ['first']);
  assert.throws(() => h.queue.submit('new', message('new')));
});

test('steering takes priority over queued tasks while preserving the order of steering messages', async () => {
  const h = harness();
  h.queue.submit('active', message('active'));
  h.queue.submit('queued', message('later'));
  h.queue.submit('steer-one', message('first correction'), true);
  h.queue.submit('steer-two', message('second correction'), true);
  h.queue.result(); await Promise.resolve();
  assert.equal(h.queue.currentId, 'steer-one');
  h.queue.result(); await Promise.resolve();
  assert.equal(h.queue.currentId, 'steer-two');
  h.queue.result(); await Promise.resolve();
  assert.equal(h.queue.currentId, 'queued');
});
