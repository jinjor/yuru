import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// main は .js 付き、renderer は拡張子なしで隣のモジュールを import する
// (前者は tsc、後者は Vite の解決に合わせたもの)。どちらもテストからは .ts を読ませる。
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parentURL = context.parentURL;
    if (parentURL && parentURL.startsWith("file:")) {
      const parentPath = fileURLToPath(parentURL);
      const resolvedPath = path.resolve(path.dirname(parentPath), specifier);
      if (!existsSync(resolvedPath)) {
        const tsPath = specifier.endsWith(".js")
          ? resolvedPath.replace(/\.js$/, ".ts")
          : `${resolvedPath}.ts`;
        if (existsSync(tsPath)) {
          return nextResolve(
            specifier.endsWith(".js") ? specifier.replace(/\.js$/, ".ts") : `${specifier}.ts`,
            context,
          );
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
