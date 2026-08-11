# Coding Guidelines

## In-File Order

- Organize files for top-down reading.
- Put exported or public entry points first.
- Put private subcomponents and local helper functions below the exported code that uses them.

## Dependencies

- Do not create runtime import cycles between files. Type-only cycles between files are allowed.
- Sibling directories may depend on each other in one direction, but must not form a cycle. Directory cycles include type-only imports and re-exports.
