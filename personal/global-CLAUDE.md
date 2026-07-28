# Global Claude Code behavior

## Default to a sub agent for code work; keep main session free

**The problem this solves:** previously the workflow was opening several Claude
Code sessions on the same repo/branch at once to parallelize work. That caused
merge conflicts between sessions editing the same files, and each session
often lacked context the others had already built up.

**The rule:** when a new prompt starts a task that is code-related and would
take meaningful time/effort, spawn a background `Agent` to do the work instead
of the main session doing it inline. The main session's job becomes: brief the
agent well, then stay free to take the next prompt immediately — not block
waiting.

- **Route to a background Agent when the task is code-related AND non-trivial** —
  judge non-trivial the same way as elsewhere in this workflow: touches
  multiple files, requires actually reading and understanding existing code
  (not just a lookup), needs a multi-step plan, or will go through
  edit-verify-iterate cycles (running tests/build repeatedly, checking
  results, adjusting). Debugging a real bug, implementing a feature, a
  multi-step refactor, anything that maps to an existing plan/spec skill
  (`/implement`, `/investigate`, `/fix-bug`) — spawn it.
- **Keep it in the main session when it's fast** — a single grep/lookup, a
  one-to-two-line fix, answering a question from already-visible context,
  running a command and reporting its output, anything genuinely quick. Don't
  spawn an agent for something that finishes before the spawn overhead would
  even pay off.
- **Launch in the background** (`run_in_background: true`, the `Agent` tool's
  default) so the main session is immediately free for the next prompt. Do not
  block on the result. When the agent completes, its notification arrives on
  a later turn — report it then, don't fabricate a result in the meantime.
- **This is a standing default, not a per-task ask.** Apply it automatically
  at the start of any new task without asking the user to opt in each time —
  unless the user explicitly says to work inline this time ("làm luôn trong
  session này", "don't spawn an agent for this").

## Non-negotiable: sub agent quality must match main-session quality

Delegating to a sub agent must never be an excuse for a shallower result.
Two things are required every time a code-work agent is spawned:

1. **Brief it like a smart colleague who just walked in, not a one-liner.**
   The agent starts with zero memory of this conversation. State what you're
   trying to accomplish and why, what's already been ruled out or tried, the
   relevant file paths/line numbers/constraints already known, and what "done"
   looks like. A prompt like "fix bug X" with no surrounding context is not
   an acceptable brief — it reproduces the same context-loss problem that
   multiple parallel sessions had, just inside one session instead of across
   several.
2. **Route the agent's finished code through `/review` (or the
   project's equivalent review skill) before reporting the task as done.**
   Do not take the sub agent's own "done" claim at face value. When the
   notification arrives, run the review step, and only then tell the user
   the task is complete — folding in anything review surfaced.

Both steps apply regardless of how the agent was invoked (`Agent` tool,
`Workflow`, or otherwise) whenever the work is a code change.

## Hard rule: no inline comments in code

Code explains itself through naming and structure. A comment that restates what
the line already says is noise — it rots, it starts lying after the next
refactor, and it trains the reader to skim instead of read.

**The rule:** do NOT add inline comments (`//`, `#`, `/* */` mid-body) to code
you write or edit. Every project on this machine, every language, new code and
code you touch while fixing something else alike. This is a hard rule, not a
preference — it does not need to be restated per task.

- **Docblocks (JSDoc/TSDoc/docstrings) are allowed, but only when they earn
  their place** — a non-obvious contract, a param whose meaning isn't clear from
  its name, a return shape worth stating, a function other people will call
  without reading its body. If the signature already says it, skip the docblock.
- **Keep docblocks short.** If one runs long, simplify it. One line of purpose
  beats six `@param` lines that just retype the TypeScript types. Never document
  a type the type system already declares.
- **Never use a comment as a substitute for a better name.** If you feel the
  urge to explain a variable, rename the variable. If you feel the urge to
  explain a block, extract it into a well-named function.

### The only exceptions

1. **Temporary scaffolding that must be found and deleted later** — mock data,
   a hardcoded/faked value, a stub standing in for an API that isn't built yet.
   Mark it so it's greppable and it's obvious what to remove:
   `// MOCK: remove when /api/points ships`
   `// TEMP: hardcoded store id until multi-store lands`
   Without the marker this stuff ships to production and nobody ever finds it.
2. **A logic decision that isn't obvious from the code** — why THIS approach and
   not the one a reader would reach for. One line, so the next person doesn't
   "fix" it back into a bug:
   `// Sequential on purpose — the API 429s above 3 concurrent writes.`
   The test is: would a competent dev be tempted to change this and break
   something? If no, don't comment. One line, never a paragraph.
3. **The user explicitly asks for comments** ("comment giúp anh chỗ này",
   "add comments here") — then comment as asked, no argument.

Anything outside these three: no comment. When in doubt, leave it out.

### Don't strip existing comments unasked

This rule governs code you write or modify. Do not do a drive-by purge of
comments in code you weren't otherwise touching — it bloats the diff and makes
review impossible. Clean up existing comments only when the user asks for it.
