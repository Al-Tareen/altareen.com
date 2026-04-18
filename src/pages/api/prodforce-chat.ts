import type { APIRoute } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { getCollection } from "astro:content";

export const prerender = false;

type Framework = {
  slug: string;
  title: string;
  category: string;
  whenToUse: string;
  whenToUseFull: string;
  inputsRequired: string;
  outputArtifact: string;
  commonMistakes: string;
  tags: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

type FilePayload = {
  name: string;
  fileType: "pdf" | "text";
  content?: string;
  base64?: string;
};

type OrchestratorResult = {
  framework_matches: Array<{
    slug: string;
    reason: string;
  }>;
  situation_summary: string;
  follow_up_suggestions: string[];
};

type PlainMessage = {
  role: "user" | "assistant";
  content: string;
};

type ConversationMode = "pm" | "smalltalk" | "clarify";
type SignalKey =
  | "objective"
  | "scope"
  | "users"
  | "metrics"
  | "constraints"
  | "evidence"
  | "risks"
  | "stakeholders";
type ScenarioContext = {
  lowerText: string;
  categories: string[];
  frameworkTitles: string[];
  isPrioritization: boolean;
  isDiagnostic: boolean;
  isLaunch: boolean;
  isAlignment: boolean;
  isStrategy: boolean;
  isResearch: boolean;
  isGrowth: boolean;
  isAi: boolean;
  isEnterprise: boolean;
  isPricing: boolean;
};
type FrameworkCoverage = {
  requiredInputs: string[];
  presentInputs: string[];
  missingInputs: string[];
  confidence: "high" | "medium" | "low";
  readinessLabel: string;
  requiredSignalKeys: SignalKey[];
};
type IntakeAssessment = {
  shouldClarify: boolean;
  situationSummary: string;
  missingInformation: string[];
  clarificationQuestions: string[];
  candidateCategories: string[];
  presentSignals: Set<SignalKey>;
  candidateFrameworks: Framework[];
  coverageBySlug: Record<string, FrameworkCoverage>;
  askedSignalKeys: SignalKey[];
  askedInformation: string[];
  deferredInformation: string[];
  suggestedReplies: string[];
};

type Provider =
  | {
      kind: "groq";
      apiKey: string;
      models: {
        orchestrator: string;
        specialist: string;
        synthesis: string;
      };
    }
  | {
      kind: "anthropic";
      client: Anthropic;
      models: {
        orchestrator: string;
        specialist: string;
        synthesis: string;
      };
    };

const EXCLUDED_CATEGORIES = new Set(["Business Plans", "Financial Models", "TBA"]);
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MAX_TOKENS = {
  orchestrator: 450,
  specialist: 320,
  synthesis: 700,
} as const;
const ORCHESTRATOR_CANDIDATE_LIMIT = 12;
const STOPWORDS = new Set([
  "about",
  "after",
  "against",
  "align",
  "also",
  "an",
  "and",
  "are",
  "around",
  "because",
  "before",
  "between",
  "build",
  "can",
  "could",
  "define",
  "deliver",
  "for",
  "from",
  "have",
  "help",
  "how",
  "into",
  "its",
  "launch",
  "more",
  "need",
  "next",
  "our",
  "plan",
  "product",
  "roadmap",
  "should",
  "start",
  "team",
  "that",
  "the",
  "their",
  "them",
  "there",
  "they",
  "this",
  "through",
  "user",
  "using",
  "want",
  "what",
  "when",
  "which",
  "with",
  "would",
]);
const SMALL_TALK_PATTERNS = [
  /^(hi|hello|hey|yo|hiya|sup|what'?s up)[!.?\s]*$/i,
  /^(good (morning|afternoon|evening))[!.?\s]*$/i,
  /^(how are you|how'?re you|how are things|how is it going|how'?s it going)[!.?\s]*$/i,
  /^(hello|hi|hey)[,!\s]+(how are you|how'?re you)[!.?\s]*$/i,
];
const PM_SIGNAL_PATTERNS = [
  /\b(product|pm|roadmap|priorit|launch|go[- ]to[- ]market|gtm|churn|retention|activation|onboarding|metric|kpi|okr|vision|strategy|discovery|stakeholder|backlog|feature|experiment|pricing|market|segmentation|enterprise|b2b|b2c|adoption|conversion|north star|jtbd|jobs to be done|positioning|portfolio|q[1-4]|quarter)\b/i,
];
const INTAKE_CHECK_PATTERN = /## Intake Check|Before I commit to specific frameworks/i;
const NO_MORE_CONTEXT_PATTERNS = [
  /\b(?:i\s+(?:do not|don't)\s+have\s+(?:any|anymore|more)(?:\s+additional)?\s+(?:info(?:rmation)?|context|details))\b/i,
  /\b(?:that(?:'s| is)\s+all\s+i\s+(?:have|know))\b/i,
  /\b(?:no more (?:info(?:rmation)?|context|details))\b/i,
  /\b(?:not sure|don't know|unsure)\b/i,
];
const SIGNAL_META: Record<
  SignalKey,
  { label: string; question: string; patterns: RegExp[] }
> = {
  objective: {
    label: "decision / objective",
    question: "What exact decision or outcome do you need this recommendation to support?",
    patterns: [
      /\b(decide|decision|choose|evaluate|priorit|rank|start|launch|define|diagnose|improve|validate|align|communicat)\b/i,
      /\b(goal|objective|trying to|need to|want to)\b/i,
      /\b(optimi[sz]e|maximi[sz]e|minimi[sz]e|focus(?:ed)? on|care most about)\b/i,
      /\bto (?:build|win|increase|reduce|grow|improve|ship|launch|create|deliver)\b/i,
    ],
  },
  scope: {
    label: "options / scope being evaluated",
    question: "What options, initiatives, or product scope are actually on the table?",
    patterns: [
      /\b(option|options|initiative|initiatives|bet|bets|feature|features|roadmap|backlog|scope|vs|versus|between|tradeoff)\b/i,
      /\b(q[1-4]|quarter)\b/i,
    ],
  },
  users: {
    label: "target user / customer segment",
    question: "Who is the primary user, customer segment, or buyer involved here?",
    patterns: [
      /\b(user|users|customer|customers|segment|segments|persona|buyer|buyers|enterprise|smb|consumer|b2b|b2c)\b/i,
    ],
  },
  metrics: {
    label: "success metric / business outcome",
    question: "What metric, business outcome, or success signal matters most for this decision?",
    patterns: [
      /\b(metric|metrics|kpi|kpis|okr|okrs|revenue|conversion|retention|churn|activation|adoption|growth|margin|north star|success)\b/i,
      /(?:#\s*of|number of)\s+[a-z][a-z -]+/i,
      /\b(rfps?\s+won|contracts?\s+won|win rate|close rate|time[- ]to[- ]value|throughput|volume)\b/i,
    ],
  },
  constraints: {
    label: "timeline / resources / constraints",
    question: "What timeline, resource, team, or budget constraints shape the recommendation?",
    patterns: [
      /\b(q[1-4]|quarter|timeline|deadline|budget|capacity|resource|resources|team|effort|headcount|time|weeks?|months?)\b/i,
    ],
  },
  evidence: {
    label: "current baseline / evidence",
    question: "What does the current baseline, customer evidence, or product data already tell you?",
    patterns: [
      /\b(current|baseline|today|data|evidence|research|analytics|interview|feedback|seeing|spike|drop|trend|observed)\b/i,
    ],
  },
  risks: {
    label: "risks / assumptions / dependencies",
    question: "What assumptions, risks, or dependencies could change the recommendation?",
    patterns: [
      /\b(risk|risks|assumption|assumptions|dependency|dependencies|uncertain|uncertainty|unknown|blocker|integration|legal|security)\b/i,
    ],
  },
  stakeholders: {
    label: "stakeholders / decision owners",
    question: "Which stakeholders need alignment, approval, or have veto power here?",
    patterns: [
      /\b(stakeholder|stakeholders|leadership|exec|executive|c-suite|sales|marketing|engineering|owner|owners|alignment)\b/i,
    ],
  },
};
const CATEGORY_SIGNAL_DEFAULTS: Array<{ test: RegExp; signals: SignalKey[] }> = [
  {
    test: /prioritization/i,
    signals: ["objective", "scope", "metrics", "constraints", "risks"],
  },
  {
    test: /strategy|positioning/i,
    signals: ["objective", "users", "scope", "stakeholders", "metrics"],
  },
  {
    test: /discovery|research/i,
    signals: ["objective", "users", "evidence", "metrics", "risks"],
  },
  {
    test: /metrics|analytics/i,
    signals: ["objective", "metrics", "users", "evidence", "constraints"],
  },
  {
    test: /go-to-market|growth/i,
    signals: ["objective", "users", "metrics", "constraints", "risks", "stakeholders"],
  },
  {
    test: /planning|execution/i,
    signals: ["objective", "scope", "constraints", "stakeholders", "risks"],
  },
  {
    test: /stakeholder|communication|alignment/i,
    signals: ["objective", "stakeholders", "scope", "constraints", "risks"],
  },
];

const ORCHESTRATOR_SCHEMA = {
  name: "prodforce_framework_match",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      framework_matches: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: { type: "string" },
            reason: { type: "string" },
          },
          required: ["slug", "reason"],
        },
      },
      situation_summary: { type: "string" },
      follow_up_suggestions: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: { type: "string" },
      },
    },
    required: ["framework_matches", "situation_summary", "follow_up_suggestions"],
  },
} as const;

async function loadFrameworks(): Promise<Framework[]> {
  const all = await getCollection("toolkit");
  return all
    .filter(
      (item) =>
        item.data.dbTitle === "Frameworks" &&
        !EXCLUDED_CATEGORIES.has((item.data.primaryCategory ?? "").trim())
    )
    .map((item) => ({
      slug: item.slug,
      title: item.data.title ?? "",
      category: (item.data.primaryCategory ?? "").trim(),
      whenToUse: item.data.whenToUse ?? "",
      whenToUseFull: item.data.whenToUseFull ?? "",
      inputsRequired: item.data.inputsRequired ?? "",
      outputArtifact: item.data.outputArtifact ?? "",
      commonMistakes: item.data.commonMistakes ?? "",
      tags: (item.data.tags ?? []).join(", "),
    }));
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    )
  );
}

function latestUserMessage(messages: Message[]) {
  return messages.filter((message) => message.role === "user").slice(-1)[0]?.content ?? "";
}

function hasPmSignal(text: string, file?: FilePayload) {
  if (file) return true;
  return PM_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}

function classifyConversationMode(messages: Message[], file?: FilePayload): ConversationMode {
  const latestText = latestUserMessage(messages).trim();
  if (!latestText) return "clarify";
  if (hasPmSignal(latestText, file)) return "pm";

  // If prior messages have PM context, treat follow-ups as PM continuation
  const priorUserTexts = messages
    .filter((m) => m.role === "user")
    .slice(0, -1)
    .map((m) => m.content);
  const hasPriorPmContext = priorUserTexts.some((t) => hasPmSignal(t));
  if (hasPriorPmContext) return "pm";

  if (SMALL_TALK_PATTERNS.some((pattern) => pattern.test(latestText))) {
    return "smalltalk";
  }

  return "pm";
}

function buildDirectResponse(mode: ConversationMode, latestText: string) {
  if (mode === "smalltalk") {
    return {
      text:
        "Hey — I’m Prodforce, a multi-agent system built for product decisions. Drop me a challenge — prioritization call, launch decision, metric diagnosis, team alignment — and I’ll match it to the right PM framework and run specialist analysis on it.",
      suggestions: [
        "How do I prioritize our Q3 roadmap with competing stakeholder demands?",
        "Churn spiked after our latest release. How do I diagnose it?",
        "We’re launching an AI feature — what GTM framework fits?",
      ],
    };
  }

  // Never return this in practice anymore since classifyConversationMode
  // now routes most things to "pm", but keep as safety net
  return {
    text:
      "I’m here. Give me the product decision, and I’ll identify the framework, pressure-test it against your situation, and deliver a recommendation. What are you working through?",
    suggestions: [
      "We have 3 competing roadmap bets for next quarter. How should I evaluate them?",
      "Churn spiked after our latest release. How do I diagnose the root cause?",
      "How do I define success metrics for a platform with multiple user types?",
    ],
  };
}

function collectPmContext(messages: Message[], file?: FilePayload) {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .slice(-3)
    .map((message) => normalizeUserContextText(message.content))
    .filter(Boolean);
  const attachmentContext =
    file?.fileType === "text" ? file.content?.slice(0, 2500).trim() ?? "" : "";

  return [attachmentContext ? `[Attached context]\n${attachmentContext}` : "", ...recentUserMessages]
    .filter(Boolean)
    .join("\n\n");
}

function detectContextSignals(text: string) {
  const signals = new Set<SignalKey>();
  if (!text.trim()) return signals;

  for (const [key, meta] of Object.entries(SIGNAL_META) as Array<
    [SignalKey, (typeof SIGNAL_META)[SignalKey]]
  >) {
    if (meta.patterns.some((pattern) => pattern.test(text))) {
      signals.add(key);
    }
  }

  return signals;
}

function uniqueSignalKeys(keys: SignalKey[]) {
  return Array.from(new Set(keys));
}

function normalizeUserContextText(text: string) {
  return String(text || "")
    .replace(
      /^(?:i\s+(?:do not|don't)\s+have\s+(?:any|anymore|more)(?:\s+additional)?\s+(?:info(?:rmation)?|context|details))[\s:;,.!-]*/i,
      ""
    )
    .trim();
}

function countClarificationTurns(messages: Message[]) {
  return messages.filter(
    (message) => message.role === "assistant" && INTAKE_CHECK_PATTERN.test(message.content)
  ).length;
}

function latestUserSignals(messages: Message[]) {
  const latestText = normalizeUserContextText(latestUserMessage(messages));
  return detectContextSignals(latestText);
}

function priorUserSignals(messages: Message[], file?: FilePayload) {
  const priorMessages = messages.filter((message) => message.role === "user").slice(0, -1);
  if (!priorMessages.length) return new Set<SignalKey>();
  const context = collectPmContext(priorMessages, file);
  return detectContextSignals(context);
}

function userDeclinedMoreContext(messages: Message[]) {
  const latestText = latestUserMessage(messages);
  return NO_MORE_CONTEXT_PATTERNS.some((pattern) => pattern.test(latestText));
}

function inferContextCategories(text: string) {
  const lower = text.toLowerCase();
  const categories: string[] = [];
  if (/\b(churn|retention|drop|spike|diagnos|root cause|incident|regression|release issue|support tickets?)\b/.test(lower)) {
    categories.push("Metrics & Analytics", "Discovery & Delivery");
  }
  if (/\b(roadmap|priorit|tradeoff|bet|bets|portfolio|backlog|rank|compare|competing)\b/.test(lower)) {
    categories.push("Prioritization & Decision Systems", "Roadmap & Portfolio");
  }
  if (/\b(vision|strategy|positioning|north star|align|alignment)\b/.test(lower)) {
    categories.push("Strategy & Positioning");
  }
  if (/\b(discovery|research|interview|customer|user|validate|opportunity)\b/.test(lower)) {
    categories.push("Discovery & Delivery");
  }
  if (/\b(metric|metrics|kpi|okr|measure|success|analytics)\b/.test(lower)) {
    categories.push("Metrics & Analytics");
  }
  if (/\b(launch|go-to-market|go to market|gtm|pricing|adoption|retention|churn|expansion)\b/.test(lower)) {
    categories.push("GTM & Growth");
  }
  if (/\b(stakeholder|decision|execution|retro|cadence|approval)\b/.test(lower)) {
    categories.push("Operating Cadence & Alignment");
  }
  return Array.from(new Set(categories)).slice(0, 4);
}

function splitFrameworkInputs(text: string) {
  const cleaned = text
    .replace(/[•\u2022]/g, ",")
    .replace(/\band\b/gi, ",")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const parts = cleaned
    .split(/[,;/|\n]+/g)
    .map((part) => part.trim().replace(/^[-:]+|[-:]+$/g, ""))
    .filter((part) => part.length > 2);

  const uniqueParts = Array.from(new Set(parts.map((part) => part.trim())));
  return (uniqueParts.length ? uniqueParts : [cleaned]).slice(0, 6);
}

function inferFrameworkSignals(framework: Framework): SignalKey[] {
  const baseSignals =
    CATEGORY_SIGNAL_DEFAULTS.find((entry) => entry.test.test(framework.category))?.signals ?? [
      "objective",
      "scope",
      "metrics",
      "constraints",
    ];

  const frameworkText = [
    framework.title,
    framework.category,
    framework.whenToUse,
    framework.whenToUseFull,
    framework.inputsRequired,
    framework.outputArtifact,
    framework.commonMistakes,
    framework.tags,
  ]
    .filter(Boolean)
    .join(" ");

  const inferredFromText = (
    Object.entries(SIGNAL_META) as Array<[SignalKey, (typeof SIGNAL_META)[SignalKey]]>
  )
    .filter(([, meta]) => meta.patterns.some((pattern) => pattern.test(frameworkText)))
    .map(([key]) => key);

  const keywordSignals: SignalKey[] = [];
  if (/\b(reach|impact|confidence|effort|priority|prioritization|tradeoff|portfolio)\b/i.test(frameworkText)) {
    keywordSignals.push("scope", "metrics", "constraints", "risks");
  }
  if (/\b(vision|north star|positioning|strategy|differentiation)\b/i.test(frameworkText)) {
    keywordSignals.push("users", "stakeholders");
  }
  if (/\b(customer|persona|segment|market|jobs to be done|jtbd)\b/i.test(frameworkText)) {
    keywordSignals.push("users");
  }
  if (/\b(interview|research|evidence|analytics|baseline|data)\b/i.test(frameworkText)) {
    keywordSignals.push("evidence");
  }
  if (/\b(risk|assumption|dependency|constraint|budget|capacity|timeline)\b/i.test(frameworkText)) {
    keywordSignals.push("constraints", "risks");
  }
  if (/\b(align|stakeholder|approval|exec|leadership)\b/i.test(frameworkText)) {
    keywordSignals.push("stakeholders");
  }

  return uniqueSignalKeys([...baseSignals, ...inferredFromText, ...keywordSignals]).slice(0, 6);
}

function buildFrameworkCoverage(framework: Framework, presentSignals: Set<SignalKey>): FrameworkCoverage {
  const requiredSignalKeys = inferFrameworkSignals(framework);
  const requiredInputs = splitFrameworkInputs(framework.inputsRequired);
  const presentInputs = requiredSignalKeys
    .filter((key) => presentSignals.has(key))
    .map((key) => SIGNAL_META[key].label);
  const missingInputs = requiredSignalKeys
    .filter((key) => !presentSignals.has(key))
    .map((key) => SIGNAL_META[key].label);
  const coverageRatio =
    requiredSignalKeys.length > 0 ? presentInputs.length / requiredSignalKeys.length : 1;

  let confidence: FrameworkCoverage["confidence"] = "low";
  if (coverageRatio >= 0.8 && missingInputs.length <= 1) {
    confidence = "high";
  } else if (coverageRatio >= 0.55 && missingInputs.length <= 2) {
    confidence = "medium";
  }

  let readinessLabel = "Needs deeper intake before scoring";
  if (missingInputs.length === 0) {
    readinessLabel = "Ready to apply";
  } else if (missingInputs.length === 1) {
    readinessLabel = "Nearly ready";
  } else if (missingInputs.length === 2) {
    readinessLabel = "Needs targeted clarification";
  }

  return {
    requiredInputs:
      requiredInputs.length > 0
        ? requiredInputs
        : requiredSignalKeys.map((key) => SIGNAL_META[key].label),
    presentInputs,
    missingInputs,
    confidence,
    readinessLabel,
    requiredSignalKeys,
  };
}

function summarizeSituation(messages: Message[], file?: FilePayload) {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => normalizeUserContextText(message.content))
    .filter(Boolean);
  const attachmentLead =
    file?.fileType === "text" && file.content
      ? `Attached context: ${file.content.slice(0, 180).trim()}`
      : "";
  const summary = [attachmentLead, ...recentUserMessages].filter(Boolean).join(" ");
  if (!summary) {
    return "I have a PM question, but not enough context yet to pick the right framework.";
  }
  return summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
}

function inferScenarioContext(
  messages: Message[],
  file: FilePayload | undefined,
  candidateFrameworks: Framework[],
  candidateCategories: string[]
): ScenarioContext {
  const lowerText = collectPmContext(messages, file).toLowerCase();
  const categories = candidateCategories.map((category) => category.toLowerCase());
  const frameworkTitles = candidateFrameworks
    .slice(0, 4)
    .map((framework) => framework.title.toLowerCase());
  const categoryText = categories.join(" ");
  const frameworkText = frameworkTitles.join(" ");

  return {
    lowerText,
    categories,
    frameworkTitles,
    isPrioritization:
      /\b(priorit|roadmap|bet|bets|tradeoff|trade-off|rank|ranking|portfolio|capacity)\b/.test(
        lowerText
      ) || /\bprioritization|roadmap\b/.test(categoryText),
    isDiagnostic:
      /\b(churn|drop|spike|diagnos|root cause|incident|issue|problem|regression|release)\b/.test(
        lowerText
      ) || /\bmetrics|analytics\b/.test(categoryText),
    isLaunch:
      /\b(launch|go-to-market|go to market|gtm|rollout|ship|release)\b/.test(lowerText) ||
      /\bgtm|growth\b/.test(categoryText),
    isAlignment:
      /\b(align|alignment|stakeholder|stakeholders|decision rights|veto|sign-off)\b/.test(
        lowerText
      ) || /\balignment|operating cadence\b/.test(categoryText),
    isStrategy:
      /\b(vision|strategy|positioning|north star|differentiat|market entry|segment)\b/.test(
        lowerText
      ) || /\bstrategy|positioning\b/.test(categoryText),
    isResearch:
      /\b(discovery|research|interview|persona|jtbd|jobs to be done|validate|evidence)\b/.test(
        lowerText
      ) || /\bdiscovery|delivery\b/.test(categoryText),
    isGrowth:
      /\b(retention|adoption|growth|funnel|activation|conversion|pricing)\b/.test(lowerText) ||
      /\bgrowth|gtm\b/.test(categoryText),
    isAi:
      /\b(ai|model|copilot|assistant|hallucinat|safety|privacy|prompt|llm)\b/.test(lowerText) ||
      /\bai\b/.test(categoryText),
    isEnterprise:
      /\b(enterprise|b2b|buyer|procurement|deal|sales|rfp|government|proposal)\b/.test(
        lowerText
      ) || /\bmarket|sizing\b/.test(categoryText),
    isPricing:
      /\b(pricing|packaging|plan|sku|monetiz)\b/.test(lowerText) ||
      /\bpricing\b/.test(frameworkText),
  };
}

function buildDynamicClarificationQuestion(key: SignalKey, scenario: ScenarioContext) {
  switch (key) {
    case "objective":
      if (scenario.isPrioritization) {
        return "What decision are you actually trying to make: pick the top bet, rank all options, or decide what ships first?";
      }
      if (scenario.isDiagnostic) {
        return "Do you need to explain the issue, stop the problem quickly, or decide which fix to prioritize first?";
      }
      if (scenario.isLaunch) {
        return "Is the call about whether to launch, how to position the release, or what rollout plan to use?";
      }
      if (scenario.isStrategy || scenario.isAlignment) {
        return "What decision should this recommendation unlock: strategic direction, target market choice, or stakeholder alignment?";
      }
      if (scenario.isEnterprise) {
        return "What exact business decision are you trying to support here: build the capability, sequence it, or justify the investment?";
      }
      return SIGNAL_META[key].question;
    case "scope":
      if (scenario.isPrioritization) {
        return "What are the actual bets, initiatives, or roadmap options on the table right now?";
      }
      if (scenario.isDiagnostic) {
        return "What fix paths are you considering: rollback, targeted UX change, operational response, or a deeper product change?";
      }
      if (scenario.isLaunch) {
        return "Which parts of the launch are in scope for this decision: positioning, packaging, channels, enablement, or rollout timing?";
      }
      return SIGNAL_META[key].question;
    case "users":
      if (scenario.isDiagnostic && /\bchurn|retention|drop\b/.test(scenario.lowerText)) {
        return "Which cohort or segment is feeling this most: new users, activated accounts, enterprise customers, or a specific buyer group?";
      }
      if (scenario.isEnterprise) {
        return "Who is the primary user and who is the economic buyer here: operators, sales, proposal writers, admins, or an executive sponsor?";
      }
      if (scenario.isLaunch || scenario.isGrowth) {
        return "Which user segment or buyer motion is this recommendation mainly for?";
      }
      return SIGNAL_META[key].question;
    case "metrics":
      if (scenario.isPrioritization) {
        return "Which outcome matters most for this tradeoff: revenue, retention, activation, strategic learning, or delivery confidence?";
      }
      if (scenario.isDiagnostic) {
        return "Which signal moved most and should anchor the diagnosis: churn, retention by cohort, revenue impact, support volume, or conversion?";
      }
      if (scenario.isLaunch) {
        return "What launch outcome matters most: adoption, activation, pipeline, conversion, expansion, or revenue?";
      }
      if (scenario.isEnterprise) {
        return "What business outcome matters most here: win rate, RFPs won, deal size, cycle time, or proposal throughput?";
      }
      return SIGNAL_META[key].question;
    case "constraints":
      if (scenario.isPrioritization) {
        return "What deadlines, resourcing limits, or dependencies make this prioritization call harder?";
      }
      if (scenario.isDiagnostic) {
        return "Do you need a fast mitigation this week, or do you have room for a deeper diagnosis over the next sprint?";
      }
      if (scenario.isLaunch) {
        return "What date, budget, or cross-functional constraints are fixed for this launch?";
      }
      return SIGNAL_META[key].question;
    case "evidence":
      if (scenario.isDiagnostic) {
        return "What changed in the release, funnel, support tickets, or usage data right before the issue showed up?";
      }
      if (scenario.isResearch) {
        return "What customer evidence or product signal do you already have: interviews, usage data, win-loss notes, or experiment results?";
      }
      if (scenario.isEnterprise) {
        return "What evidence already exists from deal reviews, sales feedback, usage, or customer pain around this workflow?";
      }
      return SIGNAL_META[key].question;
    case "risks":
      if (scenario.isAi) {
        return "What risk could change the recommendation most: model quality, trust, privacy, compliance, or operational readiness?";
      }
      if (scenario.isDiagnostic) {
        return "What is the biggest risk in the diagnosis itself: wrong segment, noisy data, release confounders, or a fix that could make churn worse?";
      }
      if (scenario.isLaunch) {
        return "What could derail the launch most: messaging risk, low readiness, pricing confusion, or operational dependencies?";
      }
      if (scenario.isEnterprise) {
        return "What could make this underperform: low adoption, integration complexity, weak buyer pull, or delivery risk?";
      }
      return SIGNAL_META[key].question;
    case "stakeholders":
      if (scenario.isAlignment || scenario.isStrategy) {
        return "Who owns the call, and which leaders or partner teams need alignment before you can commit?";
      }
      if (scenario.isLaunch) {
        return "Which teams need to sign off or stay aligned here: product, marketing, sales, success, support, or leadership?";
      }
      return SIGNAL_META[key].question;
    default:
      return "What is the highest-leverage missing detail that would change the recommendation?";
  }
}

function buildClarificationMessage(assessment: IntakeAssessment) {
  const questions = assessment.clarificationQuestions.slice(0, 3);
  const present = assessment.presentSignals;
  const hasSome = present.size > 0;
  const summary = assessment.situationSummary;

  // Acknowledge what we understood
  const ack = hasSome
    ? `**Got it** — ${summary}`
    : `**Understood.** Let me dig in so I can match the right framework.`;

  // Ask contextually — just the first question inline, rest as chips
  if (questions.length === 1) {
    return `${ack}\n\n${questions[0]}`;
  }

  // For multiple questions, lead with the most important one naturally
  const lead = questions[0];
  return `${ack}\n\nBefore I lock a framework, I want to ground the highest-leverage missing detail first:\n\n${lead}`;
}

function buildSuggestedReplies(
  askedSignalKeys: SignalKey[],
  scenario: ScenarioContext
): string[] {
  const context = scenario.lowerText;
  const replies: string[] = [];

  for (const key of askedSignalKeys.slice(0, 3)) {
    if (key === "objective") {
      if (scenario.isPrioritization) {
        replies.push("We need to choose the top 2 bets for next quarter.");
      } else if (scenario.isDiagnostic) {
        replies.push("The goal is to find the root cause and decide the first fix.");
      } else if (scenario.isLaunch) {
        replies.push("We are deciding whether to launch now or tighten the rollout first.");
      } else if (scenario.isEnterprise) {
        replies.push("The goal is to win more government RFPs without slowing the proposal workflow.");
      } else {
        replies.push("The goal is to make the best product decision with the context we have.");
      }
    } else if (key === "metrics") {
      if (scenario.isEnterprise) {
        replies.push("Success is more RFPs won, higher win rate, and faster proposal turnaround.");
      } else if (scenario.isDiagnostic) {
        replies.push("We are watching churn, cohort retention, and support-ticket volume.");
      } else if (scenario.isLaunch) {
        replies.push("Success is activation, adoption, and pipeline generated in the first 60 days.");
      } else {
        replies.push("The key metrics are activation rate, retention, and business impact.");
      }
    } else if (key === "users") {
      if (/enterprise|b2b/.test(context))
        replies.push("Enterprise buyers — mostly VP/Director level");
      else if (/consumer|b2c/.test(context))
        replies.push("Consumer users, ages 25-40, mobile-first");
      else replies.push("Mid-market SaaS teams with 50-200 employees");
    } else if (key === "constraints") {
      replies.push("We have about 6 weeks and a team of 4 engineers");
    } else if (key === "risks") {
      replies.push("Biggest risk is that we don't have enough customer evidence yet");
    } else if (key === "stakeholders") {
      replies.push("VP of Product and the CTO need to sign off");
    } else if (key === "scope") {
      replies.push("We're comparing three different approaches right now");
    } else if (key === "evidence") {
      replies.push("We have usage data from the last 90 days and 12 customer interviews");
    }
  }

  return Array.from(new Set(replies)).slice(0, 3);
}

function buildClarificationMessageV2(assessment: IntakeAssessment) {
  const questions = assessment.clarificationQuestions.slice(0, 3);
  const present = assessment.presentSignals;
  const hasSome = present.size > 0;
  const summary = assessment.situationSummary;
  const likelyFrameworks = assessment.candidateFrameworks
    .slice(0, 3)
    .map((framework) => framework.title)
    .filter(Boolean);
  const ack = hasSome
    ? `**Got it** â€” ${summary}`
    : `**Understood.** Let me dig in so I can match the right framework.`;
  const frameworkLead = likelyFrameworks.length
    ? `I am currently pressure-testing **${likelyFrameworks.join("**, **")}** against your situation.`
    : "";

  if (questions.length === 1) {
    return `${ack}${frameworkLead ? `\n\n${frameworkLead}` : ""}\n\n${questions[0]}`;
  }

  const lead = questions[0];
  return (
    `${ack}${frameworkLead ? `\n\n${frameworkLead}` : ""}\n\n` +
    "Before I lock the recommendation, I want to ground the highest-leverage missing detail first:\n\n" +
    `${lead}`
  );
}

function buildClarificationMessageV3(assessment: IntakeAssessment) {
  const questions = assessment.clarificationQuestions.slice(0, 3);
  const likelyFrameworks = assessment.candidateFrameworks
    .slice(0, 3)
    .map((framework) => framework.title)
    .filter(Boolean);

  // Framework context — mention what we're considering
  const fwContext = likelyFrameworks.length
    ? `I'm currently pressure-testing **${likelyFrameworks.join("**, **")}** against your situation.\n\n`
    : "";

  // Ask just ONE question — the rest come as clickable chips
  const lead = questions[0] || "What's the core decision you need to make here?";
  return `${fwContext}${lead}`;
}

function buildGroundedSuggestedReplies(
  askedSignalKeys: SignalKey[],
  scenario: ScenarioContext,
  contextText: string
): string[] {
  const context = contextText.replace(/\s+/g, " ").trim();
  const lower = context.toLowerCase();
  const replies: string[] = [];
  const push = (value: string | undefined) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (clean && clean.length <= 160) replies.push(clean);
  };
  const extract = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (!match) continue;
      const raw = String(match[1] || match[0] || "").replace(/^[:\s-]+/, "").trim();
      if (raw) return raw;
    }
    return "";
  };

  for (const key of askedSignalKeys.slice(0, 3)) {
    if (key === "objective") {
      if (scenario.isDiagnostic && /\b(churn|retention|drop|spike|regression)\b/.test(lower)) {
        push("The goal is to isolate the root cause and decide the first corrective move.");
      } else if (scenario.isDiagnostic) {
        push("The goal is to explain the issue clearly enough to choose the right first fix.");
      } else if (scenario.isLaunch) {
        push("The goal is to decide whether the launch plan is strong enough to move forward.");
      } else if (scenario.isEnterprise) {
        push("The goal is to improve the proposal workflow in a way that increases RFP wins.");
      }
    } else if (key === "metrics") {
      if (/\brfps?\s+won\b/.test(lower)) {
        push("Success is more RFPs won and a higher proposal win rate.");
      } else if (scenario.isDiagnostic) {
        if (/\bchurn\b/.test(lower)) push("The core signal is churn, broken down by affected cohort.");
        if (/\bretention\b/.test(lower)) push("Retention by cohort is one of the main metrics to watch.");
      } else if (scenario.isLaunch) {
        if (/\badoption\b/.test(lower)) push("Adoption is one of the key launch success signals.");
        if (/\bactivation\b/.test(lower)) push("Activation is one of the key launch success signals.");
      }
    } else if (key === "users") {
      if (/\bproposals team\b/i.test(context)) {
        push("Primary user is the Proposals team.");
      } else if (/\bproposal writers?\b/i.test(context)) {
        push("Primary users are proposal writers.");
      } else if (/\benterprise customers?\b/i.test(context)) {
        push("The affected segment is enterprise customers.");
      } else if (/\bnew users?\b/i.test(context)) {
        push("The affected cohort is new users.");
      } else if (/\bactivated accounts?\b/i.test(context)) {
        push("The affected cohort is activated accounts.");
      } else if (/\bgovernment\b|\brfp\b/i.test(context)) {
        push("The user is the internal proposal workflow team serving government deals.");
      }
    } else if (key === "constraints") {
      const timeline = extract([
        /\b(?:in|within|over|for)\s+((?:the\s+next\s+)?\d+\s+(?:days?|weeks?|months?|quarters?))/i,
        /\b((?:q[1-4]|next quarter|this quarter|next sprint|this sprint))/i,
      ]);
      const team = extract([/\b(team of\s+\d+(?:\s+\w+)?)/i, /\b(\d+\s+engineers?)/i]);
      if (timeline) push("Timeline constraint: " + timeline + ".");
      if (team) push("Resourcing constraint: " + team + ".");
    } else if (key === "risks") {
      if (/\bprivacy|compliance|security|trust\b/.test(lower)) {
        push("A major risk is trust, privacy, or compliance blocking adoption.");
      } else if (/\bintegration|dependency\b/.test(lower)) {
        push("Integration dependencies could change the recommendation.");
      }
    } else if (key === "stakeholders") {
      const stakeholder = extract([
        /\b(vp of [a-z ]+|head of [a-z ]+|cto|ceo|cpo|sales leadership|marketing leadership|engineering leadership)\b/i,
      ]);
      if (stakeholder) push("Key stakeholder: " + stakeholder + ".");
    } else if (key === "scope") {
      const options = extract([
        /\b((?:three|3|four|4|two|2)\s+(?:options|bets|initiatives|approaches))/i,
        /\bcomparing\s+([^.;]+)/i,
      ]);
      if (options) push("Scope in play: " + options + ".");
    } else if (key === "evidence") {
      if (/\bspiked after (?:our|the) latest release\b/i.test(context)) {
        push("We saw the change immediately after the latest release.");
      } else if (/\blatest release\b/i.test(context) && /\bchurn\b/i.test(context)) {
        push("The churn change appears tied to the latest release window.");
      } else if (/\binterviews?\b|\bsupport tickets?\b|\busage data\b|\banalytics\b/i.test(context)) {
        const evidence = extract([
          /\b((?:\d+\s+customer\s+)?interviews?)\b/i,
          /\b((?:\d+\s+)?support tickets?)\b/i,
          /\b(usage data)\b/i,
          /\b(analytics)\b/i,
        ]);
        if (evidence) push("Existing evidence includes " + evidence + ".");
      }
    }
  }

  return Array.from(new Set(replies)).slice(0, 3);
}

function assessFrameworkReadiness(
  frameworkPool: Framework[],
  messages: Message[],
  file: FilePayload | undefined
): IntakeAssessment {
  const candidateFrameworks = selectFrameworkCandidates(frameworkPool, messages, file, 6).slice(0, 4);
  const context = collectPmContext(messages, file);
  const presentSignals = detectContextSignals(context);
  const clarificationTurns = countClarificationTurns(messages);
  const latestSignals = latestUserSignals(messages);
  const previousSignals = priorUserSignals(messages, file);
  const introducedSignals = Array.from(latestSignals).filter((key) => !previousSignals.has(key));
  const latestTokenCount = tokenize(normalizeUserContextText(latestUserMessage(messages))).length;
  const exhaustedContext = userDeclinedMoreContext(messages);
  const coverageBySlug = Object.fromEntries(
    candidateFrameworks.map((framework) => [
      framework.slug,
      buildFrameworkCoverage(framework, presentSignals),
    ])
  ) as Record<string, FrameworkCoverage>;

  const candidateCategories = Array.from(
    new Set(
      inferContextCategories(context).concat(
        candidateFrameworks.map((framework) => framework.category).filter(Boolean)
      )
    )
  ).slice(0, 5);

  const missingCounts = new Map<SignalKey, number>();
  candidateFrameworks.slice(0, 3).forEach((framework, index) => {
    const coverage = coverageBySlug[framework.slug];
    const weight = index === 0 ? 3 : index === 1 ? 2 : 1;
    coverage.requiredSignalKeys.forEach((key, signalIndex) => {
      if (presentSignals.has(key)) return;
      const criticalBoost = signalIndex < 2 ? 1 : 0;
      missingCounts.set(key, (missingCounts.get(key) ?? 0) + weight + criticalBoost);
    });
  });

  const prioritizedMissing = Array.from(missingCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const topCoverage = candidateFrameworks[0] ? coverageBySlug[candidateFrameworks[0].slug] : null;
  const topCriticalMissing =
    topCoverage?.requiredSignalKeys.slice(0, 2).filter((key) => !presentSignals.has(key)) ?? [];
  const detailTokenCount = tokenize(context).length;
  const shouldProceedProvisionally =
    clarificationTurns > 0 &&
    (exhaustedContext ||
      introducedSignals.length > 0 ||
      latestSignals.size >= 2 ||
      latestTokenCount >= 8);
  const shouldClarify =
    candidateFrameworks.length > 0 &&
    !shouldProceedProvisionally &&
    (presentSignals.size < 3 ||
      topCriticalMissing.length > 0 ||
      (topCoverage?.missingInputs.length ?? 0) >= 3 ||
      ((topCoverage?.confidence === "medium" || topCoverage?.confidence === "low") &&
        detailTokenCount < 18));
  const scenario = inferScenarioContext(messages, file, candidateFrameworks, candidateCategories);
  const fallbackQuestions = buildHeuristicSuggestions(normalizeUserContextText(latestUserMessage(messages)));
  const askedSignalKeys = prioritizedMissing.slice(0, 3);
  const clarificationQuestions = askedSignalKeys.map((key) =>
    buildDynamicClarificationQuestion(key, scenario)
  );
  const missingInformation = prioritizedMissing
    .slice(0, 4)
    .map((key) => SIGNAL_META[key].label);
  const askedInformation = askedSignalKeys.length
    ? askedSignalKeys.map((key) => SIGNAL_META[key].label)
    : missingInformation.slice(0, 3);
  const deferredInformation = prioritizedMissing
    .slice(3, 6)
    .map((key) => SIGNAL_META[key].label);
  const suggestedReplies = buildGroundedSuggestedReplies(askedSignalKeys, scenario, context);

  return {
    shouldClarify,
    situationSummary: summarizeSituation(messages, file),
    missingInformation:
      missingInformation.length > 0
        ? missingInformation
        : ["decision / objective", "success metric / business outcome"],
    clarificationQuestions:
      clarificationQuestions.length > 0 ? clarificationQuestions : fallbackQuestions.slice(0, 3),
    candidateCategories,
    presentSignals,
    candidateFrameworks,
    coverageBySlug,
    askedSignalKeys,
    askedInformation,
    deferredInformation,
    suggestedReplies,
  };
}

function selectFrameworkCandidates(
  frameworks: Framework[],
  messages: Message[],
  file: FilePayload | undefined,
  limit = ORCHESTRATOR_CANDIDATE_LIMIT
) {
  const latestUserContext = messages
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content)
    .join(" ");
  const attachmentContext =
    file?.fileType === "text" ? ` ${file.content?.slice(0, 2000) ?? ""}` : "";
  const queryTokens = tokenize(`${latestUserContext}${attachmentContext}`);
  const lowerContext = `${latestUserContext}${attachmentContext}`.toLowerCase();
  const intentSignals = {
    prioritization: /\b(priorit|roadmap|tradeoff|backlog|bet|bets|capacity|rank|ranking|evaluate|portfolio)\b/.test(lowerContext),
    strategy: /\b(vision|strategy|positioning|north star|mission|align|alignment|differentiat)\b/.test(lowerContext),
    discovery: /\b(discover|discovery|research|interview|customer|user|validate|opportunity|problem)\b/.test(lowerContext),
    metrics: /\b(metric|metrics|kpi|okrs?|analytics|measure|success)\b/.test(lowerContext),
    diagnostic: /\b(churn|drop|spike|diagnos|root cause|regression|incident|release|support ticket|bug)\b/.test(lowerContext),
    gtm: /\b(launch|go-to-market|go to market|gtm|pricing|churn|retention|activation|adoption|sales|market)\b/.test(lowerContext),
    execution: /\b(stakeholder|retro|retrospective|postmortem|scrum|cadence|decision|escalation|execution)\b/.test(lowerContext),
    multipleOptions: /\b(competing|compare|comparison|versus|vs|bet one|bet two|bet three|option|options)\b/.test(lowerContext),
  };

  if (queryTokens.length === 0) {
    return frameworks.slice(0, limit);
  }

  const ranked = frameworks
    .map((framework) => {
      const titleTokens = new Set(tokenize(`${framework.title} ${framework.category}`));
      const detailText = `${framework.whenToUse} ${framework.tags}`;
      const detailTokens = new Set(tokenize(detailText));
      const haystack = `${framework.title} ${framework.category} ${detailText}`.toLowerCase();
      const category = framework.category.toLowerCase();
      const identity = `${framework.title} ${framework.slug}`.toLowerCase();

      let score = 0;
      for (const token of queryTokens) {
        if (titleTokens.has(token)) score += 8;
        if (detailTokens.has(token)) score += 4;
        if (haystack.includes(token)) score += 1;
      }

      if (
        intentSignals.diagnostic &&
        (category.includes("metrics") ||
          category.includes("discovery") ||
          identity.includes("retention") ||
          identity.includes("churn") ||
          identity.includes("measurement") ||
          identity.includes("instrumentation") ||
          identity.includes("experiment"))
      ) {
        score += 22;
      }
      if (
        intentSignals.prioritization &&
        (category.includes("prioritization") ||
          category.includes("roadmap") ||
          identity.includes("rice") ||
          identity.includes("tradeoff") ||
          identity.includes("moscow") ||
          identity.includes("cost-benefit") ||
          identity.includes("quarterly planning"))
      ) {
        score += 20;
      }
      if (
        intentSignals.prioritization &&
        intentSignals.multipleOptions &&
        (category.includes("prioritization") ||
          category.includes("roadmap") ||
          identity.includes("rice") ||
          identity.includes("tradeoff") ||
          identity.includes("cost-benefit"))
      ) {
        score += 18;
      }
      if (
        intentSignals.strategy &&
        (category.includes("strategy") ||
          identity.includes("vision") ||
          identity.includes("north star") ||
          identity.includes("positioning"))
      ) {
        score += 20;
      }
      if (
        intentSignals.discovery &&
        (category.includes("discovery") ||
          identity.includes("research") ||
          identity.includes("interview") ||
          identity.includes("opportunity") ||
          identity.includes("jtbd"))
      ) {
        score += 20;
      }
      if (
        intentSignals.metrics &&
        (category.includes("metrics") ||
          identity.includes("metric") ||
          identity.includes("kpi") ||
          identity.includes("okr"))
      ) {
        score += 20;
      }
      if (
        intentSignals.gtm &&
        (category.includes("go-to-market") ||
          category.includes("growth") ||
          identity.includes("launch") ||
          identity.includes("pricing") ||
          identity.includes("retention") ||
          identity.includes("gtm"))
      ) {
        score += 20;
      }
      if (
        intentSignals.diagnostic &&
        (identity.includes("cost-to-serve") ||
          identity.includes("pricing") ||
          identity.includes("gtm strategy"))
      ) {
        score -= 12;
      }
      if (
        intentSignals.execution &&
        (category.includes("alignment") ||
          identity.includes("stakeholder") ||
          identity.includes("retro") ||
          identity.includes("scrum") ||
          identity.includes("decision"))
      ) {
        score += 14;
      }

      return { framework, score };
    })
    .sort((a, b) => b.score - a.score || a.framework.title.localeCompare(b.framework.title));

  const positive = ranked.filter((item) => item.score > 0).slice(0, limit);
  if (positive.length >= Math.min(6, limit)) {
    return positive.map((item) => item.framework);
  }

  return ranked.slice(0, limit).map((item) => item.framework);
}

function getFrameworkCandidates(
  provider: Provider,
  frameworks: Framework[],
  messages: Message[],
  file: FilePayload | undefined
) {
  return provider.kind === "groq"
    ? selectFrameworkCandidates(frameworks, messages, file)
    : frameworks;
}

function buildHeuristicReason(framework: Framework, text: string) {
  const lower = text.toLowerCase();
  const identity = `${framework.title} ${framework.slug}`.toLowerCase();

  if ((/\broadmap|\bpriorit|\bbets?\b|\bevaluate\b/.test(lower)) && identity.includes("rice")) {
    return "Use RICE Scoring to compare reach, impact, confidence, and effort across the competing options.";
  }
  if ((/\broadmap|\bpriorit|\bbets?\b|\btradeoff\b/.test(lower)) && identity.includes("tradeoff")) {
    return "Use a 2x2 tradeoff matrix to visualize value versus effort across the competing options.";
  }
  if ((/\bvision\b|\balign\b|\balignment\b/.test(lower)) && identity.includes("vision")) {
    return "Use the Product Vision Framework to align the team on who the product is for, the problem it solves, and the strategic bets behind it.";
  }
  if ((/\blaunch\b|\bgo-to-market\b|\bgtm\b/.test(lower)) && identity.includes("gtm")) {
    return "Use this framework to structure launch goals, channels, risks, and cross-functional execution for the release.";
  }
  if ((/\bmetric\b|\bkpi\b|\bmeasure\b|\bsuccess\b/.test(lower)) && /\bmetric|\bkpi|\bokr/.test(identity)) {
    return "Use this framework to define the success metrics, tradeoffs, and measurement plan for the decision.";
  }

  return framework.whenToUse
    ? `Strong fit because ${framework.whenToUse.charAt(0).toLowerCase()}${framework.whenToUse.slice(1)}`
    : `Strong fit for this PM challenge based on the decision context you described.`;
}

function buildHeuristicSuggestions(text: string) {
  const lower = text.toLowerCase();

  if (/\broadmap|\bpriorit|\bbets?\b|\bevaluate\b/.test(lower)) {
    return [
      "What outcome are you optimizing for across these options?",
      "What are the expected impact, effort, and confidence levels for each bet?",
      "Are there deadlines, dependencies, or strategic commitments that change the tradeoff?",
    ];
  }

  if (/\bvision\b|\balign\b|\balignment\b/.test(lower)) {
    return [
      "Who is the primary user or customer the product vision should serve?",
      "What problem should the team rally around solving first?",
      "What non-goals or boundaries would help reduce stakeholder disagreement?",
    ];
  }

  return [
    "What outcome matters most in this decision?",
    "What constraints or risks are most important here?",
    "How will you know the recommendation worked?",
  ];
}

function buildHeuristicOrchestratorResult(
  frameworks: Framework[],
  messages: Message[],
  file: FilePayload | undefined
): OrchestratorResult {
  const latestText = latestUserMessage(messages);
  const candidates = selectFrameworkCandidates(frameworks, messages, file);
  const selected = candidates.slice(0, Math.min(2, candidates.length));

  return {
    framework_matches: selected.map((framework) => ({
      slug: framework.slug,
      reason: buildHeuristicReason(framework, latestText),
    })),
    situation_summary: latestText || "User described a PM challenge that needs a framework-based recommendation.",
    follow_up_suggestions: buildHeuristicSuggestions(latestText),
  };
}

function mentionsLabeledOptions(text: string) {
  return /\b(?:option|bet)\s+(?:[a-z]|\d+|one|two|three|four|five|alpha|beta|gamma)\b/i.test(text);
}

function hallucinatesOptionLabels(output: string, userText: string) {
  return !mentionsLabeledOptions(userText) && /\b(?:option|bet)\s+(?:[a-z]|\d+|one|two|three|four|five|alpha|beta|gamma)\b/i.test(output);
}

function containsTemplatePlaceholders(text: string) {
  return /\[(?:insert|add|fill|tbd|todo)[^\]]*\]/i.test(text) || /\bTBD\b/i.test(text);
}

function buildSpecialistFallbackAnalysis(framework: Framework) {
  const inputs = framework.inputsRequired || "impact, effort, risk, constraints, and strategic fit";
  const artifact = framework.outputArtifact || "a clear decision and rationale";
  const pitfall = framework.commonMistakes || "relying on opinion without validating assumptions";

  return [
    `- Apply **${framework.title}** directly to the options you are comparing rather than debating them informally.`,
    `- Gather the missing inputs first: **${inputs}**.`,
    `- Use the framework to produce **${artifact}** so the tradeoff is explicit.`,
    `- Watch for this common mistake: **${pitfall}**.`,
  ].join("\n");
}

function buildFallbackSynthesis(
  specialistResults: Array<{ framework: Framework; analysis: string }>
) {
  const leadFramework = specialistResults[0]?.framework.title ?? "the selected framework";
  const sections = specialistResults
    .map(
      (result) =>
        `## ${result.framework.title} Application\n${result.analysis}`
    )
    .join("\n\n");

  return (
    `## Executive Summary\nStart with **${leadFramework}** and treat the recommendation as provisional until you score the options with real inputs.\n\n` +
    `${sections}\n\n` +
    "## Recommended Next Steps\n" +
    "1. List the options, constraints, and success criteria in one place.\n" +
    "2. Run the chosen framework with real impact, effort, and risk inputs.\n" +
    "3. Review the output with stakeholders and commit to one decision or next experiment this week."
  );
}

function buildOrchestratorPrompt(frameworks: Framework[]): string {
  const fwIndex = frameworks
    .map(
      (f) =>
        `[${f.slug}]\n  Title: ${f.title}\n  Category: ${f.category}\n  When to use: ${f.whenToUse}`
    )
    .join("\n\n");

  return `You are the Prodforce Orchestrator, a senior PM strategist embedded in an enterprise product intelligence system.

Your only job in this step:
1. Understand the user's exact PM situation.
2. Select the 1 to 3 best-fit frameworks from the library below.
3. Return only the structured data requested.

Selection rules:
- Precision over coverage. Do not over-select.
- Use only exact framework slugs from the library below.
- Choose frameworks that solve the user's actual decision, ambiguity, or execution problem.
- Make every reason specific to the user's context, not generic PM advice.
- Follow-up questions should help sharpen the next recommendation.

AVAILABLE FRAMEWORKS (${frameworks.length} total):
${fwIndex}

Return only JSON. No markdown. No prose before or after the JSON object.`;
}

function buildSpecialistPrompt(fw: Framework, coverage?: FrameworkCoverage): string {
  const readinessContext = coverage
    ? `\nCurrent intake coverage:\n- Confirmed from the user: ${coverage.presentInputs.join(", ") || "none clearly confirmed yet"}\n- Still missing or weak: ${coverage.missingInputs.join(", ") || "no major gaps"}\n- Readiness: ${coverage.readinessLabel}`
    : "";

  return `You are a specialist AI agent for the "${fw.title}" framework (${fw.category}), operating inside the Prodforce multi-agent PM intelligence pipeline.

Framework specification:
- When to use: ${fw.whenToUse}
${fw.whenToUseFull ? `- Full context: ${fw.whenToUseFull}` : ""}
- Inputs required: ${fw.inputsRequired}
- Expected output: ${fw.outputArtifact}
- Common mistakes to avoid: ${fw.commonMistakes}
${readinessContext}

Your task:
- Apply this framework precisely to the user's situation.
- Produce 3 to 4 concise bullets.
- Use the framework's real vocabulary and structure.
- Reference the user's actual context or attached text where relevant.
- If something is missing, name the gap and continue with your best judgment anyway.
- Never invent numeric scores, option names, customer facts, metrics, or implementation details that the user did not provide.
- If the user has not named the options clearly, refer to them generically rather than making up labels.
- Stay under 170 words.
- No filler or generic PM platitudes.`;
}

const SYNTHESIS_PROMPT = `You are the Prodforce Synthesis Agent, the final stage in a multi-agent PM intelligence pipeline.

You will receive multiple specialist analyses based on selected PM frameworks. Synthesize them into one clear, decisive answer.

Output structure:
## Executive Summary
2 sharp sentences on the core recommendation.

## [Framework Name] Application
4 to 5 concrete bullets grounded in the user's situation.

## [Framework Name 2] Application
Only if a second framework exists.

## Where These Frameworks Align
Only if 2 or more frameworks exist. Keep it to 1 to 2 sentences.

## Recommended Next Steps
Numbered list of exactly 3 concrete actions the user can take this week.

Rules:
- Keep it under 450 words.
- Be direct, specific, and executive-level.
- Bold the most important decisions, metrics, and actions.
- Do not invent facts, scores, timelines, option names, or customer evidence that the user did not provide.
- Never output placeholder text such as [Insert Owner], [Add Metric], TBD, or template slots.
- If key information is missing, say what is missing and frame the recommendation as a provisional judgment.
- No generic encouragement or filler phrasing.`;

function buildPlainMessages(messages: Message[], file?: FilePayload): PlainMessage[] {
  const result = messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (!file || result.length === 0) {
    return result;
  }

  const lastIndex = result.length - 1;
  const lastMessage = result[lastIndex];

  if (lastMessage.role !== "user") {
    return result;
  }

  if (file.fileType === "text" && file.content) {
    result[lastIndex] = {
      role: "user",
      content:
        `[Attached file: ${file.name}]\n\n` +
        file.content +
        "\n\n---\n\nUser request:\n" +
        lastMessage.content,
    };
  }

  return result;
}

function buildAnthropicMessages(
  messages: Message[],
  file?: FilePayload
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const isLast = i === messages.length - 1;
    const isLastUser = isLast && message.role === "user";

    if (isLastUser && file) {
      if (file.fileType === "pdf" && file.base64) {
        result.push({
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: file.base64,
              },
              title: file.name,
            } as any,
            {
              type: "text",
              text: message.content,
            },
          ],
        });
      } else if (file.fileType === "text" && file.content) {
        result.push({
          role: "user",
          content:
            `[Attached file: ${file.name}]\n\n` +
            file.content +
            "\n\n---\n\nUser request:\n" +
            message.content,
        });
      } else {
        result.push({
          role: message.role,
          content: message.content,
        });
      }
    } else {
      result.push({
        role: message.role,
        content: message.content,
      });
    }
  }

  return result;
}

function parseJsonObject<T>(raw: string): T | null {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

function normalizeOrchestratorResult(parsed: OrchestratorResult | null): OrchestratorResult {
  const seen = new Set<string>();
  const frameworkMatches = Array.isArray(parsed?.framework_matches)
    ? parsed.framework_matches
        .map((item) => ({
          slug: typeof item?.slug === "string" ? item.slug.trim() : "",
          reason: typeof item?.reason === "string" ? item.reason.trim() : "",
        }))
        .filter((item) => item.slug.length > 0 && !seen.has(item.slug) && seen.add(item.slug))
        .slice(0, 3)
    : [];

  return {
    framework_matches: frameworkMatches,
    situation_summary:
      typeof parsed?.situation_summary === "string" ? parsed.situation_summary.trim() : "",
    follow_up_suggestions: Array.isArray(parsed?.follow_up_suggestions)
      ? parsed.follow_up_suggestions
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [],
  };
}

function makeSender(writer: WritableStreamDefaultWriter<Uint8Array>) {
  const encoder = new TextEncoder();

  return async (data: Record<string, unknown>) => {
    try {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Client disconnected.
    }
  };
}

function getProvider(): Provider | null {
  const preference = (import.meta.env.PRODFORCE_LLM_PROVIDER ?? "groq").toLowerCase();
  const groqApiKey = import.meta.env.GROQ_API_KEY?.trim();
  const anthropicApiKey = import.meta.env.ANTHROPIC_API_KEY?.trim();

  const groqProvider = groqApiKey
    ? {
        kind: "groq" as const,
        apiKey: groqApiKey,
        models: {
          orchestrator: import.meta.env.GROQ_ORCHESTRATOR_MODEL ?? "openai/gpt-oss-20b",
          specialist: import.meta.env.GROQ_SPECIALIST_MODEL ?? "llama-3.1-8b-instant",
          synthesis: import.meta.env.GROQ_SYNTHESIS_MODEL ?? "llama-3.1-8b-instant",
        },
      }
    : null;

  const anthropicProvider = anthropicApiKey
    ? {
        kind: "anthropic" as const,
        client: new Anthropic({ apiKey: anthropicApiKey }),
        models: {
          orchestrator:
            import.meta.env.ANTHROPIC_ORCHESTRATOR_MODEL ?? "claude-sonnet-4-6",
          specialist:
            import.meta.env.ANTHROPIC_SPECIALIST_MODEL ?? "claude-haiku-4-5-20251001",
          synthesis: import.meta.env.ANTHROPIC_SYNTHESIS_MODEL ?? "claude-sonnet-4-6",
        },
      }
    : null;

  if (preference === "anthropic") {
    return anthropicProvider ?? groqProvider ?? null;
  }

  return groqProvider ?? anthropicProvider ?? null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function groqRetryDelayMs(response: Response, message: string) {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const retrySeconds = Number(retryAfterHeader);
    if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
      return Math.min(Math.ceil(retrySeconds * 1000), 4000);
    }
  }

  const match = message.match(/try again in\s+([\d.]+)\s*(ms|s)/i);
  if (!match) return 800;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 800;

  const multiplier = match[2].toLowerCase() === "s" ? 1000 : 1;
  return Math.min(Math.ceil(amount * multiplier) + 150, 4000);
}

async function groqRequest(
  apiKey: string,
  payload: Record<string, unknown>,
  attempt = 0
) {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let message = `Groq request failed (${response.status})`;
    const raw = await response.text();

    try {
      const errorBody = JSON.parse(raw) as {
        error?: { message?: string };
      };
      message = errorBody.error?.message ?? message;
    } catch {
      if (raw.trim()) message = raw.trim();
    }

    if (response.status === 429 && attempt < 1) {
      await sleep(groqRetryDelayMs(response, message));
      return groqRequest(apiKey, payload, attempt + 1);
    }

    throw new Error(message);
  }

  return response;
}

async function groqTextCompletion(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: PlainMessage[];
  maxTokens: number;
}) {
  const response = await groqRequest(args.apiKey, {
    model: args.model,
    messages: [{ role: "system", content: args.system }, ...args.messages],
    max_completion_tokens: args.maxTokens,
    temperature: 0.2,
  });

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

async function groqStructuredCompletion(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: PlainMessage[];
  maxTokens: number;
}) {
  try {
    const response = await groqRequest(args.apiKey, {
      model: args.model,
      messages: [{ role: "system", content: args.system }, ...args.messages],
      max_completion_tokens: args.maxTokens,
      response_format: {
        type: "json_schema",
        json_schema: ORCHESTRATOR_SCHEMA,
      },
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const parsed = parseJsonObject<OrchestratorResult>(raw);

    if (parsed) {
      return normalizeOrchestratorResult(parsed);
    }
  } catch (error) {
    console.warn("[prodforce-groq] Structured orchestrator fallback:", error);
  }

  const fallbackText = await groqTextCompletion({
    apiKey: args.apiKey,
    model: args.model,
    system:
      args.system +
      "\n\nReturn one valid JSON object with exactly these keys: framework_matches, situation_summary, follow_up_suggestions. No markdown fences. No commentary.",
    messages: args.messages,
    maxTokens: args.maxTokens,
  });

  const fallbackParsed = parseJsonObject<OrchestratorResult>(fallbackText);
  if (!fallbackParsed) {
    throw new Error("Groq returned invalid framework selection JSON.");
  }

  return normalizeOrchestratorResult(fallbackParsed);
}

async function* parseGroqStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const eventBlock = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const lines = eventBlock.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith("data:")) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload) {
          continue;
        }

        if (payload === "[DONE]") {
          return;
        }

        let parsed: {
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };

        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }

        const text = parsed.choices?.[0]?.delta?.content;
        if (typeof text === "string" && text.length > 0) {
          yield text;
        }
      }
    }
  }
}

async function* groqStreamCompletion(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: PlainMessage[];
  maxTokens: number;
}) {
  const response = await groqRequest(args.apiKey, {
    model: args.model,
    messages: [{ role: "system", content: args.system }, ...args.messages],
    max_completion_tokens: args.maxTokens,
    temperature: 0.2,
    stream: true,
  });

  if (!response.body) {
    throw new Error("Groq streaming response was unavailable.");
  }

  for await (const chunk of parseGroqStream(response.body)) {
    yield chunk;
  }
}

async function anthropicTextCompletion(args: {
  client: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
}) {
  const response = await args.client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: args.messages,
  });

  return response.content[0]?.type === "text" ? response.content[0].text : "";
}

async function* anthropicStreamCompletion(args: {
  client: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
}) {
  const stream = await args.client.messages.stream({
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: args.messages,
  });

  for await (const chunk of stream) {
    if (
      chunk.type === "content_block_delta" &&
      chunk.delta.type === "text_delta"
    ) {
      yield chunk.delta.text;
    }
  }
}

async function runOrchestrator(args: {
  provider: Provider;
  frameworks: Framework[];
  messages: Message[];
  file?: FilePayload;
}) {
  const systemPrompt = buildOrchestratorPrompt(args.frameworks);

  if (args.provider.kind === "groq") {
    try {
      return await groqStructuredCompletion({
        apiKey: args.provider.apiKey,
        model: args.provider.models.orchestrator,
        system: systemPrompt,
        messages: buildPlainMessages(args.messages, args.file),
        maxTokens: GROQ_MAX_TOKENS.orchestrator,
      });
    } catch (error) {
      console.warn("[prodforce-groq] Heuristic orchestrator fallback:", error);
      return buildHeuristicOrchestratorResult(args.frameworks, args.messages, args.file);
    }
  }

  const text = await anthropicTextCompletion({
    client: args.provider.client,
    model: args.provider.models.orchestrator,
    system: systemPrompt,
    messages: buildAnthropicMessages(args.messages, args.file),
    maxTokens: 900,
  });

  return normalizeOrchestratorResult(parseJsonObject<OrchestratorResult>(text));
}

async function orchestrate(
  messages: Message[],
  file: FilePayload | undefined,
  send: (data: Record<string, unknown>) => Promise<void>,
  provider: Provider
) {
  if (provider.kind === "groq" && file?.fileType === "pdf") {
    throw new Error(
      "Free Groq mode cannot read PDF attachments yet. Paste the PDF text or upload a plain-text file instead."
    );
  }

  const frameworks = await loadFrameworks();
  const latestText = latestUserMessage(messages);
  const conversationMode = classifyConversationMode(messages, file);

  if (conversationMode !== "pm") {
    const directResponse = buildDirectResponse(conversationMode, latestText);

    await send({
      type: "agent_start",
      agent: "orchestrator",
      label:
        conversationMode === "smalltalk"
          ? "Responding conversationally..."
          : "Waiting for a PM challenge...",
    });
    await send({
      type: "content",
      text: directResponse.text,
    });
    await send({
      type: "done",
      suggestions: directResponse.suggestions,
    });
    return;
  }

  const frameworkCandidates = getFrameworkCandidates(provider, frameworks, messages, file);
  const intakeAssessment = assessFrameworkReadiness(frameworkCandidates, messages, file);

  if (intakeAssessment.shouldClarify) {
    await send({
      type: "agent_start",
      agent: "orchestrator",
      label: "Scoping the PM situation before matching frameworks...",
    });
    await send({
      type: "clarification_needed",
      situationSummary: intakeAssessment.situationSummary,
      missingInformation: intakeAssessment.missingInformation,
      askedInformation: intakeAssessment.askedInformation,
      deferredInformation: intakeAssessment.deferredInformation,
      presentInformation: Array.from(intakeAssessment.presentSignals).map(
        (key) => SIGNAL_META[key].label
      ),
      questions: intakeAssessment.clarificationQuestions,
      candidateCategories: intakeAssessment.candidateCategories,
      candidateFrameworks: intakeAssessment.candidateFrameworks.slice(0, 3).map((framework) => ({
        slug: framework.slug,
        title: framework.title,
        category: framework.category,
        whenToUse: framework.whenToUse,
        inputsRequired: framework.inputsRequired,
        outputArtifact: framework.outputArtifact,
      })),
      suggestedReplies: intakeAssessment.suggestedReplies,
    });
    await send({
      type: "content",
      text: buildClarificationMessageV3(intakeAssessment),
    });
    await send({
      type: "done",
      mode: "clarify",
      suggestions:
        intakeAssessment.suggestedReplies.length > 0
          ? intakeAssessment.suggestedReplies
          : intakeAssessment.clarificationQuestions,
    });
    return;
  }

  const orchestratorResult = await runOrchestrator({
    provider,
    frameworks: frameworkCandidates,
    messages,
    file,
  });

  const matchedFrameworks = orchestratorResult.framework_matches
    .map((match) => ({
      framework: frameworks.find((framework) => framework.slug === match.slug),
      reason: match.reason,
    }))
    .filter((item) => item.framework)
    .map((item) => ({
      framework: item.framework as Framework,
      reason: item.reason,
    }));

  if (matchedFrameworks.length === 0) {
    const fallback =
      frameworkCandidates[0] ??
      frameworks.find((framework) => framework.category.includes("Strategy")) ??
      frameworks[0];

    if (fallback) {
      matchedFrameworks.push({
        framework: fallback,
        reason: "Strong general fit for the current PM challenge.",
      });
    }
  }

  const activeMatchedFrameworks =
    provider.kind === "groq" ? matchedFrameworks.slice(0, 2) : matchedFrameworks;

  const plainMessages = buildPlainMessages(messages, file);
  const anthropicMessages = buildAnthropicMessages(messages, file);

  await send({
    type: "agent_start",
    agent: "orchestrator",
    label: "Matching the strongest frameworks for your situation...",
  });

  await send({
    type: "frameworks_matched",
    situationSummary: orchestratorResult.situation_summary,
    suggestions: orchestratorResult.follow_up_suggestions,
    frameworks: activeMatchedFrameworks.map(({ framework, reason }) => {
      const coverage =
        intakeAssessment.coverageBySlug[framework.slug] ??
        buildFrameworkCoverage(framework, intakeAssessment.presentSignals);

      return {
        ...coverage,
        slug: framework.slug,
        title: framework.title,
        category: framework.category,
        whenToUse: framework.whenToUse,
        inputsRequired: framework.inputsRequired,
        outputArtifact: framework.outputArtifact,
        commonMistakes: framework.commonMistakes,
        reason: reason || "Strong contextual fit for your situation.",
      };
    }),
  });

  await send({
    type: "agent_start",
    agent: "specialists",
    label: `Running ${activeMatchedFrameworks.length} specialist agent${activeMatchedFrameworks.length > 1 ? "s" : ""}...`,
  });

  const runSpecialist = async ({ framework }: { framework: Framework }) => {
      await send({ type: "specialist_start", framework: framework.title });
      const coverage =
        intakeAssessment.coverageBySlug[framework.slug] ??
        buildFrameworkCoverage(framework, intakeAssessment.presentSignals);

      let analysis =
        provider.kind === "groq"
          ? await groqTextCompletion({
              apiKey: provider.apiKey,
              model: provider.models.specialist,
              system: buildSpecialistPrompt(framework, coverage),
              messages: plainMessages,
              maxTokens: GROQ_MAX_TOKENS.specialist,
            })
          : await anthropicTextCompletion({
              client: provider.client,
              model: provider.models.specialist,
              system: buildSpecialistPrompt(framework, coverage),
              messages: anthropicMessages,
              maxTokens: 1000,
            });

      if (
        provider.kind === "groq" &&
        (!analysis.trim() ||
          hallucinatesOptionLabels(analysis, latestText) ||
          containsTemplatePlaceholders(analysis))
      ) {
        analysis = buildSpecialistFallbackAnalysis(framework);
      }

      await send({ type: "specialist_done", framework: framework.title });
      return { framework, analysis };
    };

  const specialistResults =
    provider.kind === "groq"
      ? await (async () => {
          const results: Array<{ framework: Framework; analysis: string }> = [];
          for (const matchedFramework of activeMatchedFrameworks) {
            results.push(await runSpecialist(matchedFramework));
          }
          return results;
        })()
      : await Promise.all(activeMatchedFrameworks.map(runSpecialist));

  await send({
    type: "agent_start",
    agent: "synthesis",
    label: "Synthesizing final analysis...",
  });

  const specialistContext = specialistResults
    .map(
      (result) =>
        `### ${result.framework.title} Specialist Analysis\n\n${result.analysis}`
    )
    .join("\n\n---\n\n");

  if (provider.kind === "groq") {
    const synthMessages: PlainMessage[] = [
      ...plainMessages,
      {
        role: "user",
        content:
          `Specialist analyses:\n\n${specialistContext}\n\n` +
          "Now synthesize the final response.",
      },
    ];
    try {
      const synthesis = await groqTextCompletion({
        apiKey: provider.apiKey,
        model: provider.models.synthesis,
        system: SYNTHESIS_PROMPT,
        messages: synthMessages,
        maxTokens: GROQ_MAX_TOKENS.synthesis,
      });

      if (!synthesis.trim()) {
        throw new Error("The Groq synthesis response was empty.");
      }

      if (hallucinatesOptionLabels(synthesis, latestText)) {
        throw new Error("The Groq synthesis introduced option labels that were not in the user prompt.");
      }

      if (containsTemplatePlaceholders(synthesis)) {
        throw new Error("The Groq synthesis returned placeholder template text.");
      }

      await send({ type: "content", text: synthesis });
    } catch (error) {
      console.warn("[prodforce-groq] Synthesis fallback:", error);
      await send({
        type: "content",
        text: buildFallbackSynthesis(specialistResults),
      });
    }
  } else {
    const synthMessages: Anthropic.MessageParam[] = [
      ...anthropicMessages,
      {
        role: "user",
        content:
          `Specialist analyses:\n\n${specialistContext}\n\n` +
          "Now synthesize the final response.",
      },
    ];

    for await (const chunk of anthropicStreamCompletion({
      client: provider.client,
      model: provider.models.synthesis,
      system: SYNTHESIS_PROMPT,
      messages: synthMessages,
      maxTokens: 2200,
    })) {
      await send({ type: "content", text: chunk });
    }
  }

  await send({ type: "done" });
}

export const POST: APIRoute = async ({ request }) => {
  const provider = getProvider();

  if (!provider) {
    return new Response(
      JSON.stringify({
        error:
          "No LLM provider is configured. Add GROQ_API_KEY for free-tier mode or ANTHROPIC_API_KEY for Anthropic mode.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  let body: { messages?: unknown; file?: FilePayload };

  try {
    body = (await request.json()) as { messages?: unknown; file?: FilePayload };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages: Message[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (message): message is { role: "user" | "assistant"; content: string } =>
            Boolean(
              message &&
                (message.role === "user" || message.role === "assistant") &&
                typeof message.content === "string" &&
                message.content.trim().length > 0
            )
        )
        .map((message) => ({
          role: message.role,
          content: message.content.trim(),
        }))
    : [];

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "No valid messages were provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const file = body.file;
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const send = makeSender(writer);

  (async () => {
    try {
      await orchestrate(messages, file, send, provider);
    } catch (error) {
      console.error("[prodforce-chat]", error);
      await send({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unexpected error in the Prodforce pipeline.",
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // Already closed.
      }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
};
