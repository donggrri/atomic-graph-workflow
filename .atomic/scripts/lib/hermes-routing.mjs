import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYamlLite } from "./yaml-lite.mjs";
import { binOnPath } from "./cli-detect.mjs";

export const HERMES_RUNNERS = ["cursor-agent", "agy"];

export const CURSOR_AGENT_DEFAULT_MODEL = "composer-2.5";

/** @type {readonly string[]} */
export const CURSOR_AGENT_ALLOWED_MODELS = [
  CURSOR_AGENT_DEFAULT_MODEL,
  "claude-haiku-5-5-high",
  "claude-sonnet-5-5-high",
  "grok-4.7-high",
];

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
    return { runner: "agy", model: DEFAULT_MODELS.agy };
  }
  if (s === "spec-review" || s === "escalate") {
    return { runner: "cursor-agent", model: CURSOR_AGENT_GROK };
  }
  if (s === "review") {
    const impl = ctx.lastImplementRunner ?? "cursor-agent";
    if (impl === "agy") {
      return { runner: "cursor-agent", model: CURSOR_AGENT_SONNET };
    }
    return { runner: "agy", model: DEFAULT_MODELS.agy };
  }
  if (s === "plan" || s === "spec") {
    return { runner: "agy", model: DEFAULT_MODELS.agy };
  }
  if (stageBucket(stage) === "docs") {
    return { runner: "agy", model: DEFAULT_MODELS.agy };
  }
  return { runner: "cursor-agent", model: CURSOR_AGENT_DEFAULT_MODEL };
}

/**
 * @param {string} bucket
 * @param {{ lastImplementRunner?: string | null }} ctx
 * @returns {HermesRoute}
 */
export function defaultRouteForBucket(bucket, ctx = {}) {
  if (bucket === "planning" || bucket === "docs") {
    return { runner: "agy", model: DEFAULT_MODELS.agy };
  }
  if (bucket === "implement" || bucket === "test") {
    return { runner: "cursor-agent", model: DEFAULT_MODELS["cursor-agent"] };
  }
  if (bucket === "review") {
    return defaultRouteForStage("review", ctx);
  }
  return { runner: "cursor-agent", model: DEFAULT_MODELS["cursor-agent"] };
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
  return { runner: "agy", model: DEFAULT_MODELS.agy };
}

/**
 * @param {HermesRoute} route
 * @returns {{ route: HermesRoute, warning?: string }}
 */
function applyCursorAgentNormalization(route) {
  if (route.runner !== "cursor-agent") {
    return { route };
  }
  const { model, warning } = normalizeCursorAgentModel(route.model);
  return { route: { ...route, model }, warning };
}

/**
 * @param {string} repoRoot
 */
export function loadHermesRoutingOverrides(repoRoot) {
  /** @type {Record<string, HermesRoute>} */
  const fromGraph = {};
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
        if (exec !== "cursor-agent" && exec !== "agy") continue;
        const model = node.model;
        if (typeof model === "string") {
          fromGraph[stage] = { runner: exec, model };
        } else if (typeof exec === "string") {
          fromGraph[stage] = { runner: exec, model: DEFAULT_MODELS[exec] ?? DEFAULT_MODELS.agy };
        }
      }
    }
    const hermes = root.hermes;
    if (hermes && typeof hermes === "object" && !Array.isArray(hermes)) {
      const routing = hermes.routing;
      if (routing && typeof routing === "object" && !Array.isArray(routing)) {
        for (const [stage, cfg] of Object.entries(routing)) {
          if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
          const runner = cfg.runner ?? cfg.executor;
          const model = cfg.model;
          if (typeof runner === "string" && typeof model === "string") {
            fromGraph[stage] = { runner, model };
          }
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
        for (const [stage, cfg] of Object.entries(parsed)) {
          if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
          const runner = cfg.runner ?? cfg.executor;
          const model = cfg.model;
          if (typeof runner === "string" && typeof model === "string") {
            fromEnv[stage] = { runner, model };
          }
        }
      }
    } catch {
      // ignore invalid env JSON
    }
  }

  return { ...fromGraph, ...fromEnv };
}

/**
 * @param {string} stage
 * @param {{ repoRoot?: string, lastImplementRunner?: string | null, overrides?: Record<string, HermesRoute> }} [options]
 */
export function resolveHermesRoute(stage, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const overrides = options.overrides ?? loadHermesRoutingOverrides(repoRoot);
  const bucket = stageBucket(stage);
  let route = overrides[stage]
    ? { ...overrides[stage] }
    : defaultRouteForStage(stage, { lastImplementRunner: options.lastImplementRunner });

  if (!HERMES_RUNNERS.includes(route.runner)) {
    route = defaultRouteForStage(stage, { lastImplementRunner: options.lastImplementRunner });
  }

  let warning;
  const primaryNorm = applyCursorAgentNormalization(route);
  route = primaryNorm.route;
  if (primaryNorm.warning) warning = primaryNorm.warning;

  rejectFastModel(route.model);

  const primaryRunner = route.runner;
  let fallback = fallbackRouteForStage(stage, route);
  const fallbackNorm = applyCursorAgentNormalization(fallback);
  fallback = fallbackNorm.route;
  if (!warning && fallbackNorm.warning) warning = fallbackNorm.warning;

  rejectFastModel(fallback.model);

  const out = {
    stage,
    runner: route.runner,
    model: route.model,
    fallback,
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
  return false;
}
