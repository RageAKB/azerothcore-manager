// AzerothCore Manager - Frontend JavaScript

let currentConfigFile = null;
let refreshInterval = null;

// Log state
let currentLogFile = 'Server.log';
let rawLogLines = [];
let logRefreshTimer = null;

// ============ NAVIGATION ============

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showTab(btn.dataset.tab);
  });
});

function showTab(tabName) {
  // Update nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.toggle('active', tab.id === tabName);
  });
  
  // Load tab-specific data
  switch(tabName) {
    case 'dashboard': loadDashboard(); break;
    case 'servers': loadServers(); break;
    case 'database': loadDatabase(); break;
    case 'users': loadUsers(); break;
    case 'config': loadConfigList(); break;
    case 'logs': loadLogs(); break;
    case 'backup': loadBackups(); break;
  }
}

// ============ TOAST NOTIFICATIONS ============

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  toast.onclick = () => {
    toast.classList.remove('show');
    toast.onclick = null;
  };
  
  const duration = type === 'error' ? 15000 : 5000;
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// ============ API HELPERS ============

async function apiGet(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

async function apiPost(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

async function apiDelete(url) {
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

// ============ DASHBOARD ============

async function loadDashboard() {
  try {
    const [systemInfo, serverStatus, dbStats] = await Promise.all([
      apiGet('/api/system/info'),
      apiGet('/api/server/status'),
      apiGet('/api/db/stats')
    ]);
    
    // System Info
    document.getElementById('systemInfo').innerHTML = `
      <div class="info-item"><span class="info-label">Hostname</span><span class="info-value">${systemInfo.hostname}</span></div>
      <div class="info-item"><span class="info-label">Platform</span><span class="info-value">${systemInfo.platform} ${systemInfo.arch}</span></div>
      <div class="info-item"><span class="info-label">Memory</span><span class="info-value">${systemInfo.freeMemory}GB / ${systemInfo.totalMemory}GB</span></div>
      <div class="info-item"><span class="info-label">CPU Cores</span><span class="info-value">${systemInfo.cpuCores}</span></div>
      <div class="info-item"><span class="info-label">Uptime</span><span class="info-value">${formatUptime(systemInfo.uptime)}</span></div>
      <div class="info-item"><span class="info-label">Node.js</span><span class="info-value">${systemInfo.nodeVersion}</span></div>
    `;
    
    // Server Status
    const statusColors = {
      'running': 'status-running',
      'exited': 'status-stopped',
      'starting': 'status-starting',
      'not_found': 'status-not-found'
    };
    
    document.getElementById('serverStatus').innerHTML = Object.entries(serverStatus).map(([name, status]) => `
      <div class="status-item">
        <span>${name}</span>
        <span class="status-badge ${statusColors[status] || 'status-not-found'}">${status}</span>
      </div>
    `).join('');
    
    // Database Stats
    document.getElementById('dbStats').innerHTML = dbStats.map(db => `
      <div class="info-item">
        <span class="info-label">${db.database}</span>
        <span class="info-value">${db.size_mb} MB (${db.table_count} tables)</span>
      </div>
    `).join('');
    
  } catch (err) {
    showToast(`Error loading dashboard: ${err.message}`, 'error');
  }
}

// ============ SERVERS ============

async function loadServers() {
  try {
    const [containers, serverStatus] = await Promise.all([
      apiGet('/api/system/containers'),
      apiGet('/api/server/status')
    ]);
    
    // Containers List
    document.getElementById('containersList').innerHTML = containers.length === 0 
      ? '<p class="text-muted">No containers running</p>'
      : containers.map(c => `
        <div class="status-item">
          <div>
            <strong>${c.name}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">${c.id.substring(0, 12)}</div>
          </div>
          <span class="status-badge ${c.status.includes('Up') ? 'status-running' : 'status-stopped'}">${c.status}</span>
        </div>
      `).join('');
    
    // Server Controls
    const servers = [
      { name: 'ac-authserver', label: 'Auth Server', port: '3724' },
      { name: 'ac-worldserver', label: 'World Server', port: '8085' },
      { name: 'ac-database', label: 'Database', port: '3306' }
    ];
    
    document.getElementById('serverControls').innerHTML = servers.map(s => {
      const status = serverStatus[s.name] || 'not_found';
      const isRunning = status === 'running';
      return `
        <div class="status-item">
          <div>
            <strong>${s.label}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">Port: ${s.port}</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            ${isRunning 
              ? `<button class="btn btn-sm btn-danger" onclick="controlServer('${s.name}', 'stop')">Stop</button>`
              : `<button class="btn btn-sm btn-primary" onclick="controlServer('${s.name}', 'start')">Start</button>`
            }
            <button class="btn btn-sm btn-secondary" onclick="controlServer('${s.name}', 'restart')">Restart</button>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (err) {
    showToast(`Error loading servers: ${err.message}`, 'error');
  }
}

async function controlServer(name, action) {
  try {
    await apiPost(`/api/system/container/${action}/${name}`, {});
    showToast(`${name} ${action}ed successfully`);
    loadServers();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ============ DATABASE ============

async function loadDatabase() {
  try {
    const [schemas, tables] = await Promise.all([
      apiGet('/api/db/schemas'),
      apiGet('/api/db/stats')
    ]);
    
    // Schemas
    document.getElementById('schemasList').innerHTML = schemas.length === 0
      ? '<p class="text-muted">No schemas found</p>'
      : schemas.map(s => `
        <div class="status-item">
          <div>
            <strong>${s.name}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">${s.table_count} tables</div>
          </div>
          <span class="status-badge status-running">${s.size_mb} MB</span>
        </div>
      `).join('');
    
    // Tables
    document.getElementById('tablesList').innerHTML = tables.length === 0
      ? '<p class="text-muted">No tables found</p>'
      : tables.map(t => `
        <div class="status-item">
          <div>
            <strong>${t.database}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">${t.table_count} tables</div>
          </div>
          <span class="status-badge status-running">${t.size_mb} MB</span>
        </div>
      `).join('');
    
  } catch (err) {
    showToast(`Error loading database: ${err.message}`, 'error');
  }
}

// ============ USERS ============

async function loadUsers() {
  try {
    const users = await apiGet('/api/db/users');
    
    document.getElementById('usersList').innerHTML = users.length === 0
      ? '<p class="text-muted">No users found</p>'
      : users.map(u => `
        <div class="status-item">
          <div>
            <strong>${u.username}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">${u.host}</div>
          </div>
          <span class="status-badge status-running">${u.password_type}</span>
        </div>
      `).join('');
    
  } catch (err) {
    showToast(`Error loading users: ${err.message}`, 'error');
  }
}

// ============ CONFIG ============

async function loadConfigList() {
  try {
    const configs = await apiGet('/api/config/list');
    
    document.getElementById('configList').innerHTML = configs.length === 0
      ? '<p class="text-muted">No config files found</p>'
      : configs.map(c => `
        <div class="status-item">
          <div>
            <strong>${c.name}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">${c.size} bytes</div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="btn btn-sm btn-primary" onclick="viewConfig('${c.name}')">View</button>
            <button class="btn btn-sm btn-secondary" onclick="editConfig('${c.name}')">Edit</button>
          </div>
        </div>
      `).join('');
    
  } catch (err) {
    showToast(`Error loading configs: ${err.message}`, 'error');
  }
}

async function viewConfig(filename) {
  try {
    const content = await apiGet(`/api/config/view/${encodeURIComponent(filename)}`);
    document.getElementById('configContent').innerHTML = `<pre>${escapeHtml(content)}</pre>`;
    document.getElementById('configModal').classList.add('active');
  } catch (err) {
    showToast(`Error reading config: ${err.message}`, 'error');
  }
}

async function editConfig(filename) {
  try {
    const content = await apiGet(`/api/config/view/${encodeURIComponent(filename)}`);
    document.getElementById('configEditor').value = content;
    document.getElementById('configFilename').value = filename;
    document.getElementById('configModal').classList.add('active');
  } catch (err) {
    showToast(`Error reading config: ${err.message}`, 'error');
  }
}

async function saveConfig() {
  const filename = document.getElementById('configFilename').value;
  const content = document.getElementById('configEditor').value;
  
  try {
    await apiPost(`/api/config/save/${encodeURIComponent(filename)}`, { content });
    showToast('Config saved successfully');
    document.getElementById('configModal').classList.remove('active');
    loadConfigList();
  } catch (err) {
    showToast(`Error saving config: ${err.message}`, 'error');
  }
}

// ============ LOGS ============

async function loadLogs() {
  try {
    const logFiles = await apiGet('/api/logs/list');
    
    document.getElementById('logFilesList').innerHTML = logFiles.length === 0
      ? '<p class="text-muted">No log files found</p>'
      : logFiles.map(f => `
        <div class="status-item">
          <div>
            <strong>${f.name}</strong>
            <div style="font-size: 0.8rem; color: var(--text-muted)">${f.size} bytes</div>
          </div>
          <button class="btn btn-sm btn-primary" onclick="selectLogFile('${f.name}')">View</button>
        </div>
      `).join('');
    
  } catch (err) {
    showToast(`Error loading logs: ${err.message}`, 'error');
  }
}

async function selectLogFile(filename) {
  currentLogFile = filename;
  document.getElementById('currentLogFile').textContent = filename;
  await loadLogContent();
}

async function loadLogContent() {
  if (!currentLogFile) {
    showToast('Please select a log file first.', 'error');
    return;
  }
  
  try {
    const lines = await apiGet(`/api/logs/view/${encodeURIComponent(currentLogFile)}`);
    rawLogLines = lines;
    
    const logOutput = document.getElementById('logOutput');
    logOutput.innerHTML = lines.map(line => {
      // Colorize log levels
      let colored = escapeHtml(line);
      if (line.includes('ERROR') || line.includes('CRITICAL')) {
        colored = colored.replace(/(ERROR|CRITICAL)/g, '<span style="color:#ff4444">$1</span>');
      } else if (line.includes('WARNING') || line.includes('WARN')) {
        colored = colored.replace(/(WARNING|WARN)/g, '<span style="color:#ffaa00">$1</span>');
      } else if (line.includes('INFO')) {
        colored = colored.replace(/INFO/g, '<span style="color:#44ff44">INFO</span>');
      }
      return `<div>${colored}</div>`;
    }).join('');
    
    // Auto-scroll to bottom
    logOutput.scrollTop = logOutput.scrollHeight;
    
  } catch (err) {
    showToast(`Error loading log: ${err.message}`, 'error');
  }
}

function filterLogs() {
  const searchTerm = document.getElementById('logSearch').value.toLowerCase();
  const logOutput = document.getElementById('logOutput');
  
  if (!searchTerm) {
    loadLogContent();
    return;
  }
  
  const filtered = rawLogLines.filter(line => line.toLowerCase().includes(searchTerm));
  logOutput.innerHTML = filtered.map(line => {
    let colored = escapeHtml(line);
    if (line.includes('ERROR') || line.includes('CRITICAL')) {
      colored = colored.replace(/(ERROR|CRITICAL)/g, '<span style="color:#ff4444">$1</span>');
    } else if (line.includes('WARNING') || line.includes('WARN')) {
      colored = colored.replace(/(WARNING|WARN)/g, '<span style="color:#ffaa00">$1</span>');
    }
    return `<div>${colored}</div>`;
  }).join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clearLogOutput() {
  rawLogLines = [];
  document.getElementById('logOutput').innerHTML = '<div style="color:#666">Cleared</div>';
}

function setupAutoRefresh() {
  // Clear existing timer
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
    logRefreshTimer = null;
  }
  
  const interval = parseInt(document.getElementById('logRefresh').value) || 0;
  
  if (interval > 0) {
    logRefreshTimer = setInterval(() => {
      if (document.getElementById('logs').classList.contains('active')) {
        loadLogContent();
      }
    }, interval);
  }
}

// Listen for auto-refresh changes
document.addEventListener('DOMContentLoaded', () => {
  const refreshSelect = document.getElementById('logRefresh');
  if (refreshSelect) {
    refreshSelect.addEventListener('change', setupAutoRefresh);
  }
});

function downloadCurrentLog() {
  if (!currentLogFile) {
    showToast('Please select a log file first.', 'error');
    return;
  }
  window.open(`/api/download/logs/${encodeURIComponent(currentLogFile)}`, '_blank');
}

// ============ REFRESH ============

function refreshAll() {
  const activeTab = document.querySelector('.nav-btn.active').dataset.tab;
  showTab(activeTab);
  document.getElementById('lastUpdate').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
}

// Auto-refresh every 30 seconds
function startAutoRefresh() {
  refreshInterval = setInterval(refreshAll, 30000);
}

// ============ INITIALIZATION ============

document.addEventListener('DOMContentLoaded', () => {
  showTab('dashboard');
  startAutoRefresh();
  document.getElementById('lastUpdate').textContent = `Updated: ${new Date().toLocaleTimeString()}`;
});

// ============ HELPERS ============

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
