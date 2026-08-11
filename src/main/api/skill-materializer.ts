import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getYuruHome } from "../yuru-home.js";

const CLAUDE_PLUGIN_MANIFEST = {
  name: "yuru",
  description: "Use Yuru to create task worktrees and start agent sessions.",
};

interface MaterializeYuruSkillOptions {
  sourceSkillPath: string;
  agentsSkillsDir?: string;
  yuruHome?: string;
}

export function getYuruClaudePluginDir(yuruHome = getYuruHome()): string {
  return path.join(yuruHome, "plugin");
}

export async function materializeYuruSkill(options: MaterializeYuruSkillOptions): Promise<void> {
  const agentsSkillsDir = options.agentsSkillsDir ?? path.join(os.homedir(), ".agents", "skills");
  const pluginDir = getYuruClaudePluginDir(options.yuruHome);
  const agentsSkillDir = path.join(agentsSkillsDir, "yuru");
  const pluginSkillDir = path.join(pluginDir, "skills", "yuru");
  const pluginMetadataDir = path.join(pluginDir, ".claude-plugin");

  await Promise.all([
    fs.promises.mkdir(agentsSkillDir, { recursive: true }),
    fs.promises.mkdir(pluginSkillDir, { recursive: true }),
    fs.promises.mkdir(pluginMetadataDir, { recursive: true }),
  ]);

  await Promise.all([
    fs.promises.copyFile(options.sourceSkillPath, path.join(agentsSkillDir, "SKILL.md")),
    fs.promises.copyFile(options.sourceSkillPath, path.join(pluginSkillDir, "SKILL.md")),
    fs.promises.writeFile(
      path.join(pluginMetadataDir, "plugin.json"),
      `${JSON.stringify(CLAUDE_PLUGIN_MANIFEST, null, 2)}\n`,
    ),
  ]);
}
