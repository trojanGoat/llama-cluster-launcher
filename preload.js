const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  storeGetAll: () => ipcRenderer.invoke('store:getAll'),

  // File dialog
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),

  // Port checks (read-only)
  checkPortLocal: (port) => ipcRenderer.invoke('port:checkLocal', port),
  checkPortRemote: (opts) => ipcRenderer.invoke('port:checkRemote', opts),

  // Master process
  launchMaster: (opts) => ipcRenderer.invoke('master:launch', opts),
  stopMaster: () => ipcRenderer.invoke('master:stop'),
  onMasterOutput: (cb) => ipcRenderer.on('master:output', (_, d) => cb(d)),
  onMasterStopped: (cb) => ipcRenderer.on('master:stopped', (_, d) => cb(d)),
  onMasterError: (cb) => ipcRenderer.on('master:error', (_, d) => cb(d)),

  // Slave processes
  launchSlave: (opts) => ipcRenderer.invoke('slave:launch', opts),
  stopSlave: (opts) => ipcRenderer.invoke('slave:stop', opts),
  onSlaveOutput: (cb) => ipcRenderer.on('slave:output', (_, d) => cb(d)),
  onSlaveStopped: (cb) => ipcRenderer.on('slave:stopped', (_, d) => cb(d)),

  // SSH test
  testSSH: (opts) => ipcRenderer.invoke('ssh:test', opts),

  // GPU Stats
  gpuGetStatsLocal: () => ipcRenderer.invoke('gpu:getStatsLocal'),
  gpuGetStatsRemote: (opts) => ipcRenderer.invoke('gpu:getStatsRemote', opts),
});
