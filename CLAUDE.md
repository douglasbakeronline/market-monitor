# Working on Market Monitor

Read `README.md` for how it runs and `docs/ROADMAP.md` for the plan and its principles. Those stay the source of truth; this file adds the shared skills.

## Skills (`.claude/skills/`)

Eight shared skills, the same set in each of Douglas's project repos (added
12 Nov 2026; sources, versions and what was left out are in
`.claude/skills/SOURCES.md`).

| Skill | Use it for |
|---|---|
| `verification-before-completion` | Before saying anything is done, fixed or passing |
| `systematic-debugging` | Any bug, failing test or odd output: find the root cause before fixing |
| `test-driven-development` | Logic changes: a failing test first |
| `requesting-code-review` | A fresh-context reviewer subagent on the diff before it ships |
| `verification-loop` | The pre-ship check report (build, types, lint, tests, secrets, diff) |
| `security-review` | Auth, user input, secrets, API routes, third-party data |
| `production-audit` | "Is this ready to ship? What breaks in production?" |
| `safety-guard` | Destructive commands: stop and take the safer route |

How they fit this repo:

- **This file wins.** Where a skill and a rule here disagree (how work lands,
  release steps, commands, what not to touch), follow this file. The skills
  shape how you work, never where or how work ships.
- **Unattended runs don't stop to ask.** Where a skill says to ask your human
  partner, decide, write the decision and the reason where this repo records
  its work, and carry on. Stop only for something irreversible.
- **Use this repo's own checks:** `npm test`, a dry run on the `dryrun` branch with real data and `actionlint` on any changed workflow, as the Principles in `docs/ROADMAP.md` set out. The npm, pyright and ruff
  commands in the skills are generic examples.
- **Test-first is for logic**: code whose behaviour a test can pin. Visual,
  copy and generated or bot-written data changes are checked the way this
  repo already checks them, not test-first.
- **No dependency churn from a review.** Don't run `npm update`,
  `npm audit fix` or upgrade packages because a skill suggests it, unless the
  task is a dependency update.
- **Never** `git push --force`, `git reset --hard` on a shared branch, or
  `--no-verify`. `safety-guard` is advisory, so this line is the rule.
