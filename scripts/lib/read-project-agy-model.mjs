#!/usr/bin/env node
import { loadWorkflowSettings } from "./workflow-settings.mjs";
import { resolveAgyModel } from "../resolve-agy-model.mjs";

const repoRoot = process.argv[2] ?? process.cwd();
const loaded = loadWorkflowSettings({ repoRoot });
if (!loaded.ok || !loaded.agyModel) process.exit(0);
process.stdout.write(resolveAgyModel(loaded.agyModel));
