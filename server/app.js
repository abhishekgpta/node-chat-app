const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { createClient } = require('redis');
const { createAdapter } = require('@socket.io/redis-adapter');
const { generateMessage, generateLocationMessage } = require('./utils/message');
const { isRealString } = require('./utils/validation');

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
  let initialized = !redisUrl;

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
      initialized = true;
    } catch (error) {
      clients.forEach((client) => { if (client.isOpen) client.destroy(); });
      throw error;
    }
  })();
  ready.catch(() => console.error('Chat initialization failed; check Redis configuration.'));

  app.get('/healthz', (request, response) => {
    response.set('Cache-Control', 'no-store');
    response.status(available() ? 200 : 503).json({ ready: available() });
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
    const sockets = await io.in(room).fetchSockets();
    io.to(room).emit('updateUserList', sockets.map((socket) => socket.data.name));
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
    }

    socket.on('join', (params, callback) => run(async (acknowledge) => {
      if (!params || !isRealString(params.name) || !isRealString(params.room) ||
          params.name.length > 80 || params.room.length > 120) {
        return acknowledge('Name and room name are required.');
      }
      if (!socket.connected) return;
      const previous = { ...socket.data };
      const room = `chat:${params.room.trim()}`;
      if (previous.room) await socket.leave(previous.room);
      socket.data = { name: params.name.trim(), room };
      await socket.join(room);
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

    socket.on('disconnect', () => run(async () => {
      const { room, name } = socket.data;
      if (!room) return;
      await presence(room);
      io.to(room).emit('newMessage', generateMessage('Admin', `${name} has left.`));
    }));
  });

  async function close() {
    await new Promise((resolve) => io.close(resolve));
    clients.forEach((client) => { if (client.isOpen) client.destroy(); });
  }

  return { server, io, ready, close };
}

module.exports = { createChatServer };
