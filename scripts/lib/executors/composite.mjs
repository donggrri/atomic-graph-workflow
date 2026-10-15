import { createTaskCardAdapter, formatPrompt } from "../adapters/task-card.mjs";
import { createSdkAdapter, loadSdk } from "../adapters/sdk.mjs";
import { resolveExecutorForPhase } from "./resolve.mjs";
import {
  isExecutorAvailable,
  probeCursorSdkAvailable,
  resolveExecutorWithFallbackAsync,
} from "./availability.mjs";
import { EXECUTOR_FALLBACK_CHAIN } from "./constants.mjs";
import { runWorkerExecutor } from "./worker-cli.mjs";
import { runCursorAgentCli } from "./cursor-agent-cli.mjs";
import { applyStagePolicy } from "./delegation-policy.mjs";
import { runPiCli } from "./pi-cli.mjs";
import { EXECUTOR_WORKER } from "./constants.mjs";
import { resolveExecutorTimeoutMin } from "../effective-settings.mjs";

/**
 * @param {{
 *   adapter: { mode?: string, runRole?: Function } | null,
 *   repoRoot: string,
 *   slug: string,
 *   runsDir: string,
 *   docsDir?: string,
 *   graph: { nodes: Record<string, Record<string, unknown>> },
 *   settings: { executors?: Record<string, string>, executorTimeouts?: Record<string, number>, trustedExecutors?: Record<string, boolean> },
 *   log?: (...args: unknown[]) => void,
 *   loadSdkFn?: typeof loadSdk,
 *   createSdkAdapterFn?: typeof createSdkAdapter,
 *   crossExecutorStartupFallback?: boolean,
 * }} options
 */
export function createCompositeRoleRunner(options) {
  const crossExecutorStartupFallback = options.crossExecutorStartupFallback !== false;
  const log = options.log ?? (() => {});
  const taskCard = createTaskCardAdapter({
    runsDir: options.runsDir,
    slug: options.slug,
    repoRoot: options.repoRoot,
    docsDir: options.docsDir,
  });
  let sdkAdapterPromise = null;

  async function getSdkAdapter() {
    if (options.adapter?.mode === "sdk" && typeof options.adapter.runRole === "function") {
      return options.adapter;
    }
    if (!sdkAdapterPromise) {
      const loadSdkFn = options.loadSdkFn ?? loadSdk;
      const createSdkAdapterFn = options.createSdkAdapterFn ?? createSdkAdapter;
      sdkAdapterPromise = (async () => {
        const sdk = await loadSdkFn();
        return sdk ? createSdkAdapterFn({ repoRoot: options.repoRoot, sdk }) : null;
      })();
    }
    return sdkAdapterPromise;
  }

  async function dispatchExecutor(executor, stage, params, roleKey) {
    const timeoutMin = resolveExecutorTimeoutMin(options.settings?.executorTimeouts, stage);
    const role = roleKey ?? params.role;
    const rawPrompt = params.prompt ?? "";
    const prompt = applyStagePolicy(
      stage,
      formatPrompt(options.repoRoot, role, rawPrompt, {
        docsDir: options.docsDir,
        runsDir: options.runsDir,
        skillNames: stage === "lite" ? ["atomic-lite", "atomic-workflow"] : undefined,
      }),
    );
    const base = {
      role,
      prompt,
      cwd: params.cwd ?? options.repoRoot,
      onProgress: params.onProgress,
    };

    if (executor === "cursor-sdk") {
      if (options.adapter?.mode === "task-card") {
        return taskCard.runRole(base);
      }
      if (typeof options.adapter?.runRole === "function") {
        return options.adapter.runRole(base);
      }
      const sdk = await getSdkAdapter();
      if (!sdk) {
        return { ok: false, kind: "startup", message: "@cursor/sdk not available" };
      }
      return sdk.runRole(base);
    }

    if (executor === "cursor-subagent") {
      if (typeof options.adapter?.runRole === "function") {
        return options.adapter.runRole(base);
      }
      return taskCard.runRole(base);
    }

    if (executor === "cursor-agent") {
      return runCursorAgentCli({
        repoRoot: options.repoRoot,
        prompt: base.prompt,
        timeoutMin,
        skipTrust: process.env.CURSOR_ATOMIC_TRUST_COMMANDS === "1",
        settings: options.settings,
      });
    }

    if (EXECUTOR_WORKER[executor]) {
      return runWorkerExecutor({
        executorId: executor,
        repoRoot: options.repoRoot,
        prompt: base.prompt,
        runsDir: options.runsDir,
        role: base.role,
        timeoutMin,
        skipTrust: process.env.CURSOR_ATOMIC_TRUST_COMMANDS === "1",
        settings: options.settings,
      });
    }

    if (executor === "pi") {
      return runPiCli({
        repoRoot: options.repoRoot,
        prompt: base.prompt,
        timeoutMin,
        agentStem: base.role,
      });
    }

    return { ok: false, kind: "run", message: `unsupported executor ${executor}` };
  }

  async function resolveAndDispatch(phaseKey, params, roleKey) {
    await probeCursorSdkAvailable();
    const { stage, executorId } = resolveExecutorForPhase({
      phaseKey,
      graph: options.graph,
      settings: options.settings,
      adapter: options.adapter,
    });
    const preferred = executorId;
    const allowPi = preferred === "pi";
    const { executor, fallbackFrom } = await resolveExecutorWithFallbackAsync(preferred, {
      allowPi,
    });
    if (fallbackFrom) {
      log(`executor: ${stage ?? phaseKey} ${fallbackFrom} → ${executor} (CLI missing)`);
    }

    const tried = new Set();
    let current = executor;
    while (true) {
      const result = await dispatchExecutor(current, stage, params, roleKey);
      if (result.ok || result.kind !== "startup") {
        return result;
      }
      if (!crossExecutorStartupFallback) {
        return result;
      }
      tried.add(current);
      let next = null;
      for (const candidate of [preferred, ...EXECUTOR_FALLBACK_CHAIN]) {
        if (tried.has(candidate) || candidate === current) continue;
        if (candidate === "pi" && !allowPi) continue;
        if (isExecutorAvailable(candidate)) {
          next = candidate;
          break;
        }
      }
      if (!next) return result;
      log(`executor: ${stage ?? phaseKey} ${current} startup failed → ${next}`);
      current = next;
    }
  }

  return {
    /**
     * @param {{ role: string, prompt?: string, cwd?: string, phaseKey?: string, onProgress?: (line: string) => void }} params
     */
    async runRole(params) {
      return resolveAndDispatch(params.phaseKey ?? params.role, params, params.role);
    },

    /**
     * Lite stage: no Task subagent — prompt + atomic-lite skill paths only.
     * @param {{ prompt?: string, phaseKey?: string, onProgress?: (line: string) => void }} params
     */
    async runLite(params) {
      return resolveAndDispatch(
        params.phaseKey ?? "lite",
        { ...params, role: "worker" },
        "worker",
      );
    },
  };
}
