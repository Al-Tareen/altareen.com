---
title: "Evaluation framework (offline + online)"
primaryCategory: "Data & Model Evaluation"
categories: ["Data & Model Evaluation"]
whenToUse: "When you must compare models/prompt approaches and need a defensible way to decide what ships."
inputsRequired: "Clear task definition + “correct” criteria; golden set (and rubric); baseline model/prompt; metrics (quality + latency + cost); acceptance thresholds; segmentation (easy/hard cases, user types, edge cases); online instrumentation plan."
outputArtifact: "Evaluation plan + scorecards: offline results by segment, online experiment plan (A/B or shadow), ship/no-ship thresholds, and regression cadence."
commonMistakes: "No thresholds (“looks good”); evaluating on non-representative data; offline-only; ignoring latency/cost; not separating segments/edge cases; no regression strategy."
dbTitle: "Frameworks"
notionId: "2db39950-eddd-80bc-b371-cb621570fc4f"
link: ""
cover: "/toolkit-covers/data-model-evaluation-evaluation-framework-offline-online.png"
files: []
---
## When to use
When you must compare models/prompt approaches and need a defensible way to decide what ships.

## Inputs required
Clear task definition + “correct” criteria; golden set (and rubric); baseline model/prompt; metrics (quality + latency + cost); acceptance thresholds; segmentation (easy/hard cases, user types, edge cases); online instrumentation plan.

## Output artifact
Evaluation plan + scorecards: offline results by segment, online experiment plan (A/B or shadow), ship/no-ship thresholds, and regression cadence.

## Common mistakes
No thresholds (“looks good”); evaluating on non-representative data; offline-only; ignoring latency/cost; not separating segments/edge cases; no regression strategy.
