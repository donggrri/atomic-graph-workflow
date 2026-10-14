import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const PLAN_REVIEW_DEFECTS_HEADING = "## 계획 결함";

const DEFECTS_SECTION_RE = /##\s*계획\s*결함\s*\n([\s\S]*?)(?:\n##\s|$)/;

/**
 * @param {string} docsDir
 * @param {string} slug
 * @returns {string}
 */
export function planReviewPath(docsDir, slug) {
  return join(docsDir, `PLAN-REVIEW-${slug}.md`);
}

/**
 * @param {string} text
 * @returns {{ wellFormed: boolean, hasDefects: boolean }}
 */
export function parsePlanReview(text) {
  const m = text.match(DEFECTS_SECTION_RE);
  if (!m) {
    return { wellFormed: false, hasDefects: false };
  }
  const body = m[1].trim();
  const hasDefects = body !== "없음" && body.length > 0;
  return { wellFormed: true, hasDefects };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function planReviewHasDefects(text) {
  return parsePlanReview(text).hasDefects;
}

/**
 * @param {string} repoRoot
 * @param {string} agentFile
 * @returns {string}
 */
function agentInstructionsPath(repoRoot, agentFile) {
  const candidates = [
    join(repoRoot, ".atomic", "agents", agentFile),
    join(repoRoot, ".cursor/agents", agentFile),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return join(homedir(), ".cursor/agents", agentFile);
}

/**
 * @param {{
 *   slug: string,
 *   round: number,
 *   repoRoot: string,
 *   planPath: string,
 *   planReviewPath: string,
 * }} params
 */
function buildCritiquePrompt({ slug, round, repoRoot, planPath, planReviewPath: outPath }) {
  const instructions = agentInstructionsPath(repoRoot, "plan-reviewer.md");
  return [
    `Critique PLAN for slug ${slug} (plan-review round ${round})`,
    `Instructions: ${instructions}`,
    `PLAN: ${planPath}`,
    `Write: ${outPath} with \`## 계획 결함\` (blocking, \`없음\` if none), \`## 개선 제안\`, \`## 수용된 위험\``,
  ].join("\n");
}

/**
 * @param {{
 *   slug: string,
 *   repoRoot: string,
 *   planPath: string,
 *   planReviewPath: string,
 * }} params
 */
function buildRevisePrompt({
  slug,
  repoRoot,
  planPath,
  planReviewPath: reviewPath,
  extraLines = [],
}) {
  const instructions = agentInstructionsPath(repoRoot, "planner.md");
  const lines = [
    `Revise PLAN for slug ${slug} (plan-review auto-revision 1/1)`,
    `Instructions: ${instructions}`,
    `PLAN: ${planPath}`,
    `PLAN-REVIEW: ${reviewPath}`,
    "Fix only `## 계획 결함` items. Keep `## 계획 정제` settled decisions. Append `## 자동 수정 기록`.",
  ];
  for (const line of extraLines) {
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

/**
 * @param {string} path
 * @returns {string}
 */
function sha256OfFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * @param {{
 *   ok: boolean,
 *   exitCode?: number,
 * }} run
 * @param {{
 *   awaiting: boolean,
 * }} pr
 * @returns {"parent"|"startup"|"failed"|null}
 */
function mapRunFailure(run, pr) {
  if (run.ok) {
    return null;
  }
  if (run.exitCode === 10) {
    return "parent";
  }
  pr.awaiting = false;
  if (run.exitCode === 50) {
    return "startup";
  }
  return "failed";
}

/**
 * @param {{
 *   planReview: object,
 *   slug: string,
 *   repoRoot: string,
 *   planPath: string,
 *   planReviewPath: string,
 *   runsDir: string,
 *   runRole: (role: string, prompt: string) => Promise<{ ok: boolean, exitCode?: number }>,
 *   isBlocked: (planText: string) => boolean,
 *   save: (planReview: object) => void,
 *   appendLog: (line: string) => void,
 * }} params
 */
export async function planReviewGate(params) {
  /** @type {{
   *   stage: string,
   *   round: number,
   *   revised: boolean,
   *   awaiting: boolean,
   *   planSha: string | null,
   *   approvedCopy: string | null,
   * }} */
  const pr = {
    stage: "review",
    round: 0,
    revised: false,
    awaiting: false,
    planSha: null,
    approvedCopy: null,
    ...params.planReview,
  };

  const planReviewDir = join(params.runsDir, "plan-review");

  while (true) {
    if (pr.stage === "passed") {
      return { outcome: "passed", planReview: pr };
    }

    if (pr.stage === "human") {
      pr.stage = "review";
      pr.awaiting = false;
      continue;
    }

    if (pr.stage === "review") {
      if (pr.awaiting) {
        if (!existsSync(params.planReviewPath)) {
          pr.awaiting = false;
          params.appendLog(
            `plan-review round ${pr.round}: PLAN-REVIEW missing or malformed (exit 30)`
          );
          return { outcome: "failed", planReview: pr };
        }
        const reviewText = readFileSync(params.planReviewPath, "utf8");
        const parsed = parsePlanReview(reviewText);
        if (!parsed.wellFormed) {
          pr.awaiting = false;
          params.appendLog(
            `plan-review round ${pr.round}: PLAN-REVIEW missing or malformed (exit 30)`
          );
          return { outcome: "failed", planReview: pr };
        }
        if (!parsed.hasDefects) {
          params.appendLog(`plan-review round ${pr.round}: passed`);
          pr.stage = "passed";
          pr.awaiting = false;
          return { outcome: "passed", planReview: pr };
        }
        if (!pr.revised) {
          params.appendLog(
            `plan-review round ${pr.round}: defects -> planner auto-revision (1/1)`
          );
          pr.stage = "revise";
          pr.awaiting = false;
          continue;
        }
        params.appendLog(
          `plan-review round ${pr.round}: defects remain -> human gate (exit 20)`
        );
        pr.stage = "human";
        pr.awaiting = false;
        return { outcome: "human", planReview: pr };
      }

      const planText = readFileSync(params.planPath, "utf8");
      if (params.isBlocked(planText)) {
        pr.stage = "human";
        return { outcome: "human", planReview: pr };
      }

      mkdirSync(planReviewDir, { recursive: true });
      if (existsSync(params.planReviewPath)) {
        const archivePath = join(planReviewDir, `PLAN-REVIEW.round${pr.round}.md`);
        copyFileSync(params.planReviewPath, archivePath);
        unlinkSync(params.planReviewPath);
      }
      pr.round += 1;
      pr.awaiting = true;
      params.save({ ...pr });

      const prompt = buildCritiquePrompt({
        slug: params.slug,
        round: pr.round,
        repoRoot: params.repoRoot,
        planPath: params.planPath,
        planReviewPath: params.planReviewPath,
      });
      const run = await params.runRole("plan-reviewer", prompt);
      const failure = mapRunFailure(run, pr);
      if (failure === "parent") {
        return { outcome: "parent", planReview: pr };
      }
      if (failure) {
        return { outcome: failure, planReview: pr };
      }
      continue;
    }

    if (pr.stage === "revise") {
      if (pr.awaiting) {
        pr.revised = true;
        const newSha = sha256OfFile(params.planPath);
        if (newSha === pr.planSha) {
          params.appendLog(
            "plan-review: planner did not modify PLAN -> human gate (exit 20)"
          );
          pr.stage = "human";
          pr.awaiting = false;
          return { outcome: "human", planReview: pr };
        }
        const planText = readFileSync(params.planPath, "utf8");
        if (params.isBlocked(planText)) {
          pr.stage = "human";
          pr.awaiting = false;
          return { outcome: "human", planReview: pr };
        }
        params.appendLog(
          `plan-review: PLAN auto-revised by planner; differs from user-approved PLAN (approved copy: ${pr.approvedCopy})`
        );
        pr.stage = "review";
        pr.awaiting = false;
        continue;
      }

      mkdirSync(planReviewDir, { recursive: true });
      if (!pr.approvedCopy) {
        const approvedPath = join(planReviewDir, `PLAN-${params.slug}.approved.md`);
        copyFileSync(params.planPath, approvedPath);
        pr.approvedCopy = approvedPath;
      }
      pr.planSha = sha256OfFile(params.planPath);
      pr.awaiting = true;
      params.save({ ...pr });

      const prompt = buildRevisePrompt({
        slug: params.slug,
        repoRoot: params.repoRoot,
        planPath: params.planPath,
        planReviewPath: params.planReviewPath,
        extraLines: params.plannerLines ?? [],
      });
      const run = await params.runRole("planner", prompt);
      const failure = mapRunFailure(run, pr);
      if (failure === "parent") {
        return { outcome: "parent", planReview: pr };
      }
      if (failure) {
        return { outcome: failure, planReview: pr };
      }
      continue;
    }

    throw new Error(`unknown plan-review stage: ${pr.stage}`);
  }
}
