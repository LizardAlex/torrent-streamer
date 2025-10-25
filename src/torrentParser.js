const axios = require('axios');
const cheerio = require('cheerio');
const alternativeParser = require('./alternativeTorrentParser');

class TorrentParser {
  constructor() {
    this.baseUrl = 'https://jacred.xyz';
    this.searchUrl = `${this.baseUrl}/search`;
    
    // Альтернативные источники
    this.alternativeSources = [
      {
        name: 'rutor',
        baseUrl: 'http://rutor.info',
        searchUrl: 'http://rutor.info/search/',
        enabled: true
      },
      {
        name: 'rutracker',
        baseUrl: 'https://rutracker.org',
        searchUrl: 'https://rutracker.org/forum/tracker.php',
        enabled: false // Требует регистрации
      }
    ];
    
    // Попробуем разные подходы для jacred.xyz (Torlook)
    this.tryDifferentApproaches = true;
  }

  async searchTorrents(query) {
    try {
      console.log(`Searching for: ${query}`);
      
      // Попробуем разные подходы для jacred.xyz (Torlook)
      const approaches = [
        // Подход 1: Обычный GET запрос
        () => this.tryGetSearch(query),
        // Подход 2: POST запрос
        () => this.tryPostSearch(query),
        // Подход 3: API endpoint
        () => this.tryApiSearch(query),
        // Подход 4: Прямой поиск по URL
        () => this.tryDirectSearch(query)
      ];
      
      for (let i = 0; i < approaches.length; i++) {
        try {
          console.log(`Trying approach ${i + 1} for jacred.xyz...`);
          const results = await approaches[i]();
          if (results && results.length > 0) {
            console.log(`Found ${results.length} torrents on jacred.xyz with approach ${i + 1}`);
            return results;
          }
        } catch (error) {
          console.log(`Approach ${i + 1} failed:`, error.message);
          continue;
        }
      }
      
      console.log('All jacred.xyz approaches failed, trying alternative sources...');
      return await this.searchAlternativeSources(query);

    } catch (error) {
      console.error('Search error:', error.message);
      
      // При любой ошибке переходим к альтернативным источникам
      try {
        return await this.searchAlternativeSources(query);
      } catch (altError) {
        console.log('Alternative sources also failed, returning empty results');
        return []; // Возвращаем пустой массив вместо тестовых данных
      }
    }
  }

  async tryGetSearch(query) {
    const response = await axios.get(this.searchUrl, {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3'
      },
      timeout: 10000
    });
    
    return this.parseResults(response.data);
  }

  async tryPostSearch(query) {
    const response = await axios.post(this.searchUrl, 
      `q=${encodeURIComponent(query)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000
      }
    );
    
    return this.parseResults(response.data);
  }

  async tryApiSearch(query) {
    console.log('Trying REAL API endpoint...');
    const response = await axios.get(`${this.baseUrl}/api/v1.0/torrents`, {
      params: { 
        search: query,
        apikey: 'null' // Как в примере
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000
    });
    
    console.log('API Response status:', response.status);
    console.log('API Response data length:', response.data.length);
    
    return this.parseApiResults(response.data);
  }

  async tryDirectSearch(query) {
    const response = await axios.get(`${this.baseUrl}/search/${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000
    });
    
    return this.parseResults(response.data);
  }

  parseResults(html) {
    const $ = cheerio.load(html);
    const results = [];

    // Различные селекторы для результатов
    const selectors = [
      'tr', 
      '.search-result', 
      '.torrent-item', 
      '.result-item',
      '.item',
      'tbody tr',
      'table tr'
    ];
    
    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        console.log(`Found ${elements.length} elements with selector: ${selector}`);
        
        elements.each((index, element) => {
          try {
            const $element = $(element);
            const title = this.extractTitle($element);
            const magnetLink = this.extractMagnetLink($element);
            
            if (title && magnetLink && title.length > 5) {
              results.push({
                id: `jacred_${results.length}`,
                title: title.trim(),
                magnetLink: magnetLink.trim(),
                size: this.extractSize($element) || 'Unknown',
                seeds: this.extractSeeds($element) || 0,
                date: this.extractDate($element) || 'Unknown',
                quality: this.extractQuality($element) || 'Unknown',
                source: 'jacred.xyz'
              });
            }
          } catch (error) {
            console.error('Error parsing torrent item:', error);
          }
        });
      }
    }

    return results;
  }

  parseApiResults(apiData) {
    console.log('Parsing API results...');
    const results = [];
    
    if (Array.isArray(apiData)) {
      console.log(`Found ${apiData.length} torrents in API response`);
      
      apiData.forEach((torrent, index) => {
        try {
          if (torrent.magnet && torrent.title) {
            results.push({
              id: `jacred_api_${index}`,
              title: torrent.title,
              magnetLink: torrent.magnet,
              size: torrent.sizeName || 'Unknown',
              seeds: torrent.sid || 0,
              peers: torrent.pir || 0, // Добавляем количество пиров (скачивающих)
              date: torrent.createTime ? new Date(torrent.createTime).toLocaleDateString('ru-RU') : 'Unknown',
              quality: torrent.quality ? `${torrent.quality}p` : 'Unknown',
              tracker: torrent.tracker || 'unknown', // Отдельно трекер
              source: torrent.tracker || 'unknown'
            });
          }
        } catch (error) {
          console.error('Error parsing API torrent item:', error);
        }
      });
    }
    
    // Сортируем по количеству сидов (от большего к меньшему)
    results.sort((a, b) => b.seeds - a.seeds);
    
    console.log(`Parsed ${results.length} torrents from API, sorted by seeds`);
    return results;
  }

  extractTitle($element) {
    // Различные селекторы для заголовка
    const titleSelectors = [
      '.title a',
      '.torrent-title a',
      '.name a',
      'a[href*="magnet"]',
      'a[href*="torrent"]',
      '.result-title',
      'h3 a',
      'h4 a'
    ];

    for (const selector of titleSelectors) {
      const titleElement = $element.find(selector).first();
      if (titleElement.length) {
        return titleElement.text() || titleElement.attr('title');
      }
    }

    return null;
  }

  extractMagnetLink($element) {
    // Ищем magnet ссылку
    const magnetElement = $element.find('a[href^="magnet:"]').first();
    if (magnetElement.length) {
      return magnetElement.attr('href');
    }

    // Ищем ссылки на торренты
    const torrentElement = $element.find('a[href*="torrent"]').first();
    if (torrentElement.length) {
      const href = torrentElement.attr('href');
      if (href && href.startsWith('magnet:')) {
        return href;
      }
    }

    return null;
  }

  extractSize($element) {
    const sizeSelectors = ['.size', '.torrent-size', '.file-size'];
    
    for (const selector of sizeSelectors) {
      const sizeElement = $element.find(selector);
      if (sizeElement.length) {
        return sizeElement.text().trim();
      }
    }

    return null;
  }

  extractSeeds($element) {
    const seedSelectors = ['.seeds', '.seeders', '.seed'];
    
    for (const selector of seedSelectors) {
      const seedElement = $element.find(selector);
      if (seedElement.length) {
        const seedText = seedElement.text().trim();
        const seeds = parseInt(seedText);
        return isNaN(seeds) ? 0 : seeds;
      }
    }

    return 0;
  }

  extractDate($element) {
    const dateSelectors = ['.date', '.added', '.upload-date'];
    
    for (const selector of dateSelectors) {
      const dateElement = $element.find(selector);
      if (dateElement.length) {
        return dateElement.text().trim();
      }
    }

    return null;
  }

  extractQuality($element) {
    const qualitySelectors = ['.quality', '.resolution', '.format'];
    
    for (const selector of qualitySelectors) {
      const qualityElement = $element.find(selector);
      if (qualityElement.length) {
        return qualityElement.text().trim();
      }
    }

    return null;
  }

  parseAlternativeFormat($) {
    const results = [];
    
    console.log('Trying alternative parsing methods...');
    
    // Метод 1: Ищем все magnet ссылки
    const magnetLinks = $('a[href^="magnet:"]');
    console.log(`Found ${magnetLinks.length} magnet links`);
    
    magnetLinks.each((index, element) => {
      const $element = $(element);
      const magnetLink = $element.attr('href');
      const title = $element.text() || $element.attr('title') || `Torrent ${index + 1}`;
      
      if (magnetLink && title) {
        results.push({
          id: `torrent_alt_${index}`,
          title: title.trim(),
          magnetLink: magnetLink.trim(),
          size: 'Unknown',
          seeds: 0,
          date: 'Unknown',
          quality: 'Unknown',
          source: 'jacred.xyz'
        });
      }
    });

    // Метод 2: Ищем ссылки на торренты
    if (results.length === 0) {
      console.log('No magnet links found, trying torrent links...');
      const torrentLinks = $('a[href*="torrent"]');
      console.log(`Found ${torrentLinks.length} torrent links`);
      
      torrentLinks.each((index, element) => {
        const $element = $(element);
        const href = $element.attr('href');
        const title = $element.text() || $element.attr('title') || `Torrent ${index + 1}`;
        
        if (href && title) {
          results.push({
            id: `torrent_link_${index}`,
            title: title.trim(),
            magnetLink: href.trim(),
            size: 'Unknown',
            seeds: 0,
            date: 'Unknown',
            quality: 'Unknown',
            source: 'jacred.xyz'
          });
        }
      });
    }

    // Метод 3: Ищем любые ссылки с текстом
    if (results.length === 0) {
      console.log('No torrent links found, trying any links with text...');
      const allLinks = $('a').filter(function() {
        const text = $(this).text().trim();
        return text.length > 10 && text.length < 200;
      });
      
      console.log(`Found ${allLinks.length} text links`);
      
      allLinks.slice(0, 10).each((index, element) => {
        const $element = $(element);
        const href = $element.attr('href');
        const title = $element.text().trim();
        
        if (href && title) {
          results.push({
            id: `torrent_text_${index}`,
            title: title,
            magnetLink: href,
            size: 'Unknown',
            seeds: 0,
            date: 'Unknown',
            quality: 'Unknown',
            source: 'jacred.xyz'
          });
        }
      });
    }

    console.log(`Alternative parsing found ${results.length} results`);
    return results;
  }

  async searchAlternativeSources(query) {
    console.log('Searching alternative sources for:', query);
    
    for (const source of this.alternativeSources) {
      if (!source.enabled) continue;
      
      try {
        console.log(`Trying source: ${source.name}`);
        const results = await this.searchOnSource(source, query);
        if (results.length > 0) {
          console.log(`Found ${results.length} results on ${source.name}`);
          return results;
        }
      } catch (error) {
        console.log(`Source ${source.name} failed:`, error.message);
        continue;
      }
    }
    
    // Если все источники недоступны, возвращаем пустой массив
    console.log('No alternative sources available, returning empty results');
    return [];
  }

  async searchOnSource(source, query) {
    const response = await axios.get(source.searchUrl, {
      params: {
        s: query,
        ...(source.name === 'rutor' && { s: query })
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000,
      maxRedirects: 3
    });

    const $ = cheerio.load(response.data);
    const results = [];

    // Парсинг для rutor
    if (source.name === 'rutor') {
      $('tr').each((index, element) => {
        const $element = $(element);
        const titleElement = $element.find('td a').first();
        
        if (titleElement.length) {
          const title = titleElement.text().trim();
          const href = titleElement.attr('href');
          
          if (title && href && title.length > 10) {
            const sizeElement = $element.find('td').eq(2);
            const seedsElement = $element.find('td').eq(4);
            
            results.push({
              id: `rutor_${index}`,
              title: title,
              magnetLink: href.startsWith('magnet:') ? href : `magnet:?xt=urn:btih:${href}`,
              size: sizeElement.text().trim() || 'Unknown',
              seeds: parseInt(seedsElement.text()) || 0,
              date: 'Unknown',
              quality: this.extractQuality(title),
              source: 'rutor.info'
            });
          }
        }
      });
    }

    return results.slice(0, 10); // Ограничиваем количество результатов
  }

}

module.exports = new TorrentParser();
