
# TOKEN EFFICIENCY PROTOCOL

## Objective
Complete tasks using minimum possible model requests
and minimum context consumption.

## Context
- Never scan the entire repository without need.
- Inspect only files relevant to the task.
- Never reread unchanged files.
- Exclude dependencies, build outputs and generated files.
- Prefer targeted search over broad file reading.

## Execution
- One task at a time.
- No unnecessary subagents.
- No speculative implementation.
- Do not repeat successful commands.
- Run only relevant tests.
- Do not rebuild repeatedly without a reason.

## Anti-loop
- Maximum two attempts using the same approach.
- After two failures, stop and analyze.
- Never repeat identical tool calls without new information.
- Do not endlessly reconsider completed decisions.

## Output
- Keep explanations short.
- Report changed files.
- Report actual test results.
- Do not produce lengthy reasoning summaries.
- Stop when acceptance criteria are satisfied.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
