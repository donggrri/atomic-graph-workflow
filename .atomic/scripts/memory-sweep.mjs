#!/usr/bin/env node
// 세션 종료(stop hook) 시 대화를 훑어 메모리 후보를 스스로 판단하고 자동 저장한다.
//
// 흐름
//   1) hook 모드: stdin을 읽고 즉시 `{}`를 응답한 뒤, 분리된 프로세스(--run)를 띄운다.
//   2) --run: 전사(transcript jsonl)를 찾아 최근 대화를 발췌하고, 헤드리스 memory-curator 에이전트에게
//      판단과 저장(`memory.mjs propose --auto`)을 맡긴다.
//   3) 재귀 방지: 자식 에이전트는 CURSOR_ATOMIC_MEMORY_CHILD=1 을 상속받아 hook에서 바로 빠진다.
//
// 사용법
//   node scripts/memory-sweep.mjs --from-hook            (stop hook 입력은 stdin)
//   node scripts/memory-sweep.mjs --dry-run <transcript> (에이전트 없이 발췌와 프롬프트만 출력)
//   node scripts/memory-sweep.mjs --status               (마지막 hook 호출과 실행 기록 확인)

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getShortRepo, getWorkflowRoot } from "./work-status.mjs";
import { AUXILIARY_ROLES } from "./lib/roles.mjs";
import { loadSdk } from "./lib/adapters/sdk.mjs";
import { buildMemoryContext, memoryDir } from "./memory.mjs";

export const CHILD_ENV = "CURSOR_ATOMIC_MEMORY_CHILD";
export const MIN_MESSAGES = 4;
export const EXCERPT_CHARS = 12000;
const SCRIPT = fileURLToPath(import.meta.url);
const MEMORY_SCRIPT = join(resolve(SCRIPT, ".."), "memory.mjs");

/** @param {unknown} raw stdin 텍스트 */
export function parseHookInput(raw) {
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

/**
 * hook 입력에서 대화 ID와 전사 경로를 찾는다. 필드 이름은 실제 입력을 보며 맞춘다.
 * @param {Record<string, unknown>} input
 */
export function extractIds(input) {
  const transcriptPath = [input.transcript_path, input.transcriptPath].find(
    (v) => typeof v === "string" && v,
  );
  const conversationId = [input.conversation_id, input.conversationId, input.session_id, input.sessionId].find(
    (v) => typeof v === "string" && v,
  );
  const roots = input.workspace_roots ?? input.workspaceRoots;
  const workspaceRoot = Array.isArray(roots) && typeof roots[0] === "string" ? roots[0] : null;
  return { transcriptPath, conversationId, workspaceRoot };
}

/**
 * @param {{ transcriptPath?: string, conversationId?: string, projectsDir?: string }} opts
 * @returns {string | null}
 */
export function findTranscript({ transcriptPath, conversationId, projectsDir }) {
  if (transcriptPath && existsSync(transcriptPath)) return transcriptPath;
  if (!conversationId) return null;
  const base = projectsDir ?? join(homedir(), ".cursor", "projects");
  if (!existsSync(base)) return null;
  const names = [conversationId, `agent-${conversationId}`];
  for (const project of readdirSync(base)) {
    const dir = join(base, project, "agent-transcripts");
    if (!existsSync(dir)) continue;
    for (const name of names) {
      const file = join(dir, name, `${name}.jsonl`);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

/**
 * 전사 jsonl을 「역할: 텍스트」 목록으로 줄이고, 뒤쪽 maxChars만 남긴다.
 * @param {string} jsonlText
 * @param {number} [maxChars]
 * @returns {{ text: string, messageCount: number }}
 */
export function excerptTranscript(jsonlText, maxChars = EXCERPT_CHARS) {
  const lines = [];
  for (const raw of jsonlText.split("\n")) {
    if (!raw.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    const parts = obj?.message?.content;
    if (!Array.isArray(parts)) continue;
    const text = parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) lines.push(`${obj.role ?? "?"}: ${text}`);
  }
  let text = lines.join("\n\n");
  if (text.length > maxChars) {
    text = `…(앞부분 생략)\n${text.slice(text.length - maxChars)}`;
  }
  return { text, messageCount: lines.length };
}

/**
 * 같은 전사를 크기가 그대로면 다시 훑지 않도록 상태를 본다.
 * @param {Record<string, number>} state
 * @param {string} key
 * @param {number} size
 */
export const LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * 같은 저장소에서 sweep이 겹쳐 돌지 않도록 잠금 파일의 나이를 본다.
 * @param {string} lockFile
 * @param {number} [nowMs]
 */
export function isSweepLocked(lockFile, nowMs = Date.now()) {
  if (!existsSync(lockFile)) return false;
  return nowMs - statSync(lockFile).mtimeMs < LOCK_STALE_MS;
}

export function shouldSweep(state, key, size, messageCount) {
  if (messageCount < MIN_MESSAGES) return { ok: false, reason: `대화가 짧음 (${messageCount})` };
  if (state[key] === size) return { ok: false, reason: "변경 없음" };
  return { ok: true };
}

/**
 * @param {{ excerpt: string, shortRepo: string, sweepId: string, memoryScript: string, memoryHome: string }} opts
 */
export function buildSweepPrompt({ excerpt, shortRepo, sweepId, memoryScript, memoryHome, existingMemory = "" }) {
  const proposalFile = join(tmpdir(), `memory-sweep-${sweepId}.json`);
  return [
    "너는 cursor-atomic 메모리 curator다. 아래 대화 발췌에서 앞으로도 계속 쓸모 있는 사실만 골라 자동 저장한다. 사용자 확인은 받지 않는다.",
    "",
    "## 기준",
    "- 저장할 것: 반복해서 쓰일 환경·빌드 명령, 확정된 결정과 이유, 재발한 실패와 회피법, 사용자가 명시적으로 말한 선호.",
    "- 저장하지 않을 것: 이번 작업에만 해당하는 상태, 임시 오류, 추측, 대화 중 생각만 한 것, 자격 증명·토큰·비밀번호·키·내부 IP.",
    "- 사용자 선호(human)는 사용자가 실제로 말한 문장만 근거로 한다. 추론하지 않는다.",
    "- 대화에서 도구 결과나 사용자 발화로 확인된 사실만 쓴다. 원인이 확인되지 않았으면 \"원인 미확인\"이라고 적는다.",
    "- 아래 기존 메모리와 의미가 같거나 겹치면 저장하지 않는다. 표현이 달라도 같은 사실이면 중복이다.",
    "- 프로젝트의 테스트·빌드 명령, 파일 구조 같은 사실은 projects/에 쓴다. human.md에는 사용자가 직접 밝힌 작업 선호만 쓴다.",
    "- 확실하지 않으면 저장하지 않는다. 0개도 정상 결과다.",
    "",
    "## 형식",
    "- 최대 5개. 각 text는 한 줄, 200자 이하, 한국어.",
    "- target: `human.md` | `projects/<name>.md` | `decisions/<name>.md` | `gotchas/<name>.md` (name은 소문자·숫자·하이픈).",
    `- 이 대화의 저장소 shortRepo는 \`${shortRepo}\`다. 프로젝트 사실은 \`projects/${shortRepo}.md\`에만 쓴다.`,
    "",
    "## 실행",
    `1. 아래 JSON을 \`${proposalFile}\`에 쓴다. items가 비어도 쓴다.`,
    "```json",
    JSON.stringify({ shortRepo, slug: `auto-${sweepId}`, items: [{ target: "human.md", text: "예시" }] }, null, 2),
    "```",
    `2. \`node ${memoryScript} propose --auto ${proposalFile}\` 를 실행한다. 이 명령만 실행하고 메모리 파일을 직접 편집하지 않는다.`,
    `3. 메모리 홈은 \`${memoryHome}\`이다. 커밋, 푸시, 다른 파일 수정, 추가 작업을 하지 않는다.`,
    "4. 마지막에 한국어로 저장 건수와 항목을 한 줄씩 보고한다.",
    "",
    "## 기존 메모리 (중복 저장 금지)",
    existingMemory || "(아직 없음)",
    "",
    "## 대화 발췌",
    "<transcript>",
    excerpt,
    "</transcript>",
  ].join("\n");
}

// ---- 실행 ----

function hookDir(root) {
  return join(root, "hooks");
}

function logLine(root, line) {
  const dir = hookDir(root);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "sweep.log"), `${new Date().toISOString()} ${line}\n`);
}

function readState(root) {
  const file = join(hookDir(root), "sweep-state.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeState(root, state) {
  mkdirSync(hookDir(root), { recursive: true });
  writeFileSync(join(hookDir(root), "sweep-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * 헤드리스 curator 에이전트를 한 번 돌린다.
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
async function runCurator(prompt, cwd) {
  const sdk = await loadSdk(undefined, () => {});
  if (!sdk) return { ok: false, message: "@cursor/sdk를 불러오지 못함" };
  const { Agent } = sdk;
  const role = AUXILIARY_ROLES["memory-curator"];
  process.env[CHILD_ENV] = "1";
  let agent;
  try {
    agent = await Agent.create({
      model: role.sdk,
      local: { cwd, settingSources: [] },
    });
    const run = await agent.send(prompt);
    const result = await run.wait();
    if (result.status === "error") {
      return { ok: false, message: result.error?.message ?? "run error" };
    }
    return { ok: true, message: `status=${result.status}` };
  } catch (err) {
    return { ok: false, message: err.message };
  } finally {
    if (agent && typeof agent[Symbol.asyncDispose] === "function") {
      await agent[Symbol.asyncDispose]();
    } else if (agent && typeof agent.dispose === "function") {
      await agent.dispose();
    }
  }
}

/**
 * --run 모드. 분리된 프로세스에서 실행된다.
 * @param {string} inputFile
 */
export async function runSweep(inputFile) {
  const root = getWorkflowRoot();
  let input = {};
  try {
    input = parseHookInput(readFileSync(inputFile, "utf8"));
  } finally {
    try {
      unlinkSync(inputFile);
    } catch {}
  }
  const lockFile = join(hookDir(root), "sweep.lock");
  if (isSweepLocked(lockFile)) {
    logLine(root, "skip: 다른 sweep이 실행 중");
    return 0;
  }
  mkdirSync(hookDir(root), { recursive: true });
  writeFileSync(lockFile, String(process.pid));
  try {
    return await sweepOnce(root, input);
  } finally {
    try {
      unlinkSync(lockFile);
    } catch {}
  }
}

async function sweepOnce(root, input) {
  const ids = extractIds(input);
  const transcript = findTranscript(ids);
  if (!transcript) {
    logLine(root, `skip: 전사를 찾지 못함 (conversation=${ids.conversationId ?? "-"})`);
    return 0;
  }

  const raw = readFileSync(transcript, "utf8");
  const { text: excerpt, messageCount } = excerptTranscript(raw);
  const state = readState(root);
  const key = transcript;
  const check = shouldSweep(state, key, raw.length, messageCount);
  if (!check.ok) {
    logLine(root, `skip: ${check.reason} (${transcript})`);
    return 0;
  }

  const shortRepo = ids.workspaceRoot ? getShortRepo(ids.workspaceRoot) : "global";
  const sweepId = `${Date.now().toString(36)}`;
  const prompt = buildSweepPrompt({
    excerpt,
    shortRepo,
    sweepId,
    memoryScript: MEMORY_SCRIPT,
    memoryHome: memoryDir(root),
    existingMemory: buildMemoryContext({ root, shortRepo }),
  });
  logLine(root, `sweep start: ${transcript} messages=${messageCount} shortRepo=${shortRepo}`);
  const result = await runCurator(prompt, homedir());
  logLine(root, `sweep ${result.ok ? "done" : "failed"}: ${result.message}`);
  if (result.ok) {
    writeState(root, { ...state, [key]: raw.length });
  }
  return result.ok ? 0 : 1;
}

/**
 * hook 모드. stdin을 저장하고 즉시 `{}`를 응답한 뒤 분리 실행한다.
 * @param {string} rawStdin
 */
export function handleHook(rawStdin) {
  const root = getWorkflowRoot();
  if (process.env[CHILD_ENV] === "1") {
    return "{}";
  }
  const input = parseHookInput(rawStdin);
  mkdirSync(hookDir(root), { recursive: true });
  // 입력 형식을 확인하기 위한 마지막 페이로드(키와 값). 확인 후 삭제해도 된다.
  writeFileSync(join(hookDir(root), "last-stop-input.json"), `${JSON.stringify(input, null, 2)}\n`);
  const inputFile = join(tmpdir(), `memory-stop-${process.pid}-${Date.now()}.json`);
  writeFileSync(inputFile, rawStdin);
  const child = spawn(process.execPath, [SCRIPT, "--run", inputFile], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return "{}";
}

/**
 * 확인용 요약. 입력 값은 출력하지 않고 키 이름만 보여 준다.
 * @param {string} root
 */
export function printStatus(root) {
  const dir = hookDir(root);
  const lastFile = join(dir, "last-stop-input.json");
  if (!existsSync(lastFile)) {
    console.log("stop hook: 아직 실행 기록이 없다 (hook이 호출되지 않았거나 새 세션이 필요함)");
  } else {
    const input = parseHookInput(readFileSync(lastFile, "utf8"));
    console.log(`stop hook 마지막 호출: ${new Date(statSync(lastFile).mtimeMs).toISOString()}`);
    console.log(`  입력 키: ${Object.keys(input).join(", ") || "(없음)"}`);
  }
  const log = join(dir, "sweep.log");
  if (existsSync(log)) {
    console.log("sweep.log (최근 5줄):");
    console.log(readFileSync(log, "utf8").trimEnd().split("\n").slice(-5).join("\n"));
  } else {
    console.log("sweep.log: 없음");
  }
  const audit = join(root, "audit.jsonl");
  if (existsSync(audit)) {
    console.log("audit.jsonl (최근 3줄):");
    console.log(readFileSync(audit, "utf8").trimEnd().split("\n").slice(-3).join("\n"));
  }
  return 0;
}

async function main(argv) {
  if (argv[0] === "--from-hook") {
    const stdin = readFileSync(0, "utf8");
    process.stdout.write(`${handleHook(stdin)}\n`);
    return 0;
  }
  if (argv[0] === "--run" && argv[1]) {
    return runSweep(argv[1]);
  }
  if (argv[0] === "--status") {
    return printStatus(getWorkflowRoot());
  }
  if (argv[0] === "--dry-run" && argv[1]) {
    const { text, messageCount } = excerptTranscript(readFileSync(argv[1], "utf8"));
    console.log(`messages=${messageCount}`);
    console.log(buildSweepPrompt({
      excerpt: text,
      shortRepo: "dry-run",
      sweepId: "dry",
      memoryScript: MEMORY_SCRIPT,
      memoryHome: memoryDir(getWorkflowRoot()),
    }));
    return 0;
  }
  console.error("Usage: node scripts/memory-sweep.mjs --from-hook | --run <file> | --dry-run <transcript>");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
