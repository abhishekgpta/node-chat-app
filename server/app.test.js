const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createChatServer } = require('./app');

function event(socket, name, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error(`Missing ${name}`));
    }, 3000);
    function receive(value) {
      if (!matches(value)) return;
      clearTimeout(timeout);
      socket.off(name, receive);
      resolve(value);
    }
    socket.on(name, receive);
  });
}

function emit(socket, name, payload) {
  return socket.timeout(3000).emitWithAck(name, payload);
}

describe('chat server', () => {
  let chat;
  let sockets;
  let url;

  beforeEach(async () => {
    sockets = [];
    chat = createChatServer({ redisUrl: '', production: false });
    await chat.ready;
    await new Promise((resolve) => chat.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${chat.server.address().port}`;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await chat.close();
  });

  async function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await event(socket, 'connect');
    return socket;
  }

  it('serves the UI and matching Socket.IO browser client', async () => {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(`${url}/socket.io/socket.io.js`)).status, 200);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
  });

  it('rejects malformed joins and accepts events without acknowledgements', async () => {
    const socket = await client();
    assert.equal(await emit(socket, 'join', null), 'Name and room name are required.');
    assert.equal(await emit(socket, 'join', { name: '  ', room: 'office' }), 'Name and room name are required.');
    socket.emit('createMessage', null);
    socket.emit('createLocationMessage', null);
    assert.equal(await emit(socket, 'join', { name: 'Ada', room: 'office' }), undefined);
  });

  it('broadcasts messages and locations only within the joined room', async () => {
    const sender = await client();
    const peer = await client();
    const outsider = await client();
    await emit(sender, 'join', { name: 'Ada', room: 'office' });
    await emit(peer, 'join', { name: 'Grace', room: 'office' });
    await emit(outsider, 'join', { name: 'Other', room: 'other' });
    const leaked = [];
    outsider.on('newMessage', (message) => leaked.push(message));
    const message = event(peer, 'newMessage');
    await emit(sender, 'createMessage', { text: 'hello' });
    assert.equal((await message).text, 'hello');
    const location = event(peer, 'newLocationMessage');
    sender.emit('createLocationMessage', { latitude: 15, longitude: 19 });
    assert.equal((await location).url, 'https://www.google.com/maps?q=15,19');
    assert.equal(await emit(sender, 'createMessage', null), 'A valid message is required.');
    assert.equal(await emit(sender, 'createLocationMessage', { latitude: 100, longitude: 0 }), 'Valid coordinates are required.');
    assert.deepEqual(leaked, []);
  });

  it('updates presence when a socket switches rooms or disconnects', async () => {
    const first = await client();
    const second = await client();
    await emit(first, 'join', { name: 'Ada', room: 'office' });
    const joined = event(first, 'updateUserList');
    await emit(second, 'join', { name: 'Grace', room: 'office' });
    assert.deepEqual((await joined).sort(), ['Ada', 'Grace']);
    const left = event(first, 'updateUserList');
    await emit(second, 'join', { name: 'Grace', room: 'other' });
    assert.deepEqual(await left, ['Ada']);
    await emit(second, 'join', { name: 'Grace', room: 'office' });
    const disconnected = event(first, 'updateUserList', (names) => names.length === 1);
    second.disconnect();
    assert.deepEqual(await disconnected, ['Ada']);
  });
});

(process.env.TEST_REDIS_URL ? describe : describe.skip)('Redis multi-instance chat', () => {
  const chats = [];
  const sockets = [];
  const prefix = `chat-test-${require('node:crypto').randomUUID()}`;

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await Promise.all(chats.splice(0).map((chat) => chat.close()));
  });

  async function instance(channelPrefix = prefix) {
    const chat = createChatServer({
      production: true,
      redisUrl: process.env.TEST_REDIS_URL,
      channelPrefix
    });
    chats.push(chat);
    await chat.ready;
    await new Promise((resolve) => chat.server.listen(0, '127.0.0.1', resolve));
    const socket = connect(`http://127.0.0.1:${chat.server.address().port}`, {
      transports: ['websocket'], forceNew: true
    });
    sockets.push(socket);
    await event(socket, 'connect');
    return socket;
  }

  it('shares presence, messages and disconnects across instances', async () => {
    const first = await instance();
    const second = await instance();
    await emit(first, 'join', { name: 'Ada', room: 'office' });
    const joined = event(first, 'updateUserList', (names) => names.length === 2);
    await emit(second, 'join', { name: 'Grace', room: 'office' });
    assert.deepEqual((await joined).sort(), ['Ada', 'Grace']);
    const message = event(first, 'newMessage', (value) => value.text === 'across instances');
    await emit(second, 'createMessage', { text: 'across instances' });
    assert.equal((await message).from, 'Grace');
    const left = event(first, 'updateUserList', (names) => names.length === 1);
    second.disconnect();
    assert.deepEqual(await left, ['Ada']);
  });

  it('can join even when an idle adapter subscriber does not respond', async () => {
    const idle = require('redis').createClient({ url: process.env.TEST_REDIS_URL });
    await idle.connect();
    await idle.subscribe(`${prefix}-request#/#`, () => {});
    try {
      const socket = await instance();
      await emit(socket, 'join', { name: 'Ada', room: 'office' });
    } finally {
      await idle.quit();
    }
  });

  it('isolates environments using channel prefixes', async () => {
    const first = await instance();
    const other = await instance(`${prefix}-preview`);
    const names = event(first, 'updateUserList');
    await emit(first, 'join', { name: 'Ada', room: 'office' });
    assert.deepEqual(await names, ['Ada']);
    const otherNames = event(other, 'updateUserList');
    await emit(other, 'join', { name: 'Grace', room: 'office' });
    assert.deepEqual(await otherNames, ['Grace']);
    const received = [];
    other.on('newMessage', (message) => received.push(message));
    await emit(first, 'createMessage', { text: 'production only' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(received, []);
  });

  it('rejects chat operations and fails health checks when Redis is lost', async () => {
    const socket = await instance();
    await emit(socket, 'join', { name: 'Ada', room: 'office' });
    const chat = chats[0];
    chat.io.of('/').adapter.pubClient.destroy();
    const response = await fetch(`http://127.0.0.1:${chat.server.address().port}/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ready: false });
    assert.equal(await emit(socket, 'createMessage', { text: 'must not send' }),
      'Chat is temporarily unavailable. Please try again.');
  });
});

describe('production configuration', () => {
  it('rejects missing Redis configuration', () => {
    assert.throws(() => createChatServer({ production: true, redisUrl: '' }), /REDIS_URL/);
    assert.throws(() => createChatServer({ production: true, redisUrl: 'redis://localhost:6379', channelPrefix: '' }), /REDIS_CHANNEL_PREFIX/);
  });

  it('waits for Redis initialization before returning startup health', async () => {
    const chat = createChatServer({
      production: true,
      redisUrl: 'redis://127.0.0.1:1',
      channelPrefix: 'startup-health-test'
    });
    let initializationSettled = false;
    const settled = chat.ready.catch(() => {}).then(() => { initializationSettled = true; });
    try {
      await new Promise((resolve) => chat.server.listen(0, '127.0.0.1', resolve));
      const response = await fetch(`http://127.0.0.1:${chat.server.address().port}/healthz`);
      assert.equal(response.status, 503);
      assert.equal(initializationSettled, true);
    } finally {
      await settled;
      await chat.close();
    }
  });
});
