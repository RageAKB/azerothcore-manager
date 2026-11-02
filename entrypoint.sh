#!/bin/sh
# Backup directory is mounted from host and already writable
# Use mysql2 driver (which supports caching_sha2_password) to switch auth to mysql_native_password
node fix-auth.js
exec node main.js
