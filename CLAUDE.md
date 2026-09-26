# JunoBooks — instructions for Claude Code

JunoBooks is a Windows desktop accounting app (Electron + SQLite) for small businesses: multi-company, any entity type, offline-first, built to produce a year-end package for an outside accountant. I am not a programmer. I build this entirely by talking to you, so explain things in plain English, tell me exactly what to click or approve, and never assume I can read or fix code myself.

## 1. Session startup (keep it cheap)
- Read `docs/progress-log.md` and `docs/architecture.md` first. They are the source of truth for where things stand.
- `docs/architecture.md` is the lean core doc: tech stack, folder layout, database schema, ledger rules, verification practice, open questions, an index of topic docs, and the name of the latest handoff file.
- Open a topic doc in `docs/topics/` only when this round's task touches that module (e.g. `inventory.md`, `import-etsy.md`). If a task spans several modules, read every topic doc it touches, and no others.
- Read the latest handoff file (in `docs/handoffs/`) only when the round continues unfinished work from it, or when progress-log and architecture don't explain something.
- Read `JunoBooks-PLAN.md` (the master plan) only when starting a new phase. Otherwise the docs above replace it.
- When you need one part of a large file, search for it instead of reading the whole file.

## 2. Keep the docs current
- Update `progress-log.md`, `architecture.md`, and any topic doc the round actually touched in the same turn that:
  - I confirm a checkpoint works, or
  - we agree on a new feature or plan.
- Do this even if I don't ask. These docs must never fall behind the real state of the app.
- After each confirmed checkpoint, make a git commit with a short, plain-English message, so any change can be undone.

## 3. Docs stay lean and current-state-only (hard rule)
- `architecture.md` and topic docs describe how things work *right now*, never a history of how they got there.
- When a change replaces an old mechanism, replace its description. Don't append "round N changed this."
- Reasoning, alternatives considered, and debugging stories go in progress-log or a handoff, not here.
- `progress-log.md` is a pointer: a few lines per round covering what changed, files touched, and confirmed status. Git history holds the details. No paragraphs.
- If a doc is visibly bloating, condense old confirmed entries to one-liners in the same turn, unprompted.
- If a topic doc gets large enough to slow sessions down, flag it and propose splitting it.

## 4. Handoff files
- Create a new handoff only when I type "create new handoff." Never edit or rewrite an existing handoff.
- Number handoffs upward (`handoff-01.md`, `handoff-02.md`, …) and keep them all.
- A new handoff references earlier ones by name rather than repeating them.
- Update the "latest handoff" line in `architecture.md` whenever you create one.

## 5. Backlog
- When I start a message with "backlog:", add the item to `docs/backlog.md` under the right section (Data/logic changes, Feature ideas, or UI tweaks). Don't start any work on it. Just confirm it's parked.
- At the start of each phase, show me the backlog items that fit that phase.

## 6. Model choice
- Default model: Sonnet.
- Before a task that looks like it needs Opus (complex or risky changes across many files, tricky debugging, ledger or database-schema changes), tell me and ask me to switch models first, using the model dropdown next to the send button. Never start that kind of task on Sonnet without asking.
- If I'm on Opus and the next task is simple, suggest switching back first.

## 7. Working style (I'll trade speed for fewer tokens)
- **One unit at a time:** break multi-step work into small units, one per turn. Stop at natural checkpoints so I can try the app.
- **Plan first:** for larger tasks, propose a short plan and wait for my OK before building.
- **Named files:** if I name the relevant files, use those directly. Skip broad exploration.
- **Match checks to risk:**
  - Small, low-risk change: a quick syntax check is enough.
  - Ledger math, database schema, imports, or exports: run real tests.
- **Short answers:** don't paste large blocks of code into the chat. Summarize what changed in a few lines.
- **Next steps:** end every response on multi-step work with a brief "next steps" pointer, so I know what to ask for next.
- **Fresh sessions:** when a phase or major round is done and the docs are updated, tell me it's a good time to start a new session, so old context stops costing tokens.

## 8. Protect my books
- Develop and test only against a test data folder with sample companies. Never open, modify, or migrate my real company files unless I explicitly ask.
- Any database change must include a safe migration and create a backup first.
- Double-entry integrity is non-negotiable: every transaction must balance, and posted periods stay locked.
- Ask before anything destructive or hard to undo: deleting files or data, rewriting git history, or changing how existing records are stored.
- Tax and accounting judgment calls (inventory method, depreciation, entity-type treatment) are flagged in the app for my accountant, never decided silently.
