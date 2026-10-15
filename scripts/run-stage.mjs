#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runGraphStage } from "./lib/stage-run.mjs";
import { GRAPH_STAGE_IDS, loadGraph } from "./lib/graph.mjs";

function usage() {
  console.error(`Usage: node scripts/run-stage.mjs <stage> --repo <dir> [--slug <slug>] [--prompt <text> | --prompt-file <path>]

Stages: ${GRAPH_STAGE_IDS.join(", ")}, lite`);
  return 2;
}

async function main(argv) {
  const stage = argv[0];
  if (!stage || stage === "--help" || stage === "-h") return usage();

  let repo = process.cwd();
  let slug = "stage-run";
  let prompt = "";
  let promptFile = null;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1]) {
      repo = resolve(argv[++i]);
    } else if (a === "--slug" && argv[i + 1]) {
      slug = argv[++i];
    } else if (a === "--prompt" && argv[i + 1]) {
      prompt = argv[++i];
    } else if (a === "--prompt-file" && argv[i + 1]) {
      promptFile = argv[++i];
    } else {
      return usage();
    }
  }
  if (promptFile !== null) {
    // --prompt-file is a trusted CLI argument (skills pass absolute /tmp paths):
    // resolve relative to process.cwd(), allow absolute paths anywhere.
    try {
      prompt = readFileSync(resolve(promptFile), "utf8");
    } catch (err) {
      console.error(`error: cannot read --prompt-file "${promptFile}": ${err.message}`);
      return 2;
    }
  }
  if (!prompt.trim()) {
    console.error("error: --prompt or --prompt-file required");
    return 2;
  }

  const graph = loadGraph(repo);
  for (const w of graph.warnings ?? []) {
    console.error(`warning: ${w}`);
  }
  for (const e of graph.errors ?? []) {
    console.error(`error: ${e}`);
  }
  if (Array.isArray(graph.errors) && graph.errors.length > 0) {
    return 1;
  }
  if (!GRAPH_STAGE_IDS.includes(stage) && stage !== "lite" && !graph.nodes?.[stage]) {
    console.error(`error: unknown stage "${stage}" (not in graph)`);
    return 2;
  }

  const result = await runGraphStage({
    repoRoot: repo,
    stage,
    slug,
    prompt,
    log: (line) => console.error(String(line)),
  });
  if (!result.ok) {
    console.error(result.message ?? "stage run failed");
    return 1;
  }
  if (result.summary) console.log(result.summary);
  return 0;
}

if (process.argv[1]?.endsWith("run-stage.mjs")) {
  main(process.argv.slice(2)).then((code) => process.exit(code ?? 0));
}
