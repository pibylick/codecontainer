# How I Run AI Coding Agents Safely Using Containers

AI coding tools are useful, but giving them direct access to your host machine is still a bad default.

They edit files quickly, install packages aggressively, and can easily leave a local environment in a worse state than they found it. That is manageable when you are careful, but it does not scale well once you start using multiple agents across multiple repositories.

This is why I built [`codecontainer`](https://github.com/pibylick/code-container): a local AI development environment for running Claude Code, Codex CLI, Gemini CLI, and OpenCode inside isolated project containers.

## The Problem With Running AI Coding Agents Directly on Your Host

If you run AI coding agents directly on your laptop or workstation, a few problems show up fast:

- they can modify the wrong files
- they can install or remove dependencies you did not want changed
- they can access secrets, SSH config, or tokens you forgot were available
- they can create inconsistent environments between projects

This gets worse if you are testing multiple tools, switching between repositories, or asking agents to do browser automation and end-to-end debugging.

The issue is not that AI coding agents are uniquely dangerous. The issue is that they are fast, persistent, and willing to try things. That means your execution environment matters much more.

## Why Containers Are the Right Default

Containers solve the obvious part of the problem:

- filesystem isolation
- repeatable setup
- dependency separation
- cleaner teardown

But Docker alone is not the full answer.

If you want a real local AI coding setup, you still need:

- per-project container management
- support for different agent CLIs
- persistent configuration across projects
- a safe way to keep browser tooling and other utilities available

That is the gap `codecontainer` tries to fill.

## What codecontainer Does

`codecontainer` creates an isolated container environment for each project and layers agent-specific workflow on top.

It currently supports:

- Claude Code
- Codex CLI
- Gemini CLI
- OpenCode

It also supports multiple container runtimes:

- Docker
- Podman on Linux
- Apple Container on macOS

The core idea is simple:

```text
Host machine
  -> codecontainer
  -> Project container
  -> AI coding agent
  -> Your codebase
```

Instead of letting the agent operate directly on your machine, you give it a containerized development environment with clearer boundaries.

## Why This Is Better Than a Hand-Rolled Docker Setup

You can absolutely build your own Docker workflow for this. Many developers already do.

The problem is that most hand-rolled setups stop at "there is a container."

For AI-assisted development, that still leaves a lot of manual work:

- wiring agent configs
- deciding what gets mounted
- keeping the environment persistent between sessions
- handling per-project differences
- exposing the right browser testing tools

`codecontainer` is opinionated about those details so you do not need to rebuild the same infrastructure for every repo.

## A Better Sandbox for AI Agents

One of the more interesting use cases is treating the container as an AI agents sandbox.

That means:

- destructive actions stay inside the container
- project state is isolated
- browser checks can run in the same environment
- you can let agents work more freely without handing them your full machine

This does not remove all risk. Network access and mounted files still matter. But it is a much better default than unrestricted local execution.

## Who This Is For

This approach is useful if you:

- use AI coding agents every day
- work across many repositories
- want a local AI development environment instead of a remote cloud IDE
- care about repeatability and isolation
- want a containerized dev environment with better defaults for AI tools

It is especially useful if you are experimenting with Claude Code, Codex CLI, Gemini CLI, or OpenCode and do not want each tool to mutate your host setup in slightly different ways.

## Try It

Repository: [github.com/pibylick/code-container](https://github.com/pibylick/code-container)

If you want a safer local AI coding workflow, start here:

```bash
npm install -g @pibylick/codecontainer
codecontainer init
codecontainer build
```

Then enter a project container and run your preferred AI coding agent inside it.

## Closing Thought

AI coding tools are getting more capable, which means environment design matters more, not less.

The question is no longer just "which coding agent should I use?"

It is also:

"What is the right execution environment for an agent that can change my codebase quickly?"

For local workflows, isolated containers are a strong answer.
