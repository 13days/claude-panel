const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSimpleReply } = require('../feishu-simple-reply');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function fixture() {
  const events = [], errors = []; let listener;
  const channel = {
    addReaction: async (id, emoji) => { events.push(['add', id, emoji]); return 'reaction_own'; },
    removeReaction: async (id, reaction) => { events.push(['remove', id, reaction]); },
    send: async (id, content, options) => { events.push(['send', id, content, options]); },
  };
  const reply = createSimpleReply({ channel, msg: { messageId: 'incoming', chatId: 'group', threadId: 'topic' }, messageId: 'task', onError: e => errors.push(e) });
  return { reply, channel, events, errors, attach: () => reply.attach(fn => { listener = fn; return () => {}; }), emit: (event, data = {}) => listener(event, { messageId: 'task', ...data }) };
}
test('simple mode reacts immediately, hides progress/tools and sends exactly one plain reply before removing its own reaction', async () => {
  const f = fixture(); await f.reply.start(); f.attach();
  assert.deepEqual(f.events, [['add', 'incoming', 'Typing']]);
  f.emit('text', { text: '你好' }); f.emit('tool', { name: 'Bash', input: { command: 'secret' } });
  assert.equal(f.events.length, 1);
  f.emit('text', { text: '，完成了' }); f.emit('done'); f.emit('end'); await tick();
  assert.equal(f.events.filter(x => x[0] === 'send').length, 1);
  assert.deepEqual(f.events[1], ['send', 'group', { post: { zh_cn: { title: '', content: [[{ tag: 'md', text: '你好，完成了' }]] } } }, { replyTo: 'incoming', replyInThread: true }]);
  assert.deepEqual(f.events[2], ['remove', 'incoming', 'reaction_own']);
});
test('failure, stop, disconnect, interrupted steer and gateway shutdown all remove the thinking reaction', async () => {
  for (const event of ['error', 'stopped', 'end', 'interrupted', 'shutdown']) {
    const f = fixture(); await f.reply.start(); f.attach();
    if (event === 'shutdown') await f.reply.close();
    else { f.emit(event === 'interrupted' ? 'done' : event, { error: 'failed', interrupted: event === 'interrupted' }); await tick(); }
    assert.equal(f.events.at(-1)[0], 'remove', event);
    assert.equal(f.events.filter(x => x[0] === 'remove').length, 1, event);
    await f.reply.close(); assert.equal(f.events.filter(x => x[0] === 'remove').length, 1);
  }
});
test('reaction permission errors do not block replies and failed sends still remove the reaction', async () => {
  let f = fixture(); f.channel.addReaction = async () => { throw new Error('no reaction permission'); };
  await f.reply.start(); f.attach(); f.emit('text', { text: 'still answered' }); f.emit('done'); await tick();
  assert.equal(f.events[0][2].post.zh_cn.content[0][0].text, 'still answered'); assert.equal(f.errors.length, 1);
  f = fixture(); f.channel.send = async () => { throw new Error('send failed'); };
  await f.reply.start(); f.attach(); f.emit('done'); await tick(); assert.equal(f.events.at(-1)[0], 'remove'); assert.equal(f.errors.length, 1);
});
test('other turns do not finish this message, and long plain replies keep their original thread', async () => {
  const f = fixture(); await f.reply.start(); f.attach(); f.emit('done', { messageId: 'another_turn' }); await tick(); assert.equal(f.events.length, 1);
  f.emit('text', { text: '字'.repeat(7001) }); f.emit('done'); await tick();
  const sent = f.events.filter(x => x[0] === 'send'); assert.deepEqual(sent.map(x => x[2].post.zh_cn.content[0][0].text).join(''), '字'.repeat(7001));
  assert(sent.every(x => x[3].replyTo === 'incoming' && x[3].replyInThread));
});
test('shutdown racing with reaction creation removes the late reaction too', async () => {
  const f = fixture(); let resolve;
  f.channel.addReaction = () => new Promise(done => { resolve = done; });
  const start = f.reply.start(); await f.reply.close(); resolve('late_reaction'); await start;
  assert.deepEqual(f.events, [['remove', 'incoming', 'late_reaction']]);
});
