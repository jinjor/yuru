---
name: yuru
description: Operate Yuru from an agent session to create task worktrees and start Claude, Codex, or Kimi sessions. Use when the user asks to use Yuru, branch or fork work into a new worktree, create a separate task worktree, or delegate work to another Yuru session.
---

# Yuru

Use the CLI path injected into the Yuru terminal. Run it through Node:

```sh
node "$YURU_CLI" <command>
```

Do not modify Yuru metadata or create Yuru task worktrees directly with Git. Use these commands so the running Yuru app can own the operation and update its UI.

## Check the connection

```sh
node "$YURU_CLI" ping
```

This prints `pong` when the current terminal can reach the running Yuru app.

## Create a task worktree

```sh
node "$YURU_CLI" worktree create <branch-name>
```

Run this from a Yuru task worktree session. The result prints the new worktree's absolute path and branch name. Keep the returned path if a session will be created for that worktree.

## Create a session

```sh
node "$YURU_CLI" session create \
  --worktree <absolute-worktree-path> \
  --provider <claude|codex|kimi>
```

To select a model, add:

```sh
--model <model>
```

Yuru passes the value unchanged to the selected provider's `--model` option.

To make a prompt the session's first user message, add:

```sh
--prompt <text>
```

Yuru passes the text to the selected provider as the session's first user message.

## Exchange data through a file

You may need to pass data between sessions through a file: a prompt too large for `--prompt`, a result the caller will read later, or content that multiple sessions share or append to. File-based exchange is optional; when `--prompt` is enough, use `--prompt`.

The main case for a file is when a session you created needs to send a result back to you. You can tell the new session what to do through `session create --prompt`, but the new session has no API to call you back. Reserve a file path, include it in the prompt, and tell the new session to write its result there.

Because sessions share the same filesystem, keep the following in mind:

- **Avoid collisions with other sessions.** If two sessions write to the same path at the same time, one may read partial or mixed content. Use a session- or task-specific path. Creating a unique temporary directory with `mktemp -d` is one easy way; a task-scoped path such as `/tmp/f99-some-feature/review.md` is also fine.

- **Do not let a watcher consume a partially written file.** When the reader watches for a file asynchronously ("read it once it exists"), the writer should write to a sibling temporary path and rename it to the final path only when the content is complete. The reader waits for the final path to appear. This prevents the reader from seeing the file while it is still being written.

You may share or append to the same file across sessions when the use case calls for it; just avoid collisions and partial-read issues.

## Find a session transcript

```sh
node "$YURU_CLI" session transcript-path [--worktree <absolute-worktree-path>]
```

This prints the absolute path of the task worktree's primary session transcript. Without `--worktree`, it uses the current Yuru task worktree. Yuru returns the path without reading the transcript.

## Handle errors

- If the CLI says the Yuru API is unavailable, run it inside a terminal created by the running Yuru app.
- If worktree creation says it requires a Yuru task worktree terminal, start from a task worktree session rather than a standalone terminal.
- Treat other CLI errors as operation failures and report them. Do not bypass the API by changing Git worktrees or Yuru metadata directly.
- In Codex, its sandbox may deny the Unix socket connection. If that happens, rerun the same CLI command with escalated execution and request the user's approval. Do not change the user's Codex configuration or enable broader network access.

The `yuru` directory name under `~/.agents/skills/` is reserved; place custom user skills there under a different directory name.
