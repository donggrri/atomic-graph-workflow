import { createTaskCardAdapter, formatSkillPrompt } from "../adapters/task-card.mjs";
import { createSdkAdapter, loadSdk } from "../adapters/sdk.mjs";
import { ROLES, AUXILIARY_ROLES } from "../roles.mjs";
import { resolveExecutorForPhase, resolveExecutorModel } from "./resolve.mjs";
import { resolveExecutorWithFallback } from "./availability.mjs";
import { runWorkerExecutor } from "./worker-cli.mjs";
import { runCursorAgentCli } from "./cursor-agent-cli.mjs";
import { runPiCli } from "./pi-cli.mjs";
import { EXECUTOR_WORKER } from "./constants.mjs";
import { resolveExecutorTimeoutMin } from "../effective-settings.mjs";

/**
 * @param {{
 *   adapter: { mode?: string, runRole?: Function } | null,
 *   repoRoot: string,
 *   slug: string,
 *   runsDir: string,
 *   graph: { nodes: Record<string, Record<string, unknown>> },
 *   settings: { executors?: Record<string, string>, executorModels?: Record<string, string>, executorTimeouts?: Record<string, number>, agyModel?: string | null },
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

  async function dispatchExecutor(executor, stage, params, roleKey) {
    const timeoutMin = resolveExecutorTimeoutMin(options.settings?.executorTimeouts, stage);
    const model = resolveExecutorModel({
      stage,
      graph: options.graph,
      settings: options.settings,
      roleModel: params.model ?? "",
    });
    const agyModel =
      executor === "agy" && options.settings?.agyModel ? options.settings.agyModel : model;

    const base = {
      role: roleKey ?? params.role,
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
      if (AUXILIARY_ROLES[base.role] && !ROLES[base.role]) {
        const sdkModule = await (options.loadSdkFn ?? loadSdk)();
        if (!sdkModule) {
          return { ok: false, kind: "startup", message: "@cursor/sdk not available" };
        }
        const { Agent } = sdkModule;
        const roleDef = AUXILIARY_ROLES[base.role];
        let agent;
        try {
          agent = await Agent.create({
            model: roleDef.sdk,
            local: { cwd: options.repoRoot, settingSources: [] },
          });
          const run = await agent.send(base.prompt ?? "");
          const result = await run.wait();
          if (result.status === "error") {
            return { ok: false, kind: "run", message: result.error?.message ?? "sdk error" };
          }
          return { ok: true, summary: `status=${result.status}` };
        } catch (err) {
          return { ok: false, kind: "run", message: err instanceof Error ? err.message : String(err) };
        } finally {
          if (agent && typeof agent[Symbol.asyncDispose] === "function") {
            await agent[Symbol.asyncDispose]();
          }
        }
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
        timeoutMin,
        agentStem: roleKey,
      });
    }

    if (EXECUTOR_WORKER[executor]) {
      return runWorkerExecutor({
        executorId: executor,
        repoRoot: options.repoRoot,
        prompt: params.prompt ?? "",
        runsDir: options.runsDir,
        role: roleKey ?? params.role,
        model: agyModel,
        timeoutMin,
        skipTrust: process.env.CURSOR_ATOMIC_TRUST_COMMANDS === "1",
      });
    }

    if (executor === "pi") {
      return runPiCli({
        repoRoot: options.repoRoot,
        prompt: params.prompt ?? "",
        timeoutMin,
        agentStem: roleKey,
      });
    }

    return { ok: false, kind: "run", message: `unsupported executor ${executor}` };
  }

  async function resolveAndDispatch(phaseKey, params, roleKey) {
    const { stage, executorId } = resolveExecutorForPhase({
      phaseKey,
      graph: options.graph,
      settings: options.settings,
      adapter: options.adapter,
    });
    let preferred = executorId;
    if (phaseKey === "lite" && preferred === "cursor-subagent") {
      preferred = "cursor-sdk";
    }
    const { executor, fallbackFrom } = resolveExecutorWithFallback(preferred, {
      allowPi: preferred === "pi",
    });
    if (fallbackFrom) {
      log(`executor: ${stage ?? phaseKey} ${fallbackFrom} → ${executor} (CLI missing)`);
    }
    return dispatchExecutor(executor, stage, params, roleKey);
  }

  return {
    /**
     * @param {{ role: string, prompt?: string, cwd?: string, model?: string, phaseKey?: string, onProgress?: (line: string) => void }} params
     */
    async runRole(params) {
      return resolveAndDispatch(params.phaseKey ?? params.role, params, params.role);
    },

    /**
     * Lite stage: no Task subagent — prompt + cursor-atomic-lite skill paths only.
     * @param {{ prompt?: string, phaseKey?: string, onProgress?: (line: string) => void }} params
     */
    async runLite(params) {
      const prompt = formatSkillPrompt(
        options.repoRoot,
        ["cursor-atomic-lite", "cursor-atomic-workflow"],
        params.prompt ?? "",
      );
      return resolveAndDispatch(params.phaseKey ?? "lite", { ...params, prompt }, null);
    },
  };
}
