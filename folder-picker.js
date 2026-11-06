const { execFile } = require('child_process');

function chooseFolder({ platform = process.platform, run = execFile } = {}) {
  const commands = {
    darwin: ['osascript', ['-e', 'POSIX path of (choose folder with prompt "选择项目文件夹")']],
    win32: ['powershell.exe', ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Choose project folder"; if ($picker.ShowDialog() -eq "OK") { $picker.SelectedPath }']],
    linux: ['zenity', ['--file-selection', '--directory', '--title=Choose project folder']],
  };
  const command = commands[platform];
  if (!command) return Promise.reject(new Error('此系统暂不支持文件夹对话框，请手动输入路径'));
  return new Promise((resolve, reject) => {
    run(command[0], command[1], { timeout: 120000, maxBuffer: 65536 }, (err, stdout, stderr) => {
      if (err) {
        if (!err.killed && (platform === 'darwin' && /\(-128\)/.test(stderr || '') || platform === 'linux' && err.code === 1)) return resolve(null);
        return reject(new Error('无法打开系统文件夹选择器，请手动输入路径'));
      }
      resolve(stdout.trim() || null);
    });
  });
}

module.exports = { chooseFolder };
