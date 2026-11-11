// Decisions waiting on Douglas, read from the "Waiting on Douglas" section of
// docs/ROADMAP.md so the Dashboard shows them without a second list to keep.
// Display only: nothing here changes a rule.

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const DATE_RE = new RegExp(`\\((\\d{1,2} (?:${MONTHS}))(?:[^)]*)\\)`);

// Plain text of a markdown fragment (for the gist and tests).
export function plain(md) {
  return String(md ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// First sentence, cut at a word boundary if long.
export function firstSentence(text, max = 170) {
  const t = plain(text);
  const m = t.match(/^(.+?[.?!])(\s|$)/);
  let s = m ? m[1] : t;
  if (s.length > max) s = s.slice(0, s.lastIndexOf(" ", max - 1)).replace(/[,;:]$/, "") + "…";
  return s;
}

// The "## Waiting on Douglas" bullets as { title, date, gist, body, kind }.
// kind: "decision" when it asks for an OK or a choice, else "task".
export function parseDecisions(md) {
  const lines = String(md ?? "").split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Waiting on Douglas\b/i.test(l));
  if (start < 0) return [];
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,2}\s/.test(l)) break;
    if (/^- /.test(l)) items.push(l.slice(2).trim());
    else if (/^\s+\S/.test(l) && items.length) items[items.length - 1] += " " + l.trim();
  }
  return items.filter(Boolean).map((raw) => {
    let title, rest;
    const bold = raw.match(/^\*\*(.+?)\*\*[\s:.]*(.*)$/);
    if (bold) { title = bold[1]; rest = bold[2]; }
    else {
      const s = firstSentence(raw, 400);
      title = s.replace(/…$/, "");
      rest = plain(raw).slice(title.length).trim();
    }
    const dm = title.match(DATE_RE) || raw.match(DATE_RE);
    const date = dm ? dm[1] : null;
    title = plain(title.replace(DATE_RE, "")).replace(/\s+([?:.,])/g, "$1").replace(/[:.]$/, "").replace(/^His\b/, "Your").trim();
    const all = plain(raw);
    const kind = /\?|\bOK\b|\bor keep\b|\bwhether\b/i.test(all) ? "decision" : "task";
    rest = rest.replace(/^[a-z]/, (c) => c.toUpperCase());
    return { title, date, gist: rest ? firstSentence(rest) : "", body: rest, kind };
  });
}

// Summary line, e.g. "6 decisions and 2 tasks waiting on you".
export function decisionsLine(items) {
  const d = items.filter((x) => x.kind === "decision").length;
  const t = items.length - d;
  if (!items.length) return "Nothing waiting on you";
  const part = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [d && part(d, "decision"), t && part(t, "task")].filter(Boolean).join(" and ") + " waiting on you";
}

// Inline markdown to safe HTML (bold, italic, code), for the expanded text.
export function inlineHtml(md, esc) {
  return esc(String(md ?? ""))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
