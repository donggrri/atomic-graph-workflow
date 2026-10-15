#!/usr/bin/env node
import { homedir } from "node:os";
import { join, basename, resolve, isAbsolute } from "node:path";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  readdirSync,
  statSync,
  copyFileSync,
  cpSync,
  existsSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { docsRootFromLegacyArtifacts } from "./lib/artifacts.mjs";

/**
 * Expands a leading ~ to home. Other paths are unchanged.
 * @param {string} value
 * @param {string} [home]
 */
export function expandHomePath(value, home = homedir()) {
  if (value === "~") return home;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2));
  return value;
}

/**
 * Config file that can override the default workflow home.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [home]
 */
export function workflowConfigPath(env = process.env, home = homedir()) {
  const xdg = typeof env.XDG_CONFIG_HOME === "string" ? env.XDG_CONFIG_HOME.trim() : "";
  const base = xdg ? resolve(expandHomePath(xdg, home)) : join(home, ".config");
  return join(base, "cursor-atomic-workflow", "config.json");
}

/**
 * Returns the global workflow root directory.
 * Priority: CURSOR_ATOMIC_WORKFLOW_HOME, then config.json `home`, then ~/.cursor-atomic-workflow.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ homeDir?: string, configPath?: string, readFileSync?: typeof readFileSync, existsSync?: typeof existsSync }} [options]
 */
export function getWorkflowRoot(env = process.env, options = {}) {
  const home = options.homeDir ?? homedir();
  const custom = env.CURSOR_ATOMIC_WORKFLOW_HOME;
  if (typeof custom === "string" && custom.trim()) {
    return resolve(expandHomePath(custom.trim(), home));
  }
  const configPath = options.configPath ?? workflowConfigPath(env, home);
  const exists = options.existsSync ?? existsSync;
  const read = options.readFileSync ?? readFileSync;
  if (exists(configPath)) {
    try {
      const parsed = JSON.parse(read(configPath, "utf8"));
      const setting = parsed && typeof parsed.home === "string" ? parsed.home.trim() : "";
      if (setting) return resolve(expandHomePath(setting, home));
    } catch {
      // Invalid JSON falls through to the default home.
    }
  }
  return join(home, ".cursor-atomic-workflow");
}

/**
 * Derives a short, clean identifier for a repository folder.
 * Converts to lowercase kebab-case and limits length to max 24 characters.
 */
/**
 * Cursor session/conversation id.
 * Cloud Agent injects CURSOR_CONVERSATION_ID (`bc-…`).
 * Local Cursor IDE does not set this; pass --session-id instead.
 */
export function detectCursorSessionId(env = process.env) {
  const id = (env.CURSOR_CONVERSATION_ID || "").trim();
  return id || null;
}

/**
 * Prefer an explicit CLI override, then the current Cursor env, then the stored value.
 */
export function resolveSessionId(explicit, existingId, env = process.env) {
  if (explicit != null && String(explicit).trim()) {
    return String(explicit).trim();
  }
  return detectCursorSessionId(env) ?? existingId ?? null;
}

export function getShortRepo(repoRoot) {
  if (!repoRoot) return "unknown-repo";
  const base = basename(resolve(repoRoot));
  let normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length > 24) {
    normalized = normalized.slice(0, 24).replace(/-+$/, "");
  }
  return normalized || "repo";
}

/**
 * Computes all canonical directories and paths for a given repo and slug.
 *
 * docsDir resolution (configuration hierarchy):
 * 1. project `.cursor-atomic-workflow.json` `docsRoot` (repo-local, e.g. "work-docs")
 * 2. global workflow home `<root>/docs/<shortRepo>/<slug>` (fallback, backward compatible)
 *
 * runsDir/evidenceDir always stay under the global workflow home to avoid
 * polluting the repository with large volatile logs.
 */
export const PROJECT_SETTINGS_FILENAME = ".cursor-atomic-workflow.json";

/**
 * Reads the raw `docsRoot` value from a repo's project settings.
 * Returns a trimmed non-empty string, or null when unset/invalid.
 * Invalid JSON or non-object roots fall back to null (global path).
 * @param {string} [repoRoot]
 */
export function readDocsRootSetting(repoRoot) {
  if (!repoRoot || typeof repoRoot !== "string") return null;
  let settingsPath;
  try {
    settingsPath = join(resolve(repoRoot), PROJECT_SETTINGS_FILENAME);
  } catch {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw.docsRoot;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reads the effective docsRoot honoring a deprecated legacy `artifacts`
 * block when `docsRoot` is unset. Returns the docsRoot value plus an
 * optional deprecation warning. Never throws for invalid values.
 * @param {string} [repoRoot]
 * @returns {{ docsRoot: string | null, warning: string | null }}
 */
export function readEffectiveDocsRoot(repoRoot) {
  const direct = readDocsRootSetting(repoRoot);
  if (direct) return { docsRoot: direct, warning: null };
  if (!repoRoot || typeof repoRoot !== "string") return { docsRoot: null, warning: null };
  let settingsPath;
  try {
    settingsPath = join(resolve(repoRoot), PROJECT_SETTINGS_FILENAME);
  } catch {
    return { docsRoot: null, warning: null };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return { docsRoot: null, warning: null };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { docsRoot: null, warning: null };
  if (raw.artifacts === undefined || raw.artifacts === null) return { docsRoot: null, warning: null };
  if (typeof raw.artifacts !== "object" || Array.isArray(raw.artifacts)) {
    return {
      docsRoot: null,
      warning: "project settings: artifacts is deprecated (use docsRoot instead)",
    };
  }
  const mapped = docsRootFromLegacyArtifacts(raw.artifacts);
  return {
    docsRoot: mapped,
    warning: "project settings: artifacts is deprecated (use docsRoot instead)",
  };
}

/**
 * Resolves the slug docs directory honoring an optional project docsRoot.
 * Relative docsRoot resolves against repoRoot; absolute (or ~-leading) paths
 * are used as-is as the docs base. Returns the docsDir and its source.
 */
export function resolveDocsDir(repoRoot, slug, root, shortRepo) {
  const { docsRoot: custom, warning } = readEffectiveDocsRoot(repoRoot);
  if (custom && repoRoot) {
    const expanded = expandHomePath(custom);
    const base = isAbsolute(expanded)
      ? expanded
      : resolve(repoRoot, expanded);
    return { docsDir: join(base, slug), source: "project", warning };
  }
  return { docsDir: join(root, "docs", shortRepo, slug), source: "global", warning };
}

export function getWorkflowPaths(repoRoot, slug) {
  const root = getWorkflowRoot();
  const shortRepo = getShortRepo(repoRoot);
  const { docsDir, source, warning } = resolveDocsDir(repoRoot, slug, root, shortRepo);
  const runsDir = join(root, "runs", shortRepo, slug);
  const evidenceDir = join(root, "evidence", shortRepo);
  const statusJson = join(docsDir, "STATUS.json");

  const out = {
    root,
    shortRepo,
    slug,
    docsDir,
    runsDir,
    evidenceDir,
    statusJson,
    docsDirSource: source,
  };
  if (warning) {
    out.docsRootWarning = warning;
    out.artifactsWarning = warning;
  }
  return out;
}

/**
 * Absolute slug docs directory (global home or repo-local docsRoot); creates it if missing.
 * @param {string} repoRoot
 * @param {string} slug
 */
export function ensureDocsDir(repoRoot, slug) {
  const clean = typeof slug === "string" ? slug.trim() : "";
  if (!clean) throw new Error("ensureDocsDir requires a slug");
  const paths = getWorkflowPaths(repoRoot, clean);
  mkdirSync(paths.docsDir, { recursive: true });
  return resolve(paths.docsDir);
}

/**
 * @param {string[]} argv
 * @param {string} [defaultRepo]
 */
export function parseRepoArg(argv, defaultRepo = process.cwd()) {
  let repo = defaultRepo;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo" && argv[i + 1]) {
      repo = resolve(argv[++i]);
    } else {
      rest.push(argv[i]);
    }
  }
  return { repo: resolve(repo), rest };
}

/**
 * Reads STATUS.json for a slug if it exists.
 */
export async function readStatus(repoRoot, slug) {
  const { statusJson } = getWorkflowPaths(repoRoot, slug);
  try {
    const raw = readFileSync(statusJson, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Writes STATUS.json using an atomic write (tmp file + rename).
 * Detects cross-repo collisions if the slug already exists under a different repo.
 */
export async function writeStatus(repoRoot, slug, data = {}) {
  const paths = getWorkflowPaths(repoRoot, slug);
  const existing = await readStatus(repoRoot, slug);

  const cleanRepo = repoRoot ? resolve(repoRoot) : "";
  if (existing && existing.repo && cleanRepo && resolve(existing.repo) !== cleanRepo) {
    throw new Error(
      `Cross-repo slug collision: slug '${slug}' is already owned by repository '${existing.repo}' (incoming: '${cleanRepo}')`
    );
  }

  const statusData = {
    slug,
    shortRepo: paths.shortRepo,
    repo: cleanRepo || existing?.repo || "",
    worktree: data.worktree !== undefined ? data.worktree : existing?.worktree ?? null,
    cwd: data.cwd ? resolve(data.cwd) : existing?.cwd ?? cleanRepo,
    branch: data.branch ?? existing?.branch ?? "main",
    phase: data.phase ?? existing?.phase ?? "explore",
    artifacts: {
      explore: false,
      plan: false,
      tasks: false,
      review: false,
      ...(existing?.artifacts || {}),
      ...(data.artifacts || {}),
    },
    tasks: {
      total: 0,
      done: 0,
      blockedId: null,
      blockedReason: null,
      ...(existing?.tasks || {}),
      ...(data.tasks || {}),
    },
    lastCommand: data.lastCommand ?? existing?.lastCommand ?? "",
    sourceDocs: data.sourceDocs ?? existing?.sourceDocs ?? null,
    sessionId: resolveSessionId(data.sessionIdOverride, existing?.sessionId),
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(paths.docsDir, { recursive: true });
  const tmpPath = join(
    paths.docsDir,
    `STATUS.json.tmp.${process.pid}.${Date.now()}`
  );

  writeFileSync(tmpPath, JSON.stringify(statusData, null, 2) + "\n", "utf8");
  renameSync(tmpPath, paths.statusJson);

  return statusData;
}

/**
 * Patches existing STATUS.json and saves it atomically.
 */
export async function updateStatus(repoRoot, slug, patch = {}) {
  const existing = await readStatus(repoRoot, slug);
  return writeStatus(repoRoot, slug, { ...(existing || {}), ...patch });
}

/**
 * Scans docsDir for artifact files and TASKS-<slug>.md to update status.
 */
export async function syncFromFiles(repoRoot, slug) {
  const paths = getWorkflowPaths(repoRoot, slug);
  const artifacts = {
    explore: false,
    plan: false,
    tasks: false,
    review: false,
  };

  try {
    statSync(join(paths.docsDir, `EXPLORE-${slug}.md`));
    artifacts.explore = true;
  } catch {}
  try {
    statSync(join(paths.docsDir, `PLAN-${slug}.md`));
    artifacts.plan = true;
  } catch {}
  try {
    statSync(join(paths.docsDir, `TASKS-${slug}.md`));
    artifacts.tasks = true;
  } catch {}
  try {
    statSync(join(paths.docsDir, `REVIEW-${slug}.md`));
    artifacts.review = true;
  } catch {}

  const taskStats = {
    total: 0,
    done: 0,
    blockedId: null,
    blockedReason: null,
  };

  const tasksFile = join(paths.docsDir, `TASKS-${slug}.md`);
  try {
    const raw = readFileSync(tasksFile, "utf8");
    const lines = raw.split(/\r?\n/);
    let currentTaskId = null;

    for (const line of lines) {
      const doneMatch = line.match(/^-\s*\[x\]\s*([A-Za-z0-9_.-]+)?/i);
      const todoMatch = line.match(/^-\s*\[\s*\]\s*([A-Za-z0-9_.-]+)?/i);

      if (doneMatch) {
        taskStats.total += 1;
        taskStats.done += 1;
        currentTaskId = doneMatch[1] || null;
      } else if (todoMatch) {
        taskStats.total += 1;
        currentTaskId = todoMatch[1] || null;
      }

      const blockedMatch = line.match(/^\s*(?:막힘|blocked):\s*(.+)$/i);
      if (blockedMatch && !taskStats.blockedId) {
        taskStats.blockedId = currentTaskId || "blocked";
        taskStats.blockedReason = blockedMatch[1].trim();
      }
    }
  } catch {}

  return updateStatus(repoRoot, slug, {
    artifacts,
    tasks: taskStats,
  });
}

export function inferPhase(artifacts, tasks) {
  if (tasks?.blockedId) return "execute";
  if (artifacts?.review) return "review";
  if (artifacts?.tasks) {
    if (tasks?.total > 0 && tasks.done >= tasks.total) return "review";
    if (tasks?.done > 0) return "execute";
    return "task";
  }
  if (artifacts?.plan) return "plan";
  if (artifacts?.explore) return "explore";
  return "explore";
}

/**
 * Sync STATUS.json from slug-folder artifacts and infer (or set) phase.
 * Call after writing EXPLORE/PLAN/TASKS/REVIEW or updating TASKS checkboxes.
 */
export async function syncSlug(startDir, slug, options = {}) {
  if (!slug) throw new Error("syncSlug requires a slug");

  const origin = detectOrigin(startDir);
  const lookupRepo = options.repo || origin.repo || origin.cwd;
  const all = await listAllStatuses({ repoRoot: lookupRepo });
  const existing = all.find((s) => s.slug === slug);
  const targetRepo = options.repo || existing?.repo || origin.repo;

  await writeStatus(targetRepo, slug, {
    cwd: origin.cwd,
    worktree: origin.worktree,
    branch: origin.branch,
    lastCommand: options.lastCommand || `work-status sync ${slug}`,
    ...(options.sourceDocs !== undefined ? { sourceDocs: options.sourceDocs } : {}),
    ...(options.sessionId !== undefined ? { sessionIdOverride: options.sessionId } : {}),
  });

  const synced = await syncFromFiles(targetRepo, slug);
  let phase = options.phase ?? inferPhase(synced.artifacts, synced.tasks);
  if (existing?.phase === "complete" && options.phase === undefined) {
    phase = "complete";
  }

  return updateStatus(targetRepo, slug, {
    phase,
    lastCommand: options.lastCommand || `work-status sync ${slug}`,
  });
}

function currentBranch(repoRoot) {
  try {
    return execSync("git branch --show-current", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "main";
  } catch {
    return "main";
  }
}

function detectOrigin(startDir) {
  const cwd = resolve(startDir);
  let repo = cwd;
  let worktree = null;
  try {
    const gitOpts = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const toplevel = execSync("git rev-parse --show-toplevel", gitOpts).trim();
    const common = execSync("git rev-parse --git-common-dir", {
      ...gitOpts,
      cwd: toplevel,
    }).trim();
    const absCommon = resolve(toplevel, common);
    repo = resolve(absCommon, "..");
    if (resolve(toplevel) !== resolve(repo)) {
      worktree = resolve(toplevel);
    }
  } catch {
    repo = cwd;
  }
  return {
    repo,
    worktree,
    cwd: worktree || repo,
    branch: currentBranch(worktree || repo),
  };
}

/**
 * Copy local `.docs/<slug>/` artifacts into the configured docsDir
 * (global home or repo-local docsRoot) and write STATUS.json.
 * Does not delete the source. Extra files (e.g. TEST-METHOD-*.md) are copied as-is.
 */
export async function importDocs(repoRoot, srcDir) {
  const origin = detectOrigin(repoRoot);
  const repo = origin.repo;
  const source = resolve(srcDir || join(origin.cwd, ".docs"));
  const imported = [];

  let entries = [];
  try {
    entries = readdirSync(source);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`import-docs source not found: ${source}`);
    }
    throw err;
  }

  for (const name of entries) {
    const srcSlugDir = join(source, name);
    try {
      if (!statSync(srcSlugDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const slug = name;
    const paths = getWorkflowPaths(repo, slug);
    mkdirSync(paths.docsDir, { recursive: true });
    cpSync(srcSlugDir, paths.docsDir, { recursive: true });

    const recorded = await syncSlug(origin.cwd, slug, {
      repo,
      sourceDocs: srcSlugDir,
      lastCommand: "work-status import-docs",
    });
    imported.push(recorded);
  }

  return imported;
}

/**
 * Lists all statuses found under global `<root>/docs/*\/*\/STATUS.json`,
 * plus an optional repo-local docsRoot (`<repo>/<docsRoot>/<slug>/STATUS.json`).
 * Accepts an optional repoRoot string or `{ repoRoot }` object; defaults to
 * global-only for backward compatibility.
 * @param {string | { repoRoot?: string }} [options]
 */
export async function listAllStatuses(options) {
  const repoRoot =
    typeof options === "string" ? options : options?.repoRoot ?? null;
  const root = getWorkflowRoot();
  const docsRoot = join(root, "docs");
  const results = [];
  const seen = new Set();

  function pushRecord(raw, statusFile) {
    try {
      const parsed = JSON.parse(raw);
      const key = statusFile || `${parsed.repo || ""}::${parsed.slug || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push(parsed);
    } catch {}
  }

  function readStatusFile(statusFile) {
    try {
      pushRecord(readFileSync(statusFile, "utf8"), statusFile);
    } catch {}
  }

  try {
    const repos = readdirSync(docsRoot);
    for (const r of repos) {
      const repoDir = join(docsRoot, r);
      try {
        if (!statSync(repoDir).isDirectory()) continue;
        const slugs = readdirSync(repoDir);
        for (const s of slugs) {
          readStatusFile(join(repoDir, s, "STATUS.json"));
        }
      } catch {}
    }
  } catch {}

  // Repo-local docsRoot: layout is <docsRoot>/<slug>/STATUS.json (no shortRepo level).
  // Honors the deprecated legacy `artifacts` block via the same mapping.
  if (repoRoot) {
    const { docsRoot: custom } = readEffectiveDocsRoot(repoRoot);
    if (custom) {
      const expanded = expandHomePath(custom);
      const base = isAbsolute(expanded)
        ? expanded
        : resolve(repoRoot, expanded);
      try {
        const slugs = readdirSync(base);
        for (const s of slugs) {
          try {
            if (!statSync(join(base, s)).isDirectory()) continue;
          } catch {
            continue;
          }
          readStatusFile(join(base, s, "STATUS.json"));
        }
      } catch {}
    }
  }

  return results.sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
}

function takeSessionIdArg(argv) {
  const rest = [];
  let sessionId;
  for (let i = 0; i < argv.length; i++) {
    if (
      (argv[i] === "--session-id" || argv[i] === "--sessionId") &&
      argv[i + 1]
    ) {
      sessionId = argv[++i];
    } else {
      rest.push(argv[i]);
    }
  }
  return { args: rest, sessionId };
}

// CLI entrypoint
if (process.argv[1] && process.argv[1].endsWith("work-status.mjs")) {
  const { repo: cliRepo, rest: argvAfterRepo } = parseRepoArg(process.argv.slice(2));
  const parsed = takeSessionIdArg(argvAfterRepo);
  const args = parsed.args;
  const cliSessionId = parsed.sessionId;
  const command = args[0] || "list";

  (async () => {
    if (command === "list") {
      const list = await listAllStatuses({ repoRoot: cliRepo });
      if (list.length === 0) {
        console.log("No active workflow statuses found.");
        process.exit(0);
      }
      console.log(
        [
          "Slug".padEnd(24),
          "Repo".padEnd(20),
          "Branch".padEnd(16),
          "Phase".padEnd(10),
          "Progress".padEnd(10),
          "Session".padEnd(24),
          "Updated",
        ].join(" ")
      );
      console.log("-".repeat(120));
      for (const item of list) {
        const prog = `${item.tasks?.done ?? 0}/${item.tasks?.total ?? 0}`;
        console.log(
          [
            (item.slug || "").slice(0, 23).padEnd(24),
            (item.shortRepo || "").slice(0, 19).padEnd(20),
            (item.branch || "").slice(0, 15).padEnd(16),
            (item.phase || "").slice(0, 9).padEnd(10),
            prog.padEnd(10),
            (item.sessionId || "").slice(0, 23).padEnd(24),
            (item.updatedAt || "").slice(0, 19),
          ].join(" ")
        );
      }
    } else if (command === "show") {
      const slug = args[1];
      if (!slug) {
        console.error("Usage: node scripts/work-status.mjs show <slug>");
        process.exit(1);
      }
      const list = await listAllStatuses({ repoRoot: cliRepo });
      const item = list.find((s) => s.slug === slug);
      if (!item) {
        console.error(`Status not found for slug: ${slug}`);
        process.exit(1);
      }
      console.log(JSON.stringify(item, null, 2));
    } else if (command === "sync") {
      const slug = args[1];
      if (!slug) {
        console.error("Usage: node scripts/work-status.mjs sync <slug> [phase]");
        process.exit(1);
      }
      const phase = args[2];
      const updated = await syncSlug(process.cwd(), slug, {
        phase,
        lastCommand: process.argv.join(" "),
        ...(cliSessionId !== undefined ? { sessionId: cliSessionId } : {}),
      });
      console.log(JSON.stringify(updated, null, 2));
    } else if (command === "record") {
      const slug = args[1];
      const phase = args[2] || "explore";
      if (!slug) {
        console.error("Usage: node scripts/work-status.mjs record <slug> [phase]");
        process.exit(1);
      }
      const updated = await syncSlug(process.cwd(), slug, {
        phase,
        lastCommand: process.argv.join(" "),
        ...(cliSessionId !== undefined ? { sessionId: cliSessionId } : {}),
      });
      console.log(JSON.stringify(updated, null, 2));
    } else if (command === "complete") {
      const slug = args[1];
      if (!slug) {
        console.error("Usage: node scripts/work-status.mjs complete <slug>");
        process.exit(1);
      }
      const updated = await syncSlug(process.cwd(), slug, {
        phase: "complete",
        lastCommand: process.argv.join(" "),
        ...(cliSessionId !== undefined ? { sessionId: cliSessionId } : {}),
      });
      console.log(JSON.stringify(updated, null, 2));
    } else if (command === "path") {
      const slug = args[1];
      if (!slug) {
        console.error("Usage: node scripts/work-status.mjs path <slug> [--repo <dir>]");
        process.exit(1);
      }
      const docsDir = ensureDocsDir(cliRepo, slug);
      console.log(docsDir);
    } else if (command === "import-docs") {
      const srcArg = args[1];
      let repo = process.cwd();
      let src = join(repo, ".docs");
      if (srcArg) {
        src = resolve(srcArg);
        if (basename(src) === ".docs") repo = resolve(src, "..");
        else repo = src;
      }
      const imported = await importDocs(repo, src);
      console.log(`Imported ${imported.length} slug(s) from ${src}`);
      for (const item of imported) {
        const prog = `${item.tasks?.done ?? 0}/${item.tasks?.total ?? 0}`;
        console.log(
          `  ${item.shortRepo}/${item.slug}  phase=${item.phase}  tasks=${prog}  repo=${item.repo}`
        );
      }
    } else {
      console.error(`Unknown command: ${command}`);
      console.error("Usage: node scripts/work-status.mjs list|show <slug>|sync <slug> [phase]|record <slug> [phase]|complete <slug>|path <slug> [--repo <dir>]|import-docs [srcDir] [--session-id <id>]");
      process.exit(1);
    }
  })().catch((err) => {
    console.error("Error in work-status:", err.message);
    process.exit(1);
  });
}
