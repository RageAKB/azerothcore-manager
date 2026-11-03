#!/bin/sh
# Backup directory is mounted from host and already writable
# Connect to ac-network so we can reach ac-* containers by name
echo "Connecting to ac-network..."
for i in $(seq 1 10); do
  if docker network connect ac-network $(hostname) 2>/dev/null; then
    echo "Connected to ac-network"
    break
  fi
  echo "Attempt $i failed, retrying in 2s..."
  sleep 2
done
echo "Starting app..."
exec node main.js
