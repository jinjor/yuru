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

To make a prompt the session's first user message, add exactly one of:

```sh
--prompt <text>
--prompt-file <path>
```

`--prompt-file` reads the file in the CLI process and sends its contents as the prompt. It does not move, retain, or delete the file.

When making a temporary prompt file, reserve a unique directory with `mktemp -d` and create the prompt inside it. Do not invent a fixed path under `/tmp`.

## Exchange a result through a file

When the new session needs to return a durable result to the calling session, reserve a unique directory and use a not-yet-created path inside it:

```sh
handoff_dir="$(mktemp -d)"
printf '%s/result.md\n' "$handoff_dir"
```

Keep the printed absolute path and include it in the new session's prompt. Tell the new session to write to a temporary sibling path and rename it to the requested result path only after the result is complete. This keeps a partial result distinct from a completed result.

The calling session can wait for the completed path to appear. Use the literal absolute path printed above when the wait runs in a separate shell invocation:

```sh
until [ -f <absolute-result-path> ]; do sleep 5; done
```

Do not use `mktemp` to create the result file itself: the file would already exist before the new session finishes writing it.

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
