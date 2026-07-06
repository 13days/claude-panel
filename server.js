#!/usr/bin/env node
/**
 * Claude Panel — 管理个人 Claude 资源的本地面板服务
 * 零依赖，直接 `node server.js` 启动。
 *
 * 管理的资源：
 *   - 命令  ~/.claude/commands/<name>.md
 *   - Skill ~/.claude/skills/<name>/SKILL.md
 *   - Agent ~/.claude/agents/<name>.md
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 4321;
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');

const TYPES = {
  commands:  { dir: path.join(CLAUDE_DIR, 'commands'),  layout: 'flat', ext: '.md' },  // <name>.md
  skills:    { dir: path.join(CLAUDE_DIR, 'skills'),    layout: 'nested' },            // <name>/SKILL.md
  agents:    { dir: path.join(CLAUDE_DIR, 'agents'),    layout: 'flat', ext: '.md' },  // <name>.md
  workflows: { dir: path.join(CLAUDE_DIR, 'workflows'), layout: 'flat', ext: '.js' },  // <name>.js（Workflow 工具的命名工作流）
};

// ---------- i18n 框架 ----------
// 新增语言：在 STRINGS 里加一个语言字典即可（可以只翻译一部分，缺失的 key 自动回退 en → zh）。
// 前端 index.html 的 I18N/LANGS 同步加一份即可出现在下拉框里。
const DEFAULT_LANG = 'zh';
const STRINGS = {
  zh: {
    errInvalidName: '名称不合法（仅允许字母、数字、- _ .）',
    errExists: '同名资源已存在',
    errNotFound: '资源不存在',
    errContentStr: 'content 必须是字符串',
    errInstalledReadonly: '该资源由工具安装（软链接），不允许在面板中编辑',
    errCmdReadonly: '内置/插件命令不允许编辑',
    errCmdDelete: '内置命令不能删除；插件命令请用 /plugin 管理插件',
    errPluginOp: '插件不支持此操作，安装请在 Claude Code 里用 /plugin',
    errConfigOp: '配置文件只支持查看和编辑',
    errJson: 'JSON 格式错误: ',
    uninstallNote: '已从 installed_plugins.json 移除，缓存目录保留；重启 Claude Code 生效',
    builtinPath: '(Claude Code 内置命令，无磁盘文件)',
    builtinNote: '这是 Claude Code 程序内置的命令，不能在面板中编辑或删除。',
    unknownPath: '(未知路径)',
    missingDir: ' · ⚠ 安装目录缺失',
    brokenWarn: '⚠ 安装目录不存在，插件可能已损坏。',
    tblField: '字段', tblValue: '值', marketplace: '市场', version: '版本',
    installedAt: '安装时间', updated: '最近更新', installPath: '安装路径',
    secCommands: '提供的命令', secSkills: '提供的技能', secAgents: '提供的 Agents',
    unitCommands: '命令', unitSkills: '技能',
    cfgClaudeMdName: 'CLAUDE.md 全局指令', cfgClaudeMdDesc: '每次会话都会注入的全局说明（~/CLAUDE.md）',
    cfgClaudeDirName: 'CLAUDE.md（.claude 目录）', cfgClaudeDirDesc: '用户级记忆文件（~/.claude/CLAUDE.md）',
    cfgSettingsName: 'settings.json 设置与 Hooks', cfgSettingsDesc: '权限、hooks、环境变量等全局设置',
    cfgSettingsLocalDesc: '本机私有设置（不入库）',
    cfgKeybindName: 'keybindings.json 快捷键', cfgKeybindDesc: '自定义键位绑定',
    sesProject: '项目', sesTime: '时间范围', sesPromptCount: '提示词数量',
    sesTranscript: '完整记录', sesNoTranscript: '（记录文件不存在）',
    sesResume: '恢复此会话', sesPrompts: '提示词历史',
    cfgProjMdDesc: '项目级指令文件', cfgProjSettingsDesc: '项目级设置', cfgMemoryDesc: '项目记忆文件（~/.claude/projects/.../memory）',
  },
  en: {
    errInvalidName: 'Invalid name (only letters, digits, - _ . allowed)',
    errExists: 'An item with this name already exists',
    errNotFound: 'Not found',
    errContentStr: 'content must be a string',
    errInstalledReadonly: 'This item was installed by a tool (symlink) and cannot be edited here',
    errCmdReadonly: 'Built-in and plugin commands cannot be edited',
    errCmdDelete: 'Built-in commands cannot be deleted; manage plugin commands via /plugin',
    errPluginOp: 'Not supported for plugins; install via /plugin inside Claude Code',
    errConfigOp: 'Config files only support viewing and editing',
    errJson: 'Invalid JSON: ',
    uninstallNote: 'Removed from installed_plugins.json (cache kept). Restart Claude Code to take effect',
    builtinPath: '(built into Claude Code, no file on disk)',
    builtinNote: 'This command is built into Claude Code and cannot be edited or deleted here.',
    unknownPath: '(unknown path)',
    missingDir: ' · ⚠ install dir missing',
    brokenWarn: '⚠ Install directory missing; the plugin may be broken.',
    tblField: 'Field', tblValue: 'Value', marketplace: 'Marketplace', version: 'Version',
    installedAt: 'Installed', updated: 'Updated', installPath: 'Install path',
    secCommands: 'Commands', secSkills: 'Skills', secAgents: 'Agents',
    unitCommands: 'commands', unitSkills: 'skills',
    cfgClaudeMdName: 'CLAUDE.md (global instructions)', cfgClaudeMdDesc: 'Global instructions injected into every session (~/CLAUDE.md)',
    cfgClaudeDirName: 'CLAUDE.md (.claude dir)', cfgClaudeDirDesc: 'User-level memory file (~/.claude/CLAUDE.md)',
    cfgSettingsName: 'settings.json (settings & hooks)', cfgSettingsDesc: 'Global settings: permissions, hooks, env vars',
    cfgSettingsLocalDesc: 'Machine-local settings (not checked in)',
    cfgKeybindName: 'keybindings.json (shortcuts)', cfgKeybindDesc: 'Custom key bindings',
    sesProject: 'Project', sesTime: 'Time range', sesPromptCount: 'Prompt count',
    sesTranscript: 'Transcript', sesNoTranscript: '(transcript file missing)',
    sesResume: 'Resume this session', sesPrompts: 'Prompt history',
    cfgProjMdDesc: 'Project-level instructions', cfgProjSettingsDesc: 'Project-level settings', cfgMemoryDesc: 'Project memory file (~/.claude/projects/.../memory)',
  },
  ja: {
    errInvalidName: '名前が無効です（英数字と - _ . のみ使用可能）',
    errExists: '同名のリソースが既に存在します',
    errNotFound: '見つかりません',
    errContentStr: 'content は文字列である必要があります',
    errInstalledReadonly: 'ツールによりインストールされたリソース（シンボリックリンク）のため編集できません',
    errCmdReadonly: '組み込み／プラグインコマンドは編集できません',
    errCmdDelete: '組み込みコマンドは削除できません。プラグインコマンドは /plugin で管理してください',
    errPluginOp: 'プラグインではこの操作はできません。インストールは Claude Code の /plugin で',
    errConfigOp: '設定ファイルは表示と編集のみサポートしています',
    errJson: 'JSON 形式エラー: ',
    uninstallNote: 'installed_plugins.json から削除しました（キャッシュは保持）。Claude Code の再起動後に反映されます',
    builtinPath: '（Claude Code 組み込みコマンド、ファイルなし）',
    builtinNote: 'これは Claude Code に組み込まれたコマンドで、ここでは編集・削除できません。',
    unknownPath: '（不明なパス）',
    missingDir: ' · ⚠ インストールディレクトリがありません',
    brokenWarn: '⚠ インストールディレクトリが存在しません。プラグインが破損している可能性があります。',
    tblField: '項目', tblValue: '値', marketplace: 'マーケット', version: 'バージョン',
    installedAt: 'インストール日', updated: '更新日', installPath: 'インストールパス',
    secCommands: '提供コマンド', secSkills: '提供スキル', secAgents: '提供エージェント',
    unitCommands: 'コマンド', unitSkills: 'スキル',
    cfgClaudeMdName: 'CLAUDE.md グローバル指示', cfgClaudeMdDesc: '毎セッションに注入されるグローバル指示（~/CLAUDE.md）',
    cfgClaudeDirName: 'CLAUDE.md（.claude ディレクトリ）', cfgClaudeDirDesc: 'ユーザーレベルのメモリファイル（~/.claude/CLAUDE.md）',
    cfgSettingsName: 'settings.json 設定と Hooks', cfgSettingsDesc: '権限・hooks・環境変数などのグローバル設定',
    cfgSettingsLocalDesc: 'ローカル専用設定（リポジトリ外）',
    cfgKeybindName: 'keybindings.json ショートカット', cfgKeybindDesc: 'カスタムキーバインド',
    sesProject: 'プロジェクト', sesTime: '期間', sesPromptCount: 'プロンプト数',
    sesTranscript: 'トランスクリプト', sesNoTranscript: '（記録ファイルなし）',
    sesResume: 'このセッションを再開', sesPrompts: 'プロンプト履歴',
    cfgProjMdDesc: 'プロジェクトレベルの指示ファイル', cfgProjSettingsDesc: 'プロジェクトレベルの設定', cfgMemoryDesc: 'プロジェクトメモリファイル（~/.claude/projects/.../memory）',
  },
};
const SUPPORTED_LANGS = Object.keys(STRINGS);
// 取字符串：当前语言 → en → 默认语言，逐级回退，翻译不全也能工作
function T(lang, key) {
  return STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? STRINGS[DEFAULT_LANG][key] ?? key;
}

// Claude Code 内置斜杠命令（程序自带，磁盘上没有文件，只读展示）
// 描述按语言存放，缺失语言自动回退 en → zh；新增语言时给需要的条目补 ja/xx 字段即可
const BUILTINS = [
  ['add-dir', '添加额外的工作目录到当前会话', 'Add an additional working directory to the session'],
  ['agents', '管理 subagent（子代理）配置', 'Manage subagent configurations'],
  ['bug', '向 Anthropic 反馈 bug', 'Report a bug to Anthropic'],
  ['clear', '清空当前会话历史', 'Clear the current conversation history'],
  ['compact', '压缩会话上下文（可附带保留重点的说明）', 'Compact conversation context (optionally with focus instructions)'],
  ['config', '打开设置面板（主题、模型等）', 'Open the settings panel (theme, model, etc.)'],
  ['context', '查看当前上下文占用情况', 'Show current context usage'],
  ['cost', '查看当前会话的 token 花费统计', 'Show token cost statistics for the session'],
  ['doctor', '检查 Claude Code 安装的健康状态', 'Check the health of your Claude Code installation'],
  ['exit', '退出 Claude Code', 'Exit Claude Code'],
  ['export', '导出当前会话到文件或剪贴板', 'Export the conversation to a file or clipboard'],
  ['fast', '切换快速输出模式（Opus）', 'Toggle fast output mode (Opus)'],
  ['help', '查看帮助和可用命令', 'Show help and available commands'],
  ['hooks', '管理 hooks 配置', 'Manage hooks configuration'],
  ['ide', '连接 IDE（VS Code / JetBrains）', 'Connect to an IDE (VS Code / JetBrains)'],
  ['init', '初始化项目，生成 CLAUDE.md', 'Initialize the project and generate CLAUDE.md'],
  ['install-github-app', '安装 GitHub App 以支持 @claude 提及', 'Install the GitHub App for @claude mentions'],
  ['login', '登录 Anthropic 账号', 'Log in to your Anthropic account'],
  ['logout', '登出当前账号', 'Log out of the current account'],
  ['mcp', '管理 MCP 服务器连接', 'Manage MCP server connections'],
  ['memory', '编辑记忆文件（CLAUDE.md 等）', 'Edit memory files (CLAUDE.md, etc.)'],
  ['model', '切换/设置当前使用的模型', 'Switch or set the current model'],
  ['output-style', '设置输出风格', 'Set the output style'],
  ['permissions', '查看与管理工具权限', 'View and manage tool permissions'],
  ['pr-comments', '查看当前 PR 的评论', 'View comments on the current PR'],
  ['resume', '恢复历史会话', 'Resume a previous session'],
  ['review', '请求代码审查', 'Request a code review'],
  ['rewind', '回退会话与代码到之前的检查点', 'Rewind conversation and code to a checkpoint'],
  ['statusline', '配置终端底部状态栏', 'Configure the terminal status line'],
  ['status', '查看账号与系统状态', 'Show account and system status'],
  ['terminal-setup', '配置终端换行键绑定', 'Configure terminal newline key binding'],
  ['todos', '查看当前任务列表', 'Show the current todo list'],
  ['usage', '查看用量与限额', 'Show usage and limits'],
  ['vim', '切换 Vim 编辑模式', 'Toggle Vim editing mode'],
];
function builtinCommands(lang) {
  return BUILTINS.map(([name, zh, en]) => {
    const desc = { zh, en };
    return {
      name, description: desc[lang] ?? desc.en ?? desc.zh,
      origin: 'installed', source: 'builtin', key: 'b!' + name,
    };
  });
}

// 已安装插件提供的命令/技能（都会出现在 / 提示里），来自 installed_plugins.json
function listPluginCommands() {
  const manifest = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');
  const items = [];
  let plugins;
  try { plugins = JSON.parse(fs.readFileSync(manifest, 'utf8')).plugins || {}; } catch { return items; }
  for (const [fullName, installs] of Object.entries(plugins)) {
    const install = Array.isArray(installs) ? installs[0] : installs;
    if (!install || !install.installPath) continue;
    const pluginName = fullName.split('@')[0];
    // 插件的 commands/*.md
    const cmdDir = path.join(install.installPath, 'commands');
    if (fs.existsSync(cmdDir)) {
      for (const f of fs.readdirSync(cmdDir)) {
        if (!f.endsWith('.md')) continue;
        const content = fs.readFileSync(path.join(cmdDir, f), 'utf8');
        const name = f.replace(/\.md$/, '');
        items.push({ name, description: summarize(content), origin: 'installed', source: 'plugin:' + pluginName, key: `p!${pluginName}!c!${name}` });
      }
    }
    // 插件的 skills/*/SKILL.md（同样可通过 / 调用）
    const skillDir = path.join(install.installPath, 'skills');
    if (fs.existsSync(skillDir)) {
      for (const d of fs.readdirSync(skillDir)) {
        const fp = path.join(skillDir, d, 'SKILL.md');
        if (!fs.existsSync(fp)) continue;
        const content = fs.readFileSync(fp, 'utf8');
        items.push({ name: d, description: summarize(content), origin: 'installed', source: 'plugin:' + pluginName, key: `p!${pluginName}!s!${d}` });
      }
    }
  }
  return items;
}

// ---------- 插件专区 ----------
const PLUGIN_MANIFEST = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');

function readPluginManifest() {
  try { return JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8')); } catch { return { version: 2, plugins: {} }; }
}

function pluginContents(installPath) {
  const out = { commands: [], skills: [], agents: [] };
  const cmdDir = path.join(installPath, 'commands');
  if (fs.existsSync(cmdDir)) {
    for (const f of fs.readdirSync(cmdDir)) {
      if (!f.endsWith('.md')) continue;
      out.commands.push({ name: f.replace(/\.md$/, ''), description: summarize(fs.readFileSync(path.join(cmdDir, f), 'utf8')) });
    }
  }
  const skillDir = path.join(installPath, 'skills');
  if (fs.existsSync(skillDir)) {
    for (const d of fs.readdirSync(skillDir)) {
      const fp = path.join(skillDir, d, 'SKILL.md');
      if (fs.existsSync(fp)) out.skills.push({ name: d, description: summarize(fs.readFileSync(fp, 'utf8')) });
    }
  }
  const agentDir = path.join(installPath, 'agents');
  if (fs.existsSync(agentDir)) {
    for (const f of fs.readdirSync(agentDir)) {
      if (f.endsWith('.md')) out.agents.push({ name: f.replace(/\.md$/, ''), description: summarize(fs.readFileSync(path.join(agentDir, f), 'utf8')) });
    }
  }
  return out;
}

function pluginDescription(installPath) {
  try {
    const pj = path.join(installPath, '.claude-plugin', 'plugin.json');
    if (fs.existsSync(pj)) {
      const d = JSON.parse(fs.readFileSync(pj, 'utf8')).description;
      if (d) return d;
    }
    const readme = path.join(installPath, 'README.md');
    if (fs.existsSync(readme)) return summarize(fs.readFileSync(readme, 'utf8'));
  } catch {}
  return '';
}

function listPlugins(lang) {
  const { plugins } = readPluginManifest();
  return Object.entries(plugins).map(([fullName, installs]) => {
    const install = Array.isArray(installs) ? installs[0] : installs;
    const [name, marketplace] = fullName.split('@');
    const exists = install && install.installPath && fs.existsSync(install.installPath);
    const c = exists ? pluginContents(install.installPath) : { commands: [], skills: [], agents: [] };
    const parts = [];
    if (c.commands.length) parts.push(`${c.commands.length} ${T(lang, 'unitCommands')}`);
    if (c.skills.length) parts.push(`${c.skills.length} ${T(lang, 'unitSkills')}`);
    if (c.agents.length) parts.push(`${c.agents.length} agents`);
    return {
      name, key: fullName, origin: 'user', // 插件专区不参与自建/安装过滤
      description: `${marketplace} · v${install?.version || '?'}${parts.length ? ' · ' + parts.join(' / ') : ''}${exists ? '' : T(lang, 'missingDir')}`,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function pluginDetail(fullName, lang) {
  const { plugins } = readPluginManifest();
  const installs = plugins[fullName];
  if (!installs) return null;
  const install = Array.isArray(installs) ? installs[0] : installs;
  const [name, marketplace] = fullName.split('@');
  const ip = install.installPath || '';
  const exists = ip && fs.existsSync(ip);
  let md = `# ${name}\n\n`;
  md += `| ${T(lang, 'tblField')} | ${T(lang, 'tblValue')} |\n|---|---|\n`;
  md += `| ${T(lang, 'marketplace')} | ${marketplace} |\n| ${T(lang, 'version')} | ${install.version || '?'} |\n`;
  if (install.installedAt) md += `| ${T(lang, 'installedAt')} | ${install.installedAt.slice(0, 10)} |\n`;
  if (install.lastUpdated) md += `| ${T(lang, 'updated')} | ${install.lastUpdated.slice(0, 10)} |\n`;
  md += `| ${T(lang, 'installPath')} | \`${ip}\` |\n`;
  const desc = exists ? pluginDescription(ip) : '';
  if (desc) md += `\n${desc}\n`;
  if (exists) {
    const c = pluginContents(ip);
    for (const [sec, list, pre] of [['secCommands', c.commands, '/'], ['secSkills', c.skills, ''], ['secAgents', c.agents, '']]) {
      if (!list.length) continue;
      md += `\n## ${T(lang, sec)}（${list.length}）\n\n`;
      for (const x of list) md += `- \`${pre}${x.name}\` — ${x.description}\n`;
    }
  } else {
    md += `\n> ${T(lang, 'brokenWarn')}\n`;
  }
  return { name, path: ip || T(lang, 'unknownPath'), meta: {}, content: md, origin: 'installed', plugin: true };
}

// ---------- 项目 / 会话 / 统计 ----------
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
let _histCache = { mtime: -1, entries: [] };
function readHistory() {
  try {
    const st = fs.statSync(HISTORY_FILE);
    if (st.mtimeMs !== _histCache.mtime) {
      const entries = [];
      for (const line of fs.readFileSync(HISTORY_FILE, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { entries.push(JSON.parse(line)); } catch {}
      }
      _histCache = { mtime: st.mtimeMs, entries };
    }
  } catch { _histCache = { mtime: -1, entries: [] }; }
  return _histCache.entries;
}

// 从 history 提取真实项目路径（只保留磁盘上仍存在的目录）
function knownProjects() {
  const seen = new Set();
  for (const e of readHistory()) if (e.project) seen.add(e.project);
  return [...seen].filter(p => {
    try { return path.isAbsolute(p) && fs.statSync(p).isDirectory(); } catch { return false; }
  }).sort();
}

// 项目路径 → ~/.claude/projects/ 下的目录名
const encodeProject = p => p.replace(/[\/.]/g, '-');

function listSessions() {
  const map = new Map();
  for (const e of readHistory()) {
    if (!e.sessionId) continue;
    let s = map.get(e.sessionId);
    if (!s) {
      s = { id: e.sessionId, title: e.display || '', project: e.project || '', count: 0, first: e.timestamp || 0, last: e.timestamp || 0 };
      map.set(e.sessionId, s);
    }
    s.count++;
    const ts = e.timestamp || 0;
    if (ts >= s.last) s.last = ts;
    if (ts < s.first) { s.first = ts; s.title = e.display || s.title; }
  }
  return [...map.values()].sort((a, b) => b.last - a.last).slice(0, 200);
}

function sessionDetail(id, lang) {
  const prompts = readHistory().filter(e => e.sessionId === id);
  if (!prompts.length) return null;
  prompts.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const project = prompts[0].project || '';
  const transcript = project ? path.join(CLAUDE_DIR, 'projects', encodeProject(project), id + '.jsonl') : '';
  const hasTranscript = transcript && fs.existsSync(transcript);
  const fmtTime = ts => ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '?';
  let md = `# ${prompts[0].display || id}\n\n`;
  md += `| ${T(lang, 'tblField')} | ${T(lang, 'tblValue')} |\n|---|---|\n`;
  md += `| Session ID | \`${id}\` |\n`;
  md += `| ${T(lang, 'sesProject')} | \`${project || '?'}\` |\n`;
  md += `| ${T(lang, 'sesTime')} | ${fmtTime(prompts[0].timestamp)} → ${fmtTime(prompts[prompts.length - 1].timestamp)} |\n`;
  md += `| ${T(lang, 'sesPromptCount')} | ${prompts.length} |\n`;
  md += `| ${T(lang, 'sesTranscript')} | ${hasTranscript ? '`' + transcript + '`' : T(lang, 'sesNoTranscript')} |\n`;
  md += `\n## ${T(lang, 'sesResume')}\n\n\`\`\`\ncd ${project || '~'} && claude --resume ${id}\n\`\`\`\n`;
  md += `\n## ${T(lang, 'sesPrompts')}（${prompts.length}）\n\n`;
  for (const p of prompts) {
    const text = (p.display || '').replace(/\s+/g, ' ').slice(0, 200);
    md += `- **${fmtTime(p.timestamp)}** ${text}\n`;
  }
  return { name: (prompts[0].display || id).slice(0, 60), path: hasTranscript ? transcript : T(lang, 'sesNoTranscript'), meta: {}, content: md, origin: 'user', session: true };
}

// 用量统计：与 ccusage 同源 —— 直接扫描 ~/.claude/projects/**/*.jsonl 的 assistant 消息 usage，
// 按 message.id + requestId 全局去重；按文件 mtime 增量缓存，只重新解析有变化的文件。
const _usageCache = new Map(); // filePath -> { mtimeMs, size, parsed }

function localDay(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseTranscript(fp) {
  const out = { records: [], userMsgs: 0, userByDay: {}, hourCounts: {}, firstTs: null };
  let content;
  try { content = fs.readFileSync(fp, 'utf8'); } catch { return out; }
  for (const line of content.split('\n')) {
    if (!line) continue;
    const isAssistant = line.includes('"type":"assistant"');
    const isUser = !isAssistant && line.includes('"type":"user"');
    if (!isAssistant && !isUser) continue;
    const tsm = line.match(/"timestamp":"([^"]+)"/);
    const ts = tsm ? tsm[1] : null;
    if (ts && (!out.firstTs || ts < out.firstTs)) out.firstTs = ts;
    if (ts) {
      const h = new Date(ts).getHours();
      out.hourCounts[h] = (out.hourCounts[h] || 0) + 1;
    }
    if (isUser) {
      out.userMsgs++;
      if (ts) { const d = localDay(ts); out.userByDay[d] = (out.userByDay[d] || 0) + 1; }
      continue;
    }
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d.message;
    if (!m || !m.usage || !m.model || m.model === '<synthetic>') continue;
    const u = m.usage;
    // 缓存写分 5 分钟 / 1 小时两档（1 小时价格是 2 倍），算费用时要区分
    const c1 = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
    out.records.push({
      key: (m.id || '') + '|' + (d.requestId || ''),
      model: m.model,
      day: ts ? localDay(ts) : null,
      in: u.input_tokens || 0, out: u.output_tokens || 0,
      cr: u.cache_read_input_tokens || 0, cc: u.cache_creation_input_tokens || 0, c1,
    });
  }
  // 流式响应同一条消息会写多行、output_tokens 逐行递增：同 key 只保留最终（各字段最大）值
  const byKey = new Map();
  const rest = [];
  for (const r of out.records) {
    if (r.key === '|') { rest.push(r); continue; }
    const prev = byKey.get(r.key);
    if (!prev) byKey.set(r.key, r);
    else {
      prev.in = Math.max(prev.in, r.in); prev.out = Math.max(prev.out, r.out);
      prev.cr = Math.max(prev.cr, r.cr); prev.cc = Math.max(prev.cc, r.cc);
      prev.c1 = Math.max(prev.c1, r.c1);
    }
  }
  out.records = [...byKey.values(), ...rest];
  return out;
}

// 官方定价（$/M token）：{i: input, o: output}；缓存写 5m=1.25×in、1h=2×in，缓存读=0.1×in
// 已用 ccusage 的逐日 cost 校验过一致
function priceFor(model) {
  if (/fable-5|mythos-5/.test(model)) return { i: 10, o: 50 };
  if (/opus-4/.test(model)) return { i: 5, o: 25 };
  if (/sonnet-4/.test(model)) return { i: 3, o: 15 };
  if (/haiku-4/.test(model)) return { i: 1, o: 5 };
  return null;
}
function costOf(model, v) {
  const p = priceFor(model);
  if (!p) return null;
  return (v.in * p.i + v.out * p.o + (v.cc - v.c1) * p.i * 1.25 + v.c1 * p.i * 2 + v.cr * p.i * 0.1) / 1e6;
}
const shortModel = m => m.replace(/^claude-/, '').replace(/-\d{8}$/, '');

function readStats() {
  const projRoot = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projRoot)) return null;
  // 递归收集全部 .jsonl（会话目录下还有 subagent 子目录，ccusage 也会统计它们）
  const files = [];
  const sessionFiles = new Set(); // 仅顶层会话文件用于会话计数
  (function walk(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(fp, depth + 1); }
      else if (e.name.endsWith('.jsonl')) {
        files.push(fp);
        if (depth === 1) sessionFiles.add(fp);
      }
    }
  })(projRoot, 0);
  const seen = new Set();
  const modelUsage = {}, byDay = {}, hourCounts = {}, dayModels = {};
  let totalMessages = 0, firstTs = null;
  for (const fp of files) {
    let st;
    try { st = fs.statSync(fp); } catch { continue; }
    let entry = _usageCache.get(fp);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      entry = { mtimeMs: st.mtimeMs, size: st.size, parsed: parseTranscript(fp) };
      _usageCache.set(fp, entry);
    }
    const p = entry.parsed;
    totalMessages += p.userMsgs;
    if (p.firstTs && (!firstTs || p.firstTs < firstTs)) firstTs = p.firstTs;
    for (const [h, n] of Object.entries(p.hourCounts)) hourCounts[h] = (hourCounts[h] || 0) + n;
    for (const [d, n] of Object.entries(p.userByDay)) {
      (byDay[d] ||= { messageCount: 0 }).messageCount += n;
    }
    for (const r of p.records) {
      if (r.key !== '|' && seen.has(r.key)) continue; // 全局去重（重试/续写产生的重复计费行）
      if (r.key !== '|') seen.add(r.key);
      totalMessages++;
      const t = modelUsage[r.model] ||= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
      t.inputTokens += r.in; t.outputTokens += r.out; t.cacheReadInputTokens += r.cr; t.cacheCreationInputTokens += r.cc;
      if (r.day) {
        (byDay[r.day] ||= { messageCount: 0 }).messageCount++;
        const dm = (dayModels[r.day] ||= {});
        const v = dm[r.model] ||= { in: 0, out: 0, cc: 0, c1: 0, cr: 0 };
        v.in += r.in; v.out += r.out; v.cc += r.cc; v.c1 += r.c1; v.cr += r.cr;
      }
    }
  }
  const dailyActivity = Object.entries(byDay)
    .map(([date, v]) => ({ date, messageCount: v.messageCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // ccusage daily 风格的逐日明细表
  const totals = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0, costKnown: true };
  const dailyTable = Object.entries(dayModels).sort((a, b) => a[0].localeCompare(b[0])).map(([date, models]) => {
    const row = { date, models: [], input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0, costKnown: true };
    for (const [m, v] of Object.entries(models)) {
      row.models.push(shortModel(m));
      row.input += v.in; row.output += v.out; row.cacheCreate += v.cc; row.cacheRead += v.cr;
      const c = costOf(m, v);
      if (c === null) row.costKnown = false; else row.cost += c;
    }
    row.models.sort();
    row.totalTokens = row.input + row.output + row.cacheCreate + row.cacheRead;
    totals.input += row.input; totals.output += row.output;
    totals.cacheCreate += row.cacheCreate; totals.cacheRead += row.cacheRead;
    totals.cost += row.cost;
    if (!row.costKnown) totals.costKnown = false;
    return row;
  });
  totals.totalTokens = totals.input + totals.output + totals.cacheCreate + totals.cacheRead;
  return {
    totalSessions: sessionFiles.size, totalMessages,
    firstSessionDate: firstTs, dailyActivity,
    modelUsage, hourCounts, dailyTable, totals, source: 'transcripts',
  };
}

// scope（项目根路径）→ 各资源目录；scope 为空时用全局 ~/.claude
function typesFor(scope) {
  if (!scope) return TYPES;
  const base = path.join(scope, '.claude');
  return {
    commands:  { dir: path.join(base, 'commands'),  layout: 'flat', ext: '.md' },
    skills:    { dir: path.join(base, 'skills'),    layout: 'nested' },
    agents:    { dir: path.join(base, 'agents'),    layout: 'flat', ext: '.md' },
    workflows: { dir: path.join(base, 'workflows'), layout: 'flat', ext: '.js' },
  };
}

// ---------- 配置专区 ----------
function configFiles(lang, scope) {
  let candidates;
  if (scope) {
    const base = path.join(scope, '.claude');
    candidates = [
      { key: 'claude-md', name: 'CLAUDE.md', path: path.join(scope, 'CLAUDE.md'), desc: T(lang, 'cfgProjMdDesc') },
      { key: 'claude-dir-md', name: 'CLAUDE.md (.claude)', path: path.join(base, 'CLAUDE.md'), desc: T(lang, 'cfgProjMdDesc') },
      { key: 'settings', name: 'settings.json', path: path.join(base, 'settings.json'), desc: T(lang, 'cfgProjSettingsDesc') },
      { key: 'settings-local', name: 'settings.local.json', path: path.join(base, 'settings.local.json'), desc: T(lang, 'cfgSettingsLocalDesc') },
    ];
    // 项目记忆目录 ~/.claude/projects/<encoded>/memory/*.md
    const memDir = path.join(CLAUDE_DIR, 'projects', encodeProject(scope), 'memory');
    if (fs.existsSync(memDir)) {
      for (const f of fs.readdirSync(memDir).sort()) {
        if (!f.endsWith('.md')) continue;
        candidates.push({ key: 'mem-' + f.replace(/\.md$/, ''), name: '🧠 ' + f, path: path.join(memDir, f), desc: T(lang, 'cfgMemoryDesc') });
      }
    }
  } else {
    candidates = [
      { key: 'claude-md', name: T(lang, 'cfgClaudeMdName'), path: path.join(os.homedir(), 'CLAUDE.md'), desc: T(lang, 'cfgClaudeMdDesc') },
      { key: 'claude-dir-md', name: T(lang, 'cfgClaudeDirName'), path: path.join(CLAUDE_DIR, 'CLAUDE.md'), desc: T(lang, 'cfgClaudeDirDesc') },
      { key: 'settings', name: T(lang, 'cfgSettingsName'), path: path.join(CLAUDE_DIR, 'settings.json'), desc: T(lang, 'cfgSettingsDesc') },
      { key: 'settings-local', name: 'settings.local.json', path: path.join(CLAUDE_DIR, 'settings.local.json'), desc: T(lang, 'cfgSettingsLocalDesc') },
      { key: 'keybindings', name: T(lang, 'cfgKeybindName'), path: path.join(CLAUDE_DIR, 'keybindings.json'), desc: T(lang, 'cfgKeybindDesc') },
    ];
  }
  return candidates.filter(f => fs.existsSync(f.path));
}
function pluginCommandPath(key) {
  const m = key.match(/^p!([\w.-]+)!(c|s)!([\w.-]+)$/);
  if (!m) return null;
  const [, pluginName, kind, name] = m;
  const manifest = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');
  let plugins;
  try { plugins = JSON.parse(fs.readFileSync(manifest, 'utf8')).plugins || {}; } catch { return null; }
  for (const [fullName, installs] of Object.entries(plugins)) {
    if (fullName.split('@')[0] !== pluginName) continue;
    const install = Array.isArray(installs) ? installs[0] : installs;
    if (!install || !install.installPath) continue;
    return kind === 'c'
      ? path.join(install.installPath, 'commands', name + '.md')
      : path.join(install.installPath, 'skills', name, 'SKILL.md');
  }
  return null;
}

// ---------- helpers ----------
function safeName(name) {
  // 防目录穿越：只允许字母数字、中划线、下划线、点（不允许 .. 和斜杠）
  if (typeof name !== 'string' || !name.length) return null;
  if (!/^[\w.-]+$/.test(name) || name.includes('..')) return null;
  return name;
}

function filePathOf(type, name, scope) {
  const t = typesFor(scope)[type];
  if (!t) return null;
  const n = safeName(name);
  if (!n) return null;
  return t.layout === 'nested'
    ? path.join(t.dir, n, 'SKILL.md')
    : path.join(t.dir, n + (t.ext || '.md'));
}

function isInstalled(type, name, scope) {
  // 软链接视为通过工具安装的资源
  const t = typesFor(scope)[type];
  const target = t.layout === 'nested' ? path.join(t.dir, name) : path.join(t.dir, name + '.md');
  try { return fs.lstatSync(target).isSymbolicLink(); } catch { return false; }
}

function parseFrontmatter(content) {
  const meta = {};
  let body = content;
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    body = content.slice(m[0].length);
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (kv) {
        let v = kv[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        meta[kv[1]] = v;
      }
    }
  }
  return { meta, body };
}

// 工作流脚本：从 export const meta = {...} 里提取 description
function jsMetaDescription(content) {
  const m = content.match(/description:\s*(['"`])((?:\\.|(?!\1).)*)\1/);
  return m ? m[2] : (content.split(/\r?\n/).find(l => l.trim().startsWith('//')) || '').replace(/^\s*\/\/\s*/, '').slice(0, 200);
}

function summarize(content) {
  const { meta, body } = parseFrontmatter(content);
  if (meta.description) return meta.description;
  const firstLine = body.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'));
  const firstHeading = body.split(/\r?\n/).find(l => l.startsWith('#'));
  return (firstLine || firstHeading || '').replace(/^#+\s*/, '').slice(0, 200);
}

function listItems(type, scope) {
  const t = typesFor(scope)[type];
  if (!fs.existsSync(t.dir)) return [];
  const items = [];
  if (t.layout === 'nested') {
    for (const name of fs.readdirSync(t.dir)) {
      const dirPath = path.join(t.dir, name);
      // 软链接 = 通过 axon-cli 等工具安装；真实目录 = 用户自建
      const lstat = fs.lstatSync(dirPath);
      const isLink = lstat.isSymbolicLink();
      let isDir;
      try { isDir = fs.statSync(dirPath).isDirectory(); } catch { continue; } // 跳过失效软链接
      if (!isDir) continue;
      const fp = path.join(dirPath, 'SKILL.md');
      if (!fs.existsSync(fp)) continue;
      const stat = fs.statSync(fp);
      const content = fs.readFileSync(fp, 'utf8');
      items.push({ name, description: summarize(content), mtime: stat.mtimeMs, size: stat.size, origin: isLink ? 'installed' : 'user' });
    }
  } else {
    const ext = t.ext || '.md';
    for (const f of fs.readdirSync(t.dir)) {
      if (!f.endsWith(ext) || f.startsWith('.')) continue;
      const fp = path.join(t.dir, f);
      const isLink = fs.lstatSync(fp).isSymbolicLink();
      const stat = fs.statSync(fp);
      const content = fs.readFileSync(fp, 'utf8');
      const desc = ext === '.js' ? jsMetaDescription(content) : summarize(content);
      items.push({ name: f.slice(0, -ext.length), description: desc, mtime: stat.mtimeMs, size: stat.size, origin: isLink ? 'installed' : 'user' });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function sendJSON(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5 * 1024 * 1024) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  // 仅本机访问
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['api','skills','lark']
  const langParam = url.searchParams.get('lang');
  const lang = SUPPORTED_LANGS.includes(langParam) ? langParam : DEFAULT_LANG;
  // scope = 项目根路径；只接受 history 里出现过且仍存在的项目，防任意路径读写
  let scope = url.searchParams.get('scope') || '';
  if (scope && !knownProjects().includes(scope)) scope = '';

  try {
    if (parts[0] !== 'api') {
      // 静态页面
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    const type = parts[1];

    // ---- 项目列表 ----
    if (type === 'projects' && req.method === 'GET') {
      return sendJSON(res, 200, { items: knownProjects().map(p => ({ path: p, name: path.basename(p) })) });
    }

    // ---- 统计 ----
    if (type === 'stats' && req.method === 'GET') {
      const s = readStats();
      return s ? sendJSON(res, 200, s) : sendJSON(res, 404, { error: T(lang, 'errNotFound') });
    }

    // ---- 会话历史 ----
    if (type === 'sessions') {
      if (req.method === 'GET' && parts.length === 2) {
        const items = listSessions().map(s => ({
          name: (s.title || s.id).slice(0, 80),
          key: s.id,
          description: `${path.basename(s.project || '') || '?'} · ${s.count} × · ${s.last ? new Date(s.last).toISOString().slice(0, 10) : '?'}`,
          origin: 'user',
        }));
        return sendJSON(res, 200, { items });
      }
      if (req.method === 'GET' && parts.length === 3) {
        const d = sessionDetail(decodeURIComponent(parts[2]), lang);
        return d ? sendJSON(res, 200, d) : sendJSON(res, 404, { error: T(lang, 'errNotFound') });
      }
      return sendJSON(res, 405, { error: 'method not allowed' });
    }

    // ---- 插件专区 ----
    if (type === 'plugins') {
      if (req.method === 'GET' && parts.length === 2) return sendJSON(res, 200, { items: listPlugins(lang) });
      if (req.method === 'GET' && parts.length === 3) {
        const d = pluginDetail(decodeURIComponent(parts[2]), lang);
        return d ? sendJSON(res, 200, d) : sendJSON(res, 404, { error: T(lang, 'errNotFound') });
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        const fullName = decodeURIComponent(parts[2]);
        const manifest = readPluginManifest();
        if (!manifest.plugins[fullName]) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
        delete manifest.plugins[fullName];
        fs.writeFileSync(PLUGIN_MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
        return sendJSON(res, 200, { ok: true, note: T(lang, 'uninstallNote') });
      }
      return sendJSON(res, 405, { error: T(lang, 'errPluginOp') });
    }

    // ---- 配置专区 ----
    if (type === 'config') {
      const files = configFiles(lang, scope);
      if (req.method === 'GET' && parts.length === 2) {
        return sendJSON(res, 200, {
          items: files.map(f => ({ name: f.name, key: f.key, description: f.desc, origin: 'user' })),
        });
      }
      const file = files.find(f => f.key === decodeURIComponent(parts[2] || ''));
      if (parts.length === 3 && !file) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
      if (req.method === 'GET' && parts.length === 3) {
        return sendJSON(res, 200, {
          name: file.name, path: file.path, meta: {},
          content: fs.readFileSync(file.path, 'utf8'),
          origin: 'user', lang: file.path.endsWith('.json') ? 'json' : 'md', config: true,
        });
      }
      if (req.method === 'PUT' && parts.length === 3) {
        const { content } = JSON.parse(await readBody(req) || '{}');
        if (typeof content !== 'string') return sendJSON(res, 400, { error: T(lang, 'errContentStr') });
        if (file.path.endsWith('.json')) {
          try { JSON.parse(content); } catch (e) { return sendJSON(res, 400, { error: T(lang, 'errJson') + e.message }); }
        }
        fs.writeFileSync(file.path, content, 'utf8');
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 405, { error: T(lang, 'errConfigOp') });
    }

    if (!TYPES[type]) return sendJSON(res, 404, { error: `unknown type: ${type}` });

    // GET /api/<type>  → 列表
    if (req.method === 'GET' && parts.length === 2) {
      let items = listItems(type, scope).map(it => ({ ...it, source: it.origin === 'installed' ? 'installed' : 'user', key: it.name }));
      if (type === 'commands' && !scope) {  // 项目作用域下只显示项目自己的命令
        items = items.concat(listPluginCommands(), builtinCommands(lang));
      }
      return sendJSON(res, 200, { items });
    }

    // GET /api/<type>/<name|key>  → 详情
    if (req.method === 'GET' && parts.length === 3) {
      const name = decodeURIComponent(parts[2]);
      // 内置命令：无磁盘文件，返回描述
      if (type === 'commands' && name.startsWith('b!')) {
        const b = builtinCommands(lang).find(c => c.key === name);
        if (!b) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
        const en = lang === 'en';
        return sendJSON(res, 200, {
          name: b.name,
          path: en ? '(built into Claude Code, no file on disk)' : '(Claude Code 内置命令，无磁盘文件)',
          meta: {},
          content: `# /${b.name}\n\n${b.description}\n\n> ${en ? 'This command is built into Claude Code and cannot be edited or deleted here.' : '这是 Claude Code 程序内置的命令，不能在面板中编辑或删除。'}`,
          origin: 'installed', builtin: true,
        });
      }
      // 插件命令/技能
      if (type === 'commands' && name.startsWith('p!')) {
        const fp = pluginCommandPath(name);
        if (!fp || !fs.existsSync(fp)) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
        const content = fs.readFileSync(fp, 'utf8');
        const { meta } = parseFrontmatter(content);
        return sendJSON(res, 200, { name: name.split('!').pop(), path: fp, meta, content, origin: 'installed' });
      }
      const fp = filePathOf(type, name, scope);
      if (!fp || !fs.existsSync(fp)) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
      const content = fs.readFileSync(fp, 'utf8');
      const { meta } = parseFrontmatter(content);
      return sendJSON(res, 200, {
        name, path: fp, meta, content,
        lang: fp.endsWith('.js') ? 'js' : undefined,
        origin: isInstalled(type, name, scope) ? 'installed' : 'user',
      });
    }

    // POST /api/<type>  → 新建 { name, content }
    if (req.method === 'POST' && parts.length === 2) {
      const { name, content } = JSON.parse(await readBody(req) || '{}');
      const fp = filePathOf(type, name, scope);
      if (!fp) return sendJSON(res, 400, { error: T(lang, 'errInvalidName') });
      if (fs.existsSync(fp)) return sendJSON(res, 409, { error: T(lang, 'errExists') });
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content ?? '', 'utf8');
      return sendJSON(res, 201, { ok: true, path: fp });
    }

    // PUT /api/<type>/<name>  → 更新 { content }
    if (req.method === 'PUT' && parts.length === 3) {
      const name = decodeURIComponent(parts[2]);
      if (name.includes('!')) return sendJSON(res, 403, { error: T(lang, 'errCmdReadonly') });
      const fp = filePathOf(type, name, scope);
      if (!fp) return sendJSON(res, 400, { error: T(lang, 'errInvalidName') });
      if (!fs.existsSync(fp)) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
      if (isInstalled(type, name, scope)) return sendJSON(res, 403, { error: T(lang, 'errInstalledReadonly') });
      const { content } = JSON.parse(await readBody(req) || '{}');
      if (typeof content !== 'string') return sendJSON(res, 400, { error: T(lang, 'errContentStr') });
      fs.writeFileSync(fp, content, 'utf8');
      return sendJSON(res, 200, { ok: true });
    }

    // DELETE /api/<type>/<name>
    if (req.method === 'DELETE' && parts.length === 3) {
      const name = decodeURIComponent(parts[2]);
      if (name.includes('!')) return sendJSON(res, 403, { error: T(lang, 'errCmdDelete') });
      const fp = filePathOf(type, name, scope);
      if (!fp || !fs.existsSync(fp)) return sendJSON(res, 404, { error: T(lang, 'errNotFound') });
      const target = typesFor(scope)[type].layout === 'nested' ? path.dirname(fp) : fp;
      if (fs.lstatSync(target).isSymbolicLink()) {
        // 安装的资源：只移除链接本身，不动 ~/.agents 下的源文件
        fs.unlinkSync(target);
      } else if (typesFor(scope)[type].layout === 'nested') {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        fs.rmSync(target);
      }
      return sendJSON(res, 200, { ok: true });
    }

    sendJSON(res, 405, { error: 'method not allowed' });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude Panel 已启动: http://localhost:${PORT}`);
  console.log(`管理目录: ${CLAUDE_DIR}`);
});
