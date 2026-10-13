const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
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
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/:filename', async (req, res) => {
  try {
    const configDir = process.env.CONFIG_DIR || '/azerothcore/env/dist/etc';
    const filePath = path.join(configDir, req.params.filename);
    const content = req.body.content;
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, message: `Configuration saved: ${req.params.filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ USER MANAGEMENT ============

app.post('/api/users', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password required' });
    }

    const pool = await getDbPool();
    const [result] = await pool.query(
      'INSERT INTO account (username, salt, sha_pass_hash, email, joindate, ip) VALUES (?, ?, ?, ?, NOW(), ?)',
      [username, '', '', email, '127.0.0.1']
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.query('SELECT id, username, email, joindate, last_ip FROM account');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const pool = await getDbPool();
    await pool.query('DELETE FROM account WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ BACKUP ============

app.post('/api/backup', async (req, res) => {
  try {
    const { databases } = req.body;
    if (!databases || !Array.isArray(databases) || databases.length === 0) {
      return res.status(400).json({ error: 'Databases array required' });
    }

    const backupDir = process.env.BACKUP_DIR || '/azerothcore/backups';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.sql`);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const dumpCommands = databases.map(db => `mysqldump -h${dbConfig.host} -P${dbConfig.port} -u${dbConfig.user} -p${dbConfig.password} ${db}`).join(' && ');
    await execAsync(`${dumpCommands} > ${backupFile}`);

    res.json({ success: true, file: backupFile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backups', async (req, res) => {
  try {
    const backupDir = process.env.BACKUP_DIR || '/azerothcore/backups';
    const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql')).map(f => {
      const stat = fs.statSync(path.join(backupDir, f));
      return { name: f, size: stat.size, modified: stat.mtime };
    });
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

app.delete('/api/backups/:filename', async (req, res) => {
  try {
    const backupDir = process.env.BACKUP_DIR || '/azerothcore/backups';
    const filePath = path.join(backupDir, req.params.filename);
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ LOGS ============

const LOG_DIR = process.env.LOG_DIR || '/azerothcore-wotlk/env/dist/logs';

const KNOWN_LOG_FILES = [
  { name: 'Auth.log', label: 'Auth Server' },
  { name: 'DBImport.log', label: 'DB Import' },
  { name: 'Errors.log', label: 'Errors' },
  { name: 'Server.log', label: 'World Server' }
];

app.get('/api/logs', async (req, res) => {
  try {
    const { file, lines = '100' } = req.query;
    if (!file) {
      return res.status(400).json({ error: 'file parameter required' });
    }
    
    const filePath = path.join(LOG_DIR, file);
    if (!fs.existsSync(filePath)) {
      return res.json({ file, lines: [`Log file not found: ${file}`] });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n').filter(l => l.length > 0);
    const tailLines = allLines.slice(-parseInt(lines));
    
    res.json({ file, lines: tailLines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs/files', async (req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const stat = fs.statSync(path.join(LOG_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtime };
      });
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/download/logs/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(LOG_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Log file not found' });
    }
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ USER MANAGEMENT ============

app.get('/api/users', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.query(
      'SELECT id, username, email, active FROM account ORDER BY id DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const pool = await getDbPool();
    const salt = require('crypto').randomBytes(16).toString('hex').toUpperCase();
    const shaPass = require('crypto').createHash('sha1')
      .update(`${username}:${password}`)
      .digest('hex').toUpperCase();

    await pool.query(
      'INSERT INTO account (username, salt, sha_pass_hash, email, joindate, ip) VALUES (?, ?, ?, ?, NOW(), ?)',
      [username, salt, shaPass, email || '', '127.0.0.1']
    );

    res.json({ success: true, message: `User ${username} created` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getDbPool();
    await pool.query('DELETE FROM account WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
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
