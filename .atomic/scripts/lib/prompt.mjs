import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

/** @returns {boolean} */
export function isInteractiveTTY() {
  return Boolean(input.isTTY && output.isTTY && !process.env.CI);
}

function createRl() {
  return readline.createInterface({ input, output, terminal: true });
}

/**
 * @param {string} message
 * @param {{ default?: boolean }} [options]
 */
export async function confirm(message, options = {}) {
  const def = options.default !== false;
  if (!isInteractiveTTY()) return def;
  const hint = def ? "Y/n" : "y/N";
  const rl = createRl();
  const answer = await new Promise((resolve) => {
    rl.question(`${message} (${hint}) `, (line) => {
      rl.close();
      resolve((line ?? "").trim().toLowerCase());
    });
  });
  if (!answer) return def;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return def;
}

/**
 * @param {string} message
 * @param {string} [defaultValue]
 */
export async function text(message, defaultValue = "") {
  if (!isInteractiveTTY()) return defaultValue;
  const rl = createRl();
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await new Promise((resolve) => {
    rl.question(`${message}${suffix}: `, (line) => {
      rl.close();
      resolve((line ?? "").trim());
    });
  });
  return answer || defaultValue;
}

/**
 * @param {string} message
 * @param {Array<{ value: string, label: string, hint?: string, selected?: boolean }>} choices
 */
export async function multiselect(message, choices) {
  if (!choices.length) return [];
  if (!isInteractiveTTY()) {
    return choices.filter((c) => c.selected).map((c) => c.value);
  }
  const state = choices.map((c) => ({ ...c, on: Boolean(c.selected) }));
  let cursor = Math.max(0, state.findIndex((c) => c.selected));
  const render = () => {
    if (typeof console.clear === "function") console.clear();
    output.write(`\n${message}\n`);
    output.write("  ↑/↓: 이동 · 스페이스: 선택/해제 · Enter: 확인\n\n");
    for (let i = 0; i < state.length; i++) {
      const c = state[i];
      const box = c.on ? "◼" : "◻";
      const hint = c.hint ? `  ${c.hint}` : "";
      const pointer = i === cursor ? "›" : " ";
      output.write(` ${pointer} ${box} ${c.label}${hint}\n`);
    }
  };
  render();
  return new Promise((resolve) => {
    readline.emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    const onKey = (_str, key) => {
      if (!key) return;
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        const picked = state.filter((c) => c.on).map((c) => c.value);
        resolve(picked.length ? picked : [state[cursor].value]);
        return;
      }
      if (key.name === "space") {
        state[cursor].on = !state[cursor].on;
        render();
        return;
      }
      if (key.name === "up") {
        cursor = cursor <= 0 ? state.length - 1 : cursor - 1;
        render();
        return;
      }
      if (key.name === "down") {
        cursor = cursor >= state.length - 1 ? 0 : cursor + 1;
        render();
        return;
      }
      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }
    };
    const cleanup = () => {
      input.off("keypress", onKey);
      if (input.isTTY) input.setRawMode(false);
    };
    input.on("keypress", onKey);
  });
}

/**
 * @param {string} message
 * @param {Array<{ value: string, label: string }>} choices
 * @param {string} [defaultValue]
 */
export async function select(message, choices, defaultValue) {
  if (!isInteractiveTTY()) {
    const hit = choices.find((c) => c.value === defaultValue);
    return hit?.value ?? choices[0]?.value;
  }
  output.write(`\n${message}\n`);
  for (let i = 0; i < choices.length; i++) {
    output.write(`  ${i + 1}. ${choices[i].label}\n`);
  }
  const def = defaultValue ?? choices[0]?.value;
  const rl = createRl();
  const answer = await new Promise((resolve) => {
    rl.question(`번호 (기본 ${def}): `, (line) => {
      rl.close();
      resolve((line ?? "").trim());
    });
  });
  if (!answer) return def;
  const num = Number.parseInt(answer, 10);
  if (num >= 1 && num <= choices.length) return choices[num - 1].value;
  const byValue = choices.find((c) => c.value === answer);
  return byValue?.value ?? def;
}
