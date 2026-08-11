import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getYuruClaudePluginDir, materializeYuruSkill } from "../../../src/main/api/skill-materializer.ts";

test("materializeYuruSkill は共有 skill と Claude plugin を毎回上書きする", async (t) => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "yuru-skill-test-"));
  t.after(() => fs.promises.rm(tempDir, { recursive: true, force: true }));

  const sourceSkillPath = path.join(tempDir, "source", "SKILL.md");
  const agentsSkillsDir = path.join(tempDir, ".agents", "skills");
  const yuruHome = path.join(tempDir, ".yuru");
  const agentsSkillPath = path.join(agentsSkillsDir, "yuru", "SKILL.md");
  const pluginDir = getYuruClaudePluginDir(yuruHome);
  const pluginSkillPath = path.join(pluginDir, "skills", "yuru", "SKILL.md");
  const pluginManifestPath = path.join(pluginDir, ".claude-plugin", "plugin.json");

  await fs.promises.mkdir(path.dirname(sourceSkillPath), { recursive: true });
  await fs.promises.writeFile(sourceSkillPath, "first skill\n");

  await materializeYuruSkill({ sourceSkillPath, agentsSkillsDir, yuruHome });

  assert.equal(await fs.promises.readFile(agentsSkillPath, "utf8"), "first skill\n");
  assert.equal(await fs.promises.readFile(pluginSkillPath, "utf8"), "first skill\n");
  assert.deepEqual(JSON.parse(await fs.promises.readFile(pluginManifestPath, "utf8")), {
    name: "yuru",
    description: "Use Yuru to create task worktrees and start agent sessions.",
  });

  await fs.promises.writeFile(sourceSkillPath, "updated skill\n");
  await fs.promises.writeFile(pluginManifestPath, "stale manifest\n");
  await materializeYuruSkill({ sourceSkillPath, agentsSkillsDir, yuruHome });

  assert.equal(await fs.promises.readFile(agentsSkillPath, "utf8"), "updated skill\n");
  assert.equal(await fs.promises.readFile(pluginSkillPath, "utf8"), "updated skill\n");
  assert.deepEqual(JSON.parse(await fs.promises.readFile(pluginManifestPath, "utf8")), {
    name: "yuru",
    description: "Use Yuru to create task worktrees and start agent sessions.",
  });
});
