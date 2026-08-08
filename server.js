const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const dotenv = require('dotenv');
dotenv.config();

// Fail fast if critical env vars are missing
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET', 'PORT'];
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const app = require('./app');
const { initSocket } = require('./sockets/socketHandler');

// Handle uncaught exceptions (synchronous errors outside Express)
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message, err.stack);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: process.env.SOCKET_CORS_ORIGIN || process.env.CLIENT_URL,
      credentials: true
    }
  });

  initSocket(io);

  // Make io accessible in Express controllers via req.app.get('io') if needed
  app.set('io', io);

  server.listen(PORT, () => {
    console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`📡 Socket.io ready for real-time connections`);
  });

  // Handle unhandled promise rejections (e.g., failed async DB ops)
  process.on('unhandledRejection', (err) => {
    console.error('❌ UNHANDLED REJECTION! Shutting down...');
    console.error(err.name, err.message);
    server.close(() => process.exit(1));
  });
};

startServer();