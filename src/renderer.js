/* renderer.js — Llama Cluster Launcher UI logic */

// ─── State ──────────────────────────────────────────────────────────────────
let slaves = [];           // Array of slave config objects
let masterRunning = false;
let slaveCounter = 0;
let todayTotalTokens = 0;
let tokenChart = null;
let masterGpuStats = null;

// ─── Initialise ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadSettings();
    setupMasterListeners();
    setupMasterIPC();
    setupSlaveIPC();
    setupTooltips();
    updateMasterPreview();
    renderRpcField();
    initTokenChart();
    updateMasterVersion();

    document.querySelectorAll('.collapse-header').forEach(header => {
      header.addEventListener('click', () => {
        const parent = header.closest('.form-section') || header.closest('.terminal-container');
        if (parent) parent.classList.toggle('collapsed');
      });
    });

    // Panel collapse buttons
    const masterCollapseBtn = document.getElementById('masterCollapseBtn');
    if (masterCollapseBtn) {
      masterCollapseBtn.addEventListener('click', () => {
        document.getElementById('masterPanel').classList.toggle('panel-collapsed');
      });
    }
    const slaveCollapseBtn = document.getElementById('slaveCollapseBtn');
    if (slaveCollapseBtn) {
      slaveCollapseBtn.addEventListener('click', () => {
        document.getElementById('slavePanel').classList.toggle('panel-collapsed');
      });
    }

    await setupBroadcastServer();
    setupPreferences();
    initPresets();
    setInterval(syncClusterState, 2000);
  } catch (err) {
    console.error('[init] FATAL ERROR during DOMContentLoaded:', err);
  }
});

// ─── Version checking ────────────────────────────────────────────────────────
async function updateMasterVersion() {
  const bin = document.getElementById('masterBinPath').value.trim() || './llama-server';
  const res = await window.api.getLlamaVersionLocal(bin);
  const el = document.getElementById('masterVersion');
  if (el) {
    el.textContent = res.success && res.version ? `(${res.version})` : '';
  }
}

// ─── Persist helpers ─────────────────────────────────────────────────────────
async function loadSettings() {
  const saved = await window.api.storeGetAll();
  if (!saved) return;

  setIfExists('masterBinPath', saved.masterBinPath);
  setIfExists('modelPath', saved.modelPath);
  setIfExists('masterPort', saved.masterPort);
  setIfExists('masterHost', saved.masterHost);
  setIfExists('ngl', saved.ngl);
  setIfExists('contextSize', saved.contextSize);
  setIfExists('ctk', saved.ctk);
  setIfExists('ctv', saved.ctv);
  setIfExists('nParallel', saved.nParallel);
  setIfExists('masterExtraFlags', saved.masterExtraFlags);
  setIfExists('flashAttn', saved.flashAttn);

  if (saved.modelPath) updateModelChip(saved.modelPath);
  if (saved.ngl !== undefined) {
    const nglSlider = document.getElementById('nglSlider');
    if (nglSlider) nglSlider.value = saved.ngl;
  }

  // Load slaves
  if (saved.slaves && Array.isArray(saved.slaves)) {
    saved.slaves.forEach(cfg => addSlaveCard(cfg));
  }

  // Load broadcast
  if (saved.broadcastEnable) {
    document.getElementById('broadcastEnable').checked = true;
  }

  // Load solo and remote master settings
  if (saved.soloModeEnable !== undefined) {
    const soloCb = document.getElementById('soloModeEnable');
    if (soloCb) soloCb.checked = saved.soloModeEnable;
  }
  if (saved.remoteMasterEnable !== undefined) {
    const remoteCb = document.getElementById('remoteMasterEnable');
    if (remoteCb) {
      remoteCb.checked = saved.remoteMasterEnable;
      const credsDiv = document.getElementById('remoteMasterCreds');
      if (credsDiv) credsDiv.style.display = saved.remoteMasterEnable ? 'grid' : 'none';
    }
  }
  setIfExists('masterRemoteHost', saved.masterRemoteHost);
  setIfExists('masterRemotePort', saved.masterRemotePort || '22');
  setIfExists('masterRemoteUser', saved.masterRemoteUser);
  setIfExists('masterRemotePass', saved.masterRemotePass);
}

function setIfExists(id, value) {
  if (value === undefined || value === null) return;
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function saveSetting(key, value) {
  window.api.storeSet(key, value);
}

function saveAllSlaves() {
  const configs = slaves.map(s => s.config);
  saveSetting('slaves', configs);
}

// ─── Broadcast Server Sync ───────────────────────────────────────────────────
async function setupBroadcastServer() {
  const ports = await window.api.findAvailablePorts();
  const select = document.getElementById('broadcastPort');
  select.innerHTML = '';

  const saved = await window.api.storeGetAll();
  const savedPort = saved && saved.broadcastPort ? parseInt(saved.broadcastPort, 10) : null;

  if (savedPort && !ports.includes(savedPort)) {
    ports.unshift(savedPort);
  }

  ports.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  });

  if (savedPort) {
    select.value = savedPort;
  } else if (ports.length > 0) {
    select.value = ports[0];
  }

  const toggleServer = async () => {
    const enabled = document.getElementById('broadcastEnable').checked;
    const port = parseInt(document.getElementById('broadcastPort').value, 10);
    saveSetting('broadcastEnable', enabled);
    saveSetting('broadcastPort', port);
    window.api.toggleBroadcastServer(enabled, port);

    const linksDiv = document.getElementById('broadcastLinks');
    if (enabled && port) {
      const ips = await window.api.getLocalIPs();
      const ipList = ips.map(ip => `http://${ip}:${port}`).join('<br>');
      linksDiv.innerHTML = `Available at:<br>${ipList}`;
      linksDiv.style.display = 'block';
    } else {
      linksDiv.style.display = 'none';
    }
  };

  document.getElementById('broadcastEnable').addEventListener('change', toggleServer);
  document.getElementById('broadcastPort').addEventListener('change', toggleServer);

  // Initial toggle
  toggleServer();
}

function syncClusterState() {
  const state = {
    master: {
      running: masterRunning,
      tokensToday: todayTotalTokens,
      port: document.getElementById('masterPort').value,
      host: document.getElementById('masterHost').value,
      gpuStats: masterGpuStats
    },
    slaves: slaves.map(s => ({
      id: s.config.id,
      label: s.config.label,
      ip: s.config.ip,
      running: s.running,
      gpuStats: s.lastGpuStats || null
    }))
  };
  window.api.updateClusterState(state);
}

// ─── Master listeners ─────────────────────────────────────────────────────────
function setupMasterListeners() {
  const liveFields = [
    'masterBinPath','modelPath','masterPort','masterHost',
    'ngl','contextSize','ctk','ctv','nParallel','masterExtraFlags','flashAttn'
  ];

  liveFields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      updateMasterPreview();
      saveSetting(id, el.value);
    });
    el.addEventListener('change', () => {
      updateMasterPreview();
      saveSetting(id, el.value);
    });
  });



  // NGL slider sync
  const nglSlider = document.getElementById('nglSlider');
  const nglInput  = document.getElementById('ngl');
  nglSlider.addEventListener('input', () => {
    nglInput.value = nglSlider.value;
    updateMasterPreview();
    saveSetting('ngl', nglSlider.value);
  });
  nglInput.addEventListener('input', () => {
    const v = Math.min(99, Math.max(0, parseInt(nglInput.value) || 0));
    nglSlider.value = v;
    nglInput.value = v;
    updateMasterPreview();
    saveSetting('ngl', v);
  });

  // File browsers
  document.getElementById('masterBinBrowse').addEventListener('click', async () => {
    const file = await window.api.openFile({
      title: 'Select llama-server binary',
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['*'] }]
    });
    if (file) {
      document.getElementById('masterBinPath').value = file;
      saveSetting('masterBinPath', file);
      updateMasterPreview();
      updateMasterVersion();
    }
  });

  document.getElementById('modelBrowse').addEventListener('click', async () => {
    const file = await window.api.openFile({
      title: 'Select model (.gguf)',
      properties: ['openFile'],
      filters: [{ name: 'GGUF models', extensions: ['gguf'] }]
    });
    if (file) {
      document.getElementById('modelPath').value = file;
      saveSetting('modelPath', file);
      updateModelChip(file);
      updateMasterPreview();
    }
  });

  // Port check on blur — READ-ONLY, does not affect any running service
  document.getElementById('masterBinPath').addEventListener('input', () => {
  saveSetting('masterBinPath', document.getElementById('masterBinPath').value);
  updateMasterPreview();
});
document.getElementById('masterBinPath').addEventListener('blur', updateMasterVersion);    
  document.getElementById('masterPort').addEventListener('blur', async () => {
    const port = parseInt(document.getElementById('masterPort').value);
    if (!port) return;
    const statusEl = document.getElementById('masterPortStatus');
    statusEl.className = 'port-status checking';
    const result = await window.api.checkPortLocal(port);
    statusEl.className = `port-status ${result.inUse ? 'used' : 'free'}`;
    statusEl.title = result.inUse ? `Port ${port} is already in use!` : `Port ${port} is available`;
  });

  // Copy command
  document.getElementById('masterCopyCmd').addEventListener('click', async () => {
    const text = document.getElementById('masterCmdPreview').textContent;
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('masterCopyCmd');
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '⎘ Copy'; btn.classList.remove('copied'); }, 1800);
  });

  // Clear terminal
  document.getElementById('masterClearTerm').addEventListener('click', () => {
    document.getElementById('masterTerminal').innerHTML = '';
  });

  // Launch / Stop
  document.getElementById('masterLaunchBtn').addEventListener('click', handleMasterLaunch);

  // Execution Mode Listeners
  const execFields = ['masterRemoteHost', 'masterRemotePort', 'masterRemoteUser', 'masterRemotePass'];
  execFields.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        saveSetting(id, el.value);
      });
    }
  });

  const soloCb = document.getElementById('soloModeEnable');
  if (soloCb) {
    soloCb.addEventListener('change', () => {
      updateMasterPreview();
      saveSetting('soloModeEnable', soloCb.checked);
    });
  }

  const remoteCb = document.getElementById('remoteMasterEnable');
  if (remoteCb) {
    remoteCb.addEventListener('change', () => {
      const credsDiv = document.getElementById('remoteMasterCreds');
      if (credsDiv) credsDiv.style.display = remoteCb.checked ? 'grid' : 'none';
      saveSetting('remoteMasterEnable', remoteCb.checked);
    });
  }
}

// ─── Master command preview ───────────────────────────────────────────────────
function buildMasterCommand() {
  const bin     = document.getElementById('masterBinPath').value.trim() || './llama-server';
  const model   = document.getElementById('modelPath').value.trim();
  const port    = document.getElementById('masterPort').value.trim();
  const host    = document.getElementById('masterHost').value.trim();
  const ngl     = document.getElementById('ngl').value.trim();
  const ctx     = document.getElementById('contextSize').value;
  const ctk     = document.getElementById('ctk').value;
  const ctv     = document.getElementById('ctv').value;
  const npar    = document.getElementById('nParallel').value.trim();
  const extra   = document.getElementById('masterExtraFlags').value.trim();
  const isSolo  = document.getElementById('soloModeEnable').checked;
  const rpc     = isSolo ? '' : document.getElementById('rpcAddresses').value.trim();
  const flashAttn = document.getElementById('flashAttn').value;

  let cmd = bin;
  if (model)  cmd += ` -m ${model}`;
  if (port)   cmd += ` --port ${port}`;
  if (host)   cmd += ` --host ${host}`;
  if (ngl)    cmd += ` -ngl ${ngl}`;
  if (rpc)    cmd += ` --rpc ${rpc}`;
  if (ctx)    cmd += ` -c ${ctx}`;
  if (ctk)    cmd += ` -ctk ${ctk}`;
  if (ctv)    cmd += ` -ctv ${ctv}`;
  if (npar)   cmd += ` -np ${npar}`;
  if (flashAttn) cmd += ` --flash-attn ${flashAttn}`;
  if (extra)  cmd += ` ${extra}`;

  return cmd;
}

function updateMasterPreview() {
  document.getElementById('masterCmdPreview').textContent = buildMasterCommand();
}

function updateModelChip(filePath) {
  const chip = document.getElementById('modelChip');
  if (!filePath) { chip.style.display = 'none'; return; }
  const name = filePath.split('/').pop();
  chip.textContent = '🤖 ' + name;
  chip.style.display = 'inline-flex';
}

// ─── Master launch/stop ───────────────────────────────────────────────────────
async function handleMasterLaunch() {
  const btn = document.getElementById('masterLaunchBtn');
  const icon = btn.querySelector('.btn-launch-icon');

  if (masterRunning) {
    // Stop
    const res = await window.api.stopMaster();
    if (res.success) {
      setMasterStatus('stopped');
      logMaster('⏹ Master stopped.', 'system');
    } else {
      logMaster(`Error stopping: ${res.error}`, 'warn');
    }
    return;
  }

  // Port check before launch — read-only
  const portEl = document.getElementById('masterPort');
  const port = parseInt(portEl.value);
  
  const isRemote = document.getElementById('remoteMasterEnable').checked;
  let portCheck;
  if (isRemote) {
    const host = document.getElementById('masterRemoteHost').value.trim();
    const username = document.getElementById('masterRemoteUser').value.trim();
    const password = document.getElementById('masterRemotePass').value.trim();
    portCheck = await window.api.checkPortRemote({ host, port, username, password });
  } else {
    portCheck = await window.api.checkPortLocal(port);
  }

  if (portCheck.inUse) {
    logMaster(`❌ Port ${port} is already in use. Please choose a different port.`, 'warn');
    document.getElementById('masterPortStatus').className = 'port-status used';
    return;
  }

  const command = buildMasterCommand();
  if (!command) { logMaster('No command to run.', 'warn'); return; }

  setMasterStatus('starting');
  logMaster(`▶ Launching: ${command}`, 'info');

  const remoteOpts = {
    enabled: isRemote,
    host: document.getElementById('masterRemoteHost').value.trim(),
    port: document.getElementById('masterRemotePort').value.trim() || '22',
    username: document.getElementById('masterRemoteUser').value.trim(),
    password: document.getElementById('masterRemotePass').value.trim()
  };

  const result = await window.api.launchMaster({ command, remoteOpts });
  if (result.success) {
    masterRunning = true;
    setMasterStatus('running');
    logMaster(`✓ Master started (PID ${result.pid || 'remote'})`, 'success');
  } else {
    setMasterStatus('error');
    logMaster(`❌ Failed to launch: ${result.error}`, 'stderr');
  }
}

function setMasterStatus(status) {
  const orb   = document.getElementById('masterOrb');
  const badge = document.getElementById('masterStatusBadge');
  const btn   = document.getElementById('masterLaunchBtn');
  const icon  = btn.querySelector('.btn-launch-icon');

  orb.className = `status-orb ${status === 'stopped' ? '' : status}`;
  badge.className = `status-badge ${status === 'stopped' ? '' : status}`;

  const labels = { stopped:'Stopped', starting:'Starting…', running:'Running', error:'Error' };
  badge.textContent = labels[status] || status;

  if (status === 'running') {
    btn.classList.add('running');
    icon.textContent = '■';
    btn.querySelector('span:last-child') || (btn.lastChild.textContent = '');
    btn.innerHTML = `<span class="btn-launch-icon">■</span> Stop Master`;
    masterRunning = true;
    document.getElementById('masterGpuMonitor').style.display = 'flex';
    
    const host = document.getElementById('masterHost').value;
    const port = document.getElementById('masterPort').value;
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    document.getElementById('masterTitleText').textContent = `${displayHost}:${port}`;
  } else {
    btn.classList.remove('running');
    btn.innerHTML = `<span class="btn-launch-icon">▶</span> Launch Master`;
    masterRunning = false;
    document.getElementById('masterGpuMonitor').style.display = 'none';
    document.getElementById('masterTitleText').textContent = 'Master Node';
  }
}

// Buffer for incomplete terminal lines
let masterTerminalBuffer = '';

// ─── Master IPC callbacks ─────────────────────────────────────────────────────
function setupMasterIPC() {
  window.api.onMasterOutput(({ text, stream }) => {
    masterTerminalBuffer += text;
    
    // Process all complete lines
    let newlineIndex;
    while ((newlineIndex = masterTerminalBuffer.indexOf('\n')) !== -1) {
      let line = masterTerminalBuffer.slice(0, newlineIndex);
      masterTerminalBuffer = masterTerminalBuffer.slice(newlineIndex + 1);
      
      // Handle carriage returns (\r) by only keeping the text after the last \r
      const lastCrIndex = line.lastIndexOf('\r');
      if (lastCrIndex !== -1) {
        line = line.slice(lastCrIndex + 1);
      }
      
      if (!line) continue;
      
      const cls = stream === 'stderr' ? 'stderr' : detectLineClass(line);
      logMaster(line, cls);
      
      // Parse token usage from llama.cpp output (supporting multiple timing format variations)
      // We ONLY match 'total time' to prevent triple counting.
      // llama-server outputs the same token count in `total time`, `slot release`, and JSON logs.
      const tokenMatch = line.match(/total time\s*=\s*[\d.]+\s*ms\s*\/\s*(\d+)\s*tokens?/i);
      if (tokenMatch) {
        const tokensUsed = parseInt(tokenMatch[1], 10);
        if (tokensUsed > 0) {
          todayTotalTokens += tokensUsed;
          document.getElementById('liveTokenCount').textContent = todayTotalTokens.toLocaleString();
          window.api.logTokens(tokensUsed);
          
          if (tokenChart && tokenChart.data.datasets[0].data.length > 0) {
            const len = tokenChart.data.datasets[0].data.length;
            tokenChart.data.datasets[0].data[len - 1] = todayTotalTokens;
            tokenChart.update();
          }
        }
      }
    }
  });

  window.api.onMasterStopped(({ code }) => {
    setMasterStatus('stopped');
    logMaster(`⏹ Process exited (code ${code})`, 'system');
  });

  window.api.onMasterError(({ message }) => {
    setMasterStatus('error');
    logMaster(`❌ ${message}`, 'stderr');
  });
}

function logMaster(text, cls = 'stdout') {
  const term = document.getElementById('masterTerminal');
  const line = document.createElement('p');
  line.className = `term-line ${cls}`;
  line.textContent = text;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

// ─── Slave nodes ──────────────────────────────────────────────────────────────
document.getElementById('addSlaveBtn').addEventListener('click', () => {
  addSlaveCard();
  document.getElementById('slaveEmpty').style.display = 'none';
});

function addSlaveCard(cfg = {}) {
  const id = 'slave_' + (++slaveCounter);
  const slaveState = {
    id,
    config: {
      id,
      label:    cfg.label    || `Node ${slaveCounter}`,
      ip:       cfg.ip       || '',
      username: cfg.username || '',
      password: cfg.password || '',
      binPath:  cfg.binPath  || '~/llama.cpp/build/bin/rpc-server',
      port:     cfg.port     || '52396',
      extraFlags: cfg.extraFlags || ''
    },
    running: false
  };
  slaves.push(slaveState);

  const card = buildSlaveCard(slaveState);
  document.getElementById('slaveList').appendChild(card);
  document.getElementById('slaveEmpty').style.display = 'none';

  renderRpcField();
  saveAllSlaves();
  
  if (cfg.ip && cfg.username && cfg.binPath) {
    updateSlaveVersion(id);
  }
}

async function updateSlaveVersion(id) {
  const state = slaves.find(s => s.id === id);
  if (!state) return;
  const cfg = state.config;
  const vRes = await window.api.getLlamaVersionRemote({
    host: cfg.ip, username: cfg.username, password: cfg.password, binPath: cfg.binPath
  });
  const vEl = document.getElementById(`version_${id}`);
  if (vEl) {
    vEl.textContent = vRes.success && vRes.version ? `(${vRes.version})` : '';
  }
}

function buildSlaveCard(state) {
  const { id, config } = state;

  const card = document.createElement('div');
  card.className = 'slave-card';
  card.id = `card_${id}`;

  card.innerHTML = `
    <div class="slave-card-header" id="header_${id}">
      <div class="slave-header-top">
        <div class="status-orb" id="orb_${id}"></div>
        <input class="slave-label-input" id="label_${id}" type="text"
          placeholder="Node name" value="${esc(config.label)}" />
        <span class="slave-run-label" id="runLabel_${id}" style="display: none; font-weight: 700; font-size: 13px; color: var(--text-primary);"></span>
        <span id="version_${id}" style="font-size: 11px; color: var(--text-muted); margin-left: 10px; font-weight: normal; vertical-align: middle;"></span>
        <span class="collapse-arrow" id="arrow_${id}" style="margin-left: auto;">▾</span>
      </div>
      <div class="slave-header-actions">
        <span class="slave-status-text" id="statusText_${id}">Stopped</span>
        <button class="btn-ssh-test" id="sshTest_${id}">Test SSH</button>
        <button class="btn-slave-launch" id="launch_${id}">▶ Launch</button>
        <button class="btn-slave-remove" id="remove_${id}" title="Remove node">✕</button>
      </div>
    </div>

    <div class="slave-card-body">
      <!-- SSH credentials -->
      <div class="slave-fields-row">
        <div class="slave-field-group">
          <div class="slave-field-label">IP Address
            <span class="help-tip" data-tip="The remote machine's IP. Also used as the -H argument for rpc-server (the address it listens on).">?</span>
          </div>
          <input type="text" id="ip_${id}" class="field-input mono" placeholder="192.168.8.2" value="${esc(config.ip)}" />
        </div>
        <div class="slave-field-group">
          <div class="slave-field-label">SSH Username</div>
          <input type="text" id="user_${id}" class="field-input" placeholder="ubuntu" value="${esc(config.username)}" />
        </div>
      </div>
      <div class="slave-fields-row">
        <div class="slave-field-group">
          <div class="slave-field-label">SSH Password</div>
          <input type="password" id="pass_${id}" class="field-input" placeholder="••••••••" value="${esc(config.password)}" autocomplete="new-password" />
        </div>
        <div class="slave-field-group">
          <div class="slave-field-label">rpc-server path (remote)</div>
          <input type="text" id="bin_${id}" class="field-input mono" placeholder="~/llama.cpp/build/bin/rpc-server" value="${esc(config.binPath)}" />
        </div>
      </div>
      <!-- RPC config & Extra flags -->
      <div class="slave-fields-row">
        <div class="slave-field-group">
          <div class="slave-field-label">
            RPC Port (-p)
            <span class="help-tip" data-tip="Port rpc-server listens on. Must match the port in master's --rpc flag (e.g. 52396). Checked on the remote machine via SSH before launch.">?</span>
          </div>
          <div class="port-row">
            <input type="number" id="port_${id}" class="field-input" value="${esc(config.port)}" min="1024" max="65535" />
            <span class="port-status" id="portStatus_${id}" title="Remote port status"></span>
          </div>
        </div>
        <div class="slave-field-group">
          <div class="slave-field-label">Additional Flags</div>
          <input type="text" id="extra_${id}" class="field-input mono" placeholder="e.g. --mem-base 0" value="${esc(config.extraFlags)}" />
        </div>
      </div>
      <!-- Command preview -->
      <div class="slave-cmd-row">
        <div class="slave-cmd-preview" id="cmdPreview_${id}"></div>
        <button class="btn-copy" id="copy_${id}" title="Copy command">⎘</button>
      </div>
      <!-- Terminal -->
      <div class="slave-terminal-wrap">
        <div class="terminal-header">
          <span class="terminal-title">Output</span>
          <button class="btn-clear-term" id="clearTerm_${id}">Clear</button>
        </div>
        <div class="slave-terminal" id="term_${id}"></div>
      </div>
    </div><!-- /.slave-card-body -->

    <div class="gpu-monitor" id="gpuMonitor_${id}" style="display:none">
      <div class="gpu-stat-item">
        <div class="gpu-dial-wrap">
          <svg class="gpu-dial" viewBox="0 0 36 36">
            <path class="dial-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="dial-fill" id="gpuUtilFill_${id}" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <span class="dial-val" id="gpuUtilVal_${id}">0%</span>
        </div>
        <label class="gpu-stat-label">Util</label>
      </div>
      <div class="gpu-stat-item">
        <div class="gpu-dial-wrap">
          <svg class="gpu-dial" viewBox="0 0 36 36">
            <path class="dial-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="dial-fill" id="gpuMemFill_${id}" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <span class="dial-val" id="gpuMemVal_${id}">0/0</span>
        </div>
        <label class="gpu-stat-label">VRAM</label>
      </div>
      <div class="gpu-stat-item">
        <div class="gpu-dial-wrap">
          <svg class="gpu-dial" viewBox="0 0 36 36">
            <path class="dial-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="dial-fill" id="gpuPowerFill_${id}" stroke-dasharray="0, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <span class="dial-val" id="gpuPowerVal_${id}">0W</span>
        </div>
        <label class="gpu-stat-label">Power</label>
      </div>
    </div>
  `;

  // ── Wire up events ──
  const liveInputs = ['ip','user','pass','bin','port','extra'];
  liveInputs.forEach(field => {
    const el = card.querySelector(`#${field}_${id}`);
    if (!el) return;
    el.addEventListener('input', () => { syncSlaveConfig(state, card); });
    el.addEventListener('change', () => { syncSlaveConfig(state, card); });
  });

  // Label
  card.querySelector(`#label_${id}`).addEventListener('input', (e) => {
    state.config.label = e.target.value;
    saveAllSlaves();
  });

  // Collapse header (click on top row only, not action buttons)
  card.querySelector(`#header_${id}`).addEventListener('click', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    if (e.target.closest('.slave-header-actions')) return;
    card.classList.toggle('collapsed');
  });

  // Remove
  card.querySelector(`#remove_${id}`).addEventListener('click', () => {
    if (state.running) {
      window.api.stopSlave({ slaveId: id });
    }
    card.remove();
    slaves = slaves.filter(s => s.id !== id);
    renderRpcField();
    saveAllSlaves();
    if (slaves.length === 0) document.getElementById('slaveEmpty').style.display = 'flex';
  });

  // SSH Test
  card.querySelector(`#sshTest_${id}`).addEventListener('click', async () => {
    const btn = card.querySelector(`#sshTest_${id}`);
    const cfg = state.config;
    btn.textContent = 'Testing…';
    btn.className = 'btn-ssh-test';
    const result = await window.api.testSSH({ host: cfg.ip, username: cfg.username, password: cfg.password });
    if (result.success) {
      btn.textContent = '✓ Connected';
      btn.className = 'btn-ssh-test ok';
      logSlave(id, '✓ SSH connection successful', 'success');
      
      const vRes = await window.api.getLlamaVersionRemote({
        host: cfg.ip, username: cfg.username, password: cfg.password, binPath: cfg.binPath
      });
      const vEl = card.querySelector(`#version_${id}`);
      if (vEl) {
        vEl.textContent = vRes.success && vRes.version ? `(${vRes.version})` : '';
      }
    } else {
      btn.textContent = '✗ Failed';
      btn.className = 'btn-ssh-test fail';
      logSlave(id, `✗ SSH failed: ${result.error}`, 'stderr');
    }
    setTimeout(() => { btn.textContent = 'Test SSH'; btn.className = 'btn-ssh-test'; }, 4000);
  });

  // Port check on blur
  card.querySelector(`#port_${id}`).addEventListener('blur', async () => {
    const cfg = state.config;
    if (!cfg.ip || !cfg.username || !cfg.password) return;
    const portStatus = card.querySelector(`#portStatus_${id}`);
    portStatus.className = 'port-status checking';
    const result = await window.api.checkPortRemote({
      host: cfg.ip, port: cfg.port, username: cfg.username, password: cfg.password
    });
    portStatus.className = `port-status ${result.inUse ? 'used' : 'free'}`;
    portStatus.title = result.inUse ? `Port ${cfg.port} is in use on remote!` : `Port ${cfg.port} is available`;
    if (result.error) { portStatus.className = 'port-status'; portStatus.title = `SSH error: ${result.error}`; }
  });

  // Launch
  card.querySelector(`#launch_${id}`).addEventListener('click', () => handleSlaveLaunch(state, card));

  // Copy command
  card.querySelector(`#copy_${id}`).addEventListener('click', async () => {
    const text = card.querySelector(`#cmdPreview_${id}`).textContent;
    await navigator.clipboard.writeText(text);
    const btn = card.querySelector(`#copy_${id}`);
    btn.textContent = '✓';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '⎘'; btn.classList.remove('copied'); }, 1800);
  });

  // Clear terminal
  card.querySelector(`#clearTerm_${id}`).addEventListener('click', () => {
    card.querySelector(`#term_${id}`).innerHTML = '';
  });

  syncSlaveConfig(state, card);
  return card;
}

function syncSlaveConfig(state, card) {
  const id = state.id;
  state.config.ip        = card.querySelector(`#ip_${id}`).value.trim();
  state.config.username  = card.querySelector(`#user_${id}`).value.trim();
  state.config.password  = card.querySelector(`#pass_${id}`).value;
  state.config.binPath   = card.querySelector(`#bin_${id}`).value.trim();
  state.config.port      = card.querySelector(`#port_${id}`).value.trim();
  state.config.extraFlags= card.querySelector(`#extra_${id}`).value.trim();

  // Update command preview
  card.querySelector(`#cmdPreview_${id}`).textContent = buildSlaveCommand(state.config);

  renderRpcField();
  saveAllSlaves();
}

function buildSlaveCommand(cfg) {
  let cmd = cfg.binPath || '~/llama.cpp/build/bin/rpc-server';
  if (cfg.ip)   cmd += ` -H ${cfg.ip}`;   // -H = this machine's own IP, auto-derived from the IP field
  if (cfg.port) cmd += ` -p ${cfg.port}`;
  if (cfg.extraFlags) cmd += ` ${cfg.extraFlags}`;
  return cmd;
}

// ─── Slave launch/stop ────────────────────────────────────────────────────────
async function handleSlaveLaunch(state, card) {
  const { id, config } = state;
  const launchBtn = card.querySelector(`#launch_${id}`);

  if (state.running) {
    await window.api.stopSlave({ slaveId: id });
    setSlaveStatus(state, card, 'stopped');
    logSlave(id, '⏹ Slave stopped.', 'system');
    return;
  }

  if (!config.ip || !config.username || !config.password) {
    logSlave(id, '❌ Please fill in IP, username, and password.', 'warn');
    return;
  }

  const command = buildSlaveCommand(config);
  setSlaveStatus(state, card, 'starting');
  logSlave(id, `▶ Connecting to ${config.username}@${config.ip} and running: ${command}`, 'info');

  const result = await window.api.launchSlave({
    slaveId: id,
    host: config.ip,
    username: config.username,
    password: config.password,
    command
  });

  if (result.success) {
    state.running = true;
    setSlaveStatus(state, card, 'running');
    logSlave(id, `✓ rpc-server launched on ${config.ip}`, 'success');
  } else {
    setSlaveStatus(state, card, 'error');
    logSlave(id, `❌ ${result.error}`, 'stderr');
  }
}

function setSlaveStatus(state, card, status) {
  const id = state.id;
  const orb = card.querySelector(`#orb_${id}`);
  const txt = card.querySelector(`#statusText_${id}`);
  const btn = card.querySelector(`#launch_${id}`);
  const monitor = card.querySelector(`#gpuMonitor_${id}`);

  orb.className = `status-orb ${status === 'stopped' ? '' : status}`;
  card.className = `slave-card ${status === 'stopped' ? '' : status}`;

  const labels = { stopped:'Stopped', starting:'Connecting…', running:'Running', error:'Error' };
  txt.textContent = labels[status] || status;

  if (status === 'running') {
    btn.className = 'btn-slave-launch running';
    btn.textContent = '■ Stop';
    state.running = true;
    if (monitor) monitor.style.display = 'flex';
    
    const labelInput = card.querySelector(`#label_${id}`);
    const runLabel = card.querySelector(`#runLabel_${id}`);
    if (labelInput && runLabel) {
      labelInput.style.display = 'none';
      runLabel.textContent = `${state.config.ip}:${state.config.port}`;
      runLabel.style.display = 'inline';
    }
  } else {
    btn.className = 'btn-slave-launch';
    btn.textContent = '▶ Launch';
    state.running = false;
    if (monitor) monitor.style.display = 'none';
    
    const labelInput = card.querySelector(`#label_${id}`);
    const runLabel = card.querySelector(`#runLabel_${id}`);
    if (labelInput && runLabel) {
      labelInput.style.display = 'inline-block';
      runLabel.style.display = 'none';
    }
  }
}

// ─── Slave IPC callbacks ──────────────────────────────────────────────────────
function setupSlaveIPC() {
  window.api.onSlaveOutput(({ slaveId, text, stream }) => {
    text.split('\n').forEach(line => {
      if (!line) return;
      const cls = stream === 'stderr' ? 'stderr' : detectLineClass(line);
      logSlave(slaveId, line, cls);
    });
  });

  window.api.onSlaveStopped(({ slaveId, code }) => {
    const state = slaves.find(s => s.id === slaveId);
    const card  = document.getElementById(`card_${slaveId}`);
    if (state && card) setSlaveStatus(state, card, 'stopped');
    logSlave(slaveId, `⏹ Process exited (code ${code})`, 'system');
  });
}

function logSlave(slaveId, text, cls = 'stdout') {
  const term = document.getElementById(`term_${slaveId}`);
  if (!term) return;
  const line = document.createElement('p');
  line.className = `term-line ${cls}`;
  line.textContent = text;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

// ─── RPC field (auto-filled) ──────────────────────────────────────────────────
function renderRpcField() {
  const rpcEl = document.getElementById('rpcAddresses');
  const addrs = slaves
    .filter(s => s.config.ip && s.config.port)
    .map(s => `${s.config.ip}:${s.config.port}`);
  rpcEl.value = addrs.join(',');
  updateMasterPreview();
}

// ─── GPU Stats Polling ────────────────────────────────────────────────────────
let statsInterval = null;

function startStatsPolling() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(async () => {
    // Master
    if (masterRunning) {
      const stats = await window.api.gpuGetStatsLocal();
      if (stats.success) updateGpuUI('master', stats);
    }

    // Slaves
    for (const slave of slaves) {
      if (slave.running) {
        const stats = await window.api.gpuGetStatsRemote({ slaveId: slave.id });
        if (stats.success) updateGpuUI(slave.id, stats);
      }
    }
  }, 2500);
}

function updateGpuUI(id, stats) {
  const isMaster = id === 'master';
  if (isMaster) {
    masterGpuStats = stats;
  } else {
    const s = slaves.find(x => x.id === id);
    if (s) s.lastGpuStats = stats;
  }

  const prefix = isMaster ? 'masterGpu' : 'gpu';
  const suffix = isMaster ? '' : `_${id}`;

  const utilFill  = document.getElementById(`${prefix}UtilFill${suffix}`);
  const utilVal   = document.getElementById(`${prefix}UtilVal${suffix}`);
  const memFill   = document.getElementById(`${prefix}MemFill${suffix}`);
  const memVal    = document.getElementById(`${prefix}MemVal${suffix}`);
  const powerFill = document.getElementById(`${prefix}PowerFill${suffix}`);
  const powerVal  = document.getElementById(`${prefix}PowerVal${suffix}`);

  if (utilFill && utilVal) {
    const u = Math.min(100, Math.max(0, stats.util));
    utilFill.setAttribute('stroke-dasharray', `${u}, 100`);
    utilVal.textContent = `${u}%`;
    utilFill.classList.toggle('warning', u > 70);
    utilFill.classList.toggle('critical', u > 90);
  }

  if (memFill && memVal) {
    const mPerc = Math.round((stats.memUsed / stats.memTotal) * 100) || 0;
    memFill.setAttribute('stroke-dasharray', `${mPerc}, 100`);
    // Show MB, but switch to GB if > 1024
    const formatMem = (m) => m > 1024 ? `${(m/1024).toFixed(1)}G` : `${m}M`;
    memVal.textContent = isMaster ? `${formatMem(stats.memUsed)}/${formatMem(stats.memTotal)}` : formatMem(stats.memUsed);

    memFill.classList.toggle('warning', mPerc > 75);
    memFill.classList.toggle('critical', mPerc > 92);
  }

  if (powerFill && powerVal) {
    // Power dial is tricky without a max. Let's assume 350W as 100% for scaling.
    const pPerc = Math.min(100, Math.round((stats.power / 350) * 100));
    powerFill.setAttribute('stroke-dasharray', `${pPerc}, 100`);
    powerVal.textContent = `${Math.round(stats.power)}W`;
    powerFill.classList.toggle('warning', pPerc > 80);
    powerFill.classList.toggle('critical', pPerc > 95);
  }
}

// ─── Token Chart ──────────────────────────────────────────────────────────────
let chartVisibleHours = 24;
let fullTokenHistory = { dates: [], values: [] };

async function initTokenChart() {
  const result = await window.api.getTokenHistory();
  if (!result.success) return;
  
  const history = result.history; // e.g. { '2026-05-25 12:00': 12000, ... }
  fullTokenHistory.dates = Object.keys(history).sort();
  fullTokenHistory.values = fullTokenHistory.dates.map(d => history[d]);
  
  todayTotalTokens = result.todayTotal || 0;
  document.getElementById('liveTokenCount').textContent = todayTotalTokens.toLocaleString();
  
  renderTokenChart();
}

function renderTokenChart() {
  const ctx = document.getElementById('tokenChartCanvas').getContext('2d');
  
  if (tokenChart) {
    tokenChart.destroy();
  }
  
  const sliceStart = Math.max(0, fullTokenHistory.dates.length - chartVisibleHours);
  const dates = fullTokenHistory.dates.slice(sliceStart);
  const values = fullTokenHistory.values.slice(sliceStart);

  // Format labels for display
  const labels = dates.map(d => {
    // d is 'YYYY-MM-DD HH:00'
    const [datePart, timePart] = d.split(' ');
    if (!datePart || !timePart) return d;
    const [y, m, day] = datePart.split('-');
    const [hr, min] = timePart.split(':');
    const dt = new Date(y, m - 1, day, hr, min);
    if (chartVisibleHours <= 48) {
      return dt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } else {
      return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
    }
  });

  tokenChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Tokens',
        data: values,
        borderColor: '#7c3aed', // --accent-indigo
        backgroundColor: 'rgba(124, 58, 237, 0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#7c3aed',
        pointRadius: 3,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#222',
          titleColor: '#ccc',
          bodyColor: '#fff',
          callbacks: {
            label: (ctx) => `${ctx.parsed.y.toLocaleString()} tokens`
          }
        }
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { color: '#888', font: { size: 9 }, maxTicksLimit: 12 }
        },
        y: {
          display: true,
          beginAtZero: true
        }
      }
    }
  });
}

// Keep the token chart updated every minute
setInterval(initTokenChart, 60000);

document.addEventListener('DOMContentLoaded', () => {
  const chartWrap = document.querySelector('.token-chart-wrap');
  if (chartWrap) {
    chartWrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      // scale by 12 hours per scroll tick
      const dir = Math.sign(e.deltaY);
      chartVisibleHours += dir * 12;
      if (chartVisibleHours < 24) chartVisibleHours = 24;
      if (chartVisibleHours > 168) chartVisibleHours = 168; // 7 days max
      renderTokenChart();
    }, { passive: false });
  }
});

// ─── Tooltips ─────────────────────────────────────────────────────────────────
function setupTooltips() {
  const popup = document.getElementById('tooltipPopup');
  let hideTimeout;

  document.addEventListener('mouseover', (e) => {
    const tip = e.target.closest('.help-tip');
    if (!tip) return;
    clearTimeout(hideTimeout);
    const text = tip.getAttribute('data-tip');
    popup.textContent = text;
    const rect = tip.getBoundingClientRect();
    popup.style.left = Math.min(rect.left, window.innerWidth - 280) + 'px';
    popup.style.top = (rect.bottom + 8) + 'px';
    popup.classList.add('visible');
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.help-tip')) {
      hideTimeout = setTimeout(() => popup.classList.remove('visible'), 200);
    }
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function detectLineClass(line) {
  const l = line.toLowerCase();
  if (l.includes('error') || l.includes('fail') || l.includes('fatal')) return 'stderr';
  if (l.includes('warn'))  return 'warn';
  if (l.includes('listen') || l.includes('ready') || l.includes('started') || l.includes('success')) return 'success';
  return 'stdout';
}

// Initialize polling (only in real mode)
if (!window.api.isScreenshotMode) {
  startStatsPolling();
}

// ─── Screenshot Mode ──────────────────────────────────────────────────────────
// When TAKE_SCREENSHOT=true, the app loads with mock cluster config (injected via
// store:getAll in main.js). We then animate the UI into a "running" state with
// realistic terminal output and GPU dial values before capturing.
if (window.api.isScreenshotMode) {
  // Wait for all cards to render first
  setTimeout(async () => {
    // ── Put master into running state ──
    masterRunning = true;
    setMasterStatus('running');

    // Fill master terminal with realistic startup logs
    const masterLogs = [
      { text: '▶ Launching: /opt/llama.cpp/build/bin/llama-server -m /models/Llama-3.3-70B-Instruct-Q4_K_M.gguf --port 8080 --host 0.0.0.0 -ngl 99 --rpc 192.168.8.101:52396,192.168.8.102:52396 -c 32768 -ctk q8_0 -ctv q8_0 -np 2 --flash-attn auto', cls: 'info' },
      { text: 'ggml_cuda_init: GGML_CUDA_FORCE_MMQ: no', cls: 'stdout' },
      { text: 'ggml_cuda_init: CUDA_USE_TENSOR_CORES: yes', cls: 'stdout' },
      { text: 'ggml_cuda_init: found 1 CUDA device(s):', cls: 'stdout' },
      { text: '  Device 0: NVIDIA GeForce RTX 4090, compute capability 8.9, VMM: yes', cls: 'stdout' },
      { text: 'llm_load_tensors: offloading 80 repeating layers to GPU', cls: 'stdout' },
      { text: 'llm_load_tensors: offloading output layer to GPU', cls: 'stdout' },
      { text: 'llm_load_tensors: offloaded 81/81 layers to GPU', cls: 'stdout' },
      { text: 'llm_load_tensors: CPU buffer size = 491.07 MiB', cls: 'stdout' },
      { text: 'llm_load_tensors: CUDA0 buffer size = 18432.25 MiB', cls: 'stdout' },
      { text: 'llm_load_tensors: RPC[192.168.8.101:52396] buffer size = 18432.25 MiB', cls: 'success' },
      { text: 'llm_load_tensors: RPC[192.168.8.102:52396] buffer size = 18432.25 MiB', cls: 'success' },
      { text: '............................................', cls: 'stdout' },
      { text: 'llama_new_context_with_model: n_ctx = 32768, n_batch = 2048, n_ubatch = 512', cls: 'stdout' },
      { text: 'llama_new_context_with_model: flash_attn = 1', cls: 'stdout' },
      { text: 'llama_kv_cache_init:      CUDA0 KV buffer size =  2048.00 MiB', cls: 'stdout' },
      { text: '✓ Master started (PID 18432)', cls: 'success' },
      { text: 'llama_server_listen: HTTP server listening on 0.0.0.0:8080', cls: 'success' },
      { text: 'slot available for connections, processing requests...', cls: 'success' },
    ];
    masterLogs.forEach(({ text, cls }) => logMaster(text, cls));

    // ── GPU dials for master (RTX 4090: 42% util, 18.4/24G VRAM, 285W) ──
    updateGpuUI('master', { util: 42, memUsed: 18842, memTotal: 24576, power: 285 });

    // ── Put slave nodes into running state ──
    const slaveConfigs = [
      {
        mockLogs: [
          { text: '▶ Connecting to 192.168.8.101 via SSH…', cls: 'info' },
          { text: '✓ SSH connected to ubuntu@192.168.8.101', cls: 'success' },
          { text: 'ggml_cuda_init: found 1 CUDA device(s):', cls: 'stdout' },
          { text: '  Device 0: NVIDIA GeForce RTX 3090, compute capability 8.6, VMM: yes', cls: 'stdout' },
          { text: 'rpc_server: loading 40 layers to GPU 0', cls: 'stdout' },
          { text: 'rpc_server: listening on 192.168.8.101:52396', cls: 'success' },
        ],
        gpuStats: { util: 75, memUsed: 16240, memTotal: 24576, power: 310 },
      },
      {
        mockLogs: [
          { text: '▶ Connecting to 192.168.8.102 via SSH…', cls: 'info' },
          { text: '✓ SSH connected to ubuntu@192.168.8.102', cls: 'success' },
          { text: 'ggml_cuda_init: found 1 CUDA device(s):', cls: 'stdout' },
          { text: '  Device 0: NVIDIA GeForce RTX 3090, compute capability 8.6, VMM: yes', cls: 'stdout' },
          { text: 'rpc_server: loading 40 layers to GPU 0', cls: 'stdout' },
          { text: 'rpc_server: listening on 192.168.8.102:52396', cls: 'success' },
        ],
        gpuStats: { util: 68, memUsed: 15820, memTotal: 24576, power: 295 },
      },
    ];

    slaves.forEach((slaveState, i) => {
      const cfg = slaveConfigs[i];
      if (!cfg) return;
      const card = document.getElementById(`card_${slaveState.id}`);
      if (!card) return;

      // Force running state
      setSlaveStatus(slaveState, card, 'running');

      // Fill terminal
      cfg.mockLogs.forEach(({ text, cls }) => logSlave(slaveState.id, text, cls));

      // Update GPU dials
      updateGpuUI(slaveState.id, cfg.gpuStats);
    });

    // ── Capture after fonts and animations settle ──
    await new Promise(r => setTimeout(r, 1800));
    await window.api.captureScreenshot();

  }, 600);
}

/* ─── Flags Modal Logic ─────────────────────────────────────── */
const flagsModal = document.getElementById('flagsModal');
const flagsModalOverlay = document.getElementById('flagsModalOverlay');
const extraFlagsHelp = document.getElementById('extraFlagsHelp');
const closeFlagsModal = document.getElementById('closeFlagsModal');
const flagsModalBody = document.getElementById('flagsModalBody');

function openFlagsModal() {
  flagsModal.style.display = 'flex';
  flagsModalOverlay.style.display = 'block';
  
  if (!flagsModalBody.hasAttribute('data-loaded')) {
    renderFlags();
    flagsModalBody.setAttribute('data-loaded', 'true');
  }
  
  const currentCmd = document.getElementById('masterCmdPreview').innerText;
  if (typeof highlightActiveFlags === 'function') {
    highlightActiveFlags(currentCmd);
  }
}

function closeFlagsModalFunc() {
  flagsModal.style.display = 'none';
  flagsModalOverlay.style.display = 'none';
}

function renderFlags() {
  flagsModalBody.innerHTML = '';
  
  if (typeof LLAMA_FLAGS === 'undefined' || !LLAMA_FLAGS.length) {
    flagsModalBody.innerHTML = '<div class="modal-loading" style="color:var(--accent-rose)">Failed to load flags. Please check flags.js</div>';
    return;
  }
  
  LLAMA_FLAGS.forEach(flagObj => {
    const item = document.createElement('div');
    item.className = 'flag-item';
    
    const name = document.createElement('div');
    name.className = 'flag-name';
    name.textContent = flagObj.flag;
    
    const desc = document.createElement('div');
    desc.className = 'flag-desc';
    desc.textContent = flagObj.description;
    
    item.appendChild(name);
    item.appendChild(desc);
    flagsModalBody.appendChild(item);
  });
}

if (extraFlagsHelp) extraFlagsHelp.addEventListener('click', openFlagsModal);
if (closeFlagsModal) closeFlagsModal.addEventListener('click', closeFlagsModalFunc);
if (flagsModalOverlay) flagsModalOverlay.addEventListener('click', closeFlagsModalFunc);

function highlightActiveFlags(commandString) {
  const flagItems = document.querySelectorAll('#flagsModalBody .flag-item');
  const tokens = commandString.split(/\s+/);
  
  flagItems.forEach(item => {
    const flagNameElement = item.querySelector('.flag-name');
    if (!flagNameElement) return;
    
    const flagNameText = flagNameElement.textContent;
    // Extract flag names: short flags like -m and long flags like --model
    const flagMatches = flagNameText.match(/(-\w+|--[\w-]+)/g);
    
    if (flagMatches) {
      // Check if any of the extracted flags exist in the command tokens
      const isActive = flagMatches.some(flag => tokens.includes(flag));
      if (isActive) {
        item.classList.add('active-flag');
      } else {
        item.classList.remove('active-flag');
      }
    } else {
      item.classList.remove('active-flag');
    }
  });
}

/* ─── About Modal Logic ─────────────────────────────────────── */
const aboutModalOverlay = document.getElementById('aboutModalOverlay');
const closeAboutModal = document.getElementById('closeAboutModal');
const openAboutBtn = document.getElementById('openAboutBtn');

function openAbout() {
  if(aboutModalOverlay) {
    aboutModalOverlay.style.display = 'flex';
    // Small delay to allow display:flex to apply before adding class for transition
    setTimeout(() => {
      aboutModalOverlay.classList.add('active');
    }, 10);
  }
}

function closeAbout() {
  if(aboutModalOverlay) {
    aboutModalOverlay.classList.remove('active');
    setTimeout(() => {
      aboutModalOverlay.style.display = 'none';
    }, 300); // match transition time
  }
}

if (openAboutBtn) openAboutBtn.addEventListener('click', openAbout);
if (closeAboutModal) closeAboutModal.addEventListener('click', closeAbout);
if (aboutModalOverlay) {
  aboutModalOverlay.addEventListener('click', (e) => {
    if (e.target === aboutModalOverlay) {
      closeAbout();
    }
  });
}

/* ─── Preferences / System Settings ─────────────────────────── */
function setupPreferences() {
  const createShortcutBtn = document.getElementById('createShortcutBtn');
  const shortcutStatus = document.getElementById('shortcutStatus');

  if (!createShortcutBtn) return;

  // Check platform
  if (window.api.platform !== 'linux') {
    createShortcutBtn.disabled = true;
    createShortcutBtn.style.opacity = '0.5';
    createShortcutBtn.style.cursor = 'not-allowed';
    if (shortcutStatus) {
      shortcutStatus.textContent = 'Only supported on Linux/Ubuntu';
      shortcutStatus.style.color = '#ff6b6b';
    }
    return;
  }

  createShortcutBtn.addEventListener('click', async () => {
    createShortcutBtn.disabled = true;
    createShortcutBtn.textContent = '⏳ Creating launcher...';
    if (shortcutStatus) {
      shortcutStatus.textContent = '';
      shortcutStatus.style.color = 'var(--text-muted)';
    }

    try {
      const res = await window.api.createDesktopLauncher();
      if (res.success) {
        createShortcutBtn.textContent = '✓ Created';
        createShortcutBtn.style.background = 'linear-gradient(135deg, #11998e, #38ef7d)';
        if (shortcutStatus) {
          shortcutStatus.textContent = 'Created successfully! Search "Llama Cluster Launcher" in applications.';
          shortcutStatus.style.color = '#38ef7d';
        }
        
        // Show desktop notification
        new Notification('Llama Cluster Launcher', {
          body: 'Launcher created! Search "Llama Cluster Launcher" in your applications to pin it.',
          icon: 'logos/llama_cluster_icon_v001.png'
        });
      } else {
        createShortcutBtn.disabled = false;
        createShortcutBtn.textContent = '✨ Create Desktop Launcher';
        if (shortcutStatus) {
          shortcutStatus.textContent = `Error: ${res.error}`;
          shortcutStatus.style.color = '#ff6b6b';
        }
      }
    } catch (err) {
      createShortcutBtn.disabled = false;
      createShortcutBtn.textContent = '✨ Create Desktop Launcher';
      if (shortcutStatus) {
        shortcutStatus.textContent = `Exception: ${err.message}`;
        shortcutStatus.style.color = '#ff6b6b';
      }
    }
  });
}

/* ─── Config Presets Management ─────────────────────────────── */
async function loadPresetsList() {
  const select = document.getElementById('presetSelect');
  if (!select) return;

  // Clear options except first
  select.innerHTML = '<option value="">-- No Preset Loaded --</option>';

  const saved = await window.api.storeGet('presets') || {};
  Object.keys(saved).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

function initPresets() {
  const select = document.getElementById('presetSelect');
  const saveBtn = document.getElementById('savePresetBtn');
  const deleteBtn = document.getElementById('deletePresetBtn');
  const nameRow = document.getElementById('presetNameRow');
  const nameInput = document.getElementById('presetNameInput');
  const confirmBtn = document.getElementById('confirmSavePresetBtn');
  const cancelBtn = document.getElementById('cancelSavePresetBtn');

  if (!select || !saveBtn || !deleteBtn) return;

  loadPresetsList();

  // Helper: collect current settings snapshot
  function collectSettings() {
    return {
      masterBinPath: document.getElementById('masterBinPath').value,
      modelPath: document.getElementById('modelPath').value,
      masterPort: document.getElementById('masterPort').value,
      masterHost: document.getElementById('masterHost').value,
      ngl: document.getElementById('ngl').value,
      contextSize: document.getElementById('contextSize').value,
      ctk: document.getElementById('ctk').value,
      ctv: document.getElementById('ctv').value,
      nParallel: document.getElementById('nParallel').value,
      masterExtraFlags: document.getElementById('masterExtraFlags').value,
      flashAttn: document.getElementById('flashAttn').value,
      soloModeEnable: document.getElementById('soloModeEnable').checked,
      remoteMasterEnable: document.getElementById('remoteMasterEnable').checked,
      masterRemoteHost: document.getElementById('masterRemoteHost').value,
      masterRemotePort: document.getElementById('masterRemotePort').value,
      masterRemoteUser: document.getElementById('masterRemoteUser').value,
      masterRemotePass: document.getElementById('masterRemotePass').value
    };
  }

  // Show inline name entry row
  function showNameRow() {
    if (nameRow) {
      nameRow.style.display = 'flex';
      if (nameInput) {
        nameInput.value = select.value || '';
        nameInput.focus();
        nameInput.select();
      }
    }
  }

  function hideNameRow() {
    if (nameRow) nameRow.style.display = 'none';
    if (nameInput) nameInput.value = '';
  }

  async function doSave() {
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      if (nameInput) nameInput.focus();
      return;
    }
    hideNameRow();

    try {
      const presets = await window.api.storeGet('presets') || {};
      presets[name] = collectSettings();
      await window.api.storeSet('presets', presets);
      await loadPresetsList();
      select.value = name;

      // Flash save button to confirm
      const origHTML = saveBtn.innerHTML;
      saveBtn.innerHTML = '✅ Saved!';
      saveBtn.style.color = '#38ef7d';
      setTimeout(() => { saveBtn.innerHTML = origHTML; saveBtn.style.color = ''; }, 2000);
    } catch (err) {
      console.error('Preset save error:', err);
      const origHTML = saveBtn.innerHTML;
      saveBtn.innerHTML = '❌ Error';
      saveBtn.style.color = '#ff6b6b';
      setTimeout(() => { saveBtn.innerHTML = origHTML; saveBtn.style.color = ''; }, 2500);
    }
  }

  // Wire up Save button → show name row
  saveBtn.addEventListener('click', showNameRow);

  // Confirm button → save
  if (confirmBtn) confirmBtn.addEventListener('click', doSave);

  // Cancel button → hide row
  if (cancelBtn) cancelBtn.addEventListener('click', hideNameRow);

  // Enter key in name input → save; Escape → cancel
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
      if (e.key === 'Escape') { e.preventDefault(); hideNameRow(); }
    });
  }


  // Load a preset
  select.addEventListener('change', async () => {
    const name = select.value;
    if (!name) return;

    const presets = await window.api.storeGet('presets') || {};
    const cfg = presets[name];
    if (!cfg) return;

    setIfExists('masterBinPath', cfg.masterBinPath);
    setIfExists('modelPath', cfg.modelPath);
    setIfExists('masterPort', cfg.masterPort);
    setIfExists('masterHost', cfg.masterHost);
    setIfExists('ngl', cfg.ngl);
    setIfExists('contextSize', cfg.contextSize);
    setIfExists('ctk', cfg.ctk);
    setIfExists('ctv', cfg.ctv);
    setIfExists('nParallel', cfg.nParallel);
    setIfExists('masterExtraFlags', cfg.masterExtraFlags);
    setIfExists('flashAttn', cfg.flashAttn);

    if (cfg.modelPath) updateModelChip(cfg.modelPath);
    if (cfg.ngl !== undefined) {
      const nglSlider = document.getElementById('nglSlider');
      if (nglSlider) nglSlider.value = cfg.ngl;
    }

    if (cfg.soloModeEnable !== undefined) {
      document.getElementById('soloModeEnable').checked = cfg.soloModeEnable;
    }
    if (cfg.remoteMasterEnable !== undefined) {
      document.getElementById('remoteMasterEnable').checked = cfg.remoteMasterEnable;
      const credsDiv = document.getElementById('remoteMasterCreds');
      if (credsDiv) credsDiv.style.display = cfg.remoteMasterEnable ? 'grid' : 'none';
    }
    setIfExists('masterRemoteHost', cfg.masterRemoteHost);
    setIfExists('masterRemotePort', cfg.masterRemotePort || '22');
    setIfExists('masterRemoteUser', cfg.masterRemoteUser);
    setIfExists('masterRemotePass', cfg.masterRemotePass);

    // Save active loaded setting fields
    const fieldsToSave = [
      'masterBinPath','modelPath','masterPort','masterHost',
      'ngl','contextSize','ctk','ctv','nParallel','masterExtraFlags','flashAttn',
      'masterRemoteHost','masterRemotePort','masterRemoteUser','masterRemotePass'
    ];
    fieldsToSave.forEach(id => {
      const el = document.getElementById(id);
      if (el) saveSetting(id, el.value);
    });
    saveSetting('soloModeEnable', document.getElementById('soloModeEnable').checked);
    saveSetting('remoteMasterEnable', document.getElementById('remoteMasterEnable').checked);

    updateMasterPreview();
    updateMasterVersion();
  });

  // Delete active preset
  deleteBtn.addEventListener('click', async () => {
    const name = select.value;
    if (!name) return;

    if (!confirm(`Are you sure you want to delete preset "${name}"?`)) return;

    const presets = await window.api.storeGet('presets') || {};
    delete presets[name];
    await window.api.storeSet('presets', presets);

    await loadPresetsList();
  });
}

