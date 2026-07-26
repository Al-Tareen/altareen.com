---
title: "Prompt / Model Regression Testing Template"
primaryCategory: "Data & Model Evaluation"
categories: ["Data & Model Evaluation"]
whenToUse: "Catch quiet performance regressions when you change prompts, models, or tools."
whenToUseFull: "When you’re changing prompts/models/tools and need to ensure you didn’t quietly break performance."
inputsRequired: "Golden set; expected behavior specs; thresholds; change log (what changed)."
outputArtifact: "Regression suite; diff report; pass/fail outcome; rollback recommendation."
commonMistakes: "Testing happy paths only; no diff analysis; no rollback; not run routinely."
link: ""
cover: "/toolkit-covers/data-model-evaluation-prompt-model-regression-testing-template.png"
files: []
tags: []
---
## When to use
When you’re changing prompts/models/tools and need to ensure you didn’t quietly break performance.

## Inputs required
Golden set; expected behavior specs; thresholds; change log (what changed).

## Output artifact
Regression suite; diff report; pass/fail outcome; rollback recommendation.

## Common mistakes
Testing happy paths only; no diff analysis; no rollback; not run routinely.
