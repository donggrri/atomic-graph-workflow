/**
 * Merge `agy.*` pipeline policy into per-stage `executors` when not explicitly set.
 * @param {{ agy?: Record<string, string>, executors?: Record<string, string>, executorTimeouts?: Record<string, number>, testDone?: string | null }} settings
 */
export function applyEffectiveExecutorSettings(settings) {
  const executors = { ...(settings.executors ?? {}) };
  const agy = settings.agy ?? {};

  if (agy.plan === "agy") {
    for (const stage of ["plan", "plan-review", "explore"]) {
      if (!executors[stage]) executors[stage] = "agy";
    }
  }
  if (agy.implement === "agy") {
    for (const stage of ["execute", "task"]) {
      if (!executors[stage]) executors[stage] = "agy";
    }
  }
  if (agy.review === "agy") {
    for (const stage of ["review", "wrapup"]) {
      if (!executors[stage]) executors[stage] = "agy";
    }
  }

  return { ...settings, executors };
}

/**
 * @param {Record<string, number | undefined>} timeouts
 * @param {string | null} stage
 * @param {number} [defaultMin]
 */
export function resolveExecutorTimeoutMin(timeouts, stage, defaultMin = 45) {
  if (!stage || !timeouts) return defaultMin;
  const v = timeouts[stage];
  if (typeof v === "number" && v > 0) return v;
  return defaultMin;
}
