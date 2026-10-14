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
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
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
    
    // Database List
    document.getElementById('dbList').innerHTML = schemas.map(db => `
      <div class="info-item">
        <span class="info-label">${db}</span>
        <span class="info-value" style="cursor:pointer; color:var(--primary)" onclick="loadTables('${db}')">View tables</span>
      </div>
    `).join('');
    
    // Populate dropdown
    const select = document.getElementById('dbSelect');
    select.innerHTML = schemas.map(db => `<option value="${db}">${db}</option>`).join('');
    
  } catch (err) {
    showToast(`Error loading database: ${err.message}`, 'error');
  }
}

async function loadTables(database) {
  try {
    const tables = await apiGet(`/api/db/tables?database=${encodeURIComponent(database)}`);
    document.getElementById('dbList').innerHTML = tables.map(t => `
      <div class="info-item">
        <span class="info-label">${t}</span>
        <span class="info-value">${database}</span>
      </div>
    `).join('');
  } catch (err) {
    showToast(`Error loading tables: ${err.message}`, 'error');
  }
}

async function executeQuery() {
  const database = document.getElementById('dbSelect').value;
  const query = document.getElementById('sqlQuery').value;
  
  if (!database || !query) {
    showToast('Please select a database and enter a query.', 'error');
    return;
  }
  
  try {
    const result = await apiPost('/api/db/query', { database, query });
    
    if (result.rows.length === 0) {
      document.getElementById('queryResults').innerHTML = '<p class="text-muted">No results.</p>';
      return;
    }
    
    const headers = Object.keys(result.rows[0]);
    let html = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
    
    result.rows.forEach(row => {
      html += '<tr>' + headers.map(h => `<td>${row[h] !== null ? row[h] : '<em>null</em>'}</td>`).join('') + '</tr>';
    });
    
    html += '</tbody></table>';
    html += `<p style="margin-top:0.5rem; color:var(--text-muted); font-size:0.85rem">${result.rowCount} row(s) returned</p>`;
    
    document.getElementById('queryResults').innerHTML = html;
  } catch (err) {
    showToast(`Query error: ${err.message}`, 'error');
  }
}

// ============ USERS ============

async function loadUsers() {
  try {
    const rows = await apiGet('/api/users');
    
    const gmLevelNames = { 0: 'Player', 1: 'Moderator', 2: 'Game Master', 3: 'Administrator' };
    const gmLevelColors = {
      0: 'status-not-found',
      1: 'status-starting',
      2: 'status-running',
      3: 'status-stopped'
    };
    
    document.getElementById('usersList').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>GM Level</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(u => `
            <tr>
              <td>${u.id}</td>
              <td>${u.username}</td>
              <td>${u.email || '-'}</td>
              <td>
                <select class="form-control" style="width:auto;padding:0.25rem 0.5rem;font-size:0.8rem" onchange="updateGmLevel(${u.id}, this.value)">
                  <option value="0" ${u.gmlevel == 0 ? 'selected' : ''}>0 - Player</option>
                  <option value="1" ${u.gmlevel == 1 ? 'selected' : ''}>1 - Moderator</option>
                  <option value="2" ${u.gmlevel == 2 ? 'selected' : ''}>2 - Game Master</option>
                  <option value="3" ${u.gmlevel == 3 ? 'selected' : ''}>3 - Administrator</option>
                </select>
              </td>
              <td><span class="status-badge ${u.locked ? 'status-stopped' : 'status-running'}">${u.locked ? 'Locked' : 'Active'}</span></td>
              <td>
                <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${u.username}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('usersList').innerHTML = `<p class="text-muted">Error loading users: ${err.message}</p>`;
  }
}

async function createUser(event) {
  event.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const gmlevel = parseInt(document.getElementById('gmlevel').value);
  
  if (!username || !password) {
    showToast('Username and password are required.', 'error');
    return;
  }
  
  try {
    await apiPost('/api/users', { username, password, gmlevel });
    showToast(`User ${username} created successfully with GM Level ${gmlevel}`);
    document.getElementById('createUserForm').reset();
    loadUsers();
  } catch (err) {
    showToast(`Error creating user: ${err.message}`, 'error');
  }
}

async function updateGmLevel(id, gmlevel) {
  try {
    await apiPost(`/api/users/${id}/gmlevel`, { gmlevel: parseInt(gmlevel) });
    showToast(`GM level updated for account ${id}`);
  } catch (err) {
    showToast(`Error updating GM level: ${err.message}`, 'error');
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user ${username}? This cannot be undone.`)) return;
  
  try {
    await apiDelete(`/api/users/${id}`);
    showToast(`User ${username} deleted`);
    loadUsers();
  } catch (err) {
    showToast(`Error deleting user: ${err.message}`, 'error');
  }
}

// ============ CONFIGURATION ============

async function loadConfigList() {
  try {
    const files = await apiGet('/api/config');
    
    document.getElementById('configList').innerHTML = files.length === 0 
      ? '<p class="text-muted">No configuration files found</p>'
      : files.map(f => `
        <div class="info-item" style="cursor:pointer; padding:8px; border-bottom:1px solid #eee;" onclick="loadConfigFile('${f}')">
          <strong>${f}</strong>
          <span style="float:right; color:#666;">Click to edit</span>
        </div>
      `).join('');
  } catch (err) {
    document.getElementById('configList').innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
  }
}

async function loadConfigFile(filename) {
  try {
    currentConfigFile = filename;
    const data = await apiGet(`/api/config/${encodeURIComponent(filename)}`);
    document.getElementById('configEditorTitle').textContent = `Editing: ${filename}`;
    document.getElementById('configEditor').value = data.content;
  } catch (err) {
    showToast(`Error loading config: ${err.message}`, 'error');
  }
}

async function saveConfig() {
  if (!currentConfigFile) {
    showToast('No file selected.', 'error');
    return;
  }
  
  const content = document.getElementById('configEditor').value;
  
  try {
    await apiPost(`/api/config/${encodeURIComponent(currentConfigFile)}`, { content });
    showToast('Configuration saved successfully');
  } catch (err) {
    showToast(`Error saving config: ${err.message}`, 'error');
  }
}

async function loadConfig() {
  if (currentConfigFile) {
    await loadConfigFile(currentConfigFile);
  }
}

// ============ BACKUPS ============

async function loadBackups() {
  try {
    const backups = await apiGet('/api/backups');
    
    document.getElementById('backupsList').innerHTML = backups.length === 0 
      ? '<p class="text-muted">No backups found</p>'
      : `
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Size</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${backups.map(b => `
              <tr>
                <td>${b.name}</td>
                <td>${formatBytes(b.size)}</td>
                <td>${new Date(b.date).toLocaleString()}</td>
                <td>
                  <button class="btn btn-sm btn-primary" onclick="restoreBackup('${b.name}')">Restore</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteBackup('${b.name}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
  } catch (err) {
    document.getElementById('backupsList').innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
  }
}

async function createBackup() {
  const checkboxes = document.querySelectorAll('#backup input[type="checkbox"]:checked');
  const databases = Array.from(checkboxes).map(cb => cb.value);
  
  if (databases.length === 0) {
    showToast('Select at least one database.', 'error');
    return;
  }
  
  try {
    await apiPost('/api/backup', { databases });
    showToast('Backup created successfully');
    loadBackups();
  } catch (err) {
    showToast(`Error creating backup: ${err.message}`, 'error');
  }
}

async function restoreBackup(filename) {
  if (!confirm(`Restore from ${filename}? This will overwrite current data.`)) return;
  
  try {
    await apiPost(`/api/backup/restore/${encodeURIComponent(filename)}`, {});
    showToast('Backup restored successfully');
  } catch (err) {
    showToast(`Error restoring backup: ${err.message}`, 'error');
  }
}

async function deleteBackup(filename) {
  if (!confirm(`Delete ${filename}?`)) return;
  
  try {
    await apiDelete(`/api/backup/${encodeURIComponent(filename)}`);
    showToast('Backup deleted');
    loadBackups();
  } catch (err) {
    showToast(`Error deleting backup: ${err.message}`, 'error');
  }
}

// ============ LOGS ============

const LOG_FILES = [
  { name: 'Server.log', label: '🌍 World Server' },
  { name: 'Auth.log', label: '🔐 Auth Server' },
  { name: 'DBImport.log', label: '📦 DB Import' },
  { name: 'Errors.log', label: '⚠️ Errors' }
];

function loadLogs() {
  // Set active tab
  document.querySelectorAll('.log-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.file === currentLogFile);
  });
  
  // Load log content
  loadLogContent();
  
  // Setup auto-refresh
  setupAutoRefresh();
}

function switchLogFile(filename) {
  currentLogFile = filename;
  
  // Update tab UI
  document.querySelectorAll('.log-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.file === filename);
  });
  
  // Clear and reload
  rawLogLines = [];
  document.getElementById('logOutput').innerHTML = '';
  document.getElementById('logSearch').value = '';
  loadLogContent();
}

function loadLogContent() {
  const lines = document.getElementById('logLines').value || '200';
  const output = document.getElementById('logOutput');
  
  output.innerHTML = '<div style="color:#666">Loading...</div>';
  
  fetch(`/api/logs/${encodeURIComponent(currentLogFile)}?lines=${lines}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        output.innerHTML = `<div style="color:#f87171">Error: ${data.error}</div>`;
        return;
      }
      
      rawLogLines = data.lines || [];
      renderLogLines(rawLogLines);
    })
    .catch(err => {
      output.innerHTML = `<div style="color:#f87171">Error: ${err.message}</div>`;
    });
}

function renderLogLines(lines) {
  const output = document.getElementById('logOutput');
  const searchTerm = document.getElementById('logSearch').value.toLowerCase();
  
  if (lines.length === 0) {
    output.innerHTML = '<div style="color:#666">No log entries</div>';
    return;
  }
  
  let html = '';
  let counts = { info: 0, warn: 0, error: 0, debug: 0, critical: 0, success: 0, system: 0 };
  
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const level = detectLogLevel(line);
    const isMatch = !searchTerm || line.toLowerCase().includes(searchTerm);
    
    if (counts[level] !== undefined) counts[level]++;
    
    const highlightedLine = searchTerm ? highlightText(line, searchTerm) : escapeHtml(line);
    
    html += `<span class="log-line ${isMatch ? '' : 'filtered'}" data-line="${lineNum}">`;
    html += `<span class="log-line-number">${lineNum}</span>`;
    html += `<span class="log-line-content log-level-${level}">${highlightedLine}</span>`;
    html += `</span>\n`;
  });
  
  output.innerHTML = html;
  
  // Update stats
  updateLogStats(counts, lines.length);
  
  // Scroll to bottom
  output.scrollTop = output.scrollHeight;
}

function filterLogLines() {
  renderLogLines(rawLogLines);
}

function updateLogStats(counts, total) {
  // Remove existing stats
  const existing = document.querySelector('.log-stats');
  if (existing) existing.remove();
  
  const statsHtml = `
    <div class="log-stats">
      <span><span class="log-dot info"></span> INFO: ${counts.info}</span>
      <span><span class="log-dot warn"></span> WARN: ${counts.warn}</span>
      <span><span class="log-dot error"></span> ERROR: ${counts.error}</span>
      <span><span class="log-dot debug"></span> DEBUG: ${counts.debug}</span>
      <span style="margin-left:auto">Total: ${total} lines</span>
    </div>
  `;
  
  const wrapper = document.querySelector('.log-output-wrapper');
  wrapper.insertAdjacentHTML('afterbegin', statsHtml);
}

function detectLogLevel(line) {
  const lower = line.toLowerCase();
  
  if (lower.includes('critical') || lower.includes('fatal')) return 'critical';
  if (lower.includes('error') || lower.includes('fail')) return 'error';
  if (lower.includes('warn')) return 'warn';
  if (lower.includes('debug')) return 'debug';
  if (lower.includes('success') || lower.includes('ok') || lower.includes('loaded')) return 'success';
  if (lower.includes('system') || lower.includes('info')) return 'info';
  
  return 'system';
}

function highlightText(text, term) {
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
  return escaped.replace(regex, '<span class="log-highlight">$1</span>');
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
