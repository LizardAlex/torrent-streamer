const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const torrentParser = require('./src/torrentParser');
const torrServerClient = require('./src/torrServerClient');

const app = express();
const PORT = process.env.PORT || 444;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "http://217.144.98.80:8090", "blob:"], // Разрешаем загрузку медиа с torrServer
      connectSrc: ["'self'", "http://217.144.98.80:8090", "https://cdn.jsdelivr.net"] // Разрешаем подключения к torrServer и cdn.jsdelivr.net
    }
  }
}));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    // Декодируем URL-кодированный запрос
    const decodedQuery = decodeURIComponent(query);
    console.log('Search request for:', decodedQuery);

    const results = await torrentParser.searchTorrents(decodedQuery);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search torrents' });
  }
});

app.post('/api/play', async (req, res) => {
  try {
    const { magnetLink, title } = req.body;
    
    if (!magnetLink) {
      return res.status(400).json({ error: 'Magnet link is required' });
    }

    const result = await torrServerClient.addTorrent(magnetLink, title);
    res.json(result);
  } catch (error) {
    console.error('Play error:', error);
    res.status(500).json({ error: 'Failed to start playback: ' + error.message });
  }
});

// Новый endpoint для получения списка файлов из торрента
app.get('/api/torrent/files/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    
    if (!hash) {
      return res.status(400).json({ error: 'Hash is required' });
    }

    // Ждем пока торрент будет готов к воспроизведению
    console.log('Waiting for torrent to be ready before getting files...');
    await torrServerClient.waitForTorrentReady(hash);

    const files = await torrServerClient.getTorrentFiles(hash);
    res.json({ files });
  } catch (error) {
    console.error('Get files error:', error);
    res.status(500).json({ error: 'Failed to get torrent files: ' + error.message });
  }
});

app.get('/api/torrents', async (req, res) => {
  try {
    const torrents = await torrServerClient.getTorrents();
    res.json(torrents);
  } catch (error) {
    console.error('Get torrents error:', error);
    res.status(500).json({ error: 'Failed to get torrents' });
  }
});

app.delete('/api/torrents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await torrServerClient.removeTorrent(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Remove torrent error:', error);
    res.status(500).json({ error: 'Failed to remove torrent' });
  }
});

// Endpoint для удаления торрента (альтернативный путь)
app.delete('/api/torrent/remove/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    console.log(`Removing torrent via API: ${hash}`);
    await torrServerClient.removeTorrent(hash);
    res.json({ success: true, message: 'Torrent removed successfully' });
  } catch (error) {
    console.error('Remove torrent error:', error);
    res.status(500).json({ error: 'Failed to remove torrent: ' + error.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const status = await torrServerClient.checkServerStatus();
    res.json(status);
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ error: 'Failed to check server status' });
  }
});

// Endpoint для просмотра активных отслеживаемых торрентов
app.get('/api/active-torrents', (req, res) => {
  try {
    const activeTorrents = Array.from(torrServerClient.activeTorrents.entries()).map(([hash, info]) => ({
      hash,
      title: info.title,
      lastActivity: new Date(info.lastActivity).toISOString(),
      inactiveFor: Math.round((Date.now() - info.lastActivity) / 1000) + 's'
    }));
    
    res.json({
      count: activeTorrents.length,
      inactivityTimeout: torrServerClient.inactivityTimeout / 1000 + 's',
      torrents: activeTorrents
    });
  } catch (error) {
    console.error('Active torrents error:', error);
    res.status(500).json({ error: 'Failed to get active torrents' });
  }
});

// Прокси для стриминга
app.get('/api/stream/:filename(*)', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Извлекаем hash из query параметров для отслеживания активности
    const hash = req.query.link;
    if (hash) {
      torrServerClient.registerTorrentActivity(hash, 'streaming');
    }
    
    // Правильно формируем query string: если значение пустое, не добавляем =
    const queryString = Object.keys(req.query)
      .map(key => {
        const value = req.query[key];
        return value !== '' && value !== undefined ? `${key}=${value}` : key;
      })
      .join('&');
    
    // Добавляем filename в путь если он есть
    const streamPath = filename ? `/${filename}` : '';
    const streamUrl = `http://217.144.98.80:8090/stream${streamPath}${queryString ? '?' + queryString : ''}`;
    
    console.log('Proxying stream request to:', streamUrl);
    console.log('Client Range header:', req.headers.range);
    
    const axios = require('axios');
    const response = await axios.get(streamUrl, {
      responseType: 'stream',
      headers: {
        'Authorization': `Basic ${Buffer.from('user1:test123').toString('base64')}`,
        'Range': req.headers.range || ''
      },
      validateStatus: function (status) {
        return status >= 200 && status < 500; // Разрешаем 206 Partial Content
      }
    });
    
    console.log('TorrServer response status:', response.status);
    console.log('TorrServer response headers:', response.headers);
    
    // Копируем статус
    res.status(response.status);
    
    // Копируем заголовки
    Object.keys(response.headers).forEach(key => {
      res.setHeader(key, response.headers[key]);
    });
    
    // Пробрасываем поток
    response.data.pipe(res);
    
    // Логируем ошибки потока
    response.data.on('error', (err) => {
      console.error('Stream error:', err);
    });
    
  } catch (error) {
    console.error('Stream proxy error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data (first 500 chars):', error.response.data ? error.response.data.toString().substring(0, 500) : 'N/A');
    }
    res.status(500).json({ error: 'Failed to proxy stream: ' + error.message });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  torrServerClient.stopCleanup();
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  torrServerClient.stopCleanup();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
