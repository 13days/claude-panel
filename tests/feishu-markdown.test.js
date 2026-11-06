const test = require('node:test');
const assert = require('node:assert/strict');
const { markdownChunks, sendMarkdown } = require('../feishu-markdown');

test('Markdown sends native post/md content and every long chunk retains its topic reply target', async () => {
  const sent = [], channel = { send: async (...args) => { sent.push(args); return { messageId: 'out' }; } };
  const body = '**Claude**\n- **能力**：[链接](https://example.com)\n`**字面标记**`\n\n```js\n' + 'console.log("**保留**");\n'.repeat(500) + '```\n最终回复';
  await sendMarkdown(channel, { chatId: 'oc_group', messageId: 'om_origin', threadId: 'omt_topic' }, body);
  assert.ok(sent.length > 1);
  assert.match(sent[0][1].post.zh_cn.content[0][0].text, /\*\*Claude\*\*/);
  assert.match(sent[0][1].post.zh_cn.content[0][0].text, /`\*\*字面标记\*\*`/);
  for (const [chat, input, options] of sent) {
    assert.equal(chat, 'oc_group');
    assert.equal(input.text, undefined);
    const md = input.post.zh_cn.content[0][0];
    assert.equal(md.tag, 'md'); assert.ok(md.text.length <= 6000);
    assert.equal((md.text.match(/^```/gm) || []).length % 2, 0, 'each chunk closes and reopens its fenced code');
    assert.deepEqual(options, { replyTo: 'om_origin', replyInThread: true });
  }
  const long = '🙂**原文**'.repeat(3000);
  assert.equal(markdownChunks(long).join(''), long, 'long Unicode content is complete');
});

let sdk; try { sdk = require('@larksuiteoapi/node-sdk'); } catch {}
test('the installed SDK encodes gateway replies as msg_type post rather than text', { skip: !sdk }, async () => {
  const channel = sdk.createLarkChannel({ appId: 'cli_test', appSecret: 'test-secret', logger: { error() {}, warn() {}, info() {}, debug() {}, trace() {} } });
  const requests = [];
  channel.rawClient.im.v1.message.reply = async args => { requests.push(args); return { code: 0, data: { message_id: 'out' } }; };
  channel.rawClient.im.v1.message.create = async () => { throw new Error('must reply in the original topic'); };
  await sendMarkdown(channel, { chatId: 'oc_group', messageId: 'om_origin', threadId: 'omt_topic' }, '**Claude** 和 `代码`');
  assert.equal(requests[0].data.msg_type, 'post');
  assert.equal(requests[0].data.reply_in_thread, true);
  assert.equal(JSON.parse(requests[0].data.content).zh_cn.content[0][0].text, '**Claude** 和 `代码`');
});
