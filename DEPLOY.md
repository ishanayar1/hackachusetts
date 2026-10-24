# Deploy LastMile to Vercel

Next.js app. Vercel hosts it free, with HTTPS and a preview link per push.

## First deploy (once, ~5 min)

1. Go to https://vercel.com and sign in with GitHub.
2. **Add New… → Project** → import `ishanayar1/hackachusetts`.
3. Vercel auto-detects Next.js. Leave the build settings as-is:
   - Build command: `next build` (default)
   - Output: `.next` (default)
4. **Environment Variables** — add before deploying:
   | Name | Value |
   |------|-------|
   | `MBTA_API_KEY` | your real MBTA key |
   | `ANTHROPIC_API_KEY` | only if doing translation (optional) |
   Do NOT prefix with `NEXT_PUBLIC_`. These are server-side only.
5. **Deploy.** You get a live HTTPS URL in ~2 min.

## After the first deploy

- Every push to `main` → auto-deploys to the production URL.
- Every pull request → gets its own **preview URL**. Share it with judges to test a branch before merge.

## If the deploy fails

Vercel shows the build log. Common causes:
- A TypeScript error → run `npm run typecheck` locally and fix.
- A missing `public/data/*.json` → run `npm run build:data` and commit the output.
- Missing `MBTA_API_KEY` → the build still succeeds; live data just falls back to cached/demo until you add the key.

## Why Vercel (not Render/Railway)

Free container hosts sleep when idle — the first load takes 30+ seconds, bad when a
judge taps the link. Vercel never sleeps and needs no credit card.
