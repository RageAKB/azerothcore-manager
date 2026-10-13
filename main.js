const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');
const util = require('util');
const os = require('os');

const execAsync = util.promisify(exec);
const app = express();

function isDockerNotFound(err) {
  return err.message && err.message.includes('docker: not found');
}
const PORT = process.env.PORT || 8088;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database connection pool
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'acore_auth',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let dbPool = null;

async function getDbPool() {
  if (!dbPool) {
    dbPool = mysql.createPool(dbConfig);
  }
  return dbPool;
}

// Helper: check if error is due to missing Docker
function isDockerNotFound(err) {
  return err.message.includes('docker') && err.message.includes('not found');
}

// Helper: check if error is due to missing Docker network
function isNetworkNotFound(err) {
  return err.message && (err.message.includes('No such network') || err.message.includes('docker.sock') || err.message.includes('dial unix'));
}

// ============ SYSTEM ENDPOINTS ============

app.get('/api/system/info', async (req, res) => {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpuCount = os.cpus().length;
    const uptime = os.uptime();

    res.json({
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      totalMemory: Math.round(totalMem / (1024 * 1024 * 1024)),
      freeMemory: Math.round(freeMem / (1024 * 1024 * 1024)),
      cpuCores: cpuCount,
      uptime: Math.round(uptime),
      nodeVersion: process.version
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/containers', async (req, res) => {
  try {
    const { stdout } = await execAsync('docker network inspect ac-network');
    if (!stdout.trim()) return res.json([]);
    const network = JSON.parse(stdout);
    const containers = [];
    if (network[0] && network[0].Containers) {
      for (const [name, info] of Object.entries(network[0].Containers)) {
        containers.push({
          id: info.EndpointID,
          name,
          status: info.Status,
          ports: info.IPv4Address
        });
      }
    }
    res.json(containers);
  } catch (err) {
    if (isDockerNotFound(err) || isNetworkNotFound(err)) {
      return res.json([]);
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/system/container/:action/:name', async (req, res) => {
  try {
    const { action, name } = req.params;
    await execAsync(`docker ${action} ${name}`);
    res.json({ success: true, message: `Container ${name} ${action}ed` });
  } catch (err) {
    if (isDockerNotFound(err) || isNetworkNotFound(err)) {
      return res.status(500).json({ error: 'Docker is not available inside this container.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============ SERVER STATUS ============

app.get('/api/server/status', async (req, res) => {
  try {
    const targetContainers = ['ac-authserver', 'ac-worldserver', 'ac-database'];
    const statuses = {};

    const { stdout } = await execAsync('docker network inspect ac-network');
    if (!stdout.trim()) {
      targetContainers.forEach(c => { statuses[c] = 'not_found'; });
      return res.json(statuses);
    }

    const network = JSON.parse(stdout);
    const networkContainers = network[0]?.Containers || {};

    for (const container of targetContainers) {
      if (networkContainers[container]) {
        statuses[container] = networkContainers[container].Status;
      } else {
        statuses[container] = 'not_found';
      }
    }

    res.json(statuses);
  } catch (err) {
    if (isDockerNotFound(err) || isNetworkNotFound(err)) {
      return res.json({
        'ac-authserver': 'not_found',
        'ac-worldserver': 'not_found',
        'ac-database': 'not_found'
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============ DATABASE MANAGEMENT ============

app.get('/api/db/schemas', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.query('SHOW DATABASES');
    res.json(rows.map(r => r.Database));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/db/query', async (req, res) => {
  try {
    const { database, query } = req.body;
    if (!database || !query) {
      return res.status(400).json({ error: 'Database and query required' });
    }

    const pool = await getDbPool();
    const connection = await pool.getConnection();
    try {
      const [rows] = await connection.query(query);
      res.json({ rows, rowCount: rows.length });
    } finally {
      connection.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/db/tables', async (req, res) => {
  try {
    const { database } = req.query;
    if (!database) {
      return res.status(400).json({ error: 'Database parameter required' });
    }

    const pool = await getDbPool();
    const [rows] = await pool.query(`SHOW TABLES FROM \`${database}\``);
    res.json(rows.map(r => r[`Tables_in_${database}`]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/db/stats', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.query(`
      SELECT table_schema as \`database\`, 
             ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb,
             COUNT(*) as table_count
      FROM information_schema.tables
      GROUP BY table_schema
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ CONFIGURATION ============

app.get('/api/config', async (req, res) => {
  try {
    const configDir = process.env.CONFIG_DIR || '/azerothcore/env/dist/etc';
    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.conf.dist') || f.endsWith('.conf'));
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/config/:filename', async (req, res) => {
  try {
    const configDir = process.env.CONFIG_DIR || '/azerothcore/env/dist/etc';
    const filePath = path.join(configDir, req.params.filename);
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ filename: req.params.filename, content });
  } catch (err) {
    res.status(404).json({ error: 'Configuration file not found' });
  }
});

app.post('/api/config/:filename', async (req, res) => {
  try {
    const configDir = process.env.CONFIG_DIR || '/azerothcore/env/dist/etc';
    const filePath = path.join(configDir, req.params.filename);
    fs.writeFileSync(filePath, req.body.content);
    res.json({ success: true, message: 'Configuration saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ LOG MANAGEMENT ============

app.get('/api/logs', async (req, res) => {
  try {
    const { container, lines = 100 } = req.query;
    if (!container) {
      return res.status(400).json({ error: 'Container parameter required' });
    }

    const { stdout } = await execAsync(`docker logs --tail ${lines} ${container} 2>&1`);
    res.json({ container, logs: stdout.split('\n').filter(Boolean) });
  } catch (err) {
    if (isDockerNotFound(err) || isNetworkNotFound(err)) {
      return res.status(500).json({ error: 'Docker is not available inside this container.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============ USER MANAGEMENT ============

app.get('/api/users', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.query('SELECT id, username, email, last_ip, failed_logins FROM account');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const pool = await getDbPool();
    const salt = require('crypto').randomBytes(32);
    const verifier = require('crypto').createHash('sha1').update(Buffer.concat([salt, Buffer.from(password)])).digest();
    await pool.query('INSERT INTO account (username, salt, verifier, email) VALUES (?, ?, ?, ?)',
      [username, salt, verifier, email || '']);
    res.json({ success: true, message: 'User created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const pool = await getDbPool();
    await pool.query('DELETE FROM account WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ BACKUP/RESTORE ============

app.post('/api/backup', async (req, res) => {
  try {
    const { databases = ['acore_auth', 'acore_world', 'acore_characters'] } = req.body;
    const backupDir = process.env.BACKUP_DIR || '/tmp/backups';
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(backupDir, `azerothcore-backup-${timestamp}.sql.gz`);

    const commands = databases.map(db => 
      `mysqldump -h${dbConfig.host} -u${dbConfig.user} -p${dbConfig.password} ${db}`
    ).join(' | ');

    await execAsync(`${commands} | gzip > ${archivePath}`);
    res.json({ success: true, path: archivePath, size: fs.statSync(archivePath).size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backups', async (req, res) => {
  try {
    const backupDir = process.env.BACKUP_DIR || '/tmp/backups';
    if (!fs.existsSync(backupDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql.gz'))
      .map(f => ({
        name: f,
        size: fs.statSync(path.join(backupDir, f)).size,
        date: fs.statSync(path.join(backupDir, f)).mtime
      }));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ LOGS (JSON) ============

async function getContainerIdByName(containerName) {
  try {
    const { stdout } = await execAsync('docker network inspect ac-network');
    if (!stdout.trim()) return null;
    const network = JSON.parse(stdout);
    const networkContainers = network[0]?.Containers || {};
    if (networkContainers[containerName]) {
      return networkContainers[containerName].EndpointID;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function dockerApiRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: '/var/run/docker.sock',
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`Docker API error ${res.statusCode}: ${data.toString()}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

app.get('/api/logs', async (req, res) => {
  try {
    const { container, lines = '100' } = req.query;
    const containerId = await getContainerIdByName(container);
    
    if (!containerId) {
      return res.status(404).json({ error: `Container '${container}' not found on ac-network` });
    }

    const { body } = await dockerApiRequest(
      `/containers/${containerId}/logs?stdout=1&stderr=1&tail=${lines}`,
      { headers: { 'X-Stream': 'true' } }
    );

    // Docker API returns logs with 8-byte header per line, strip it
    const logLines = [];
    let i = 0;
    while (i < body.length) {
      if (i + 8 > body.length) break;
      const header = body.slice(i, i + 8);
      const streamType = header[0]; // 1=stdout, 2=stderr
      const length = (header[4] << 24) | (header[5] << 16) | (header[6] << 8) | header[7];
      if (i + 8 + length > body.length) break;
      const logData = body.slice(i + 8, i + 8 + length);
      logLines.push(logData.toString('utf8').trim());
      i += 8 + length;
    }

    res.json({ logs: logLines });
  } catch (err) {
    if (err.message.includes('No such network') || err.message.includes('dial unix')) {
      return res.status(500).json({ error: 'Docker is not available inside this container.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============ DOWNLOAD LOGS ============

app.get('/api/download/logs/:container', async (req, res) => {
  try {
    const { container } = req.params;
    const containerId = await getContainerIdByName(container);
    
    if (!containerId) {
      return res.status(404).json({ error: `Container '${container}' not found on ac-network` });
    }

    const { body } = await dockerApiRequest(
      `/containers/${containerId}/logs?stdout=1&stderr=1&tail=1000`,
      { headers: { 'X-Stream': 'true' } }
    );

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${container}-logs.txt"`);
    res.send(body);
  } catch (err) {
    if (err.message.includes('No such network') || err.message.includes('dial unix')) {
      return res.status(500).json({ error: 'Docker is not available inside this container.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AzerothCore Manager running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
});
