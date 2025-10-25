const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const torrentParser = require('./src/torrentParser');
const torrServerClient = require('./src/torrServerClient');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Отключаем CSP полностью для HTTP-сервера
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false
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

// FFmpeg transcoding endpoint for Xbox compatibility with seeking support
app.get('/api/transcode/:filename?', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // Извлекаем hash из query параметров для отслеживания активности
    const hash = req.query.link;
    if (hash) {
      torrServerClient.registerTorrentActivity(hash, 'transcoding');
    }
    
    // Извлекаем параметр seek (если есть)
    const seekTime = parseInt(req.query.seek) || 0;
    
    // Формируем URL к оригинальному потоку torrServer (БЕЗ параметра seek)
    const queryString = Object.keys(req.query)
      .filter(key => key !== 'seek') // Убираем seek из URL для torrServer
      .map(key => {
        const value = req.query[key];
        return value !== '' && value !== undefined ? `${key}=${value}` : key;
      })
      .join('&');
    
    const streamPath = filename ? `/${filename}` : '';
    const streamUrl = `http://217.144.98.80:8090/stream${streamPath}${queryString ? '?' + queryString : ''}`;
    
    if (seekTime > 0) {
      console.log(`🎵 Starting FFmpeg audio-only transcoding from ${seekTime}s (${Math.floor(seekTime/60)}:${(seekTime%60).toString().padStart(2,'0')}) for:`, streamUrl);
    } else {
      console.log('🎵 Starting FFmpeg audio-only transcoding (video copy) for:', streamUrl);
    }
    
    // Настройка заголовков для видео потока (Matroska/MKV)
    res.setHeader('Content-Type', 'video/x-matroska');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // FFmpeg команда для транскодинга ТОЛЬКО АУДИО (видео копируется без изменений)
    // -ss: начальная позиция (ПЕРЕД -i для быстрого seek)
    // -i: входной URL с Basic Auth
    // -c:v copy: КОПИРОВАТЬ видео без перекодирования (быстро, нет нагрузки)
    // -c:a aac: AAC кодек для аудио (универсальная совместимость с Xbox)
    // -b:a 128k: битрейт аудио 128 kbps
    // -ac 2: стерео (2 канала)
    // -f matroska: контейнер MKV (работает через pipe для streaming)
    // pipe:1: вывод в stdout
    const ffmpegArgs = [
      '-headers', `Authorization: Basic ${Buffer.from('user1:test123').toString('base64')}`,
    ];
    
    // Добавляем -ss ПЕРЕД -i для быстрого seek (input seeking)
    if (seekTime > 0) {
      ffmpegArgs.push('-ss', seekTime.toString());
    }
    
    ffmpegArgs.push(
      '-i', streamUrl,
      '-c:v', 'copy',           // Копируем видео как есть (без перекодирования)
      '-c:a', 'aac',            // Перекодируем аудио в AAC
      '-b:a', '128k',           // Битрейт аудио
      '-ac', '2',               // Стерео
      '-f', 'matroska',         // MKV контейнер (работает через pipe)
      'pipe:1'
    );
    
    console.log('FFmpeg command:', 'ffmpeg', ffmpegArgs.join(' '));
    
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    
    // Пробрасываем транскодированный поток в ответ
    ffmpeg.stdout.pipe(res);
    
    // Логируем stderr FFmpeg (прогресс, ошибки)
    ffmpeg.stderr.on('data', (data) => {
      const message = data.toString();
      // Фильтруем слишком многословный вывод FFmpeg
      if (message.includes('frame=') || message.includes('time=')) {
        // Логируем только каждую 10-ю строку прогресса
        if (Math.random() < 0.1) {
          console.log('FFmpeg progress:', message.split('\n')[0]);
        }
      } else {
        console.log('FFmpeg:', message);
      }
    });
    
    // Обрабатываем закрытие соединения клиентом
    req.on('close', () => {
      console.log('Client disconnected, killing FFmpeg process');
      ffmpeg.kill('SIGKILL');
    });
    
    // Обрабатываем завершение FFmpeg
    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`FFmpeg process exited with code ${code}`);
      } else {
        console.log('FFmpeg transcoding finished successfully');
      }
    });
    
    // Обрабатываем ошибки FFmpeg
    ffmpeg.on('error', (err) => {
      console.error('FFmpeg spawn error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to start transcoding' });
      }
    });
    
  } catch (error) {
    console.error('Transcode error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to transcode: ' + error.message });
    }
  }
});

// Check audio codec compatibility endpoint
app.get('/api/check-codec/:filename?', async (req, res) => {
  try {
    const { filename } = req.params;
    const hash = req.query.link;
    const index = req.query.index;
    
    if (!hash) {
      return res.status(400).json({ error: 'Missing link parameter' });
    }
    
    // Формируем URL к потоку torrServer
    const queryString = Object.keys(req.query)
      .map(key => {
        const value = req.query[key];
        return value !== '' && value !== undefined ? `${key}=${value}` : key;
      })
      .join('&');
    
    const streamPath = filename ? `/${filename}` : '';
    const streamUrl = `http://217.144.98.80:8090/stream${streamPath}${queryString ? '?' + queryString : ''}`;
    
    console.log('🔍 Checking codec for:', streamUrl);
    
    // Используем ffprobe для анализа потока
    const ffprobe = spawn('ffprobe', [
      '-headers', `Authorization: Basic ${Buffer.from('user1:test123').toString('base64')}`,
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-analyzeduration', '5000000', // 5 секунд анализа
      '-probesize', '5000000',
      streamUrl
    ]);
    
    let output = '';
    let errorOutput = '';
    
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      if (code !== 0) {
        console.error('FFprobe error:', errorOutput);
        return res.status(500).json({ 
          error: 'Failed to probe stream',
          needsTranscode: true // На всякий случай включаем транскодинг
        });
      }
      
      try {
        const probeData = JSON.parse(output);
        const audioStream = probeData.streams?.find(s => s.codec_type === 'audio');
        
        if (!audioStream) {
          console.log('⚠️ No audio stream found');
          return res.json({
            hasAudio: false,
            needsTranscode: true,
            reason: 'No audio stream'
          });
        }
        
        const audioCodec = audioStream.codec_name;
        const isCompatible = audioCodec === 'aac' || audioCodec === 'mp3';
        
        console.log(`🎵 Audio codec: ${audioCodec}, compatible: ${isCompatible}`);
        
        res.json({
          hasAudio: true,
          audioCodec: audioCodec,
          needsTranscode: !isCompatible,
          reason: isCompatible ? 'Compatible codec' : `Incompatible codec: ${audioCodec}`
        });
      } catch (parseError) {
        console.error('Failed to parse ffprobe output:', parseError);
        res.status(500).json({ 
          error: 'Failed to parse probe data',
          needsTranscode: true
        });
      }
    });
    
  } catch (error) {
    console.error('Codec check error:', error.message);
    res.status(500).json({ 
      error: 'Failed to check codec',
      needsTranscode: true
    });
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
