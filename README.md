# Code Container

Isolated Docker environment for running coding tools on projects with full system protection.

## Overview

- **Project Isolation**: One container per project with complete isolation
- **State Persistence**: All changes and packages persist between sessions
- **Shared Resources**: npm cache, pip cache, and Claude history shared across projects
- **Security**: Changes within a container don't affect your host or other projects

## Prerequisites

- **Docker** — [Install Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine
- **A POSIX-Compatible System** — Linux, MacOS, WSL

## Installation Details

- **Base**: Ubuntu 24.04 LTS with build essentials
- **Runtimes**: Node.js 22 LTS (via NVM), Python 3 with pip
- **Tools**: Claude Code, OpenCode, OpenAI Codex CLI, git, curl, wget
- **Mounts**: `~/.gitconfig`, `~/.ssh` (read-only from host)
- **Shared**: Claude history, npm cache, pip cache

## Initial Setup

### 1. Install as Global Command

To use `container` from anywhere, create a symbolic link in a PATH-tracked folder:

```bash
ln -s "$(pwd)/container.sh" /usr/local/bin/container
# Replace /usr/local/bin with any PATH tracked folder
```

Then you can run the `container` command from any directory:

```bash
cd /path/to/your/project
container          # Uses current directory
container --list
```

### 2. Configure Claude, OpenCode, and Codex

Copy your configuration directories into this repo. These configuration directories are shared across containers:

```bash
# Claude Code
cp -R ~/.claude ./.claude
cp ~/.claude.json container.claude.json

# OpenAI Codex
cp -R ~/.codex ./.codex

# OpenCode
cp -R ~/.config/opencode ./.opencode
```

### 3. Build Docker Image

Build the Docker container by running `container` with the `--build` flag:

```bash
container --build
```

You only need to do this once or whenever you wish to rebuild the Docker image.

## Usage

After building, you can start working safely with containers.

**Start a project:** To enter the container, navigate to the project directory and run `container`.
```bash
cd /path/to/your/project
container
```

**Inside the container:** Once inside the container environment, you can now let your harness run loose!
```bash
opencode
codex
npm install package-name
pip install package-name
exit
```

All container state is saved. Next time you run the script from the same project directory, you'll resume in the same container where you left off.

Conversations and settings for your harness will be shared across all containers.

## Common Commands

```bash
container                  # Enter the container
container --list           # List all containers
container --stop           # Stop the current project's container
container --remove         # Remove the current project's container
container --build          # Rebuild Docker image

# Or with explicit path:
container /path/to/project
container --stop /path/to/project
container --remove /path/to/project
```

## What Persists

**Per-Project Container:**
- All installed system packages, npm packages, Python packages
- All file modifications, databases, shell history
- Container filesystem state

**Shared Across All Projects:**
- Claude configuration and conversation history
- OpenAI Codex configuration/history
- npm and pip download caches
- Python user packages

**Read from Host (Not Persisted):**
- Git configuration, SSH keys

## Simultaneous Work

Both you and your harness can work on the project simultaneously:

**Safe:**
- File editing
- Reading files
- Most development operations

**Potential Issues:**
- Git operations from both sides simultaneously
- Installing different versions of `node_modules` from container vs host
- File editor locks (rare)

**Recommended Workflow:**
1. Let your harness work autonomously in the container
2. Work on the project independently on your system
3. Review changes from harness and commit

## Container Naming

Containers are named based on project path: `code-{project-name}-{path-hash}`

Example: `/Users/clippy/my-app` → `code-my-app-a1b2c3d4`

Different containers for projects with the same name in different directories.

## Customization

**Add Tools:**

Edit `Dockerfile` and rebuild:
```dockerfile
RUN apt-get update && apt-get install -y postgresql-client redis-tools && rm -rf /var/lib/apt/lists/*
```

**Add Shared Volumes:**

Edit the `docker run -it` command inside `container.sh` to add more shared volumes:
```bash
docker run -it \
... \
-v "$SCRIPT_DIR/new-shared-dir:/root/target-path" \
```

## Security

- Container runs as root
- No network restrictions
- SSH keys mounted read-only
- Project isolation: changes don't affect other containers or host
- Host protection: container can't access host filesystem outside mounted directories

## Tips

- Use `container --list` regularly to track containers
- Remove containers for completed projects to save disk space
- Back up `./.claude/` to preserve conversation history
- Use `docker system prune -a` to clean up unused Docker data
