const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { Client: SSHClient } = require('ssh2');
const Store = require('electron-store');

const SCREENSHOT_MODE = process.env.TAKE_SCREENSHOT === 'true';

const store = new Store({
  encryptionKey: 'llama-launcher-key-v1'
});

// ─── Mock data for screenshot mode ───────────────────────────────────────────
const SCREENSHOT_MOCK_STATE = {
  masterBinPath: '/opt/llama.cpp/build/bin/llama-server',
  modelPath: '/models/Llama-3.3-70B-Instruct-Q4_K_M.gguf',
  masterPort: '8080',
  masterHost: '0.0.0.0',
  ngl: '99',
  contextSize: '32768',
  ctk: 'q8_0',
  ctv: 'q8_0',
  nParallel: '2',
  flashAttn: 'auto',
  masterExtraFlags: '',
  slaves: [
    {
      id: 'slave_1', label: 'GPU Node 1', ip: '192.168.8.101',
      username: 'ubuntu', password: '',
      binPath: '~/llama.cpp/build/bin/rpc-server', port: '52396', extraFlags: ''
    },
    {
      id: 'slave_2', label: 'GPU Node 2', ip: '192.168.8.102',
      username: 'ubuntu', password: '',
      binPath: '~/llama.cpp/build/bin/rpc-server', port: '52396', extraFlags: ''
    }
  ]
};

let mainWindow;
// Track running processes: { master: ChildProcess|null, slaves: { [id]: SSHClient|null } }
const runningProcesses = {
  master: null,
  slaves: {}
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: SCREENSHOT_MODE ? 1600 : 1400,
    height: SCREENSHOT_MODE ? 950 : 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111111',
      symbolColor: '#888888',
      height: 36
    },
    backgroundColor: '#111111',
    // In screenshot mode show immediately — no wait for user interaction
    show: SCREENSHOT_MODE,
    icon: path.join(__dirname, 'src', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  if (!SCREENSHOT_MODE) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Kill master if running
    if (runningProcesses.master) {
      try { runningProcesses.master.kill('SIGTERM'); } catch (e) {}
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ─── Cleanup on quit ─────────────────────────────────────────────────────────
// Kills master process and sends SIGTERM to all remote rpc-server processes via SSH
function cleanupAllProcesses() {
  // Kill local master
  if (runningProcesses.master) {
    try { runningProcesses.master.kill('SIGTERM'); } catch (e) {}
    runningProcesses.master = null;
  }
  // Kill remote slaves: close SSH streams (sends SIGHUP to remote process)
  // Also attempt an explicit pkill for reliability
  Object.entries(runningProcesses.slaves).forEach(([id, entry]) => {
    if (!entry) return;
    try {
      // Try to send a kill to the remote rpc-server before closing
      const killConn = new SSHClient();
      const creds = entry.creds; // stored at launch time
      if (creds) {
        killConn.on('ready', () => {
          killConn.exec('pkill -f rpc-server', () => { killConn.end(); });
        }).on('error', () => {}).connect(creds);
      }
      entry.stream?.close();
      entry.conn?.end();
    } catch (e) {}
  });
  runningProcesses.slaves = {};
}

app.on('will-quit', () => {
  cleanupAllProcesses();
});

// ─── Settings persistence ───────────────────────────────────────────────────
ipcMain.handle('store:get', (_, key) => store.get(key));
ipcMain.handle('store:set', (_, key, value) => { if (!SCREENSHOT_MODE) store.set(key, value); });
ipcMain.handle('store:getAll', () => SCREENSHOT_MODE ? SCREENSHOT_MOCK_STATE : store.store);

// ─── Screenshot capture ──────────────────────────────────────────────────────
ipcMain.handle('screenshot:capture', async () => {
  if (!SCREENSHOT_MODE || !mainWindow) return { success: false };
  try {
    const image = await mainWindow.webContents.capturePage();
    const outDir = path.join(__dirname, 'docs', 'images');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'launcher_screenshot.png');
    fs.writeFileSync(outPath, image.toPNG());
    console.log(`[screenshot] Saved → ${outPath}`);
    setTimeout(() => app.quit(), 200);
    return { success: true, path: outPath };
  } catch (err) {
    console.error('[screenshot] Error:', err);
    app.quit();
    return { success: false, error: err.message };
  }
});

// ─── Token Logging ───────────────────────────────────────────────────────────
ipcMain.handle('tokens:log', (_, tokensToAdd) => {
  if (SCREENSHOT_MODE || !tokensToAdd) return { success: true };
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const logFile = path.join(logsDir, `token_usage_${year}_${month}.txt`);
    
    // Format: YYYY-MM-DD HH:MM:SS, <tokens>
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8);
    const line = `${dateStr} ${timeStr}, ${tokensToAdd}\n`;
    
    fs.appendFileSync(logFile, line, 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Error logging tokens:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('tokens:getHistory', () => {
  if (SCREENSHOT_MODE) {
    // Return mock data
    return {
      success: true,
      history: {
        '2026-05-17': 12000,
        '2026-05-18': 45000,
        '2026-05-19': 32000,
        '2026-05-20': 56000,
        '2026-05-21': 105000,
        '2026-05-22': 89000,
        '2026-05-23': 24000
      }
    };
  }
  
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) return { success: true, history: {} };
    
    // We need to read files for the current and previous month to get the last 7 days
    const now = new Date();
    const currentMonth = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}_${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    
    const filesToRead = [
      path.join(logsDir, `token_usage_${prevMonth}.txt`),
      path.join(logsDir, `token_usage_${currentMonth}.txt`)
    ];
    
    const history = {};
    
    // Get past 7 dates
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      history[d.toISOString().slice(0, 10)] = 0;
    }
    
    filesToRead.forEach(file => {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        content.split('\n').forEach(line => {
          if (!line.trim()) return;
          const [dt, tokens] = line.split(',');
          if (dt && tokens) {
            const date = dt.split(' ')[0];
            if (history[date] !== undefined) {
              history[date] += parseInt(tokens.trim(), 10) || 0;
            }
          }
        });
      }
    });
    
    return { success: true, history };
  } catch (err) {
    console.error('Error fetching token history:', err);
    return { success: false, error: err.message };
  }
});

// ─── File dialog ─────────────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result.canceled ? null : result.filePaths[0];
});

// ─── Port check (LOCAL) ──────────────────────────────────────────────────────
// READ-ONLY — uses ss to check if a port is in use. Does NOT interact with any running services.
ipcMain.handle('port:checkLocal', (_, port) => {
  return new Promise((resolve) => {
    exec(`ss -tlnp | grep ':${port} '`, (err, stdout) => {
      resolve({ inUse: !!(stdout && stdout.trim().length > 0) });
    });
  });
});

// ─── Port check (REMOTE via SSH) ─────────────────────────────────────────────
// READ-ONLY — connects via SSH and checks ss on remote machine.
ipcMain.handle('port:checkRemote', (_, { host, port, username, password }) => {
  return new Promise((resolve) => {
    const conn = new SSHClient();
    conn.on('ready', () => {
      conn.exec(`ss -tlnp | grep ':${port} '`, (err, stream) => {
        let output = '';
        if (err) { conn.end(); return resolve({ inUse: false, error: err.message }); }
        stream.on('data', (d) => { output += d.toString(); });
        stream.stderr.on('data', () => {});
        stream.on('close', () => {
          conn.end();
          resolve({ inUse: !!(output && output.trim().length > 0) });
        });
      });
    }).on('error', (err) => {
      resolve({ inUse: false, error: err.message });
    }).connect({ host, port: 22, username, password, readyTimeout: 8000 });
  });
});

// ─── Launch Master (LOCAL) ───────────────────────────────────────────────────
ipcMain.handle('master:launch', (_, { command, cwd }) => {
  if (runningProcesses.master) {
    return { success: false, error: 'Master is already running.' };
  }
  try {
    const args = command.split(/\s+/).filter(Boolean);
    const bin = args.shift();
    const proc = spawn(bin, args, { cwd: cwd || path.dirname(bin), shell: false });

    runningProcesses.master = proc;

    proc.stdout.on('data', (data) => {
      mainWindow?.webContents.send('master:output', { text: data.toString(), stream: 'stdout' });
    });
    proc.stderr.on('data', (data) => {
      mainWindow?.webContents.send('master:output', { text: data.toString(), stream: 'stderr' });
    });
    proc.on('close', (code) => {
      runningProcesses.master = null;
      mainWindow?.webContents.send('master:stopped', { code });
    });
    proc.on('error', (err) => {
      runningProcesses.master = null;
      mainWindow?.webContents.send('master:error', { message: err.message });
    });

    return { success: true, pid: proc.pid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Stop Master ─────────────────────────────────────────────────────────────
ipcMain.handle('master:stop', () => {
  if (runningProcesses.master) {
    try {
      runningProcesses.master.kill('SIGTERM');
      runningProcesses.master = null;
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Not running' };
});

// ─── Launch Slave (REMOTE via SSH) ───────────────────────────────────────────
// Uses 'bash -lc' so that ~ expands, PATH is loaded from the user's login shell,
// and environment variables set in .bashrc / .profile are available.
ipcMain.handle('slave:launch', (_, { slaveId, host, username, password, command }) => {
  if (runningProcesses.slaves[slaveId]) {
    return { success: false, error: 'Slave is already running.' };
  }

  // Escape single quotes in command for safe bash -lc wrapping
  const safeCmd = command.replace(/'/g, "'\\''")
  const shellWrapped = `bash -lc '${safeCmd}'`;

  // Store SSH credentials so we can send a kill command on app-quit
  const creds = { host, port: 22, username, password, readyTimeout: 10000 };

  return new Promise((resolve) => {
    const conn = new SSHClient();

    conn.on('ready', () => {
      conn.exec(shellWrapped, (err, stream) => {
        if (err) {
          conn.end();
          delete runningProcesses.slaves[slaveId];
          return resolve({ success: false, error: err.message });
        }

        runningProcesses.slaves[slaveId] = { conn, stream, creds };

        stream.on('data', (data) => {
          mainWindow?.webContents.send('slave:output', { slaveId, text: data.toString(), stream: 'stdout' });
        });
        stream.stderr.on('data', (data) => {
          mainWindow?.webContents.send('slave:output', { slaveId, text: data.toString(), stream: 'stderr' });
        });
        stream.on('close', (code) => {
          conn.end();
          delete runningProcesses.slaves[slaveId];
          mainWindow?.webContents.send('slave:stopped', { slaveId, code });
        });

        resolve({ success: true });
      });
    }).on('error', (err) => {
      delete runningProcesses.slaves[slaveId];
      resolve({ success: false, error: err.message });
    }).connect(creds);
  });
});

// ─── Stop Slave ──────────────────────────────────────────────────────────────
ipcMain.handle('slave:stop', (_, { slaveId }) => {
  const entry = runningProcesses.slaves[slaveId];
  if (entry) {
    try {
      // Send explicit remote kill before closing the connection
      const killConn = new SSHClient();
      if (entry.creds) {
        killConn.on('ready', () => {
          killConn.exec('pkill -f rpc-server', () => { killConn.end(); });
        }).on('error', () => {}).connect(entry.creds);
      }
      entry.stream?.close();
      entry.conn?.end();
      delete runningProcesses.slaves[slaveId];
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Slave not running' };
});

// ─── GPU Stats (LOCAL) ──────────────────────────────────────────────────────
ipcMain.handle('gpu:getStatsLocal', () => {
  return new Promise((resolve) => {
    // utilization.gpu, memory.used, memory.total, power.draw
    const query = 'utilization.gpu,memory.used,memory.total,power.draw';
    exec(`nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits`, (err, stdout) => {
      if (err) return resolve({ success: false, error: err.message });
      const parts = stdout.trim().split(',').map(s => s.trim());
      if (parts.length < 4) return resolve({ success: false, error: 'Invalid output' });
      resolve({
        success: true,
        util: parseInt(parts[0]),
        memUsed: parseInt(parts[1]),
        memTotal: parseInt(parts[2]),
        power: parseFloat(parts[3])
      });
    });
  });
});

// ─── GPU Stats (REMOTE via existing SSH) ─────────────────────────────────────
ipcMain.handle('gpu:getStatsRemote', (_, { slaveId }) => {
  const entry = runningProcesses.slaves[slaveId];
  if (!entry || !entry.conn) return Promise.resolve({ success: false, error: 'Not connected' });

  return new Promise((resolve) => {
    const query = 'utilization.gpu,memory.used,memory.total,power.draw';
    const cmd = `nvidia-smi --query-gpu=${query} --format=csv,noheader,nounits`;
    
    entry.conn.exec(cmd, (err, stream) => {
      if (err) return resolve({ success: false, error: err.message });
      let output = '';
      stream.on('data', (d) => { output += d.toString(); });
      stream.on('close', () => {
        const parts = output.trim().split(',').map(s => s.trim());
        if (parts.length < 4) return resolve({ success: false, error: 'Invalid output' });
        resolve({
          success: true,
          util: parseInt(parts[0]),
          memUsed: parseInt(parts[1]),
          memTotal: parseInt(parts[2]),
          power: parseFloat(parts[3])
        });
      });
    });
  });
});

// ─── SSH Test Connection ──────────────────────────────────────────────────────
ipcMain.handle('ssh:test', (_, { host, username, password }) => {
  return new Promise((resolve) => {
    const conn = new SSHClient();
    conn.on('ready', () => {
      conn.end();
      resolve({ success: true });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    }).connect({ host, port: 22, username, password, readyTimeout: 8000 });
  });
});
