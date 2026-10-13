#!/usr/bin/env node
// cursor-atomic-workflow 메모리: 캡처, 역할 프롬프트 주입, 승인형 저장.
// 번들 스크립트다. 외부 의존은 work-status.mjs(getWorkflowRoot)뿐이다.
//
// 저장 위치: <workflowRoot>/memory (보통 볼트 cursor-workflow/memory 로 심볼릭 링크)
//   human.md, projects/<shortRepo>.md, decisions/<name>.md, gotchas/<name>.md
// 큐: <workflowRoot>/queue/proposals.json (승인 전 후보)
// 캡처: <workflowRoot>/captures/<shortRepo>-<slug>.json (파이프라인 완료 시 기록)
//
// 사용법:
//   node scripts/memory.mjs list
//   node scripts/memory.mjs propose <file.json>
//   node scripts/memory.mjs approve <id>
//   node scripts/memory.mjs reject <id>
//   node scripts/memory.mjs context <shortRepo>
//   node scripts/memory.mjs repo <repoPath>

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getShortRepo, getWorkflowRoot } from "./work-status.mjs";

export const CONTEXT_BUDGET = 3000;
export const SECTION_BUDGET = 900;
export const MAX_ENTRY_CHARS = 200;

const ENTRY_RE = /^- \[\d{4}-\d{2}-\d{2}\] /;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const TARGET_RE = /^(projects|decisions|gotchas)\/([a-z0-9][a-z0-9_-]{0,47})\.md$/;

// 자격 증명처럼 보이는 문자열은 저장하지 않는다. 오탐이면 문장을 바꿔 다시 제안한다.
const SECRET_PATTERNS = [
  /password|passwd|비밀번호/i,
  /secret/i,
  /\btoken\b/i,
  /api[_ -]?key/i,
  /bearer\s+\S+/i,
  /\bsk-[A-Za-z0-9]{8,}/,
  /\bghp_[A-Za-z0-9]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** @param {string} root */
export function memoryDir(root) {
  return join(root, "memory");
}

/** @param {string} root */
export function queueFile(root) {
  return join(root, "queue", "proposals.json");
}

/** @param {string} root */
export function captureDir(root) {
  return join(root, "captures");
}

/** @param {string} text */
export function containsSecret(text) {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/**
 * @param {string} target
 * @returns {{ file: string, kind: "human"|"projects"|"decisions"|"gotchas" } | null}
 */
export function parseTarget(target) {
  if (target === "human.md") return { file: "human.md", kind: "human" };
  const m = TARGET_RE.exec(target);
  if (!m) return null;
  return { file: target, kind: m[1] };
}

/**
 * @param {{ target: unknown, text: unknown }} item
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateProposal(item) {
  if (typeof item.target !== "string" || !parseTarget(item.target)) {
    return { ok: false, reason: "target 형식 오류 (human.md | projects|decisions|gotchas/<name>.md)" };
  }
  if (typeof item.text !== "string" || !item.text.trim()) {
    return { ok: false, reason: "text 비어 있음" };
  }
  const text = item.text.trim();
  if (/[\r\n]/.test(text)) return { ok: false, reason: "text는 한 줄이어야 함" };
  if (text.length > MAX_ENTRY_CHARS) {
    return { ok: false, reason: `text ${MAX_ENTRY_CHARS}자 초과` };
  }
  if (containsSecret(text)) return { ok: false, reason: "민감정보로 보임 (저장 안 함)" };
  return { ok: true };
}

/**
 * 섹션마다 예산을 따로 둬서, 한 섹션이 길어도 다른 섹션이 밀려나지 않게 한다.
 * @param {string[]} entries
 * @param {number} budget
 */
function fitEntries(entries, budget) {
  const kept = [];
  let used = 0;
  for (const entry of entries) {
    if (used + entry.length + 1 > budget) break;
    kept.push(entry);
    used += entry.length + 1;
  }
  const omitted = entries.length - kept.length;
  if (omitted > 0) kept.push(`…(${omitted}개 생략)`);
  return kept;
}

/** @param {string} path */
function readEntries(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => ENTRY_RE.test(line));
}

/**
 * 승인된 메모리 항목을 역할 프롬프트 앞에 붙일 블록으로 만든다.
 * 항목이 없으면 빈 문자열을 돌려주므로 기존 프롬프트는 바뀌지 않는다.
 *
 * @param {{ root: string, shortRepo: string }} opts
 * @returns {string}
 */
export function buildMemoryContext({ root, shortRepo }) {
  const dir = memoryDir(root);
  if (!existsSync(dir)) return "";

  const sections = [];
  const human = readEntries(join(dir, "human.md")).slice(-20);
  if (human.length) sections.push(["## 사용자", fitEntries(human, SECTION_BUDGET)]);

  if (NAME_RE.test(shortRepo)) {
    const project = readEntries(join(dir, "projects", `${shortRepo}.md`));
    if (project.length) {
      sections.push([`## 프로젝트 (${shortRepo})`, fitEntries(project, SECTION_BUDGET)]);
    }
  }

  for (const kind of ["decisions", "gotchas"]) {
    const sub = join(dir, kind);
    if (!existsSync(sub)) continue;
    const entries = readdirSync(sub)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .flatMap((f) => readEntries(join(sub, f)));
    if (entries.length) {
      sections.push([`## ${kind === "decisions" ? "결정" : "함정"}`, fitEntries(entries, SECTION_BUDGET)]);
    }
  }

  if (!sections.length) return "";

  let body = "";
  for (const [title, entries] of sections) {
    body += `${title}\n${entries.join("\n")}\n\n`;
  }
  body = body.trimEnd();
  if (body.length > CONTEXT_BUDGET) {
    body = `${body.slice(0, CONTEXT_BUDGET).trimEnd()}\n…(생략)`;
  }

  return [
    "<memory>",
    "아래는 사람이 승인한 과거 기억이다. 참고만 하고, 현재 지시나 PLAN과 충돌하면 현재 지시를 따른다.",
    "",
    body,
    "</memory>",
  ].join("\n");
}

/**
 * @param {string} prompt
 * @param {string} context
 */
export function withMemoryContext(prompt, context) {
  return context ? `${context}\n\n${prompt}` : prompt;
}

/**
 * 파이프라인 완료 시 호출한다. 실패해도 파이프라인을 멈추지 않도록 호출부에서 감싼다.
 *
 * @param {{ root: string, shortRepo: string, slug: string, docsDir: string, runsDir: string, completedAt?: string }} opts
 * @returns {string} 캡처 파일 경로
 */
export function writeCapture({ root, shortRepo, slug, docsDir, runsDir, completedAt }) {
  const dir = captureDir(root);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${shortRepo}-${slug}.json`);
  const record = {
    version: 1,
    shortRepo,
    slug,
    docsDir,
    runsDir,
    completedAt: completedAt ?? new Date().toISOString(),
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/** @param {string} root */
function loadQueue(root) {
  const file = queueFile(root);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8"));
}

/** @param {string} root @param {unknown[]} queue */
function saveQueue(root, queue) {
  mkdirSync(join(root, "queue"), { recursive: true });
  writeFileSync(queueFile(root), `${JSON.stringify(queue, null, 2)}\n`);
}

/**
 * 큐에 후보를 넣는다. 잘못된 항목과 중복 항목은 거른다.
 *
 * @param {string} root
 * @param {{ shortRepo: string, slug: string, items: Array<{ target: string, text: string }> }} batch
 * @returns {{ added: object[], rejected: Array<{ item: object, reason: string }> }}
 */
export function addProposals(root, batch) {
  if (!NAME_RE.test(batch.shortRepo ?? "") || typeof batch.slug !== "string" || !batch.slug) {
    throw new Error("shortRepo/slug 형식 오류");
  }
  const queue = loadQueue(root);
  const added = [];
  const rejected = [];
  for (const raw of batch.items ?? []) {
    const check = validateProposal(raw);
    if (!check.ok) {
      rejected.push({ item: raw, reason: check.reason });
      continue;
    }
    const text = raw.text.trim();
    const dup = queue.some(
      (q) => q.target === raw.target && q.text === text && q.status !== "rejected",
    );
    if (dup) {
      rejected.push({ item: raw, reason: "이미 큐에 있음" });
      continue;
    }
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      shortRepo: batch.shortRepo,
      slug: batch.slug,
      target: raw.target,
      text,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    queue.push(entry);
    added.push(entry);
  }
  saveQueue(root, queue);
  return { added, rejected };
}

/** @param {string} root */
export function listPending(root) {
  return loadQueue(root).filter((q) => q.status === "pending");
}

/**
 * 승인된 후보를 메모리 파일에 한 줄로 추가한다.
 *
 * @param {string} root
 * @param {string} id
 * @param {{ today?: string }} [opts]
 * @returns {{ ok: boolean, message: string }}
 */
export function approveProposal(root, id, opts = {}) {
  const queue = loadQueue(root);
  const item = queue.find((q) => q.id === id);
  if (!item) return { ok: false, message: `없는 id: ${id}` };
  if (item.status !== "pending") return { ok: false, message: `이미 ${item.status}: ${id}` };

  const check = validateProposal(item);
  if (!check.ok) return { ok: false, message: check.reason };

  const dir = memoryDir(root);
  const parsed = parseTarget(item.target);
  const path = join(dir, parsed.file);
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  let existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (existing === null) {
    if (parsed.kind === "human") {
      return { ok: false, message: "human.md가 없습니다. 볼트 메모리 디렉터리를 먼저 확인하세요." };
    }
    const stem = parsed.file.replace(/\.md$/, "");
    mkdirSync(join(dir, parsed.kind), { recursive: true });
    existing = `---\ntype: ${parsed.kind}\nname: ${stem.split("/")[1]}\n---\n\n# ${stem.split("/")[1]}\n\n`;
    writeFileSync(path, existing);
    addIndexLink(dir, stem);
  }

  if (existing.includes("(아직 기록 없음)")) {
    existing = existing.replace(/^\(아직 기록 없음\)\n?/m, "");
    writeFileSync(path, existing);
  }

  const alreadyThere = existing.split("\n").some((line) => line.includes(`] ${item.text} `) || line.endsWith(`] ${item.text}`));
  if (!alreadyThere) {
    const src = `${item.shortRepo}/${item.slug}`;
    const line = `- [${today}] ${item.text} <!-- src: ${src} -->`;
    const prefix = existing.endsWith("\n") ? "" : "\n";
    appendFileSync(path, `${prefix}${line}\n`);
  }

  item.status = "approved";
  item.decidedAt = new Date().toISOString();
  saveQueue(root, queue);
  return { ok: true, message: alreadyThere ? `이미 있음, 상태만 승인: ${parsed.file}` : `저장: ${parsed.file}` };
}

/** @param {string} dir @param {string} stem */
function addIndexLink(dir, stem) {
  const index = join(dir, "index.md");
  if (!existsSync(index)) return;
  const text = readFileSync(index, "utf8");
  const link = `[[${stem}]]`;
  if (text.includes(link)) return;
  appendFileSync(index, `- ${link}\n`);
}

/**
 * @param {string} root
 * @param {string} id
 * @returns {{ ok: boolean, message: string }}
 */
export function rejectProposal(root, id) {
  const queue = loadQueue(root);
  const item = queue.find((q) => q.id === id);
  if (!item) return { ok: false, message: `없는 id: ${id}` };
  if (item.status !== "pending") return { ok: false, message: `이미 ${item.status}: ${id}` };
  item.status = "rejected";
  item.decidedAt = new Date().toISOString();
  saveQueue(root, queue);
  return { ok: true, message: `거절: ${id}` };
}

/** @param {string} root */
export function auditFile(root) {
  return join(root, "audit.jsonl");
}

/**
 * 자동 저장 기록을 감사 로그에 한 줄씩 남긴다. 되돌리기와 점검에 쓴다.
 * @param {string} root
 * @param {object} entry
 */
export function appendAudit(root, entry) {
  mkdirSync(root, { recursive: true });
  appendFileSync(auditFile(root), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/**
 * 메모리 디렉터리가 속한 git 저장소(볼트)에 변경을 커밋한다. 저장소가 아니면 건너뛴다.
 * 전역 commit.template(EWP 형식)을 피하려고 -c commit.template= 를 붙인다.
 *
 * @param {string} dir memory 디렉터리
 * @param {string} message
 * @returns {{ committed: boolean, reason?: string }}
 */
export function commitMemoryChange(dir, message) {
  const runGit = (cwd, args) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  // 메모리 폴더는 볼트로 가는 심볼릭 링크일 수 있다. git 경로는 실제 경로 기준으로 맞춘다.
  let real;
  let top;
  try {
    real = realpathSync(dir);
    top = runGit(real, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return { committed: false, reason: "git 저장소 아님" };
  }
  const rel = relative(top, real) || ".";
  try {
    runGit(top, ["add", "--", rel]);
    const staged = runGit(top, ["diff", "--cached", "--name-only", "--", rel]).trim();
    if (!staged) return { committed: false, reason: "변경 없음" };
    runGit(top, ["-c", "commit.template=", "commit", "-q", "-m", message, "--", rel]);
    return { committed: true };
  } catch (err) {
    return { committed: false, reason: `커밋 실패: ${err.message.split("\n")[0]}` };
  }
}

/**
 * 후보를 검증해 바로 저장한다. 사용자 승인 단계를 거치지 않는다.
 * 저장한 항목은 감사 로그에 남기고, 볼트 git에 한 커밋으로 묶는다.
 *
 * @param {string} root
 * @param {{ shortRepo: string, slug: string, items: Array<{ target: string, text: string }> }} batch
 * @param {{ maxItems?: number, commit?: boolean }} [opts]
 * @returns {{ saved: object[], rejected: Array<{ item: object, reason: string }>, commit: object | null }}
 */
export function autoSave(root, batch, opts = {}) {
  const maxItems = opts.maxItems ?? 5;
  const items = (batch.items ?? []).slice(0, maxItems);
  const { added, rejected: preRejected } = addProposals(root, { ...batch, items });
  const rejected = [...preRejected];
  for (const r of preRejected) {
    appendAudit(root, { action: "rejected", target: r.item.target, text: r.item.text, reason: r.reason });
  }
  const saved = [];
  for (const entry of added) {
    const r = approveProposal(root, entry.id);
    if (r.ok) {
      saved.push({ ...entry, status: "approved", message: r.message });
      appendAudit(root, { action: "auto-save", id: entry.id, target: entry.target, text: entry.text, src: `${entry.shortRepo}/${entry.slug}` });
    } else {
      rejected.push({ item: entry, reason: r.message });
      appendAudit(root, { action: "auto-reject", id: entry.id, target: entry.target, reason: r.message });
    }
  }
  let commit = null;
  if (saved.length && opts.commit !== false) {
    commit = commitMemoryChange(
      memoryDir(root),
      `memory: ${batch.shortRepo}/${batch.slug} 자동 저장 ${saved.length}건`,
    );
  }
  return { saved, rejected, commit };
}

// ---- CLI ----

function runCli(argv) {
  const root = getWorkflowRoot();
  const [cmd, arg] = argv;

  if (cmd === "list") {
    const pending = listPending(root);
    if (!pending.length) {
      console.log("대기 중인 메모리 후보가 없습니다.");
      return 0;
    }
    for (const q of pending) {
      console.log(`${q.id}  ${q.target}  ${q.text}  (${q.shortRepo}/${q.slug})`);
    }
    return 0;
  }

  if (cmd === "propose") {
    const auto = argv.includes("--auto");
    const file = argv.slice(1).find((a) => a !== "--auto");
    if (!file) {
      console.error("Usage: node scripts/memory.mjs propose [--auto] <file.json>");
      return 2;
    }
    const batch = JSON.parse(readFileSync(file, "utf8"));
    if (auto) {
      const { saved, rejected, commit } = autoSave(root, batch);
      console.log(`자동 저장: ${saved.length}, 거절: ${rejected.length}`);
      for (const s of saved) console.log(`  + ${s.target}: ${s.text}`);
      for (const r of rejected) console.log(`  - 거절 (${r.reason}): ${r.item.text ?? ""}`);
      if (commit) console.log(commit.committed ? "볼트 커밋 완료" : `볼트 커밋 생략: ${commit.reason}`);
      return 0;
    }
    const { added, rejected } = addProposals(root, batch);
    console.log(`큐에 추가: ${added.length}, 거절: ${rejected.length}`);
    for (const r of rejected) console.log(`  - 거절 (${r.reason}): ${r.item.text ?? ""}`);
    return 0;
  }

  if (cmd === "approve" || cmd === "reject") {
    if (!arg) {
      console.error(`Usage: node scripts/memory.mjs ${cmd} <id>`);
      return 2;
    }
    const result = cmd === "approve" ? approveProposal(root, arg) : rejectProposal(root, arg);
    console.log(result.message);
    return result.ok ? 0 : 1;
  }

  if (cmd === "context") {
    if (!arg) {
      console.error("Usage: node scripts/memory.mjs context <shortRepo>");
      return 2;
    }
    const ctx = buildMemoryContext({ root, shortRepo: arg });
    console.log(ctx || "(주입할 메모리 없음)");
    return 0;
  }

  if (cmd === "repo") {
    if (!arg) {
      console.error("Usage: node scripts/memory.mjs repo <repoPath>");
      return 2;
    }
    console.log(getShortRepo(arg));
    return 0;
  }

  console.error("Usage: node scripts/memory.mjs list|propose <file>|approve <id>|reject <id>|context <shortRepo>|repo <repoPath>");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runCli(process.argv.slice(2));
}
