const BEGIN_PREFIX = "<!-- atomic:begin";
const END = "<!-- atomic:end -->";

/** @param {string} body */
function wrapBlock(body) {
  return `${BEGIN_PREFIX} -->\n${body}\n${END}`;
}

function findBegin(text) {
  const idx = text.indexOf(BEGIN_PREFIX);
  if (idx === -1) return null;
  const endTag = text.indexOf("-->", idx);
  if (endTag === -1) return null;
  return { start: idx, end: endTag + 3 };
}

/** @param {string} text @param {string} needle */
function countBeginMarkers(text) {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(BEGIN_PREFIX, pos)) !== -1) {
    count++;
    pos += BEGIN_PREFIX.length;
  }
  return count;
}

function countOccurrences(text, needle) {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * @param {string} text
 * @returns {{ start: number, end: number, body: string, beginEnd: number } | null}
 */
function findWellFormedBlock(text) {
  const begin = findBegin(text);
  if (!begin) return null;

  const afterBegin = begin.end;
  if (text.charAt(afterBegin) !== "\n") {
    return null;
  }

  const endIdx = text.indexOf(END, afterBegin + 1);
  if (endIdx === -1) {
    return null;
  }

  if (text.charAt(endIdx - 1) !== "\n") {
    return null;
  }

  const body = text.slice(afterBegin + 1, endIdx - 1);
  const blockStart = begin.start;
  const blockEnd = endIdx + END.length;

  const before = text.slice(0, blockStart);
  const after = text.slice(blockEnd);
  if (
    countBeginMarkers(before) > 0 ||
    countOccurrences(before, END) > 0 ||
    countBeginMarkers(after) > 0 ||
    countOccurrences(after, END) > 0
  ) {
    return null;
  }

  return { start: blockStart, end: blockEnd, body, beginEnd: begin.end };
}

function assertMarkerConsistency(text) {
  const beginCount = countBeginMarkers(text);
  const endCount = countOccurrences(text, END);

  if (beginCount === 0 && endCount === 0) {
    return { kind: "none" };
  }

  if (beginCount !== 1 || endCount !== 1) {
    throw new Error("mismatched atomic workflow markers");
  }

  const block = findWellFormedBlock(text);
  if (!block) {
    throw new Error("mismatched atomic workflow markers");
  }

  return { kind: "one", block };
}

function firstBlankLineInsertion(text) {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) {
    return null;
  }
  if (lf === -1) {
    return { insertAt: crlf + 4, trailingSep: "\r\n\r\n" };
  }
  if (crlf === -1) {
    return { insertAt: lf + 2, trailingSep: "\n\n" };
  }
  if (lf < crlf) {
    return { insertAt: lf + 2, trailingSep: "\n\n" };
  }
  return { insertAt: crlf + 4, trailingSep: "\r\n\r\n" };
}

/** @param {string} text @param {string} body */
export function upsertBlock(text, body) {
  if (text === "") {
    return wrapBlock(body);
  }

  const state = assertMarkerConsistency(text);

  if (state.kind === "one") {
    const { block } = state;
    const newBlock = wrapBlock(body);
    return text.slice(0, block.start) + newBlock + text.slice(block.end);
  }

  const newBlock = wrapBlock(body);
  const blank = firstBlankLineInsertion(text);
  if (blank === null) {
    return `${newBlock}\n\n${text}`;
  }

  const { insertAt, trailingSep } = blank;
  return `${text.slice(0, insertAt)}${newBlock}${trailingSep}${text.slice(insertAt)}`;
}

/** @param {string} text */
export function removeBlock(text) {
  const state = assertMarkerConsistency(text);

  if (state.kind === "none") {
    return text;
  }

  const { block } = state;
  let start = block.start;
  let end = block.end;

  if (text.slice(end, end + 4) === "\r\n\r\n") {
    end += 4;
  } else if (text.slice(end, end + 2) === "\n\n") {
    end += 2;
  }

  return text.slice(0, start) + text.slice(end);
}

/** @param {string} text */
export function hasBlock(text) {
  const beginCount = countBeginMarkers(text);
  const endCount = countOccurrences(text, END);
  if (beginCount !== 1 || endCount !== 1) {
    return false;
  }
  return findWellFormedBlock(text) !== null;
}
