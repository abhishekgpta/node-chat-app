# Vercel chat deployment

Approved approach: run the existing chat UI and a Socket.IO 4 HTTP server on
Vercel with Fluid compute. Use WebSocket-only transport and the Redis adapter
to broadcast across instances. Store names and room membership in socket data;
derive presence with fetchSockets instead of maintaining an in-memory user list.
Reconnects rejoin rooms. Messages are ephemeral and are not replayed.

## Approaches

- Redis-backed Vercel: selected by the user for cross-instance messaging.
- In-memory Vercel: rejected because rooms would be isolated per instance.
- Separate socket hosting: unnecessary given current Vercel WebSocket support.

Use Node 24, a TCP/TLS Redis URL, an environment-specific channel prefix, and
bounded connection retries. Production must fail closed without Redis. Preserve
the anonymous chat behavior; authentication, persistence, and public abuse
protection are outside this deployment change. Do not push or deploy remotely.

Follow-up authorization: the user subsequently requested publishing and deploying
the prepared app, and completed GitHub and Vercel sign-in on 2026-11-16.

Reference: https://vercel.com/docs/functions/websockets (checked 2026-11-15).

Deployment-driven adjustment: managed Redis diagnostics reproduced timeouts
waiting for idle Vercel adapter subscribers to answer `fetchSockets()`. Replace
distributed presence queries with Redis sorted-set leases renewed every 45
seconds and expiring after 120 seconds. Keep the adapter for room broadcasts.
Normal disconnects remove their lease; abandoned leases expire without waiting
for a paused instance. Presence after abrupt termination is eventually consistent.
