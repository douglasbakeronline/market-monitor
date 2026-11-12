# Shared skills: sources

The same eight skills sit in `.claude/skills/` in each of Douglas's project
repos: footyalmanac, ledger-dashboard, market-monitor and
inbox-innovation-site. Added 12 Nov 2026. Each SKILL.md was read in full
before it was added; none runs code on its own, calls a network service or
sends data anywhere.

## Where they came from

| Skill | Source | Version |
|---|---|---|
| verification-before-completion | obra/superpowers `skills/` | `22f0b46` (3 Nov 2026) |
| systematic-debugging | obra/superpowers `skills/` | `22f0b46` |
| test-driven-development | obra/superpowers `skills/` | `22f0b46` |
| requesting-code-review | obra/superpowers `skills/` | `22f0b46` |
| production-audit | affaan-m/ECC `skills/` | `d2ef268` (6 Nov 2026) |
| security-review | affaan-m/ECC `skills/` | `d2ef268` |
| safety-guard | affaan-m/ECC `skills/` | `d2ef268` |
| verification-loop | affaan-m/ECC `skills/` | `d2ef268` |

Both projects are MIT licensed; the licence texts are `LICENSE-superpowers`
and `LICENSE-ECC` in this folder.

## Local changes

- `systematic-debugging/condition-based-waiting-example.ts` is renamed
  `.ts.txt` so TypeScript and ESLint in the Next.js repos don't try to compile
  it. The one reference to it is updated to match.
- Two `superpowers:` prefixes in `systematic-debugging/SKILL.md` are dropped,
  because these are project skills named without the plugin prefix.

Nothing else is changed. To update, re-copy the folders from the versions
above and reapply these two changes.

## Left out, and why

- **Superpowers' plan-and-execute chain** (brainstorming, writing-plans,
  executing-plans, subagent-driven-development, using-git-worktrees,
  finishing-a-development-branch): the steps depend on each other's scripts,
  work in git worktrees, and stop to ask for sign-off at the hand-off and
  merge. That stalls unattended runs and clashes with each repo's own rules
  for how work lands. A build-session skill written for these repos would
  replace it.
- **The rest of ECC** (300+ skills, hooks, agents): too much standing context
  for these repos; `security-scan` runs a third-party scanner through npx.
- **email-html-mjml**: inbox-innovation-site builds its emails with its own
  system in `email-system/`, not MJML, so the skill would pull agents the
  wrong way.
