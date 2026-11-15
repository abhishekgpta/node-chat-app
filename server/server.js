const { createChatServer } = require('./app');

const chat = createChatServer();

chat.ready.then(() => {
  chat.server.listen(process.env.PORT || 3000, () => {
    console.log(`Server is up on port ${process.env.PORT || 3000}`);
  });
}).catch(async () => {
  await chat.close();
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await chat.close();
    process.exitCode = 0;
  });
}
