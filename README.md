# Node Chat App

Anonymous, room-based chat with text messages, location sharing, and a live user
list. Updated for Node 24, Socket.IO 4, and Redis-backed deployment on Vercel.

## Local development

```sh
npm ci
npm start
```

Open http://localhost:3000. Without `REDIS_URL`, local development uses one
in-memory Socket.IO instance. This mode is never allowed in production.

To use Redis locally, copy `.env.example` to `.env`, set the connection URL, then:

```sh
node --env-file=.env server/server.js
```

The app does not load `.env` implicitly. Do not commit credentials.

## Deploy to Vercel

For a Git-based deployment, publish this modified repository to GitHub before
importing it. The same configuration can be deployed with the Vercel CLI.

1. Provision Redis with **TCP/TLS connections and Pub/Sub support**. Use a
   `redis://` or preferably `rediss://` URL, not an HTTP/REST endpoint. Select a
   region near the Vercel Function and check the provider's connection limits.
   Each Function instance uses two Redis connections.
2. Import the updated repository into Vercel. Use **Other** as the framework,
   select **Node.js 24.x**, and leave build/output overrides unset. There is no
   frontend build step. Do not select `public` as a static-only output directory:
   the HTTP server must handle `/socket.io/` too.
3. Enable **Fluid compute** in the Vercel project settings.
4. Set server-side environment variables before deploying:

   | Variable | Example | Purpose |
   | --- | --- | --- |
   | `REDIS_URL` | `rediss://default:password@host:6379` | Secret Redis connection URL |
   | `REDIS_CHANNEL_PREFIX` | `node-chat-production` | Isolates chat traffic on shared Redis |

   Give Preview and Production different prefixes (or separate Redis
   databases/instances). Give unrelated preview deployments different prefixes
   as well; sharing a prefix intentionally shares rooms. Never expose the URL
   in browser code or give it a public/client environment variable prefix.
5. Deploy. `api/index.js` exports an HTTP server without calling `listen()`;
   `vercel.json` routes requests to it and includes the static UI in the bundle.
6. Check `/healthz` returns `200` with `{"ready":true}`. Open two browser windows,
   join the same room, send text/location messages, and verify the user list.
   In developer tools, confirm `/socket.io/?...&transport=websocket` upgrades
   successfully. Check that another room cannot receive those messages.

Official hosting reference: https://vercel.com/docs/functions/websockets

### Operational behavior

- WebSocket-only transport avoids polling requests landing on other instances.
- The Redis adapter broadcasts across instances. Online names are derived from
  live sockets with `fetchSockets()`, not a process-local array or durable user
  records. Names need not be unique, and knowing a room name allows joining it.
- Function duration is set to 300 seconds. Connections can close on duration
  limits or deployments; the browser reconnects and rejoins automatically.
  There is no connection recovery/history, so messages during a reconnect can
  be lost. The status text shows connection failures.
- Initialization waits for Redis before admitting sockets. Missing production
  variables fail startup. Redis failures make health checks fail and reject
  chat operations rather than silently using isolated local rooms. Retries are
  bounded; after they are exhausted, restore Redis and redeploy/restart affected
  instances. Transient errors and abrupt instance loss may delay presence.
- Vercel Function execution/data-transfer and Redis usage may incur charges.
- This preserves the original anonymous chat model. It is not a hardened public
  messaging service: add authentication, authorization, message rate limits,
  and moderation before opening it to untrusted traffic. Payload size limits
  and basic validation are included, but are not substitutes for those controls.

## Tests

```sh
npm test
```

This runs the existing utility tests and local Socket.IO integration tests.
Cross-instance tests are explicitly skipped unless `TEST_REDIS_URL` is set:

```sh
TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
```

Use a disposable development Redis server. Tests use random channel prefixes
and close their connections without flushing Redis.

Dependency audit at preparation time: no production dependency advisories;
the Mocha development-only dependency tree has five advisories, including one
high-severity advisory. Compatible `npm audit fix` did not resolve them. Do not
run the test runner against untrusted test code. Recheck with `npm audit` before
deployment and update the test toolchain when upstream fixes are available.
