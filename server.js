import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { Telegraf, Markup } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Telegram-бот (только вход и инвайты, платежные шлюзы отключены для теста)
if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    const payload = ctx.payload;
    const targetUrl = payload ? `${WEBAPP_URL}?room=${payload}` : WEBAPP_URL;

    ctx.reply(
      '🔞 *PULSE 18+ | Игры желаний и знакомств*\n\n🔥 На расстоянии — управляй партнером через экран\n🛏 В спальне — 3D-кубики ласк, Edging и аукцион власти\n🥂 Знакомство — дерзкий флирт и радар анкет онлайн',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('💋 Открыть PULSE 18+', targetUrl)]
        ])
      }
    );
  });

  bot.launch()
    .then(() => console.log('🤖 Telegram-бот запущен'))
    .catch((err) => console.error('Ошибка бота:', err.message));
}

// Хранилище онлайна и комнат
const onlineUsers = new Map();
const rooms = new Map();
const globalHistory = [];

function broadcastLobby() {
  const list = Array.from(onlineUsers.values());
  io.emit('lobby_users', list);
}

io.on('connection', (socket) => {
  // Регистрация анкеты пользователя
  socket.on('register_user', (profile) => {
    onlineUsers.set(socket.id, {
      socketId: socket.id,
      nickname: profile.nickname || 'Незнакомец',
      gender: profile.gender || '🔥',
      role: profile.role || 'Экспериментатор',
      vibe: profile.vibe || 'Горячо',
      roomId: profile.roomId || ''
    });
    socket.join('global_channel');
    socket.emit('global_history', globalHistory);
    broadcastLobby();
  });

  // Подключение к приватной комнате для двоих
  socket.on('join_private_room', ({ roomId, nickname, gender, role }) => {
    for (const r of socket.rooms) {
      if (r !== socket.id && r !== 'global_channel') {
        socket.leave(r);
        if (rooms.has(r)) {
          const oldRoom = rooms.get(r);
          oldRoom.players = oldRoom.players.filter(p => p.socketId !== socket.id);
          io.to(r).emit('room_update', { roomId: r, players: oldRoom.players, gameState: oldRoom.gameState });
        }
      }
    }

    socket.join(roomId);

    if (onlineUsers.has(socket.id)) {
      const u = onlineUsers.get(socket.id);
      u.roomId = roomId;
      if (nickname) u.nickname = nickname;
      if (gender) u.gender = gender;
      if (role) u.role = role;
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        players: [],
        messages: [],
        gameState: null,
        bids: {},
        swipes: {}
      });
    }

    const room = rooms.get(roomId);
    if (!room.players.find(p => p.socketId === socket.id)) {
      room.players.push({
        socketId: socket.id,
        nickname: nickname || 'Гость',
        gender: gender || '🔥',
        role: role || 'Свитч'
      });
    }

    socket.emit('private_history', room.messages);
    io.to(roomId).emit('room_update', {
      roomId,
      players: room.players,
      gameState: room.gameState
    });
    broadcastLobby();
  });

  // Вызов на игру из раздела «Знакомство» / «Общий чат»
  socket.on('invite_from_lobby', ({ targetSocketId, fromNickname, fromGender, fromRole, roomId }) => {
    io.to(targetSocketId).emit('incoming_invite', {
      fromNickname,
      fromGender,
      fromRole,
      roomId
    });
  });

  // Общий чат
  socket.on('send_global_msg', ({ text, sender, gender, role }) => {
    const msg = {
      sender,
      gender: gender || '🔥',
      role: role || '',
      senderSocketId: socket.id,
      text: String(text).slice(0, 400),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    globalHistory.push(msg);
    if (globalHistory.length > 35) globalHistory.shift();
    io.to('global_channel').emit('receive_global_msg', msg);
  });

  // Приватный чат комнаты
  socket.on('send_private_msg', ({ roomId, text, sender }) => {
    if (!rooms.has(roomId)) return;
    const msg = {
      sender,
      senderSocketId: socket.id,
      text: String(text).slice(0, 400),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const room = rooms.get(roomId);
    room.messages.push(msg);
    if (room.messages.length > 50) room.messages.shift();
    io.to(roomId).emit('receive_private_msg', msg);
  });

  // Синхронизация любого игрового режима между двумя телефонами
  socket.on('sync_game_state', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.gameState = state;
    if (state?.resetBids) room.bids = {};
    if (state?.resetSwipes) room.swipes = {};
    io.to(roomId).emit('game_state_updated', state);
  });

  // Общий синхронный таймер
  socket.on('start_sync_timer', ({ roomId, seconds }) => {
    const endTime = Date.now() + Number(seconds) * 1000;
    io.to(roomId).emit('timer_started', { endTime, seconds });
  });

  // Слепой аукцион власти
  socket.on('submit_bid', ({ roomId, nickname, amount, lotTitle }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.bids[socket.id] = { nickname, amount: Number(amount) };

    const entries = Object.values(room.bids);
    if (room.players.length <= 1 || entries.length >= 2) {
      let winner = entries[0];
      let tie = false;
      if (entries.length >= 2) {
        if (entries[0].amount === entries[1].amount) tie = true;
        else if (entries[1].amount > entries[0].amount) winner = entries[1];
      }
      io.to(roomId).emit('auction_resolved', { tie, winner, lotTitle });
      room.bids = {};
    } else {
      io.to(roomId).emit('bid_waiting', { whoBid: nickname });
    }
  });

  // Детектор совпадения желаний (Свайпы)
  socket.on('submit_swipe', ({ roomId, cardIndex, cardTitle, cardDesc, choice }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (!room.swipes[cardIndex]) room.swipes[cardIndex] = {};
    room.swipes[cardIndex][socket.id] = choice;

    const answers = Object.values(room.swipes[cardIndex]);
    if (room.players.length >= 2 && answers.length >= 2) {
      const bothYes = answers.every(a => a === 'yes');
      io.to(roomId).emit('swipe_round_complete', { bothYes, cardTitle, cardDesc, solo: false });
    } else if (room.players.length <= 1) {
      io.to(roomId).emit('swipe_round_complete', { bothYes: choice === 'yes', cardTitle, cardDesc, solo: true });
    } else {
      socket.emit('swipe_waiting_partner');
    }
  });

  socket.on('close_sync_game', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room) room.gameState = null;
    io.to(roomId).emit('game_closed');
  });

  socket.on('disconnecting', () => {
    onlineUsers.delete(socket.id);
    for (const roomId of socket.rooms) {
      if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        room.players = room.players.filter(p => p.socketId !== socket.id);
        io.to(roomId).emit('room_update', { roomId, players: room.players, gameState: room.gameState });
      }
    }
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Сервер PULSE 18+ запущен на порту ${PORT}`);
});