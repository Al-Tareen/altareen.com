---
title: "Cost-to-Serve / AI Economics Sheet (template)"
primaryCategory: "GTM & Growth"
categories: ["GTM & Growth"]
dbTitle: "Frameworks"
notionId: "2db39950-eddd-80cf-a908-ccdcc4152509"
link: ""
---
## When to use
When you’re pricing/packaging an AI feature or approaching launch and need to ensure margins won’t get destroyed by inference/tooling costs.

## Inputs required
Model/vendor pricing; token usage assumptions or average request size; traffic forecasts; latency targets; caching/retry policies; tooling costs (vector DB, reranker, storage); infra costs; human review costs (if HITL); gross margin target.

## Output artifact
Cost model showing: cost per request/session, cost per active user, monthly run-rate at traffic scenarios, margin impact by tier, and cost levers (caching, routing, smaller model, rate limits).

## Common mistakes
Ignoring retries and tool calls; unrealistic token averages; forgetting non-model costs (storage, retrieval, logging); no scenario ranges; not linking costs to pricing/packaging; launching without cost guardrails.
