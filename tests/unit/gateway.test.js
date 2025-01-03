const request = require('supertest');
const { app, setChannel, setPool } = require('../../gateway/src/index');

jest.mock('pg');
jest.mock('amqplib');

describe('Gateway Unit Tests', () => {
  let mockPool, mockChannel;

  beforeEach(() => {
    mockPool = {
      query: jest.fn(),
    };
    require('pg').Pool.mockImplementation(() => mockPool);

    mockChannel = {
      assertQueue: jest.fn(),
      sendToQueue: jest.fn(),
    };
    setChannel(mockChannel);
    setPool(mockPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if required fields are missing', async () => {
    const res = await request(app).post('/send').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  it('should return 400 for unsupported notification type', async () => {
    const res = await request(app).post('/send').send({
      type: 'unsupported',
      recipient: 'test@example.com',
      message: 'Hello',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported notification type/);
  });

  it('should return 200 and queue notification for valid input', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 1 }],
    });
  
    const res = await request(app).post('/send').send({
      type: 'email',
      recipient: 'test@example.com',
      message: 'Hello, Gateway!',
    });
  
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Notification queued');
    expect(res.body).toHaveProperty('notificationId');
    expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), expect.any(Array));
    expect(mockChannel.sendToQueue).toHaveBeenCalledWith('email_queue', expect.any(Buffer));
  });

  it('should return 500 if database query fails', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB Error'));

    const res = await request(app).post('/send').send({
      type: 'email',
      recipient: 'test@example.com',
      message: 'Hello, Gateway!',
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Internal server error/);
  });
});
