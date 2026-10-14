import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getWorkflowRoot } from "../work-status.mjs";
import { confirm, isInteractiveTTY } from "./prompt.mjs";

const TRUST_FILE = "trusted-commands.json";

function trustPath(workflowHome) {
  return join(workflowHome, TRUST_FILE);
}

function hashCommand(command) {
  return createHash("sha256").update(command, "utf8").digest("hex");
}

/**
 * @param {string} workflowHome
 * @returns {Set<string>}
 */
function loadTrusted(workflowHome) {
  const path = trustPath(workflowHome);
  if (!existsSync(path)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(raw?.hashes)) return new Set(raw.hashes);
  } catch {
    // ignore
  }
  return new Set();
}

function saveTrusted(workflowHome, hashes) {
  const dir = workflowHome;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    trustPath(workflowHome),
    JSON.stringify({ hashes: [...hashes].sort() }, null, 2) + "\n",
    "utf8",
  );
}

/**
 * @param {string} command
 * @param {{ workflowHome?: string, nonInteractive?: boolean }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function ensureCommandTrusted(command, options = {}) {
  const cmd = String(command ?? "").trim();
  if (!cmd) return { ok: true };
  if (process.env.CURSOR_ATOMIC_TRUST_COMMANDS === "1") return { ok: true };

  const workflowHome = options.workflowHome ?? getWorkflowRoot();
  const hashes = loadTrusted(workflowHome);
  const digest = hashCommand(cmd);
  if (hashes.has(digest)) return { ok: true };

  const nonInteractive = options.nonInteractive ?? !isInteractiveTTY();
  if (nonInteractive) {
    return {
      ok: false,
      reason: `신뢰되지 않은 shell 명령입니다. 먼저 확인하세요: ${cmd}\n` +
        `  (한 번 신뢰: CURSOR_ATOMIC_TRUST_COMMANDS=1 또는 대화형에서 승인)`,
    };
  }

  const ok = await confirm(`다음 명령을 실행할까요?\n  ${cmd}\n`, { default: false });
  if (!ok) {
    return { ok: false, reason: "사용자가 명령 실행을 거부했습니다." };
  }
  hashes.add(digest);
  saveTrusted(workflowHome, hashes);
  return { ok: true };
}
