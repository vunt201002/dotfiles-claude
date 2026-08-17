import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const work = await mkdtemp(join(tmpdir(), "vi-score-"));
const conventions = join(work, "vi-conventions.md");
const article = join(work, "article.md");
const script = resolve(import.meta.dir, "vi-score.ts");

await writeFile(conventions, `### §B1. Bảng chính

| # | Dấu hiệu | Viết lại | Vì sao |
|---|---|---|---|
| 1 | **Thứ hai,** | marker | test |
| 2 | **có khả năng** | rewrite | test |
| 3 | **Standard mode** | rewrite | test |
| 4 | **tồn tại và duy nhất** | rewrite | test |
| 5 | **model sinh ra** | rewrite | test |
| 6 | **dàidòng** | rewrite | test |
| 7 | **mẫu <x>** | rewrite | test |

### §B1-skip. Dòng không máy hoá được — do người quyết

| Dòng | Cụm bị bắt | Vì sao loại |
|---|---|---|
| 4 | tồn tại và duy nhất | test |

### §B2. Test
`);

await writeFile(article, `Đây là câu thứ hai, không phải marker. thứ hai, cũng không phải marker.

Thứ hai, đây mới là marker.

**Thứ hai,** đây là marker có Markdown.

Xác suất này Có khả năng xảy ra.

xxdàidòng không khớp; dàidòngz cũng không; còn dàidòng thì khớp.

${"a".repeat(60)} có khả năng ${"b".repeat(60)}.
`);

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("vi-score b1", () => {
  test("áp đầu câu, ranh giới từ, skip reasons và excerpt quanh hit", () => {
    const result = Bun.spawnSync(["bun", script, "b1", article, "--conventions", conventions, "--json"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.hits.map((hit: { row: number }) => hit.row)).toEqual([1, 1, 2, 2, 6]);
    expect(report.hits[3].text).toStartWith("…");
    expect(report.hits[3].text).toContain("«có khả năng»");
    expect(report.hits[3].text).toEndWith("…");
    expect(report.exclusionCounts).toEqual({
      "cụm quá ngắn/phổ thông": 0,
      "thuần ASCII": 2,
      "có placeholder <>": 1,
      "§B1-skip (người quyết)": 1,
    });
    expect(report.exampleOnly.map((row: { row: number; reason: string }) => [row.row, row.reason])).toEqual([
      [3, "thuần ASCII"],
      [4, "§B1-skip (người quyết)"],
      [5, "thuần ASCII"],
      [7, "có placeholder <>"],
    ]);
  });
});
