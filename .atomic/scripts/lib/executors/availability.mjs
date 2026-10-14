import { binOnPath } from "../cli-detect.mjs";
import { EXECUTOR_BINS, EXECUTOR_IDS, EXECUTOR_FALLBACK_CHAIN } from "./constants.mjs";

/** @type {boolean | undefined} */
let cursorSdkProbeResult;

/**
 * Probe whether @cursor/sdk can be imported (cached).
 * @returns {Promise<boolean>}
 */
export async function probeCursorSdkAvailable() {
  if (cursorSdkProbeResult !== undefined) return cursorSdkProbeResult;
  try {
    await import("@cursor/sdk");
    cursorSdkProbeResult = true;
  } catch {
    cursorSdkProbeResult = false;
  }
  return cursorSdkProbeResult;
}

/**
 * @param {string} executorId
 * @returns {boolean}
 */
export function isExecutorAvailable(executorId) {
  if (!EXECUTOR_IDS.includes(executorId)) return false;
  if (executorId === "cursor-sdk") {
    return cursorSdkProbeResult === true;
  }
  if (executorId === "cursor-subagent") return true;
  if (executorId === "pi") return binOnPath(EXECUTOR_BINS.pi);
  const bins = EXECUTOR_BINS[executorId];
  return bins ? binOnPath(bins) : false;
}

/**
 * @param {string} preferred
 * @param {{ allowPi?: boolean }} [options]
 * @returns {{ executor: string, fallbackFrom: string | null }}
 */
export function resolveExecutorWithFallback(preferred, options = {}) {
  if (preferred === "pi" && !options.allowPi) {
    preferred = "cursor-subagent";
  }
  if (isExecutorAvailable(preferred)) {
    return { executor: preferred, fallbackFrom: null };
  }
  const chain = EXECUTOR_FALLBACK_CHAIN.filter(
    (id) => id !== "cursor-sdk" || cursorSdkProbeResult === true,
  );
  for (const candidate of [preferred, ...chain]) {
    if (candidate === preferred) continue;
    if (candidate === "pi" && !options.allowPi) continue;
    if (isExecutorAvailable(candidate)) {
      return { executor: candidate, fallbackFrom: preferred };
    }
  }
  return { executor: "cursor-subagent", fallbackFrom: preferred };
}

/**
 * @param {string} preferred
 * @param {{ allowPi?: boolean }} [options]
 */
export async function resolveExecutorWithFallbackAsync(preferred, options = {}) {
  await probeCursorSdkAvailable();
  return resolveExecutorWithFallback(preferred, options);
}
