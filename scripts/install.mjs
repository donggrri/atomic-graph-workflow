#!/usr/bin/env node
// Cursor 프로젝트에 워크플로 스킬·에이전트를 설치한다.
//
//   node scripts/install.mjs --target <프로젝트> [--force]
//                            [--set-model worker=composer-2.5] [--skills-dir <경로>]
//                            [--no-skills] [--no-agents]
//
// 복사: .cursor/skills -> 대상 --skills-dir (기본 .cursor/skills)
//       .cursor/agents -> 대상 .cursor/agents
import { readFile, writeFile, mkdir, readdir, stat, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** 역할 이름 → Cursor 에이전트 파일 이름 (--set-model reviewer=… 매핑용). */
const CURSOR_AGENT_FILE = {
  reviewer: "cursor-atomic-reviewer"
};

export const DEFAULT_SKILLS_DIR = ".cursor/skills";
export const AGENTS_DIR = ".cursor/agents";
export const RULES_DIR = ".cursor/rules";
export const ATOMIC_ROUTER_RULE = "atomic-router.mdc";
export const LEGACY_CURSOR_COMMANDS_DIR = ".cursor/commands";

export function parseInstallArgs(args) {
  const opts = {
    target: process.cwd(),
    skillsDir: DEFAULT_SKILLS_DIR,
    force: false,
    setModel: {},
    components: { skills: true, agents: true, rules: true }
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      opts.help = true;
    } else if (a === "--target" && args[i + 1]) opts.target = resolve(args[++i]);
    else if (a === "--skills-dir" && args[i + 1]) opts.skillsDir = args[++i];
    else if (a === "--force") opts.force = true;
    else if (a === "--no-skills") opts.components.skills = false;
    else if (a === "--no-agents") opts.components.agents = false;
    else if (a === "--no-rules") opts.components.rules = false;
    else if (a === "--set-model" && args[i + 1]) {
      const pair = args[++i];
      const eq = pair.indexOf("=");
      if (eq === -1) throw new Error(`--set-model 형식은 <agent>=<model> (입력: ${pair})`);
      opts.setModel[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (a.startsWith("-")) {
      throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return opts;
}

export function printInstallHelp() {
  console.log(`Usage: node scripts/install.mjs [options]

Options:
  --target <dir>       설치 대상 프로젝트 (기본: cwd)
  --skills-dir <path>  스킬 복사 위치 (기본: ${DEFAULT_SKILLS_DIR})
  --force              기존 파일 덮어쓰기
  --set-model <a>=<m>  에이전트 frontmatter model 덮어쓰기 (여러 번 가능)
  --no-skills          스킬 복사 생략
  --no-agents          에이전트 복사 생략
  --no-rules           Cursor 규칙(.cursor/rules) 복사 생략
  -h, --help           이 도움말
`);
}

export function applyModelOverride(content, model) {
  if (/^model:\s*.*$/m.test(content)) {
    return content.replace(/^model:\s*.*$/m, `model: ${model}`);
  }
  return content.replace(/^---\r?\n/, `---\nmodel: ${model}\n`);
}

async function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
}

/** 대상 프로젝트에 남은 레거시 Cursor 커맨드(같은 이름의 스킬과 슬래시 메뉴에서 겹친다). */
export async function findLegacyCursorCommands(target) {
  return (await listMarkdown(join(target, LEGACY_CURSOR_COMMANDS_DIR)))
    .filter((f) => f.startsWith("cursor-atomic-"))
    .map((f) => join(target, LEGACY_CURSOR_COMMANDS_DIR, f));
}

async function installSkills(root, target, skillsDir, force, record) {
  const srcSkills = join(root, DEFAULT_SKILLS_DIR);
  if (!existsSync(srcSkills)) {
    throw new Error(`${DEFAULT_SKILLS_DIR}/ 가 없습니다. 패키지 루트에서 실행하세요.`);
  }
  for (const entry of (await readdir(srcSkills)).sort()) {
    const src = join(srcSkills, entry);
    const st = await stat(src).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const dest = join(target, skillsDir, entry);
    const existed = existsSync(dest);
    if (existed && !force) {
      record.skipped.push(dest + "/");
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true, force });
    record[existed ? "overwritten" : "copied"].push(dest + "/");
  }
}

async function installRules(root, target, force, record) {
  const srcDir = join(root, RULES_DIR);
  if (!existsSync(srcDir)) return;
  const files = (await readdir(srcDir)).filter((f) => f.endsWith(".mdc")).sort();
  for (const file of files) {
    const dest = join(target, RULES_DIR, file);
    const existed = existsSync(dest);
    if (existed && !force) {
      record.skipped.push(dest);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await cp(join(srcDir, file), dest, { force });
    record[existed ? "overwritten" : "copied"].push(dest);
  }
}

async function installAgents(root, target, force, setModel, record) {
  const srcDir = join(root, AGENTS_DIR);
  const files = await listMarkdown(srcDir);
  if (files.length === 0) {
    throw new Error(`${AGENTS_DIR}/ 가 비어 있습니다.`);
  }
  for (const file of files) {
    let content = await readFile(join(srcDir, file), "utf8");
    const name = file.replace(/\.md$/, "");
    const sourceName = Object.entries(CURSOR_AGENT_FILE).find(([, fileName]) => fileName === name)?.[0];
    const model = setModel && (setModel[name] || (sourceName && setModel[sourceName]));
    if (model) content = applyModelOverride(content, model);
    const dest = join(target, AGENTS_DIR, file);
    const existed = existsSync(dest);
    if (existed && !force) {
      record.skipped.push(dest);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
    record[existed ? "overwritten" : "copied"].push(dest);
  }
}

export async function install(options = {}) {
  const root = options.root || resolve(here, "..");
  const target = resolve(options.target || process.cwd());
  const skillsDir = options.skillsDir || DEFAULT_SKILLS_DIR;
  const force = !!options.force;
  const setModel = options.setModel || {};
  const components = options.components || { skills: true, agents: true, rules: true };
  const record = { copied: [], overwritten: [], skipped: [] };

  if (components.skills) {
    await installSkills(root, target, skillsDir, force, record);
  }
  if (components.agents) {
    await installAgents(root, target, force, setModel, record);
  }
  if (components.rules) {
    await installRules(root, target, force, record);
  }

  const legacy = await findLegacyCursorCommands(target);
  return { target, skillsDir, legacy, ...record };
}

if (process.argv[1] && process.argv[1].endsWith("install.mjs")) {
  let opts;
  try {
    opts = parseInstallArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (opts.help) {
    printInstallHelp();
    process.exit(0);
  }
  install({ ...opts, root: resolve(here, "..") })
    .then((res) => {
      console.log(`설치 대상: ${res.target}`);
      console.log(`  스킬 위치: ${res.skillsDir}`);
      for (const f of res.copied) console.log(`  + ${f}`);
      for (const f of res.overwritten) console.log(`  ~ ${f}`);
      for (const f of res.skipped) console.log(`  = 유지(있음): ${f}`);
      if (res.legacy.length) {
        console.log("\n레거시 Cursor 커맨드가 남아 있습니다. 같은 이름의 스킬과 슬래시 메뉴에서 겹치므로 지우세요:");
        for (const f of res.legacy) console.log(`  rm ${f}`);
      }
      console.log("\n설치 완료. 커맨드: Cursor `/cursor-atomic-plan` 등 스킬 슬래시.");
      console.log("단계별 모델은 `.cursor/agents/*.md` frontmatter `model`과 Task 호출 `model`로 지정합니다.");
    })
    .catch((err) => {
      console.error("설치 실패:", err.message);
      process.exit(1);
    });
}
