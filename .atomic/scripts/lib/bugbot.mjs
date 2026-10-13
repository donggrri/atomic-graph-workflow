import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const BUGBOT_FAILED_MARKER = "BUGBOT_FAILED";

/**
 * @param {string} runsDir
 * @returns {string}
 */
export function bugbotFindingsPath(runsDir) {
  return join(runsDir, "bugbot-findings.md");
}

/**
 * @param {{
 *   repoRoot: string,
 *   slug: string,
 *   planPath: string,
 *   tasksPath: string,
 *   findingsPath: string,
 *   pass: number,
 * }} params
 */
export function buildBugbotCard({
  repoRoot,
  slug,
  planPath,
  tasksPath,
  findingsPath,
  pass,
}) {
  const prompt = [
    `Full Repository Path: ${repoRoot}`,
    "Diff: branch changes",
    `Custom Instructions: cursor-atomic-workflow slug ${slug}, review pass ${pass}. Spec: PLAN ${planPath}, TASKS ${tasksPath}. Report only concrete bugs in the branch changes.`,
  ].join("\n");

  return {
    kind: "bugbot",
    description: "Bugbot",
    subagent_type: "bugbot",
    run_in_background: false,
    pass,
    findingsPath,
    prompt,
  };
}

/**
 * @param {string} path
 * @returns {{ present: boolean, failed: boolean }}
 */
export function readBugbotFindings(path) {
  if (!existsSync(path)) {
    return { present: false, failed: false };
  }

  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    const failed = line.includes(BUGBOT_FAILED_MARKER);
    return { present: true, failed };
  }

  return { present: true, failed: false };
}

/**
 * @param {{
 *   bugbot: { pass?: number, status?: string },
 *   pass: number,
 *   runsDir: string,
 *   repoRoot: string,
 *   slug: string,
 *   planPath: string,
 *   tasksPath: string,
 * }} params
 */
export function bugbotGate({
  bugbot,
  pass,
  runsDir,
  repoRoot,
  slug,
  planPath,
  tasksPath,
}) {
  const findingsPath = bugbotFindingsPath(runsDir);
  const priorPass = bugbot.pass ?? 0;
  const priorStatus = bugbot.status ?? "pending";

  if (priorPass === pass && priorStatus === "ready") {
    const { failed } = readBugbotFindings(findingsPath);
    return {
      status: "ready",
      findingsPath,
      failed,
      bugbot: { pass, status: "ready" },
    };
  }

  if (priorPass === pass && priorStatus === "pending") {
    const findings = readBugbotFindings(findingsPath);
    if (findings.present) {
      return {
        status: "ready",
        findingsPath,
        failed: findings.failed,
        bugbot: { pass, status: "ready" },
      };
    }

    mkdirSync(runsDir, { recursive: true });
    const card = buildBugbotCard({
      repoRoot,
      slug,
      planPath,
      tasksPath,
      findingsPath,
      pass,
    });
    writeFileSync(join(runsDir, "next-card.json"), JSON.stringify(card), "utf8");
    return {
      status: "pending",
      card,
      bugbot: { pass, status: "pending" },
    };
  }

  mkdirSync(runsDir, { recursive: true });
  if (existsSync(findingsPath)) {
    const archivePath = join(runsDir, `bugbot-findings.pass${priorPass}.md`);
    copyFileSync(findingsPath, archivePath);
    unlinkSync(findingsPath);
  }

  const card = buildBugbotCard({
    repoRoot,
    slug,
    planPath,
    tasksPath,
    findingsPath,
    pass,
  });

  writeFileSync(join(runsDir, "next-card.json"), JSON.stringify(card), "utf8");
  process.stdout.write(`${JSON.stringify(card)}\n`);
  appendFileSync(
    join(runsDir, "pipeline.log"),
    `bugbot card pending: pass ${pass}, findings ${findingsPath}\n`,
    "utf8"
  );

  return {
    status: "pending",
    card,
    bugbot: { pass, status: "pending" },
  };
}
