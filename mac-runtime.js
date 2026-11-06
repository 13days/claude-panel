const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const xml = value => String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function createMacRuntime({ dir, serverPath, port, proxyPort, platform = process.platform, home = os.homedir(), launch = spawn }) {
  let awake = null;
  const agent = path.join(home, 'Library/LaunchAgents/io.claude-panel.gateway.plist');
  return {
    status() { return { supported: platform === 'darwin', keepAwake: !!awake, autoStart: fs.existsSync(agent), backgroundService: process.env.CCP_BACKGROUND_SERVICE === '1' }; },
    keepAwake(enabled) {
      if (awake) { awake.kill('SIGTERM'); awake = null; }
      if (enabled && platform === 'darwin') {
        awake = launch('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
        const child = awake; child.on('error', () => { if (awake === child) awake = null; }); child.on('close', () => { if (awake === child) awake = null; });
      }
    },
    setAutoStart(enabled) {
      if (platform !== 'darwin') throw new Error('登录自动启动仅适用于 macOS');
      if (!enabled) { if (fs.existsSync(agent)) fs.unlinkSync(agent); return; }
      const node = fs.existsSync('/opt/homebrew/bin/node') ? '/opt/homebrew/bin/node' : process.execPath;
      const log = path.join(dir, 'panel-service.log');
      const env = { PORT: String(port), PROXY_PORT: String(proxyPort), CLAUDE_DIR: dir, CCP_NO_PROXY_SETUP: '1', CCP_BACKGROUND_SERVICE: '1', PATH: process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin' };
      const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>io.claude-panel.gateway</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(serverPath)}</string></array><key>WorkingDirectory</key><string>${xml(path.dirname(serverPath))}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Background</string><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`;
      fs.mkdirSync(path.dirname(agent), { recursive: true }); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(agent, content, { mode: 0o600 });
    },
    close() { if (awake) awake.kill('SIGTERM'); awake = null; },
  };
}
module.exports = { createMacRuntime };
