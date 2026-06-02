const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn, execSync } = require('child_process');
const { Client: SSHClient } = require('ssh2');
const Store = require('electron-store');
const http = require('http');
const net = require('net');
const os = require('os');

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

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('context-menu', (event, params) => {
    if (params.linkURL) {
      const { Menu, clipboard } = require('electron');
      const menu = Menu.buildFromTemplate([
        {
          label: 'Open Link',
          click: () => shell.openExternal(params.linkURL)
        },
        {
          label: 'Copy Link Address',
          click: () => clipboard.writeText(params.linkURL)
        }
      ]);
      menu.popup();
    }
  });

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
ipcMain.handle('tokens:log', (_, tokenData) => {
  if (SCREENSHOT_MODE || !tokenData) return { success: true };
  
  let type = 'unknown';
  let count = 0;
  if (typeof tokenData === 'number') {
    count = tokenData;
  } else {
    type = tokenData.type || 'unknown';
    count = tokenData.count || 0;
  }
  
  if (!count) return { success: true };

  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const logFile = path.join(logsDir, `token_usage_${year}_${month}.txt`);
    
    // Format: YYYY-MM-DD HH:MM:SS, <type>, <tokens>
    const dateStr = `${year}-${month}-${String(now.getDate()).padStart(2, '0')}`;
    const timeStr = now.toTimeString().slice(0, 8);
    const line = `${dateStr} ${timeStr}, ${type}, ${count}\n`;
    
    fs.appendFileSync(logFile, line, 'utf8');
    return { success: true };
  } catch (err) {
    console.error('Error logging tokens:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('app:getVersionInfo', () => {
  try {
    const pkg = require('./package.json');
    const branch = require('child_process').execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    return { version: pkg.version, branch: branch };
  } catch(e) {
    return { version: 'unknown', branch: 'unknown' };
  }
});

ipcMain.handle('tokens:getHistory', () => {
  const now = new Date();
  const todayPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (SCREENSHOT_MODE) {
    // Return mock data
    const mockHistory = {};
    for (let i = 167; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      mockHistory[dateStr] = { prompt: Math.floor(Math.random() * 20000), eval: Math.floor(Math.random() * 5000), unknown: 0 };
    }
    return { success: true, history: mockHistory, todayPrompt: 150000, todayEval: 25000 };
  }
  
  try {
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) return { success: true, history: {}, todayPrompt: 0, todayEval: 0 };
    
    const currentMonth = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}_${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    
    const filesToRead = [
      path.join(logsDir, `token_usage_${prevMonth}.txt`),
      path.join(logsDir, `token_usage_${currentMonth}.txt`)
    ];
    
    const history = {};
    let todayPrompt = 0;
    let todayEval = 0;
    
    // Get past 7 days (168 hours) in 15-minute intervals
    for (let i = 168 * 4 - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 15 * 60 * 1000);
      const bucketMin = Math.floor(d.getMinutes() / 15) * 15;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(bucketMin).padStart(2, '0')}`;
      history[dateStr] = { prompt: 0, eval: 0, unknown: 0 };
    }
    
    filesToRead.forEach(file => {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        content.split('\n').forEach(line => {
          if (!line.trim()) return;
          const parts = line.split(',');
          if (parts.length >= 2) {
            const dt = parts[0].trim();
            let type = 'unknown';
            let count = 0;
            
            if (parts.length >= 3) {
              type = parts[1].trim();
              count = parseInt(parts[2].trim(), 10) || 0;
            } else {
              count = parseInt(parts[1].trim(), 10) || 0;
            }
            
            const minPart = dt.length >= 16 ? parseInt(dt.substring(14, 16), 10) : 0;
            const bucketMin = Math.floor(minPart / 15) * 15;
            const dateBucket = dt.substring(0, 13) + ':' + String(bucketMin).padStart(2, '0');
            
            if (history[dateBucket] !== undefined) {
              if (type === 'prompt') history[dateBucket].prompt += count;
              else if (type === 'eval') history[dateBucket].eval += count;
              else history[dateBucket].unknown += count;
            }
            
            if (dt.startsWith(todayPrefix)) {
              if (type === 'prompt' || type === 'unknown') todayPrompt += count;
              if (type === 'eval') todayEval += count;
            }
          }
        });
      }
    });
    
    return { success: true, history, todayPrompt, todayEval };
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
    exec(`lsof -i :${port} | grep LISTEN`, (err, stdout) => {
      if (stdout && stdout.trim().length > 0) {
        const lines = stdout.trim().split('\n');
        const parts = lines[0].trim().split(/\s+/);
        const pName = parts[0];
        const pid = parts[1];
        resolve({ inUse: true, processName: pName, pid: pid });
      } else {
        resolve({ inUse: false });
      }
    });
  });
});

ipcMain.handle('port:killLocal', (_, pid) => {
  return new Promise((resolve) => {
    exec(`kill -9 ${pid}`, (err) => {
      resolve({ success: !err });
    });
  });
});

ipcMain.handle('server:checkHealth', async (_, { host, port }) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      return await res.json();
    }
    return null;
  } catch (e) {
    return null;
  }
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
          const outStr = output.trim();
          if (outStr.length > 0) {
            let pid = null;
            let pName = 'unknown process';
            const match = outStr.match(/users:\(\("([^"]+)",(?:pid=)?(\d+)/);
            if (match) {
              pName = match[1];
              pid = match[2];
            }
            resolve({ inUse: true, processName: pName, pid });
          } else {
            resolve({ inUse: false });
          }
        });
      });
    }).on('error', (err) => {
      resolve({ inUse: false, error: err.message });
    }).connect({ host, port: 22, username, password, readyTimeout: 8000 });
  });
});

ipcMain.handle('port:killRemote', (_, { host, pid, username, password }) => {
  return new Promise((resolve) => {
    const conn = new SSHClient();
    conn.on('ready', () => {
      conn.exec(`kill -9 ${pid}`, (err, stream) => {
        if (err) { conn.end(); return resolve({ success: false, error: err.message }); }
        stream.on('close', () => {
          conn.end();
          resolve({ success: true });
        });
      });
    }).on('error', (err) => {
      resolve({ success: false, error: err.message });
    }).connect({ host, port: 22, username, password, readyTimeout: 8000 });
  });
});

// ─── Launch Master (LOCAL / REMOTE SSH) ──────────────────────────────────────
ipcMain.handle('master:launch', (_, { command, cwd, remoteOpts }) => {
  if (runningProcesses.master) {
    return { success: false, error: 'Master is already running.' };
  }

  if (remoteOpts && remoteOpts.enabled) {
    // Escape single quotes in command for safe bash -lc wrapping
    const safeCmd = command.replace(/'/g, "'\\''");
    const shellWrapped = `bash -lc '${safeCmd}'`;

    const { host, port, username, password } = remoteOpts;
    const creds = { host, port: parseInt(port, 10) || 22, username, password, readyTimeout: 10000 };

    return new Promise((resolve) => {
      const conn = new SSHClient();

      conn.on('ready', () => {
        conn.exec(shellWrapped, { pty: true }, (err, stream) => {
          if (err) {
            conn.end();
            runningProcesses.master = null;
            return resolve({ success: false, error: err.message });
          }

          runningProcesses.master = { conn, stream, creds, isRemote: true };

          stream.on('data', (data) => {
            mainWindow?.webContents.send('master:output', { text: data.toString(), stream: 'stdout' });
          });
          stream.stderr.on('data', (data) => {
            mainWindow?.webContents.send('master:output', { text: data.toString(), stream: 'stderr' });
          });
          stream.on('close', (code) => {
            conn.end();
            runningProcesses.master = null;
            mainWindow?.webContents.send('master:stopped', { code });
          });

          resolve({ success: true });
        });
      }).on('error', (err) => {
        runningProcesses.master = null;
        resolve({ success: false, error: err.message });
      }).connect(creds);
    });
  } else {
    try {
      const args = command.split(/\s+/).filter(Boolean);
      const bin = args.shift();

      let finalBin = bin;
      let finalArgs = args;
      const proc = spawn(finalBin, finalArgs, { cwd: cwd || path.dirname(bin), shell: false });

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
  }
});

// ─── Stop Master ─────────────────────────────────────────────────────────────
ipcMain.handle('master:stop', () => {
  if (runningProcesses.master) {
    try {
      if (runningProcesses.master.isRemote) {
        const entry = runningProcesses.master;
        // Send explicit remote kill before closing the connection
        const killConn = new SSHClient();
        if (entry.creds) {
          killConn.on('ready', () => {
            killConn.exec('pkill -f llama-server', () => { killConn.end(); });
          }).on('error', () => {}).connect(entry.creds);
        }
        entry.stream?.close();
        entry.conn?.end();
      } else {
        runningProcesses.master.kill('SIGTERM');
      }
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

// ─── GPU Stats (LOCAL / REMOTE SSH FOR MASTER) ───────────────────────────────
ipcMain.handle('gpu:getStatsLocal', () => {
  // If master is remote and running, fetch remote GPU stats instead!
  if (runningProcesses.master && runningProcesses.master.isRemote && runningProcesses.master.conn) {
    const entry = runningProcesses.master;
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
  }

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
// ─── Llama Version ────────────────────────────────────────────────────────────
ipcMain.handle('llama:getVersionLocal', async (_, binPath) => {
  return new Promise(resolve => {
    if (!binPath) return resolve({ success: false });
    exec(`"${binPath}" --version || "${binPath}" -v`, (err, stdout, stderr) => {
      const out = (stdout || '').trim() || (stderr || '').trim();
      const buildMatch = out.match(/build\s+(\d+)\s*\(([^)]+)\)/i);
      if (buildMatch) {
         return resolve({ success: true, version: `build ${buildMatch[1]} (${buildMatch[2]})` });
      }
      const firstLine = out.split('\n')[0].trim();
      resolve({ success: true, version: firstLine });
    });
  });
});

ipcMain.handle('llama:getVersionRemote', async (_, req) => {
  return new Promise(resolve => {
    const conn = new SSHClient();
    conn.on('ready', () => {
      const binDir = req.binPath.substring(0, req.binPath.lastIndexOf('/'));
      const llamaServerPath = binDir ? `${binDir}/llama-server` : 'llama-server';
      const cmd = `"${req.binPath}" --version 2>&1 || "${llamaServerPath}" -v 2>&1 || "${llamaServerPath}" --version 2>&1`;

      conn.exec(cmd, (err, stream) => {
        if (err) { conn.end(); return resolve({ success: false }); }
        let out = '';
        stream.on('data', d => out += d.toString())
              .on('stderr', d => out += d.toString())
              .on('close', () => {
                conn.end();
                const buildMatch = out.match(/build\s+(\d+)\s*\(([^)]+)\)/i);
                if (buildMatch) {
                   return resolve({ success: true, version: `build ${buildMatch[1]} (${buildMatch[2]})` });
                }
                const firstLine = out.split('\n')[0].trim();
                resolve({ success: true, version: firstLine });
              });
      });
    }).on('error', () => resolve({ success: false }))
      .connect({ host: req.host, port: req.port || 22, username: req.user, password: req.password });
  });
});

// ─── Broadcast Server ────────────────────────────────────────────────────────
let currentClusterState = {};
let broadcastServer = null;

ipcMain.handle('server:updateState', (_, state) => {
  currentClusterState = state;
});

ipcMain.handle('server:toggle', (_, { enabled, port }) => {
  if (broadcastServer) {
    broadcastServer.close();
    broadcastServer = null;
  }
  if (enabled && port) {
    broadcastServer = http.createServer((req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(currentClusterState));
      } else if (req.url === '/' || req.url === '/index.html') {
        const dashboardPath = path.join(__dirname, 'src', 'dashboard.html');
        fs.readFile(dashboardPath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Dashboard not found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    broadcastServer.listen(port, '0.0.0.0', () => {
      console.log(`Broadcast server listening on 0.0.0.0:${port}`);
    });
  }
  return true;
});

ipcMain.handle('server:findPorts', async () => {
  const checkPort = (port) => {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => resolve(false));
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
    });
  };

  const ports = [];
  let currentPort = 8081;
  while (ports.length < 4 && currentPort < 9000) {
    if (await checkPort(currentPort)) {
      ports.push(currentPort);
    }
    currentPort++;
  }
  return ports;
});

ipcMain.handle('server:getLocalIPs', () => {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
});

// ─── Desktop integration launcher for Linux ──────────────────────────────────
ipcMain.handle('preferences:createDesktopLauncher', async () => {
  if (process.platform !== 'linux') {
    return { success: false, error: 'Only Linux/Ubuntu is supported for this feature.' };
  }

  try {
    const appDir = app.getAppPath();
    
    // 1. Determining node bin dir
    let nodeBinDir = '';
    try {
      const nodePath = execSync('which node').toString().trim();
      nodeBinDir = path.dirname(nodePath);
    } catch (e) {
      // Fallback to checking PATH
      const paths = (process.env.PATH || '').split(path.delimiter);
      for (const p of paths) {
        if (fs.existsSync(path.join(p, 'node'))) {
          nodeBinDir = p;
          break;
        }
      }
    }

    if (!nodeBinDir) {
      nodeBinDir = '/usr/bin';
    }

    // 2. Generating the Wrapper Script (llama-cluster-launcher.sh) in the app directory
    const wrapperPath = path.join(appDir, 'llama-cluster-launcher.sh');
    const electronBin = path.join(appDir, 'node_modules', '.bin', 'electron');
    const wrapperContent = `#!/bin/bash
export PATH="${nodeBinDir}:$PATH"
cd "${appDir}"
"${electronBin}" . --no-sandbox
`;
    
    fs.writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });
    
    // 3. Generating the Desktop Entry (~/.local/share/applications/llama-cluster-launcher.desktop)
    const homeDir = os.homedir();
    const desktopDir = path.join(homeDir, '.local', 'share', 'applications');
    if (!fs.existsSync(desktopDir)) {
      fs.mkdirSync(desktopDir, { recursive: true });
    }
    
    const desktopPath = path.join(desktopDir, 'llama-cluster-launcher.desktop');
    const iconPath = path.join(appDir, 'src', 'logos', 'llama_cluster_icon_v001.png');
    
    const desktopContent = `[Desktop Entry]
Name=Llama Cluster Launcher
Comment=GUI launcher for llama.cpp clustered inference
Exec="${wrapperPath}"
Icon=${iconPath}
Terminal=false
Type=Application
Categories=Development;Utility;
StartupNotify=true
`;

    fs.writeFileSync(desktopPath, desktopContent, 'utf8');
    
    // 4. Refreshing Desktop Database
    try {
      execSync(`update-desktop-database "${desktopDir}"`);
    } catch (dbErr) {
      console.warn('Failed to update-desktop-database:', dbErr);
    }

    return { success: true, path: desktopPath };
  } catch (err) {
    console.error('Error creating desktop launcher:', err);
    return { success: false, error: err.message };
  }
});
