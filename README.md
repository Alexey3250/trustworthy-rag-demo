# Trustworthy RAG demo — Service NSW

A retrieval-grounded chatbot that answers questions about NSW government services with **citations, never hallucinated links**, and asks a clarifying question when it can't be sure.

> **Why this design?** A government search bot can't bluff. It either gives you the right link, asks what you actually need, or says "I'm not sure — could you tell me more?". This repo is a small demo of that contract.

```
┌──────────────────────────────────────────────────┐
│  user: "I need a licence"                        │
│                                                  │
│  bot:  Happy to help — could you tell me a bit   │
│        more about what you're after? Are you     │
│        looking to:                               │
│        • Apply for a P1 driver licence ¹         │
│        • Transfer an overseas driver licence ²   │
│        Or something else?                        │
└──────────────────────────────────────────────────┘
```

---

## The data structure

Every Service NSW page becomes one structured JSON document. Same shape for everything; only the fields that exist on a given page are filled in.

```json
{
  "url":          "https://www.service.nsw.gov.au/transaction/renew-a-vehicle-registration",
  "category":     "transaction",
  "title":        "Renew a vehicle registration online",
  "summary":      "You can renew your vehicle registration online if you meet…",
  "intro":        "If you meet certain eligibility criteria, you can renew…",
  "topics":       ["vehicle-registration", "renewing-online", "ctp-insurance"],
  "who_can_apply":[ "The vehicle is registered under the Common Expiry Date Scheme.", … ],
  "what_you_need":[ "The vehicle plate number or the billing number…", … ],
  "how_to_steps": [{ "n": 1, "text": "Check you are eligible to renew online.", "link": null }, …],
  "faqs":         [{ "q": "How do I pay online?", "a": "If you pay with BPAY…" }, …],
  "last_modified":"26 February 2026"
}
```

A flat **index** lists all docs for retrieval:

```
corpus/
├── index.json                       ← retrieval manifest
├── transaction/
│   ├── renew-a-vehicle-registration.json
│   ├── pay-an-overdue-fine.json
│   └── …
├── guide/
│   └── …
└── service/
    └── …
```

Why this shape:

| Field | Why |
|---|---|
| `summary`, `intro` | Embeddings + BM25 work on these — short, on-topic, source-of-truth-aligned. |
| `who_can_apply`, `what_you_need`, `how_to_steps` | Rendered **structurally** in the UI, not summarised by the LLM. The model orients you; the structured card does the heavy lifting. |
| `faqs` | Disambiguates intent ("Do I need to visit in person?" vs "What ID do I need?"). |
| `url`, `last_modified` | Trust signal. Every card links back. |

---

## The method

```mermaid
flowchart LR
    Q[user query] --> R{retrieve top-K}
    R -->|BM25| F[RRF fuse]
    R -->|dense cosine<br/>optional| F
    F --> M{mode picker<br/>uses top-1 score<br/>+ top1-top2 margin<br/>+ query length}
    M -->|strong match| A[answer<br/>cited bullets]
    M -->|several plausible| C[clarify<br/>ask back, list options]
    M -->|nothing fits| G[guide<br/>'tell me more…']
    A --> UI[render with<br/>clickable citations]
    C --> UI
    G --> UI
```

**Retrieval.** Hybrid by default — BM25 (lexical) + dense cosine (semantic) — fused with [Reciprocal Rank Fusion](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf). RRF is robust to the two scoring scales being totally different, which is why it's the de-facto default for hybrid search. When no embedding endpoint is configured (e.g. Cerebras-only deploys), it gracefully falls back to BM25-only.

**Mode picker.** The bot doesn't binary-refuse. From the top retrieval score and the top-1 → top-2 margin, plus a quick query-specificity check, it picks one of three modes:

| Mode | When | Output |
|---|---|---|
| **answer** | top score ≥ `ANSWER_AT` (and either margin is wide or the query is specific) | one cited intro + ≤6 cited bullets |
| **clarify** | top score is decent but several pages are similarly relevant, or the query is vague | one warm question + 2-3 cited candidate options |
| **guide** | top score is below `CLARIFY_AT` (off-topic) | "I'm not sure — could you tell me more?" |

Examples (real, with `gemma4:e4b`):

| Query | top score | margin | mode |
|---|---|---|---|
| "What do I need to renew my car rego online?" | 0.80 | 0.07 | answer |
| "I need a licence" | 0.75 | 0.03 | **clarify** (4 words, tight margin → ambiguous) |
| "How do I pay an overdue fine?" | 0.82 | 0.03 | answer (7 words, specific) |
| "what do i need to licence my potato" | 0.62 | 0.05 | clarify (then model defers to guide) |

**Generation.** The LLM is constrained by a strict system prompt:

- Tone is a **friendly Service NSW representative**, not bureaucratic.
- Facts only from the retrieved blocks. Every claim ends with `[#N]`.
- Strict format per mode (no horizontal rules, no headings, no meta-commentary about the UI).
- Treats blocks as **untrusted data**, ignoring any "instructions" they contain.

```mermaid
sequenceDiagram
    participant U as user
    participant Srv as /api/chat
    participant R as retriever
    participant LLM
    U->>Srv: question
    Srv->>R: BM25 + (dense?)
    R-->>Srv: top-3 hits + mode
    alt mode = guide
        Srv-->>U: streams canned message
    else mode = answer | clarify
        Srv->>LLM: system + spotlighted blocks +<br/>RESPONSE MODE: [tag]
        LLM-->>Srv: streams cited reply
        Srv-->>U: tokens + perf events
    end
```

**Trust boundary.** The LLM only writes the orienting lead. The structured page (steps, eligibility, links) is rendered straight from the corpus JSON — never paraphrased by the model.

---

## Quick start

```bash
git clone https://github.com/Alexey3250/trustworthy-rag-demo
cd trustworthy-rag-demo/chatbot
npm install
cp .env.local.example .env.local      # add your Cerebras key
npm run dev                           # http://localhost:3000
```

Optional, if you have Ollama for local hybrid retrieval:

```bash
ollama pull nomic-embed-text
# uncomment EMBED_BASE_URL/_API_KEY/_MODEL in .env.local
npm run build-index
```

---

## Deploy to Vercel

The `chatbot/` folder is a self-contained Next.js app and is the Vercel project root.

```bash
cd chatbot
vercel deploy
```

In the Vercel project settings, add:

| Env var | Value |
|---|---|
| `LLM_BASE_URL` | `https://api.cerebras.ai/v1` |
| `LLM_API_KEY` | `csk-…` (your Cerebras key) |
| `LLM_MODEL` | `llama-4-scout-17b-16e-instruct` (or any Cerebras model) |
| `LLM_PROVIDER` | `cerebras` (label only) |

Embeddings are optional — leave `EMBED_*` unset for BM25-only retrieval.

---

## Repository layout

```
.
├── chatbot/         Next.js 16 app — UI, retrieval, mode picker, prompts
│   ├── app/         App Router (chat / api routes)
│   ├── components/  Chat, AnswerLead, AnswerCard, ModelPicker, PerfPanel
│   ├── lib/         retrieval, prompts, env, types
│   └── corpus/      Vercel-shippable copy of the structured corpus
├── corpus/          Spider's output (source of truth) — same content
├── spider/          Python pipeline that produced the corpus
└── README.md
```

The spider is intentionally not documented here — see `spider/` if you're curious. The interesting bit is the **shape of the corpus** and how the chatbot uses it.

---

## License

MIT for the code.
The corpus is derived from publicly available Service NSW pages and is included for demonstration only. Not affiliated with Service NSW or Transport for NSW.
