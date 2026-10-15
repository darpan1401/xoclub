import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';

const port = Number(process.env.PORT || 3000);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const httpServer = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('XO Club game server is running.');
});

const allowedOrigins = process.env.WEB_ORIGIN
  ? process.env.WEB_ORIGIN.split(',').map((origin) => origin.trim())
  : '*';
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  pingInterval: 20000,
  pingTimeout: 30000,
});

const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function makeCode() {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function publicRoom(code, room) {
  return {
    code,
    status: room.status,
    players: {
      X: { name: room.names.X || 'Player X', connected: Boolean(room.sockets.X) },
      O: { name: room.names.O || 'Waiting for player…', connected: Boolean(room.sockets.O) },
    },
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    winningCells: room.winningCells,
    scores: room.scores,
    round: room.round,
  };
}

function publish(code, room) {
  io.to(code).emit('room-updated', publicRoom(code, room));
}

function ack(callback, result) {
  if (typeof callback === 'function') callback(result);
}

function cleanName(value) {
  const name = typeof value === 'string' ? value.trim().slice(0, 18) : '';
  return name || 'Player';
}

function leaveCurrent(socket) {
  const code = socket.data.roomCode;
  const role = socket.data.role;
  if (!code || !role) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.role = null;
  if (!room || room.sockets[role] !== socket.id) return;

  room.sockets[role] = null;
  if (!room.sockets.X && !room.sockets.O) {
    rooms.delete(code);
    io.to(code).emit('room-closed');
    return;
  }
  room.status = 'waiting';
  publish(code, room);
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.role = null;

  socket.on('create-room', (payload = {}, callback) => {
    leaveCurrent(socket);
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = {
      sockets: { X: socket.id, O: null },
      names: { X: cleanName(payload.name), O: 'Waiting for player…' },
      board: Array(9).fill(null),
      turn: 'X',
      winner: null,
      winningCells: [],
      scores: { X: 0, O: 0, draws: 0 },
      round: 1,
      status: 'waiting',
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = 'X';
    const state = publicRoom(code, room);
    ack(callback, { ok: true, code, role: 'X', room: state });
    publish(code, room);
  });

  socket.on('join-room', (payload = {}, callback) => {
    const code = typeof payload.code === 'string' ? payload.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
    const room = rooms.get(code);
    if (!room) return ack(callback, { ok: false, error: 'Room not found. Check the code or ask your friend to create a new room.' });

    const preferred = payload.preferredRole === 'X' || payload.preferredRole === 'O' ? payload.preferredRole : null;
    const available = (role) => !room.sockets[role] || room.sockets[role] === socket.id;
    let role = preferred && available(preferred) ? preferred : null;
    if (!role && available('X')) role = 'X';
    if (!role && available('O')) role = 'O';
    if (!role) return ack(callback, { ok: false, error: 'This room already has two players.' });

    leaveCurrent(socket);
    room.sockets[role] = socket.id;
    room.names[role] = cleanName(payload.name);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.role = role;
    room.status = room.sockets.X && room.sockets.O ? (room.winner ? 'finished' : 'playing') : 'waiting';
    const state = publicRoom(code, room);
    ack(callback, { ok: true, code, role, room: state });
    publish(code, room);
  });

  socket.on('play-move', (payload = {}, callback) => {
    const code = socket.data.roomCode;
    const role = socket.data.role;
    const room = rooms.get(code);
    const index = Number(payload.index);
    if (!room || !role || room.status !== 'playing') return ack(callback, { ok: false, error: 'The game is waiting for both players.' });
    if (room.sockets[role] !== socket.id) return ack(callback, { ok: false, error: 'You are no longer in this room.' });
    if (role !== room.turn) return ack(callback, { ok: false, error: 'Wait for your turn.' });
    if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index]) return ack(callback, { ok: false, error: 'That square is not available.' });

    room.board[index] = role;
    const line = winningLines.find((cells) => cells.every((cell) => room.board[cell] === role));
    if (line) {
      room.winner = role;
      room.winningCells = line;
      room.scores[role] += 1;
      room.status = 'finished';
    } else if (room.board.every(Boolean)) {
      room.winner = 'draw';
      room.winningCells = [];
      room.scores.draws += 1;
      room.status = 'finished';
    } else {
      room.turn = role === 'X' ? 'O' : 'X';
    }
    ack(callback, { ok: true });
    publish(code, room);
  });

  socket.on('new-round', (_payload, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const role = socket.data.role;
    if (!room || !role || room.sockets[role] !== socket.id || room.status !== 'finished') {
      return ack(callback, { ok: false, error: 'Finish the current round before starting another.' });
    }
    room.board = Array(9).fill(null);
    room.turn = 'X';
    room.winner = null;
    room.winningCells = [];
    room.round += 1;
    room.status = room.sockets.X && room.sockets.O ? 'playing' : 'waiting';
    ack(callback, { ok: true });
    publish(socket.data.roomCode, room);
  });

  socket.on('reset-match', (_payload, callback) => {
    const code = socket.data.roomCode;
    const role = socket.data.role;
    const room = rooms.get(code);
    if (!room || !role || room.sockets[role] !== socket.id) return ack(callback, { ok: false, error: 'You are no longer in this room.' });
    room.board = Array(9).fill(null);
    room.turn = 'X';
    room.winner = null;
    room.winningCells = [];
    room.scores = { X: 0, O: 0, draws: 0 };
    room.round = 1;
    room.status = room.sockets.X && room.sockets.O ? 'playing' : 'waiting';
    ack(callback, { ok: true });
    publish(code, room);
  });

  socket.on('leave-room', () => leaveCurrent(socket));
  socket.on('disconnect', () => leaveCurrent(socket));
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`XO Club server listening on http://localhost:${port}`);
});
