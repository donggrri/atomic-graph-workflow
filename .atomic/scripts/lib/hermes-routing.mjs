import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYamlLite } from "./yaml-lite.mjs";
import { binOnPath } from "./cli-detect.mjs";

export const HERMES_RUNNERS = ["cursor-agent", "opencode", "agy"];

export const CURSOR_AGENT_DEFAULT_MODEL = "composer-2.5";

/** @type {readonly string[]} */
export const CURSOR_AGENT_ALLOWED_MODELS = [
  CURSOR_AGENT_DEFAULT_MODEL,
  "claude-haiku-5-5-high",
  "claude-sonnet-5-5-high",
  "grok-4.7-high",
];

export const OPENCODE_MODEL_DEEPSEEK = "opencode/deepseek-v4.1-flash-free";
export const OPENCODE_MODEL_GLM = "opencode/glm-5.3-flash-free";

/** @type {readonly string[]} */
export const OPENCODE_ALLOWED_MODELS = [OPENCODE_MODEL_DEEPSEEK, OPENCODE_MODEL_GLM];

/** @type {Record<string, string>} */
export const CURSOR_AGENT_MODEL_ALIASES = {
  "haiku-5.5-high": "claude-haiku-5-5-high",
  "sonnet-5.5-high": "claude-sonnet-5-5-high",
};

const DEFAULT_MODELS = {
  "cursor-agent": CURSOR_AGENT_DEFAULT_MODEL,
  agy: "gemini-3.8-flash-high",
};

const CURSOR_AGENT_SONNET = "claude-sonnet-5-5-high";
const CURSOR_AGENT_HAIKU = "claude-haiku-5-5-high";
const CURSOR_AGENT_GROK = "grok-4.7-high";

/** @typedef {{ runner: string, model: string }} HermesRoute */

/**
 * @param {string} model
 */
export function rejectFastModel(model) {
  if (typeof model === "string" && model.toLowerCase().includes("fast")) {
    throw new Error(`fast models are not allowed for Hermes delegation: ${model}`);
  }
}

/**
 * @param {string} model
 * @returns {{ model: string, warning?: string }}
 */
export function normalizeCursorAgentModel(model) {
  const raw = String(model ?? "").trim();
  rejectFastModel(raw);
  const resolved = CURSOR_AGENT_MODEL_ALIASES[raw] ?? raw;
  if (CURSOR_AGENT_ALLOWED_MODELS.includes(resolved)) {
    return { model: resolved };
  }
  const allowed = CURSOR_AGENT_ALLOWED_MODELS.join(", ");
  const warning =
    `unknown cursor-agent model "${raw}"; allowed: ${allowed}; using ${CURSOR_AGENT_DEFAULT_MODEL}`;
  return { model: CURSOR_AGENT_DEFAULT_MODEL, warning };
}

/**
 * @param {string} model
 * @returns {{ model: string, warning?: string }}
 */
export function normalizeOpencodeModel(model) {
  const raw = String(model ?? "").trim();
  rejectFastModel(raw);
  if (OPENCODE_ALLOWED_MODELS.includes(raw)) {
    return { model: raw };
  }
  const warning = `unknown opencode model "${raw}"; using ${OPENCODE_MODEL_GLM}`;
  return { model: OPENCODE_MODEL_GLM, warning };
}

/**
 * @param {string} stage
 */
function stageBucket(stage) {
  const s = String(stage).toLowerCase();
  if (["explore", "plan", "spec", "plan-review", "spec-review", "escalate"].includes(s)) return "planning";
  if (["execute", "implement", "fix", "task"].includes(s)) return "implement";
  if (s === "review") return "review";
  if (s === "test") return "test";
  if (["docs", "wrapup", "memory"].includes(s)) return "docs";
  return "other";
}

/**
 * @param {string} stage
 * @param {{ lastImplementRunner?: string | null }} ctx
 * @returns {HermesRoute}
 */
export function defaultRouteForStage(stage, ctx = {}) {
  const s = String(stage).toLowerCase();

  if (s === "explore" || s === "test") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_HAIKU };
  }
  if (["execute", "implement", "fix", "task"].includes(s)) {
    return { runner: "cursor-agent", model: CURSOR_AGENT_DEFAULT_MODEL };
  }
  if (s === "plan-review") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_GROK };
  }
  if (s === "spec-review" || s === "escalate") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_GROK };
  }
  if (s === "review") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_SONNET };
  }
  if (s === "plan" || s === "spec") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_SONNET };
  }
  if (stageBucket(stage) === "docs") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_DEFAULT_MODEL };
  }
  return { runner: "cursor-agent", model: CURSOR_AGENT_DEFAULT_MODEL };
}

/**
 * @param {string} bucket
 * @param {{ lastImplementRunner?: string | null }} ctx
 * @returns {HermesRoute}
 */
export function defaultRouteForBucket(bucket, ctx = {}) {
  if (bucket === "planning" || bucket === "review") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_SONNET };
  }
  if (bucket === "implement" || bucket === "docs") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_DEFAULT_MODEL };
  }
  if (bucket === "test") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_HAIKU };
  }
  return { runner: "cursor-agent", model: DEFAULT_MODELS["cursor-agent"] };
}

/**
 * @param {string} stage
 * @returns {HermesRoute}
 */
function cursorAgentFallbackForStage(stage) {
  const s = String(stage).toLowerCase();
  if (s === "explore" || s === "test") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_HAIKU };
  }
  if (s === "plan-review" || s === "spec-review" || s === "escalate") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_GROK };
  }
  if (s === "plan" || s === "spec" || s === "review" || stageBucket(stage) === "planning") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_SONNET };
  }
  return { runner: "cursor-agent", model: CURSOR_AGENT_DEFAULT_MODEL };
}

/**
 * @param {string} stage
 * @param {HermesRoute} primary
 * @returns {HermesRoute}
 */
function fallbackRouteForStage(stage, primary) {
  const s = String(stage).toLowerCase();
  if (primary.runner === "agy") {
    if (s === "plan-review") {
      return { runner: "cursor-agent", model: CURSOR_AGENT_GROK };
    }
    const sonnetStages = ["plan", "spec", "review"];
    const model =
      sonnetStages.includes(s) || stageBucket(stage) === "review"
        ? CURSOR_AGENT_SONNET
        : CURSOR_AGENT_DEFAULT_MODEL;
    return { runner: "cursor-agent", model };
  }
  if (primary.runner === "opencode") {
    return cursorAgentFallbackForStage(stage);
  }
  if (s === "explore" || s === "test") {
    return { runner: "opencode", model: OPENCODE_MODEL_GLM };
  }
  if (["execute", "implement", "fix", "task"].includes(s) || stageBucket(stage) === "docs") {
    return { runner: "opencode", model: OPENCODE_MODEL_DEEPSEEK };
  }
  if (s === "plan-review" || s === "spec-review" || s === "escalate") {
    return { runner: "opencode", model: OPENCODE_MODEL_GLM };
  }
  return { runner: "opencode", model: OPENCODE_MODEL_GLM };
}

/**
 * @param {HermesRoute} route
 * @returns {{ route: HermesRoute, warning?: string }}
 */
function applyRunnerNormalization(route) {
  if (route.runner === "cursor-agent") {
    const { model, warning } = normalizeCursorAgentModel(route.model);
    return { route: { ...route, model }, warning };
  }
  if (route.runner === "opencode") {
    const { model, warning } = normalizeOpencodeModel(route.model);
    return { route: { ...route, model }, warning };
  }
  if (route.runner === "agy") {
    rejectFastModel(route.model);
    return { route };
  }
  return { route };
}

/**
 * @typedef {{ overrides: Record<string, HermesRoute>, globalFallback?: boolean, stageFallback: Record<string, boolean> }} HermesRoutingConfig
 */

/**
 * @param {unknown} cfg
 * @param {Record<string, HermesRoute>} into
 * @param {Record<string, boolean>} stageFallback
 */
function ingestRoutingEntry(stage, cfg, into, stageFallback) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return;
  if (Object.prototype.hasOwnProperty.call(cfg, "fallback") && cfg.fallback === false) {
    stageFallback[stage] = false;
  }
  const runner = cfg.runner ?? cfg.executor;
  const model = cfg.model;
  if (typeof runner === "string" && typeof model === "string") {
    into[stage] = { runner, model };
  } else if (typeof runner === "string" && (runner === "cursor-agent" || runner === "agy" || runner === "opencode")) {
    into[stage] = { runner, model: DEFAULT_MODELS[runner] ?? model ?? CURSOR_AGENT_DEFAULT_MODEL };
  }
}

/**
 * @param {string} repoRoot
 * @returns {HermesRoutingConfig}
 */
export function loadHermesRoutingOverrides(repoRoot) {
  /** @type {Record<string, HermesRoute>} */
  const fromGraph = {};
  /** @type {Record<string, boolean>} */
  const stageFallback = {};
  let globalFallback;

  const graphPath = join(repoRoot, ".atomic", "graph.yaml");
  if (existsSync(graphPath)) {
    const text = readFileSync(graphPath, "utf8");
    const { value } = parseYamlLite(text);
    const root = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const nodes = root.nodes;
    if (nodes && typeof nodes === "object" && !Array.isArray(nodes)) {
      for (const [stage, node] of Object.entries(nodes)) {
        if (!node || typeof node !== "object" || Array.isArray(node)) continue;
        const exec = node.executor;
        if (exec !== "cursor-agent" && exec !== "agy" && exec !== "opencode") continue;
        const model = node.model;
        if (typeof model === "string") {
          fromGraph[stage] = { runner: exec, model };
        } else if (typeof exec === "string") {
          fromGraph[stage] = {
            runner: exec,
            model: DEFAULT_MODELS[exec] ?? CURSOR_AGENT_DEFAULT_MODEL,
          };
        }
      }
    }
    const hermes = root.hermes;
    if (hermes && typeof hermes === "object" && !Array.isArray(hermes)) {
      if (hermes.fallback === false) {
        globalFallback = false;
      }
      const routing = hermes.routing;
      if (routing && typeof routing === "object" && !Array.isArray(routing)) {
        for (const [stage, cfg] of Object.entries(routing)) {
          ingestRoutingEntry(stage, cfg, fromGraph, stageFallback);
        }
      }
    }
  }

  /** @type {Record<string, HermesRoute>} */
  let fromEnv = {};
  const raw = process.env.ATOMIC_HERMES_ROUTING;
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(String(raw));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (parsed.fallback === false) {
          globalFallback = false;
        }
        for (const [stage, cfg] of Object.entries(parsed)) {
          if (stage === "fallback") continue;
          ingestRoutingEntry(stage, cfg, fromEnv, stageFallback);
        }
      }
    } catch {
      // ignore invalid env JSON
    }
  }

  return { overrides: { ...fromGraph, ...fromEnv }, globalFallback, stageFallback };
}

/**
 * @param {string} stage
 * @param {HermesRoutingConfig} routingConfig
 */
export function isFallbackEnabledForStage(stage, routingConfig) {
  if (routingConfig.globalFallback === false) return false;
  if (routingConfig.stageFallback?.[stage] === false) return false;
  return true;
}

/**
 * @param {string} stage
 * @param {{ repoRoot?: string, lastImplementRunner?: string | null, overrides?: Record<string, HermesRoute>, routingConfig?: HermesRoutingConfig }} [options]
 */
export function resolveHermesRoute(stage, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const routingConfig = options.routingConfig ?? loadHermesRoutingOverrides(repoRoot);
  const overrides = options.overrides ?? routingConfig.overrides;
  const bucket = stageBucket(stage);
  let route = overrides[stage]
    ? { ...overrides[stage] }
    : defaultRouteForStage(stage, { lastImplementRunner: options.lastImplementRunner });

  if (!HERMES_RUNNERS.includes(route.runner)) {
    route = defaultRouteForStage(stage, { lastImplementRunner: options.lastImplementRunner });
  }

  let warning;
  const primaryNorm = applyRunnerNormalization(route);
  route = primaryNorm.route;
  if (primaryNorm.warning) warning = primaryNorm.warning;

  rejectFastModel(route.model);

  let fallback = fallbackRouteForStage(stage, route);
  const fallbackEnabled = isFallbackEnabledForStage(stage, routingConfig);
  if (!fallbackEnabled) {
    fallback = null;
  } else {
    const fallbackNorm = applyRunnerNormalization(fallback);
    fallback = fallbackNorm.route;
    if (!warning && fallbackNorm.warning) warning = fallbackNorm.warning;
    rejectFastModel(fallback.model);
    if (fallback.runner === route.runner && fallback.model === route.model) {
      fallback = null;
    }
  }

  const out = {
    stage,
    runner: route.runner,
    model: route.model,
    fallback,
    fallbackEnabled,
    bucket,
  };
  if (warning) out.warning = warning;
  return out;
}

/**
 * @param {string} runner
 */
export function isHermesRunnerOnPath(runner) {
  if (runner === "cursor-agent") return binOnPath(["cursor-agent", "agent"]);
  if (runner === "agy") return binOnPath(["agy"]);
  if (runner === "opencode") return binOnPath(["opencode"]);
  return false;
}
