#!/bin/bash
# ABOUTME: Shared SSH key setup script used by entrypoint and commands.ts.
# ABOUTME: Copies host SSH keys to /root/.ssh-local with correct ownership/permissions.

# Determine source path: new containers mount to /root/.ssh-host,
# old containers (pre-entrypoint) may still have /root/.ssh directly.
SSH_SOURCE=""
[ -d /root/.ssh-host ] && SSH_SOURCE="/root/.ssh-host"
[ -z "$SSH_SOURCE" ] && [ -d /root/.ssh ] && SSH_SOURCE="/root/.ssh"
[ -z "$SSH_SOURCE" ] && exit 0

SSH_LOCAL="/root/.ssh-local"
rm -rf "$SSH_LOCAL"
cp -a "$SSH_SOURCE" "$SSH_LOCAL" 2>/dev/null
chown -R root:root "$SSH_LOCAL" 2>/dev/null
chmod 700 "$SSH_LOCAL"
chmod 600 "$SSH_LOCAL"/* 2>/dev/null

# Configure GIT_SSH_COMMAND in shell profiles — matches logic from
# commands.ts:fixSshOwnership() with multiple identity files and
# explicit known_hosts path.
SSH_CMD='export GIT_SSH_COMMAND="ssh -F /dev/null -o IdentityFile=/root/.ssh-local/id_ed25519 -o IdentityFile=/root/.ssh-local/id_rsa -o UserKnownHostsFile=/root/.ssh-local/known_hosts -o StrictHostKeyChecking=no"'
for profile in /root/.bashrc /root/.zshrc; do
  grep -q "ssh-local" "$profile" 2>/dev/null || echo "$SSH_CMD" >> "$profile"
done
