# Chatbot — Service NSW (Next.js app)

This folder is the deployable Next.js app. The interesting bits live here:

| Path | What it is |
|---|---|
| `app/api/chat/route.ts` | NDJSON streaming endpoint. Picks the response mode and emits `retrieved` / `token` / `perf` events. |
| `app/api/models/route.ts` | Lists chat models from the configured provider. |
| `app/api/warmup/route.ts` | Sends a 1-token completion to preload a model (TTFT win). |
| `app/api/debug/route.ts` | `?q=…` returns a `pickMode` trace — handy for tuning thresholds. |
| `lib/prompts.ts` | System prompt, mode picker, response-format spec. |
| `lib/retrieve/hybrid.ts` | BM25 + dense + RRF; falls back to BM25-only without embeddings. |
| `lib/retrieve/bm25.ts` | In-memory BM25. |
| `components/Chat.tsx` | Chat UI: mode-aware headers, `AnswerCard` variants, perf panel. |

For the high-level method, data structures, and deployment instructions see the [root README](../README.md) and **[docs/DATA-PIPELINE.md](../docs/DATA-PIPELINE.md)** (what `data/parsed`, `data/enriched`, `corpus`, and `.embeddings.json` are).

## Hybrid retrieval in production

Dense retrieval needs **`EMBED_BASE_URL` + `EMBED_API_KEY` + `EMBED_MODEL`** on the server. They must match whatever you used for `npm run build-index` (same model → same vector space). Cerebras does not provide embeddings; use OpenAI or another OpenAI-compatible `/v1/embeddings` host.

The built file **`corpus/.embeddings.json`** in this folder is ~tens of MB for the full site; it is tracked in git so Vercel bundles it with the app.

## Local dev

```powershell
npm install
copy .env.local.example .env.local        # edit values
npm run dev                               # http://localhost:3000
```

If you have Ollama running with `nomic-embed-text` and want hybrid retrieval, uncomment the `EMBED_*` lines in `.env.local` and run:

```powershell
npm run build-index
```

Without those, the app uses BM25 only — quality is still solid for ~100 docs.

## Deploy to Vercel

```powershell
vercel deploy
```

Then set in the Vercel dashboard:

- `LLM_BASE_URL=https://api.cerebras.ai/v1`
- `LLM_API_KEY=csk-…`
- `LLM_MODEL=llama-4-scout-17b-16e-instruct` *(or any model from `/api/models`)*
- `LLM_PROVIDER=cerebras` *(label only)*

Leave `EMBED_*` unset for BM25-only retrieval.

## Tuning the modes

Mode picking is driven by a few numbers in `.env.local`:

| Var | Default | Meaning |
|---|---|---|
| `ANSWER_AT` | `0.65` | top-1 score must be ≥ this to even consider answering |
| `CLARIFY_AT` | `0.40` | below this, route straight to `guide` |
| `MIN_MARGIN` | `0.05` | tight top1−top2 gap → ambiguous |
| `SHORT_QUERY_WORDS` | `5` | "vague" is fewer than this many words |

Use `/api/debug?q=your+query` to inspect what the picker decided and why.
