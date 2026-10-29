import 'dotenv/config';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.BOT_TOKEN;
if (!token || token.includes('СЮДА_ВСТАВЬ')) {
  console.error('❌ ОШИБКА: Укажите реальный BOT_TOKEN в файле .env');
  process.exit(1);
}

const bot = new Telegraf(token);
const app = express();
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

app.use(express.json());
// Раздаем статику из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Каталог платных экстрим-паков в Telegram Stars (XTR)
const PRODUCT_CATALOG = {
  'pack-bdsm': {
    title: 'BDSM & Shibari Extreme 18+',
    description: '25 экстремальных заданий на связывание и подчинение',
    stars: 70
  },
  'pack-talk': {
    title: 'Грязный шепот (Dirty Talk)',
    description: 'Колода интимных команд и фраз на ухо',
    stars: 50
  },
  'pack-role': {
    title: 'Ролевые сценарии с диалогами',
    description: 'Готовые сцены с репликами для двоих',
    stars: 80
  },
  'feat-invis': {
    title: 'Режим «Невидимка»',
    description: 'Скрытие города и статуса в знакомствах',
    stars: 90
  },
  'feat-duo': {
    title: 'Pulse Duo Pass',
    description: 'Синхронизация двух смартфонов в единую комнату',
    stars: 120
  }
};

// Команда /start в Telegram боте
bot.command('start', async (ctx) => {
  const name = ctx.from.first_name || 'Друг';
  await ctx.reply(
    `🔥 Привет, ${name}!\n\nДобро пожаловать в **Pulse 18+** — каталог горячих игр, парных сценариев и анонимных знакомств.\n\nНажми кнопку ниже для входа:`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('🔥 Открыть Pulse 18+', WEBAPP_URL)]
    ])
  );
});

// API для создания инвойса оплаты через Telegram Stars
app.post('/api/create-stars-invoice', async (req, res) => {
  try {
    const { userId, packId } = req.body;
    const item = PRODUCT_CATALOG[packId];

    if (!item) {
      return res.status(400).json({ success: false, error: 'Товар не найден' });
    }

    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: item.title,
      description: item.description,
      payload: JSON.stringify({ userId: userId || 'anonymous', packId, time: Date.now() }),
      provider_token: '', // Для Stars всегда пустая строка!
      currency: 'XTR',    // Валюта Telegram Stars
      prices: [{ label: item.title, amount: item.stars }]
    });

    res.json({ success: true, invoiceLink });
  } catch (error) {
    console.error('Ошибка генерации счета:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Подтверждение платежа
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// Успешная оплата
bot.on('successful_payment', async (ctx) => {
  const payment = ctx.message.successful_payment;
  const payload = JSON.parse(payment.invoice_payload);
  console.log(`[УСПЕХ] Пользователь ${payload.userId} купил ${payload.packId} за ${payment.total_amount} XTR`);
  await ctx.reply(`🔥 Оплата прошла успешно! Разблокирован пак: ${payload.packId}`);
});

// Запуск
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту http://localhost:${PORT}`);
});

bot.launch().then(() => {
  console.log('🤖 Telegram Бот Pulse 18+ успешно запущен!');
}).catch(err => {
  console.error('Ошибка запуска бота:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));