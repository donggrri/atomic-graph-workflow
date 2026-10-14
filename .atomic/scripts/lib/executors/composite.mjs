import { createTaskCardAdapter } from "../adapters/task-card.mjs";
import { createSdkAdapter, loadSdk } from "../adapters/sdk.mjs";
import { resolveExecutorForPhase, resolveExecutorModel } from "./resolve.mjs";
import { resolveExecutorWithFallback } from "./availability.mjs";
import { runWorkerExecutor } from "./worker-cli.mjs";
import { runCursorAgentCli } from "./cursor-agent-cli.mjs";
import { EXECUTOR_WORKER } from "./constants.mjs";

/**
 * Unified role runner: per-stage executor from graph + settings, with CLI fallback.
 *
 * @param {{
 *   adapter: { mode?: string, runRole?: Function } | null,
 *   repoRoot: string,
 *   slug: string,
 *   runsDir: string,
 *   graph: { nodes: Record<string, Record<string, unknown>> },
 *   settings: { executors?: Record<string, string>, executorModels?: Record<string, string>, agyModel?: string | null },
 *   log?: (...args: unknown[]) => void,
 *   loadSdkFn?: typeof loadSdk,
 *   createSdkAdapterFn?: typeof createSdkAdapter,
 * }} options
 */
export function createCompositeRoleRunner(options) {
  const log = options.log ?? (() => {});
  const taskCard = createTaskCardAdapter({
    runsDir: options.runsDir,
    slug: options.slug,
    repoRoot: options.repoRoot,
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

  return {
    /**
     * @param {{ role: string, prompt?: string, cwd?: string, model?: string, phaseKey?: string, onProgress?: (line: string) => void }} params
     */
    async runRole(params) {
      const phaseKey = params.phaseKey ?? params.role;
      const { stage, executorId } = resolveExecutorForPhase({
        phaseKey,
        graph: options.graph,
        settings: options.settings,
        adapter: options.adapter,
      });
      const { executor, fallbackFrom } = resolveExecutorWithFallback(executorId);
      if (fallbackFrom) {
        log(`executor: ${stage ?? phaseKey} ${fallbackFrom} → ${executor} (CLI missing)`);
      }

      const model = resolveExecutorModel({
        stage,
        graph: options.graph,
        settings: options.settings,
        roleModel: params.model ?? "",
      });
      const agyModel =
        executor === "agy" && options.settings?.agyModel ? options.settings.agyModel : model;

      const base = {
        role: params.role,
        prompt: params.prompt,
        cwd: params.cwd ?? options.repoRoot,
        model,
        onProgress: params.onProgress,
      };

      if (executor === "cursor-sdk") {
        if (typeof options.adapter?.runRole === "function" && options.adapter?.mode !== "task-card") {
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
          prompt: params.prompt ?? "",
        });
      }

      if (EXECUTOR_WORKER[executor]) {
        return runWorkerExecutor({
          executorId: executor,
          repoRoot: options.repoRoot,
          prompt: params.prompt ?? "",
          runsDir: options.runsDir,
          role: params.role,
          model: agyModel,
          skipTrust: process.env.CURSOR_ATOMIC_TRUST_COMMANDS === "1",
        });
      }

      if (executor === "pi") {
        return {
          ok: false,
          kind: "run",
          message: "pi executor: use opencode or cursor-subagent (pi headless runner not wired)",
        };
      }

      return { ok: false, kind: "run", message: `unsupported executor ${executor}` };
    },
  };
}
