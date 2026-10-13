#!/usr/bin/env node
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { bundledScriptDiffs } from "./sync-bundled.mjs";
import { findLegacyCursorCommands, AGENTS_SKILLS_DIR } from "./install.mjs";
import { parseHarnessSpec, resolveHarnesses } from "./lib/harnesses.mjs";
import { listRuntimeScriptRelPaths } from "./lib/atomic-runtime.mjs";

export const BUNDLED_SKILLS = [
  "code-review",
  "codebase-design",
  "domain-modeling",
  "grill-me",
  "grilling",
  "tdd",
  "to-tickets",
  "wayfinder",
];

export const WORKFLOW_SKILL = "cursor-atomic-workflow";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_SKILLS_DIR = "skills";

export function parseDoctorArgs(argv) {
  const opts = { cwd: process.cwd(), harness: null, json: false, fix: false, withClaude: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--fix") opts.fix = true;
    else if (a === "--with-claude") opts.withClaude = true;
    else if (a === "--target" && argv[i + 1]) opts.cwd = resolve(argv[++i]);
    else if (a === "--harness" && argv[i + 1]) opts.harness = argv[++i];
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

/** @param {string} root package or target root */
export async function listCommandSkills(root) {
  const dir = join(root, SOURCE_SKILLS_DIR);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((name) => name.startsWith("cursor-atomic-") && name !== WORKFLOW_SKILL)
    .sort();
}

export async function checkHarnessSync(options = {}) {
  const cwd = options.cwd || process.cwd();
  if (!existsSync(join(cwd, SOURCE_SKILLS_DIR, WORKFLOW_SKILL, "SKILL.md"))) {
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
    missing: names.filter((n) => !files.has(`${n}.md`)),
  };
}

/**
 * @param {string} harness
 * @param {string} cwd target project
 * @param {string} root package root for expected lists
 */
export async function checkSingleHarness(harness, cwd, root = PACKAGE_ROOT) {
  const problems = [];
  const { agentFileName, roleNames } = await import("./lib/roles.mjs");
  const commandNames = await listCommandSkills(root);
  const skillsRoot = join(cwd, AGENTS_SKILLS_DIR);
  const workflowOk = existsSync(join(skillsRoot, WORKFLOW_SKILL, "SKILL.md"));
  if (!workflowOk) {
    problems.push(`missing ${AGENTS_SKILLS_DIR}/${WORKFLOW_SKILL}/SKILL.md`);
  }

  const commandSkills = [];
  if (workflowOk) {
    for (const name of commandNames) {
      if (existsSync(join(skillsRoot, name, "SKILL.md"))) commandSkills.push(name);
      else problems.push(`missing command skill ${name}`);
    }
  }

  const atomicScripts = join(cwd, ".atomic", "scripts");
  if (!existsSync(atomicScripts)) {
    problems.push("missing .atomic/scripts/");
  } else {
    const rels = await listRuntimeScriptRelPaths(join(root, "scripts"));
    for (const rel of rels) {
      if (!existsSync(join(atomicScripts, rel))) {
        problems.push(`missing .atomic/scripts/${rel}`);
      }
    }
  }

  if (!existsSync(join(cwd, ".atomic", "graph.yaml"))) {
    problems.push("missing .atomic/graph.yaml");
  }

  const agentsMd = join(cwd, "AGENTS.md");
  if (!existsSync(agentsMd)) {
    problems.push("missing AGENTS.md");
  } else {
    const agentsText = await readFile(agentsMd, "utf8");
    if (
      !agentsText.includes("<!-- atomic:begin -->") ||
      !agentsText.includes("<!-- atomic:end -->")
    ) {
      problems.push("AGENTS.md missing atomic marker block");
    }
  }

  const agentsAtomic = join(cwd, ".atomic", "agents");
  const expectedAgentStems = roleNames().map((role) => agentFileName(role).replace(/\.md$/, ""));
  const atomicAgents = await countMarkdown(agentsAtomic, expectedAgentStems);
  for (const m of atomicAgents.missing) {
    problems.push(`missing .atomic/agents/${m}.md`);
  }

  const detail = {
    workflowSkill: workflowOk,
    commandSkills,
    commandSkillsExpected: commandNames.length,
    legacyCursorCommands: await findLegacyCursorCommands(cwd),
    legacyCursorSkills: [],
  };

  const legacySkillRoot = join(cwd, ".cursor", "skills");
  if (existsSync(legacySkillRoot)) {
    for (const name of await readdir(legacySkillRoot)) {
      if (name.startsWith("cursor-atomic-")) {
        detail.legacyCursorSkills.push(join(legacySkillRoot, name));
        problems.push(`legacy skill dir ${legacySkillRoot}/${name} (use --migrate)`);
      }
    }
  }

  if (harness === "cursor") {
    const agents = await countMarkdown(join(cwd, ".cursor", "agents"), expectedAgentStems);
    detail.cursorAgents = agents;
    for (const m of agents.missing) problems.push(`missing .cursor/agents/${m}.md`);
    const router = join(cwd, ".cursor", "rules", "atomic-router.mdc");
    detail.routerRuleInstalled = existsSync(router);
    if (!existsSync(router)) problems.push("missing .cursor/rules/atomic-router.mdc");
  }

  if (harness === "opencode") {
    for (const name of commandNames) {
      const cmd = join(cwd, ".opencode", "commands", `${name}.md`);
      if (!existsSync(cmd)) problems.push(`missing .opencode/commands/${name}.md`);
    }
    const ocAgents = await countMarkdown(join(cwd, ".opencode", "agents"), expectedAgentStems);
    for (const m of ocAgents.missing) problems.push(`missing .opencode/agents/${m}.md`);
  }

  if (harness === "pi") {
    for (const name of commandNames) {
      const cmd = join(cwd, ".pi", "prompts", `${name}.md`);
      if (!existsSync(cmd)) problems.push(`missing .pi/prompts/${name}.md`);
    }
  }

  if (harness === "claude") {
    const clSkills = join(cwd, ".claude", "skills", WORKFLOW_SKILL, "SKILL.md");
    if (!existsSync(clSkills)) problems.push("missing .claude/skills/ copy");
    for (const name of commandNames) {
      const cmd = join(cwd, ".claude", "commands", `${name}.md`);
      if (!existsSync(cmd)) problems.push(`missing .claude/commands/${name}.md`);
    }
    const clAgents = await countMarkdown(join(cwd, ".claude", "agents"), expectedAgentStems);
    for (const m of clAgents.missing) problems.push(`missing .claude/agents/${m}.md`);
    const claudeMd = join(cwd, "CLAUDE.md");
    if (!existsSync(claudeMd)) problems.push("missing CLAUDE.md");
    else {
      const text = await readFile(claudeMd, "utf8");
      if (!text.includes("@AGENTS.md")) problems.push("CLAUDE.md must reference @AGENTS.md");
    }
  }

  if (detail.legacyCursorCommands.length) {
    for (const f of detail.legacyCursorCommands) {
      problems.push(`legacy command file ${f}`);
    }
  }

  return { harness, ok: problems.length === 0, problems, detail };
}

export async function checkHarnessInstall(options = {}) {
  const cwd = options.cwd || process.cwd();
  const harness = options.harness || "cursor";
  const single = await checkSingleHarness(harness, cwd, options.root || PACKAGE_ROOT);
  return {
    skillsInstalled: single.detail.workflowSkill,
    skillDirs: single.detail.workflowSkill ? [join(cwd, AGENTS_SKILLS_DIR)] : [],
    commandSkills: single.detail.commandSkills,
    commandSkillsExpected: single.detail.commandSkillsExpected,
    routerRuleInstalled: single.detail.routerRuleInstalled ?? false,
    routerRuleExpected: "atomic-router.mdc",
    agentsExpected: single.detail.cursorAgents?.found.length + single.detail.cursorAgents?.missing.length || 0,
    harnesses: { [harness]: single },
    legacyCursorCommands: single.detail.legacyCursorCommands,
    problems: single.problems,
    ok: single.ok,
  };
}

export async function checkCollisions(options = {}) {
  const home = homedir();
  const searchDirs = options.searchDirs || [join(home, ".agents", "skills")];
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
            collisions.push({ skill: entry, foundIn: fullPath, skillFile: skillMd });
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return collisions;
}

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
    // ignore
  }
  return files;
}

export function validateSkillFrontmatter(content, filePath = "") {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return { valid: false, reason: "Missing frontmatter", issues: [] };
  }
  const frontmatter = match[1];
  const issues = [];
  if (/^disable-model-invocation\s*:/m.test(frontmatter)) {
    issues.push({
      line: 0,
      field: "disable-model-invocation",
      error: "disable-model-invocation is not allowed in skill frontmatter",
    });
  }
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^description\s*:/.test(trimmed)) {
      const val = trimmed.replace(/^description\s*:\s*/, "");
      const isQuoted = /^["'].*["']$/.test(val);
      const isBlockScalar = /^[>|][-+]?$/.test(val);
      if (!isQuoted && !isBlockScalar && /:\s+/.test(val)) {
        issues.push({
          line: i + 1,
          field: "description",
          value: val,
          error: "Unquoted description containing ': ' causes YAML nested mapping parse error",
          suggestedFix: `description: ${JSON.stringify(val)}`,
        });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function fixSkillFrontmatter(filePath) {
  const content = await readFile(filePath, "utf8");
  const check = validateSkillFrontmatter(content, filePath);
  if (check.valid || check.issues.length === 0) {
    return { fixed: false, issues: [] };
  }
  let modified = content;
  for (const issue of check.issues) {
    if (issue.field === "description" && issue.suggestedFix) {
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

export async function runDoctor(options = {}) {
  const cwd = options.cwd || process.cwd();
  const doFix = !!options.fix;
  const results = {
    collisions: [],
    yamlIssues: [],
    harnessSync: null,
    harnessInstall: null,
    harnessChecks: [],
    fixesApplied: [],
    ok: true,
    problems: [],
  };
  results.collisions = await checkCollisions();

  const skillDirs = options.skillsDirs || [
    join(PACKAGE_ROOT, SOURCE_SKILLS_DIR),
    join(cwd, AGENTS_SKILLS_DIR),
    join(homedir(), ".cursor", "skills"),
  ];
  const skillFiles = new Set();
  for (const d of skillDirs) {
    for (const f of await findSkillFiles(d)) skillFiles.add(f);
  }

  for (const file of skillFiles) {
    try {
      const content = await readFile(file, "utf8");
      const validation = validateSkillFrontmatter(content, file);
      if (!validation.valid) {
        results.yamlIssues.push({ file, issues: validation.issues });
        if (doFix) {
          const fixRes = await fixSkillFrontmatter(file);
          if (fixRes.fixed) {
            results.fixesApplied.push(`Fixed YAML in ${file}`);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  results.harnessSync = await checkHarnessSync({ cwd });

  if (options.harness) {
    results.ok = true;
    const harnessParts = parseHarnessSpec(options.harness);
    const harnesses = resolveHarnesses(harnessParts, cwd, {
      withClaude: options.withClaude || harnessParts.includes("claude"),
    });

    for (const h of harnesses) {
      const check = await checkSingleHarness(h, cwd, options.root || PACKAGE_ROOT);
      results.harnessChecks.push(check);
      if (!check.ok) {
        results.ok = false;
        results.problems.push(...check.problems.map((p) => `[${h}] ${p}`));
      }
    }

    results.harnessInstall = await checkHarnessInstall({
      cwd,
      harness: [...harnesses][0] || "cursor",
      root: options.root || PACKAGE_ROOT,
    });
  } else {
    results.harnessInstall = null;
  }

  if (results.harnessSync && !results.harnessSync.skipped && !results.harnessSync.inSync) {
    if (options.harness) {
      results.ok = false;
    }
    results.problems.push(
      `bundled scripts drift: ${results.harnessSync.mismatches.join(", ")}`,
    );
  }

  return results;
}

if (process.argv[1] && process.argv[1].endsWith("doctor.mjs")) {
  const opts = parseDoctorArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "Usage: node scripts/doctor.mjs [--target <dir>] [--harness <list>] [--with-claude] [--json] [--fix]",
    );
    process.exit(0);
  }

  runDoctor({
    cwd: opts.cwd,
    harness: opts.harness,
    fix: opts.fix,
    withClaude: opts.withClaude,
  })
    .then((res) => {
      if (opts.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }

      console.log("=== Atomic Workflow Doctor ===\n");
      if (!res.ok) {
        for (const p of res.problems) console.log(`✗ ${p}`);
      } else {
        console.log("✓ harness checks passed");
      }
      if (res.fixesApplied.length) {
        for (const f of res.fixesApplied) console.log(`fixed: ${f}`);
      }
      if (opts.harness && !res.ok) process.exit(1);
    })
    .catch((err) => {
      console.error("Doctor error:", err);
      process.exit(1);
    });
}
