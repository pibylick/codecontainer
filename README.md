# Claude Code Container

Isolated Docker environment for running Claude Code on projects with full system protection.

## Overview

- **Project Isolation**: One container per project with complete isolation
- **State Persistence**: All changes and packages persist between sessions
- **Shared Resources**: npm cache, pip cache, and Claude history shared across projects
- **Security**: Changes within a container don't affect your host or other projects

## Installation Details

- **Base**: Ubuntu 24.04 LTS with build essentials
- **Runtimes**: Node.js 22 LTS (via NVM), Python 3 with pip
- **Tools**: Claude Code, git, curl, wget
- **Mounts**: `~/.gitconfig`, `~/.ssh` (read-only from host)
- **Shared**: Claude history, npm cache, pip cache

## Initial Setup

### 1. Configure Claude

```bash
cp ~/.claude.json container.claude.json
```

### 2. Build Docker Image

```bash
./container.sh --build
```

Takes approximately 5 minutes.

### 3. Start Your Project

Navigate to your project directory and run:

```bash
cd /path/to/your/project
./container.sh
```

Or specify the path explicitly:

```bash
./container.sh /path/to/your/project
```

### 4. (Optional) Install as Global Command

To use `claude-container` from anywhere without the `./` prefix, create a symbolic link:

```bash
sudo ln -s "$(pwd)/container.sh" /usr/local/bin/claude-container
```

Then you can run from any directory:

```bash
cd /path/to/your/project
claude-container          # Uses current directory
claude-container --list
```

Or specify a path explicitly:

```bash
claude-container /path/to/your/project
```

## Usage

**Start a project:**
```bash
cd /path/to/your/project
claude-container
```

**Inside the container:**
```bash
claude-code
npm install package-name
pip install package-name
exit
```

All state is saved. Next time you run the script from the same project directory, you'll resume where you left off.

## Common Commands

```bash
claude-container --list           # List all containers
claude-container --stop           # Stop the current project's container
claude-container --remove         # Remove the current project's container
claude-container --build          # Rebuild Docker image

# Or with explicit path:
claude-container --stop /path/to/project
claude-container --remove /path/to/project
```

## What Persists

**Per-Project Container:**
- All installed system packages, npm packages, Python packages
- All file modifications, databases, shell history
- Container filesystem state

**Shared Across All Projects:**
- Claude configuration and conversation history
- npm and pip download caches
- Python user packages

**Read from Host (Not Persisted):**
- Git configuration, SSH keys

## Simultaneous Work (You + Claude Code)

Both you and Claude Code can work on the project simultaneously:

**Safe:**
- File editing (bind mount supports concurrent access)
- Reading files
- Most development operations

**Potential Issues:**
- Git operations from both sides simultaneously
- Installing different versions of `node_modules` from container vs host
- File editor locks (rare)

**Recommended Workflow:**
1. Let Claude Code work autonomously in the container
2. Review changes from host after completion
3. Or: Do git operations from host only

## Container Naming

Containers are named based on project path: `claude-{project-name}-{path-hash}`

Example: `/Users/clippy/my-app` → `claude-my-app-a1b2c3d4`

Different containers for projects with the same name in different directories.

## Customization

**Add Tools:**

Edit `Dockerfile` and rebuild:
```dockerfile
RUN apt-get update && apt-get install -y postgresql-client redis-tools && rm -rf /var/lib/apt/lists/*
```

**Change Shared Volumes:**

Edit `container.sh`:
```bash
-v "$SCRIPT_DIR/new-shared-dir:/root/target-path" \
```

## Security

- Container runs as root
- No network restrictions
- SSH keys mounted read-only
- Project isolation: changes don't affect other containers or host
- Host protection: container can't access host filesystem outside mounted directories

## Tips

- Use `./container.sh --list` regularly to track containers
- Remove containers for completed projects to save disk space
- Back up `./.claude/` to preserve conversation history
- Use `docker system prune -a` to clean up unused Docker data
