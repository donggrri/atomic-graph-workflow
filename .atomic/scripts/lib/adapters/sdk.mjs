import { resolve } from "node:path";
import { getRole } from "../roles.mjs";

const SETTING_SOURCES = ["user", "project", "plugins"];

/**
 * @param {() => Promise<unknown>} [importFn]
 * @returns {Promise<import("@cursor/sdk") | null>}
 */
export async function loadSdk(importFn, onError) {
  const doImport =
    typeof importFn === "function" ? importFn : () => import("@cursor/sdk");
  try {
    return await doImport();
  } catch (err) {
    if (typeof onError === "function") onError(err);
    return null;
  }
}

/**
 * @param {unknown} err
 * @param {new (...args: unknown[]) => Error} [CursorAgentError]
 */
function isStartupFailure(err, CursorAgentError) {
  if (CursorAgentError && err instanceof CursorAgentError) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /Authentication|Configuration/i.test(msg);
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function safeErrorMessage(err) {
  if (err instanceof Error) {
    return err.message || err.name || "SDK startup failed";
  }
  return String(err);
}

const MAX_PROGRESS_TEXT = 120;
const STREAM_DRAIN_MS = 2000;

/**
 * @param {unknown} text
 * @returns {string}
 */
function shorten(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > MAX_PROGRESS_TEXT ? `${s.slice(0, MAX_PROGRESS_TEXT - 1)}…` : s;
}

/**
 * @param {unknown} args
 * @returns {string}
 */
function briefArgs(args) {
  if (!args || typeof args !== "object") return "";
  const a = /** @type {Record<string, unknown>} */ (args);
  const key = ["subagentType", "subagent_type", "description", "path", "command", "pattern"].find(
    (k) => typeof a[k] === "string" && a[k],
  );
  return key ? shorten(a[key]) : "";
}

/**
 * Turn one SDK stream message into a single progress line, or null to skip.
 * Subagent launches (`task`) and status changes are always reported; ordinary
 * tool calls only when `verbose` is set.
 *
 * @param {Record<string, any>} msg
 * @param {{ verbose?: boolean, seen?: Set<string> }} [opts]
 * @returns {string | null}
 */
export function formatProgressEvent(msg, { verbose = false, seen = new Set() } = {}) {
  if (!msg || typeof msg !== "object") return null;
  if (msg.type === "status") {
    const extra = msg.message ? ` ${shorten(msg.message)}` : "";
    return `status ${msg.status}${extra}`;
  }
  if (msg.type === "task") {
    const text = msg.text ? ` ${shorten(msg.text)}` : "";
    return `subagent ${msg.status ?? "update"}${text}`;
  }
  if (msg.type === "tool_call") {
    const isTask = String(msg.name).toLowerCase() === "task";
    if (!isTask && !verbose) return null;
    const key = `${msg.call_id}:${msg.status}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const brief = briefArgs(msg.args);
    const label = isTask ? "subagent" : "tool";
    const name = isTask ? "" : ` ${msg.name}`;
    return `${label}${name} ${msg.status}${brief ? ` ${brief}` : ""}`.replace(/\s+/g, " ");
  }
  return null;
}

/**
 * Consume run.stream() and forward progress lines. Never throws.
 *
 * @param {{ stream?: () => AsyncIterable<unknown> }} run
 * @param {((line: string) => void) | undefined} onProgress
 * @returns {Promise<void>}
 */
async function pumpProgress(run, onProgress) {
  if (typeof onProgress !== "function" || typeof run?.stream !== "function") return;
  const verbose = process.env.ATOMIC_PROGRESS === "tools";
  const seen = new Set();
  try {
    for await (const msg of run.stream()) {
      const line = formatProgressEvent(/** @type {any} */ (msg), { verbose, seen });
      if (line) onProgress(line);
    }
  } catch {
    // progress is best-effort; run.wait() decides success or failure
  }
}

/**
 * @param {{ dispose?: () => Promise<void>, close?: () => Promise<void> }} agent
 */
async function disposeAgent(agent) {
  if (!agent) return;
  const asyncDispose = agent[Symbol.asyncDispose];
  if (typeof asyncDispose === "function") {
    await asyncDispose.call(agent);
    return;
  }
  if (typeof agent.close === "function") {
    await agent.close();
  }
}

/**
 * @param {{ repoRoot: string, sdk?: Awaited<ReturnType<typeof loadSdk>> }} options
 */
export async function createSdkAdapter({ repoRoot, sdk: sdkOverride }) {
  const sdk = sdkOverride ?? await loadSdk();
  if (!sdk) {
    return null;
  }

  const { Agent, CursorAgentError } = sdk;

  return {
    mode: "sdk",
    /**
     * @param {{ role: string, prompt?: string, cwd?: string, onProgress?: (line: string) => void }} params
     */
    async runRole({ role, prompt, cwd, onProgress }) {
      const roleDef = getRole(role);
      const workCwd = cwd ?? repoRoot;
      let agent;

      try {
        agent = await Agent.create({
          model: roleDef.sdk,
          local: {
            cwd: resolve(workCwd),
            settingSources: SETTING_SOURCES,
          },
        });

        const run = await agent.send(prompt ?? "");
        const progress = pumpProgress(run, onProgress);
        const result = await run.wait();
        let drainTimer;
        await Promise.race([
          progress,
          new Promise((r) => {
            drainTimer = setTimeout(r, STREAM_DRAIN_MS);
          }),
        ]);
        clearTimeout(drainTimer);

        if (result.status === "error") {
          const message =
            result.error?.message ?? `run status error (${result.id ?? "unknown"})`;
          return { ok: false, kind: "run", message };
        }

        const runId = result.id ?? run.id ?? "unknown";
        return {
          ok: true,
          summary: `status=${result.status} runId=${runId}`,
        };
      } catch (err) {
        if (isStartupFailure(err, CursorAgentError)) {
          return { ok: false, kind: "startup", message: safeErrorMessage(err) };
        }
        throw err;
      } finally {
        if (agent) {
          await disposeAgent(agent);
        }
      }
    },
  };
}
