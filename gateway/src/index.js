const express = require('express');
const amqp = require('amqplib');
const { Pool } = require('pg');
const client = require('prom-client');

const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://user:password@rabbitmq:5672';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://notifications:notifications_password@db:5432/notifications_db';
const PORT = process.env.PORT || 3000;

let channel;
let pool;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRabbitMQWithRetry(rabbitUrl, retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(rabbitUrl);
      return await connection.createChannel();
    } catch (err) {
      console.error(`[Gateway] RabbitMQ connect error (attempt ${i + 1}/${retries}):`, err.message);
      if (i < retries - 1) {
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

function setChannel(mockChannel) {
  channel = mockChannel;
}

function setPool(mockPool) {
  pool = mockPool;
}

const app = express();
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    if (!channel) throw new Error('No RabbitMQ channel');
    res.json({ status: 'ok' });
  } catch (error) {
    console.error('[Gateway] /health error:', error);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

app.post('/send', async (req, res) => {
  try {
    const { type, recipient, message, meta } = req.body;
    if (!type || !recipient || !message) {
      return res.status(400).json({ error: 'Missing required fields: type, recipient, message' });
    }

    let queueName;
    switch (type) {
      case 'email':
        queueName = 'email_queue';
        break;
      case 'sms':
        queueName = 'sms_queue';
        break;
      default:
        return res.status(400).json({ error: 'Unsupported notification type' });
    }

    const insertQuery = `
      INSERT INTO notifications (type, recipient, message, status, meta)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const insertValues = [type, recipient, message, 'pending', meta || null];
    const dbResult = await pool.query(insertQuery, insertValues);
    const notificationId = dbResult.rows[0].id;

    channel.sendToQueue(queueName, Buffer.from(JSON.stringify({ recipient, message, meta, notificationId })));

    res.json({ status: 'Notification queued', notificationId });
  } catch (error) {
    console.error('[Gateway] /send error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

if (require.main === module) {
  (async () => {
    try {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query('SELECT 1');
      console.log('[Gateway] Connected to PostgreSQL');

      channel = await connectRabbitMQWithRetry(RABBITMQ_URL, 10, 2000);
      await channel.assertQueue('email_queue');
      await channel.assertQueue('sms_queue');
      console.log('[Gateway] Successfully connected to RabbitMQ');

      app.listen(PORT, () => {
        console.log(`[Gateway] is running on port ${PORT}`);
      });
    } catch (err) {
      console.error('[Gateway] Initialization error:', err);
      process.exit(1);
    }
  })();
}

module.exports = { app, setChannel, setPool };
