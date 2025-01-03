import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '15s', // Сокращённое время выполнения теста
};

export default function () {
  const url = 'http://gateway:3000/send';
  const payload = JSON.stringify({
    type: 'sms', // Тип уведомления
    recipient: '+79193787992', // Тестовый номер телефона
    message: 'This is a test SMS message', // Тестовое сообщение
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Отправка POST-запроса
  http.post(url, payload, params);

  sleep(3);
}