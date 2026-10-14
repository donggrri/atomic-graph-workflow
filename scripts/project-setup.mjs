#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeProjectSettings } from "./lib/project-settings.mjs";
import { confirm, isInteractiveTTY, select, text } from "./lib/prompt.mjs";
import { runDoctor } from "./doctor.mjs";
import { ensureCommandTrusted } from "./lib/command-trust.mjs";
import { collectExecutorChoices } from "./lib/project-setup-executors.mjs";
import { parseExecutorTimeouts } from "./lib/workflow-settings.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * @param {string} repoRoot
 */
export function detectTestDoneCommand(repoRoot) {
  const pkgPath = join(repoRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.test) return "npm test";
    } catch {
      // ignore
    }
  }
  if (existsSync(join(repoRoot, "Makefile"))) return "make test";
  if (existsSync(join(repoRoot, "pyproject.toml"))) return "pytest";
  return "npm test";
}

/**
 * @param {string} repoRoot
 * @param {{ interactive?: boolean }} [options]
 */
export async function runProjectSetup(repoRoot, options = {}) {
  const root = resolve(repoRoot);
  const interactive = options.interactive ?? isInteractiveTTY();

  /** @type {Record<string, unknown>} */
  const patch = {};

  const agyStages = ["plan", "implement", "review"];
  const agy = {};
  for (const stage of agyStages) {
    const label =
      stage === "plan" ? "계획" : stage === "implement" ? "구현" : "리뷰";
    const value = interactive
      ? await select(
          `${label} 단계 AGY 정책`,
          [
            { value: "ask", label: "물어보기 (ask)" },
            { value: "sdk", label: "Cursor SDK (sdk)" },
            { value: "agy", label: "AGY 위임 (agy) — 무승인 실행 주의" },
          ],
          stage === "plan" ? "sdk" : "ask",
        )
      : stage === "plan"
        ? "sdk"
        : "ask";
    agy[stage] = value;
  }
  patch.agy = agy;

  const detectedTest = detectTestDoneCommand(root);
  const testDone = interactive
    ? await text(`작업 완료 확인 명령 (test.done)`, detectedTest)
    : detectedTest;
  patch.testDone = testDone;

  const agyModel = interactive
    ? await text("AGY 모델 (비우면 agy 기본)", "")
    : "";
  if (agyModel.trim()) patch.agyModel = agyModel.trim();

  patch.profile = "atomic";

  const configureExecutors = interactive
    ? (await confirm("단계별 executor를 지금 설정할까요? (고급)", { default: false }))
    : false;
  if (configureExecutors) {
    patch.executors = await collectExecutorChoices(true);
    if (interactive) {
      const timeoutsJson = await text(
        `executorTimeouts (분, JSON — 예: {"memory":10,"execute":90}; 비우면 기본 45)`,
        "",
      );
      if (timeoutsJson.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(timeoutsJson.trim());
        } catch {
          throw new Error("executorTimeouts: invalid JSON");
        }
        const parsedTimeouts = parseExecutorTimeouts(parsed, "project settings");
        if (!parsedTimeouts.ok) {
          throw new Error(parsedTimeouts.reason);
        }
        if (Object.keys(parsedTimeouts.executorTimeouts).length > 0) {
          patch.executorTimeouts = parsedTimeouts.executorTimeouts;
        }
      }
    }
  }

  if (interactive) {
    const commitShared = await confirm(
      ".atomic · .agents/skills · .cursor/agents 를 git에 커밋하고 output.log* 를 .gitignore에 추가할까요?",
      { default: true },
    );
    if (commitShared) {
      patch.gitignorePolicy = "shared";
    }
    const hook = await confirm(
      "Cursor memory sweep hook 을 켤까요? (미구현 — 설정만 저장)",
      { default: false },
    );
    if (hook) patch.memorySweepHook = true;
  }

  writeProjectSettings(root, patch);
  await ensureCommandTrusted(testDone, { nonInteractive: !interactive });

  if (!options.skipDoctor) {
    const doctor = await runDoctor({ cwd: root, harness: "auto" });
    return { settings: patch, doctorOk: doctor.ok, doctorProblems: doctor.problems };
  }
  return { settings: patch, doctorOk: true, doctorProblems: [] };
}

if (process.argv[1]?.endsWith("project-setup.mjs")) {
  const target = process.argv.includes("--target")
    ? resolve(process.argv[process.argv.indexOf("--target") + 1])
    : process.cwd();
  runProjectSetup(target)
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      if (!res.doctorOk) process.exit(1);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
