const axios = require('axios');

class TorrServerClient {
  constructor() {
    this.baseUrl = process.env.TORRSERVER_URL || 'http://217.144.98.80:8090';
    this.username = process.env.TORRSERVER_USER || 'user1';
    this.password = process.env.TORRSERVER_PASSWORD || 'test123';
    this.auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    
    // Отслеживание активных торрентов
    this.activeTorrents = new Map(); // hash -> { lastActivity: timestamp, title: string }
    this.inactivityTimeout = 3 * 60 * 1000; // 3 минуты неактивности
    
    // Запускаем очистку каждые 30 секунд
    this.cleanupInterval = setInterval(() => this.cleanupInactiveTorrents(), 30000);
  }

  async addTorrent(magnetLink, title = 'Unknown') {
    try {
      console.log(`Adding torrent to torrServer: ${title}`);
      
      // Извлекаем hash из magnet-ссылки
      const hash = this.extractHashFromMagnet(magnetLink);
      if (!hash) {
        throw new Error('Invalid magnet link - cannot extract hash');
      }
      
      console.log(`Extracted hash: ${hash}`);
      
      // TorrServer API: POST /torrents с телом запроса
      const response = await axios.post(`${this.baseUrl}/torrents`, {
        action: 'add',
        link: magnetLink,
        title: title,
        poster: '',
        save_to_db: true
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${this.auth}`
        },
        timeout: 30000
      });

      console.log('TorrServer response:', response.data);
      
      // Регистрируем торрент как активный
      this.registerTorrentActivity(hash, title);
      
      return { hash, title };
    } catch (error) {
      console.error('Error adding torrent:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      
      // Даже если добавление не удалось, возвращаем hash для попытки воспроизведения
      const hash = this.extractHashFromMagnet(magnetLink);
      if (hash) {
        console.log('Returning hash anyway for playback attempt:', hash);
        this.registerTorrentActivity(hash, title);
        return { hash, title };
      }
      
      throw new Error(`Failed to add torrent: ${error.message}`);
    }
  }
  
  extractHashFromMagnet(magnetLink) {
    const match = magnetLink.match(/btih:([a-fA-F0-9]{40})/i);
    return match ? match[1].toUpperCase() : null;
  }

  async getTorrents() {
    try {
      const response = await axios.get(`${this.baseUrl}/torrents`, {
        headers: {
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        timeout: 10000
      });

      return response.data || [];
    } catch (error) {
      console.error('Error getting torrents:', error.message);
      throw new Error(`Failed to get torrents: ${error.message}`);
    }
  }

  async getTorrentInfo(hash) {
    try {
      const response = await axios.get(`${this.baseUrl}/torrents/${hash}`, {
        headers: {
          ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
        },
        timeout: 10000
      });

      return response.data;
    } catch (error) {
      console.error('Error getting torrent info:', error.message);
      throw new Error(`Failed to get torrent info: ${error.message}`);
    }
  }

  async waitForTorrentReady(hash, maxWaitTime = 30000) {
    console.log(`Waiting for torrent ${hash} to be ready...`);
    const startTime = Date.now();
    const checkInterval = 2000; // Проверяем каждые 2 секунды
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const torrentsResponse = await axios.post(`${this.baseUrl}/torrents`, {
          action: 'list'
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${this.auth}`
          },
          timeout: 10000
        });

        if (Array.isArray(torrentsResponse.data)) {
          const torrent = torrentsResponse.data.find(t => 
            t.hash && t.hash.toLowerCase() === hash.toLowerCase()
          );

          if (torrent) {
            console.log(`Torrent status: ${torrent.stat_string}, stat: ${torrent.stat}`);
            
            // stat >= 2 означает что торрент готов к воспроизведению
            // stat 0 = добавлен, 1 = получает инфо, 2 = работает, 3 = работает полностью
            if (torrent.stat >= 2) {
              console.log('Torrent is ready for playback!');
              return true;
            }
          }
        }
        
        // Ждем перед следующей проверкой
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        
      } catch (error) {
        console.error('Error checking torrent status:', error.message);
      }
    }
    
    console.log('Torrent not ready after max wait time, proceeding anyway...');
    return false;
  }

  async removeTorrent(hash) {
    try {
      console.log(`Removing torrent from torrServer: ${hash}`);
      
      // TorrServer API: POST /torrents с action: 'rem'
      const response = await axios.post(`${this.baseUrl}/torrents`, {
        action: 'rem',
        hash: hash
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${this.auth}`
        },
        timeout: 10000
      });

      console.log(`Torrent removed: ${hash}`, response.data);
      
      // Удаляем из отслеживаемых
      this.activeTorrents.delete(hash);
      
      return true;
    } catch (error) {
      console.error('Error removing torrent:', error.message);
      throw new Error(`Failed to remove torrent: ${error.message}`);
    }
  }

  async getStreamUrl(hash, fileIndex = 0) {
    try {
      const torrentInfo = await this.getTorrentInfo(hash);
      
      if (torrentInfo && torrentInfo.files && torrentInfo.files[fileIndex]) {
        const streamUrl = `${this.baseUrl}/stream/${hash}/${fileIndex}`;
        return streamUrl;
      }

      throw new Error('File not found in torrent');
    } catch (error) {
      console.error('Error getting stream URL:', error.message);
      throw new Error(`Failed to get stream URL: ${error.message}`);
    }
  }

  async getTorrentFiles(hash) {
    try {
      console.log(`Getting files for torrent: ${hash}`);
      
      // Пробуем несколько подходов для получения информации о файлах
      
      // Подход 1: Получаем список всех торрентов и находим нужный
      try {
        console.log('Trying approach 1: GET /torrents');
        const torrentsResponse = await axios.post(`${this.baseUrl}/torrents`, {
          action: 'list'
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${this.auth}`
          },
          timeout: 10000
        });

        console.log('Torrents list response:', torrentsResponse.data);

        if (Array.isArray(torrentsResponse.data)) {
          const torrent = torrentsResponse.data.find(t => 
            t.hash && t.hash.toLowerCase() === hash.toLowerCase()
          );

          if (torrent) {
            console.log('Found torrent in list:', torrent);
            
            // Проверяем, есть ли поле data с информацией о файлах
            if (torrent.data) {
              try {
                const parsedData = JSON.parse(torrent.data);
                console.log('Parsed torrent data:', parsedData);
                
                if (parsedData.TorrServer && parsedData.TorrServer.Files) {
                  return this.parseFilesFromData(parsedData.TorrServer.Files, hash, torrent.title);
                }
              } catch (parseError) {
                console.log('Failed to parse torrent data:', parseError.message);
              }
            }
            
            // Если данных нет, пробуем получить детальную информацию через stat
            try {
              console.log('Getting detailed info via POST /stat');
              const statResponse = await axios.post(`${this.baseUrl}/stat`, {
                hash: hash,
                link: torrent.link || `magnet:?xt=urn:btih:${hash}`
              }, {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Basic ${this.auth}`
                },
                timeout: 15000
              });

              console.log('Stat response:', statResponse.data);

              if (statResponse.data && statResponse.data.file_stats) {
                return this.parseFileStats(statResponse.data, hash);
              }
            } catch (statError) {
              console.log('Stat approach failed:', statError.message);
            }
          }
        }
      } catch (listError) {
        console.log('List approach failed:', listError.message);
      }

      // Подход 2: Пробуем напрямую через cache endpoint
      try {
        console.log('Trying approach 2: POST /cache');
        const cacheResponse = await axios.post(`${this.baseUrl}/cache`, {
          hash: hash,
          link: `magnet:?xt=urn:btih:${hash}`
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${this.auth}`
          },
          timeout: 15000
        });

        console.log('Cache response:', cacheResponse.data);

        if (cacheResponse.data && cacheResponse.data.Pieces) {
          // Создаем базовую структуру файлов на основе кэша
          return this.createFilesFromCache(cacheResponse.data, hash);
        }
      } catch (cacheError) {
        console.log('Cache approach failed:', cacheError.message);
      }

      // Подход 3: Создаем базовый плейлист для воспроизведения
      console.log('Using fallback approach: creating basic playlist');
      return this.createBasicPlaylist(hash);

    } catch (error) {
      console.error('Error getting torrent files:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      
      // В крайнем случае возвращаем базовый плейлист
      return this.createBasicPlaylist(hash);
    }
  }

  parseFilesFromData(files, hash, torrentTitle) {
    console.log(`Parsing ${files.length} files from torrent data`);
    const hashLower = hash.toLowerCase();
    
    const parsedFiles = files.map((file, index) => {
      const fileId = file.id || index;
      return {
        id: fileId,
        name: file.path || `File ${index + 1}`,
        size: file.length || 0,
        sizeFormatted: this.formatBytes(file.length || 0),
        // ИСПОЛЬЗУЕМ ПРОКСИ через localhost чтобы избежать HTTP->HTTPS апгрейда браузера
        // Используем параметр play как флаг (без значения)
        streamUrl: `/api/stream/video?link=${hashLower}&index=${fileId}&play`,
        m3u8Url: `/api/stream/video?link=${hashLower}&index=${fileId}&m3u`,
        preloadUrl: `/api/stream/video?link=${hashLower}&index=${fileId}&preload`
      };
    });
    
    // Фильтруем только видео файлы
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
    const videoFiles = parsedFiles.filter(file => 
      videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    
    console.log(`Found ${videoFiles.length} video files out of ${parsedFiles.length} total files`);
    console.log('Sample file:', videoFiles[0]);
    return videoFiles;
  }

  parseFileStats(statData, hash) {
    const torrentTitle = statData.title || 'video';
    const files = statData.file_stats.map((file, index) => ({
      id: file.id || index,
      name: file.path || `File ${index + 1}`,
      size: file.length || 0,
      sizeFormatted: this.formatBytes(file.length || 0),
      streamUrl: `${this.baseUrl}/stream/${encodeURIComponent(torrentTitle)}?link=${hash}&index=${file.id || index}&play`,
      m3u8Url: `${this.baseUrl}/stream/${encodeURIComponent(torrentTitle)}?link=${hash}&index=${file.id || index}&m3u`,
      preloadUrl: `${this.baseUrl}/stream/${encodeURIComponent(torrentTitle)}?link=${hash}&index=${file.id || index}&preload`
    }));
    
    // Фильтруем только видео файлы
    const videoExtensions = ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'];
    const videoFiles = files.filter(file => 
      videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    
    console.log(`Found ${videoFiles.length} video files out of ${files.length} total files`);
    return videoFiles;
  }

  createFilesFromCache(cacheData, hash) {
    console.log('Creating files from cache data');
    // Если есть информация о кэше, создаем базовые файлы
    const files = [];
    const torrentTitle = 'video';
    
    // Создаем несколько вариантов для разных индексов
    for (let i = 0; i < 10; i++) {
      files.push({
        id: i,
        name: `File ${i + 1}`,
        size: 0,
        sizeFormatted: 'Unknown',
        streamUrl: `${this.baseUrl}/stream/${encodeURIComponent(torrentTitle)}?link=${hash}&index=${i}&play`,
        m3u8Url: `${this.baseUrl}/stream/${encodeURIComponent(torrentTitle)}?link=${hash}&index=${i}&m3u`,
        preloadUrl: `${this.baseUrl}/stream/${encodeURIComponent(torrentTitle)}?link=${hash}&index=${i}&preload`
      });
    }
    
    console.log(`Created ${files.length} placeholder files`);
    return files;
  }

  createBasicPlaylist(hash) {
    console.log('Creating basic playlist for hash:', hash);
    
    // Создаем базовый набор файлов для попытки воспроизведения
    const files = [];
    const hashLower = hash.toLowerCase();
    
    for (let i = 0; i < 20; i++) {
      files.push({
        id: i,
        name: `Серия ${i + 1}`,
        size: 0,
        sizeFormatted: 'Unknown',
        // Используем прокси через наш сервер
        streamUrl: `/api/stream/video?link=${hashLower}&index=${i}&play`,
        m3u8Url: `/api/stream/video?link=${hashLower}&index=${i}&m3u`,
        preloadUrl: `/api/stream/video?link=${hashLower}&index=${i}&preload`
      });
    }
    
    console.log(`Created ${files.length} basic playlist items`);
    console.log('Sample URL:', files[0].m3u8Url);
    return files;
  }
  
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  async checkServerStatus() {
    try {
      const response = await axios.get(`${this.baseUrl}/status`, {
        timeout: 5000
      });
      
      return {
        status: 'online',
        version: response.data.version || 'Unknown',
        uptime: response.data.uptime || 'Unknown'
      };
    } catch (error) {
      return {
        status: 'offline',
        error: error.message
      };
    }
  }

  // Регистрация активности торрента
  registerTorrentActivity(hash, title = 'Unknown') {
    const hashUpper = hash.toUpperCase();
    this.activeTorrents.set(hashUpper, {
      lastActivity: Date.now(),
      title: title
    });
    console.log(`Registered activity for torrent: ${title} (${hashUpper})`);
  }

  // Очистка неактивных торрентов
  async cleanupInactiveTorrents() {
    const now = Date.now();
    const torrentsToRemove = [];

    for (const [hash, info] of this.activeTorrents.entries()) {
      const inactiveTime = now - info.lastActivity;
      
      if (inactiveTime > this.inactivityTimeout) {
        console.log(`Torrent ${info.title} (${hash}) has been inactive for ${Math.round(inactiveTime / 1000)}s`);
        torrentsToRemove.push({ hash, title: info.title });
      }
    }

    // Удаляем неактивные торренты
    for (const torrent of torrentsToRemove) {
      try {
        console.log(`Auto-removing inactive torrent: ${torrent.title} (${torrent.hash})`);
        await this.removeTorrent(torrent.hash);
      } catch (error) {
        console.error(`Failed to auto-remove torrent ${torrent.hash}:`, error.message);
        // Удаляем из списка отслеживаемых даже если удаление не удалось
        this.activeTorrents.delete(torrent.hash);
      }
    }

    if (torrentsToRemove.length > 0) {
      console.log(`Cleaned up ${torrentsToRemove.length} inactive torrents`);
    }
  }

  // Остановка очистки (для graceful shutdown)
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      console.log('Torrent cleanup stopped');
    }
  }
}

module.exports = new TorrServerClient();
