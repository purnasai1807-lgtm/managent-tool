require('dotenv').config();
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT || 3003);
const { server } = createApp();

server.listen(PORT, () => {
  console.log(`TaskFlow Project Management server running at http://localhost:${PORT}`);
});
