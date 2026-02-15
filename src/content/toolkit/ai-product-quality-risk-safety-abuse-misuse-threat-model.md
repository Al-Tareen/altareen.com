---
title: "Abuse / Misuse Threat Model"
primaryCategory: "AI Product Quality, Risk & Safety"
categories: ["AI Product Quality, Risk & Safety"]
whenToUse: "When your AI feature could be exploited (prompt injection, data exfiltration, jailbreaks, harmful content, fraud), especially if it connects to tools, sensitive data, or enterprise systems."
inputsRequired: "Intended use + non-goals; user roles and permissions; data types handled; system architecture (tools, connectors, logging); known failure modes; attacker assumptions; relevant policies/regulatory constraints."
outputArtifact: "Threat model doc: abuse scenarios, likelihood/impact, mitigations (product + policy + technical), detection/monitoring signals, and escalation/response steps."
commonMistakes: "Only listing generic threats; ignoring insider misuse; no severity ranking; mitigations not actionable; no monitoring/detection plan; not updating after new capabilities (tools/plugins/data)."
dbTitle: "Frameworks"
notionId: "2db39950-eddd-800c-a711-c107538cbe29"
link: ""
cover: "/toolkit-covers/ai-product-quality-risk-safety-abuse-misuse-threat-model.png"
files: []
---
## When to use
When your AI feature could be exploited (prompt injection, data exfiltration, jailbreaks, harmful content, fraud), especially if it connects to tools, sensitive data, or enterprise systems.

## Inputs required
Intended use + non-goals; user roles and permissions; data types handled; system architecture (tools, connectors, logging); known failure modes; attacker assumptions; relevant policies/regulatory constraints.

## Output artifact
Threat model doc: abuse scenarios, likelihood/impact, mitigations (product + policy + technical), detection/monitoring signals, and escalation/response steps.

## Common mistakes
Only listing generic threats; ignoring insider misuse; no severity ranking; mitigations not actionable; no monitoring/detection plan; not updating after new capabilities (tools/plugins/data).
