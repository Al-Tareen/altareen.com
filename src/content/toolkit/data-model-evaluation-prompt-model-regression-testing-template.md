---
title: "Prompt / model regression testing template"
primaryCategory: "Data & Model Evaluation"
categories: ["Data & Model Evaluation"]
dbTitle: "Frameworks"
notionId: "2db39950-eddd-8093-81f0-e587cad40278"
link: ""
---
## When to use
When you’re changing prompts/models/tools and need to ensure you didn’t quietly break performance.

## Inputs required
Golden set; expected behavior specs; thresholds; change log (what changed).

## Output artifact
Regression suite; diff report; pass/fail outcome; rollback recommendation.

## Common mistakes
Testing happy paths only; no diff analysis; no rollback; not run routinely.
