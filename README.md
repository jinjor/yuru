# Yuru

Yuru is a session-centered editor for Claude Code and Codex CLI.

## Install

```sh
git clone git@github.com:jinjor/yuru.git
cd yuru
./install.sh
yuru latest
```

`install.sh` installs a thin `yuru` launcher into `~/bin`, creates a managed checkout in `~/.yuru/repo`, and prepares `~/Applications/Yuru.app` as the local app destination.

## Use

```sh
yuru
```

To update the managed checkout and rebuild the local app:

```sh
yuru latest
```

`yuru latest` updates `~/.yuru/repo`, runs `npm ci`, rebuilds the app, and replaces `~/Applications/Yuru.app`. It does not launch the app automatically.

## Trust Model

Yuru currently uses a local-build developer-tool workflow. `yuru latest` pulls `main`, installs dependencies with `npm ci`, and generates `Yuru.app` locally. This is different from using a signed/notarized macOS app bundle downloaded from a release.

Because the app is rebuilt locally, macOS privacy permissions may need to be re-approved after updates.
