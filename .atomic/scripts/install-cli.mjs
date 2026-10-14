#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, cp, readdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runDoctor } from "./doctor.mjs";
import {
  install,
  parseInstallArgs,
  printInstallHelp,
  LEGACY_CURSOR_SKILLS,
} from "./install.mjs";
import { detectHarnessMarkers } from "./lib/harnesses.mjs";
import { detectHarnessClis, detectGitRepo } from "./lib/cli-detect.mjs";
import { confirm, isInteractiveTTY, multiselect, select, text } from "./lib/prompt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");

const HARNESS_LABELS = {
  cursor: "Cursor",
  agy: "AGY",
  opencode: "opencode",
  codex: "Codex",
  pi: "Pi",
  claude: "Claude Code",
};

async function listLegacySkillDirs(target) {
  const root = join(target, LEGACY_CURSOR_SKILLS);
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of await readdir(root)) {
    if (entry.startsWith("cursor-atomic-")) out.push(join(root, entry));
  }
  return out;
}

function printEnvCheck(clis) {
  const nodeOk = process.version.match(/^v(\d+)\.(\d+)/);
  const maj = nodeOk ? Number(nodeOk[1]) : 0;
  const min = nodeOk ? Number(nodeOk[2]) : 0;
  const nodeLine =
    maj > 22 || (maj === 22 && min >= 13)
      ? `Node ${process.version} ✓`
      : `Node ${process.version} (>=22.13 권장)`;
  const parts = [nodeLine, detectGitRepo(process.cwd()) ? "git ✓" : "git —"];
  for (const c of clis.filter((x) => x.id !== "claude")) {
    parts.push(`${c.id} ${c.installed ? "✓" : "✗"}`);
  }
  console.log("◇  환경 점검\n│  " + parts.join("   "));
}

/**
 * @param {import("./install.mjs").parseInstallArgs extends Function ? ReturnType<typeof parseInstallArgs> : never} opts
 */
async function runInteractiveInstall(opts) {
  console.log("┌  atomic-graph-workflow 설치\n│");
  const clis = detectHarnessClis();
  printEnvCheck(clis);

  let target = opts.target;
  const defaultTarget = resolve(target);
  const folder = await text("◇  설치할 폴더", defaultTarget);
  target = resolve(folder);
  if (!existsSync(target)) {
    const make = await confirm(`폴더가 없습니다. 만들까요? ${target}`, { default: true });
    if (!make) throw new Error("설치를 취소했습니다.");
    await mkdir(target, { recursive: true });
  }
  if (!detectGitRepo(target)) {
    console.log("│  ⚠ git 저장소가 아닙니다. 계속할 수 있지만 팀 공유 시 git 루트를 권장합니다.");
  }

  const markers = detectHarnessMarkers(target);
  const choices = clis
    .filter((c) => c.id !== "claude")
    .map((c) => ({
      value: c.id,
      label: c.label,
      hint: c.installed ? "설치됨" : "없음",
      selected: markers.has(c.id) || (markers.size === 0 && c.id === "cursor"),
    }));

  let harnessList = await multiselect("◆  어떤 도구에서 쓸까요?", choices);
  if (!harnessList.length) {
    throw new Error("하네스를 하나 이상 선택해야 합니다.");
  }

  const claudeDefault =
    existsSync(join(target, ".claude")) ||
    existsSync(join(target, "CLAUDE.md")) ||
    clis.find((c) => c.id === "claude")?.installed;
  const withClaude =
    (await select(
      "◆  Claude Code에도 설치할까요?",
      [
        { value: "no", label: "아니오" },
        { value: "yes", label: "예" },
      ],
      claudeDefault ? "yes" : "no",
    )) === "yes";
  if (withClaude) harnessList = [...harnessList, "claude"];

  const hasExisting =
    existsSync(join(target, ".atomic")) ||
    existsSync(join(target, ".agents")) ||
    (await listLegacySkillDirs(target)).length > 0;
  if (hasExisting && !opts.force) {
    const overwrite = await confirm("◆  기존 생성 파일을 덮어쓸까요?", { default: false });
    opts.force = overwrite;
  }

  const legacy = await listLegacySkillDirs(target);
  if (legacy.length && !opts.migrate) {
    console.log("│  레거시 스킬:");
    for (const p of legacy) console.log(`│    ${p}`);
    opts.migrate = await confirm("◆  레거시 .cursor/skills/cursor-atomic-* 를 제거할까요? (백업 후 삭제)", {
      default: false,
    });
  }
  const advancedExecutors = await confirm("◆  (고급) 단계별 executor 기본값을 지금 설정할까요?", {
    default: false,
  });
  let pendingProjectSettings = null;
  if (advancedExecutors) {
    const { collectExecutorChoices } = await import("./lib/project-setup-executors.mjs");
    const collected = await collectExecutorChoices(true);
    pendingProjectSettings = {
      executors: collected.executors,
      ...(Object.keys(collected.trustedExecutors).length
        ? { trustedExecutors: collected.trustedExecutors }
        : {}),
    };
  }

  const go = await confirm("◆  설치를 진행할까요?", { default: true });
  if (!go) throw new Error("설치를 취소했습니다.");

  if (pendingProjectSettings) {
    const { writeProjectSettings } = await import("./lib/project-settings.mjs");
    writeProjectSettings(target, pendingProjectSettings);
  }

  opts.harness = harnessList.join(",");
  opts.withClaude = withClaude;
  return target;
}

/**
 * @param {ReturnType<typeof parseInstallArgs>} opts
 */
async function printDryRunPreview(opts, root) {
  const res = await install({ ...opts, root, dryRun: true });
  console.log("◇  설치 미리보기 (dry-run)");
  for (const f of res.copied) console.log(`  + ${f}`);
  for (const f of res.overwritten) console.log(`  ~ ${f}`);
  for (const f of res.skipped) console.log(`  = 유지: ${f}`);
  if (res.removed.length) {
    for (const f of res.removed) console.log(`  - 제거: ${f}`);
  }
  console.log(`  하네스: ${res.harnesses.join(", ")}`);
}

/**
 * @param {string[]} argv
 */
export async function runInstallCli(argv) {
  let opts;
  try {
    opts = parseInstallArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (opts.help) {
    printInstallHelp();
    return;
  }

  const root = packageRoot;
  const nonInteractive = opts.yes || !isInteractiveTTY();

  if (opts.dryRun && nonInteractive) {
    await printDryRunPreview(opts, root);
    return;
  }

  if (!nonInteractive && !opts.dryRun) {
    opts.target = await runInteractiveInstall(opts);
  }

  if (opts.dryRun) {
    await printDryRunPreview(opts, root);
    return;
  }

  const res = await install({ ...opts, root });

  console.log(`\n설치 대상: ${res.target}`);
  console.log(`  버전: ${res.version ?? "?"}`);
  console.log(`  하네스: ${res.harnesses.join(", ")}`);
  for (const f of res.copied) console.log(`  + ${f}`);
  for (const f of res.overwritten) console.log(`  ~ ${f}`);
  for (const f of res.skipped) console.log(`  = 유지: ${f}`);
  for (const f of res.removed) console.log(`  - 제거: ${f}`);
  if (res.legacy.length) {
    console.log("\n레거시 .cursor/commands/ 파일이 남아 있습니다:");
    for (const f of res.legacy) console.log(`  rm ${f}`);
  }

  if (!opts.skipDoctor) {
    const harnessArg = res.harnesses.join(",");
    const doctor = await runDoctor({ cwd: res.target, harness: harnessArg, root });
    if (doctor.ok) {
      console.log("\n◇  doctor 통과 ✓");
    } else {
      console.log("\n◇  doctor 실패 — 아래를 확인하세요:");
      for (const p of doctor.problems) console.log(`  ✗ ${p}`);
      process.exitCode = 1;
    }
  } else {
    console.log(`\n검증: node ${join(res.target, ".atomic/scripts/doctor.mjs")} --harness ${res.harnesses.join(",")} --target .`);
  }
  console.log("\n다음: 에이전트에서 /atomic-setup 으로 저장소 설정을 마치세요.");
}
