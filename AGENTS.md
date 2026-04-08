# Project Guidelines

## Development

After editing files, rebuild and restart the app:

```sh
npm run build
pkill -f "electron \." 2>/dev/null; sleep 0.5; npm run run
```

`npm run run` should be run in the background.

## Docs

- Product backlog: `docs/backlog.md`
- Architecture notes: `docs/architecture.md`
