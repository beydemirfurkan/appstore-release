// Text from other people — customer reviews, tester feedback, crash logs —
// printed to a terminal. Control characters are dropped: an escape sequence in
// a review could otherwise move the cursor, hide lines, or write the clipboard.

/** C0 and C1 controls and DEL, except newline and tab. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/**
 * @param {unknown} text
 * @param {{ keepNewlines?: boolean }} [options]  keep \n and \t (logs); otherwise all whitespace becomes one space
 */
export function printable(text, { keepNewlines = false } = {}) {
  const clean = String(text ?? "").replace(CONTROL, "");
  return keepNewlines ? clean : clean.replace(/\s+/g, " ");
}
