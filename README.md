# Rumble Draft Planner

A 12-person royal-rumble simulation that picks your fantasy football draft order. Last wrestler standing gets pick #1; first one eliminated gets pick #12. Watch the match play out in 8-bit pixel art, then share the MP4 in your league group chat.

## Quick start

```bash
npm install
npm run dev        # open the URL it prints, in Chrome 126+ or Safari 17+
npm test           # 10 tests, ~4 seconds
npm run build      # production build to dist/
```

Use **Chrome 126+** or **Safari 17+** when running matches you want to share — Firefox produces WebM, which doesn't preview inline in iMessage.

## Deploy to Vercel

Zero-config. Two minutes from clone to live URL:

1. Sign in to [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project**, import this repository.
3. Pick the branch (`main` after merging, or the feature branch directly).
4. Click **Deploy**. Vite is auto-detected; the bundled `vercel.json` handles cache headers.

You get a URL like `your-project.vercel.app`. Open it on iPhone in Safari to verify mobile layout and replay links.

Netlify and Cloudflare Pages work identically — connect the repo, accept defaults, ship.

## How to use it

1. Enter 12 player names. Click any row to customize that player's avatar (skin tone, hair, gear color, accessory, etc.). Save your roster — it persists in `localStorage`, or export as JSON to share between devices.
2. Click **Start Rumble**. The match plays for 2–4 minutes while the app records the canvas + audio to an MP4.
3. On the results screen:
   - **Download MP4** — share in your league chat. Plays inline in iMessage on iPhone.
   - **Copy PNG** — clean draft-board image for screenshots.
   - **Copy Replay Link** — anyone who taps the link sees the exact same match play out.

## Sharing strategy

- **Desktop records → phones watch.** This is the optimized path. Run the match in Chrome/Safari on your computer, drop the resulting MP4 into your league group chat, everyone watches it on their iPhones.
- **Replay links** work great from phones — the match is deterministic from the seed, so a tapped link replays the same outcome anywhere.
- Recording *on* iPhone is unreliable (Safari's MediaRecorder is spotty over long captures). Don't depend on it.

## How the math stays fair

Every wrestler has exactly 1/12 odds of any finishing position. The match engine pre-shuffles `[0..11]` using a seeded Fisher-Yates at match start; the visual simulation only *performs* that script. No live game logic ever reads the RNG to *choose* who is eliminated — it only chooses cosmetics (which move, which rope side, lead-up timing).

Two tests gate this property:

- **`uniformity.test.ts`** — 100,000 simulated matches, asserts each wrestler index hits each finishing position within ±3% of 1/12.
- **`uniformity.test.ts` (end-to-end)** — 200 full sim runs, asserts the observed elimination order matches the scheduled order exactly. Catches any bug where the tick loop accidentally diverges from the schedule.

Plus determinism tests confirming that same-seed runs produce identical trajectories, events, and event counts — which is what makes the replay-link feature trustworthy.

## Tech

- **React + Vite + TypeScript**, Canvas 2D for rendering, Zustand for state.
- **Mulberry32** seeded PRNG (replaces `Math.random` throughout the sim).
- **MediaRecorder** for video capture; MP4/H.264 preferred, WebM/VP9 fallback.
- **Web Audio API** for procedurally synthesized SFX, routed through `MediaStreamDestination` for sample-accurate audio capture.
- **lz-string** for compact URL-hash replay payloads.

No backend. Everything is a static asset.

## Known limitations

- **No background music yet.** Drop an MP3 in `public/audio/` and call it from `src/audio/engine.ts` if you want one.
- **Procedural sprites, not hand-drawn.** The sprite pipeline accepts a baked `HTMLCanvasElement`, so real PNG sprite sheets can swap in cleanly via `composeAvatarSheet`.
- **Firefox**: records WebM only. Add `ffmpeg.wasm` to transcode if you need MP4 there.
