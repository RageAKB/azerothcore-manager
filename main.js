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
      const result = await connection.query(query);
      // SELECT returns [rows, fields]; DML returns { affectedRows, ... }
      const rows = Array.isArray(result) ? result[0] : result;
      const rowCount = Array.isArray(rows) ? rows.length : (rows.affectedRows || 0);
      res.json({ rows, rowCount });
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
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/:filename', async (req, res) => {
  try {
    const configDir = process.env.CONFIG_DIR || '/azerothcore/env/dist/etc';
    const filePath = path.join(configDir, req.params.filename);
    const { content } = req.body;
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ LOGS ============

app.get('/api/logs', async (req, res) => {
  try {
    const logDir = process.env.LOG_DIR || '/azerothcore/env/dist/logs';
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/logs/:filename', async (req, res) => {
  try {
    const logDir = process.env.LOG_DIR || '/azerothcore/env/dist/logs';
    const filePath = path.join(logDir, req.params.filename);
    const lines = parseInt(req.query.lines) || 200;
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n').reverse().slice(0, lines).reverse();
    res.json({ lines: allLines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download/logs/:filename', async (req, res) => {
  try {
    const logDir = process.env.LOG_DIR || '/azerothcore/env/dist/logs';
    const filePath = path.join(logDir, req.params.filename);
    res.download(filePath, req.params.filename);
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

    const backupDir = process.env.BACKUP_DIR || '/app/backups';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.sql.gz`);

    // Ensure backup directory exists and is writable
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o777 });
    }

    const pool = await getDbPool();
    const [dbs] = await pool.query('SHOW DATABASES');
    const dbNames = dbs.map(d => d.Database);

    const dbList = databases.filter(d => dbNames.includes(d));
    if (dbList.length === 0) {
      return res.status(400).json({ error: 'No valid databases selected' });
    }

    const dbArg = dbList.join(' ');
    // Use TCP connection with explicit host/user/password for mysqldump
    const dbHost = process.env.DB_HOST || 'ac-database';
    const dbUser = process.env.DB_USER || 'root';
    const dbPass = process.env.DB_PASSWORD || 'password';
    const cmd = `mysqldump --host=${dbHost} --user=${dbUser} --password=${dbPass} ${dbArg} | gzip > "${backupFile}"`;
    await execAsync(cmd);

    res.json({ success: true, message: `Backup created: ${backupFile}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backups', async (req, res) => {
  try {
    const backupDir = process.env.BACKUP_DIR || '/app/backups';
    if (!fs.existsSync(backupDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(backupDir).map(f => ({
      name: f,
      size: fs.statSync(path.join(backupDir, f)).size,
      date: fs.statSync(path.join(backupDir, f)).mtime
    }));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup/restore/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const backupDir = process.env.BACKUP_DIR || '/app/backups';
    const backupFile = path.join(backupDir, filename);

    if (!fs.existsSync(backupFile)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    const dbHost = process.env.DB_HOST || 'ac-database';
    const dbUser = process.env.DB_USER || 'root';
    const dbPass = process.env.DB_PASSWORD || 'password';
    const cmd = `gunzip -c "${backupFile}" | mysql --host=${dbHost} --user=${dbUser} --password=${dbPass}`;
    await execAsync(cmd);

    res.json({ success: true, message: `Backup restored from ${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/backup/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const backupDir = process.env.BACKUP_DIR || '/app/backups';
    const backupFile = path.join(backupDir, filename);

    if (!fs.existsSync(backupFile)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    fs.unlinkSync(backupFile);
    res.json({ success: true, message: `Backup deleted: ${filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ USER MANAGEMENT ============

app.get('/api/users', async (req, res) => {
  try {
    const pool = await getDbPool();
    const [rows] = await pool.query(`
      SELECT a.id, a.username, a.email, a.last_ip, a.expansion, a.locked,
             COALESCE(aa.gmlevel, 0) AS gmlevel,
             COALESCE(aa.comment, '') AS comment
      FROM account a
      LEFT JOIN account_access aa ON a.id = aa.id AND (aa.RealmID = -1 OR aa.RealmID = 0)
      ORDER BY a.id
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, email, password, gmlevel } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const pool = await getDbPool();

    // Check if account already exists
    const [existing] = await pool.query('SELECT id FROM account WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Account already exists' });
    }

    // AzerothCore uses SRP6 for password authentication:
    //   v = g^H(s || H(u || ":" || p)) mod N
    // where g=7, N=0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7
    const salt = require("crypto").randomBytes(32);
    const g = BigInt(7);
    const N = BigInt("0x894B645E89E1535BBDAD5B8B290650530801B18EBFBF5E8FAB3C82872A3E9BB7");
    const u = username.toUpperCase();
    const p = password.toUpperCase();
    const hUp = require("crypto").createHash("sha1").update(Buffer.from(`${u}:${p}`)).digest();
    const hS = require("crypto").createHash("sha1").update(Buffer.concat([salt, hUp])).digest();
    const exponent = BigInt("0x" + hS.toString("hex"));
    const v = BigInt.asUintN(256, modPow(g, exponent, N));
    const verifier = Buffer.from(v.toString(16).padStart(64, "0"), "hex");

    // gmlevel defaults to 0 (Player) if not specified
    const level = gmlevel !== undefined && gmlevel !== null ? parseInt(gmlevel) : 0;
    if (level < 0 || level > 3) {
      return res.status(400).json({ error: 'gmlevel must be 0 (Player), 1 (Moderator), 2 (Game Master), or 3 (Administrator)' });
    }

    // Insert into account table with ALL required NOT NULL fields set to defaults
    // Mimics what "account create <username> <password>" does
    const [result] = await pool.query(
      `INSERT INTO account 
       (username, salt, verifier, session_key, totp_secret, email, reg_mail, 
        last_ip, last_attempt_ip, failed_logins, locked, lock_country, 
        expansion, Flags, mutetime, mutereason, muteby, locale, os, recruiter, totaltime)
       VALUES (?, ?, ?, NULL, NULL, ?, '', ?, '', 0, 0, '00', 2, 0, 0, '', '', 0, '', 0, 0)`,
      [username, salt, verifier, email || '', '127.0.0.1']
    );

    const accountId = result.insertId;

    // Insert into account_access table with gmlevel
    // Mimics what "account set gmlevel <username> <level>" does
    await pool.query(
      'INSERT INTO account_access (id, gmlevel, RealmID, comment) VALUES (?, ?, -1, ?)',
      [accountId, level, 'Created via manager']
    );

    res.json({ success: true, message: `User ${username} created with gmlevel ${level}`, accountId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/gmlevel', async (req, res) => {
  try {
    const { id } = req.params;
    const { gmlevel } = req.body;

    const level = gmlevel !== undefined && gmlevel !== null ? parseInt(gmlevel) : 0;
    if (level < 0 || level > 3) {
      return res.status(400).json({ error: 'gmlevel must be 0 (Player), 1 (Moderator), 2 (Game Master), or 3 (Administrator)' });
    }

    const pool = await getDbPool();

    // Check account exists
    const [account] = await pool.query('SELECT id FROM account WHERE id = ?', [id]);
    if (account.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Upsert account_access entry
    await pool.query(
      `INSERT INTO account_access (id, gmlevel, RealmID, comment) VALUES (?, ?, -1, 'Updated via manager')
       ON DUPLICATE KEY UPDATE gmlevel = VALUES(gmlevel), comment = VALUES(comment)`,
      [id, level]
    );

    res.json({ success: true, message: `Account ${id} gmlevel set to ${level}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getDbPool();

    // Delete from account_access first (foreign key order)
    await pool.query('DELETE FROM account_access WHERE id = ?', [id]);
    // Then delete from account
    await pool.query('DELETE FROM account WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function modPow(base, exponent, modulus) {
  let result = BigInt(1);
  base = base % modulus;
  while (exponent > BigInt(0)) {
    if (exponent % BigInt(2) === BigInt(1)) {
      result = (result * base) % modulus;
    }
    exponent = exponent >> BigInt(1);
    base = (base * base) % modulus;
  }
  return result;
}



// ============ HEALTH CHECK ============

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ START SERVER ============

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AzerothCore Manager running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
});
