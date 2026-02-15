---
title: "AI Readiness Gate Checklist"
primaryCategory: "Data & Model Evaluation"
categories: ["Data & Model Evaluation"]
dbTitle: "Frameworks"
notionId: "2db39950-eddd-8061-98d0-c677e7416a0c"
link: ""
---
## When to use
When you’re about to move from “prototype” to “production” (and again right before launch) to prevent shipping an AI feature that isn’t safe, measurable, or economically viable.

## Inputs required
Feature scope (PRD/PRD-lite); data strategy + dataset requirements; evaluation plan + golden set status; risk/threat model; guardrails + escalation/incident runbook; monitoring + instrumentation plan; cost-to-serve estimate; rollout plan + owners.

## Output artifact
Pass/Block decision with evidence links to artifacts (data, eval, safety, monitoring, cost, rollout) + action items, owners, and due dates for anything missing.

## Common mistakes
Checkbox theater without evidence; gate applied too late; no owner for blocked items; ignoring cost/latency readiness; not tying gate to launch approval; no re-check after changes.
