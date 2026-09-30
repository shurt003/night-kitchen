# Night Kitchen — a recipe app for your phone

Capture recipes from anywhere on your phone, let AI clean them up, and actually cook them.
Built for a household or a few friends: each person logs in with their own password and
gets their own private library. Next.js + Supabase + Anthropic + Vercel, installed on
iOS as a home-screen web app.

**What it does**

- **Capture from anywhere** — share a URL, a stack of screenshots, a PDF, or plain text
  from the iOS share sheet; AI extracts a clean recipe in the background.
- **Library** — semantic search ("that soup with the coconut milk"), filters, hearts,
  notes, effort, cook log, duplicate flagging.
- **Cook mode** — wake lock, inline timers, a scaler, and an Ask chat about the recipe.
- **Week planner** — plan recipes, quick meals, or AI-invented "Wing it" ideas; send a
  week's ingredients to the grocery list.
- **Grocery list** — local-first and works offline, merges duplicates, remembers which
  aisle things go in, carries unbought items to the next trip. Plus staples and pantry.
- **Export** — download your whole library as one JSON file.

See `DESIGN.md` for the visual/motion direction.

---

## Setup order

### 1. Supabase (~5 min)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run every file in
   [`supabase/migrations/`](supabase/migrations/) **in order** (`001` → `010`), pasting
   each one in full. `001` creates the tables, pgvector + trigram indexes, the
   `match_recipes` RPC, and a public `captures` storage bucket; the rest layer on
   ingredient canonicalization, users, per-user scoping, and later columns.
3. Create your first user (still in the SQL Editor). Login is password-only — the app
   finds you by your password — so every user needs a different one:
   ```sql
   insert into users (name, password, capture_key)
   values ('Your name', 'a-long-password', replace(gen_random_uuid()::text, '-', ''))
   returning capture_key;
   ```
   Keep the returned `capture_key` — it's your key for the iOS Shortcut. Add more people
   the same way.
4. Grab from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (server-only; RLS is enabled with
     no policies, so the public anon key can read nothing)

### 2. Anthropic

Create an API key at [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`.
Model IDs live in one place: [`lib/config.ts`](lib/config.ts)
(`claude-haiku-4-5` for extraction/tagging/categorization, `claude-sonnet-5` for planning/chat).

### 3. Voyage AI (optional but recommended)

Semantic search ("that soup with the coconut milk") uses embeddings. Anthropic's API has no
embeddings endpoint, so this uses **Voyage AI** (Anthropic's recommended embeddings partner) —
free tier is plenty for a personal library. Key from [voyageai.com](https://www.voyageai.com)
→ `VOYAGE_API_KEY`. **Without it, everything still works; search falls back to keyword matching.**

### 4. Local env + run

```bash
cp .env.example .env.local   # fill in every value (APP_PASSWORD + CAPTURE_API_KEY are yours to invent)
npm install
npm run dev
```

`APP_PASSWORD` isn't a login password — it's the server secret that signs login cookies,
so make it long and random. Log in with the password you gave your user row.
`CAPTURE_API_KEY` is legacy (only the `/health` page checks it); set it to anything.
Requires Node 22 (see `.nvmrc`).

Open http://localhost:3000 — you'll hit the password gate; log in with your user's password.

### 5. Test capture with curl (before building the Shortcut)

Set `CAPTURE_KEY` to your user's `capture_key` from step 1 first.

```bash
# URL capture — should return {"id":"...","status":"pending"} in well under a second
curl -s -X POST http://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CAPTURE_KEY" \
  -d '{"url": "https://cooking.nytimes.com/recipes/1017089-marcella-hazans-tomato-sauce"}'

# Text capture
curl -s -X POST http://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CAPTURE_KEY" \
  -d '{"text": "Garlic bread. 1 baguette, 4 cloves garlic, 100g butter. Mix, spread, bake 10 min at 200C."}'

# Screenshot capture (base64 images, in scroll order)
curl -s -X POST http://localhost:3000/api/capture \
  -H "Content-Type: application/json" \
  -H "x-api-key: $CAPTURE_KEY" \
  -d "{\"images\": [\"$(base64 -i screenshot1.png)\", \"$(base64 -i screenshot2.png)\"]}"
```

Then open the Library — the skeleton card appears immediately and materializes when
extraction finishes (a few seconds).

### 6. Deploy to Vercel

```bash
npx vercel
```

- Add all env vars from `.env.example` in the Vercel project settings.
- Extraction runs **after** the capture response via Next's `after()` — on Vercel the
  function stays alive post-response, so no queue infra is needed. `maxDuration = 300`
  is set on the capture route; on the free Hobby plan functions cap lower, so if long
  extractions get cut off, either upgrade or lower expectations for huge screenshot stacks.
- Request body limit on Vercel is ~4.5 MB — the Shortcut below resizes screenshots to
  stay under it.

---

## iOS Shortcut

Create a new Shortcut named **"Save recipe"**:

1. **Settings (ⓘ tab)** → enable **Show in Share Sheet**. Accepted types: **URLs, Images, PDFs, Text**.
2. The flow (add these actions in order):
   - **Get Type** of *Shortcut Input*.
   - **If** Type **is** *URL*:
     - **Get Contents of URL**:
       - URL: `https://YOUR-APP.vercel.app/api/capture`
       - Method: `POST`
       - Headers: `x-api-key` = your user's `capture_key`
       - Request Body: `JSON` → field `url` = *Shortcut Input*
   - **Otherwise, If** Type **is** *Image*:
     - **Resize Image** → width `1200`, height auto (keeps payloads under Vercel's limit)
     - **Repeat with Each** (resized images) → **Base64 Encode** → add to variable `imgs`
     - **Get Contents of URL** (same URL/headers), Request Body `JSON` → field `images` = list `imgs`
       *(simpler alternative: build a "Text" body of `{"images": ["...","..."]}` with the
       Combine Text action — whichever you find easier in the Shortcuts editor)*
   - **Otherwise, If** Type **is** *PDF*:
     - **Base64 Encode** → **Get Contents of URL**, body field `pdf` = encoded input
   - **Otherwise** (Text):
     - **Get Contents of URL**, body field `text` = *Shortcut Input*
3. Optional: add a **Show Notification** action — "Saved 🔥" — after the request.

**Usage:** in Safari/Instagram/Reddit → Share → *Save recipe*. For a scrolling recipe,
take your screenshots first (in order, overlapping is fine), then select them all in
Photos → Share → *Save recipe*. Safari's **Full Page** screenshot → *Save as PDF* →
Share → *Save recipe* also works and is often the best capture for long blog recipes.

The endpoint responds in under a second; extraction continues in the background and the
recipe assembles itself in the app.

---

## Architecture notes

- **Async extraction:** `POST /api/capture` inserts a `pending` recipe row + a
  `pending_captures` retry row, responds immediately, then runs extraction in
  `after()` (post-response). Failures mark the card `failed` with a readable error and a
  one-tap **Retry** (`POST /api/recipes/[id]/retry`) that re-reads the original payload
  from `raw_capture` / Storage — the original share is never lost.
- **Screenshots** are sent to Claude as **one message with all images in order** so
  overlapping scroll captures get deduplicated into a single recipe; model-reported
  `gaps` surface as a quiet "might be incomplete" flag, never a failure.
- **Duplicate detection** runs after extraction (Haiku over title + main ingredients),
  sets `possible_duplicate_of`, and the UI shows a soft dismissible prompt. Never blocks,
  never auto-merges.
- **Search** blends pgvector cosine similarity (Voyage embeddings over
  title/description/main ingredients/notes) with keyword + ingredient-overlap hits.
- **Grocery merging** happens server-side on add: same normalized name in the open trip
  → quantities sum when units match ("2 cloves" + "3 cloves" = "5 cloves"), sources are
  preserved on the item so you can see why it's on the list.
- **Section corrections persist** in `item_section_prefs` by normalized item name and win
  over AI categorization forever after.
- **Token spend** for every AI call lands in the `usage` table
  (`select feature, sum(input_tokens), sum(output_tokens) from usage group by 1;`).
- **URL extraction cache**: `extraction_cache` keyed by URL hash — re-saving a link is free.
- **PWA + offline grocery list:** install from Safari via Share → *Add to Home Screen*
  (standalone, no browser chrome). The grocery list is **local-first**: state lives in
  localStorage, every change applies instantly and enqueues a sync op, and a flush loop
  replays the queue on reconnect (`lib/useGrocery.ts`). A service worker (`public/sw.js`,
  production only) keeps the app shell openable with zero signal; API data is never
  cached, so nothing stale renders. Items added offline land in "Other" and jump to their
  real section when Haiku categorizes them on sync.
- **Ingredient canonicalization:** Haiku normalizes on write ("scallions" and
  "green onions" → `green onion`), cached forever in `ingredient_aliases`, stored as
  `canonical_name` on each list item. Merging, section prefs, and (future) pantry
  matching all key on the canonical name.
- **Undo, not confirmations:** removing an item or archiving a trip just happens, with a
  6-second undo toast. Archive-undo reopens the trip server-side
  (`POST /api/grocery/archive/undo`); the archive sheet remains only as the carry-over picker.
- **Export:** `GET /api/export` downloads the entire library (recipes, cook log, trips,
  items, staples, prefs, aliases) as one JSON file. You're never trapped in the app.

- **Per-user silos:** every owned table carries a `user_id`, and every query filters on
  it in app code (the server uses the service-role key, which bypasses RLS). The login
  cookie is signed with `APP_PASSWORD`, so it can't be edited to impersonate another
  user. The iOS Shortcut's `x-api-key` maps to a user's `capture_key`.

## License

[MIT](LICENSE)
