const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const client = require('prom-client');
const twilio = require('twilio');

// -------- Retry-функции для подключения к RabbitMQ --------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRabbitMQ(rabbitUrl, retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(rabbitUrl);
      return await connection.createChannel();
    } catch (err) {
      console.error(`[SMS Service] RabbitMQ connect error (attempt ${i + 1}/${retries}):`, err.message);
      if (i < retries - 1) {
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

// -------- Константы окружения --------
const RABBITMQ_URL       = process.env.RABBITMQ_URL       || 'amqp://user:password@rabbitmq:5672';
const DATABASE_URL        = process.env.DATABASE_URL       || 'postgres://notifications:password@db:5432/notifications_db';
const PORT                = process.env.PORT               || 3000;
const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID || 'your_twilio_account_sid';
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN  || 'your_twilio_auth_token';
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || 'your_twilio_phone_number';
const MAX_RETRY_COUNT     = process.env.MAX_RETRY_COUNT    || 10;

// Создаём Twilio-клиент
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// -------- Функция отправки SMS через Twilio --------
async function sendSms(recipient, text) {
  console.log(`[SMS Service] Attempting to send SMS to ${recipient}: ${text}`);
  try {
    const response = await twilioClient.messages.create({
      body: text,
      from: TWILIO_PHONE_NUMBER,
      to: recipient,
    });
    console.log(`[SMS Service] SMS sent successfully. SID: ${response.sid}`);
    return true;
  } catch (err) {
    console.error('[SMS Service] Twilio send error:', err.message);
    throw err;
  }
}

// -------- Prometheus метрики --------
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

const app = express();
app.use(express.json());

(async () => {
  try {
    // подключаемся к БД
    const pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('SELECT 1'); // простая проверка
    console.log('[SMS Service] Connected to PostgreSQL');

    // подключаемся к RabbitMQ (с ретраями)
    const channel = await connectRabbitMQ(RABBITMQ_URL, 10, 2000);
    await channel.assertQueue('sms_queue');
    console.log('[SMS Service] Connected to RabbitMQ');

    //запускаем HTTP-сервер (для health-check и /metrics)
    app.get('/health', async (req, res) => {
      try {
        // Проверяем БД
        await pool.query('SELECT 1');
        if (!channel) throw new Error('No RabbitMQ channel available');
        res.json({ status: 'ok' });
      } catch (error) {
        console.error('[SMS Service] Health-check error:', error);
        res.status(500).json({ status: 'error', error: error.message });
      }
    });

    // /metrics для Prometheus
    app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
      } catch (err) {
        res.status(500).end(err.message);
      }
    });

    //запускаем
    app.listen(PORT, () => {
      console.log(`[SMS Service] Running on port ${PORT}`);
    });


    channel.consume('sms_queue', async (msg) => {
      if (!msg) return;

      //берем данные
      const parsedMessage = JSON.parse(msg.content.toString());
      const { recipient, message, retryCount = 0 } = parsedMessage;

      try {
        //оправляем SMS через Twilio
        await sendSms(recipient, message);

        //если успех, обновляем статус в БД
        await pool.query(`
          UPDATE notifications
             SET status = 'sent', updated_at = now()
           WHERE recipient = $1 AND message = $2 AND type = 'sms'`,
          [recipient, message]
        );

        console.log(`[SMS Service] [OK] SMS to: ${recipient}`);
        channel.ack(msg); //удаляем сообщение из очереди
      } catch (err) {
        //ошибки
        console.error(`[SMS Service] [Error] SMS to ${recipient}:`, err.message);

        if (retryCount >= MAX_RETRY_COUNT) {
          //превысили лимит повторов — отмечаем как failed
          console.error(`[SMS Service] Reached max retries (${retryCount}). Marking as failed: ${recipient}`);

          await pool.query(`
            UPDATE notifications
               SET status = 'failed', updated_at = now()
             WHERE recipient = $1 AND message = $2 AND type = 'sms'`,
            [recipient, message]
          );

          channel.ack(msg);
        } else {
          //увеличиваем счётчик повторов и заново публикуем в очередь
          const updatedMessage = JSON.stringify({
            recipient,
            message,
            retryCount: retryCount + 1
          });
          console.log(`[SMS Service] Retrying (${retryCount + 1}/${MAX_RETRY_COUNT}) for recipient: ${recipient}`);

          //перекидываем сообщение обратно в очередь
          channel.sendToQueue('sms_queue', Buffer.from(updatedMessage), { persistent: true });
          channel.ack(msg);
        }
      }
    });

  } catch (err) {
    console.error('[SMS Service] Initialization error:', err);
    process.exit(1);
  }
})();

