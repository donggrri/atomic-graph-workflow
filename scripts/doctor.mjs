#!/usr/bin/env node
import { readFile, writeFile, readdir, stat, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { bundledScriptDiffs } from "./sync-bundled.mjs";

export const BUNDLED_SKILLS = [
  "code-review",
  "codebase-design",
  "domain-modeling",
  "grill-me",
  "grilling",
  "tdd",
  "to-tickets",
  "wayfinder"
];

export const WORKFLOW_SKILL = "cursor-atomic-workflow";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = ".cursor/skills";
const AGENTS_DIR = ".cursor/agents";
const RULES_DIR = ".cursor/rules";
const ATOMIC_ROUTER_RULE = "atomic-router.mdc";

/** @param {string} root */
export async function listCommandSkills(root) {
  const dir = join(root, SKILLS_DIR);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((name) => name.startsWith("cursor-atomic-") && name !== WORKFLOW_SKILL)
    .sort();
}

/**
 * 패키지 저장소에서 번들 스크립트가 루트 scripts/ 와 일치하는지 검사한다.
 * 패키지 저장소가 아닌 곳(설치 프로젝트)에서는 검사하지 않는다.
 */
export async function checkHarnessSync(options = {}) {
  const cwd = options.cwd || process.cwd();
  if (!existsSync(join(cwd, SKILLS_DIR, WORKFLOW_SKILL, "SKILL.md"))) {
    return { skipped: true, inSync: true, mismatches: [], stale: [] };
  }
  const mismatches = await bundledScriptDiffs({ cwd });
  return { skipped: false, inSync: mismatches.length === 0, mismatches, stale: [] };
}

async function countMarkdown(dir, names) {
  if (!existsSync(dir)) return { found: [], missing: names };
  const files = new Set((await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".md")));
  return {
    found: names.filter((n) => files.has(`${n}.md`)),
    missing: names.filter((n) => !files.has(`${n}.md`))
  };
}

/**
 * 현재 작업 디렉터리에 하네스별 설치(스킬·에이전트·커맨드 shim)가 있는지 확인한다.
 * 기대 목록은 이 패키지의 agents/ 와 커맨드 스킬에서 읽는다.
 */
export async function checkHarnessInstall(options = {}) {
  const cwd = options.cwd || process.cwd();
  const root = options.root || PACKAGE_ROOT;
  const { findLegacyCursorCommands } = await import("./install.mjs");
  const { agentFileName, roleNames } = await import("./lib/roles.mjs");
  const commandNames = await listCommandSkills(root);
  const skillsRoot = join(cwd, SKILLS_DIR);
  const skillsInstalled = existsSync(join(skillsRoot, WORKFLOW_SKILL, "SKILL.md"));
  const commandSkills = [];
  if (skillsInstalled) {
    for (const name of commandNames) {
      if (existsSync(join(skillsRoot, name, "SKILL.md"))) commandSkills.push(name);
    }
  }
  const expectedAgentStems = roleNames().map((role) => agentFileName(role).replace(/\.md$/, ""));
  const agents = await countMarkdown(join(cwd, AGENTS_DIR), expectedAgentStems);

  const routerRulePath = join(cwd, RULES_DIR, ATOMIC_ROUTER_RULE);
  const routerRuleInstalled = existsSync(routerRulePath);

  return {
    skillsInstalled,
    skillDirs: skillsInstalled ? [skillsRoot] : [],
    commandSkills: commandSkills.sort(),
    commandSkillsExpected: commandNames.length,
    routerRuleInstalled,
    routerRuleExpected: ATOMIC_ROUTER_RULE,
    agentsExpected: expectedAgentStems.length,
    harnesses: {
      cursor: {
        agents: {
          found: agents.found,
          missing: agents.missing,
        },
      },
    },
    legacyCursorCommands: await findLegacyCursorCommands(cwd),
  };
}

/**
 * 전역 또는 프로젝트 스킬 디렉터리에서 번들 스킬과 충돌하는 스킬들을 탐지한다.
 */
export async function checkCollisions(options = {}) {
  const home = homedir();
  const searchDirs = options.searchDirs || [
    join(home, ".agents", "skills"),
  ];

  const collisions = [];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (BUNDLED_SKILLS.includes(entry)) {
          const fullPath = join(dir, entry);
          const skillMd = join(fullPath, "SKILL.md");
          if (existsSync(skillMd)) {
            collisions.push({
              skill: entry,
              foundIn: fullPath,
              skillFile: skillMd
            });
          }
        }
      }
    } catch {
      // 디렉터리 읽기 실패 시 무시
    }
  }

  return collisions;
}

/**
 * 디렉터리 내의 모든 SKILL.md 파일을 재귀 탐색한다.
 */
export async function findSkillFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (name === "node_modules" || name === ".git") continue;
      const fullPath = join(dir, name);
      const st = await stat(fullPath).catch(() => null);
      if (!st) continue;

      if (st.isDirectory()) {
        await findSkillFiles(fullPath, files);
      } else if (name === "SKILL.md") {
        files.push(fullPath);
      }
    }
  } catch {
    // 접근 불가 시 무시
  }
  return files;
}

/**
 * SKILL.md의 frontmatter에서 따옴표 없는 콜론 등 YAML 파싱 위험 요소를 검출한다.
 */
export function validateSkillFrontmatter(content, filePath = "") {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return { valid: false, reason: "Missing frontmatter", issues: [] };
  }

  const frontmatter = match[1];
  const issues = [];

  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // description 필드 검사
    if (/^description\s*:/.test(trimmed)) {
      const val = trimmed.replace(/^description\s*:\s*/, "");

      // 블록 스칼라(>, |) 또는 따옴표로 감싸진 경우 안전
      const isQuoted = /^["'].*["']$/.test(val);
      const isBlockScalar = /^[>|][-+]?$/.test(val);

      if (!isQuoted && !isBlockScalar) {
        // 내부에 ': ' (콜론+공백)이 포함되어 있으면 YAML 파서가 중첩 매핑 키로 오인
        if (/:\s+/.test(val)) {
          issues.push({
            line: i + 1,
            field: "description",
            value: val,
            error: "Unquoted description containing ': ' causes YAML nested mapping parse error",
            suggestedFix: `description: ${JSON.stringify(val)}`
          });
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * SKILL.md 파일의 unquoted description을 큰따옴표로 감싸 자동 교정한다.
 */
export async function fixSkillFrontmatter(filePath) {
  const content = await readFile(filePath, "utf8");
  const check = validateSkillFrontmatter(content, filePath);

  if (check.valid || check.issues.length === 0) {
    return { fixed: false, issues: [] };
  }

  let modified = content;
  for (const issue of check.issues) {
    if (issue.field === "description" && issue.suggestedFix) {
      // 정확한 행 교체
      const targetPattern = new RegExp(`^description\\s*:\\s*${escapeRegExp(issue.value)}$`, "m");
      modified = modified.replace(targetPattern, issue.suggestedFix);
    }
  }

  if (modified !== content) {
    await writeFile(filePath, modified, "utf8");
    return { fixed: true, fixedIssues: check.issues };
  }

  return { fixed: false, issues: check.issues };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 통합 doctor 진단 실행 함수
 */
export async function runDoctor(options = {}) {
  const home = homedir();
  const cwd = options.cwd || process.cwd();
  const doFix = !!options.fix;

  const results = {
    collisions: [],
    yamlIssues: [],
    harnessSync: null,
    harnessInstall: null,
    fixesApplied: []
  };

  results.collisions = await checkCollisions();

  // 2. YAML frontmatter 검사 대상 수집
  const targetDirs = options.skillsDirs || [
    resolve(SKILLS_DIR),
    join(cwd, SKILLS_DIR),
    join(home, ".cursor", "skills"),
  ];

  const skillFiles = new Set();
  for (const d of targetDirs) {
    const files = await findSkillFiles(d);
    for (const f of files) skillFiles.add(f);
  }

  for (const file of skillFiles) {
    try {
      const content = await readFile(file, "utf8");
      const validation = validateSkillFrontmatter(content, file);
      if (!validation.valid) {
        results.yamlIssues.push({
          file,
          issues: validation.issues
        });

        if (doFix) {
          const fixRes = await fixSkillFrontmatter(file);
          if (fixRes.fixed) {
            results.fixesApplied.push(`Fixed YAML description formatting in ${file}`);
          }
        }
      }
    } catch {
      // 파일 읽기 오류 무시
    }
  }

  // 3. 하네스 생성물 동기화 + 설치 상태 점검
  results.harnessSync = await checkHarnessSync({ cwd });
  results.harnessInstall = await checkHarnessInstall({ cwd });

  return results;
}

// CLI 실행 엔트리포인트
if (process.argv[1] && process.argv[1].endsWith("doctor.mjs")) {
  const args = process.argv.slice(2);
  const isFix = args.includes("--fix");
  const isJson = args.includes("--json");

  runDoctor({ fix: isFix }).then((res) => {
    if (isJson) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }

    console.log("=== cursor-atomic-workflow Doctor ===\n");

    // 1. 스킬 충돌 상태
    console.log("1. 스킬 충돌(Skill Collisions) 진단:");
    if (res.collisions.length === 0) {
      console.log("  ✓ 충돌 없음: 전역 스킬 디렉터리에 겹치는 번들 스킬이 없습니다.");
    } else {
      console.log(`  ⚠ ${res.collisions.length}개 번들 스킬이 전역 스킬 디렉터리에 이미 존재합니다:`);
      for (const c of res.collisions) {
        console.log(`    - ${c.skill} (${c.foundIn})`);
      }
      console.log("  전역 복사본이 패키지 번들 스킬과 겹칩니다. 전역 폴더를 지우거나, 이 패키지 설치본만 쓰세요.");
    }

    console.log("\n2. 스킬 YAML Frontmatter 유효성 진단:");
    if (res.yamlIssues.length === 0) {
      console.log("  ✓ 문법 오류 없음: 모든 SKILL.md frontmatter가 정상입니다.");
    } else {
      console.log(`  ⚠ ${res.yamlIssues.length}개 파일에서 YAML 문법 에러 유발 요소가 감지되었습니다:`);
      for (const y of res.yamlIssues) {
        console.log(`    - ${y.file}`);
        for (const iss of y.issues) {
          console.log(`      Line ${iss.line}: ${iss.error}`);
        }
      }
      if (!isFix) {
        console.log("    -> 'node scripts/doctor.mjs --fix' 를 실행하면 자동으로 큰따옴표를 감싸 교정합니다.");
      }
    }

    console.log("\n3. Cursor 설치·번들 스크립트 진단:");
    const hs = res.harnessSync;
    if (hs && hs.skipped) {
      console.log("  - 패키지 저장소가 아니므로 번들 스크립트 동기화 검사는 건너뜁니다.");
    } else if (hs && hs.inSync) {
      console.log("  ✓ 번들 스크립트가 루트 scripts/ 와 일치합니다.");
    } else if (hs) {
      for (const m of hs.mismatches) console.log(`  ⚠ 원본과 다름: ${m}`);
    }
    const hi = res.harnessInstall;
    if (hi) {
      if (hi.skillsInstalled) {
        console.log(`  ✓ 스킬 설치: ${hi.skillDirs.join(", ")} (커맨드 스킬 ${hi.commandSkills.length}/${hi.commandSkillsExpected})`);
      } else {
        console.log("  - 현재 프로젝트에 `.cursor/skills/cursor-atomic-workflow` 없음.");
      }
      if (hi.skillsInstalled) {
        if (hi.routerRuleInstalled) {
          console.log(`  ✓ 라우터 규칙: ${RULES_DIR}/${hi.routerRuleExpected}`);
        } else {
          console.log(`  ⚠ 라우터 규칙 없음: ${RULES_DIR}/${hi.routerRuleExpected} (메인 채팅 자동 lite/full 판정 비활성)`);
        }
      }
      const cursorAgents = hi.harnesses?.cursor?.agents;
      if (cursorAgents && (cursorAgents.found.length || cursorAgents.missing.length)) {
        console.log(`  · cursor 에이전트 ${cursorAgents.found.length}/${hi.agentsExpected}`);
        for (const m of cursorAgents.missing) console.log(`    ✗ missing: ${m}`);
      }
      if (hi.legacyCursorCommands.length) {
        console.log(`  ⚠ 레거시 .cursor/commands/ 파일 ${hi.legacyCursorCommands.length}개가 커맨드 스킬과 슬래시 메뉴에서 겹칩니다. 지우세요:`);
        for (const f of hi.legacyCursorCommands) console.log(`    rm ${f}`);
      }
      if (!hi.skillsInstalled && !isFix) {
        console.log("    -> 'node scripts/install.mjs --target <프로젝트>' 로 설치하세요.");
      }
    }

    if (res.fixesApplied.length > 0) {
      console.log("\n4. 자동 교정(Auto-Fix) 적용 내역:");
      for (const fix of res.fixesApplied) {
        console.log(`  ✓ ${fix}`);
      }
    }

    console.log("\n진단 완료.");
  }).catch((err) => {
    console.error("Doctor error:", err);
    process.exit(1);
  });
}
