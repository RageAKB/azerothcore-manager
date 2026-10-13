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
    const { stdout } = await execAsync('docker ps --format "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"');
    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, status, ports] = line.split('\t');
      return { id, name, status, ports };
    });
    res.json(containers);
  } catch (err) {
    if (isDockerNotFound(err)) {
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
    if (isDockerNotFound(err)) {
      return res.status(500).json({ error: 'Docker is not available inside this container.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============ SERVER STATUS ============

app.get('/api/server/status', async (req, res) => {
  try {
    const containers = ['ac-authserver', 'ac-worldserver', 'ac-database'];
    const statuses = {};

    for (const container of containers) {
      try {
        const { stdout } = await execAsync(`docker inspect --format='{{.State.Status}}' ${container} 2>/dev/null`);
        statuses[container] = stdout.trim();
      } catch {
        statuses[container] = 'not_found';
      }
    }

    res.json(statuses);
  } catch (err) {
    if (isDockerNotFound(err)) {
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
    if (isDockerNotFound(err)) {
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

// ============ DOWNLOAD LOGS ============

app.get('/api/download/logs/:container', async (req, res) => {
  try {
    const { container } = req.params;
    const { stdout } = await execAsync(`docker logs --tail 1000 ${container} 2>&1`);
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${container}-logs.txt"`);
    res.send(stdout);
  } catch (err) {
    if (isDockerNotFound(err)) {
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
