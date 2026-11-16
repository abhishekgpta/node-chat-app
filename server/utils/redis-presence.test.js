const assert = require('node:assert/strict');
const { createClient } = require('redis');
const { RedisPresence } = require('./redis-presence');

(process.env.TEST_REDIS_URL ? describe : describe.skip)('Redis presence expiry', () => {
  let client;
  let presence;
  let now;

  beforeEach(async () => {
    client = createClient({ url: process.env.TEST_REDIS_URL });
    await client.connect();
    now = Date.now();
    presence = new RedisPresence(client, {
      prefix: `presence-test-${require('node:crypto').randomUUID()}`,
      ttlMs: 1000,
      now: () => now
    });
  });

  afterEach(async () => { await client.quit(); });

  it('expires abandoned users while heartbeats keep active users visible', async () => {
    await presence.add('abandoned', 'Ada', 'office');
    await presence.add('active', 'Grace', 'office');
    now += 800;
    await presence.add('active', 'Grace', 'office');
    now += 300;
    assert.deepEqual(await presence.list('office'), ['Grace']);
  });

  it('removes only the disconnected socket and isolates room membership', async () => {
    await presence.add('first', 'Ada', 'office');
    await presence.add('second', 'Ada', 'office');
    await presence.add('other', 'Grace', 'other');
    await presence.remove('first', 'Ada', 'office');
    assert.deepEqual(await presence.list('office'), ['Ada']);
    assert.deepEqual(await presence.list('other'), ['Grace']);
  });
});
