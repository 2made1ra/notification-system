
# **Notification System**


## **Описание**
Notification System — это распределённый сервис для отправки уведомлений через различные каналы связи, такие как Email и SMS. 

### **Ключевые особенности**
- Централизованный **Gateway**, управляющий маршрутизацией запросов и взаимодействием с внутренними микросервисами.
- Отправка Email с использованием MailHog в качестве SMTP.
- Отправка SMS через Twilio (в тестовом режиме).
- Мониторинг и метрики с использованием Prometheus и Grafana.

---

## **Архитектура**
Система состоит из следующих компонентов:

### **1. Gateway**
Gateway является центральным маршрутизатором:
- Принимает входящие запросы от клиентов.
- Валидирует данные и определяет тип уведомления.
- Сохраняет записи в базу данных PostgreSQL.
- Отправляет задачи в соответствующие очереди RabbitMQ (`email_queue`, `sms_queue`).

### **2. Email Service**
Микросервис для обработки задач из очереди `email_queue`:
- Отправляет Email через SMTP-сервер.
- Использует MailHog для тестирования.
- Обновляет статус уведомлений в базе данных.

### **3. SMS Service**
Микросервис для обработки задач из очереди `sms_queue`:
- Отправляет SMS через Twilio API.
- Работает в тестовом режиме.

---

## **Основные технологии**

### **1. RabbitMQ**
Используется для управления очередями задач:
- `email_queue` — для отправки Email.
- `sms_queue` — для отправки SMS.

### **2. PostgreSQL**
База данных для хранения записей об уведомлениях:
- Тип уведомления.
- Получатель.
- Сообщение.
- Текущий статус (например, `pending`, `sent`).

### **3. Prometheus и Grafana**
Для мониторинга и визуализации:
- **Prometheus** собирает метрики из Gateway (например, количество запросов, ошибки).
- **Grafana** предоставляет удобный интерфейс для анализа данных.

---

## **Тестирование**

Во время разработки использовался Postman для отправки RestApi запросов.

### **1. Unit тесты**
- Разработаны тесты для проверки отдельных компонентов (например, Gateway).
- Используются **Jest** и **Supertest** для валидации API и логики.
- К сожалению, unit test для главного шлюза не корректно работает до момента инициализации всего образа. Так и не смог решить проблему.

### **2. Стресс тесты**
- Имитация высокой нагрузки на Email и SMS сервисы с использованием **k6**.
- Тесты проверяют устойчивость системы и производительность при увеличении числа запросов.

#### **Команды для запуска стресс тестов**
После развертывания проекта, выполните:
- **Email стресс тест**:
  ```bash
  docker-compose --profile stress-test-email up stress-test-email
  ```
- **SMS стресс тест**:
  ```bash
  docker-compose --profile stress-test-sms up stress-test-sms
  ```

---

## **Как развернуть проект**
1. Клонируйте репозиторий:
   ```bash
   git clone <repository_url>
   cd notification-system
   ```

2. Запустите проект с помощью Docker Compose:
   ```bash
   docker-compose up --build
   ```

3. Для запуска unit тестов:
   ```bash
   docker-compose --profile gateway-test up gateway-tests
   ```

4. Для запуска стресс тестов:
   - Email:
     ```bash
     docker-compose --profile stress-test-email up stress-test-email
     ```
   - SMS:
     ```bash
     docker-compose --profile stress-test-sms up stress-test-sms
     ```

---

## **Мониторинг**
1. **Prometheus** доступен по адресу:
   ```
   http://localhost:9090
   ```

2. **Grafana** доступна по адресу:
   ```
   http://localhost:3000
   ```
   Используйте логин `admin` и пароль `admin` для входа.

3. **PostgreSQL** доступна по адресу:
   ```
   http://localhost:8080
   ```
   Используйте логин `admin@admin.com` и пароль `admin` для входа.

4. **RabbitMQ** доступна по адресу:
   ```
   http://localhost:15672
   ```
   Используйте логин `guest` и пароль `guest` для входа.

---

## **Контакт**
**Жунёв Андрей** **РИ-410933**


