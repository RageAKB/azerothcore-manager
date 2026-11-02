const mysql = require('mysql2/promise');

async function fixAuth() {
  const host = process.env.DB_HOST || 'ac-database';
  const port = parseInt(process.env.DB_PORT || '3306');
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || 'password';

  console.log('Connecting to MySQL to fix auth plugin...');
  for (let i = 0; i < 10; i++) {
    try {
      const conn = await mysql.createConnection({ host, port, user, password });
      await conn.query(
        "ALTER USER 'root'@'%' IDENTIFIED WITH mysql_native_password BY ?; FLUSH PRIVILEGES;",
        [password]
      );
      await conn.end();
      console.log('Auth plugin switched to mysql_native_password.');
      return;
    } catch (err) {
      console.log(`Attempt ${i + 1}/10 failed: ${err.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.error('Failed to fix auth plugin after 10 attempts.');
  process.exit(1);
}

fixAuth();
