import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { getWorkflowPaths } from "../work-status.mjs";
import { buildMemoryContext, withMemoryContext, writeCapture } from "../memory.mjs";
import { getRole } from "./roles.mjs";
import { bugbotGate } from "./bugbot.mjs";
import { planReviewGate, planReviewPath } from "./plan-review.mjs";
import {
  DEFAULT_PROFILE_ID,
  getProfile,
  plannerProfileLines,
  resolveProfileId,
  testerStep,
} from "./profiles.mjs";
import { loadWorkflowSettings, resolveAgyDecision } from "./workflow-settings.mjs";

const CLI_DELEGATE_WORKERS = new Set(["agy", "opencode", "codex", "claude"]);

/**
 * @param {string} planText
 * @returns {boolean} true if blocked (must exit 20)
 */
const AGY_STAGE_LABEL = {
  plan: "계획",
  implement: "구현",
  review: "리뷰",
};

/**
 * @param {string} stage
 * @returns {string}
 */
export function agyStageQuestion(stage) {
  const label = AGY_STAGE_LABEL[stage] ?? stage;
  return `지금은 ${label} 단계입니다. 이 단계를 agy로 실행할까요?`;
}

export function planHasBlockedQuestions(planText) {
  const m = planText.match(/##\s*막힌\s*질문\s*\n([\s\S]*?)(?:\n##|$)/i);
  if (!m) return false;
  const body = m[1].trim();
  if (!body) return false;
  if (body === "없음") return false;
  return true;
}

/**
 * @param {string} text
 * @returns {Array<{ id: string, checked: boolean, depends: string[], worker: string, done: string, block: string }>}
 */
export function parseTasksMarkdown(text) {
  const tasks = [];
  const parts = text.split(/\n(?=- \[[ x]\])/);
  for (const part of parts) {
    const head = part.match(/^- \[([ x])\]\s+(\S+)/);
    if (!head) continue;
    const checked = head[1] === "x";
    const idLine = part.match(/^\s*-\s*id:\s*(\S+)/m);
    const id = idLine ? idLine[1] : head[2];
    const depLine = part.match(/^\s*-\s*depends:\s*(.+)$/m);
    let depends = [];
    if (depLine) {
      const raw = depLine[1].trim();
      if (raw && raw !== "(없음)") {
        depends = raw.split(/[\s,]+/).filter(Boolean);
      }
    }
    const workerLine = part.match(/^\s*-\s*worker:\s*(\S+)/m);
    const worker = workerLine ? workerLine[1] : "worker";
    const doneLine = part.match(/^\s*-\s*done:\s*`([^`]*)`/m);
    const done = doneLine ? doneLine[1] : "";
    tasks.push({ id, checked, depends, worker, done, block: part });
  }
  return tasks;
}

/**
 * @param {string} text
 * @param {string} taskId
 * @param {boolean} checked
 */
function setTaskChecked(text, taskId, checked) {
  const mark = checked ? "x" : " ";
  const re = new RegExp(`- \\[[ x]\\] ${taskId}\\b`);
  return text.replace(re, `- [${mark}] ${taskId}`);
}

/**
 * @param {string} text
 * @param {string} taskId
 * @param {string} message
 */
function addBlockedLine(text, taskId, message) {
  const re = new RegExp(
    `(- \\[[ x]\\] ${taskId}[^\n]*\n)((?:  - [^\n]+\n)*)(?!  - 막힘:)`,
    "m"
  );
  if (re.test(text)) {
    return text.replace(re, `$1$2  - 막힘: ${message}\n`);
  }
  const lineRe = new RegExp(`(- \\[[ x]\\] ${taskId}[^\n]*\n)`);
  return text.replace(lineRe, `$1  - 막힘: ${message}\n`);
}

/**
 * @param {string} text
 * @param {string} taskId
 */
function clearBlockedLine(text, taskId) {
  return text.replace(
    new RegExp(`(^|\\n)(  - 막힘:[^\n]*\\n)(?=.*- \\[[ x]\\] ${taskId})`, "m"),
    ""
  ).replace(new RegExp(`  - 막힘:[^\n]*\n`, "g"), (match, offset, whole) => {
    const before = whole.slice(0, offset);
    if (before.includes(`- [`) && before.match(new RegExp(`- \\[[ x]\\] ${taskId}`))) {
      return "";
    }
    return match;
  });
}

function clearBlockedForTask(text, taskId) {
  const blocks = text.split(/\n(?=- \[[ x]\])/);
  const out = blocks.map((block) => {
    if (!block.match(new RegExp(`^- \\[[ x]\\] ${taskId}\\b`))) return block;
    return block.replace(/\n  - 막힘:[^\n]*/g, "");
  });
  return out.join("\n").replace(/\n\n\n+/g, "\n\n");
}

/**
 * @param {string} reviewText
 */
export function reviewHasDefects(reviewText) {
  const m = reviewText.match(/##\s*결함\s*\n([\s\S]*?)(?:\n##|$)/);
  if (!m) return false;
  const body = m[1].trim();
  return body !== "없음" && body.length > 0;
}

/**
 * @param {string} reviewText
 * @returns {string[]}
 */
function defectTaskIds(reviewText) {
  const ids = new Set();
  const re = /\bT\d+\b/g;
  let m;
  while ((m = re.exec(reviewText)) !== null) {
    ids.add(m[0]);
  }
  return [...ids];
}

function orderTasks(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sorted = [];
  const done = new Set();
  while (sorted.length < tasks.length) {
    let progress = false;
    for (const t of tasks) {
      if (sorted.some((s) => s.id === t.id)) continue;
      const depsOk = t.depends.every((d) => {
        const dep = byId.get(d);
        return dep?.checked || done.has(d);
      });
      const depsSorted = t.depends.every((d) => sorted.some((s) => s.id === d));
      if (depsOk && (t.depends.length === 0 || depsSorted)) {
        sorted.push(t);
        done.add(t.id);
        progress = true;
      }
    }
    if (!progress) {
      for (const t of tasks) {
        if (!sorted.some((s) => s.id === t.id)) sorted.push(t);
      }
      break;
    }
  }
  return sorted;
}

function isTaskCardAdapter(adapter) {
  return adapter?.mode === "task-card";
}

function isoNow(opts) {
  if (opts.now) return opts.now;
  const c = opts.clock?.();
  if (typeof c === "string") return c;
  return (c ?? new Date()).toISOString();
}

function loadState(paths) {
  const p = join(paths.runsDir, "pipeline.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

function saveState(paths, state, opts) {
  mkdirSync(paths.runsDir, { recursive: true });
  state.updatedAt = isoNow(opts);
  if (!state.startedAt) state.startedAt = state.updatedAt;
  writeFileSync(join(paths.runsDir, "pipeline.json"), JSON.stringify(state, null, 2), "utf8");
  return state;
}

async function syncAfter(opts, slug) {
  if (opts.statusSync) await opts.statusSync(slug);
}

/**
 * @param {object} opts
 * @returns {Promise<{ exitCode: number, state: object }>}
 */
export async function runPipeline(opts) {
  const {
    repoRoot,
    slug,
    flags = {},
    adapter,
    runDone,
    statusSync,
    log = () => {},
  } = opts;

  const paths = getWorkflowPaths(repoRoot, slug);
  const planPath = join(paths.docsDir, `PLAN-${slug}.md`);
  const tasksPath = join(paths.docsDir, `TASKS-${slug}.md`);
  const reviewPath = join(paths.docsDir, `REVIEW-${slug}.md`);

  if (!existsSync(planPath)) {
    return { exitCode: 2, state: {} };
  }

  let state = loadState(paths) ?? {
    cursor: { phase: "blocked-gate" },
    reworkUsed: false,
    costAck: false,
    attempts: [],
  };

  if (flags.resume && existsSync(join(paths.runsDir, "pipeline.json"))) {
    state = loadState(paths) ?? state;
  } else if (!flags.resume) {
    state = {
      ...state,
      cursor: state.cursor?.phase ? state.cursor : { phase: "blocked-gate" },
      reworkUsed: state.reworkUsed ?? false,
      costAck: flags.auto ? true : state.costAck ?? false,
    };
  }

  if (isTaskCardAdapter(adapter)) {
    state.adapter = "task-card";
  }

  const planText = readFileSync(planPath, "utf8");

  function emit(line) {
    log(line);
    mkdirSync(paths.runsDir, { recursive: true });
    appendFileSync(join(paths.runsDir, "pipeline.log"), `${line}\n`);
  }

  const profileOptions = {
    repoRoot,
    ...(opts.profileOptions ?? {}),
  };
  const stateFile = join(paths.runsDir, "pipeline.json");
  const hasState = existsSync(stateFile);
  const storedProfile = hasState ? (state.profile ?? DEFAULT_PROFILE_ID) : null;
  const cliProfile = opts.profileId ?? null;

  if (cliProfile && storedProfile && cliProfile !== storedProfile) {
    emit(
      `profile mismatch: pipeline.json has ${storedProfile}, --profile ${cliProfile}`
    );
    return { exitCode: 2, state };
  }

  let profileId = cliProfile ?? storedProfile;
  if (!profileId) {
    const resolved = resolveProfileId({
      cliProfile: null,
      repoRoot,
      workflowHome: profileOptions.workflowHome,
      exists: profileOptions.exists,
      readFile: profileOptions.readFile,
    });
    if (!resolved.ok) {
      emit(resolved.reason);
      return { exitCode: 2, state };
    }
    profileId = resolved.id;
  }

  const loaded = getProfile(profileId, profileOptions);
  if (!loaded.ok) {
    emit(loaded.reason);
    return { exitCode: 2, state };
  }
  for (const warning of loaded.warnings) emit(warning);
  const profile = loaded.profile;
  state.profile = profile.id;
  emit(`profile: ${profile.id}`);

  const workflowSettings = loadWorkflowSettings({
    repoRoot,
    workflowHome: profileOptions.workflowHome,
    exists: profileOptions.exists,
    readFile: profileOptions.readFile,
  });
  if (!workflowSettings.ok) {
    emit(workflowSettings.reason);
    return { exitCode: 2, state };
  }
  const agyDefaults = workflowSettings.agy;
  /** @param {string} stage */
  const agyFor = (stage) => resolveAgyDecision(state, stage, flags, agyDefaults);

  if (flags.resume && state.cursor?.delegate === "agy" && state.cursor?.stage === "plan") {
    state.agyDone = { ...(state.agyDone ?? {}), plan: true };
    state.cursor = { phase: "plan-review" };
    state.agyAsk = null;
  } else if (flags.resume && state.cursor?.delegate === "agy" && state.cursor?.stage === "review") {
    state.agyDone = { ...(state.agyDone ?? {}), review: true };
    state.cursor = { phase: "reviewer" };
    state.agyAsk = null;
  } else if (
    flags.resume &&
    state.cursor?.delegate &&
    state.cursor?.stage === "implement" &&
    state.cursor?.taskId
  ) {
    state.cursor = {
      phase: "execute",
      taskId: state.cursor.taskId,
      agyHandback: state.cursor.taskId,
    };
    state.agyAsk = null;
  }

  if (flags.dryRun) {
    const next = state.cursor?.phase ?? "blocked-gate";
    log(`dry-run: next phase ${next}`);
    return { exitCode: 0, state };
  }

  async function failExit(code, partial = {}) {
    saveState(paths, { ...state, ...partial }, opts);
    return { exitCode: code, state: { ...state, ...partial } };
  }

  async function runRoleStep(role, rolePrompt, phaseKey) {
    const roleDef = getRole(role);
    const model = roleDef.taskModel;
    const prompt = withMemoryContext(
      rolePrompt,
      buildMemoryContext({ root: paths.root, shortRepo: paths.shortRepo }),
    );
    let attempts = 0;
    const maxAttempts = 2;
    const showProgress = !isTaskCardAdapter(adapter);
    while (attempts < maxAttempts) {
      attempts += 1;
      const startedAt = Date.now();
      if (showProgress) {
        const retry = attempts > 1 ? ` (attempt ${attempts}/${maxAttempts})` : "";
        emit(`▶ [${phaseKey}] ${role} started · model=${model}${retry}`);
      }
      const result = await adapter.runRole({
        role,
        prompt,
        cwd: repoRoot,
        model,
        onProgress: showProgress
          ? (line) => emit(`    [${phaseKey}/${role}] ${line}`)
          : undefined,
      });
      if (showProgress) {
        const secs = Math.round((Date.now() - startedAt) / 1000);
        const outcome = result.ok ? "done" : `failed (${result.kind ?? "error"})`;
        emit(`■ [${phaseKey}] ${role} ${outcome} · ${secs}s`);
      }
      if (result.ok) {
        return { ok: true, summary: result.summary };
      }
      if (result.kind === "startup") {
        if (attempts >= maxAttempts) {
          return { ok: false, exitCode: 50 };
        }
        continue;
      }
      if (result.kind === "run") {
        if (isTaskCardAdapter(adapter)) {
          state.cursor = { phase: phaseKey, role };
          saveState(paths, state, opts);
          return { ok: false, exitCode: 10, taskCard: true };
        }
        return { ok: false, exitCode: 30, message: result.message };
      }
      return { ok: false, exitCode: 30, message: result.message };
    }
    return { ok: false, exitCode: 50 };
  }

  async function stopForAgyAsk(stage, resumePhase) {
    const question = agyStageQuestion(stage);
    state.cursor = { phase: "agy-ask", stage, resumePhase, question };
    state.agyAsk = { stage, question, resumePhase };
    saveState(paths, state, opts);
    await syncAfter({ statusSync }, slug);
    emit(`agy-ask: ${stage}`);
    return { exitCode: 20, state };
  }

  async function stopForAgyDelegate(cursor) {
    state.cursor = cursor;
    state.agyAsk = null;
    saveState(paths, state, opts);
    await syncAfter({ statusSync }, slug);
    return { exitCode: 10, state };
  }

  // --- blocked questions gate ---
  if (!state.costAck && !flags.auto && state.cursor?.phase === "blocked-gate") {
    // will run blocked check below
  }

  const phase = state.cursor?.phase ?? "blocked-gate";

  if (phase === "blocked-gate" || phase === "cost-gate") {
    if (planHasBlockedQuestions(planText)) {
      state.cursor = { phase: "blocked-gate" };
      saveState(paths, state, opts);
      await syncAfter({ statusSync }, slug);
      return { exitCode: 20, state };
    }
    state.cursor = { phase: "cost-gate" };
    saveState(paths, state, opts);
    await syncAfter({ statusSync }, slug);

    if (!flags.auto && !state.costAck) {
      return { exitCode: 20, state };
    }
    if (flags.auto) state.costAck = true;
    state.cursor = { phase: "plan-review" };
    saveState(paths, state, opts);
    await syncAfter({ statusSync }, slug);
  }

  let cursorPhase = state.cursor?.phase ?? "tasker";

  if (phase === "agy-ask") {
    const stage = state.cursor.stage;
    const decision = agyFor(stage);
    if (!decision) {
      saveState(paths, state, opts);
      await syncAfter({ statusSync }, slug);
      return { exitCode: 20, state };
    }
    state.agyChoice = { ...(state.agyChoice ?? {}), [stage]: decision };
    if (decision === "agy" && stage === "plan" && !state.agyDone?.plan) {
      return stopForAgyDelegate({ phase: "plan-review", delegate: "agy", stage: "plan" });
    }
    if (decision === "agy" && stage === "review" && !state.agyDone?.review) {
      return stopForAgyDelegate({ phase: "reviewer", delegate: "agy", stage: "review" });
    }
    state.cursor = { phase: state.cursor.resumePhase ?? "plan-review" };
    state.agyAsk = null;
    saveState(paths, state, opts);
    cursorPhase = state.cursor.phase;
  }

  if (
    flags.resume &&
    cursorPhase === "cost-gate" &&
    state.costAck
  ) {
    state.cursor = { phase: "plan-review" };
    cursorPhase = "plan-review";
    saveState(paths, state, opts);
  }

  if (cursorPhase === "tasker" || (!flags.resume && cursorPhase === "cost-gate")) {
    cursorPhase = state.cursor?.phase;
  }

  const planReviewFilePath = planReviewPath(paths.docsDir, slug);

  function appendPipelineLog(line) {
    mkdirSync(paths.runsDir, { recursive: true });
    appendFileSync(join(paths.runsDir, "pipeline.log"), `${line}\n`);
  }

  if (cursorPhase === "plan-review" || state.cursor?.phase === "plan-review") {
    const planDecision = agyFor("plan");
    if (planDecision === null && !state.agyDone?.plan) {
      return stopForAgyAsk("plan", "plan-review");
    }
    if (planDecision === "agy" && !state.agyDone?.plan) {
      return stopForAgyDelegate({ phase: "plan-review", delegate: "agy", stage: "plan" });
    }
    const gateResult = await planReviewGate({
      planReview: state.planReview ?? {},
      slug,
      repoRoot,
      planPath,
      planReviewPath: planReviewFilePath,
      runsDir: paths.runsDir,
      runRole: (role, prompt) => runRoleStep(role, prompt, "plan-review"),
      plannerLines: plannerProfileLines(profile, planPath),
      isBlocked: planHasBlockedQuestions,
      save: (pr) => {
        state.planReview = pr;
        saveState(paths, state, opts);
      },
      appendLog: appendPipelineLog,
    });
    state.planReview = gateResult.planReview;
    saveState(paths, state, opts);

    if (gateResult.outcome === "passed") {
      state.cursor = { phase: "tasker" };
      saveState(paths, state, opts);
      await syncAfter({ statusSync }, slug);
      cursorPhase = "tasker";
    } else if (gateResult.outcome === "parent") {
      await syncAfter({ statusSync }, slug);
      return { exitCode: 10, state };
    } else if (gateResult.outcome === "human") {
      state.cursor = { phase: "plan-review" };
      saveState(paths, state, opts);
      await syncAfter({ statusSync }, slug);
      return { exitCode: 20, state };
    } else if (gateResult.outcome === "failed") {
      await syncAfter({ statusSync }, slug);
      return { exitCode: 30, state };
    } else if (gateResult.outcome === "startup") {
      await syncAfter({ statusSync }, slug);
      return { exitCode: 50, state };
    }
  }

  if (cursorPhase === "tasker") {
    const taskerPrompt = `Run tasker for slug ${slug}`;
    const tr = await runRoleStep("tasker", taskerPrompt, "tasker");
    await syncAfter({ statusSync }, slug);
    if (!tr.ok) {
      if (tr.exitCode === 10) return { exitCode: 10, state };
      if (tr.exitCode === 50) return { exitCode: 50, state };
      return { exitCode: tr.exitCode ?? 30, state };
    }
    state.cursor = { phase: "execute" };
    saveState(paths, state, opts);
    await syncAfter({ statusSync }, slug);
    cursorPhase = "execute";
  }

  if (cursorPhase === "execute" || state.cursor?.phase === "execute") {
    let tasksText = readFileSync(tasksPath, "utf8");
    let tasks = parseTasksMarkdown(tasksText);
    const ordered = orderTasks(tasks);
    const hasOpen = ordered.some((task) => {
      const current = parseTasksMarkdown(tasksText).find((item) => item.id === task.id);
      return current && !current.checked;
    });
    if (hasOpen && agyFor("implement") === null) {
      return stopForAgyAsk("implement", "execute");
    }

    const resumeTaskId = flags.resume ? state.cursor?.taskId : null;
    let started = !resumeTaskId;

    for (const task of ordered) {
      const current = parseTasksMarkdown(tasksText).find((t) => t.id === task.id);
      if (!current) continue;
      if (current.checked) continue;

      if (!started) {
        if (task.id === resumeTaskId) started = true;
        else continue;
      }

      if (flags.resume) {
        tasksText = clearBlockedForTask(tasksText, task.id);
        writeFileSync(tasksPath, tasksText, "utf8");
      }

      const implementAgy = agyFor("implement") === "agy";
      const handback = state.cursor?.agyHandback === task.id;
      if (handback) {
        state.cursor = { phase: "execute", taskId: task.id };
        const handed = await runDone({
          taskId: task.id,
          command: task.done,
          cwd: repoRoot,
        });
        await syncAfter({ statusSync }, slug);
        if (!handed.ok) {
          tasksText = readFileSync(tasksPath, "utf8");
          tasksText = addBlockedLine(tasksText, task.id, handed.message || "done command failed");
          writeFileSync(tasksPath, tasksText, "utf8");
          state.cursor = { phase: "execute", taskId: task.id };
          saveState(paths, state, opts);
          await syncAfter({ statusSync }, slug);
          return { exitCode: 30, state };
        }
        tasksText = readFileSync(tasksPath, "utf8");
        tasksText = setTaskChecked(tasksText, task.id, true);
        writeFileSync(tasksPath, tasksText, "utf8");
        state.cursor = { phase: "execute", taskId: task.id };
        saveState(paths, state, opts);
        await syncAfter({ statusSync }, slug);
        continue;
      }
      if (implementAgy || CLI_DELEGATE_WORKERS.has(task.worker)) {
        state.cursor = {
          phase: "execute",
          taskId: task.id,
          delegate: implementAgy ? "agy" : task.worker,
          ...(implementAgy ? { stage: "implement" } : {}),
        };
        saveState(paths, state, opts);
        await syncAfter({ statusSync }, slug);
        return { exitCode: 10, state };
      }

      const workerPrompt = `Implement TASKS item ${task.id} for slug ${slug}`;
      const wr = await runRoleStep("worker", workerPrompt, "execute");
      await syncAfter({ statusSync }, slug);
      if (!wr.ok) {
        if (wr.exitCode === 10) return { exitCode: 10, state };
        if (wr.exitCode === 50) return { exitCode: 50, state };
        tasksText = addBlockedLine(tasksText, task.id, wr.message || "run failed");
        writeFileSync(tasksPath, tasksText, "utf8");
        state.cursor = { phase: "execute", taskId: task.id };
        saveState(paths, state, opts);
        await syncAfter({ statusSync }, slug);
        return { exitCode: 30, state };
      }

      const doneResult = await runDone({
        taskId: task.id,
        command: task.done,
        cwd: repoRoot,
      });
      await syncAfter({ statusSync }, slug);

      if (!doneResult.ok) {
        tasksText = readFileSync(tasksPath, "utf8");
        tasksText = addBlockedLine(
          tasksText,
          task.id,
          doneResult.message || "done command failed"
        );
        writeFileSync(tasksPath, tasksText, "utf8");
        state.cursor = { phase: "execute", taskId: task.id };
        saveState(paths, state, opts);
        await syncAfter({ statusSync }, slug);
        return { exitCode: 30, state };
      }

      tasksText = readFileSync(tasksPath, "utf8");
      tasksText = setTaskChecked(tasksText, task.id, true);
      writeFileSync(tasksPath, tasksText, "utf8");
      state.cursor = { phase: "execute", taskId: task.id };
      saveState(paths, state, opts);
      await syncAfter({ statusSync }, slug);
    }

    state.cursor = { phase: "reviewer" };
    saveState(paths, state, opts);
    cursorPhase = "reviewer";
  }

  if (state.cursor?.phase === "reviewer" || cursorPhase === "reviewer") {
    const reviewDecision = agyFor("review");
    if (reviewDecision === null && !state.agyDone?.review) {
      return stopForAgyAsk("review", "reviewer");
    }
    if (reviewDecision === "agy" && !state.agyDone?.review) {
      return stopForAgyDelegate({ phase: "reviewer", delegate: "agy", stage: "review" });
    }
    let reviewText = "";
    if (reviewDecision === "agy") {
      reviewText = existsSync(reviewPath) ? readFileSync(reviewPath, "utf8") : "";
      if (!reviewText.trim()) {
        emit("agy review: REVIEW file missing");
        return { exitCode: 30, state };
      }
      state.cursor = { phase: "reviewer" };
      saveState(paths, state, opts);
    } else {
    const reviewPass = state.reworkUsed ? 2 : 1;
    const gate = bugbotGate({
      bugbot: state.bugbot ?? {},
      pass: reviewPass,
      runsDir: paths.runsDir,
      repoRoot,
      slug,
      planPath,
      tasksPath,
    });
    state.bugbot = gate.bugbot;

    if (gate.status === "pending") {
      state.cursor = { phase: "reviewer" };
      saveState(paths, state, opts);
      await syncAfter({ statusSync }, slug);
      return { exitCode: 10, state };
    }

    let reviewerPrompt = state.reworkUsed
      ? `Review slug ${slug} after rework\nBugbot findings: ${gate.findingsPath}`
      : `Review slug ${slug}\nBugbot findings: ${gate.findingsPath}`;
    if (gate.failed) {
      reviewerPrompt += ` (BUGBOT_FAILED: proceed without bugbot)`;
    }

    const rr = await runRoleStep("reviewer", reviewerPrompt, "reviewer");
    await syncAfter({ statusSync }, slug);
    if (!rr.ok) {
      if (rr.exitCode === 10) return { exitCode: 10, state };
      if (rr.exitCode === 50) return { exitCode: 50, state };
      return { exitCode: 30, state };
    }

    reviewText = existsSync(reviewPath) ? readFileSync(reviewPath, "utf8") : "";
    }
    if (reviewHasDefects(reviewText)) {
      if (!state.reworkUsed) {
        state.reworkUsed = true;
        const ids = defectTaskIds(reviewText);
        let tasksText = readFileSync(tasksPath, "utf8");
        if (ids.length === 0) {
          const allTasks = parseTasksMarkdown(tasksText);
          for (const t of allTasks) {
            tasksText = setTaskChecked(tasksText, t.id, false);
          }
        } else {
          for (const id of ids) {
            tasksText = setTaskChecked(tasksText, id, false);
          }
        }
        writeFileSync(tasksPath, tasksText, "utf8");
        await syncAfter({ statusSync }, slug);

        state.cursor = { phase: "execute", taskId: ids[0] ?? null };
        saveState(paths, state, opts);

        let tasksText2 = readFileSync(tasksPath, "utf8");
        const ordered = orderTasks(parseTasksMarkdown(tasksText2));
        for (const task of ordered) {
          const current = parseTasksMarkdown(tasksText2).find((t) => t.id === task.id);
          if (!current || current.checked) continue;

          const reworkAgy = agyFor("implement") === "agy";
          if (reworkAgy || CLI_DELEGATE_WORKERS.has(task.worker)) {
            state.cursor = {
              phase: "execute",
              taskId: task.id,
              delegate: reworkAgy ? "agy" : task.worker,
              ...(reworkAgy ? { stage: "implement" } : {}),
            };
            saveState(paths, state, opts);
            await syncAfter({ statusSync }, slug);
            return { exitCode: 10, state };
          }

          const wr = await runRoleStep("worker", `Rework ${task.id}`, "execute");
          await syncAfter({ statusSync }, slug);
          if (!wr.ok) {
            if (wr.exitCode === 50) return { exitCode: 50, state };
            tasksText2 = addBlockedLine(tasksText2, task.id, wr.message || "run failed");
            writeFileSync(tasksPath, tasksText2, "utf8");
            return { exitCode: 30, state };
          }
          const doneResult = await runDone({
            taskId: task.id,
            command: task.done,
            cwd: repoRoot,
          });
          await syncAfter({ statusSync }, slug);
          if (!doneResult.ok) {
            tasksText2 = readFileSync(tasksPath, "utf8");
            tasksText2 = addBlockedLine(
              tasksText2,
              task.id,
              doneResult.message || "done command failed"
            );
            writeFileSync(tasksPath, tasksText2, "utf8");
            return { exitCode: 30, state };
          }
          tasksText2 = readFileSync(tasksPath, "utf8");
          tasksText2 = setTaskChecked(tasksText2, task.id, true);
          writeFileSync(tasksPath, tasksText2, "utf8");
          await syncAfter({ statusSync }, slug);
        }

        if (agyFor("review") === "agy") {
          state.agyDone = { ...(state.agyDone ?? {}), review: false };
          return stopForAgyDelegate({ phase: "reviewer", delegate: "agy", stage: "review" });
        }

        state.cursor = { phase: "reviewer" };
        saveState(paths, state, opts);

        const gateAfterRework = bugbotGate({
          bugbot: state.bugbot ?? {},
          pass: 2,
          runsDir: paths.runsDir,
          repoRoot,
          slug,
          planPath,
          tasksPath,
        });
        state.bugbot = gateAfterRework.bugbot;
        state.cursor = { phase: "reviewer" };
        saveState(paths, state, opts);
        await syncAfter({ statusSync }, slug);
        return { exitCode: 10, state };
      }
      state.cursor = { phase: "reviewer" };
      saveState(paths, state, opts);
      return { exitCode: 40, state };
    }

    state.cursor = { phase: "tester" };
    saveState(paths, state, opts);
    cursorPhase = "tester";
  }

  if (state.cursor?.phase === "tester" || cursorPhase === "tester") {
    const step = testerStep(profile, slug);
    const ter = await runRoleStep("tester", step.prompt, "tester");
    await syncAfter({ statusSync }, slug);
    if (!ter.ok) {
      if (ter.exitCode === 10) return { exitCode: 10, state };
      if (ter.exitCode === 50) return { exitCode: 50, state };
      return { exitCode: 30, state };
    }

    if (step.done) {
      await runDone({
        taskId: "tester",
        command: step.done,
        cwd: repoRoot,
      });
    }
    await syncAfter({ statusSync }, slug);

    state.cursor = { phase: "complete" };
    saveState(paths, state, opts);
    await syncAfter({ statusSync }, slug);
    try {
      const capture = writeCapture({
        root: paths.root,
        shortRepo: paths.shortRepo,
        slug,
        docsDir: paths.docsDir,
        runsDir: paths.runsDir,
      });
      emit(`memory capture: ${capture}`);
    } catch (err) {
      emit(`memory capture skipped: ${err.message}`);
    }
    return { exitCode: 0, state };
  }

  return { exitCode: 0, state };
}
