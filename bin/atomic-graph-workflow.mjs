#!/usr/bin/env node
import { runInstallCli } from "../scripts/install-cli.mjs";

runInstallCli(process.argv.slice(2)).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
