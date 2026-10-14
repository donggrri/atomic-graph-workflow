import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test(
  "multiselect works after readline text() (pty)",
  { skip: process.env.CI === "true" && !process.env.RUN_PTY_TESTS },
  async () => {
    let pty;
    try {
      pty = await import("node-pty");
    } catch {
      return test.skip("node-pty not installed");
    }

    const script = `
import { text, multiselect, isInteractiveTTY } from "./scripts/lib/prompt.mjs";
if (!isInteractiveTTY()) process.exit(2);
await text("folder", "/tmp");
const picked = await multiselect("harness", [
  { value: "cursor", label: "Cursor", selected: true },
  { value: "agy", label: "AGY" },
]);
console.log("PICKED:" + picked.join(","));
`;

    const child = pty.spawn(process.execPath, ["--input-type=module", "-e", script], {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd: root,
      env: process.env,
    });

    let out = "";
    child.onData((data) => {
      out += data;
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("pty multiselect timed out"));
      }, 15000);
      const onData = (data) => {
        if (data.includes("folder")) {
          child.write("\r");
        }
        if (data.includes("harness") || data.includes("Cursor")) {
          setTimeout(() => child.write("\r"), 200);
        }
        if (out.includes("PICKED:")) {
          clearTimeout(timer);
          child.kill();
          resolve();
        }
      };
      child.onData(onData);
      child.onExit(({ exitCode }) => {
        if (out.includes("PICKED:")) return;
        clearTimeout(timer);
        if (exitCode !== 0) reject(new Error(`exit ${exitCode}: ${out}`));
        else resolve();
      });
    });

    assert.match(out, /PICKED:cursor/);
  },
);
