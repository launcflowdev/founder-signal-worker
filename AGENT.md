# AGENT.md
> Agentic coding framework with graceful degradation. Works at full capacity or on fumes.

---

## COLD START
```
1. Read this file
2. Read fix_plan.md (if exists, create if not)
3. Run health check command
4. Pick lowest-hanging P0/P1
5. Start

No fix_plan.md? Run tests. Failures ARE your fix_plan.
```

---

## QUICK REFS
```bash
# Customize per project - one command each
Health:   [npm test | wrangler dev | make check]
Deploy:   [npm run deploy | wrangler publish]
Logs:     [wrangler tail | npm run logs]
Reset:    [git checkout main && git pull]
```

---

## OPERATING MODES

| Mode | When | Scope |
|------|------|-------|
| **FULL** | High energy, time available | Complete loop discipline |
| **BURST** | Limited window | One fix → commit → done |
| **RECON** | Low energy / exploring | Read-only. Update fix_plan. No code. |
| **DRAIN** | Brain fog / tired | Comments, docs, notes. Still progress. |

---

## LOOP DISCIPLINE
```
1. One meaningful change per iteration
2. Run tests for that specific change
3. If green → commit
4. Update fix_plan.md
5. Next iteration or stop

Do not: multitask, chase tangents, fix unrelated failures
```

---

## TRIAGE TIERS (fix_plan.md)
```
P0: Blocks shipping        → Fix immediately
P1: Degrades core function → Fix this session if possible  
P2: Nice to have           → Scheduled, not urgent
STUB: Intentional placeholder → Tracked, time-boxed

Only P0s block commits.
```

---

## STUB PROTOCOL
```
Stubs permitted when validating architecture.

Format:
// STUB: [what it should do] | Tracking: fix_plan.md#P1-003

Rules:
- Must be logged in fix_plan.md
- Stubs older than 2 sessions → promote to P1
- Never ship stubs to production
```

---

## BLAST RADIUS RULES
```
Unrelated test failure during your change?

- Same file/function OR <5 min fix → handle it
- Everything else → log in fix_plan.md, continue current scope

Do not let flaky tests hijack your session.
```

---

## COMPACTION PREVENTION
```
The agent's context is a scratchpad, not a warehouse.

- Max 3-4 tool calls per iteration before checkpoint
- Any decision made → write to fix_plan.md IMMEDIATELY
- Never hold state in conversation that isn't also in a file
- Context feels heavy? Commit. Fresh session.
- If agent had amnesia, could it still function from files alone? (Should be yes)
```

---

## INTERRUPT CONDITIONS
```
Agent should STOP and ask human when:

🛑 Same error 3x in a row
🛑 About to delete/overwrite >50 lines  
🛑 Scope expanding beyond original ask
🛑 "I think" or "probably" appearing in reasoning
🛑 Credentials, API keys, or external access needed
🛑 Error output exceeds 50 lines
```

---

## CONTEXT LOSS PROTOCOL
```
Lost mid-session? Don't panic.

1. git diff          → see what you were touching
2. git log -3        → see recent intent  
3. fix_plan.md       → check for [IN PROGRESS] markers
4. No markers?       → commit as WIP, reassess fresh
```

---

## TOOL DEGRADATION

| Environment | Approach |
|-------------|----------|
| Full agentic (Claude + tools) | Subagent pattern, full automation |
| Semi-agentic (Cursor) | Manual file reads, same logic |
| Chat-only (web/mobile) | Paste contents, get guidance, execute manually |
| Offline | fix_plan.md is your checklist |

Every level still moves forward.

---

## HANDOFF PACKET
```
Portable context for switching tools/sessions:

Project: [name]
Status:  [🟢🟡🔴] [one line]
Current: [what's in progress]
Next:    [one clear action]  
Blockers: [if any]
```

---

## BLOCKED FORMAT (fix_plan.md)
```
🚫 BLOCKED: [item]
   Needs:   [specific human action]
   Context: [one line why agent can't proceed]
   Unblocks: [what this enables]
```

---

## SESSION RITUALS

**Start (60 sec):**
- [ ] Read AGENT.md
- [ ] Read fix_plan.md  
- [ ] Pick operating mode
- [ ] Select ONE objective

**End (30 sec):**
- [ ] fix_plan.md updated with current state
- [ ] Any WIP committed with `WIP:` prefix
- [ ] CHANGELOG or fix_plan: "Left off at: ___"

---

## RECOVERY CHECKPOINTS
```
Before refactor touching >3 files:
→ Commit current state as checkpoint

Before experimental changes:
→ git stash or branch

Everything's on fire?
1. git stash
2. git checkout [last good tag]
3. Breathe
4. Diff stash against good state
5. Cherry-pick only what worked
```

---

## MILESTONE TAGGING
```
Tag on MILESTONE, not every green build:
- Feature complete
- Phase done  
- Pre-deploy checkpoint

Format: v0.1.0, v0.2.0 (semver)
Daily churn stays in commits.
```

---

## EXIT CONDITIONS
```
STOP when:
- Specs satisfied
- Tests green
- No P0/P1 items in fix_plan.md
- Good enough ships

Time-box: 3 failed attempts at same problem = escalate or defer
Do not loop forever chasing perfect.
```

---

## fix_plan.md TEMPLATE
```markdown
STATUS: 🟢 GREEN | 🟡 WIP:[current] | 🔴 BLOCKED:[issue]

OBJECTIVE: [Ship X by Y / Validate Z / Unblock Q]

## P0 - Blockers
- [ ] 

## P1 - Core Function
- [ ]

## P2 - Scheduled  
- [ ]

## STUBS - Tracked Placeholders
- [ ]

## BLOCKED - Needs Human
- 🚫 

## DONE - This Session
- [x]
```

---

*Framework forged. Degrades gracefully. Ships clean.*
