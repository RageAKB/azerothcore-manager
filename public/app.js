// AzerothCore Manager - Frontend JavaScript

let currentConfigFile = null;
let refreshInterval = null;

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
    case 'logs': loadLogFileList(); break;
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
        <button class="btn btn-sm btn-secondary" onclick="showDatabaseTables('${db}')">View Tables</button>
      </div>
    `).join('');
    
    // Populate select
    const select = document.getElementById('dbSelect');
    select.innerHTML = schemas.map(db => `<option value="${db}">${db}</option>`).join('');
    
  } catch (err) {
    showToast(`Error loading database: ${err.message}`, 'error');
  }
}

async function showDatabaseTables(database) {
  try {
    const tables = await apiGet(`/api/db/tables?database=${database}`);
    showToast(`Tables in ${database}: ${tables.join(', ')}`);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function executeQuery() {
  const database = document.getElementById('dbSelect').value;
  const query = document.getElementById('sqlQuery').value;
  
  if (!query.trim()) {
    showToast('Please enter a query', 'error');
    return;
  }
  
  try {
    const results = await apiPost('/api/db/query', { database, query });
    
    if (results.rows && results.rows.length > 0) {
      const columns = Object.keys(results.rows[0]);
      document.getElementById('queryResults').innerHTML = `
        <p style="margin-bottom: 1rem; color: var(--text-muted)">
          ${results.rowCount} row(s) returned
        </p>
        <table>
          <thead>
            <tr>${columns.map(col => `<th>${col}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${results.rows.map(row => `
              <tr>${columns.map(col => `<td>${row[col] !== null ? row[col] : '<em>null</em>'}</td>`).join('')}</tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } else {
      document.getElementById('queryResults').innerHTML = '<p style="color: var(--success)">Query executed successfully (no results)</p>';
    }
  } catch (err) {
    showToast(`Query error: ${err.message}`, 'error');
  }
}

// ============ USERS ============

async function loadUsers() {
  try {
    const users = await apiGet('/api/users');
    
    document.getElementById('usersList').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>Locked</th>
            <th>Last IP</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(user => `
            <tr>
              <td>${user.id}</td>
              <td>${user.username}</td>
              <td>${user.email}</td>
              <td>${user.locked ? 'Yes' : 'No'}</td>
              <td>${user.last_ip || '-'}</td>
              <td>
                <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    showToast(`Error loading users: ${err.message}`, 'error');
  }
}

async function createUser(event) {
  event.preventDefault();
  
  const username = document.getElementById('username').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  
  try {
    await apiPost('/api/users', { username, email, password });
    showToast('User created successfully');
    document.getElementById('createUserForm').reset();
    loadUsers();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function deleteUser(id) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  
  try {
    await apiDelete(`/api/users/${id}`);
    showToast('User deleted');
    loadUsers();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ============ CONFIGURATION ============

async function loadConfigList() {
  try {
    const files = await apiGet('/api/config');
    
    document.getElementById('configList').innerHTML = files.length === 0
      ? '<p class="text-muted">No configuration files found</p>'
      : files.map(file => `
        <div class="info-item">
          <span class="info-label">${file}</span>
          <button class="btn btn-sm btn-primary" onclick="editConfig('${file}')">Edit</button>
        </div>
      `).join('');
  } catch (err) {
    document.getElementById('configList').innerHTML = '<p class="text-muted">Configuration directory not accessible</p>';
  }
}

async function editConfig(filename) {
  try {
    currentConfigFile = filename;
    const config = await apiGet(`/api/config/${filename}`);
    
    document.getElementById('configEditorTitle').textContent = `Edit: ${filename}`;
    document.getElementById('configEditor').value = config.content;
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function saveConfig() {
  if (!currentConfigFile) {
    showToast('No file selected', 'error');
    return;
  }
  
  try {
    await apiPost(`/api/config/${currentConfigFile}`, {
      content: document.getElementById('configEditor').value
    });
    showToast('Configuration saved');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function loadConfig() {
  if (!currentConfigFile) return;
  await editConfig(currentConfigFile);
}

// ============ LOGS ============

async function fetchLogs() {
  const container = document.getElementById('logContainer').value;
  const lines = document.getElementById('logLines').value;
  
  try {
    const data = await apiGet(`/api/logs?container=${container}&lines=${lines}`);
    document.getElementById('logOutput').textContent = data.logs.join('\n');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function downloadLogs() {
  const container = document.getElementById('logContainer').value;
  window.open(`/api/download/logs/${container}`, '_blank');
}

// ============ BACKUP ============

async function loadBackups() {
  try {
    const backups = await apiGet('/api/backups');
    
    document.getElementById('backupsList').innerHTML = backups.length === 0
      ? '<p class="text-muted">No backups found</p>'
      : `
        <table>
          <thead>
            <tr>
              <th>Filename</th>
              <th>Size</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${backups.map(backup => `
              <tr>
                <td>${backup.name}</td>
                <td>${formatSize(backup.size)}</td>
                <td>${new Date(backup.date).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function createBackup() {
  const checkboxes = document.querySelectorAll('.checkbox-group input[type="checkbox"]:checked');
  const databases = Array.from(checkboxes).map(cb => cb.value);
  
  if (databases.length === 0) {
    showToast('Select at least one database', 'error');
    return;
  }
  
  try {
    await apiPost('/api/backup', { databases });
    showToast('Backup created successfully');
    loadBackups();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ============ UTILITY FUNCTIONS ============

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============ LOGS ============

let currentLogFile = null;

function loadLogFileList() {
  fetch('/api/logs/files')
    .then(res => res.json())
    .then(files => {
      const list = document.getElementById('logFileList');
      if (files.length === 0) {
        list.innerHTML = '<p class="text-muted">No log files found</p>';
        return;
      }
      
      list.innerHTML = files.map(f => `
        <div class="info-item" style="cursor:pointer; padding:8px; border-bottom:1px solid #eee;" onclick="selectLogFile('${f.name}')">
          <strong>${f.name}</strong>
          <span style="float:right; color:#666;">${formatBytes(f.size)} · ${new Date(f.modified).toLocaleString()}</span>
        </div>
      `).join('');
    })
    .catch(err => {
      document.getElementById('logFileList').innerHTML = `<p class="text-muted">Error: ${err.message}</p>`;
    });
}

function selectLogFile(filename) {
  currentLogFile = filename;
  document.getElementById('logOutputTitle').textContent = filename;
  loadLogContent();
}

function loadLogContent() {
  if (!currentLogFile) {
    document.getElementById('logOutput').textContent = 'Please select a log file first.';
    return;
  }
  
  const lines = document.getElementById('logLines').value || '200';
  document.getElementById('logOutput').textContent = 'Loading...';
  
  fetch(`/api/logs?file=${encodeURIComponent(currentLogFile)}&lines=${lines}`)
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        document.getElementById('logOutput').textContent = `Error: ${data.error}`;
        return;
      }
      document.getElementById('logOutput').textContent = data.lines.join('\n');
    })
    .catch(err => {
      document.getElementById('logOutput').textContent = `Error: ${err.message}`;
    });
}

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
