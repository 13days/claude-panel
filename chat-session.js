const crypto = require('crypto');

// Keep stdin open and deliver one user turn at a time. Steering interrupts the
// active turn through the CLI control protocol, then drains accepted inputs.
function createInputQueue({ child, onTurn, onIdle, onWarning }) {
  const pending = [], seen = new Set();
  let current = null, interruptId = '', stopped = false;
  const pump = () => {
    if (stopped || current || !pending.length) return;
    current = pending.shift(); interruptId = '';
    onTurn(current.id);
    child.stdin.write(JSON.stringify({ ...current.message, uuid: current.id, parent_tool_use_id: null }) + '\n');
  };
  return {
    submit(id, message, steer = false, onAccept) {
      if (stopped || child.stdin.destroyed || child.stdin.writableEnded) throw new Error('会话连接已结束，请重新发送');
      if (seen.has(id)) return;
      if (pending.length >= 20) throw new Error('等待中的消息太多，请稍后再发送');
      seen.add(id);
      onAccept?.();
      const entry = { id, message, steer };
      const queuedAt = steer ? pending.findIndex(item => !item.steer) : -1;
      if (queuedAt < 0) pending.push(entry); else pending.splice(queuedAt, 0, entry);
      if (steer && current && !interruptId) {
        current.interrupted = true;
        interruptId = crypto.randomUUID();
        child.stdin.write(JSON.stringify({ type: 'control_request', request_id: interruptId, request: { subtype: 'interrupt' } }) + '\n');
      }
      pump();
    },
    result() {
      const finished = current;
      current = null; interruptId = '';
      // Let the result event reach the browser before starting the next turn.
      queueMicrotask(() => { if (pending.length) pump(); else if (!stopped) onIdle(); });
      return finished?.id;
    },
    control(msg) {
      if (msg.response?.request_id === interruptId && msg.response?.subtype === 'error') {
        if (current) current.interrupted = false;
        interruptId = '';
        onWarning('当前 CLI 未接受中断，补充消息将按顺序继续处理');
      }
    },
    get currentId() { return current?.id || ''; },
    get pendingCount() { return pending.length; },
    get interrupted() { return !!current?.interrupted; },
    stop() { stopped = true; pending.length = 0; },
  };
}
module.exports = { createInputQueue };
