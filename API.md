# API Documentation

## Endpoints

### GET /api/search
Поиск торрентов по названию

**Параметры:**
- `query` (string) - название фильма/сериала для поиска

**Пример:**
```bash
curl "http://localhost:3000/api/search?query=интерстеллар"
```

**Ответ:**
```json
[
  {
    "id": "torrent_0",
    "title": "Интерстеллар (2014) BDRip 1080p",
    "magnetLink": "magnet:?xt=urn:btih:...",
    "size": "2.1 GB",
    "seeds": 15,
    "date": "2023-01-15",
    "quality": "1080p",
    "source": "jacred.xyz"
  }
]
```

### POST /api/play
Добавление торрента в torrServer и получение ссылки для воспроизведения

**Тело запроса:**
```json
{
  "magnetLink": "magnet:?xt=urn:btih:...",
  "title": "Название фильма"
}
```

**Пример:**
```bash
curl -X POST "http://localhost:3000/api/play" \
  -H "Content-Type: application/json" \
  -d '{"magnetLink": "magnet:?xt=urn:btih:...", "title": "Интерстеллар"}'
```

**Ответ:**
```json
{
  "streamUrl": "http://localhost:8090/stream/abc123def456"
}
```

### GET /api/torrents
Получение списка активных торрентов в torrServer

**Пример:**
```bash
curl "http://localhost:3000/api/torrents"
```

### DELETE /api/torrents/:id
Удаление торрента из torrServer

**Пример:**
```bash
curl -X DELETE "http://localhost:3000/api/torrents/abc123def456"
```

### GET /api/status
Проверка статуса torrServer

**Пример:**
```bash
curl "http://localhost:3000/api/status"
```

**Ответ:**
```json
{
  "status": "online",
  "version": "2.1.0",
  "uptime": "2 days"
}
```

## Настройка torrServer

1. Скачайте torrServer с [официального репозитория](https://github.com/YouROK/TorrServer)
2. Запустите сервер:
   ```bash
   ./TorrServer
   ```
3. По умолчанию сервер будет доступен на `http://localhost:8090`
4. Укажите URL в файле `.env`:
   ```
   TORRSERVER_URL=http://localhost:8090
   ```

## Примеры использования

### Поиск и воспроизведение через curl

```bash
# 1. Поиск торрентов
SEARCH_RESULT=$(curl -s "http://localhost:3000/api/search?query=интерстеллар")
echo $SEARCH_RESULT

# 2. Извлечение magnet ссылки (требует jq)
MAGNET_LINK=$(echo $SEARCH_RESULT | jq -r '.[0].magnetLink')
TITLE=$(echo $SEARCH_RESULT | jq -r '.[0].title')

# 3. Запуск воспроизведения
STREAM_URL=$(curl -s -X POST "http://localhost:3000/api/play" \
  -H "Content-Type: application/json" \
  -d "{\"magnetLink\": \"$MAGNET_LINK\", \"title\": \"$TITLE\"}" | \
  jq -r '.streamUrl')

echo "Stream URL: $STREAM_URL"
```

### Интеграция с другими приложениями

Вы можете интегрировать этот API с любыми приложениями, которые поддерживают HTTP запросы:

- **Kodi** - через HTTP API
- **Plex** - через webhooks
- **Jellyfin** - через плагины
- **Собственные приложения** - через fetch/axios
