const path = require('path');
const PAGE_SIZE = 5;
const REPLY_PREVIEW = 2200;
const clip = (value, max) => { const chars = Array.from(String(value || '')); return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join(''); };
const escape = value => String(value || '').replace(/([\\`*_[\]<>])/g, '\\$1').replace(/\s+/g, ' ');
const plain = value => ({ tag: 'plain_text', content: String(value || '') });
const markdown = (content, small = false) => ({ tag: 'markdown', content: String(content || '').replace(/<at\b/gi, '&lt;at'), text_size: small ? 'notation' : 'normal' });
const muted = content => markdown(`<font color='grey'>${content}</font>`, true);
const button = (text, value, type = 'default') => ({ tag: 'button', text: plain(text), type, behaviors: [{ type: 'callback', value }] });
const buttons = items => ({ tag: 'column_set', flex_mode: 'flow', horizontal_spacing: '8px', columns: items.map(item => ({ tag: 'column', width: 'auto', elements: [item] })) });
const collapse = (title, elements, expanded = false, id) => ({ tag: 'collapsible_panel', ...(id ? { element_id: id } : {}), expanded, header: { title: plain(title), icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' }, icon_position: 'right', icon_expanded_angle: -180 }, border: { color: 'grey', corner_radius: '5px' }, vertical_spacing: '8px', padding: '8px 8px 8px 8px', elements });
function card(title, elements, { subtitle = 'Claude Code · 本机工作空间', template = 'grey', summary = title } = {}) {
  return { schema: '2.0', config: { width_mode: 'default', update_multi: true, summary: { content: clip(summary, 120) } }, header: { title: plain(clip(title, 64)), subtitle: plain(clip(subtitle, 100)), template }, body: { padding: '12px 16px 12px 16px', vertical_spacing: '12px', elements } };
}
const action = (context, value) => ({ ...value, owner: context.owner, key: context.key });
function row(title, detail, operation) {
  return { tag: 'column_set', flex_mode: 'stretch', horizontal_spacing: '12px', columns: [
    { tag: 'column', width: 'weighted', weight: 1, elements: [markdown(`**${title}**`), muted(detail)] },
    { tag: 'column', width: 'auto', vertical_align: 'center', elements: [operation] },
  ] };
}
function sessionList({ rows, total, page, query, selected, ...context }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const elements = [muted(`${context.location ? context.location + ' · ' : ''}共 ${total} 个会话 · 第 ${page + 1} / ${pages} 页${query ? ' · 筛选：' + escape(clip(query, 50)) : ''}`)];
  rows.forEach((item, index) => {
    const number = page * PAGE_SIZE + index + 1, current = item.id === selected;
    elements.push(row(`${number}. ${escape(clip(item.title || '未命名会话', 70))}`, `${escape(path.basename(item.project || '') || '未指定项目')} · ${current ? '● 当前会话' : item.running ? '● 运行中' : '可接续'}`, button(current ? '继续' : '切换', action(context, { action: 'switch', id: item.id }), current ? 'primary' : 'default')));
  });
  if (!rows.length) elements.push(markdown('没有找到匹配的会话。试试其他关键词，或新建一个会话。'));
  if (rows.length) elements.push(collapse('项目路径与会话 ID', rows.map((item, index) => markdown(`**${page * PAGE_SIZE + index + 1}. ${escape(clip(item.title || '未命名会话', 60))}**\n${escape(item.project)}\n\`${item.id}\``, true))));
  const navigation = [];
  if (page > 0) navigation.push(button('← 上一页', action(context, { action: 'sessions', page: page - 1, query })));
  if (page + 1 < pages) navigation.push(button('下一页 →', action(context, { action: 'sessions', page: page + 1, query })));
  navigation.push(button('刷新', action(context, { action: 'sessions', page, query })), button('＋ 新建会话', action(context, { action: 'projects' }), 'primary'));
  elements.push(buttons(navigation), muted('切换仅修改当前位置的绑定。/sessions 关键词筛选；/switch 序号切换；/new 使用默认项目新建。'));
  return card('最近会话', elements, { summary: `${total} 个会话 · 选择一个继续工作` });
}
function projectList({ rows, total, page, defaultProject, ...context }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const elements = [muted(`选择项目，新建 Claude Code 会话 · ${page + 1} / ${pages}`)];
  rows.forEach((cwd, index) => elements.push(row(`${page * PAGE_SIZE + index + 1}. ${escape(path.basename(cwd) || cwd)}`, cwd === defaultProject ? '默认项目' : escape(clip(path.dirname(cwd), 80)), button('新建会话', action(context, { action: 'new', cwd })))));
  if (!rows.length) elements.push(markdown('还没有可用项目。请先在 Panel 选择默认项目。'));
  const navigation = [];
  if (page > 0) navigation.push(button('← 上一页', action(context, { action: 'projects', page: page - 1 })));
  if (page + 1 < pages) navigation.push(button('下一页 →', action(context, { action: 'projects', page: page + 1 })));
  navigation.push(button('返回会话', action(context, { action: 'sessions' })));
  elements.push(buttons(navigation));
  return card('选择工作项目', elements);
}
function permissions(context, binding, requests) {
  const elements = [];
  for (const request of requests.slice(0, 3)) {
    const preview = request.input?.command || request.input?.file_path || request.input?.url;
    elements.push(markdown(`**需要授权 · ${escape(request.tool)}**${request.description ? '\n' + escape(clip(request.description, 120)) : ''}${preview ? '\n```\n' + clip(preview, 180) + '\n```' : ''}`));
    elements.push(collapse('查看本次调用参数', [markdown('```json\n' + clip(JSON.stringify(request.input || {}, null, 2), 400) + '\n```', true)]));
    elements.push(buttons([button('允许本次调用', action(context, { action: 'permission', id: binding.id, requestId: request.id, behavior: 'allow' }), 'primary'), button('拒绝', action(context, { action: 'permission', id: binding.id, requestId: request.id, behavior: 'deny' }))]));
  }
  if (requests.length > 3) elements.push(muted(`另有 ${requests.length - 3} 项等待授权，处理后会依次显示。`));
  return elements;
}
function currentSession({ binding, item, running, requests = [], ...context }) {
  const title = item?.title || '新会话', elements = [markdown(`**${escape(clip(title, 100))}**`), muted(`${context.location ? context.location + ' · ' : ''}${escape(path.basename(binding.cwd) || binding.cwd)} · ${running ? '● 正在运行' : '已就绪，直接发消息继续'}`)];
  elements.push(...permissions(context, binding, requests), collapse('会话信息', [markdown(`${escape(binding.cwd)}\n\`${binding.id}\``, true)]));
  const actions = [button('最近对话', action(context, { action: 'history', id: binding.id })), button('切换会话', action(context, { action: 'sessions' })), button('＋ 新建', action(context, { action: 'projects' }))];
  if (running) actions.push(button('停止任务', action(context, { action: 'stop', id: binding.id }), 'danger'));
  elements.push(buttons(actions), muted('此绑定仅用于当前位置；群和话题内已授权用户共用。直接发消息继续；/new 在默认项目新建。'));
  return card('当前会话', elements, { subtitle: clip(title, 90), template: requests.length ? 'orange' : 'grey' });
}
function task({ binding, title, view, elapsed, ...context }) {
  const tools = [...view.tools.values()], requests = view.done ? [] : [...view.permissions.values()];
  const done = tools.filter(item => item.state === '已完成').length;
  const failed = view.phase === '失败' || view.phase === '连接已结束';
  const template = failed ? 'red' : requests.length ? 'orange' : view.done ? 'green' : 'blue';
  if (context.detailed === false) {
    const elements = [muted(`${Math.max(0, Math.floor(elapsed / 1000))} 秒${tools.length ? ` · 工具 ${done}/${tools.length}` : ''}`)];
    if (tools.length) elements.push(markdown(tools.slice(-8).map(tool => `🔧 ${escape(clip(tool.name, 60))} · ${escape(tool.state)}`).join('\n')));
    elements.push(markdown(view.done ? clip(view.text || '本轮已结束。', REPLY_PREVIEW) : requests.length ? '等待授权，请在本机 Panel 处理。' : '正在处理，完成后会显示回复。'));
    if (view.done && view.text.length > REPLY_PREVIEW) elements.push(muted('完整回复将在下方另行发送。'));
    return card(view.phase, elements, { subtitle: '工具执行状态与最终回复', template, summary: `${view.phase}${view.done ? ' · ' + clip(view.text, 90) : ''}` });
  }
  const elements = [muted(`${context.location ? context.location + ' · ' : ''}${escape(path.basename(binding.cwd) || '项目')} · ${Math.max(0, Math.floor(elapsed / 1000))} 秒${tools.length ? ` · 工具 ${done}/${tools.length}` : ''}`)];
  if (view.text) elements.push(markdown(clip(view.text, REPLY_PREVIEW)));
  else elements.push(markdown(requests.length ? '请确认下方工具调用，授权后继续。' : view.done ? '本轮已结束。' : '正在处理你的请求，进展会更新在这张卡片中。'));
  if (view.text.length > REPLY_PREVIEW) elements.push(muted('卡片展示回复摘要；完成后会另发完整回复。'));
  elements.push(...permissions(context, binding, requests));
  if (tools.length) {
    const recent = tools.slice(-4);
    const steps = recent.map((tool, index) => collapse(`${tools.length - recent.length + index + 1}. ${tool.name} · ${tool.state}`, [
      ...(tool.input ? [markdown('**输入**\n```json\n' + clip(tool.input, 120) + '\n```', true)] : []),
      ...(tool.output ? [markdown('**结果**\n```\n' + clip(tool.output, 200) + '\n```', true)] : []),
    ], tool.state === '失败', `tool_step_${tools.length - recent.length + index}`));
    if (tools.length > recent.length) steps.unshift(muted(`显示最近 ${recent.length} 项，完整执行记录保存在 Panel。`));
    elements.push(collapse(`执行详情 · ${tools.length} 个工具`, steps, false, 'execution_details'));
  }
  elements.push(collapse('会话信息', [markdown(`**${escape(clip(title, 80))}**\n${escape(binding.cwd)}\n\`${binding.id}\``, true)]));
  const actions = [button('查看会话', action(context, { action: 'switch', id: binding.id })), button('会话列表', action(context, { action: 'sessions' }))];
  if (!view.done) actions.push(button('停止任务', action(context, { action: 'stop', id: binding.id }), 'danger'));
  elements.push(buttons(actions));
  return card(view.phase, elements, { subtitle: clip(title, 90), template, summary: `${view.phase} · ${clip(view.text || title, 90)}` });
}
module.exports = { PAGE_SIZE, REPLY_PREVIEW, card, markdown, button, buttons, collapse, sessionList, projectList, currentSession, task };
