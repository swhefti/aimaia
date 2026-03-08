# How to Run the Multi-Agent Build
# Read this before opening any terminal.

---

## What You're About to Do

You're going to run 5 Claude Code agents across 2 phases.
Phase 0 is one agent, alone. Phase 1 is four agents simultaneously.
Total estimated build time: 3–5 hours depending on agent pace.

---

## Before You Start

1. Make sure Claude Code is installed and running
2. Have all 4 spec documents ready to share:
   - Product_Overview_User_Experience_v2.docx
   - Multi-Agent_System_Architecture_v2.docx
   - Data_Database_Architecture_v2.docx
   - LLM_Synthesis_Agent_Spec.docx
3. Have your credentials ready (you'll need them for .env):
   - Supabase project URL + anon key + service role key
   - Anthropic API key
   - Twelve Data API key
   - Finnhub API key
4. Create an empty project folder: `mkdir portfolio-advisor && cd portfolio-advisor`
5. Copy CLAUDE.md into it

---

## Phase 0 — Run the Orchestrator (alone, ~30 min)

**Open 1 terminal tab in Claude Code.**

Share these files with the agent:
- `CLAUDE.md`
- `brief_0_orchestrator.md`
- All 4 spec documents

Opening message to paste:
```
Please read brief_0_orchestrator.md fully, then read CLAUDE.md,
then read all 4 spec documents listed in the brief. Once you've read
everything, start executing the tasks in order. Do not skip tasks.
Let me know when you're done and what files you created.
```

**Wait until the Orchestrator is completely done before starting Phase 1.**

You'll know it's done when it outputs a file list and confirms the
shared types compile.

Run this to verify:
```bash
cd frontend && npx tsc --noEmit
```

---

## Phase 1 — Run All 4 Agents Simultaneously

**Open 4 terminal tabs in Claude Code. Start all 4 at the same time.**

### Tab 1 — Database Agent
Share: `brief_1_database.md`, `CLAUDE.md`, `Data_Database_Architecture_v2.docx`

Opening message:
```
Please read brief_1_database.md fully, then read CLAUDE.md, then read
Data_Database_Architecture_v2.docx. Execute all tasks in order.
You own /db/ only. Do not touch other directories.
```

### Tab 2 — Pipeline Agent
Share: `brief_2_pipeline.md`, `CLAUDE.md`, `Data_Database_Architecture_v2.docx`,
`Multi-Agent_System_Architecture_v2.docx`

Opening message:
```
Please read brief_2_pipeline.md fully, then read CLAUDE.md, then the
two spec documents. Execute all tasks in order.
You own /backend/pipeline/ only. Do not touch other directories.
```

### Tab 3 — Analysis Engine Agent
Share: `brief_3_analysis.md`, `CLAUDE.md`, `Multi-Agent_System_Architecture_v2.docx`,
`LLM_Synthesis_Agent_Spec.docx`, `Data_Database_Architecture_v2.docx`

Opening message:
```
Please read brief_3_analysis.md fully, then read CLAUDE.md, then read
all three spec documents (the LLM Synthesis spec is especially important —
read it completely). Execute all tasks in order.
You own /agents/ only. Do not touch other directories.
```

### Tab 4 — Frontend Agent
Share: `brief_4_frontend.md`, `CLAUDE.md`, `Product_Overview_User_Experience_v2.docx`,
`Multi-Agent_System_Architecture_v2.docx`

Opening message:
```
Please read brief_4_frontend.md fully, then read CLAUDE.md, then read
the two spec documents. The Product Overview is your primary spec —
read it completely. Execute all tasks in order.
You own /frontend/ only. Do not touch other directories.
```

---

## While Agents Are Running

- You can watch all 4 tabs simultaneously — they work in their own directories
  so there are no file conflicts
- If an agent gets stuck or asks a question, answer it in that tab only
- If an agent says it needs a file from another agent — tell it to use the
  types from /shared/types/ and stub any missing dependencies for now
- Do NOT let agents stray outside their ownership boundaries

---

## After Phase 1 — Integration Pass

Once all 4 agents are done, do a brief integration check in a new session:

```
You are doing an integration check on a multi-agent build.
Read CLAUDE.md and all four AGENT_NOTES_*.md files.
Then check:
1. Do the shared types in /shared/types/ match what agents are importing?
2. Do the table names in DB migrations match what pipeline/analysis agents write to?
3. Do the data shapes the frontend queries expect match what analysis writes?
4. Are there any TypeScript compile errors?
List any mismatches you find.
```

---

## How to Add Features Later

Because each agent owns a clean domain, future work is targeted:

| Feature | Which agent to open |
|---|---|
| New technical indicator | Analysis Agent (agents/technical/) |
| New dashboard widget | Frontend Agent (frontend/components/dashboard/) |
| New data source (e.g. options flow) | Pipeline Agent (backend/pipeline/providers/) |
| New database table | Database Agent (db/migrations/) |
| Improve LLM synthesis prompt | Analysis Agent (agents/synthesis/prompt-builder.ts) |
| New onboarding step | Frontend Agent (frontend/app/onboarding/) |
| Earnings Intelligence Agent | Analysis Agent (new: agents/earnings/) |

Each future agent session gets:
1. CLAUDE.md (always)
2. The relevant brief (or a new brief you write)
3. The relevant spec document(s)
4. AGENT_NOTES from relevant previous agents

---

## Iteration Pattern

For each improvement cycle:
1. Identify which domain the change lives in
2. Open that agent's tab with the relevant context
3. Show it the current file(s) to modify
4. Give it the specific change brief
5. Review the output before applying

The CLAUDE.md and AGENT_NOTES files are what make iteration fast — they
give each agent enough context to continue the work without re-explaining
the whole system.

---
