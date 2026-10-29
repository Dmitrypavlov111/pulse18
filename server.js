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

if (BOT_TOKEN) {
  const bot = new Telegraf(BOT_TOKEN);

  bot.start((ctx) => {
    const payload = ctx.payload;
    const targetUrl = payload ? `${WEBAPP_URL}?room=${payload}` : WEBAPP_URL;

    ctx.reply(
      '🔞 *PULSE 18+ | Клуб взрослых игр и знакомств*\n\n🔥 Игры на расстоянии с отдельным чатом раунда\n🛏 Сценарии для спальни, 3D-кубики и аукцион власти\n🥂 Знакомства 18+ по анкетам (М/Ж, возраст)',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('💋 Войти в PULSE 18+', targetUrl)]
        ])
      }
    );
  });

  bot.launch()
    .then(() => console.log('🤖 Telegram-бот запущен'))
    .catch((err) => console.error('Ошибка бота:', err.message));
}

const onlineUsers = new Map();
const rooms = new Map();
const globalHistory = [];

function broadcastLobby() {
  io.emit('lobby_users', Array.from(onlineUsers.values()));
}

io.on('connection', (socket) => {
  // 1. Регистрация анкеты (Ник, Пол М/Ж, Возраст, Вайб)
  socket.on('register_user', (profile) => {
    const cleanAge = Math.max(18, Math.min(99, parseInt(profile.age, 10) || 25));
    onlineUsers.set(socket.id, {
      socketId: socket.id,
      nickname: String(profile.nickname || 'Инкогнито').slice(0, 20),
      gender: profile.gender === 'Ж' ? 'Ж' : 'М',
      age: cleanAge,
      role: profile.role || 'По настроению',
      roomId: profile.roomId || ''
    });
    socket.join('global_channel');
    socket.emit('global_history', globalHistory);
    broadcastLobby();
  });

  // 2. Вход в приватную комнату
  socket.on('join_private_room', ({ roomId, nickname, gender, age, role }) => {
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
    const cleanAge = Math.max(18, Math.min(99, parseInt(age, 10) || 25));
    const cleanGender = gender === 'Ж' ? 'Ж' : 'М';

    if (onlineUsers.has(socket.id)) {
      const u = onlineUsers.get(socket.id);
      u.roomId = roomId;
      if (nickname) u.nickname = String(nickname).slice(0, 20);
      u.gender = cleanGender;
      u.age = cleanAge;
      if (role) u.role = role;
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        players: [],
        whisperMessages: [], // ТОЛЬКО для раздела «Шепот»
        gameMessages: [],    // ТОЛЬКО для чата внутри игры (На дистанции / Раунд)
        gameState: null,
        bids: {},
        swipes: {}
      });
    }

    const room = rooms.get(roomId);
    const existing = room.players.find(p => p.socketId === socket.id);
    if (!existing) {
      room.players.push({
        socketId: socket.id,
        nickname: String(nickname || 'Инкогнито').slice(0, 20),
        gender: cleanGender,
        age: cleanAge,
        role: role || 'Свитч'
      });
    } else {
      existing.nickname = String(nickname || existing.nickname).slice(0, 20);
      existing.gender = cleanGender;
      existing.age = cleanAge;
    }

    // Отправляем раздельные истории чатов!
    socket.emit('whisper_history', room.whisperMessages);
    socket.emit('game_chat_history', room.gameMessages);

    io.to(roomId).emit('room_update', {
      roomId,
      players: room.players,
      gameState: room.gameState
    });
    broadcastLobby();
  });

  // 3. Приглашение из раздела «Знакомство»
  socket.on('invite_from_lobby', ({ targetSocketId, fromNickname, fromGender, fromAge, roomId }) => {
    io.to(targetSocketId).emit('incoming_invite', {
      fromNickname,
      fromGender,
      fromAge,
      roomId
    });
  });

  // 4. ЧАТ №1: Общий чат знакомств
  socket.on('send_global_msg', ({ text, sender, gender, age }) => {
    if (!text) return;
    const msg = {
      sender: String(sender || 'Гость').slice(0, 20),
      gender: gender === 'Ж' ? 'Ж' : 'М',
      age: Math.max(18, parseInt(age, 10) || 25),
      senderSocketId: socket.id,
      text: String(text).slice(0, 400),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    globalHistory.push(msg);
    if (globalHistory.length > 40) globalHistory.shift();
    io.to('global_channel').emit('receive_global_msg', msg);
  });

  // 5. ЧАТ №2: Раздел «Шепот» (приватная переписка вне игр)
  socket.on('send_whisper_msg', ({ roomId, text, sender, gender, age }) => {
    if (!rooms.has(roomId) || !text) return;
    const msg = {
      sender: String(sender || 'Партнер').slice(0, 20),
      gender: gender === 'Ж' ? 'Ж' : 'М',
      age: Math.max(18, parseInt(age, 10) || 25),
      senderSocketId: socket.id,
      text: String(text).slice(0, 400),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const room = rooms.get(roomId);
    room.whisperMessages.push(msg);
    if (room.whisperMessages.length > 60) room.whisperMessages.shift();
    io.to(roomId).emit('receive_whisper_msg', msg);
  });

  // 6. ЧАТ №3: Чат внутри активной игры (На расстоянии / Арена) — НЕ попадает в «Шепот»!
  socket.on('send_game_msg', ({ roomId, text, sender, gender, age }) => {
    if (!rooms.has(roomId) || !text) return;
    const msg = {
      sender: String(sender || 'Партнер').slice(0, 20),
      gender: gender === 'Ж' ? 'Ж' : 'М',
      age: Math.max(18, parseInt(age, 10) || 25),
      senderSocketId: socket.id,
      text: String(text).slice(0, 400),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    const room = rooms.get(roomId);
    room.gameMessages.push(msg);
    if (room.gameMessages.length > 60) room.gameMessages.shift();
    io.to(roomId).emit('receive_game_msg', msg);
  });

  // 7. Синхронизация состояния игры
  socket.on('sync_game_state', ({ roomId, state }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.gameState = state;
    if (state?.resetBids) room.bids = {};
    if (state?.resetSwipes) room.swipes = {};
    if (state?.clearGameChat) {
      room.gameMessages = [];
      io.to(roomId).emit('game_chat_history', []);
    }
    io.to(roomId).emit('game_state_updated', state);
  });

  socket.on('start_sync_timer', ({ roomId, seconds }) => {
    const endTime = Date.now() + Number(seconds) * 1000;
    io.to(roomId).emit('timer_started', { endTime, seconds });
  });

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
