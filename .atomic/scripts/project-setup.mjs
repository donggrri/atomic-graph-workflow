#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeProjectSettings, readProjectSettings } from "./lib/project-settings.mjs";
import { confirm, isInteractiveTTY, select, text } from "./lib/prompt.mjs";
import { runDoctor } from "./doctor.mjs";
import { ensureCommandTrusted } from "./lib/command-trust.mjs";
import { collectExecutorChoices } from "./lib/project-setup-executors.mjs";
import { parseExecutorTimeouts } from "./lib/workflow-settings.mjs";

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
  const existing = readProjectSettings(root);

  /** @type {Record<string, unknown>} */
  const patch = {};

  const agyStages = ["plan", "implement", "review"];
  const priorAgy =
    existing.agy && typeof existing.agy === "object" && !Array.isArray(existing.agy)
      ? existing.agy
      : {};
  /** @type {Record<string, string>} */
  const agy = {};
  for (const stage of agyStages) {
    const label =
      stage === "plan" ? "계획" : stage === "implement" ? "구현" : "리뷰";
    const def =
      typeof priorAgy[stage] === "string"
        ? priorAgy[stage]
        : stage === "plan"
          ? "sdk"
          : "ask";
    const value = interactive
      ? await select(
          `${label} 단계 AGY 정책`,
          [
            { value: "ask", label: "물어보기 (ask)" },
            { value: "sdk", label: "Cursor SDK (sdk)" },
            { value: "agy", label: "AGY 위임 (agy) — 무승인 실행 주의" },
          ],
          def,
        )
      : def;
    if (!interactive && priorAgy[stage]) {
      agy[stage] = priorAgy[stage];
    } else {
      agy[stage] = value;
    }
  }
  if (interactive || Object.keys(agy).some((k) => agy[k] !== priorAgy[k])) {
    patch.agy = { ...priorAgy, ...agy };
  }

  const detectedTest = detectTestDoneCommand(root);
  const priorTest =
    typeof existing.testDone === "string" && existing.testDone.trim()
      ? existing.testDone.trim()
      : detectedTest;
  const testDone = interactive
    ? await text(`작업 완료 확인 명령 (test.done)`, priorTest)
    : priorTest;
  if (!interactive && existing.testDone) {
    // keep existing
  } else {
    patch.testDone = testDone;
  }

  // The workflow no longer selects models; drop a legacy value instead of carrying it forward.
  const dropKeys = existing.agyModel != null ? ["agyModel"] : [];
  // Legacy `artifacts` block is unified onto `docsRoot`; never write it back.
  if (existing.artifacts != null) dropKeys.push("artifacts");

  const priorDocsRoot =
    typeof existing.docsRoot === "string" && existing.docsRoot.trim()
      ? existing.docsRoot.trim()
      : null;
  let docsRootChoice = priorDocsRoot;
  // --artifacts is an alias that writes docsRoot only.
  if (options.artifacts != null && String(options.artifacts).trim() !== "") {
    const { parseArtifactsFlag } = await import("./lib/artifacts.mjs");
    const parsed = parseArtifactsFlag(String(options.artifacts));
    if (!parsed.ok) throw new Error(parsed.reason);
    docsRootChoice = parsed.docsRoot;
    if (docsRootChoice !== priorDocsRoot) {
      if (docsRootChoice == null) {
        if (!dropKeys.includes("docsRoot")) dropKeys.push("docsRoot");
      } else {
        patch.docsRoot = docsRootChoice;
      }
    }
  } else if (!interactive && priorDocsRoot == null && existing.artifacts != null) {
    // Non-interactive migration: honor legacy artifacts once, then drop it.
    const { docsRootFromLegacyArtifacts } = await import("./lib/artifacts.mjs");
    const mapped = docsRootFromLegacyArtifacts(existing.artifacts);
    if (mapped != null) {
      docsRootChoice = mapped;
      patch.docsRoot = mapped;
    } else {
      docsRootChoice = null;
    }
  }
  if (interactive) {
    const defaultChoice = !priorDocsRoot
      ? "global"
      : priorDocsRoot === "work-docs"
        ? "work-docs"
        : "custom";
    const choice = await select(
      "문서 저장 위치 선택 (docsRoot)",
      [
        { value: "global", label: "전역 디렉터리 (기본값: ~/.cursor-atomic-workflow/docs/...)" },
        { value: "work-docs", label: "저장소 내부 work-docs/ (추천: 팀 PR 리뷰 및 harness 호환)" },
        { value: "custom", label: "사용자 정의 상대 경로" },
      ],
      defaultChoice,
    );
    if (choice === "global") {
      docsRootChoice = null;
    } else if (choice === "work-docs") {
      docsRootChoice = "work-docs";
    } else {
      const customDefault = priorDocsRoot && priorDocsRoot !== "work-docs" ? priorDocsRoot : "work-docs";
      const custom = await text("사용자 정의 docsRoot (저장소 기준 상대 경로)", customDefault);
      const trimmed = custom.trim();
      if (!trimmed) throw new Error("docsRoot: empty path");
      if (trimmed.includes("\0")) throw new Error("docsRoot: must not contain null bytes");
      docsRootChoice = trimmed;
    }
    if (docsRootChoice !== priorDocsRoot) {
      if (docsRootChoice == null) {
        dropKeys.push("docsRoot");
      } else {
        patch.docsRoot = docsRootChoice;
      }
    }
  }

  if (!existing.profile) patch.profile = "atomic";

  const configureExecutors = interactive
    ? (await confirm("단계별 executor를 지금 설정할까요? (고급)", { default: false }))
    : false;
  if (configureExecutors) {
    const collected = await collectExecutorChoices(
      true,
      existing.executors && typeof existing.executors === "object" ? existing.executors : {},
    );
    patch.executors = collected.executors;
    if (Object.keys(collected.trustedExecutors).length > 0) {
      patch.trustedExecutors = {
        ...(existing.trustedExecutors && typeof existing.trustedExecutors === "object"
          ? existing.trustedExecutors
          : {}),
        ...collected.trustedExecutors,
      };
    }
    if (interactive) {
      const timeoutsJson = await text(
        `executorTimeouts (분, JSON — 예: {"memory":10,"execute":90}; 비우면 기본 45)`,
        existing.executorTimeouts ? JSON.stringify(existing.executorTimeouts) : "",
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

  writeProjectSettings(root, patch, { dropKeys });
  {
    const effective = docsRootChoice ?? null;
    if (typeof effective === "string" && effective) {
      const { isAbsolute, sep } = await import("node:path");
      const isRelative = !isAbsolute(effective) && !effective.startsWith("~");
      let insideRepo = isRelative;
      if (!insideRepo && isAbsolute(effective)) {
        const base = resolve(root);
        const abs = resolve(effective);
        insideRepo = abs === base || abs.startsWith(base + sep);
      }
      if (insideRepo) {
        const { artifactsRepoNote } = await import("./lib/artifacts.mjs");
        console.log(artifactsRepoNote(effective));
      }
    }
  }
  const trust = await ensureCommandTrusted(
    typeof patch.testDone === "string" ? patch.testDone : priorTest,
    { repoRoot: root, nonInteractive: !interactive },
  );
  if (!trust.ok) {
    throw new Error(trust.reason);
  }

  if (!options.skipDoctor) {
    const doctor = await runDoctor({ cwd: root, harness: "auto" });
    return { settings: patch, doctorOk: doctor.ok, doctorProblems: doctor.problems };
  }
  return { settings: patch, doctorOk: true, doctorProblems: [] };
}

if (process.argv[1]?.endsWith("project-setup.mjs")) {
  const targetIdx = process.argv.indexOf("--target");
  const target = targetIdx !== -1 && process.argv[targetIdx + 1]
    ? resolve(process.argv[targetIdx + 1])
    : process.cwd();
  const artifactsIdx = process.argv.indexOf("--artifacts");
  const artifacts = artifactsIdx !== -1 && process.argv[artifactsIdx + 1]
    ? process.argv[artifactsIdx + 1]
    : undefined;
  runProjectSetup(target, artifacts !== undefined ? { artifacts } : {})
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      if (!res.doctorOk) process.exit(1);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
