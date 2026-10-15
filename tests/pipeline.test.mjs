/**
 * Pipeline runner seam (T3 implements scripts/lib/pipeline.mjs).
 *
 * import { runPipeline } from "../scripts/lib/pipeline.mjs";
 *
 * runPipeline({
 *   repoRoot,       // absolute path to product repo (non-git folder ok)
 *   slug,           // kebab-case slug
 *   flags: { auto: boolean, resume: boolean, dryRun: boolean },
 *   adapter,        // { runRole({ role, prompt, cwd, model }) -> Promise<
 *                   //   { ok: true, summary: string } |
 *                   //   { ok: false, kind: "startup"|"run", message: string }
 *                   // > }
 *   runDone,        // ({ taskId, command, cwd }) -> Promise<{ ok: boolean, message?: string }>
 *   statusSync,     // (slug) -> Promise<void>
 *   clock,          // () => Date | ISO string
 *   log,            // (...args) => void
 *   docsHome,       // optional; default join(workflowHome,"docs")
 *   runsHome,       // optional; default join(workflowHome,"runs")
 *   now,            // optional ISO string for timestamps (overrides clock when writing state)
 * }) -> Promise<{ exitCode: number, state: object }>
 *
 * Fixture layout (workflowHome = ATOMIC_WORKFLOW_HOME or docsHome/../):
 *   docsHome/<shortRepo>/<slug>/PLAN-<slug>.md
 *   docsHome/<shortRepo>/<slug>/TASKS-<slug>.md
 *   docsHome/<shortRepo>/<slug>/REVIEW-<slug>.md
 *   runsHome/<shortRepo>/<slug>/pipeline.json
 *   runsHome/<shortRepo>/<slug>/next-card.json  (task-card adapter)
 *
 * shortRepo: basename(repoRoot) kebab-case, max 24 chars (see work-status getShortRepo).
 * Test repo basename is fixed to "pipe-repo" → shortRepo "pipe-repo".
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getWorkflowPaths } from "../scripts/work-status.mjs";
import { runPipeline } from "../scripts/lib/pipeline.mjs";
import {
  BUGBOT_FAILED_MARKER,
  bugbotFindingsPath,
} from "../scripts/lib/bugbot.mjs";
import {
  PLAN_REVIEW_DEFECTS_HEADING,
  planReviewPath,
} from "../scripts/lib/plan-review.mjs";
import { resolvePipelineAdapter } from "../scripts/run-pipeline.mjs";
import { createSdkAdapter, loadSdk } from "../scripts/lib/adapters/sdk.mjs";
import { createTaskCardAdapter } from "../scripts/lib/adapters/task-card.mjs";

const SLUG = "pipe-run";
const REPO_BASENAME = "pipe-repo";

function planMd(blockedSection) {
  return `# PLAN: pipeline test

## 막힌 질문

${blockedSection}
`;
}

function tasksTwoItems({ t1Checked = false, t2Checked = false, t2Worker = "worker" } = {}) {
  const c1 = t1Checked ? "x" : " ";
  const c2 = t2Checked ? "x" : " ";
  return `# TASKS: pipe

PLAN: PLAN-${SLUG}.md
상태: Phase 2

## 진행

- [${c1}] T1 first task
  - id: T1
  - files: \`src/a.mjs\`
  - depends: (없음)
  - parallel: no
  - worker: worker
  - done: \`node -e "process.exit(0)"\`

- [${c2}] T2 second task
  - id: T2
  - files: \`src/b.mjs\`
  - depends: T1
  - parallel: no
  - worker: ${t2Worker}
  - done: \`node -e "process.exit(0)"\`
`;
}

function reviewMd(defectsBody) {
  return `# REVIEW: pipe

TASKS: TASKS-${SLUG}.md

## 결함

${defectsBody}
`;
}

function createFixture(home, { planBlocked = "없음", tasksContent, pipelineJson } = {}) {
  const repoRoot = join(home, REPO_BASENAME);
  mkdirSync(repoRoot, { recursive: true });
  const paths = getWorkflowPaths(repoRoot, SLUG);
  mkdirSync(paths.docsDir, { recursive: true });
  writeFileSync(join(paths.docsDir, `PLAN-${SLUG}.md`), planMd(planBlocked), "utf8");
  writeFileSync(
    join(paths.docsDir, `TASKS-${SLUG}.md`),
    tasksContent ?? tasksTwoItems(),
    "utf8"
  );
  if (pipelineJson !== undefined) {
    mkdirSync(paths.runsDir, { recursive: true });
    writeFileSync(
      join(paths.runsDir, "pipeline.json"),
      JSON.stringify(pipelineJson, null, 2),
      "utf8"
    );
  }
  return { repoRoot, paths };
}

function pipelineOpts(repoRoot, home, overrides = {}) {
  return {
    repoRoot,
    slug: SLUG,
    flags: { auto: false, resume: false, dryRun: false, ...overrides.flags },
    docsHome: join(home, "docs"),
    runsHome: join(home, "runs"),
    clock: () => new Date("2026-09-29T00:00:00.000Z"),
    now: "2026-09-29T00:00:00.000Z",
    log: () => {},
    ...overrides,
  };
}

function readTasks(home, repoRoot) {
  const { docsDir } = getWorkflowPaths(repoRoot, SLUG);
  return readFileSync(join(docsDir, `TASKS-${SLUG}.md`), "utf8");
}

function taskLineChecked(tasksText, taskId) {
  const re = new RegExp(`- \\[([ x])\\] ${taskId}\\b`);
  const m = tasksText.match(re);
  assert.ok(m, `task line for ${taskId}`);
  return m[1] === "x";
}

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "pipeline-wf-"));
  const orig = process.env.ATOMIC_WORKFLOW_HOME;
  process.env.ATOMIC_WORKFLOW_HOME = home;
  try {
    await fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
    if (orig !== undefined) process.env.ATOMIC_WORKFLOW_HOME = orig;
    else delete process.env.ATOMIC_WORKFLOW_HOME;
  }
}

/**
 * Simulates parent handling exit 10 bugbot cards: writes findings and resumes.
 * Non-bugbot exit 10 (e.g. task-card tasker) returns immediately unchanged.
 *
 * @param {Parameters<typeof runPipeline>[0]} opts
 * @param {{ findingsContent?: string | ((card: object) => string) }} [sim]
 */
async function runPipelineWithBugbotParent(opts, sim = {}) {
  const maxLoops = 24;
  let merged = opts;
  for (let i = 0; i < maxLoops; i += 1) {
    const result = await runPipeline(merged);
    if (result.exitCode !== 10) {
      return result;
    }
    const { runsDir } = getWorkflowPaths(opts.repoRoot, opts.slug);
    const cardPath = join(runsDir, "next-card.json");
    if (!existsSync(cardPath)) {
      return result;
    }
    const card = JSON.parse(readFileSync(cardPath, "utf8"));
    if (card.kind !== "bugbot") {
      return result;
    }
    const findingsPath = card.findingsPath ?? bugbotFindingsPath(runsDir);
    mkdirSync(runsDir, { recursive: true });
    let content;
    if (typeof sim.findingsContent === "function") {
      content = sim.findingsContent(card);
    } else if (sim.findingsContent !== undefined) {
      content = sim.findingsContent;
    } else {
      const pass = card.pass ?? 1;
      content = `# Bugbot findings — ${opts.slug} pass ${pass}\n\n(no issues)\n`;
    }
    writeFileSync(findingsPath, content, "utf8");
    merged = {
      ...opts,
      flags: { ...opts.flags, resume: true },
    };
  }
  throw new Error("runPipelineWithBugbotParent: exceeded bugbot resume loops");
}

function defaultCleanFindings(slug, pass) {
  return `# Bugbot findings — ${slug} pass ${pass}\n\n(no issues)\n`;
}

function planReviewMd(defectsBody = "없음") {
  return `# PLAN-REVIEW: pipe

${PLAN_REVIEW_DEFECTS_HEADING}

${defectsBody}

## 개선 제안

(none)

## 수용된 위험

(none)
`;
}

/**
 * Writes PLAN-REVIEW when plan-reviewer (and optional planner hook) runs.
 * @param {object} adapter
 * @param {{ docsDir: string }} paths
 * @param {{
 *   planReviewBody?: string | ((round: number) => string),
 *   onPlanner?: (ctx: object, paths: { docsDir: string }) => void | Promise<void>,
 * }} [opts]
 */
function adapterWithPlanReview(adapter, paths, opts = {}) {
  let reviewRound = 0;
  return {
    ...adapter,
    mode: adapter.mode,
    async runRole(ctx) {
      const { role } = ctx;
      if (role === "plan-reviewer") {
        reviewRound += 1;
        let body = "없음";
        if (typeof opts.planReviewBody === "function") {
          body = opts.planReviewBody(reviewRound);
        } else if (opts.planReviewBody !== undefined) {
          body = opts.planReviewBody;
        }
        writeFileSync(
          planReviewPath(paths.docsDir, SLUG),
          planReviewMd(body),
          "utf8"
        );
      }
      if (role === "planner" && opts.onPlanner) {
        await opts.onPlanner(ctx, paths);
      }
      return adapter.runRole(ctx);
    },
  };
}

test("1 정상 완주 — exit 0, TASKS [x], statusSync, pipeline.json", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const syncCalls = [];
    let reviewerPass = 0;

    const adapter = adapterWithPlanReview(
      {
        async runRole({ role, onProgress }) {
          onProgress?.(`status RUNNING (${role})`);
          if (role === "reviewer") {
            reviewerPass += 1;
            writeFileSync(
              join(paths.docsDir, `REVIEW-${SLUG}.md`),
              reviewMd("없음"),
              "utf8"
            );
          }
          return { ok: true, summary: `${role} ok` };
        },
      },
      paths
    );

    const result = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter,
        runDone: async () => ({ ok: true }),
        statusSync: async (slug) => {
          assert.equal(slug, SLUG);
          syncCalls.push(slug);
        },
      })
    );

    assert.equal(result.exitCode, 0);
    const progressLog = readFileSync(join(paths.runsDir, "pipeline.log"), "utf8");
    assert.match(progressLog, /▶ \[plan-review\] plan-reviewer started/);
    assert.match(progressLog, /\[plan-review\/plan-reviewer\] status RUNNING/);
    assert.match(progressLog, /■ \[plan-review\] plan-reviewer done · \d+s/);
    assert.match(progressLog, /▶ \[tasker\] tasker started/);
    assert.match(progressLog, /▶ \[execute\] worker started/);
    assert.match(progressLog, /■ \[reviewer\] reviewer done/);
    const tasks = readTasks(home, repoRoot);
    assert.ok(taskLineChecked(tasks, "T1"));
    assert.ok(taskLineChecked(tasks, "T2"));
    assert.ok(syncCalls.length >= 4, "statusSync at least once per major stage");
    assert.ok(existsSync(join(paths.runsDir, "pipeline.json")));
    assert.equal(reviewerPass, 1);
  });
});

test("2 done 실패 — exit 30, 막힘 on T1, preserve [x], skip T2", async () => {
  await withHome(async (home) => {
    const tasksContent = `# TASKS: pipe

- [x] T0 preserved
  - id: T0
  - worker: worker
  - done: \`true\`

- [ ] T1 fails done
  - id: T1
  - depends: (없음)
  - worker: worker
  - done: \`false\`

- [ ] T2 never runs
  - id: T2
  - depends: T1
  - worker: worker
  - done: \`true\`
`;
    const { repoRoot, paths } = createFixture(home, { tasksContent });
    const roles = [];

    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: adapterWithPlanReview(
          {
            async runRole({ role }) {
              roles.push(role);
              return { ok: true, summary: "ok" };
            },
          },
          paths
        ),
        runDone: async ({ taskId }) => {
          if (taskId === "T1") return { ok: false, message: "done command failed" };
          return { ok: true };
        },
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 30);
    const tasks = readTasks(home, repoRoot);
    assert.ok(taskLineChecked(tasks, "T0"));
    assert.ok(!taskLineChecked(tasks, "T1"));
    assert.ok(!taskLineChecked(tasks, "T2"));
    assert.match(tasks, /막힘:/);
    assert.ok(!roles.includes("worker") || roles.filter((r) => r === "worker").length <= 1);
    assert.equal(roles.filter((r) => r === "worker").length, 1);
  });
});

test("3 리뷰 재작업 1회 후에도 결함 — exit 40, reviewer 2회만", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      tasksContent: tasksTwoItems({ t2Checked: false }),
    });
    let reviewerCalls = 0;

    const adapter = adapterWithPlanReview(
      {
        async runRole({ role }) {
          if (role === "reviewer") {
            reviewerCalls += 1;
            const body = reviewerCalls === 1 ? "- spec gap in T1" : "- still broken";
            writeFileSync(join(paths.docsDir, `REVIEW-${SLUG}.md`), reviewMd(body), "utf8");
          }
          return { ok: true, summary: `${role} ok` };
        },
      },
      paths
    );

    const result = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 40);
    assert.equal(reviewerCalls, 2);
  });
});

test("4 시작 실패 재시도 후 — exit 50 (startup x2 on same step)", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    let calls = 0;

    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: {
          async runRole() {
            calls += 1;
            return { ok: false, kind: "startup", message: "CursorAgentError: auth" };
          },
        },
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 50);
    assert.equal(calls, 2);
  });
});

test("5 막힌 질문 게이트 — exit 20, adapter 0회", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home, {
      planBlocked: "- 데이터를 삭제해도 되는가?",
    });
    let calls = 0;

    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        adapter: {
          async runRole() {
            calls += 1;
            return { ok: true, summary: "ok" };
          },
        },
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 20);
    assert.equal(calls, 0);
  });
});

test("6 비용 게이트 — exit 20 then auto or costAck+resume", async () => {
  await withHome(async (home) => {
    const tasksContent = `# TASKS: pipe

- [ ] T1 only
  - id: T1
  - depends: (없음)
  - worker: worker
  - done: \`node -e "process.exit(0)"\`
`;
    const { repoRoot, paths } = createFixture(home, { tasksContent });

    let adapterCalls = 0;
    const adapter = adapterWithPlanReview(
      {
        async runRole({ role }) {
          adapterCalls += 1;
          if (role === "reviewer") {
            writeFileSync(
              join(paths.docsDir, `REVIEW-${SLUG}.md`),
              reviewMd("없음"),
              "utf8"
            );
          }
          return { ok: true, summary: "ok" };
        },
      },
      paths
    );

    const base = {
      adapter,
      runDone: async () => ({ ok: true }),
      statusSync: async () => {},
    };

    const gated = await runPipeline(
      pipelineOpts(repoRoot, home, { ...base, flags: { auto: false, resume: false, dryRun: false } })
    );
    assert.equal(gated.exitCode, 20);
    assert.equal(adapterCalls, 0);

    adapterCalls = 0;
    const autoRun = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        ...base,
        flags: { auto: true, resume: false, dryRun: false },
      })
    );
    assert.equal(autoRun.exitCode, 0);
    assert.ok(adapterCalls > 0);

    adapterCalls = 0;
    mkdirSync(paths.runsDir, { recursive: true });
    writeFileSync(
      join(paths.runsDir, "pipeline.json"),
      JSON.stringify({ costAck: true, cursor: { phase: "cost-gate" } }, null, 2),
      "utf8"
    );

    const resumed = await runPipeline(
      pipelineOpts(repoRoot, home, {
        ...base,
        flags: { auto: false, resume: true, dryRun: false },
      })
    );
    assert.equal(resumed.exitCode, 20);
    assert.equal(resumed.state.cursor.stage, "plan");
    assert.equal(adapterCalls, 0);

    writeFileSync(
      join(paths.runsDir, "pipeline.json"),
      JSON.stringify({
        ...resumed.state,
        agyChoice: { plan: "sdk", implement: "sdk", review: "sdk" },
      }, null, 2),
      "utf8"
    );
    const continued = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        ...base,
        flags: { auto: false, resume: true, dryRun: false },
      })
    );
    assert.equal(continued.exitCode, 0);
    assert.ok(adapterCalls > 0);
  });
});

test("7 cli-delegate 항목 — worker agy → exit 10, 이후 미실행", async () => {
  await withHome(async (home) => {
    const tasksContent = `# TASKS: pipe

- [ ] T1 cli delegate
  - id: T1
  - depends: (없음)
  - worker: agy
  - done: \`echo agy\`

- [ ] T2 after delegate
  - id: T2
  - depends: T1
  - worker: worker
  - done: \`node -e "process.exit(0)"\`
`;
    const { repoRoot, paths } = createFixture(home, { tasksContent });
    const roles = [];

    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: adapterWithPlanReview(
          {
            async runRole({ role }) {
              roles.push(role);
              return { ok: true, summary: "ok" };
            },
          },
          paths
        ),
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 10);
    assert.ok(existsSync(join(paths.runsDir, "pipeline.json")));
    const tasks = readTasks(home, repoRoot);
    assert.ok(!taskLineChecked(tasks, "T1"));
    assert.ok(!taskLineChecked(tasks, "T2"));
    assert.deepEqual(roles.filter((r) => r === "worker"), []);
  });
});

test("8 resume 커서 복원 — T1 스kip, T2부터", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      tasksContent: tasksTwoItems({ t1Checked: true, t2Checked: false }),
      pipelineJson: {
        cursor: { phase: "execute", taskId: "T2" },
        reworkUsed: false,
        costAck: true,
      },
    });

    const workerTasks = [];
    let reviewerRan = false;

    const result = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter: adapterWithPlanReview(
          {
            async runRole({ role, prompt }) {
              if (role === "worker") {
                workerTasks.push(prompt?.includes("T2") ? "T2" : "other");
              }
              if (role === "reviewer") {
                reviewerRan = true;
                writeFileSync(
                  join(paths.docsDir, `REVIEW-${SLUG}.md`),
                  reviewMd("없음"),
                  "utf8"
                );
              }
              return { ok: true, summary: "ok" };
            },
          },
          paths
        ),
        runDone: async ({ taskId }) => {
          workerTasks.push(`done:${taskId}`);
          return { ok: true };
        },
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 0);
    assert.ok(!workerTasks.includes("done:T1"));
    assert.ok(workerTasks.includes("done:T2"));
    assert.equal(reviewerRan, true);
    assert.ok(taskLineChecked(readTasks(home, repoRoot), "T1"));
    assert.ok(taskLineChecked(readTasks(home, repoRoot), "T2"));
  });
});

test("9 task-card 어댑터 — exit 10 + next-card.json, resume after TASKS 산출물", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      planBlocked: "없음",
      tasksContent: undefined,
      pipelineJson: undefined,
    });
    writeFileSync(join(paths.docsDir, `PLAN-${SLUG}.md`), planMd("없음"), "utf8");
    writeFileSync(join(paths.docsDir, `TASKS-${SLUG}.md`), tasksTwoItems(), "utf8");

    const taskCardAdapter = {
      mode: "task-card",
      async runRole({ role }) {
        const card = {
          subagent_type: "generic",
          role,
          prompt: `run ${role}`,
        };
        mkdirSync(paths.runsDir, { recursive: true });
        writeFileSync(join(paths.runsDir, "next-card.json"), JSON.stringify(card, null, 2), "utf8");
        return { ok: false, kind: "run", message: "task-card pending parent" };
      },
    };

    const first = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: taskCardAdapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(first.exitCode, 10);
    const cardPath = join(paths.runsDir, "next-card.json");
    assert.ok(existsSync(cardPath));
    const card = JSON.parse(readFileSync(cardPath, "utf8"));
    assert.equal(card.subagent_type, "generic");
    assert.equal(card.role, "plan-reviewer");
    assert.equal(Object.hasOwn(card, "model"), false);

    writeFileSync(
      planReviewPath(paths.docsDir, SLUG),
      planReviewMd("없음"),
      "utf8"
    );

    let reviewerCalls = 0;
    let taskerCalls = 0;
    const resumeAdapter = {
      mode: "task-card",
      async runRole({ role }) {
        if (role === "reviewer") {
          reviewerCalls += 1;
          writeFileSync(
            join(paths.docsDir, `REVIEW-${SLUG}.md`),
            reviewMd("없음"),
            "utf8"
          );
          return { ok: true, summary: "review ok" };
        }
        if (role === "tasker") {
          taskerCalls += 1;
          const taskCard = {
            subagent_type: "generic",
            role: "tasker",
            prompt: "run tasker",
          };
          writeFileSync(
            join(paths.runsDir, "next-card.json"),
            JSON.stringify(taskCard, null, 2),
            "utf8"
          );
          return { ok: false, kind: "run", message: "task-card pending parent" };
        }
        return { ok: true, summary: `${role} ok` };
      },
    };

    const afterPlanReview = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter: resumeAdapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );
    assert.equal(afterPlanReview.exitCode, 10);
    assert.equal(taskerCalls, 1);

    writeFileSync(
      join(paths.runsDir, "pipeline.json"),
      JSON.stringify(
        {
          cursor: { phase: "tasker", role: "tasker" },
          costAck: true,
          adapter: "task-card",
          planReview: { stage: "passed", round: 1, revised: false, awaiting: false },
        },
        null,
        2
      ),
      "utf8"
    );

    const resumeAdapter2 = {
      mode: "task-card",
      async runRole({ role }) {
        if (role === "reviewer") {
          reviewerCalls += 1;
          writeFileSync(
            join(paths.docsDir, `REVIEW-${SLUG}.md`),
            reviewMd("없음"),
            "utf8"
          );
          return { ok: true, summary: "review ok" };
        }
        if (role === "tasker") {
          return { ok: true, summary: "tasker artifact present" };
        }
        return { ok: true, summary: `${role} ok` };
      },
    };

    const second = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter: resumeAdapter2,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(second.exitCode, 0);
    assert.ok(taskLineChecked(readTasks(home, repoRoot), "T1"));
    assert.ok(taskLineChecked(readTasks(home, repoRoot), "T2"));
    assert.ok(reviewerCalls >= 1);
  });
});

test("(p1) plan-review 통과 — tasker 진행 exit 0", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const roles = [];

    const result = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: adapterWithPlanReview(
          {
            async runRole({ role }) {
              roles.push(role);
              if (role === "reviewer") {
                writeFileSync(
                  join(paths.docsDir, `REVIEW-${SLUG}.md`),
                  reviewMd("없음"),
                  "utf8"
                );
              }
              return { ok: true, summary: "ok" };
            },
          },
          paths
        ),
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 0);
    assert.ok(roles.includes("plan-reviewer"));
    assert.ok(roles.includes("tasker"));
    assert.equal(result.state.cursor?.phase, "complete");
  });
});

test("(p2) plan-review 결함 — planner 1회 — 재검토 통과 exit 0 + auto-revised 로그", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);

    const result = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: adapterWithPlanReview(
          {
            async runRole({ role }) {
              if (role === "reviewer") {
                writeFileSync(
                  join(paths.docsDir, `REVIEW-${SLUG}.md`),
                  reviewMd("없음"),
                  "utf8"
                );
              }
              return { ok: true, summary: "ok" };
            },
          },
          paths,
          {
            planReviewBody: (round) => (round === 1 ? "- [설계] gap" : "없음"),
            onPlanner: async (_ctx, p) => {
              writeFileSync(
                join(p.docsDir, `PLAN-${SLUG}.md`),
                `${planMd("없음")}\n## 자동 수정 기록\n\nfixed\n`,
                "utf8"
              );
            },
          }
        ),
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 0);
    const log = readFileSync(join(paths.runsDir, "pipeline.log"), "utf8");
    assert.match(log, /PLAN auto-revised by planner/);
    assert.equal(result.state.planReview?.revised, true);
  });
});

test("(p3) 재검토 후 결함 — exit 20, tasker 미호출, human stage", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const roles = [];

    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: adapterWithPlanReview(
          {
            async runRole({ role }) {
              roles.push(role);
              return { ok: true, summary: "ok" };
            },
          },
          paths,
          {
            planReviewBody: "- [설계] still bad",
            onPlanner: async (_ctx, p) => {
              writeFileSync(
                join(p.docsDir, `PLAN-${SLUG}.md`),
                `${planMd("없음")}\n## 자동 수정 기록\n\nattempt\n`,
                "utf8"
              );
            },
          }
        ),
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 20);
    assert.ok(!roles.includes("tasker"));
    assert.equal(result.state.planReview?.stage, "human");
    assert.equal(result.state.cursor?.phase, "plan-review");
  });
});

test("(p4) PLAN-REVIEW 없음 — exit 30", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);

    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: {
          async runRole({ role }) {
            if (role === "plan-reviewer") {
              return { ok: true, summary: "forgot artifact" };
            }
            return { ok: true, summary: "ok" };
          },
        },
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(result.exitCode, 30);
    const log = readFileSync(join(paths.runsDir, "pipeline.log"), "utf8");
    assert.match(log, /PLAN-REVIEW missing or malformed \(exit 30\)/);
  });
});

test("(p5) task-card plan-reviewer exit 10 — resume에서 카드 재발급 없이 진행", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    let planReviewerCalls = 0;

    const taskCardAdapter = {
      mode: "task-card",
      async runRole({ role }) {
        if (role === "plan-reviewer") {
          planReviewerCalls += 1;
          const card = {
            subagent_type: "generic",
            role: "plan-reviewer",
            prompt: "critique plan",
          };
          writeFileSync(
            join(paths.runsDir, "next-card.json"),
            JSON.stringify(card, null, 2),
            "utf8"
          );
          return { ok: false, kind: "run", message: "task-card pending parent" };
        }
        return { ok: true, summary: "ok" };
      },
    };

    const first = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter: taskCardAdapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );
    assert.equal(first.exitCode, 10);
    assert.equal(planReviewerCalls, 1);

    writeFileSync(
      planReviewPath(paths.docsDir, SLUG),
      planReviewMd("없음"),
      "utf8"
    );

    planReviewerCalls = 0;
    let taskerCalled = false;
    const resumeAdapter = {
      mode: "task-card",
      async runRole({ role }) {
        if (role === "plan-reviewer") {
          planReviewerCalls += 1;
        }
        if (role === "tasker") {
          taskerCalled = true;
          return { ok: true, summary: "tasker ok" };
        }
        if (role === "reviewer") {
          writeFileSync(
            join(paths.docsDir, `REVIEW-${SLUG}.md`),
            reviewMd("없음"),
            "utf8"
          );
        }
        return { ok: true, summary: "ok" };
      },
    };

    const second = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter: resumeAdapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(second.exitCode, 0);
    assert.equal(planReviewerCalls, 0, "awaiting resume must not re-issue plan-reviewer");
    assert.equal(taskerCalled, true);
  });
});

test("(a) bugbot gate — sdk·task-card reviewer 진입 exit 10, bugbot 카드, reviewer 미호출", async () => {
  for (const adapterKind of ["sdk", "task-card"]) {
    await withHome(async (home) => {
      const { repoRoot, paths } = createFixture(home);
      let reviewerCalls = 0;
      const baseAdapter =
        adapterKind === "task-card"
          ? {
              mode: "task-card",
              async runRole({ role }) {
                if (role === "reviewer") reviewerCalls += 1;
                return { ok: true, summary: "ok" };
              },
            }
          : {
              async runRole({ role }) {
                if (role === "reviewer") reviewerCalls += 1;
                return { ok: true, summary: "ok" };
              },
            };
      const adapter = adapterWithPlanReview(baseAdapter, paths);

      const result = await runPipeline(
        pipelineOpts(repoRoot, home, {
          flags: { auto: true, resume: false, dryRun: false },
          adapter,
          runDone: async () => ({ ok: true }),
          statusSync: async () => {},
        })
      );

      assert.equal(result.exitCode, 10, `${adapterKind}: exit 10 at bugbot gate`);
      assert.equal(reviewerCalls, 0, `${adapterKind}: reviewer not called`);
      const cardPath = join(paths.runsDir, "next-card.json");
      assert.ok(existsSync(cardPath), `${adapterKind}: next-card.json exists`);
      const card = JSON.parse(readFileSync(cardPath, "utf8"));
      assert.equal(card.kind, "bugbot", `${adapterKind}: bugbot card kind`);
      assert.equal(card.subagent_type, "bugbot");
    });
  }
});

test("(b) bugbot findings resume — reviewer prompt에 Bugbot findings 경로", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const findingsPath = bugbotFindingsPath(paths.runsDir);
    const reviewerPrompts = [];

    const adapter = adapterWithPlanReview(
      {
        async runRole({ role, prompt }) {
          if (role === "reviewer") {
            reviewerPrompts.push(prompt);
            writeFileSync(
              join(paths.docsDir, `REVIEW-${SLUG}.md`),
              reviewMd("없음"),
              "utf8"
            );
          }
          return { ok: true, summary: "ok" };
        },
      },
      paths
    );

    const first = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );
    assert.equal(first.exitCode, 10);

    writeFileSync(findingsPath, defaultCleanFindings(SLUG, 1), "utf8");

    const second = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(second.exitCode, 0);
    assert.ok(reviewerPrompts.length >= 1);
    assert.match(
      reviewerPrompts[0],
      new RegExp(`Bugbot findings: ${findingsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  });
});

test("(c) BUGBOT_FAILED findings — reviewer 실행 후 exit 0", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    let reviewerCalls = 0;

    const adapter = adapterWithPlanReview(
      {
        async runRole({ role, prompt }) {
          if (role === "reviewer") {
            reviewerCalls += 1;
            assert.match(prompt, /BUGBOT_FAILED: proceed without bugbot/);
            writeFileSync(
              join(paths.docsDir, `REVIEW-${SLUG}.md`),
              reviewMd("없음"),
              "utf8"
            );
          }
          return { ok: true, summary: "ok" };
        },
      },
      paths
    );

    const result = await runPipelineWithBugbotParent(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: false, dryRun: false },
        adapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      }),
      {
        findingsContent: `# ${BUGBOT_FAILED_MARKER}\nreason: simulated failure\nattempts: 2\n`,
      }
    );

    assert.equal(result.exitCode, 0);
    assert.equal(reviewerCalls, 1);
  });
});

test("(d) rework pass 2 — bugbot pass2 카드, pass1 보관, reviewer 2회, exit 40", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      tasksContent: tasksTwoItems({ t2Checked: false }),
    });
    let reviewerCalls = 0;
    let pass2BugbotCard = null;

    const adapter = adapterWithPlanReview(
      {
        async runRole({ role }) {
          if (role === "reviewer") {
            reviewerCalls += 1;
            const body = reviewerCalls === 1 ? "- spec gap in T1" : "- still broken";
            writeFileSync(join(paths.docsDir, `REVIEW-${SLUG}.md`), reviewMd(body), "utf8");
          }
          return { ok: true, summary: `${role} ok` };
        },
      },
      paths
    );

    const opts = pipelineOpts(repoRoot, home, {
      flags: { auto: true, resume: false, dryRun: false },
      adapter,
      runDone: async () => ({ ok: true }),
      statusSync: async () => {},
    });

    let merged = opts;
    let finalResult = null;
    for (let i = 0; i < 24; i += 1) {
      const result = await runPipeline(merged);
      if (result.exitCode === 10 && existsSync(join(paths.runsDir, "next-card.json"))) {
        const card = JSON.parse(readFileSync(join(paths.runsDir, "next-card.json"), "utf8"));
        if (card.kind === "bugbot") {
          if (card.pass === 2) pass2BugbotCard = card;
          const pass = card.pass ?? 1;
          writeFileSync(
            bugbotFindingsPath(paths.runsDir),
            defaultCleanFindings(SLUG, pass),
            "utf8"
          );
          merged = { ...opts, flags: { ...opts.flags, resume: true } };
          continue;
        }
      }
      finalResult = result;
      break;
    }

    assert.ok(finalResult, "pipeline finished");
    assert.equal(finalResult.exitCode, 40);
    assert.equal(reviewerCalls, 2);
    assert.ok(
      existsSync(join(paths.runsDir, "bugbot-findings.pass1.md")),
      "pass1 findings archived before pass 2 bugbot"
    );
    assert.ok(pass2BugbotCard, "pass 2 bugbot card emitted after rework");
    assert.equal(pass2BugbotCard.pass, 2);
  });
});

test("(e) task-card reviewer resume — bugbot ready 상태에서 bugbot 카드 재생성 없음", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      tasksContent: tasksTwoItems({ t1Checked: true, t2Checked: true }),
      pipelineJson: {
        costAck: true,
        adapter: "task-card",
        reworkUsed: false,
        cursor: { phase: "reviewer", role: "reviewer" },
        bugbot: { pass: 1, status: "ready" },
      },
    });
    const findingsPath = bugbotFindingsPath(paths.runsDir);
    writeFileSync(findingsPath, defaultCleanFindings(SLUG, 1), "utf8");

    const pendingReviewerAdapter = {
      mode: "task-card",
      async runRole({ role }) {
        if (role === "reviewer") {
          const card = {
            subagent_type: "generic",
            role: "reviewer",
            prompt: "review task-card",
          };
          writeFileSync(
            join(paths.runsDir, "next-card.json"),
            JSON.stringify(card, null, 2),
            "utf8"
          );
          return { ok: false, kind: "run", message: "task-card pending parent" };
        }
        return { ok: true, summary: "ok" };
      },
    };

    const first = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter: pendingReviewerAdapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );
    assert.equal(first.exitCode, 10);
    const cardAfterFirst = JSON.parse(
      readFileSync(join(paths.runsDir, "next-card.json"), "utf8")
    );
    assert.equal(cardAfterFirst.subagent_type, "generic");
    assert.equal(cardAfterFirst.role, "reviewer");
    assert.notEqual(cardAfterFirst.kind, "bugbot");

    const logBefore = existsSync(join(paths.runsDir, "pipeline.log"))
      ? readFileSync(join(paths.runsDir, "pipeline.log"), "utf8")
      : "";

    let reviewerCalls = 0;
    const completeAdapter = {
      mode: "task-card",
      async runRole({ role, prompt }) {
        if (role === "reviewer") {
          reviewerCalls += 1;
          assert.match(prompt, /Bugbot findings:/);
          writeFileSync(
            join(paths.docsDir, `REVIEW-${SLUG}.md`),
            reviewMd("없음"),
            "utf8"
          );
        }
        return { ok: true, summary: "ok" };
      },
    };

    const second = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        adapter: completeAdapter,
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );

    assert.equal(second.exitCode, 0);
    assert.equal(reviewerCalls, 1);
    const cardAfterSecond = existsSync(join(paths.runsDir, "next-card.json"))
      ? JSON.parse(readFileSync(join(paths.runsDir, "next-card.json"), "utf8"))
      : null;
    assert.notEqual(cardAfterSecond?.kind, "bugbot");
    const logAfter = existsSync(join(paths.runsDir, "pipeline.log"))
      ? readFileSync(join(paths.runsDir, "pipeline.log"), "utf8")
      : "";
    assert.equal(
      (logAfter.match(/bugbot card pending/g) ?? []).length,
      (logBefore.match(/bugbot card pending/g) ?? []).length,
      "no extra bugbot card pending log on reviewer resume"
    );
  });
});

test("10 SDK 미설치(loadSdk null) — resolvePipelineAdapter가 task-card 선택", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    const hints = [];
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: null,
      repo: repoRoot,
      slug: SLUG,
      loadSdkFn: async () => null,
      logHint: (m) => hints.push(m),
    });
    assert.equal(used, "task-card");
    assert.equal(adapter.mode, "task-card");
    assert.ok(hints.some((h) => h.includes("model-neutral default")));
    assert.equal(hints.length, 1);
    assert.match(hints[0], /task-card selected:/);
    const paths = getWorkflowPaths(repoRoot, SLUG);
    assert.equal(
      readFileSync(join(paths.runsDir, "pipeline.log"), "utf8"),
      `${hints[0]}\n`,
    );
  });
});

test("11 sdk adapter — Agent.create startup throw → kind startup", async () => {
  class CursorAgentError extends Error {
    constructor(message) {
      super(message);
      this.name = "CursorAgentError";
    }
  }

  const fakeSdk = {
    CursorAgentError,
    Agent: {
      async create() {
        throw new CursorAgentError("Authentication required");
      },
    },
  };

  const adapter = await createSdkAdapter({
    repoRoot: process.cwd(),
    sdk: fakeSdk,
    model: { id: "test-model" },
  });
  assert.equal(adapter?.mode, "sdk");

  const result = await adapter.runRole({
    role: "worker",
    prompt: "noop",
    cwd: process.cwd(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.kind, "startup");
  assert.match(result.message, /Authentication/i);
});

test("11b sdk adapter — run.stream() 이벤트가 onProgress로 전달된다", async () => {
  const messages = [
    { type: "status", status: "RUNNING" },
    { type: "tool_call", call_id: "1", name: "read", status: "running", args: { path: "a.md" } },
    {
      type: "tool_call",
      call_id: "2",
      name: "task",
      status: "running",
      args: { subagentType: "explorer" },
    },
    { type: "tool_call", call_id: "2", name: "task", status: "running", args: {} },
    { type: "task", status: "done", text: "explorer finished" },
  ];
  const fakeSdk = {
    Agent: {
      async create() {
        return {
          async send() {
            return {
              id: "run-1",
              async *stream() {
                for (const m of messages) yield m;
              },
              async wait() {
                return { status: "finished", id: "run-1" };
              },
            };
          },
          async close() {},
        };
      },
    },
  };
  const adapter = await createSdkAdapter({
    repoRoot: process.cwd(),
    sdk: fakeSdk,
    model: { id: "test-model" },
  });
  const lines = [];
  const result = await adapter.runRole({
    role: "worker",
    prompt: "noop",
    cwd: process.cwd(),
    onProgress: (l) => lines.push(l),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(lines, [
    "status RUNNING",
    "subagent running explorer",
    "subagent done explorer finished",
  ]);
});

test("11c sdk adapter — run.stream 없어도(또는 onProgress 없이) 동작", async () => {
  const fakeSdk = {
    Agent: {
      async create() {
        return {
          async send() {
            return { id: "r", async wait() { return { status: "finished", id: "r" }; } };
          },
          async close() {},
        };
      },
    },
  };
  const adapter = await createSdkAdapter({
    repoRoot: process.cwd(),
    sdk: fakeSdk,
    model: { id: "test-model" },
  });
  const result = await adapter.runRole({
    role: "worker",
    prompt: "noop",
    cwd: process.cwd(),
    onProgress: () => {},
  });
  assert.equal(result.ok, true);
});

test("12 loadSdk — import 실패 시 null (과금 없음)", async () => {
  const mod = await loadSdk(async () => {
    const err = new Error("Cannot find package '@cursor/sdk'");
    err.code = "ERR_MODULE_NOT_FOUND";
    throw err;
  });
  assert.equal(mod, null);
});

test("13 SDK import 성공이어도 기본 어댑터는 model-neutral task-card", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const hints = [];
    let imported = false;
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: null,
      repo: repoRoot,
      slug: SLUG,
      loadSdkFn: async () => {
        imported = true;
        return { Agent: {} };
      },
      logHint: (m) => hints.push(m),
    });
    assert.equal(imported, false);
    assert.equal(used, "task-card");
    assert.equal(adapter.mode, "task-card");
    assert.deepEqual(hints, [
      "task-card selected: model-neutral default; use --adapter sdk only with an explicit SDK model configuration.",
    ]);
    assert.equal(existsSync(join(paths.runsDir, "pipeline.log")), true);
  });
});

test("14 설치된 @cursor/sdk가 있어도 기본 어댑터는 task-card", async (t) => {
  const sdk = await loadSdk();
  if (!sdk) {
    t.skip("@cursor/sdk optional dependency is not installed");
    return;
  }
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    const hints = [];
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: null,
      repo: repoRoot,
      slug: SLUG,
      logHint: (m) => hints.push(m),
    });
    assert.equal(used, "task-card");
    assert.equal(adapter?.mode, "task-card");
    assert.equal(hints.length, 1);
  });
});

test("15 SDK 모듈을 설치해도 기본 경로는 SDK를 import하지 않는다", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    const hints = [];
    let created = false;
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: null,
      repo: repoRoot,
      slug: SLUG,
      loadSdkFn: async () => ({ Agent: {} }),
      createSdkAdapterFn: async () => {
        created = true;
        return null;
      },
      logHint: (m) => hints.push(m),
    });
    assert.equal(used, "task-card");
    assert.equal(adapter.mode, "task-card");
    assert.equal(created, false);
    assert.equal(hints.length, 1);
    assert.match(hints[0], /^task-card selected:/);
  });
});

test("16 명시적 task-card — 이유 한 줄, import는 호출하지 않음", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    const hints = [];
    let imported = false;
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: "task-card",
      repo: repoRoot,
      slug: SLUG,
      loadSdkFn: async () => {
        imported = true;
        return { Agent: {} };
      },
      logHint: (m) => hints.push(m),
    });
    assert.equal(imported, false);
    assert.equal(used, "task-card");
    assert.equal(adapter.mode, "task-card");
    assert.deepEqual(hints, ["task-card selected: --adapter task-card"]);
    const paths = getWorkflowPaths(repoRoot, SLUG);
    assert.equal(
      readFileSync(join(paths.runsDir, "pipeline.log"), "utf8"),
      "task-card selected: --adapter task-card\n",
    );
  });
});

test("17 --adapter sdk 인데 import 실패 — task-card로 떨어지지 않음", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    const hints = [];
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: "sdk",
      repo: repoRoot,
      slug: SLUG,
      loadSdkFn: (importFn, onError) =>
        loadSdk(async () => {
          throw new Error("sdk-probe-missing");
        }, onError),
      logHint: (m) => hints.push(m),
    });
    assert.equal(used, "sdk");
    assert.equal(adapter, null);
    assert.equal(hints.length, 1);
    assert.match(hints[0], /@cursor\/sdk/);
    assert.match(hints[0], /sdk-probe-missing/);
    assert.doesNotMatch(hints[0], /^task-card selected:/);
  });
});

test("18 import 실패 이유가 task-card 선택 로그 한 줄에 포함", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home);
    const hints = [];
    const { adapter, used } = await resolvePipelineAdapter({
      adapterName: null,
      repo: repoRoot,
      slug: SLUG,
      loadSdkFn: (importFn, onError) =>
        loadSdk(async () => {
          throw new Error("Cannot find package '@cursor/sdk' probe-token");
        }, onError),
      logHint: (m) => hints.push(m),
    });
    assert.equal(used, "task-card");
    assert.equal(adapter.mode, "task-card");
    assert.equal(hints.length, 1);
    assert.match(hints[0], /task-card selected:/);
    assert.doesNotMatch(hints[0], /probe-token/);
    const paths = getWorkflowPaths(repoRoot, SLUG);
    assert.equal(readFileSync(join(paths.runsDir, "pipeline.log"), "utf8"), `${hints[0]}\n`);
  });
});

test("19 task-card 스킬 경로 — 저장소 파일이 있을 때만 그 경로", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const skillHome = join(home, "cursor-home");
    const repoWorkflow = join(
      repoRoot,
      ".agents",
      "skills",
      "atomic-workflow",
      "SKILL.md",
    );
    const repoTickets = join(repoRoot, ".agents", "skills", "to-tickets", "SKILL.md");
    const homeTickets = join(skillHome, ".agents", "skills", "to-tickets", "SKILL.md");
    const homeWorkflow = join(
      skillHome,
      ".agents",
      "skills",
      "atomic-workflow",
      "SKILL.md",
    );
    mkdirSync(join(repoWorkflow, ".."), { recursive: true });
    writeFileSync(repoWorkflow, "# repo workflow\n", "utf8");
    mkdirSync(join(homeTickets, ".."), { recursive: true });
    writeFileSync(homeTickets, "# home tickets\n", "utf8");
    mkdirSync(join(homeWorkflow, ".."), { recursive: true });
    writeFileSync(homeWorkflow, "# home workflow\n", "utf8");

    const adapter = createTaskCardAdapter({
      runsDir: paths.runsDir,
      slug: SLUG,
      repoRoot,
      homeDir: skillHome,
    });
    await adapter.runRole({ role: "tasker", prompt: "split tasks" });
    const card = JSON.parse(readFileSync(join(paths.runsDir, "next-card.json"), "utf8"));
    assert.ok(card.prompt.includes(repoWorkflow));
    assert.ok(card.prompt.includes(homeTickets));
    assert.equal(card.prompt.includes(repoTickets), false);
    assert.equal(card.prompt.includes(homeWorkflow), false);

    const emptyRepo = join(home, "empty-repo");
    mkdirSync(emptyRepo, { recursive: true });
    const adapterEmpty = createTaskCardAdapter({
      runsDir: paths.runsDir,
      slug: SLUG,
      repoRoot: emptyRepo,
      homeDir: skillHome,
    });
    await adapterEmpty.runRole({ role: "tasker", prompt: "again" });
    const cardEmpty = JSON.parse(readFileSync(join(paths.runsDir, "next-card.json"), "utf8"));
    const missingRepoWorkflow = join(
      emptyRepo,
      ".agents",
      "skills",
      "atomic-workflow",
      "SKILL.md",
    );
    assert.ok(cardEmpty.prompt.includes(homeWorkflow));
    assert.ok(cardEmpty.prompt.includes(homeTickets));
    assert.equal(cardEmpty.prompt.includes(missingRepoWorkflow), false);
    assert.equal(cardEmpty.prompt.includes(repoWorkflow), false);
  });
});

test("profile atomic tester keeps Test slug prompt and npm test", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home, {
      tasksContent: tasksTwoItems({ t1Checked: true, t2Checked: true }),
      pipelineJson: {
        cursor: { phase: "tester" },
        costAck: true,
        reworkUsed: false,
        attempts: [],
      },
    });
    /** @type {Array<{ taskId?: string, command?: string }>} */
    const dones = [];
    /** @type {string[]} */
    const prompts = [];
    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        profileOptions: { packageRoot: home, workflowHome: home, homeDir: home },
        adapter: {
          async runRole({ prompt }) {
            prompts.push(prompt);
            return { ok: true, summary: "ok" };
          },
        },
        runDone: async (args) => {
          dones.push(args);
          return { ok: true };
        },
        statusSync: async () => {},
      })
    );
    assert.equal(result.exitCode, 0);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Test slug pipe-run/);
    assert.match(prompts[0], /FORBID \(이 단계는 코드를 수정하지 않는다\)/);
    assert.match(prompts[0], /docsDir:/);
    assert.match(prompts[0], /runsDir:/);
    assert.equal(dones.filter((item) => item.taskId === "tester").length, 1);
    assert.equal(dones.find((item) => item.taskId === "tester").command, "npm test");
  });
});

test("profile with test.command skips npm test and names the command", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      tasksContent: tasksTwoItems({ t1Checked: true, t2Checked: true }),
      pipelineJson: {
        cursor: { phase: "tester" },
        profile: "ext",
        costAck: true,
        reworkUsed: false,
        attempts: [],
      },
    });
    const cmd = join(home, "test.md");
    writeFileSync(cmd, "# test\n", "utf8");
    mkdirSync(join(repoRoot, "profiles"), { recursive: true });
    writeFileSync(
      join(repoRoot, "profiles", "ext.json"),
      JSON.stringify({ id: "ext", test: { command: cmd } }),
      "utf8"
    );
    /** @type {string[]} */
    const prompts = [];
    let testerDones = 0;
    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        flags: { auto: true, resume: true, dryRun: false },
        profileOptions: { packageRoot: home, workflowHome: home, homeDir: home },
        adapter: {
          async runRole({ prompt }) {
            prompts.push(prompt);
            return { ok: true, summary: "ok" };
          },
        },
        runDone: async (args) => {
          if (args.taskId === "tester") testerDones += 1;
          return { ok: true };
        },
        statusSync: async () => {},
      })
    );
    assert.equal(result.exitCode, 0);
    assert.match(prompts[0], new RegExp(cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(prompts[0], /do not SSH/);
    assert.equal(testerDones, 0);
    assert.equal(result.state.profile, "ext");
    assert.ok(existsSync(join(paths.runsDir, "pipeline.log")));
  });
});

test("unknown profile exits 2 and lists known ids", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home);
    const lines = [];
    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        profileId: "nope",
        flags: { auto: true, resume: false, dryRun: true },
        profileOptions: { packageRoot: home, workflowHome: home, homeDir: home },
        log: (line) => lines.push(line),
        adapter: { async runRole() { return { ok: true, summary: "no" }; } },
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );
    assert.equal(result.exitCode, 2);
    const log = readFileSync(join(paths.runsDir, "pipeline.log"), "utf8");
    assert.match(log, /unknown profile: nope/);
    assert.match(log, /atomic/);
    assert.equal(lines.some((line) => /unknown profile/.test(line)), true);
  });
});

test("resume with a different --profile exits 2", async () => {
  await withHome(async (home) => {
    const { repoRoot } = createFixture(home, {
      pipelineJson: {
        cursor: { phase: "cost-gate" },
        profile: "bsp",
        costAck: true,
        reworkUsed: false,
        attempts: [],
      },
    });
    const result = await runPipeline(
      pipelineOpts(repoRoot, home, {
        profileId: "atomic",
        flags: { auto: true, resume: true, dryRun: true },
        profileOptions: { packageRoot: home, workflowHome: home, homeDir: home },
        adapter: { async runRole() { return { ok: true, summary: "no" }; } },
        runDone: async () => ({ ok: true }),
        statusSync: async () => {},
      })
    );
    assert.equal(result.exitCode, 2);
  });
});

test("agy stage questions — plan, implement, review", async () => {
  await withHome(async (home) => {
    const { repoRoot, paths } = createFixture(home, {
      pipelineJson: {
        cursor: { phase: "plan-review" },
        costAck: true,
        reworkUsed: false,
      },
    });
    const roles = [];
    const adapter = adapterWithPlanReview(
      {
        async runRole({ role }) {
          roles.push(role);
          if (role === "reviewer") {
            writeFileSync(
              join(paths.docsDir, `REVIEW-${SLUG}.md`),
              reviewMd("없음"),
              "utf8"
            );
          }
          return { ok: true, summary: "ok" };
        },
      },
      paths
    );
    const base = {
      adapter,
      runDone: async () => ({ ok: true }),
      statusSync: async () => {},
    };
    const resume = (json) => {
      writeFileSync(join(paths.runsDir, "pipeline.json"), JSON.stringify(json, null, 2), "utf8");
      return runPipeline(
        pipelineOpts(repoRoot, home, {
          ...base,
          flags: { auto: false, resume: true, dryRun: false },
        })
      );
    };

    const planAsk = await resume({
      cursor: { phase: "plan-review" },
      costAck: true,
      reworkUsed: false,
    });
    assert.equal(planAsk.exitCode, 20);
    assert.equal(planAsk.state.cursor.phase, "agy-ask");
    assert.equal(planAsk.state.cursor.stage, "plan");
    assert.match(planAsk.state.cursor.question, /계획 단계입니다/);
    assert.equal(roles.length, 0);

    const implAsk = await resume({
      ...planAsk.state,
      agyChoice: { plan: "sdk" },
    });
    assert.equal(implAsk.exitCode, 20);
    assert.equal(implAsk.state.cursor.stage, "implement");
    assert.ok(roles.includes("plan-reviewer"));
    assert.ok(roles.includes("tasker"));
    assert.equal(roles.includes("worker"), false);

    const delegated = await resume({
      ...implAsk.state,
      agyChoice: { ...implAsk.state.agyChoice, implement: "agy" },
    });
    assert.equal(delegated.exitCode, 10);
    assert.equal(delegated.state.cursor.delegate, "agy");
    assert.equal(delegated.state.cursor.stage, "implement");
    assert.equal(delegated.state.cursor.taskId, "T1");

    const second = await resume(delegated.state);
    assert.equal(second.exitCode, 10);
    assert.equal(second.state.cursor.taskId, "T2");
    assert.equal(taskLineChecked(readTasks(home, repoRoot), "T1"), true);

    const reviewAsk = await resume(second.state);
    assert.equal(reviewAsk.exitCode, 20);
    assert.equal(reviewAsk.state.cursor.stage, "review");
    assert.match(reviewAsk.state.cursor.question, /리뷰 단계입니다/);

    const reviewDelegate = await resume({
      ...reviewAsk.state,
      agyChoice: { ...reviewAsk.state.agyChoice, review: "agy" },
    });
    assert.equal(reviewDelegate.exitCode, 10);
    assert.equal(reviewDelegate.state.cursor.stage, "review");
    assert.equal(reviewDelegate.state.cursor.delegate, "agy");
    assert.equal(roles.includes("reviewer"), false);
  });
});
