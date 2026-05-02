import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
    const parentURL = context.parentURL;
    if (parentURL && parentURL.startsWith("file:")) {
      const parentPath = fileURLToPath(parentURL);
      const resolvedPath = path.resolve(path.dirname(parentPath), specifier);
      if (!existsSync(resolvedPath)) {
        const tsPath = resolvedPath.replace(/\.js$/, ".ts");
        if (existsSync(tsPath)) {
          return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
