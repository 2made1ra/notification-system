const express = require('express');
const amqp = require('amqplib');
const nodemailer = require('nodemailer');
const { Pool } = require('pg');

//prometheus
const client = require('prom-client');
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

//константы
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@rabbitmq:5672';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://notifications:notifications_password@db:5432/notifications_db';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.example.com';
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER || 'user';
const SMTP_PASS = process.env.SMTP_PASS || 'password';
const PORT = process.env.PORT || 3000;

//повторные попытки при подключении к RabbitMQ
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRabbitMQWithRetry(rabbitUrl, retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(rabbitUrl);
      return await connection.createChannel();
    } catch (err) {
      console.error(`[Email Service] RabbitMQ connect error (attempt ${i+1}/${retries}):`, err.message);
      if (i < retries - 1) {
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

//Настройка Nodemailer
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: false, //если true, то порт обычно 465
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

(async () => {
  try {
    //Подключаемся к БД
    const pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('SELECT 1');
    console.log('[Email Service] Connected to PostgreSQL');

    //Подключаемся к RabbitMQ
    const channel = await connectRabbitMQWithRetry(RABBITMQ_URL, 10, 2000);
    await channel.assertQueue('email_queue');
    console.log('[Email Service] Connected to RabbitMQ');

    //Express-приложение (для /metrics и health-check)
    const app = express();
    app.use(express.json());

    //Health-check
    app.get('/health', async (req, res) => {
      try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
      } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
      }
    });

    //Prometheus metrics
    app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', client.register.contentType);
        res.end(await client.register.metrics());
      } catch (err) {
        res.status(500).end(err.message);
      }
    });

    //Запуск слушателя HTTP
    app.listen(PORT, () => {
      console.log(`[Email Service] is running on port ${PORT}`);
    });

    // Потребляем сообщения из email_queue
    channel.consume('email_queue', async (msg) => {
      if (!msg) return;
      const payload = JSON.parse(msg.content.toString());
      const { recipient, message, meta, notificationId } = payload;

      try {
        //Отправляем E-mail через Nodemailer
        await transporter.sendMail({
          from: 'noreply@example.com',
          to: recipient,
          subject: meta && meta.subject ? meta.subject : 'Notification',
          text: message
        });

        //Обновляем статус в БД
        const updateQuery = `
          UPDATE notifications
             SET status='sent', updated_at=now()
           WHERE (id=$1) OR (recipient=$2 AND message=$3 AND type='email')
        `;
        await pool.query(updateQuery, [notificationId || null, recipient, message]);

        console.log(`[Email Service] Sent email to: ${recipient}`);
        channel.ack(msg);
      } catch (error) {
        console.error('[Email Service] Failed to send email:', error);
        channel.nack(msg, false, true);
      }
    });

  } catch (err) {
    console.error('[Email Service] Initialization error:', err);
    process.exit(1);
  }
})();
