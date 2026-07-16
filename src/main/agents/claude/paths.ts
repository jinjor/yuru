import os from "os";
import path from "path";

const claudeDir = path.join(os.homedir(), ".claude");
const sessionsDir = path.join(claudeDir, "sessions");
const projectsDir = path.join(claudeDir, "projects");
const historyPath = path.join(claudeDir, "history.jsonl");

export function claudeHistoryPath(): string {
  return historyPath;
}

export function claudeProjectsPath(): string {
  return projectsDir;
}

export function claudeSessionFilePath(project: string, sessionId: string): string {
  return path.join(projectsDir, project.replace(/[/.]/g, "-"), `${sessionId}.jsonl`);
}

export function pidFilePath(pid: number): string {
  return path.join(sessionsDir, `${pid}.json`);
}
