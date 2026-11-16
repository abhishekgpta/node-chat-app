const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { generateMessage, generateLocationMessage } = require('./utils/message');
const { isRealString } = require('./utils/validation');
const { RedisPresence } = require('./utils/redis-presence');

function createChatServer({
  redisUrl = process.env.REDIS_URL,
  channelPrefix = process.env.REDIS_CHANNEL_PREFIX,
  production = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production'
} = {}) {
  if (production && !redisUrl) throw new Error('REDIS_URL is required in production.');
  if (production && !channelPrefix) throw new Error('REDIS_CHANNEL_PREFIX is required in production.');

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { transports: ['websocket'], maxHttpBufferSize: 16384 });
  const clients = [];
  const operations = new Set();
  let initialized = !redisUrl;
  let presenceStore;

  function available() {
    return initialized && clients.every((client) => client.isReady);
  }

  const ready = (async () => {
    if (!redisUrl) return;
    const publisher = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => retries < 3 ? Math.min(100 * 2 ** retries, 1000) : false
      }
    });
    const subscriber = publisher.duplicate();
    clients.push(publisher, subscriber);
    clients.forEach((client) => client.on('error', () => {
      console.error('Redis connection error; chat is temporarily unavailable.');
    }));
    try {
      await Promise.all(clients.map((client) => client.connect()));
      io.adapter(createAdapter(publisher, subscriber, {
        key: channelPrefix || 'node-chat-local',
        requestsTimeout: 3000,
        publishOnSpecificResponseChannel: true
      }));
      presenceStore = new RedisPresence(publisher, { prefix: channelPrefix || 'node-chat-local' });
      initialized = true;
    } catch (error) {
      clients.forEach((client) => { if (client.isOpen) client.destroy(); });
      throw error;
    }
  })();
  ready.catch(() => console.error('Chat initialization failed; check Redis configuration.'));

  app.get('/healthz', async (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      await ready;
      response.status(available() ? 200 : 503).json({ ready: available() });
    } catch (error) {
      response.status(503).json({ ready: false });
    }
  });
  app.use(express.static(path.join(__dirname, '../public')));

  io.use(async (socket, next) => {
    try {
      await ready;
      if (!available()) throw new Error('Redis unavailable');
      next();
    } catch (error) {
      next(new Error('Chat is temporarily unavailable. Please try again.'));
    }
  });

  async function presence(room) {
    const names = presenceStore ? await presenceStore.list(room) :
      (await io.in(room).fetchSockets()).map((socket) => socket.data.name);
    io.to(room).emit('updateUserList', names);
  }

  io.on('connection', (socket) => {
    let pending = Promise.resolve();
    function run(action, callback) {
      const acknowledge = typeof callback === 'function' ? callback : () => {};
      pending = pending.then(async () => {
        if (!available()) throw new Error('Redis unavailable');
        return action(acknowledge);
      }).catch(() => {
        acknowledge('Chat is temporarily unavailable. Please try again.');
      });
      const operation = pending;
      operations.add(operation);
      operation.finally(() => operations.delete(operation));
    }

    const heartbeat = presenceStore ? setInterval(() => {
      if (!socket.connected || !socket.data.room) return;
      run(async () => {
        await presenceStore.add(socket.id, socket.data.name, socket.data.room);
        await presence(socket.data.room);
      });
    }, 45000) : null;
    if (heartbeat) heartbeat.unref();

    socket.on('join', (params, callback) => run(async (acknowledge) => {
      if (!params || !isRealString(params.name) || !isRealString(params.room) ||
          params.name.length > 80 || params.room.length > 120) {
        return acknowledge('Name and room name are required.');
      }
      if (!socket.connected) return;
      const previous = { ...socket.data };
      const room = `chat:${params.room.trim()}`;
      if (previous.room) {
        if (presenceStore) await presenceStore.remove(socket.id, previous.name, previous.room);
        await socket.leave(previous.room);
      }
      socket.data = { name: params.name.trim(), room };
      await socket.join(room);
      if (presenceStore) await presenceStore.add(socket.id, socket.data.name, room);
      if (previous.room && previous.room !== room) {
        await presence(previous.room);
        io.to(previous.room).emit('newMessage', generateMessage('Admin', `${previous.name} has left.`));
      }
      socket.emit('newMessage', generateMessage('Admin', 'welcome to the chat app'));
      await presence(room);
      socket.broadcast.to(room).emit('newMessage', generateMessage('Admin', `${socket.data.name} has joined.`));
      acknowledge();
    }, callback));

    socket.on('createMessage', (message, callback) => run((acknowledge) => {
      if (!socket.data.room || !message || !isRealString(message.text) || message.text.length > 4000) {
        return acknowledge('A valid message is required.');
      }
      io.to(socket.data.room).emit('newMessage', generateMessage(socket.data.name, message.text));
      acknowledge();
    }, callback));

    socket.on('createLocationMessage', (coords, callback) => run((acknowledge) => {
      if (!socket.data.room || !coords || !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
        return acknowledge('Valid coordinates are required.');
      }
      io.to(socket.data.room).emit('newLocationMessage', generateLocationMessage(
        socket.data.name, coords.latitude, coords.longitude
      ));
      acknowledge();
    }, callback));

    socket.on('disconnect', () => {
      clearInterval(heartbeat);
      run(async () => {
        const { room, name } = socket.data;
        if (!room) return;
        if (presenceStore) await presenceStore.remove(socket.id, name, room);
        await presence(room);
        io.to(room).emit('newMessage', generateMessage('Admin', `${name} has left.`));
      });
    });
  });

  async function close() {
    await new Promise((resolve) => io.close(resolve));
    await Promise.all([...operations]);
    await Promise.allSettled(clients.map(async (client) => {
      if (client.isReady) await client.quit();
      else if (client.isOpen) client.destroy();
    }));
  }

  return { server, io, ready, close };
}

module.exports = { createChatServer };
