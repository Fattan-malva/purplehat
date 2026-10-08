// Purplehat launcher: jalankan backend (FastAPI) + frontend (Express) sekaligus
const { spawn } = require('child_process');
const path = require('path');

const isWin = process.platform === 'win32';
const pythonCmd = isWin ? 'python' : 'python3';

function run(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd: path.join(__dirname, cwd), shell: false, windowsHide: false });
  child.stdout.on('data', d => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', d => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', code => console.log(`[${name}] exited with ${code}`));
  return child;
}

const backend = run('API', pythonCmd, ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'], 'backend');
const frontend = run('WEB', process.execPath, ['server.js'], 'server');

function shutdown() {
  backend.kill();
  frontend.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Purplehat starting...');
console.log('- Player/Controller: http://localhost:3000/');
console.log('- Backend API: http://localhost:8000/');
console.log('- Untuk tunneling: set PUBLIC_URL atau gunakan ngrok/cloudflare tunnel ke port 3000 (QR & link otomatis ikut host publik)');
