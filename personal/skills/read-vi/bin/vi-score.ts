import { resolve } from "node:path";

/** ≤1 hit trên mỗi 1000 từ, hoặc ≤1 hit cho cả bài nếu bài ngắn hơn 1000 từ → 9 điểm. */
const B1_WORD_SCALE = 1000;
const CLOSE_DELTA_PERCENT = 10;
const DEFAULT_CONVENTIONS = resolve(import.meta.dir, "../references/vi-conventions.md");
const COMMON_ABBREVIATIONS = ["v.v.", "tp.", "mr.", "vs.", "etc.", "i.e.", "e.g."];

type PreparedLine = {
  number: number;
  text: string;
};

type B1Pattern = {
  display: string;
  parts: string[];
  sentenceStart: boolean;
};

type B1SkipReason = "cụm quá ngắn/phổ thông" | "thuần ASCII" | "có placeholder <>" | "§B1-skip (người quyết)";

type B1ExcludedRow = {
  row: number;
  source: string;
  reason: B1SkipReason;
};

type B1Row = {
  number: number;
  source: string;
  patterns: B1Pattern[];
};

type B1Hit = {
  row: number;
  pattern: string;
  line: number;
  text: string;
};

type B1Duplicate = {
  rows: number[];
  line: number;
  text: string;
};

type B1Report = {
  command: "b1";
  file: string;
  tableRows: number;
  scannableRows: number;
  exampleOnlyRows: number;
  exampleOnly: B1ExcludedRow[];
  exclusionCounts: Record<B1SkipReason, number>;
  words: number;
  hits: B1Hit[];
  duplicates: B1Duplicate[];
  densityPer1000Words: number;
  scoringWords: number;
  scoringDensityPer1000Words: number;
  score: number;
};

type C1Item = {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  hits?: number;
  lines?: number[];
  detail?: string;
  counts?: Record<string, number>;
};

type C1Report = {
  command: "c1";
  file: string;
  b1Coverage: {
    tableRows: number;
    scannableRows: number;
    exampleOnlyRows: number;
    exampleOnly: B1ExcludedRow[];
    exclusionCounts: Record<B1SkipReason, number>;
  };
  items: C1Item[];
};

type DeltaReport = {
  command: "delta";
  before: string;
  after: string;
  beforeSentences: number;
  afterSentences: number;
  changed: number;
  ratio: number;
  percent: number;
  thresholdPercent: number;
  closed: boolean;
};

function fail(message: string): never {
  process.stderr.write(`vi-score: ${message}\n`);
  process.exit(1);
}

async function readRequiredFile(path: string, label: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) fail(`không tìm thấy ${label}: ${path}`);
  try {
    return await file.text();
  } catch (error) {
    fail(`không đọc được ${label} ${path}: ${String(error)}`);
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function removeInlineCode(text: string): string {
  return text.replace(/`+[^`]*`+/gu, "");
}

function prepareText(source: string): PreparedLine[] {
  const sourceLines = source.split(/\r?\n/u);
  const withoutCode: PreparedLine[] = [];
  let inFence = false;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const text = sourceLines[index] ?? "";
    if (/^\s*```/u.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) withoutCode.push({ number: index + 1, text: removeInlineCode(text) });
  }

  const firstContentIndex = withoutCode.findIndex((line) => line.text.trim().length > 0);
  const removedIndexes = new Set<number>();
  if (firstContentIndex >= 0 && /^#\s+\S/u.test(withoutCode[firstContentIndex]?.text.trim() ?? "")) {
    let metadataStart = firstContentIndex + 1;
    while (metadataStart < withoutCode.length && withoutCode[metadataStart]?.text.trim() === "") metadataStart += 1;
    if (/^>/u.test(withoutCode[metadataStart]?.text.trim() ?? "")) {
      removedIndexes.add(firstContentIndex);
      for (let index = metadataStart; index < withoutCode.length; index += 1) {
        if (!/^>/u.test(withoutCode[index]?.text.trim() ?? "")) break;
        removedIndexes.add(index);
      }
    }
  }

  return withoutCode
    .filter((_, index) => !removedIndexes.has(index))
    .map((line) => ({ ...line, text: normalizeWhitespace(line.text) }));
}

function proseWordCount(lines: PreparedLine[]): number {
  const withoutUrls = lines.map((line) => line.text).join(" ").replace(/https?:\/\/\S+/giu, " ");
  return withoutUrls
    .split(/\s+/u)
    .filter(Boolean)
    .filter((token) => !/^[#>*|\-]+$/u.test(token)).length;
}

function splitMarkdownRow(line: string, cellCount: number): string[] | null {
  if (!/^\| \d+ \|/u.test(line)) return null;
  const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
  return cells.length === cellCount ? cells : null;
}

function usablePattern(part: string): boolean {
  const tokens = normalizeWhitespace(part).split(" ").filter(Boolean);
  return tokens.length >= 2 || (tokens.length === 1 && [...(tokens[0] ?? "")].length >= 6);
}

function pattern(part: string): B1Pattern {
  return { display: part, parts: [part], sentenceStart: /^\p{Lu}/u.test(part) };
}

function extractVariantPatterns(variant: string): { patterns: B1Pattern[]; reason?: B1SkipReason } {
  if (/<[^>]*>/u.test(variant)) return { patterns: [], reason: "có placeholder <>" };
  const boldMatches = [...variant.matchAll(/\*\*(.+?)\*\*/gu)];
  if (boldMatches.length === 0) {
    const part = normalizeWhitespace(variant.replace(/…\s*$/u, ""));
    return part && usablePattern(part)
      ? { patterns: [pattern(part)] }
      : { patterns: [], reason: "cụm quá ngắn/phổ thông" };
  }

  const parts = boldMatches.map((match) => normalizeWhitespace(match[1] ?? ""));
  if (parts.some((part) => /^[\x00-\x7F]*$/u.test(part))) return { patterns: [], reason: "thuần ASCII" };
  const alternatives = boldMatches.slice(0, -1).every((match, index) => {
    const next = boldMatches[index + 1];
    const separator = variant.slice((match.index ?? 0) + match[0].length, next?.index ?? variant.length);
    return /^[\s…]*$/u.test(separator);
  });
  if (alternatives) {
    const patterns = parts
      .filter((part) => part.length > 0 && usablePattern(part))
      .map(pattern);
    return patterns.length > 0
      ? { patterns }
      : { patterns: [], reason: "cụm quá ngắn/phổ thông" };
  }
  if (parts.some((part) => part.length === 0 || !usablePattern(part))) {
    return { patterns: [], reason: "cụm quá ngắn/phổ thông" };
  }
  return { patterns: [{ display: parts.join(" … "), parts, sentenceStart: /^\p{Lu}/u.test(parts[0] ?? "") }] };
}

function markdownSection(conventions: string, heading: RegExp, label: string): string {
  const headingIndex = conventions.search(heading);
  if (headingIndex < 0) fail(`không tìm thấy heading \`${label}\` trong vi-conventions.md`);
  const sectionStart = conventions.indexOf("\n", headingIndex) + 1;
  const nextHeadingOffset = conventions.slice(sectionStart).search(/^### /mu);
  const sectionEnd = nextHeadingOffset < 0 ? conventions.length : sectionStart + nextHeadingOffset;
  return conventions.slice(sectionStart, sectionEnd);
}

function parseB1SkipRows(conventions: string): Set<number> {
  const section = markdownSection(conventions, /^### §B1-skip\. Dòng không máy hoá được — do người quyết\s*$/mu, "### §B1-skip. Dòng không máy hoá được — do người quyết");
  const rows = new Set<number>();
  for (const line of section.split(/\r?\n/u)) {
    const cells = splitMarkdownRow(line, 3);
    if (cells) rows.add(Number(cells[0]));
  }
  return rows;
}

function parseB1Rows(conventions: string): { rows: B1Row[]; excluded: B1ExcludedRow[] } {
  const section = markdownSection(conventions, /^### §B1\. Bảng chính\s*$/mu, "### §B1. Bảng chính");
  const skipRows = parseB1SkipRows(conventions);
  const rows: B1Row[] = [];
  const excluded: B1ExcludedRow[] = [];
  for (const line of section.split(/\r?\n/u)) {
    const cells = splitMarkdownRow(line, 4);
    if (!cells) continue;
    const number = Number(cells[0]);
    const source = cells[1] ?? "";
    const variants = source
      .split("·")
      .map(extractVariantPatterns);
    const patterns = skipRows.has(number) ? [] : variants.flatMap((variant) => variant.patterns);
    rows.push({ number, source, patterns });
    if (patterns.length === 0) {
      const reason = skipRows.has(number)
        ? "§B1-skip (người quyết)"
        : variants.find((variant) => variant.reason)?.reason ?? "cụm quá ngắn/phổ thông";
      excluded.push({ row: number, source, reason });
    }
  }
  if (rows.length === 0) fail("bảng §B1 parse ra 0 dòng; từ chối chấm điểm giả");
  for (const skipped of skipRows) {
    if (!rows.some((row) => row.number === skipped)) fail(`§B1-skip tham chiếu dòng không có trong §B1: ${skipped}`);
  }
  return { rows, excluded };
}

function boundedPartIndex(text: string, lowered: string, part: string, cursor: number, sentenceStart: boolean): number {
  const loweredPart = part.toLocaleLowerCase("vi-VN");
  let candidate = lowered.indexOf(loweredPart, cursor);
  while (candidate >= 0) {
    if (sentenceStart && /[\p{L}\p{N}]/u.test(text.slice(0, candidate))) return -1;
    const end = candidate + part.length;
    const correctInitialCase = !sentenceStart || text[candidate] === part[0];
    const startsAtBoundary = candidate === 0 || !/[\p{L}\p{N}]/u.test(text[candidate - 1] ?? "");
    const endsWithPunctuation = /\p{P}$/u.test(part);
    const endsAtBoundary = endsWithPunctuation || end === text.length || !/[\p{L}\p{N}]/u.test(text[end] ?? "");
    if (correctInitialCase && startsAtBoundary && endsAtBoundary) return candidate;
    candidate = lowered.indexOf(loweredPart, candidate + 1);
  }
  return -1;
}

function orderedMatches(text: string, pattern: B1Pattern): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  const lowered = text.toLocaleLowerCase("vi-VN");
  let searchStart = 0;
  while (searchStart < text.length) {
    let cursor = searchStart;
    let start = -1;
    let end = -1;
    for (let index = 0; index < pattern.parts.length; index += 1) {
      const part = pattern.parts[index] ?? "";
      const next = boundedPartIndex(text, lowered, part, cursor, pattern.sentenceStart && index === 0);
      if (next < 0) return matches;
      if (start < 0) start = next;
      end = next + part.length;
      cursor = end;
    }
    matches.push({ start, end });
    searchStart = end;
  }
  return matches;
}

function matchExcerpt(text: string, start: number, end: number, context = 40): string {
  const excerptStart = Math.max(0, start - context);
  const excerptEnd = Math.min(text.length, end + context);
  const prefix = excerptStart > 0 ? "…" : "";
  const suffix = excerptEnd < text.length ? "…" : "";
  return `${prefix}${text.slice(excerptStart, start)}«${text.slice(start, end)}»${text.slice(end, excerptEnd)}${suffix}`;
}

function buildB1Report(file: string, source: string, rows: B1Row[], exampleOnly: B1ExcludedRow[]): B1Report {
  const lines = prepareText(source);
  const sentences = sentenceUnits(lines);
  const words = proseWordCount(lines);
  const matches = new Map<string, Array<{ row: number; pattern: string; line: number; sentence: string; match: string; start: number; end: number }>>();

  for (const row of rows) {
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      const sentence = sentences[sentenceIndex];
      if (!sentence?.text) continue;
      for (const pattern of row.patterns) {
        for (const span of orderedMatches(sentence.text, pattern)) {
          const key = `${sentenceIndex}:${span.start}:${span.end}`;
          const candidates = matches.get(key) ?? [];
          candidates.push({
            row: row.number,
            pattern: pattern.display,
            line: sentence.number,
            sentence: sentence.text,
            match: sentence.text.slice(span.start, span.end),
            start: span.start,
            end: span.end,
          });
          matches.set(key, candidates);
        }
      }
    }
  }

  const hits: B1Hit[] = [];
  const duplicates: B1Duplicate[] = [];
  for (const candidates of matches.values()) {
    const first = candidates[0];
    if (!first) continue;
    hits.push({ row: first.row, pattern: first.pattern, line: first.line, text: matchExcerpt(first.sentence, first.start, first.end) });
    const duplicateRows = [...new Set(candidates.map((candidate) => candidate.row))];
    if (duplicateRows.length >= 2) duplicates.push({ rows: duplicateRows, line: first.line, text: first.match });
  }

  const densityPer1000Words = words === 0 ? 0 : hits.length * B1_WORD_SCALE / words;
  const scoringWords = Math.max(words, B1_WORD_SCALE);
  const scoringDensityPer1000Words = hits.length * B1_WORD_SCALE / scoringWords;
  const score = Math.max(0, Math.min(10, Math.round(10 - scoringDensityPer1000Words)));
  const reasons: B1SkipReason[] = ["cụm quá ngắn/phổ thông", "thuần ASCII", "có placeholder <>", "§B1-skip (người quyết)"];
  const exclusionCounts = Object.fromEntries(reasons.map((reason) => [reason, exampleOnly.filter((row) => row.reason === reason).length])) as Record<B1SkipReason, number>;
  return {
    command: "b1",
    file,
    tableRows: rows.length,
    scannableRows: rows.length - exampleOnly.length,
    exampleOnlyRows: exampleOnly.length,
    exampleOnly,
    exclusionCounts,
    words,
    hits,
    duplicates,
    densityPer1000Words,
    scoringWords,
    scoringDensityPer1000Words,
    score,
  };
}

function standaloneMatches(text: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu"))].length;
}

function linesWith(lines: PreparedLine[], predicate: (text: string) => boolean): number[] {
  return lines.filter((line) => predicate(line.text)).map((line) => line.number);
}

function uniqueFirstFive(lines: number[]): number[] {
  return [...new Set(lines)].slice(0, 5);
}

function passFailItem(name: string, hits: number, lines: number[], detail?: string): C1Item {
  return { name, status: hits === 0 ? "PASS" : "FAIL", hits, lines: uniqueFirstFive(lines), ...(detail ? { detail } : {}) };
}

function isSentenceBoundary(text: string, index: number): boolean {
  const char = text[index] ?? "";
  if (![".", "!", "?", "…"].includes(char)) return false;
  if (char === "." && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "")) return false;
  let punctuationEnd = index;
  while ([".", "!", "?", "…"].includes(text[punctuationEnd + 1] ?? "")) punctuationEnd += 1;
  const next = text[punctuationEnd + 1];
  if (next !== undefined && !/\s/u.test(next)) return false;
  const prefix = text.slice(0, punctuationEnd + 1).toLocaleLowerCase("vi-VN");
  if (COMMON_ABBREVIATIONS.some((abbreviation) => prefix.endsWith(abbreviation))) return false;
  return true;
}

function splitProseSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!isSentenceBoundary(text, index)) continue;
    let end = index + 1;
    while ([".", "!", "?", "…"].includes(text[end] ?? "")) end += 1;
    const sentence = normalizeWhitespace(text.slice(start, end));
    if (sentence) sentences.push(sentence);
    start = end;
    while (/\s/u.test(text[start] ?? "")) start += 1;
    index = start - 1;
  }
  const tail = normalizeWhitespace(text.slice(start));
  if (tail) sentences.push(tail);
  return sentences;
}

function isHeading(text: string): boolean {
  return /^#{1,6}\s+\S/u.test(text);
}

function isListItem(text: string): boolean {
  return /^(?:[-+*]|\d+[.)])\s+\S/u.test(text);
}

function sentenceUnits(lines: PreparedLine[]): PreparedLine[] {
  const units: PreparedLine[] = [];
  let paragraph: PreparedLine[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = normalizeWhitespace(paragraph.map((line) => line.text).join(" "));
    const lineStarts: Array<{ number: number; start: number }> = [];
    let cursor = 0;
    for (const line of paragraph) {
      lineStarts.push({ number: line.number, start: cursor });
      cursor += line.text.length + 1;
    }
    let searchStart = 0;
    for (const sentence of splitProseSentences(text)) {
      const sentenceStart = text.indexOf(sentence, searchStart);
      const line = [...lineStarts].reverse().find((entry) => entry.start <= sentenceStart);
      units.push({ number: line?.number ?? paragraph[0]?.number ?? 0, text: sentence });
      searchStart = sentenceStart + sentence.length;
    }
    paragraph = [];
  };

  for (const line of lines) {
    if (!line.text) {
      flushParagraph();
    } else if (isHeading(line.text) || isListItem(line.text)) {
      flushParagraph();
      units.push(line);
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return units;
}

function buildC1Report(file: string, source: string, b1: B1Report): C1Report {
  const lines = prepareText(source);
  const items: C1Item[] = [];
  items.push(passFailItem("§B1 không còn sót", b1.hits.length, b1.hits.map((hit) => hit.line), `quét được ${b1.scannableRows}/${b1.tableRows} dòng`));

  let repeatedCuaHits = 0;
  const repeatedCuaLines: number[] = [];
  for (const line of lines) {
    for (const clause of line.text.split(/[,;:]/u)) {
      const count = standaloneMatches(clause, "của");
      if (count > 1) {
        repeatedCuaHits += 1;
        repeatedCuaLines.push(line.number);
      }
    }
  }
  items.push(passFailItem("`của` ≤ 1 lần mỗi mệnh đề", repeatedCuaHits, repeatedCuaLines));

  const rangLines = linesWith(lines, (text) => standaloneMatches(text, "rằng") > 0);
  const rangHits = lines.reduce((sum, line) => sum + standaloneMatches(line.text, "rằng"), 0);
  items.push(passFailItem("`rằng` gần bằng 0", rangHits, rangLines));

  const passivePattern = /(?<![\p{L}\p{N}_])được\b.*?\bbởi(?![\p{L}\p{N}_])/giu;
  const passiveLines = linesWith(lines, (text) => [...text.matchAll(passivePattern)].length > 0);
  const passiveHits = lines.reduce((sum, line) => sum + [...line.text.matchAll(passivePattern)].length, 0);
  items.push(passFailItem("không có `được … bởi`", passiveHits, passiveLines));

  const mannerPattern = /(?<![\p{L}\p{N}_])một\s+cách\s+[\p{L}\p{N}_-]+/giu;
  const mannerLines = linesWith(lines, (text) => [...text.matchAll(mannerPattern)].length > 0);
  const mannerHits = lines.reduce((sum, line) => sum + [...line.text.matchAll(mannerPattern)].length, 0);
  items.push(passFailItem("không có `một cách <tính từ>`", mannerHits, mannerLines));

  const pronouns = ["bạn", "mình", "chúng ta", "chúng tôi"];
  const pronounCounts = Object.fromEntries(pronouns.map((pronoun) => [pronoun, lines.reduce((sum, line) => sum + standaloneMatches(line.text, pronoun), 0)]));
  const activePronouns = pronouns.filter((pronoun) => (pronounCounts[pronoun] ?? 0) > 0);
  items.push({
    name: "xưng hô chỉ một họ",
    status: activePronouns.length === 1 ? "PASS" : "FAIL",
    hits: activePronouns.length,
    counts: pronounCounts,
    detail: activePronouns.length === 1 ? `họ duy nhất: ${activePronouns[0]}` : `số họ xuất hiện: ${activePronouns.length}`,
  });

  const dashLines = linesWith(lines, (text) => text.includes("—"));
  const dashHits = lines.reduce((sum, line) => sum + [...line.text].filter((char) => char === "—").length, 0);
  items.push(passFailItem("không có em-dash `—`", dashHits, dashLines));

  let sentenceShapeHits = 0;
  const sentenceShapeLines: number[] = [];
  for (const line of lines) {
    const units = isHeading(line.text) || isListItem(line.text) ? [line.text] : splitProseSentences(line.text);
    for (const unit of units) {
      const words = proseWordCount([{ number: line.number, text: unit }]);
      const maCount = standaloneMatches(unit, "mà");
      if (words > 35 || maCount >= 2) {
        sentenceShapeHits += 1;
        sentenceShapeLines.push(line.number);
      }
    }
  }
  items.push(passFailItem("không câu >35 từ hoặc có ≥2 chữ `mà`", sentenceShapeHits, sentenceShapeLines));

  items.push({ name: "code / định danh / số / version giữ nguyên byte", status: "SKIP", detail: "cần bản gốc, không thuộc phạm vi script" });
  return {
    command: "c1",
    file,
    b1Coverage: {
      tableRows: b1.tableRows,
      scannableRows: b1.scannableRows,
      exampleOnlyRows: b1.exampleOnlyRows,
      exampleOnly: b1.exampleOnly,
      exclusionCounts: b1.exclusionCounts,
    },
    items,
  };
}

/** Một câu của bản `before` bị tính là đã đổi nếu nó không xuất hiện nguyên văn trong bản `after` (so sánh sau khi chuẩn hoá khoảng trắng). Tách một câu thành hai → câu gốc không sống sót → tính 1. Xoá câu → tính 1. Thêm câu mới không làm tăng mẫu số — chế độ VIẾT LẠI ngắn hơn là đúng. */
function buildDeltaReport(beforePath: string, beforeSource: string, afterPath: string, afterSource: string): DeltaReport {
  const beforeSentences = sentenceUnits(prepareText(beforeSource)).map((sentence) => sentence.text);
  const afterSentences = sentenceUnits(prepareText(afterSource)).map((sentence) => sentence.text);
  const survivors = new Set(afterSentences);
  let changed = 0;
  for (const sentence of beforeSentences) {
    if (!survivors.has(sentence)) changed += 1;
  }
  const ratio = beforeSentences.length === 0 ? 0 : changed / beforeSentences.length;
  const percent = ratio * 100;
  return {
    command: "delta",
    before: beforePath,
    after: afterPath,
    beforeSentences: beforeSentences.length,
    afterSentences: afterSentences.length,
    changed,
    ratio,
    percent,
    thresholdPercent: CLOSE_DELTA_PERCENT,
    closed: percent <= CLOSE_DELTA_PERCENT,
  };
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits, minimumFractionDigits: maximumFractionDigits }).format(value).replace(/\./gu, " ");
}

function printB1(report: B1Report): void {
  process.stdout.write(`§B1 — ${report.file}\n`);
  process.stdout.write(`  Bảng: ${report.tableRows} dòng · quét được ${report.scannableRows} · example-only ${report.exampleOnlyRows}\n`);
  process.stdout.write(`    cụm quá ngắn/phổ thông: ${report.exclusionCounts["cụm quá ngắn/phổ thông"]} · thuần ASCII: ${report.exclusionCounts["thuần ASCII"]} · có placeholder <>: ${report.exclusionCounts["có placeholder <>"]} · §B1-skip (người quyết): ${report.exclusionCounts["§B1-skip (người quyết)"]}\n`);
  process.stdout.write(`  Văn xuôi: ${formatNumber(report.words)} từ\n\n`);
  process.stdout.write(`  HIT (${report.hits.length}):\n`);
  if (report.hits.length === 0) process.stdout.write("    không có\n");
  for (const hit of report.hits) {
    process.stdout.write(`    #${hit.row}  ${hit.pattern.padEnd(20)} dòng ${hit.line}   \"${hit.text}\"\n`);
  }
  for (const duplicate of report.duplicates) {
    const rows = duplicate.rows.map((row) => `#${row}`).join(" và ");
    process.stdout.write(`  TRÙNG BẢNG: dòng ${rows} cùng bắt \"${duplicate.text}\" — cân nhắc gộp theo §D\n`);
  }
  process.stdout.write(`\n  Mật độ thô:    ${report.hits.length} hit / ${formatNumber(report.words)} từ = ${formatNumber(report.densityPer1000Words, 2)} / 1000 từ\n`);
  process.stdout.write(`  Mật độ chấm:   ${report.hits.length} hit / ${formatNumber(report.scoringWords)} từ${report.words < B1_WORD_SCALE ? " (sàn)" : ""} = ${formatNumber(report.scoringDensityPer1000Words, 2)}\n`);
  process.stdout.write(`  từ ngữ = ${report.score}   (10 − mật độ có sàn 1000 từ, làm tròn, kẹp [0,10])\n`);
}

function printC1(report: C1Report): void {
  process.stdout.write(`§C1 — ${report.file}\n`);
  process.stdout.write(`  Bảng: ${report.b1Coverage.tableRows} dòng · quét được ${report.b1Coverage.scannableRows} · example-only ${report.b1Coverage.exampleOnlyRows}\n`);
  process.stdout.write(`    cụm quá ngắn/phổ thông: ${report.b1Coverage.exclusionCounts["cụm quá ngắn/phổ thông"]} · thuần ASCII: ${report.b1Coverage.exclusionCounts["thuần ASCII"]} · có placeholder <>: ${report.b1Coverage.exclusionCounts["có placeholder <>"]} · §B1-skip (người quyết): ${report.b1Coverage.exclusionCounts["§B1-skip (người quyết)"]}\n`);
  report.items.forEach((item, index) => {
    const hitText = item.hits === undefined ? "" : ` · ${item.hits} hit`;
    const lineText = item.lines && item.lines.length > 0 ? ` · dòng ${item.lines.join(", ")}` : "";
    process.stdout.write(`  ${index + 1}. ${item.status} — ${item.name}${hitText}${lineText}\n`);
    if (item.counts) process.stdout.write(`     ${Object.entries(item.counts).map(([name, count]) => `${name}=${count}`).join(" · ")}\n`);
    if (item.detail) process.stdout.write(`     ${item.status === "SKIP" ? "SKIP — " : ""}${item.detail}\n`);
  });
}

function printDelta(report: DeltaReport): void {
  process.stdout.write(`delta — before: ${report.beforeSentences} câu · after: ${report.afterSentences} câu\n`);
  process.stdout.write(`  Đã đổi: ${report.changed} / ${report.beforeSentences} = ${formatNumber(report.percent, 1)}%\n`);
  process.stdout.write(`  Ngưỡng đóng: ≤${report.thresholdPercent}%  → ${report.closed ? "ĐẠT" : "CHƯA ĐẠT"}\n`);
}

type Cli = {
  json: boolean;
  conventions: string;
  positional: string[];
};

function parseCli(args: string[]): Cli {
  const positional: string[] = [];
  let json = false;
  let conventions = DEFAULT_CONVENTIONS;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--json") json = true;
    else if (arg === "--conventions") {
      const path = args[index + 1];
      if (!path) fail("`--conventions` cần một đường dẫn");
      conventions = resolve(path);
      index += 1;
    } else if (arg.startsWith("--")) fail(`tuỳ chọn không hợp lệ: ${arg}`);
    else positional.push(arg);
  }
  return { json, conventions, positional };
}

async function main(): Promise<void> {
  const cli = parseCli(Bun.argv.slice(2));
  const [first, ...rest] = cli.positional;
  if (!first) fail("cách dùng: vi-score.ts [b1|c1] <file.md> | delta <before.md> <after.md> | <file.md> [--json]");

  if (first === "delta") {
    if (rest.length !== 2) fail("`delta` cần đúng hai file: <before.md> <after.md>");
    const beforePath = resolve(rest[0] ?? "");
    const afterPath = resolve(rest[1] ?? "");
    const report = buildDeltaReport(
      beforePath,
      await readRequiredFile(beforePath, "file before"),
      afterPath,
      await readRequiredFile(afterPath, "file after"),
    );
    if (cli.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else printDelta(report);
    return;
  }

  const command = first === "b1" || first === "c1" ? first : "all";
  const files = command === "all" ? [first, ...rest] : rest;
  if (files.length !== 1) fail(command === "all" ? `subcommand không hợp lệ hoặc thừa đối số: ${first}` : `\`${command}\` cần đúng một file`);
  const file = resolve(files[0] ?? "");
  const [source, conventions] = await Promise.all([
    readRequiredFile(file, "bài tiếng Việt"),
    readRequiredFile(cli.conventions, "vi-conventions.md"),
  ]);
  const { rows, excluded } = parseB1Rows(conventions);
  const b1 = buildB1Report(file, source, rows, excluded);

  if (command === "b1") {
    if (cli.json) process.stdout.write(`${JSON.stringify(b1, null, 2)}\n`);
    else printB1(b1);
    return;
  }

  const c1 = buildC1Report(file, source, b1);
  if (command === "c1") {
    if (cli.json) process.stdout.write(`${JSON.stringify(c1, null, 2)}\n`);
    else printC1(c1);
    return;
  }

  if (cli.json) process.stdout.write(`${JSON.stringify({ c1, b1 }, null, 2)}\n`);
  else {
    printC1(c1);
    process.stdout.write("\n");
    printB1(b1);
  }
}

await main();
