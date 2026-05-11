export type Route = "answer" | "clarify" | "guide";

export type Suggestion = {
  icon: string;
  text: string;
  tag: string;
  route: Route;
};

export const SUGGESTIONS: Suggestion[] = [
  // ─── Answer route: clear, single-intent queries (high cos, big margin)
  {
    icon: "🪪",
    tag: "Everyday",
    text: "How do I renew my driving licence?",
    route: "answer",
  },
  {
    icon: "👶",
    tag: "Life event",
    text: "How do I order a birth certificate for my newborn?",
    route: "answer",
  },
  {
    icon: "🐝",
    tag: "Niche",
    text: "How do I register as a beekeeper in NSW?",
    route: "answer",
  },
  {
    icon: "🏡",
    tag: "Money",
    text: "What help is there for first-home buyers in NSW?",
    route: "answer",
  },
  // ─── Clarify route: ambiguous on purpose (multiple matches, low margin)
  {
    icon: "❓",
    tag: "Ambiguous",
    text: "I need a licence",
    route: "clarify",
  },
  {
    icon: "📝",
    tag: "Vague",
    text: "How do I apply online?",
    route: "clarify",
  },
  // ─── Guide route: out of corpus → polite refusal, no LLM call
  {
    icon: "🌤️",
    tag: "Off-topic",
    text: "What's the weather in Sydney today?",
    route: "guide",
  },
  {
    icon: "🍕",
    tag: "Off-topic",
    text: "What's the best pizza place in Bondi?",
    route: "guide",
  },
];
