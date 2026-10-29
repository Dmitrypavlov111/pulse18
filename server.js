import 'dotenv/config';
import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ ОШИБКА: BOT_TOKEN не задан в переменных окружения (.env или Render)');
  process.exit(1);
}

const bot = new Telegraf(token);
const app = express();
const PORT = process.env.PORT || 3000;
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;

app.use(express.json());

// Раздача статических файлов из папки public (index.html, manifest.json, sw.js)
app.use(express.static(path.join(__dirname, 'public')));

// Явный маршрут на корень, чтобы исключить ошибку "Not Found" при открытии Mini App
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Служебный маршрут для проверки здоровья сервиса (Health Check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Pulse 18+ Engine' });
});

// Каталог VIP-паков (цены строго в Telegram Stars / XTR)
const PRODUCT_CATALOG = {
  'pack-bdsm': {
    title: 'BDSM & Shibari Extreme 18+',
    description: '25 жестких заданий на связывание и доминирование',
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
  const name = ctx.from?.first_name || 'Соблазнитель';
  await ctx.reply(
    `🔥 Привет, ${name}!\n\nДобро пожаловать в **Pulse 18+** — мир откровенных игр, смелых сценариев и страсти.\n\nНажми кнопку ниже, чтобы запустить приложение:`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('🔥 Открыть Pulse 18+', WEBAPP_URL)]
    ])
  );
});

// API для генерации инвойса Telegram Stars (валюта XTR)
app.post('/api/create-stars-invoice', async (req, res) => {
  try {
    const { userId, packId } = req.body;
    const item = PRODUCT_CATALOG[packId];

    if (!item) {
      return res.status(400).json({ success: false, error: 'Товар не найден в каталоге' });
    }

    // Для Stars provider_token всегда пустая строка, валюта XTR
    const invoiceLink = await bot.telegram.createInvoiceLink({
      title: item.title,
      description: item.description,
      payload: JSON.stringify({
        userId: userId || 'anonymous',
        packId: packId,
        createdAt: Date.now()
      }),
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: item.title, amount: item.stars }]
    });

    res.json({ success: true, invoiceLink });
  } catch (error) {
    console.error('Ошибка при создании инвойса Telegram Stars:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Обязательное подтверждение pre-checkout query в течение 10 секунд
bot.on('pre_checkout_query', async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error('Ошибка в pre_checkout_query:', err);
    await ctx.answerPreCheckoutQuery(false, 'Ошибка обработки платежа Stars');
  }
});

// Обработка успешного списания Telegram Stars
bot.on('successful_payment', async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;
    const payload = JSON.parse(payment.invoice_payload);

    console.log(`[STARS ОПЛАТА] Пользователь: ${payload.userId}, Пак: ${payload.packId}, Сумма: ${payment.total_amount} XTR`);

    await ctx.reply(
      `✅ **Оплата принята!**\n\nРазблокирован экстрим-пак: **${PRODUCT_CATALOG[payload.packId]?.title || payload.packId}**.\nВозвращайся в приложение — доступ открыт 🔥`
    );
  } catch (err) {
    console.error('Ошибка при обработке successful_payment:', err);
  }
});

// Запуск HTTP-сервера Express
app.listen(PORT, () => {
  console.log(`🚀 [Pulse 18+] Сервер запущен на порту ${PORT}`);
  console.log(`🌐 [Pulse 18+] WebApp URL: ${WEBAPP_URL}`);
});

// Запуск Telegram бота
bot.launch().then(() => {
  console.log('🤖 [Pulse 18+] Telegram бот успешно запущен и слушает команды!');
}).catch((err) => {
  console.error('❌ Ошибка запуска Telegraf бота:', err);
});

// Корректная остановка при перезапуске контейнера
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));