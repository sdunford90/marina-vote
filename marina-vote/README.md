# Marina Naming Contest — realtime voting

A Cloudflare Worker + Durable Object that serves the naming-contest page and
streams votes live to every connected browser. Anyone with the link can vote —
no Claude account, no sign-up — and everyone's tallies update instantly without
refreshing.



```
marina-vote/
  wrangler.jsonc      Worker + Durable Object + static-assets config
  src/index.js        the Worker entry + VoteRoom Durable Object
  public/index.html   the contest page (wired to the live WebSocket)
```

## How it works

- A single Durable Object named `contest` holds the whole vote tally in memory
  and persists it to SQLite storage.
- Each browser opens a WebSocket to `/api/connect`. When anyone votes, the DO
  updates the tally and broadcasts the new state to every open socket — so all
  screens update in real time.
- Because a Durable Object is single-threaded, two people voting at the same
  instant can't overwrite each other. No race conditions.
- If a socket drops, the page auto-reconnects and falls back to REST
  (`/api/vote`) in the meantime. The dot in the top bar shows "Live" (green)
  or "Reconnecting."
- Personal stuff (your name, your private ranking, the reveal toggle) stays in
  the browser's localStorage and never touches the server.

## Cost

SQLite-backed Durable Objects run on the Workers Free plan — free-plan accounts
are not charged for storage, and a staff naming contest is far under the free
compute limits. WebSocket hibernation means idle connections aren't billed for
duration. In practice this costs nothing.

## Deploy (about 3 minutes)

You already run a Worker for Rentvine, so this will feel familiar. No KV
namespace to create — the Durable Object handles its own storage.

1. Drop this folder somewhere and open a terminal in it.

2. Deploy:
   ```
   npx wrangler deploy
   ```
   The first deploy provisions the Durable Object automatically from the
   migrations block in wrangler.jsonc.

3. Wrangler prints a URL like https://marina-vote.<your-subdomain>.workers.dev
   That single link is the contest. Send it to the team.

## Using it

- Everyone opens the link, enters their name once, clicks names to vote.
- Every screen updates live — watch the counts tick as people vote.
- Results page (bar-chart icon) shows the leaderboard and who voted for what.
- When ready: Results -> "Narrow the top picks" -> rank -> crown a winner.
  The winner broadcasts to everyone instantly.

## Resetting the contest

Wipe all votes and the winner in one call:
```
curl -X POST https://marina-vote.<your-subdomain>.workers.dev/api/reset
```
This clears the Durable Object's storage and pushes an empty state to all
connected screens.

## Hosting the page elsewhere (optional)

To host the HTML on Netlify and keep only the backend on the Worker, open
public/index.html, find  const API_BASE = '';  near the top of the script and
set it to your Worker URL, e.g.
const API_BASE = 'https://marina-vote.<your-subdomain>.workers.dev';
The WebSocket URL is derived from it automatically, and the API sends
permissive CORS headers, so cross-origin works.
