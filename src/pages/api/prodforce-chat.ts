import type { APIRoute } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { getCollection } from "astro:content";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
type ConversationGuideParsed = {
  status: "ask_problem" | "clarify" | "ready";
  assistant_response: string;
  situation_summary: string;
  present_information: string[];
  context_required: string[];
  next_question: string;
  suggested_replies: string[];
  category_decisions: Array<{
    category: string;
    confidence: number;
    reason: string;
  }>;
  framework_decisions: Array<{
    slug: string;
    confidence: number;
    reason: string;
  }>;
};
type ConversationGuideResult = {
  status: "ask_problem" | "clarify" | "ready";
  assistantResponse: string;
  situationSummary: string;
  presentInformation: string[];
  contextRequired: string[];
  nextQuestion: string;
  suggestedReplies: string[];
  categoryDecisions: CategoryDecision[];
  frameworkDecisions: FrameworkDecision[];
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
type CategoryDecision = {
  category: string;
  score: number;
  confidence: number;
  confidenceLabel: string;
  locked: boolean;
  frameworkCount: number;
};
type FrameworkDecision = {
  slug: string;
  title: string;
  category: string;
  score: number;
  confidence: number;
  confidenceLabel: string;
  locked: boolean;
  whenToUse: string;
  inputsRequired: string;
  outputArtifact: string;
  commonMistakes: string;
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
  categoryDecisions: CategoryDecision[];
  frameworkDecisions: FrameworkDecision[];
  lockedCategories: string[];
  lockedFrameworks: string[];
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
        intake: string;
        orchestrator: string;
        specialist: string;
        synthesis: string;
      };
    }
  | {
      kind: "anthropic";
      client: Anthropic;
      models: {
        intake: string;
        orchestrator: string;
        specialist: string;
        synthesis: string;
      };
    };

const EXCLUDED_CATEGORIES = new Set(["Business Plans", "Financial Models", "TBA"]);
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MAX_TOKENS = {
  intake: 520,
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
  /\b(scrum|standup|sprint|cadence|delivery|deliverable|deadline|blocker|retro|retrospective|azure devops|ado|engineering|dev team|daily meeting|release)\b/i,
];
const INTAKE_CHECK_PATTERN = /## Intake Check|Before I commit to specific frameworks/i;
const NO_MORE_CONTEXT_PATTERNS = [
  /\b(?:i\s+(?:do not|don't)\s+have\s+(?:any|anymore|more)(?:\s+additional)?\s+(?:info(?:rmation)?|context|details))\b/i,
  /\b(?:that(?:'s| is)\s+all\s+i\s+(?:have|know))\b/i,
  /\b(?:no more (?:info(?:rmation)?|context|details))\b/i,
  /\b(?:not sure|don't know|unsure)\b/i,
];
const NON_ANSWER_REPLY_PATTERNS = [
  /^\s*(?:i\s+just\s+replied|i\s+already\s+replied|i\s+already\s+answered|i\s+answered)\b/i,
  /^\s*(?:what\s+else\s+do\s+you\s+need|what\s+do\s+you\s+need)\b/i,
  /^\s*(?:i\s+don't\s+understand|i\s+dont\s+understand|not\s+sure|unsure)\b/i,
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
const CONVERSATION_GUIDE_SCHEMA = {
  name: "prodforce_conversation_guide",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["ask_problem", "clarify", "ready"],
      },
      assistant_response: { type: "string" },
      situation_summary: { type: "string" },
      present_information: {
        type: "array",
        minItems: 0,
        maxItems: 8,
        items: { type: "string" },
      },
      context_required: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: { type: "string" },
      },
      next_question: { type: "string" },
      suggested_replies: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: { type: "string" },
      },
      category_decisions: {
        type: "array",
        minItems: 0,
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            category: { type: "string" },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["category", "confidence", "reason"],
        },
      },
      framework_decisions: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slug: { type: "string" },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["slug", "confidence", "reason"],
        },
      },
    },
    required: [
      "status",
      "assistant_response",
      "situation_summary",
      "present_information",
      "context_required",
      "next_question",
      "suggested_replies",
      "category_decisions",
      "framework_decisions",
    ],
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

function countSubstantivePmTurns(messages: Message[], file?: FilePayload) {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => normalizeUserContextText(message.content))
    .filter(Boolean)
    .filter((text) => hasPmSignal(text, file)).length;
}

function shouldUnlockFrameworkReasoning(messages: Message[], file?: FilePayload) {
  const context = collectPmContext(messages, file);
  const signalCount = detectContextSignals(context).size;
  const tokenCount = tokenize(context).length;
  const pmTurns = countSubstantivePmTurns(messages, file);
  return hasPmSignal(context, file) && (pmTurns >= 2 || (signalCount >= 4 && tokenCount >= 22));
}

function lastAssistantQuestion(messages: Message[]) {
  const assistants = messages.filter((message) => message.role === "assistant").slice().reverse();
  for (const message of assistants) {
    const content = String(message.content || "").replace(/\s+/g, " ").trim();
    const match = content.match(/([^?]+\?)(?!.*\?)/);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function extractAllAssistantQuestions(messages: Message[]): string[] {
  const questions: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const content = String(message.content || "").replace(/\s+/g, " ").trim();
    const matches = content.match(/[^.!?\n]*\?/g);
    if (matches) {
      for (const raw of matches) {
        const q = raw.replace(/^[\s,;:—–-]+/, "").trim();
        if (q.length > 10) questions.push(q);
      }
    }
  }
  return questions;
}

function inferSignalFromQuestion(question: string): SignalKey | null {
  const normalized = normalizeComparableText(question);
  if (!normalized) return null;
  if (
    /what do you need to fix first|what exact decision|what decision should this|goal|objective|trying to make/.test(
      normalized
    )
  ) {
    return "objective";
  }
  if (/what options|scope|actual bets|fix paths|in scope|on the table/.test(normalized)) {
    return "scope";
  }
  if (/who is the primary user|which cohort|which user segment|buyer involved/.test(normalized)) {
    return "users";
  }
  if (/what metric|which outcome|which signal|business outcome|success signal/.test(normalized)) {
    return "metrics";
  }
  if (/timeline|resource|budget|deadline|process fix you can start this week|constraints/.test(normalized)) {
    return "constraints";
  }
  if (
    /what does the current baseline|what changed|what usually causes the miss|what s going on|what is going on|what blockers/.test(
      normalized
    )
  ) {
    return "evidence";
  }
  if (/assumptions|risk|dependency|could derail|biggest risk/.test(normalized)) {
    return "risks";
  }
  if (/who owns|which stakeholders|who needs alignment|sign off|decision owners/.test(normalized)) {
    return "stakeholders";
  }
  return null;
}

function inferAnsweredSignalFromLatestTurn(messages: Message[]) {
  const latestUser = normalizeUserContextText(latestUserMessage(messages));
  if (!latestUser || isLikelyNonAnswerReply(latestUser)) return null;
  const priorQuestion = lastAssistantQuestion(messages);
  return inferSignalFromQuestion(priorQuestion);
}

function inferAnsweredSignalsFromConversation(messages: Message[]) {
  const signals = new Set<SignalKey>();
  let activeQuestion = "";

  for (const message of messages) {
    if (message.role === "assistant") {
      const question = lastAssistantQuestion([message]);
      if (question) activeQuestion = question;
      continue;
    }

    const answer = normalizeUserContextText(message.content);
    if (!answer || isLikelyNonAnswerReply(answer) || !activeQuestion) {
      continue;
    }

    const signal = inferSignalFromQuestion(activeQuestion);
    if (signal) signals.add(signal);
  }

  return signals;
}

function isLikelyNonAnswerReply(text: string) {
  const clean = normalizeUserContextText(text);
  if (!clean) return true;
  if (NON_ANSWER_REPLY_PATTERNS.some((pattern) => pattern.test(clean))) return true;
  return /^(ok|okay|sure|yes|yep|no|nah|maybe|what|huh|why|how|hmm|idk|help|hello|hi|hey)[!?.]*$/i.test(clean);
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

function buildDirectResponse(mode: ConversationMode, _latestText: string) {
  if (mode === "smalltalk") {
    return {
      text:
        "Hey — I’m Prodforce. Give me a product decision you’re stuck on and I’ll match it to the right PM framework, run specialist analysis, and deliver an applied recommendation. What are you working through?",
      suggestions: [
        "How do I prioritize our Q3 roadmap with competing stakeholder demands?",
        "Churn spiked after our latest release. How do I diagnose it?",
        "We’re launching an AI feature — what GTM framework fits?",
      ],
    };
  }

  return {
    text:
      "What’s the product decision you’re working through? I’ll match it to the right framework and run a full analysis.",
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
    .slice(-8)
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
  // Count assistant turns that asked a clarifying question (contain a question mark)
  // but did NOT produce a full framework analysis (no markdown headers like "## Executive Summary")
  return messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.content.includes("?") &&
      !/^##\s/m.test(message.content) &&
      message.content.length < 600
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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function describeConfidence(confidence: number) {
  if (confidence >= 0.82) return "locked";
  if (confidence >= 0.66) return "strong";
  if (confidence >= 0.48) return "emerging";
  return "exploring";
}

function coverageToNumber(coverage: FrameworkCoverage | undefined) {
  if (!coverage) return 0.4;
  if (coverage.confidence === "high") return 0.92;
  if (coverage.confidence === "medium") return 0.68;
  return 0.44;
}

function buildCategoryDecisions(
  rankedCandidates: Array<{ framework: Framework; score: number }>,
  coverageBySlug: Record<string, FrameworkCoverage>
) {
  const ranked = rankedCandidates.filter((item) => item.framework).slice(0, 14);
  if (!ranked.length) return [];

  const maxScore = Math.max(...ranked.map((item) => item.score), 1);
  const buckets = new Map<
    string,
    {
      category: string;
      total: number;
      best: number;
      support: number;
      frameworks: Set<string>;
    }
  >();

  ranked.forEach(({ framework, score }, index) => {
    const category = framework.category || "Uncategorized";
    const normalizedScore = clamp01(score / maxScore);
    const rankWeight = clamp01(1 - index * 0.06);
    const coverageScore = coverageToNumber(coverageBySlug[framework.slug]);
    const contribution = normalizedScore * 0.64 + coverageScore * 0.24 + rankWeight * 0.12;
    const current =
      buckets.get(category) ??
      {
        category,
        total: 0,
        best: 0,
        support: 0,
        frameworks: new Set<string>(),
      };

    current.total += contribution;
    current.best = Math.max(current.best, contribution);
    current.frameworks.add(framework.slug);
    if (contribution >= 0.5) current.support += 1;
    buckets.set(category, current);
  });

  const provisional = Array.from(buckets.values()).map((entry) => {
    const frameworkCount = entry.frameworks.size;
    const avgContribution = entry.total / Math.max(frameworkCount, 1);
    const supportFactor = clamp01(frameworkCount / 3);
    const confidence = clamp01(
      entry.best * 0.48 + avgContribution * 0.34 + supportFactor * 0.18
    );

    return {
      category: entry.category,
      score: Number((entry.total / Math.max(frameworkCount, 1)).toFixed(3)),
      confidence,
      confidenceLabel: describeConfidence(confidence),
      locked: false,
      frameworkCount,
    };
  });

  provisional.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.frameworkCount - a.frameworkCount ||
      a.category.localeCompare(b.category)
  );

  return provisional.map((decision, index, list) => {
    const next = list[index + 1];
    const margin = decision.confidence - (next?.confidence ?? 0);
    const locked =
      decision.confidence >= 0.74 &&
      (index === 0 ? margin >= 0.04 || decision.confidence >= 0.86 : decision.confidence >= 0.82);

    return {
      ...decision,
      locked,
      confidenceLabel: locked ? "locked" : describeConfidence(decision.confidence),
    };
  });
}

function buildFrameworkDecisions(
  rankedCandidates: Array<{ framework: Framework; score: number }>,
  coverageBySlug: Record<string, FrameworkCoverage>
) {
  const ranked = rankedCandidates.filter((item) => item.framework).slice(0, 12);
  if (!ranked.length) return [];

  const maxScore = Math.max(...ranked.map((item) => item.score), 1);
  const provisional = ranked.map(({ framework, score }, index) => {
    const normalizedScore = clamp01(score / maxScore);
    const rankWeight = clamp01(1 - index * 0.07);
    const coverageScore = coverageToNumber(coverageBySlug[framework.slug]);
    const confidence = clamp01(
      normalizedScore * 0.58 + coverageScore * 0.28 + rankWeight * 0.14
    );

    return {
      slug: framework.slug,
      title: framework.title,
      category: framework.category,
      score: Number((normalizedScore * 100).toFixed(1)),
      confidence,
      confidenceLabel: describeConfidence(confidence),
      locked: false,
      whenToUse: framework.whenToUseFull || framework.whenToUse,
      inputsRequired: framework.inputsRequired,
      outputArtifact: framework.outputArtifact,
      commonMistakes: framework.commonMistakes,
    };
  });

  provisional.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.score - a.score ||
      a.title.localeCompare(b.title)
  );

  return provisional.map((decision, index, list) => {
    const next = list[index + 1];
    const margin = decision.confidence - (next?.confidence ?? 0);
    const locked =
      decision.confidence >= 0.76 &&
      (index <= 1 ? margin >= 0.03 || decision.confidence >= 0.86 : decision.confidence >= 0.84);

    return {
      ...decision,
      locked,
      confidenceLabel: locked ? "locked" : describeConfidence(decision.confidence),
    };
  });
}

function summarizeSituation(messages: Message[], file?: FilePayload) {
  // Only include user messages that carry actual PM context — skip
  // noise like "ok", "what?", "I don't understand", short replies, etc.
  const substantiveUserMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => normalizeUserContextText(message.content))
    .filter(Boolean)
    .filter((text) => text.length > 8 && !isLikelyNonAnswerReply(text));
  const attachmentLead =
    file?.fileType === "text" && file.content
      ? `Attached context: ${file.content.slice(0, 180).trim()}`
      : "";
  const summary = [attachmentLead, ...substantiveUserMessages.slice(-2)].filter(Boolean).join(". ");
  if (!summary) {
    return "";
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "What do you need to fix first: daily attendance, earlier blocker surfacing, or delivery reliability overall?";
      }
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "What part of the workflow is breaking most right now: attendance, blocker escalation, planning clarity, or follow-through after the scrum?";
      }
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "How will you know this is improving: attendance rate, blockers raised on time, or delivery commitments met?";
      }
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "Do you need a process fix you can start this week, or are you redesigning how the team plans and delivers work more broadly?";
      }
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "What usually causes the miss right now: unclear scope, no owner, late dependencies, or blockers not getting raised early enough?";
      }
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "What is the main risk if you push on attendance first: low buy-in, the wrong root cause, or blockers still staying hidden?";
      }
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(scenario.lowerText)) {
        return "Who owns the delivery process today: the PM, engineering manager, tech lead, or someone else?";
      }
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
  // Never echo user text back — just ask the next question.
  // The LLM path handles acknowledgment; this fallback should be clean.
  return assessment.clarificationQuestions[0] || "What's the core decision you need to make here?";
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("The goal is to restore daily attendance and surface blockers earlier.");
        push("The goal is to improve delivery reliability without redesigning everything.");
      } else if (scenario.isDiagnostic && /\b(churn|retention|drop|spike|regression)\b/.test(lower)) {
        push("The goal is to isolate the root cause and decide the first corrective move.");
      } else if (scenario.isDiagnostic) {
        push("The goal is to explain the issue clearly enough to choose the right first fix.");
      } else if (scenario.isLaunch) {
        push("The goal is to decide whether the launch plan is strong enough to move forward.");
      } else if (scenario.isEnterprise) {
        push("The goal is to improve the proposal workflow in a way that increases RFP wins.");
      }
    } else if (key === "metrics") {
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("We will track attendance rate and whether blockers get raised during the scrum.");
        push("We will know it is working if the team starts meeting delivery commitments more consistently.");
      } else if (/\brfps?\s+won\b/.test(lower)) {
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
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("We need a process fix the team can start this week.");
      }
      const timeline = extract([
        /\b(?:in|within|over|for)\s+((?:the\s+next\s+)?\d+\s+(?:days?|weeks?|months?|quarters?))/i,
        /\b((?:q[1-4]|next quarter|this quarter|next sprint|this sprint))/i,
      ]);
      const team = extract([/\b(team of\s+\d+(?:\s+\w+)?)/i, /\b(\d+\s+engineers?)/i]);
      if (timeline) push("Timeline constraint: " + timeline + ".");
      if (team) push("Resourcing constraint: " + team + ".");
    } else if (key === "risks") {
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("The main risk is that attendance is a symptom and blockers still will not surface early enough.");
      } else if (/\bprivacy|compliance|security|trust\b/.test(lower)) {
        push("A major risk is trust, privacy, or compliance blocking adoption.");
      } else if (/\bintegration|dependency\b/.test(lower)) {
        push("Integration dependencies could change the recommendation.");
      }
    } else if (key === "stakeholders") {
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("The PM and engineering manager currently own the delivery process.");
      }
      const stakeholder = extract([
        /\b(vp of [a-z ]+|head of [a-z ]+|cto|ceo|cpo|sales leadership|marketing leadership|engineering leadership)\b/i,
      ]);
      if (stakeholder) push("Key stakeholder: " + stakeholder + ".");
    } else if (key === "scope") {
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("The issue seems concentrated in daily attendance and blocker escalation.");
      } else {
        const options = extract([
          /\b((?:three|3|four|4|two|2)\s+(?:options|bets|initiatives|approaches))/i,
          /\bcomparing\s+([^.;]+)/i,
        ]);
        if (options) push("Scope in play: " + options + ".");
      }
    } else if (key === "evidence") {
      if (/\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(lower)) {
        push("People are skipping the scrum, so blockers surface too late.");
      } else if (/\bspiked after (?:our|the) latest release\b/i.test(context)) {
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
  const rankedCandidates = rankFrameworkCandidates(frameworkPool, messages, file);
  const candidateFrameworks = rankedCandidates.slice(0, 6).map((item) => item.framework).slice(0, 4);
  const context = collectPmContext(messages, file);
  const presentSignals = detectContextSignals(context);
  inferAnsweredSignalsFromConversation(messages).forEach((signal) => presentSignals.add(signal));
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
  const categoryDecisions = buildCategoryDecisions(rankedCandidates, coverageBySlug).slice(0, 5);
  const frameworkDecisions = buildFrameworkDecisions(rankedCandidates, coverageBySlug).slice(0, 6);

  const candidateCategories = Array.from(
    new Set(
      categoryDecisions.map((decision) => decision.category).concat(
        inferContextCategories(context),
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
  const strongCategoryCount = categoryDecisions.filter(
    (decision) => decision.locked || decision.confidence >= 0.72
  ).length;
  const strongFrameworkCount = frameworkDecisions.filter(
    (decision) => decision.locked || decision.confidence >= 0.72
  ).length;
  const shouldProceedProvisionally =
    (clarificationTurns > 0 &&
      (exhaustedContext ||
        introducedSignals.length > 0 ||
        latestSignals.size >= 2 ||
        latestTokenCount >= 8)) ||
    (clarificationTurns >= 2 && presentSignals.size >= 3) ||
    (clarificationTurns >= 3 && presentSignals.size >= 2) ||
    (clarificationTurns >= 1 &&
      strongCategoryCount >= 1 &&
      presentSignals.size >= 4 &&
      (topCoverage?.missingInputs.length ?? 0) <= 2) ||
    (clarificationTurns >= 1 &&
      strongFrameworkCount >= 1 &&
      presentSignals.size >= 4) ||
    (exhaustedContext && presentSignals.size >= 2);
  const shouldClarify =
    candidateFrameworks.length > 0 &&
    !shouldProceedProvisionally &&
    (presentSignals.size < 2 ||
      topCriticalMissing.length > 1 ||
      (topCoverage?.missingInputs.length ?? 0) >= 3 ||
      ((topCoverage?.confidence === "medium" || topCoverage?.confidence === "low") &&
        detailTokenCount < 18 &&
        clarificationTurns === 0));
  const scenario = inferScenarioContext(messages, file, candidateFrameworks, candidateCategories);
  const fallbackQuestions = buildHeuristicSuggestions(normalizeUserContextText(latestUserMessage(messages)));
  const orderedMissing =
    /\b(scrum|standup|daily meeting|ado|azure devops|deliverable|deadline|blocker)\b/.test(
      scenario.lowerText
    ) && !scenario.isPrioritization
      ? [
          "objective",
          "evidence",
          "stakeholders",
          "constraints",
          "risks",
          "scope",
          "metrics",
          "users",
        ].filter((key) => prioritizedMissing.includes(key as SignalKey)) as SignalKey[]
      : prioritizedMissing;
  const askedSignalKeys = orderedMissing.slice(0, 1);
  const clarificationQuestions = askedSignalKeys.map((key) =>
    buildDynamicClarificationQuestion(key, scenario)
  );
  const missingInformation = orderedMissing
    .slice(0, 3)
    .map((key) => SIGNAL_META[key].label);
  const askedInformation = askedSignalKeys.length
    ? askedSignalKeys.map((key) => SIGNAL_META[key].label)
    : missingInformation.slice(0, 3);
  const deferredInformation = orderedMissing
    .slice(1, 3)
    .map((key) => SIGNAL_META[key].label);
  const suggestedReplies = buildGroundedSuggestedReplies(askedSignalKeys, scenario, context);
  const stableCategoryDecisions = categoryDecisions.filter(
    (decision) => decision.confidence >= 0.45 || decision.locked
  );
  const stableFrameworkDecisions = frameworkDecisions.filter((decision) => {
    if (decision.locked || decision.confidence >= 0.66) return true;
    return stableCategoryDecisions.some(
      (categoryDecision) =>
        categoryDecision.category === decision.category &&
        (categoryDecision.locked || categoryDecision.confidence >= 0.6)
    );
  });

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
    categoryDecisions: stableCategoryDecisions,
    frameworkDecisions: stableFrameworkDecisions,
    lockedCategories: stableCategoryDecisions.filter((decision) => decision.locked).map((decision) => decision.category),
    lockedFrameworks: stableFrameworkDecisions.filter((decision) => decision.locked).map((decision) => decision.slug),
    askedSignalKeys,
    askedInformation,
    deferredInformation,
    suggestedReplies,
  };
}

function rankFrameworkCandidates(
  frameworks: Framework[],
  messages: Message[],
  file: FilePayload | undefined
) {
  const fullContext = collectPmContext(messages, file);
  const queryTokens = tokenize(fullContext);
  const lowerContext = fullContext.toLowerCase();
  const intentSignals = {
    prioritization: /\b(priorit|roadmap|tradeoff|backlog|bet|bets|capacity|rank|ranking|evaluate|portfolio)\b/.test(lowerContext),
    strategy: /\b(vision|strategy|positioning|north star|mission|align|alignment|differentiat)\b/.test(lowerContext),
    discovery: /\b(discover|discovery|research|interview|customer|user|validate|opportunity|jtbd|jobs to be done)\b/.test(lowerContext),
    metrics: /\b(metric|metrics|kpi|okrs?|analytics|measure|success)\b/.test(lowerContext),
    diagnostic: /\b(churn|drop|spike|diagnos|root cause|regression|incident|release|support ticket|bug)\b/.test(lowerContext),
    gtm: /\b(launch|go-to-market|go to market|gtm|pricing|churn|retention|activation|adoption|sales|market)\b/.test(lowerContext),
    execution: /\b(stakeholder|retro|retrospective|postmortem|scrum|cadence|decision|escalation|execution)\b/.test(lowerContext),
    deliveryExecution: /\b(scrum|standup|daily scrum|daily standup|ado|azure devops|deliverable|deliverables|deadline|attendance|blocker|missed delivery|delivery reliability)\b/.test(lowerContext),
    multipleOptions: /\b(competing|compare|comparison|versus|vs|bet one|bet two|bet three|option|options)\b/.test(lowerContext),
  };

  if (queryTokens.length === 0) {
    return frameworks.map((framework) => ({ framework, score: 0 }));
  }

  return frameworks
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
        !intentSignals.deliveryExecution &&
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
        !intentSignals.deliveryExecution &&
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
          category.includes("delivery") ||
          identity.includes("stakeholder") ||
          identity.includes("retro") ||
          identity.includes("raci") ||
          identity.includes("scrum") ||
          identity.includes("acceptance criteria") ||
          identity.includes("discovery-delivery-flow") ||
          identity.includes("decision"))
      ) {
        score += 14;
      }
      if (
        intentSignals.deliveryExecution &&
        (category.includes("alignment") ||
          category.includes("delivery") ||
          identity.includes("scrum") ||
          identity.includes("raci") ||
          identity.includes("retro") ||
          identity.includes("postmortem") ||
          identity.includes("acceptance criteria") ||
          identity.includes("discovery-delivery-flow") ||
          identity.includes("decision escalation"))
      ) {
        score += 24;
      }
      if (
        intentSignals.deliveryExecution &&
        (category.includes("growth") ||
          category.includes("market") ||
          identity.includes("retention") ||
          identity.includes("churn") ||
          identity.includes("pricing") ||
          identity.includes("launch") ||
          identity.includes("gtm"))
      ) {
        score -= 26;
      }
      if (
        intentSignals.deliveryExecution &&
        category.includes("metrics") &&
        !identity.includes("post-launch") &&
        !identity.includes("kpi") &&
        !identity.includes("okr")
      ) {
        score -= 8;
      }
      if (
        intentSignals.deliveryExecution &&
        category.includes("discovery") &&
        !identity.includes("acceptance criteria") &&
        !identity.includes("discovery-delivery-flow")
      ) {
        score -= 12;
      }
      if (
        intentSignals.execution &&
        !intentSignals.prioritization &&
        !intentSignals.multipleOptions &&
        (category.includes("prioritization") ||
          category.includes("roadmap") ||
          identity.includes("tradeoff") ||
          identity.includes("rice") ||
          identity.includes("moscow") ||
          identity.includes("cost-benefit"))
      ) {
        score -= 18;
      }

      return { framework, score };
    })
    .sort((a, b) => b.score - a.score || a.framework.title.localeCompare(b.framework.title));
}

function selectFrameworkCandidates(
  frameworks: Framework[],
  messages: Message[],
  file: FilePayload | undefined,
  limit = ORCHESTRATOR_CANDIDATE_LIMIT
) {
  const ranked = rankFrameworkCandidates(frameworks, messages, file);

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

function buildConversationGuidePrompt(args: {
  frameworks: Framework[];
  assessment: IntakeAssessment;
  messages: Message[];
  file?: FilePayload;
  unlockFrameworks: boolean;
}): string {
  const frameworks = args.frameworks;
  const frameworkBlock = frameworks.length
    ? frameworks
        .map(
          (framework) =>
            `[${framework.slug}]\n` +
            `Title: ${framework.title}\n` +
            `Category: ${framework.category}\n` +
            `When to use: ${framework.whenToUseFull || framework.whenToUse}\n` +
            `Inputs required: ${framework.inputsRequired}\n` +
            `Output artifact: ${framework.outputArtifact}`
        )
        .join("\n\n")
    : "No framework shortlist yet. Ask for the PM problem first, then narrow categories and frameworks only when warranted.";
  const knownFacts = Array.from(args.assessment.presentSignals).map((key) => SIGNAL_META[key].label);
  const missingFacts = args.assessment.missingInformation.slice(0, 4);
  const lastQuestion = lastAssistantQuestion(args.messages);
  const userTurns = args.messages
    .filter((message) => message.role === "user")
    .map((message) => normalizeUserContextText(message.content))
    .filter(Boolean);
  const recentUserContext = userTurns.slice(-3).join(" | ") || "No substantive PM context yet.";

  const allPriorQuestions = extractAllAssistantQuestions(args.messages);
  const priorQuestionsBlock = allPriorQuestions.length
    ? allPriorQuestions.map((q: string, i: number) => `  ${i + 1}. "${q}"`).join("\n")
    : "  (none yet)";

  return `You are the Prodforce Intake Agent — the conversational interface of a multi-agent PM intelligence system.

Your personality: A sharp, empathetic senior PM advisor. You are proactive, not interrogative. You think out loud, confirm your understanding, and guide the user toward clarity — not just extract information.

## How to respond

When the user provides PM context, your assistant_response MUST follow this structure:
1. **Acknowledge and confirm** what you just learned — restate the key fact from their latest message in your own words so they can correct you if wrong. Keep this to one sentence.
2. **State your current read** of the situation — briefly say what you think the problem is and where you're leaning. This shows intelligence, not just data collection.
3. **Ask ONE specific next question** — the single most important missing detail. Make it concrete and contextual, not generic.

Example of a GOOD assistant_response:
"So the core issue is daily scrum attendance — team members are consistently missing standup. That tells me this is likely a cadence and accountability problem rather than a process design issue. Who owns the delivery process today — the PM, engineering manager, tech lead, or someone else?"

Example of a BAD assistant_response:
"What do you need to fix first: daily attendance, earlier blocker surfacing, or delivery reliability overall?"
(This is bad because it doesn't acknowledge what the user said, doesn't show understanding, and bundles multiple options into one question.)

## Critical rules

- Read the FULL conversation. Never forget facts already provided.
- NEVER repeat a question already asked. Check the "Questions already asked" list below.
- NEVER ask the user to choose between options when they already told you the answer. If the user said "daily attendance", do not ask them to choose between attendance, blockers, and delivery.
- If the user gives a short or vague answer, work with it — incorporate it and move forward. Do not re-ask the same thing in different words.
- If the user seems confused, simplify your current question instead of switching topics.
- ONE question per turn. Not a bundle. Not a list. One sentence ending in a question mark.
- Do not mention framework names, category names, or internal system concepts in assistant_response when status is "ask_problem" or "clarify".
- Suggested replies must directly answer your next_question. They must be statements, not questions. If you cannot ground them in conversation context, return an empty list.
- When the user gives enough context for you to apply frameworks, set status to "ready" — don't keep asking for marginal details.
- Prefer stability. Don't rotate categories or frameworks unless the user provides materially new information.
- If fewer than two PM facts are grounded, return empty category_decisions and framework_decisions.
- If framework reasoning is not unlocked, keep decisions empty and focus on asking the right question.

## Status definitions

- ask_problem: No usable PM problem yet. Ask for it briefly.
- clarify: PM problem exists, but one more key input would strengthen the recommendation.
- ready: Enough context to advance to framework application.

## Current working memory

Situation so far: ${args.assessment.situationSummary}
Grounded facts: ${knownFacts.join(", ") || "none yet"}
Still missing: ${missingFacts.join(", ") || "none"}
Last assistant question: ${lastQuestion || "none"}
Recent user context: ${recentUserContext}
Framework reasoning unlocked: ${args.unlockFrameworks ? "yes" : "no"}

Questions already asked (NEVER repeat these):
${priorQuestionsBlock}

## Framework shortlist

${frameworkBlock}

Return only JSON matching the schema.`;
}

function normalizeConversationGuideResult(
  parsed: ConversationGuideParsed | null,
  frameworkPool: Framework[],
  fallbackAssessment: IntakeAssessment,
  messages: Message[]
): ConversationGuideResult | null {
  if (!parsed) return null;

  const frameworkBySlug = new Map(frameworkPool.map((framework) => [framework.slug, framework]));
  const categoryCounts = frameworkPool.reduce<Record<string, number>>((acc, framework) => {
    acc[framework.category] = (acc[framework.category] ?? 0) + 1;
    return acc;
  }, {});
  const validCategories = new Set(
    frameworkPool.map((framework) => framework.category).filter(Boolean)
  );

  const normalizedFrameworks = (Array.isArray(parsed.framework_decisions)
    ? parsed.framework_decisions
    : []
  )
    .map((item) => {
      const framework = frameworkBySlug.get(String(item?.slug || "").trim());
      if (!framework) return null;
      const confidence = clamp01(Number(item?.confidence ?? 0.5));
      return {
        slug: framework.slug,
        title: framework.title,
        category: framework.category,
        score: Number((confidence * 100).toFixed(1)),
        confidence,
        confidenceLabel: describeConfidence(confidence),
        locked: false,
        whenToUse: framework.whenToUseFull || framework.whenToUse,
        inputsRequired: framework.inputsRequired,
        outputArtifact: framework.outputArtifact,
        commonMistakes: framework.commonMistakes,
        reason: typeof item?.reason === "string" ? item.reason.trim() : "",
      };
    })
    .filter((item): item is FrameworkDecision & { reason: string } => Boolean(item))
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score);

  const lockedFrameworks = normalizedFrameworks.map((decision, index, list) => {
    const next = list[index + 1];
    const margin = decision.confidence - (next?.confidence ?? 0);
    const locked =
      decision.confidence >= 0.76 &&
      (index <= 1 ? margin >= 0.03 || decision.confidence >= 0.86 : decision.confidence >= 0.84);
    return {
      ...decision,
      locked,
      confidenceLabel: locked ? "locked" : describeConfidence(decision.confidence),
    };
  });

  const normalizedCategoriesRaw = (Array.isArray(parsed.category_decisions)
    ? parsed.category_decisions
    : []
  )
    .map((item) => {
      const category = String(item?.category || "").trim();
      if (!category || !validCategories.has(category)) return null;
      const confidence = clamp01(Number(item?.confidence ?? 0.5));
      return {
        category,
        score: Number((confidence * 100).toFixed(1)),
        confidence,
        confidenceLabel: describeConfidence(confidence),
        locked: false,
        frameworkCount: categoryCounts[category] ?? 0,
      };
    })
    .filter((item): item is CategoryDecision => Boolean(item));

  const derivedCategories = lockedFrameworks
    .filter((decision) => decision.confidence >= 0.46)
    .map((decision) => ({
      category: decision.category,
      score: Number((decision.confidence * 100).toFixed(1)),
      confidence: decision.confidence,
      confidenceLabel: describeConfidence(decision.confidence),
      locked: false,
      frameworkCount: categoryCounts[decision.category] ?? 0,
    }));

  const normalizedCategories = dedupeCategoryDecisions(
    normalizedCategoriesRaw.concat(derivedCategories)
  )
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
    .map((decision, index, list) => {
      const next = list[index + 1];
      const margin = decision.confidence - (next?.confidence ?? 0);
      const locked =
        decision.confidence >= 0.74 &&
        (index === 0 ? margin >= 0.04 || decision.confidence >= 0.86 : decision.confidence >= 0.82);
      return {
        ...decision,
        locked,
        confidenceLabel: locked ? "locked" : describeConfidence(decision.confidence),
      };
    });

  const presentInformation = dedupeListText(
    Array.isArray(parsed.present_information) ? parsed.present_information : []
  );
  const contextRequired = dedupeListText(
    Array.isArray(parsed.context_required) ? parsed.context_required : []
  );
  const nextQuestion = keepFirstQuestion(
    typeof parsed.next_question === "string" ? parsed.next_question.trim() : ""
  );
  const rawAssistantResponse =
    keepFirstQuestion(
      typeof parsed.assistant_response === "string" ? parsed.assistant_response.trim() : ""
    );
  // Strip echo patterns — never regurgitate user text back at them
  const latestUserText = normalizeComparableText(latestUserMessage(messages));
  const assistantResponse = stripEchoPatterns(rawAssistantResponse, latestUserText);
  const substantivePresentCount = presentInformation.length;
  const status =
    parsed.status === "ready"
      ? "ready"
      : parsed.status === "ask_problem"
        ? "ask_problem"
        : "clarify";
  const effectiveStatus =
    status === "ready" && !lockedFrameworks.length && !normalizedCategories.length
      ? "clarify"
      : status;
  const hideCategoryDecisions =
    effectiveStatus === "ask_problem" ||
    (effectiveStatus === "clarify" && substantivePresentCount < 2);
  const hideFrameworkDecisions =
    effectiveStatus !== "ready" || substantivePresentCount < 3;
  const suggestedReplies = dedupeListText(
    Array.isArray(parsed.suggested_replies) ? parsed.suggested_replies : []
  )
    .filter((item) => !/[?？]$/.test(item))
    .filter((item) => item.length <= 140)
    .slice(0, 3);
  const latestUser = latestUserMessage(messages);
  // Collect ALL prior questions to prevent any repetition
  const allPriorQuestions = extractAllAssistantQuestions(messages);
  const allPriorNormalized = new Set(
    allPriorQuestions.map((q: string) => normalizeComparableText(q)).filter(Boolean)
  );
  const isQuestionRepeated = (q: string) => {
    const norm = normalizeComparableText(q);
    return Boolean(norm) && allPriorNormalized.has(norm);
  };
  const repeatedQuestion = Boolean(nextQuestion) && isQuestionRepeated(nextQuestion);
  const repeatedResponse = Boolean(assistantResponse) && assistantResponse.includes("?") &&
    allPriorQuestions.some((pq: string) => {
      const norm = normalizeComparableText(pq);
      return norm && normalizeComparableText(assistantResponse).includes(norm);
    });
  const needsRepair =
    effectiveStatus === "clarify" &&
    (isLikelyNonAnswerReply(latestUser) || repeatedQuestion || repeatedResponse);
  // Find a fallback question that hasn't been asked before
  const repairedQuestion = needsRepair
    ? fallbackAssessment.clarificationQuestions.find(
        (question) => !isQuestionRepeated(question)
      ) ||
      fallbackAssessment.clarificationQuestions[0] ||
      nextQuestion
    : nextQuestion;
  const isConfused = needsRepair && isLikelyNonAnswerReply(latestUser);
  const repairedResponse = needsRepair
    ? (isConfused && repairedQuestion
      ? `No worries — let me simplify. ${repairedQuestion}`
      : "")
    : assistantResponse;
  const repairedSuggestions = needsRepair
    ? fallbackAssessment.suggestedReplies
        .filter((item) => !/[?？]$/.test(item))
        .slice(0, 2)
    : suggestedReplies;
  const responseDraft = repairedResponse || assistantResponse;
  const mentionsFrameworkName = frameworkPool.some((framework) =>
    responseDraft.toLowerCase().includes(framework.title.toLowerCase())
  );
  const safeAssistantResponse =
    effectiveStatus !== "ready" &&
    (mentionsFrameworkName ||
      /\bframeworks?\b|\bpressure[- ]?testing\b|\bcategory\b/i.test(responseDraft))
      ? ""
      : responseDraft;
  // Ensure the response actually contains a question and isn't stale
  const clarifyAssistantResponse =
    effectiveStatus === "clarify" &&
    (!safeAssistantResponse ||
      !safeAssistantResponse.includes("?"))
      ? ""
      : safeAssistantResponse;

  return {
    status: effectiveStatus,
    assistantResponse:
      clarifyAssistantResponse ||
      (status === "ask_problem"
        ? "What's the product decision or uncertainty you're working through?"
        : repairedQuestion ||
          "What would change the recommendation most — is there a key constraint, metric, or stakeholder I should know about?"),
    situationSummary:
      (typeof parsed.situation_summary === "string" ? parsed.situation_summary.trim() : "") ||
      fallbackAssessment.situationSummary,
    presentInformation:
      presentInformation.length
        ? presentInformation
        : Array.from(fallbackAssessment.presentSignals).map((key) => SIGNAL_META[key].label),
    contextRequired:
      contextRequired.length
        ? contextRequired
        : fallbackAssessment.missingInformation.slice(0, 3),
    nextQuestion:
      repairedQuestion ||
      fallbackAssessment.clarificationQuestions[0] ||
      "",
    suggestedReplies:
      effectiveStatus === "clarify"
        ? repairedSuggestions
        : [],
    categoryDecisions: hideCategoryDecisions
      ? []
      : normalizedCategories.length
        ? normalizedCategories.filter((decision) => decision.confidence >= 0.56)
        : fallbackAssessment.categoryDecisions.filter((decision) => decision.confidence >= 0.56),
    frameworkDecisions: hideFrameworkDecisions
      ? []
      : lockedFrameworks.length
        ? lockedFrameworks.filter((decision) => decision.confidence >= 0.68)
        : fallbackAssessment.frameworkDecisions.filter((decision) => decision.confidence >= 0.68),
  };
}

function dedupeCategoryDecisions(decisions: CategoryDecision[]) {
  const seen = new Set<string>();
  return decisions.filter((decision) => {
    if (!decision?.category || seen.has(decision.category)) return false;
    seen.add(decision.category);
    return true;
  });
}

function stripEchoPatterns(response: string, latestUserNormalized: string): string {
  if (!response) return response;
  // Strip "Got it — [user text]" / "Understood — [user text]" echo prefix
  let cleaned = response
    .replace(/^(?:got it|understood|okay|ok|sure|right|i see|noted)\s*[—–-]\s*/i, "")
    .trim();
  // If the response starts by repeating the user's latest message, strip it
  if (latestUserNormalized && latestUserNormalized.length > 6) {
    const norm = normalizeComparableText(cleaned);
    if (norm.startsWith(latestUserNormalized)) {
      // Remove the echoed portion — find the first question mark or sentence boundary after it
      const afterEcho = cleaned.slice(latestUserNormalized.length + 5);
      const questionStart = afterEcho.search(/[A-Z][a-z]|[?]/);
      if (questionStart >= 0) {
        cleaned = afterEcho.slice(questionStart).trim();
      }
    }
  }
  // Ensure we still have something meaningful
  return cleaned || response;
}

function dedupeListText(items: string[]) {
  return Array.from(
    new Set(
      (items || [])
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  );
}

function keepFirstQuestion(text: string) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const firstQuestion = clean.indexOf("?");
  if (firstQuestion === -1) return clean;
  const remainder = clean.slice(firstQuestion + 1);
  if (!remainder.includes("?")) return clean;
  return clean.slice(0, firstQuestion + 1).trim();
}

function normalizeComparableText(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

let runtimeEnvLoaded = false;

function ensureRuntimeEnvLoaded() {
  if (runtimeEnvLoaded) {
    return;
  }

  runtimeEnvLoaded = true;

  for (const envFile of [".env", ".env.production", ".env.prodforce"]) {
    const envPath = resolve(process.cwd(), envFile);
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath, override: false });
    }
  }
}

function getRuntimeEnv(name: string) {
  ensureRuntimeEnvLoaded();

  const runtimeValue = process.env[name]?.trim();
  if (runtimeValue) {
    return runtimeValue;
  }

  const viteEnv = import.meta.env as Record<string, string | undefined>;
  const viteValue = viteEnv[name]?.trim();
  return viteValue || undefined;
}

function getProvider(): Provider | null {
  const preference = (getRuntimeEnv("PRODFORCE_LLM_PROVIDER") ?? "groq").toLowerCase();
  const groqApiKey = getRuntimeEnv("GROQ_API_KEY");
  const anthropicApiKey = getRuntimeEnv("ANTHROPIC_API_KEY");

  const groqProvider = groqApiKey
      ? {
          kind: "groq" as const,
          apiKey: groqApiKey,
          models: {
          intake: getRuntimeEnv("GROQ_INTAKE_MODEL") ?? "llama-3.1-8b-instant",
          orchestrator:
            getRuntimeEnv("GROQ_ORCHESTRATOR_MODEL") ?? "openai/gpt-oss-20b",
          specialist: getRuntimeEnv("GROQ_SPECIALIST_MODEL") ?? "llama-3.1-8b-instant",
          synthesis: getRuntimeEnv("GROQ_SYNTHESIS_MODEL") ?? "llama-3.1-8b-instant",
        },
      }
    : null;

  const anthropicProvider = anthropicApiKey
      ? {
          kind: "anthropic" as const,
          client: new Anthropic({ apiKey: anthropicApiKey }),
          models: {
          intake:
            getRuntimeEnv("ANTHROPIC_INTAKE_MODEL") ?? "claude-haiku-4-5-20251001",
          orchestrator:
            getRuntimeEnv("ANTHROPIC_ORCHESTRATOR_MODEL") ?? "claude-sonnet-4-6",
          specialist:
            getRuntimeEnv("ANTHROPIC_SPECIALIST_MODEL") ?? "claude-haiku-4-5-20251001",
          synthesis: getRuntimeEnv("ANTHROPIC_SYNTHESIS_MODEL") ?? "claude-sonnet-4-6",
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

async function groqGuideCompletion(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: PlainMessage[];
  maxTokens: number;
}) {
  const supportsStructuredOutput =
    args.model.toLowerCase().startsWith("openai/") || /gpt-oss/i.test(args.model);

  if (supportsStructuredOutput) {
    try {
      const response = await groqRequest(args.apiKey, {
        model: args.model,
        messages: [{ role: "system", content: args.system }, ...args.messages],
        max_completion_tokens: args.maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: CONVERSATION_GUIDE_SCHEMA,
        },
      });

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      return parseJsonObject<ConversationGuideParsed>(raw);
    } catch (error) {
      console.warn("[prodforce-groq] Structured guide fallback:", error);
    }
  }

  const fallbackText = await groqTextCompletion({
    apiKey: args.apiKey,
    model: args.model,
    system:
      args.system +
      "\n\nReturn one valid JSON object with exactly these keys: status, assistant_response, situation_summary, present_information, context_required, next_question, suggested_replies, category_decisions, framework_decisions. No markdown fences. No commentary.",
    messages: args.messages,
    maxTokens: args.maxTokens,
  });

  return parseJsonObject<ConversationGuideParsed>(fallbackText);
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

async function runConversationGuide(args: {
  provider: Provider;
  frameworks: Framework[];
  messages: Message[];
  file?: FilePayload;
  unlockFrameworks: boolean;
}) {
  const fallbackAssessment = assessFrameworkReadiness(args.frameworks, args.messages, args.file);
  const allPriorQs = new Set(
    extractAllAssistantQuestions(args.messages)
      .map((q: string) => normalizeComparableText(q))
      .filter(Boolean)
  );
  const isRepeated = (q: string) => {
    const norm = normalizeComparableText(q);
    return Boolean(norm) && allPriorQs.has(norm);
  };
  const promoteAskProblemToClarify = (guide: ConversationGuideResult) => {
    const hasMeaningfulPmContext = hasPmSignal(collectPmContext(args.messages, args.file), args.file);
    if (!hasMeaningfulPmContext || guide.status !== "ask_problem") {
      return guide;
    }

    // Pick a question that hasn't been asked before
    const candidates = [
      guide.nextQuestion,
      keepFirstQuestion(guide.assistantResponse),
      ...fallbackAssessment.clarificationQuestions,
      "What is the first outcome you need to improve?",
    ].filter(Boolean);
    const promotedQuestion = candidates.find((q) => !isRepeated(q)) || candidates[0];

    return {
      ...guide,
      status: "clarify",
      assistantResponse:
        guide.assistantResponse &&
        !/describe the product decision|what(?:'| i)?s on your mind/i.test(guide.assistantResponse)
          ? guide.assistantResponse
          : promotedQuestion,
      contextRequired: guide.contextRequired.length
        ? guide.contextRequired
        : fallbackAssessment.missingInformation.slice(0, 3),
      nextQuestion: promotedQuestion,
      suggestedReplies: [],
      categoryDecisions: [],
      frameworkDecisions: [],
    } satisfies ConversationGuideResult;
  };
  const systemPrompt = buildConversationGuidePrompt({
    frameworks: args.frameworks.slice(0, 6),
    assessment: fallbackAssessment,
    messages: args.messages,
    file: args.file,
    unlockFrameworks: args.unlockFrameworks,
  });

  if (args.provider.kind === "groq") {
    try {
      const parsed = await groqGuideCompletion({
        apiKey: args.provider.apiKey,
        model: args.provider.models.intake,
        system: systemPrompt,
        messages: buildPlainMessages(args.messages, args.file),
        maxTokens: GROQ_MAX_TOKENS.intake,
      });

      const normalized = normalizeConversationGuideResult(
        parsed,
        args.frameworks,
        fallbackAssessment,
        args.messages
      );
      if (normalized) return promoteAskProblemToClarify(normalized);
    } catch (error) {
      console.warn("[prodforce-groq] Intake guide fallback:", error);
    }
  } else {
    const text = await anthropicTextCompletion({
      client: args.provider.client,
      model: args.provider.models.intake,
      system:
        systemPrompt +
        "\n\nReturn one valid JSON object with exactly these keys: status, assistant_response, situation_summary, present_information, context_required, next_question, suggested_replies, category_decisions, framework_decisions. No markdown fences. No commentary.",
      messages: buildAnthropicMessages(args.messages, args.file),
      maxTokens: 800,
    });
    const normalized = normalizeConversationGuideResult(
      parseJsonObject<ConversationGuideParsed>(text),
      args.frameworks,
      fallbackAssessment,
      args.messages
    );
    if (normalized) return promoteAskProblemToClarify(normalized);
  }

  const fallbackContext = collectPmContext(args.messages, args.file);
  const hasMeaningfulPmContext = hasPmSignal(fallbackContext, args.file);
  return {
    status: hasMeaningfulPmContext
      ? fallbackAssessment.shouldClarify
        ? "clarify"
        : "ready"
      : "ask_problem",
    assistantResponse: hasMeaningfulPmContext
      ? fallbackAssessment.shouldClarify
        ? buildClarificationMessageV3(fallbackAssessment)
        : ""
      : "Describe the product decision, uncertainty, or PM problem you want Prodforce to help resolve.",
    situationSummary: fallbackAssessment.situationSummary,
    presentInformation: Array.from(fallbackAssessment.presentSignals).map(
      (key) => SIGNAL_META[key].label
    ),
    contextRequired: fallbackAssessment.missingInformation.slice(0, 3),
    nextQuestion: fallbackAssessment.clarificationQuestions[0] ?? "",
    suggestedReplies: fallbackAssessment.suggestedReplies,
    categoryDecisions: fallbackAssessment.categoryDecisions,
    frameworkDecisions: fallbackAssessment.frameworkDecisions,
  } satisfies ConversationGuideResult;
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
  const unlockFrameworks =
    conversationMode === "pm" && shouldUnlockFrameworkReasoning(messages, file);
  const hiddenFrameworkCandidates =
    conversationMode === "pm" ? getFrameworkCandidates(provider, frameworks, messages, file) : [];
  const frameworkCandidates = unlockFrameworks ? hiddenFrameworkCandidates : [];
  const guide = await runConversationGuide({
    provider,
    frameworks: hiddenFrameworkCandidates,
    messages,
    file,
    unlockFrameworks,
  });

  if (guide.status === "ask_problem") {
    await send({
      type: "agent_start",
      agent: "orchestrator",
      label: "Waiting for a real product decision...",
    });
    await send({
      type: "content",
      text: guide.assistantResponse,
    });
    await send({
      type: "done",
      mode: "ask_problem",
      suggestions: [],
    });
    return;
  }

  if (guide.status === "clarify") {
    const askedInformation = guide.contextRequired.slice(0, 1);
    const deferredInformation = guide.contextRequired.slice(1);
    await send({
      type: "agent_start",
      agent: "orchestrator",
      label: "Grounding the next missing input before framework application...",
    });
    await send({
      type: "clarification_needed",
      situationSummary: guide.situationSummary,
      missingInformation: guide.contextRequired,
      askedInformation,
      deferredInformation,
      presentInformation: guide.presentInformation,
      questions: guide.nextQuestion ? [guide.nextQuestion] : [],
      candidateCategories: guide.categoryDecisions.map((decision) => decision.category),
      categoryDecisions: guide.categoryDecisions,
      lockedCategories: guide.categoryDecisions
        .filter((decision) => decision.locked)
        .map((decision) => decision.category),
      candidateFrameworks: guide.frameworkDecisions.slice(0, 3).map((framework) => ({
        slug: framework.slug,
        title: framework.title,
        category: framework.category,
        whenToUse: framework.whenToUse,
        inputsRequired: framework.inputsRequired,
        outputArtifact: framework.outputArtifact,
      })),
      frameworkDecisions: guide.frameworkDecisions,
      lockedFrameworks: guide.frameworkDecisions
        .filter((decision) => decision.locked)
        .map((decision) => decision.slug),
      suggestedReplies: guide.suggestedReplies,
    });
    await send({
      type: "content",
      text: guide.assistantResponse,
    });
    await send({
      type: "done",
      mode: "clarify",
      suggestions: guide.suggestedReplies,
    });
    return;
  }

  const orchestratorFrameworkPool = (() => {
    const bySlug = new Map(frameworks.map((framework) => [framework.slug, framework]));
    const guided = guide.frameworkDecisions
      .map((decision) => bySlug.get(decision.slug))
      .filter((framework): framework is Framework => Boolean(framework));
    const merged = Array.from(
      new Map(
        guided.concat(frameworkCandidates).map((framework) => [framework.slug, framework])
      ).values()
    );
    return merged.length ? merged : frameworkCandidates.length ? frameworkCandidates : frameworks;
  })();
  const intakeAssessment = assessFrameworkReadiness(orchestratorFrameworkPool, messages, file);

  const orchestratorResult = await runOrchestrator({
    provider,
    frameworks: orchestratorFrameworkPool,
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
      orchestratorFrameworkPool[0] ??
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
    situationSummary: guide.situationSummary || orchestratorResult.situation_summary,
    suggestions: orchestratorResult.follow_up_suggestions,
    categoryDecisions: guide.categoryDecisions.length
      ? guide.categoryDecisions
      : intakeAssessment.categoryDecisions,
    lockedCategories: (guide.categoryDecisions.length
      ? guide.categoryDecisions
      : intakeAssessment.categoryDecisions)
      .filter((decision) => decision.locked)
      .map((decision) => decision.category),
    frameworks: activeMatchedFrameworks.map(({ framework, reason }) => {
      const coverage =
        intakeAssessment.coverageBySlug[framework.slug] ??
        buildFrameworkCoverage(framework, intakeAssessment.presentSignals);
      const frameworkDecision =
        guide.frameworkDecisions.find((decision) => decision.slug === framework.slug) ??
        intakeAssessment.frameworkDecisions.find((decision) => decision.slug === framework.slug) ??
        null;

      return {
        ...coverage,
        slug: framework.slug,
        title: framework.title,
        category: framework.category,
        whenToUse: framework.whenToUse,
        whenToUseFull: framework.whenToUseFull,
        inputsRequired: framework.inputsRequired,
        outputArtifact: framework.outputArtifact,
        commonMistakes: framework.commonMistakes,
        tags: framework.tags,
        score: frameworkDecision?.score ?? 0,
        decisionConfidence: frameworkDecision?.confidence ?? coverageToNumber(coverage),
        decisionConfidenceLabel:
          frameworkDecision?.confidenceLabel ?? describeConfidence(coverageToNumber(coverage)),
        locked: frameworkDecision?.locked ?? false,
        reason: reason || "Strong contextual fit for your situation.",
      };
    }),
    frameworkDecisions: guide.frameworkDecisions.length
      ? guide.frameworkDecisions
      : intakeAssessment.frameworkDecisions,
    lockedFrameworks: (guide.frameworkDecisions.length
      ? guide.frameworkDecisions
      : intakeAssessment.frameworkDecisions)
      .filter((decision) => decision.locked)
      .map((decision) => decision.slug),
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

      let analysis = "";
      try {
        analysis =
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
      } catch (error) {
        console.warn("[prodforce-specialist] Specialist fallback:", error);
        analysis = buildSpecialistFallbackAnalysis(framework);
      }

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
