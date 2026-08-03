# Yuru

Yuru is a session-centered editor for Claude Code and Codex CLI.

Current local-app workflow is supported on macOS only.
Updating and building Yuru requires npm 11.16.0 or later.

## Install

```sh
mkdir -p "$HOME/.yuru" && git clone git@github.com:jinjor/yuru.git "$HOME/.yuru/repo" && "$HOME/.yuru/repo/install.sh"
```

`install.sh` uses the clone at `~/.yuru/repo` as its managed checkout, installs a thin `yuru` launcher at `~/.yuru/bin/yuru`, and builds `~/Applications/Yuru.app`. If `~/.yuru/bin` is not already on `PATH`, the installer then prints zsh commands that can be copied and run to configure it. The installer does not edit shell configuration files itself.

## Use

```sh
yuru
```

To register a repository in Yuru:

```sh
yuru add /path/to/repo
```

To update the managed checkout and rebuild the local app:

```sh
yuru latest
```

`yuru latest` updates `~/.yuru/repo` and the installed launcher, audits the locked dependencies, runs `npm ci`, rebuilds the app, and replaces `~/Applications/Yuru.app`. It does not launch the app automatically.

## Trust Model

Yuru currently uses a local-build developer-tool workflow. `yuru latest` pulls `main`, installs dependencies with `npm ci`, and generates `Yuru.app` locally. This is different from using a signed/notarized macOS app bundle downloaded from a release.

Because the app is rebuilt locally, macOS privacy permissions may need to be re-approved after updates.
