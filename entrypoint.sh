#!/bin/sh
# Fix permissions on mounted backup directory so the node user can write
if [ -d /app/backups ]; then
    chmod 777 /app/backups
fi
exec node main.js
