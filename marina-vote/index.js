// Marina Naming Contest — realtime vote backend + static host
//
// A single Durable Object ("VoteRoom") holds the vote tally and pushes live
// updates to every connected browser over WebSockets. Because a Durable Object
// is single-threaded, concurrent votes can never clobber each other.
//
// Client connects to:  wss://<host>/api/connect   (WebSocket)
// Messages in:   { type:'vote',   user, names:[...] }
//                { type:'winner', winner:"key"|"" }
// Messages out:  { type:'state',  votes:{ "name::who":[user,...] }, winner }
//
// REST fallbacks (also routed to the DO) for clients without a live socket:
//   GET  /api/votes  POST /api/vote  POST /api/winner  POST /api/reset

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname.startsWith('/api/')) {
      const id = env.VOTE_ROOM.idFromName('contest');   // one shared room
      return env.VOTE_ROOM.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);                    // serve public/index.html
  }
};

export class VoteRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.votes = null;   // { user: [names] }
    this.winner = null;
  }

  async load() {
    if (this.votes === null) {
      this.votes = (await this.ctx.storage.get('votes')) || {};
      this.winner = (await this.ctx.storage.get('winner')) || null;
    }
  }

  aggregate() {
    const out = {};
    for (const [user, names] of Object.entries(this.votes)) {
      for (const nk of names) (out[nk] = out[nk] || []).push(user);
    }
    return out;
  }

  snapshot() {
    return { type: 'state', votes: this.aggregate(), winner: this.winner };
  }

  broadcast() {
    const str = JSON.stringify(this.snapshot());
    for (const sock of this.ctx.getWebSockets()) {
      try { sock.send(str); } catch (e) {}
    }
  }

  async applyVote(user, names) {
    await this.load();
    user = String(user || '').trim().slice(0, 60);
    if (!user) return;
    names = Array.isArray(names) ? names.slice(0, 400).map(String) : [];
    if (names.length === 0) delete this.votes[user];
    else this.votes[user] = names;
    await this.ctx.storage.put('votes', this.votes);
    this.broadcast();
  }

  async applyWinner(w) {
    await this.load();
    this.winner = w ? String(w) : null;
    await this.ctx.storage.put('winner', this.winner);
    this.broadcast();
  }

  async fetch(request) {
    const url = new URL(request.url);
    await this.load();

    if (url.pathname === '/api/connect') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);            // hibernation-aware
      server.send(JSON.stringify(this.snapshot())); // send current state immediately
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/api/votes' && request.method === 'GET') {
      return json(this.snapshot());
    }
    if (url.pathname === '/api/vote' && request.method === 'POST') {
      let b; try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      await this.applyVote(b.user, b.names);
      return json({ ok: true });
    }
    if (url.pathname === '/api/winner' && request.method === 'POST') {
      let b; try { b = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
      await this.applyWinner(b.winner);
      return json({ ok: true });
    }
    if (url.pathname === '/api/reset' && request.method === 'POST') {
      await this.ctx.storage.deleteAll();
      this.votes = {}; this.winner = null;
      this.broadcast();
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }

  // ── WebSocket hibernation handlers ──
  async webSocketMessage(ws, message) {
    let msg; try { msg = JSON.parse(message); } catch { return; }
    if (msg.type === 'vote') await this.applyVote(msg.user, msg.names);
    else if (msg.type === 'winner') await this.applyWinner(msg.winner);
    else if (msg.type === 'ping') { try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) {} }
  }
  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch (e) {}
  }
  async webSocketError() { /* no-op */ }
}
