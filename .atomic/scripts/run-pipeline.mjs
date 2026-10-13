#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPipeline } from "./lib/pipeline.mjs";
import { syncSlug, getWorkflowPaths } from "./work-status.mjs";
import { runDone } from "./run-done.mjs";
import { createTaskCardAdapter } from "./lib/adapters/task-card.mjs";
import { createSdkAdapter, loadSdk } from "./lib/adapters/sdk.mjs";

export const SDK_INSTALL_HINT =
  "task-card selected: @cursor/sdk is not installed; run npm install to use the SDK adapter. Using task-card.";

export const TASK_CARD_EXPLICIT_HINT =
  "task-card selected: --adapter task-card";

/**
 * Pipeline command log for one task id. Evidence is evidencePath(this).
 * @param {string} runsDir
 * @param {string} taskId
 * @returns {string}
 */
export function taskLogPath(runsDir, taskId) {
  return join(runsDir, `${taskId}.log`);
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { auto: false, resume: false, dryRun: false };
  let slug = null;
  let repo = process.cwd();
  let adapterName = null;
  let profileId = null;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--auto") flags.auto = true;
    else if (a === "--resume") flags.resume = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--adapter") {
      adapterName = args[i + 1];
      i += 1;
    } else if (a === "--profile") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        return { error: "missing --profile value" };
      }
      profileId = value;
      i += 1;
    } else if (a === "--repo") {
      repo = resolve(args[i + 1] ?? "");
      i += 1;
    } else if (a.startsWith("-")) {
      return { error: `unknown option: ${a}` };
    } else if (!slug) {
      slug = a;
    } else {
      return { error: "unexpected extra argument" };
    }
  }

  return { slug, repo, flags, adapterName, profileId };
}

function usage() {
  return `Usage: node scripts/run-pipeline.mjs <slug> [--auto] [--resume] [--adapter sdk|task-card] [--profile <id>] [--repo <dir>] [--dry-run]`;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/**
 * One reason line on stderr, and the same line appended to pipeline.log.
 * @param {(message: string) => void} logHint
 * @param {string} repo
 * @param {string} slug
 * @param {string} line
 */
function emitAdapterReason(logHint, repo, slug, line) {
  const text = oneLine(line);
  logHint(text);
  const { runsDir } = getWorkflowPaths(repo, slug);
  mkdirSync(runsDir, { recursive: true });
  appendFileSync(join(runsDir, "pipeline.log"), `${text}\n`);
}

async function resolveTaskCardAdapter(repo, slug) {
  const { runsDir } = getWorkflowPaths(repo, slug);
  return createTaskCardAdapter({ runsDir, slug, repoRoot: repo });
}

/**
 * @param {{
 *   adapterName: string | null,
 *   repo: string,
 *   slug: string,
 *   loadSdkFn?: typeof loadSdk,
 *   createSdkAdapterFn?: typeof createSdkAdapter,
 *   logHint?: (message: string) => void,
 * }} options
 * @returns {Promise<{ adapter: object | null, used: "sdk" | "task-card" | null, unknownAdapter?: boolean }>}
 */
export async function resolvePipelineAdapter({
  adapterName,
  repo,
  slug,
  loadSdkFn = loadSdk,
  createSdkAdapterFn = createSdkAdapter,
  logHint = (message) => {
    process.stderr.write(`${message}\n`);
  },
}) {
  if (adapterName != null && adapterName !== "sdk" && adapterName !== "task-card") {
    return { adapter: null, used: null, unknownAdapter: true };
  }

  if (adapterName === "task-card") {
    emitAdapterReason(logHint, repo, slug, TASK_CARD_EXPLICIT_HINT);
    return {
      adapter: await resolveTaskCardAdapter(repo, slug),
      used: "task-card",
    };
  }

  let importError = null;
  const sdkModule = await loadSdkFn(undefined, (err) => {
    importError = err;
  });

  if (sdkModule) {
    const sdkAdapter = await createSdkAdapterFn({ repoRoot: repo, sdk: sdkModule });
    if (!sdkAdapter) {
      emitAdapterReason(
        logHint,
        repo,
        slug,
        "@cursor/sdk import succeeded but the SDK adapter was not created.",
      );
      return { adapter: null, used: "sdk" };
    }
    return { adapter: sdkAdapter, used: "sdk" };
  }

  const detail =
    importError instanceof Error
      ? importError.message
      : importError
        ? String(importError)
        : "";

  if (adapterName === "sdk") {
    emitAdapterReason(
      logHint,
      repo,
      slug,
      detail
        ? `@cursor/sdk import failed: ${detail}. --adapter sdk does not select task-card.`
        : "@cursor/sdk import failed. --adapter sdk does not select task-card.",
    );
    return { adapter: null, used: "sdk" };
  }

  emitAdapterReason(
    logHint,
    repo,
    slug,
    detail
      ? `task-card selected: @cursor/sdk import failed: ${detail}`
      : SDK_INSTALL_HINT,
  );
  return {
    adapter: await resolveTaskCardAdapter(repo, slug),
    used: "task-card",
  };
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.error || !parsed.slug) {
    console.error(usage());
    process.exit(2);
  }

  const { slug, repo, flags, adapterName, profileId } = parsed;

  if (flags.dryRun) {
    const result = await runPipeline({
      repoRoot: repo,
      slug,
      flags,
      profileId,
      adapter: {
        async runRole() {
          return { ok: true, summary: "dry-run" };
        },
      },
      runDone: async () => ({ ok: true }),
      statusSync: async (s) => {
        await syncSlug(repo, s);
      },
      log: (...args) => console.log(...args),
    });
    process.exit(result.exitCode);
  }

  if (adapterName != null && adapterName !== "task-card" && adapterName !== "sdk") {
    console.error(`unknown adapter: ${adapterName}`);
    console.error(usage());
    process.exit(2);
  }

  const { adapter, used, unknownAdapter } = await resolvePipelineAdapter({
    adapterName,
    repo,
    slug,
  });

  if (unknownAdapter || !adapter) {
    if (used !== "sdk") console.error(usage());
    process.exit(2);
  }

  const result = await runPipeline({
    repoRoot: repo,
    slug,
    flags,
    profileId,
    adapter,
    runDone: async ({ taskId, command, cwd }) => {
      const { runsDir } = getWorkflowPaths(repo, slug);
      const logPath = taskLogPath(runsDir, taskId);
      const timeoutMs = parseInt(process.env.TIMEOUT_MS || "30000", 10);
      const result = await runDone({ cwd, command, logPath, timeoutMs });
      return {
        ok: result.ok,
        message: result.errorTail || (result.ok ? undefined : `exit ${result.exitCode}`),
      };
    },
    statusSync: async (s) => {
      await syncSlug(repo, s);
    },
    log: (...args) => console.log(...args),
  });
  process.exit(result.exitCode);
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(2);
  });
}
