#!/bin/sh
# Backup directory is mounted from host and already writable
# Switch MySQL auth to mysql_native_password so mariadb-dump can connect
for i in 1 2 3 4 5; do
  MYSQL_PWD="${DB_PASSWORD:-}" mariadb --host="${DB_HOST:-ac-database}" --user="${DB_USER:-root}" --skip-ssl -e "ALTER USER '${DB_USER:-root}'@'%' IDENTIFIED WITH mysql_native_password BY '${DB_PASSWORD:-}'; FLUSH PRIVILEGES;" 2>/dev/null && break
  sleep 1
done
exec node main.js
