const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io;
const onlineUsers = new Map();

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: (process.env.CLIENT_URL || "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:3003").split(",").map((o) => o.trim()),
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.disconnect();
      return;
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = (decoded.id || decoded._id).toString();
      socket.userId = userId;
      onlineUsers.set(userId, socket.id);
      socket.join(`user:${userId}`);
      console.log(`[Socket] User connected: ${userId}`);
    } catch {
      socket.disconnect();
      return;
    }

    socket.on("disconnect", () => {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        console.log(`[Socket] User disconnected: ${socket.userId}`);
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitToUser(userId, event, data) {
  if (!io || !userId) return;
  const uid = userId.toString();
  io.to(`user:${uid}`).emit(event, data);
  const socketId = onlineUsers.get(uid);
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}

module.exports = { initSocket, getIO, emitToUser };
