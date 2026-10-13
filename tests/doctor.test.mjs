import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { parseDoctorArgs, checkSingleHarness } from "../scripts/doctor.mjs";
import { install } from "../scripts/install.mjs";

test("parseDoctorArgs accepts --with-claude", () => {
  const opts = parseDoctorArgs(["--harness", "all", "--with-claude", "--target", "/tmp/x"]);
  assert.equal(opts.withClaude, true);
  assert.equal(opts.harness, "all");
  assert.equal(opts.cwd, "/tmp/x");
});

test("doctor requires AGENTS.md atomic marker block", async () => {
  const target = await mkdtemp(join(tmpdir(), "doctor-agents-md-"));
  try {
    await mkdir(join(target, ".cursor"), { recursive: true });
    await install({ root: ".", target, harness: "cursor", force: true, quiet: true });
    let report = await checkSingleHarness("cursor", target, ".");
    assert.equal(report.ok, true, report.problems.join("\n"));

    await writeFile(join(target, "AGENTS.md"), "# no atomic block\n", "utf8");
    report = await checkSingleHarness("cursor", target, ".");
    assert.equal(report.ok, false);
    assert.match(report.problems.join("\n"), /AGENTS\.md/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
