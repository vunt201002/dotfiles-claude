"""Break each fix on purpose and require a named test to notice.

A green suite proves nothing on its own: a test written after the fix passes on
its first run, and a test that has been deleted passes by not existing. Both
happened in this repo. Each entry below reverses one invariant and names the
test file that must go red; a mutation whose anchor no longer matches is
reported SKIP, never counted as a test holding.

Run on a clean tree only, and only against committed work: reverting a mutation
and reverting uncommitted work are the same git operation, which cost this repo
a tripwire once already.
"""

import io, subprocess, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.chdir(ROOT)

dirty = subprocess.run(["git","status","--porcelain"],capture_output=True,text=True).stdout.strip()
if dirty:
    print("REFUSING TO RUN — the tree has uncommitted work:")
    print(dirty)
    print("\nMutating an uncommitted tree cannot tell a reverted mutation from reverted work.")
    raise SystemExit(2)

M = [
 ("readScreen collapses back to one answer",
  "personal/manager/lib/cmux-control.ts",
  "  return { ok: false, error: run.stderr || 'cmux read-screen failed' };",
  "  return { ok: true, screen: '' };",
  "personal/manager/test/cmux-spawn.test.ts"),

 ("operator loses the 'unreadable' wording",
  "personal/manager/lib/cmux-spawn.ts",
  '? `cmux pane ${created.ref} ended as "${exitReason}": screen was unreadable (${screenResult.error})`',
  '? `cmux pane ${created.ref} ended as "${exitReason}" with nothing in its transcript.`',
  "personal/manager/test/cmux-spawn.test.ts"),

 ("isolation line stops being reported",
  "personal/manager/lib/orchestrator.ts",
  "const isolationLine = `runner isolation: none; using main checkout ${path.resolve(req.scope)}`;",
  "const isolationLine = `runner isolation: fine`;",
  "personal/manager/test/integration.test.ts"),

 ("router goes back to regexing title+why",
  "personal/manager/lib/envelope.ts",
  "  if (out.touches_sensitive && LANE_RANK[out.lane] < LANE_RANK['bug-lon']) {",
  "  if (/\\b(auth|payment|migration)\\b/i.test(`${out.title} ${out.why}`) && LANE_RANK[out.lane] < LANE_RANK['bug-lon']) {",
  "personal/manager/test/envelope.test.ts"),

 ("a declared review gate loses its dispatch path",
  "personal/manager/lib/closing-chain.ts",
  "  (Object.keys(ORACLE_CHAIN) as Lane[]).map((lane) => [lane, managerChain(lane, 'review')]),",
  "  (Object.keys(ORACLE_CHAIN) as Lane[]).map((lane) => [lane, []]),",
  "personal/manager/test/closing-chain.test.ts"),

 ("a second human_touches increment appears",
  "personal/manager/lib/orchestrator.ts",
  "    task.human_touches += 1;",
  "    task.human_touches += 1;\n    if (task.id === '') task.human_touches += 1;",
  "personal/manager/test/tripwire.test.ts"),

 ("a new POST route is added without wiring",
  "personal/manager/server.ts",
  "    if (req.method === 'POST' && pathname === '/stopall') {",
  "    if (req.method === 'POST' && pathname === '/undeclared') return json({ ok: true });\n    if (req.method === 'POST' && pathname === '/stopall') {",
  "personal/manager/test/tripwire.test.ts"),

 ("precision reports a number while samples are unadjudicated",
  "bin/gate-log",
  "                precision: precisionPending ? null : precision.get(g) ?? null,",
  "                precision: precision.get(g) ?? null,",
  "personal/manager/test/blind-sample-review.test.ts"),

 ("a missing verdict is read as clean",
  "personal/manager/cli.ts",
  "  if (parsed.falsePositiveLines === null || parsed.humanFixed === null) {",
  "  if (false) {",
  "personal/manager/test/blind-sample-review.test.ts"),
 ("red-test claims caught without checking anything",
  "personal/manager/lib/red-test-runner.ts",
  "function row(verdict: GateReport['verdict'], caught: string): GateReport {\n  return { gate: 'red-test', gate_family: 'deterministic', verdict, caught };",
  "function row(verdict: GateReport['verdict'], caught: string): GateReport {\n  return { gate: 'red-test', gate_family: 'deterministic', verdict: 'caught', caught };",
  "personal/manager/test/closing-chain.test.ts"),
]

rows = []
for name, f, find, repl, testfile in M:
    src = io.open(f, encoding="utf-8").read()
    if find not in src:
        rows.append((name, testfile, "SKIP", "anchor not found — mutation NOT applied"))
        continue
    backup = src
    io.open(f, "w", encoding="utf-8").write(src.replace(find, repl, 1))
    r = subprocess.run(["bun","test",testfile,"--timeout","30000"],
                       capture_output=True, text=True, timeout=420)
    out = r.stdout + r.stderr
    io.open(f, "w", encoding="utf-8").write(backup)
    failed = " fail" in out and not out.strip().endswith("0 fail")
    import re
    passes = re.findall(r"^\s*(\d+) pass\s*$", out, re.M)
    fails = re.findall(r"^\s*(\d+) fail\s*$", out, re.M)
    ran = re.search(r"Ran (\d+) tests", out)
    if not passes or not fails or not ran:
        rows.append((name, testfile.split("/")[-1], "UNPARSED — do not trust", "no summary block"))
        continue
    p_n, f_n, r_n = int(passes[-1]), int(fails[-1]), int(ran.group(1))
    detail = f"{p_n} pass / {f_n} fail of {r_n} ran"
    if p_n + f_n < r_n * 0.5:
        verdict = "BROKEN RUN — file did not load"
    else:
        verdict = "RED (test bites)" if f_n > 0 else "GREEN — TEST DID NOT BITE"
    rows.append((name, testfile.split("/")[-1], verdict, detail))

w = max(len(r[0]) for r in rows)
print()
for name, tf, verdict, detail in rows:
    print(f"{name.ljust(w)}  {verdict.ljust(26)} {detail.ljust(20)} {tf}")
print()
bad = [r for r in rows if not r[2].startswith("RED")]
print(f"{len(rows)-len(bad)}/{len(rows)} mutations killed by a test")
if bad:
    print("NOT KILLED:")
    for r in bad: print("  -", r[0], "|", r[2])
