# Coding Guidelines

## In-File Order

- Organize files for top-down reading.
- Put exported or public entry points first.
- Put private subcomponents and local helper functions below the exported code that uses them.

## Dependencies

- Do not create runtime import cycles between files. Type-only cycles between files are allowed.
- Sibling directories may depend on each other in one direction, but must not form a cycle. Directory cycles include type-only imports and re-exports.

## Shared UI Components

- `src/renderer/ui` holds the controls used across the whole app: `Modal`, `Button`, `IconButton`, `Tab`, `TextInput`, `EmptyState`.
- A control belongs here only when unrelated features already need the same thing. Parts used by a single feature stay next to that feature, and no wrapper is added just to hide a plain DOM element.
- Keep these components as narrow as the current call sites require. Do not add options for cases the app does not have yet.
- Each component owns one class name (`.button`, `.icon-button`, …) that carries the whole look. A feature may add its own class for a real deviation such as positioning, not to restate the base style.
