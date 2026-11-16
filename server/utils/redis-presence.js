class RedisPresence {
  constructor(client, { prefix, ttlMs = 120000, now = Date.now }) {
    this.client = client;
    this.prefix = prefix;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  key(room) {
    return `${this.prefix}:presence:${room}`;
  }

  async add(id, name, room) {
    await this.client.multi()
      .zAdd(this.key(room), { score: this.now() + this.ttlMs, value: JSON.stringify({ id, name }) })
      .pExpire(this.key(room), this.ttlMs * 2)
      .exec();
  }

  async remove(id, name, room) {
    await this.client.zRem(this.key(room), JSON.stringify({ id, name }));
  }

  async list(room) {
    const now = this.now();
    const [, members] = await this.client.multi()
      .zRemRangeByScore(this.key(room), '-inf', now)
      .zRangeByScore(this.key(room), now + 1, '+inf')
      .exec();
    return members.map((member) => JSON.parse(member).name);
  }
}

module.exports = { RedisPresence };
