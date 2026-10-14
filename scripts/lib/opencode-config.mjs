import { copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const OPENCODE_CONFIG_FILE = "opencode.json";
export const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";

/**
 * opencode.json permission key for a workflow home directory.
 * @param {string} workflowHome
 */
export function externalDirectoryKey(workflowHome) {
  const trimmed = String(workflowHome ?? "").trim().replace(/\/+$/, "");
  return `${trimmed}/**`;
}

/**
 * Builds the opencode.json body that grants headless access to the workflow home.
 * @param {string} workflowHome
 */
export function buildOpencodeConfig(workflowHome) {
  return {
    $schema: OPENCODE_CONFIG_SCHEMA,
    permission: {
      external_directory: {
        [externalDirectoryKey(workflowHome)]: "allow",
      },
    },
  };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function serialize(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Merges the workflow-home permission entry into an existing opencode.json.
 * Existing keys and permission entries are preserved; the entry is only added
 * when missing.
 * @param {string} existingText current opencode.json contents ("" when absent)
 * @param {string} workflowHome
 * @returns {{ config: Record<string, unknown>, text: string, added: boolean, changed: boolean }}
 */
export function mergeOpencodeConfig(existingText, workflowHome) {
  /** @type {Record<string, unknown>} */
  let config = {};
  if (existingText && existingText.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(existingText);
    } catch (err) {
      throw new Error(
        `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!isPlainObject(parsed)) {
      throw new Error("root must be a JSON object");
    }
    config = parsed;
  }

  const key = externalDirectoryKey(workflowHome);
  const priorPermission = isPlainObject(config.permission) ? config.permission : {};
  const priorExternal = isPlainObject(priorPermission.external_directory)
    ? priorPermission.external_directory
    : {};
  const added = !Object.prototype.hasOwnProperty.call(priorExternal, key);

  // Preserve the existing key order; only fill in $schema when it is missing.
  let next = {
    ...config,
    permission: {
      ...priorPermission,
      external_directory: { ...priorExternal, [key]: "allow" },
    },
  };
  if (typeof next.$schema !== "string" || !next.$schema.trim()) {
    delete next.$schema;
    next = { $schema: OPENCODE_CONFIG_SCHEMA, ...next };
  }

  const text = serialize(next);
  return { config: next, text, added, changed: added || serialize(config) !== text };
}

/**
 * Creates or merges the project opencode.json for headless runs.
 * @param {string} target project root
 * @param {string} workflowHome
 * @param {{ copied: string[], overwritten: string[], skipped: string[] }} record
 * @returns {Promise<string>} path to opencode.json
 */
export async function installOpencodeConfig(target, workflowHome, record) {
  const dest = join(target, OPENCODE_CONFIG_FILE);
  const existed = existsSync(dest);
  let existing = "";
  if (existed) {
    existing = await readFile(dest, "utf8");
  }

  let merged;
  try {
    merged = mergeOpencodeConfig(existing, workflowHome);
  } catch (err) {
    const backup = `${dest}.invalid-${Date.now()}.bak`;
    await copyFile(dest, backup);
    console.warn(`warning: ${OPENCODE_CONFIG_FILE} unreadable (${err.message}); backup: ${backup}`);
    merged = mergeOpencodeConfig("", workflowHome);
  }

  if (existed && !merged.changed) {
    record.skipped.push(dest);
    return dest;
  }
  await writeFile(dest, merged.text, "utf8");
  record[existed ? "overwritten" : "copied"].push(dest);
  return dest;
}
