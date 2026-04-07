#!/bin/bash
# ABOUTME: Idempotent entrypoint run on every container start.
# ABOUTME: Delegates SSH setup to fix-ssh.sh, configures git safe.directory.
/usr/local/bin/fix-ssh.sh
git config --system safe.directory '*' 2>/dev/null
exec "$@"
