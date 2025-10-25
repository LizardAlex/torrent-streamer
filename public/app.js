class TorrentApp {
    constructor() {
        this.currentStreamUrl = null;
        this.hls = null;
        this.currentTorrent = null;
        this.currentFileIndex = 0; // Индекс текущей серии
        this.favorites = this.loadFavorites();
        this.recentlyWatched = this.loadRecentlyWatched();
        this.initializeEventListeners();
        this.initializeTabs();
        this.renderFavorites();
        this.renderRecentlyWatched();
    }

    // LocalStorage функции
    loadFavorites() {
        try {
            const data = localStorage.getItem('torrent_favorites');
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Error loading favorites:', error);
            return [];
        }
    }

    saveFavorites() {
        try {
            localStorage.setItem('torrent_favorites', JSON.stringify(this.favorites));
        } catch (error) {
            console.error('Error saving favorites:', error);
        }
    }

    loadRecentlyWatched() {
        try {
            const data = localStorage.getItem('torrent_recent');
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Error loading recently watched:', error);
            return [];
        }
    }

    saveRecentlyWatched() {
        try {
            localStorage.setItem('torrent_recent', JSON.stringify(this.recentlyWatched));
        } catch (error) {
            console.error('Error saving recently watched:', error);
        }
    }

    // Функции для отслеживания просмотренных серий
    loadWatchedEpisodes() {
        try {
            const data = localStorage.getItem('watched_episodes');
            return data ? JSON.parse(data) : {};
        } catch (error) {
            console.error('Error loading watched episodes:', error);
            return {};
        }
    }

    saveWatchedEpisodes(watchedEpisodes) {
        try {
            localStorage.setItem('watched_episodes', JSON.stringify(watchedEpisodes));
        } catch (error) {
            console.error('Error saving watched episodes:', error);
        }
    }

    markEpisodeAsWatched(torrentHash, episodeIndex) {
        const watchedEpisodes = this.loadWatchedEpisodes();
        
        if (!watchedEpisodes[torrentHash]) {
            watchedEpisodes[torrentHash] = [];
        }
        
        if (!watchedEpisodes[torrentHash].includes(episodeIndex)) {
            watchedEpisodes[torrentHash].push(episodeIndex);
            this.saveWatchedEpisodes(watchedEpisodes);
            console.log(`✅ Episode ${episodeIndex + 1} marked as watched for torrent ${torrentHash}`);
        }
    }

    isEpisodeWatched(torrentHash, episodeIndex) {
        const watchedEpisodes = this.loadWatchedEpisodes();
        return watchedEpisodes[torrentHash] && watchedEpisodes[torrentHash].includes(episodeIndex);
    }

    // Функции для работы с позициями воспроизведения
    loadPlaybackPositions() {
        try {
            const data = localStorage.getItem('playback_positions');
            return data ? JSON.parse(data) : {};
        } catch (error) {
            console.error('Error loading playback positions:', error);
            return {};
        }
    }

    savePlaybackPosition(torrentHash, episodeIndex, currentTime, isTranscoded = false, duration = null) {
        try {
            const positions = this.loadPlaybackPositions();
            const key = `${torrentHash}_${episodeIndex}`;
            
            // Сохраняем позицию только если прошло больше 5 секунд
            if (currentTime > 5) {
                const positionData = {
                    time: Math.floor(currentTime),
                    isTranscoded: isTranscoded,
                    timestamp: Date.now()
                };
                
                // Сохраняем длительность если она передана или уже есть
                if (duration) {
                    positionData.duration = Math.floor(duration);
                } else if (positions[key] && positions[key].duration) {
                    // Сохраняем существующую длительность
                    positionData.duration = positions[key].duration;
                }
                
                positions[key] = positionData;
                localStorage.setItem('playback_positions', JSON.stringify(positions));
                console.log(`💾 Saved position: ${Math.floor(currentTime)}s for ${key}${duration ? ` (duration: ${Math.floor(duration)}s)` : ''}`);
            }
        } catch (error) {
            console.error('Error saving playback position:', error);
        }
    }

    getPlaybackPosition(torrentHash, episodeIndex) {
        try {
            const positions = this.loadPlaybackPositions();
            const key = `${torrentHash}_${episodeIndex}`;
            const position = positions[key];
            
            if (position) {
                // Удаляем старые позиции (старше 30 дней)
                const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                if (position.timestamp < thirtyDaysAgo) {
                    delete positions[key];
                    localStorage.setItem('playback_positions', JSON.stringify(positions));
                    return null;
                }
                
                console.log(`📍 Found saved position: ${position.time}s for ${key}`);
                return position;
            }
            return null;
        } catch (error) {
            console.error('Error getting playback position:', error);
            return null;
        }
    }

    clearPlaybackPosition(torrentHash, episodeIndex) {
        try {
            const positions = this.loadPlaybackPositions();
            const key = `${torrentHash}_${episodeIndex}`;
            delete positions[key];
            localStorage.setItem('playback_positions', JSON.stringify(positions));
            console.log(`🗑️ Cleared position for ${key}`);
        } catch (error) {
            console.error('Error clearing playback position:', error);
        }
    }

    addToRecentlyWatched(torrent) {
        const magnetLink = torrent.magnetLink || torrent.link;
        // Удаляем дубликат если есть
        this.recentlyWatched = this.recentlyWatched.filter(t => (t.magnetLink || t.link) !== magnetLink);
        // Добавляем в начало
        this.recentlyWatched.unshift({
            ...torrent,
            magnetLink: magnetLink,
            watchedAt: new Date().toISOString()
        });
        // Ограничиваем до 20 элементов
        this.recentlyWatched = this.recentlyWatched.slice(0, 20);
        this.saveRecentlyWatched();
        this.renderRecentlyWatched();
    }

    toggleFavorite(torrent) {
        const magnetLink = torrent.magnetLink || torrent.link;
        const index = this.favorites.findIndex(t => (t.magnetLink || t.link) === magnetLink);
        if (index > -1) {
            this.favorites.splice(index, 1);
        } else {
            this.favorites.push({
                ...torrent,
                magnetLink: magnetLink,
                addedAt: new Date().toISOString()
            });
        }
        this.saveFavorites();
        this.renderFavorites();
        // Обновляем иконки на всех вкладках
        this.updateFavoriteButtons();
    }

    isFavorite(magnetLink) {
        return this.favorites.some(t => (t.magnetLink || t.link) === magnetLink);
    }

    updateFavoriteButtons() {
        document.querySelectorAll('.favorite-btn').forEach(btn => {
            const link = btn.dataset.link;
            if (this.isFavorite(link)) {
                btn.classList.add('active');
                btn.innerHTML = '<i class="fas fa-heart"></i>';
            } else {
                btn.classList.remove('active');
                btn.innerHTML = '<i class="far fa-heart"></i>';
            }
        });
    }

    initializeTabs() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                this.switchTab(tabName);
            });
        });
    }

    switchTab(tabName) {
        // Убираем активный класс со всех кнопок и контента
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // Добавляем активный класс к выбранной кнопке и контенту
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}Tab`).classList.add('active');
    }

    initializeEventListeners() {
        document.getElementById('searchForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.searchTorrents();
        });

        document.getElementById('modalClose').addEventListener('click', () => {
            this.closeModal();
        });

        // Закрытие модального окна при клике на overlay
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') {
                this.closeModal();
            }
        });
    }

    async searchTorrents() {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) return;

        const searchBtn = document.getElementById('searchBtn');
        const searchStatus = document.getElementById('searchStatus');
        const resultsList = document.getElementById('resultsList');

        searchBtn.disabled = true;
        searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Поиск...';
        searchStatus.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Ищем торренты...</div>';
        resultsList.innerHTML = '';

        try {
            console.log('Searching for:', query);
            const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
            console.log('Response status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const results = await response.json();
            console.log('Search results:', results);

            if (results.error) {
                throw new Error(results.error);
            }

            this.displayResults(results);
        } catch (error) {
            console.error('Search error:', error);
            searchStatus.innerHTML = `<div class="error-message">Ошибка поиска: ${error.message}</div>`;
        } finally {
            searchBtn.disabled = false;
            searchBtn.innerHTML = '<i class="fas fa-search"></i> Поиск';
        }
    }

    displayResults(results) {
        const searchStatus = document.getElementById('searchStatus');
        const searchHeader = document.getElementById('searchHeader');
        const resultsList = document.getElementById('resultsList');
        const resultsCount = document.getElementById('resultsCount');

        if (results.length === 0) {
            searchStatus.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><h3>Ничего не найдено</h3><p>Попробуйте изменить поисковый запрос</p></div>';
            searchHeader.style.display = 'none';
            return;
        }

        searchStatus.innerHTML = `<div class="success-message">Найдено ${results.length} торрентов</div>`;
        searchHeader.style.display = 'flex';
        resultsCount.textContent = `${results.length} результатов`;

        // Переключаем на вкладку поиска
        this.switchTab('search');

        this.renderTorrentList(results, resultsList);
    }

    renderTorrentList(torrents, container) {
        container.innerHTML = torrents.map((torrent, index) => {
            const isFav = this.isFavorite(torrent.magnetLink);
            return `
                <div class="torrent-item">
                    <div class="torrent-info">
                        <div class="torrent-title">${this.escapeHtml(torrent.title)}</div>
                        <div class="torrent-details">
                            <div class="torrent-detail">
                                <i class="fas fa-server"></i>
                                <span><strong>${torrent.source || torrent.tracker}</strong></span>
                            </div>
                            <div class="torrent-detail">
                                <i class="fas fa-hdd"></i>
                                <span>${torrent.size}</span>
                            </div>
                            <div class="torrent-detail">
                                <i class="fas fa-calendar"></i>
                                <span>${torrent.date}</span>
                            </div>
                            <div class="torrent-detail">
                                <i class="fas fa-arrow-up"></i>
                                <span>${torrent.seeds}</span>
                            </div>
                            <div class="torrent-detail">
                                <i class="fas fa-arrow-down"></i>
                                <span>${torrent.peers || 0}</span>
                            </div>
                        </div>
                    </div>
                    <div class="torrent-actions">
                        <button class="favorite-btn ${isFav ? 'active' : ''}" data-link="${this.escapeHtml(torrent.magnetLink)}" data-index="${index}">
                            <i class="${isFav ? 'fas' : 'far'} fa-heart"></i>
                        </button>
                        <button class="play-btn" data-magnet="${this.escapeHtml(torrent.magnetLink)}" data-title="${this.escapeHtml(torrent.title)}" data-index="${index}">
                            <i class="fas fa-play"></i> Воспроизвести
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Добавляем обработчики
        container.querySelectorAll('.play-btn').forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                const magnetLink = btn.dataset.magnet;
                const title = btn.dataset.title;
                this.playTorrent(magnetLink, title);
            });
        });

        container.querySelectorAll('.favorite-btn').forEach((btn, idx) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const torrent = torrents[idx];
                this.toggleFavorite(torrent);
            });
        });

        this.updateFavoriteButtons();
    }

    renderFavorites() {
        const favoritesCount = document.getElementById('favoritesCount');
        const favoritesList = document.getElementById('favoritesList');
        
        favoritesCount.textContent = `${this.favorites.length} торрентов`;
        
        if (this.favorites.length === 0) {
            favoritesList.innerHTML = '<div class="empty-state"><i class="fas fa-heart"></i><h3>Нет сохраненных торрентов</h3><p>Нажмите на сердечко чтобы добавить торрент в избранное</p></div>';
            return;
        }

        this.renderTorrentList(this.favorites, favoritesList);
    }

    renderRecentlyWatched() {
        const recentCount = document.getElementById('recentCount');
        const recentList = document.getElementById('recentList');
        
        recentCount.textContent = `${this.recentlyWatched.length} торрентов`;
        
        if (this.recentlyWatched.length === 0) {
            recentList.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><h3>Нет недавно просмотренных</h3><p>Начните смотреть торренты, и они появятся здесь</p></div>';
            return;
        }

        this.renderTorrentList(this.recentlyWatched, recentList);
    }

    async playTorrent(magnetLink, title) {
        try {
            // Добавляем в недавно просмотренные
            this.addToRecentlyWatched({
                magnetLink: magnetLink,
                title: title,
                source: 'Unknown',
                tracker: 'Unknown',
                size: 'Unknown',
                date: new Date().toLocaleDateString(),
                seeds: 0,
                peers: 0
            });

            this.openModal(title);
            const modalBody = document.getElementById('modalBody');
            modalBody.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
            
            const response = await fetch('/api/play', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    magnetLink: magnetLink,
                    title: title
                })
            });

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            this.currentTorrent = { hash: result.hash, title: result.title || title };
            
            // Получаем список файлов
            await this.loadTorrentFiles(result.hash, title);

        } catch (error) {
            console.error('Play error:', error);
            const modalBody = document.getElementById('modalBody');
            modalBody.innerHTML = `<div class="error-message">Ошибка: ${error.message}</div>`;
        }
    }

    async loadTorrentFiles(hash, title) {
        const modalBody = document.getElementById('modalBody');

        try {
            modalBody.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <div style="font-size: 18px; margin-bottom: 10px;">⏳ Подготовка торрента...</div>
                    <div style="font-size: 14px; color: #aaa;">Пожалуйста, подождите. Это может занять до 30 секунд.</div>
                </div>
            `;
            
            const response = await fetch(`/api/torrent/files/${hash}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            if (!data.files || data.files.length === 0) {
                modalBody.innerHTML = '<div class="empty-state">Видео файлы не найдены</div>';
                return;
            }

            // Сохраняем список файлов для автоматического переключения серий
            this.currentTorrent.files = data.files;

            // Отображаем список файлов
            modalBody.innerHTML = `
                <div class="file-list-container">
                    <div class="file-list-header">
                        <h3>Выберите файл для воспроизведения:</h3>
                        <p class="file-count">${data.files.length} файлов</p>
                        <div style="margin-top: 10px; padding: 10px; background-color: #3a3a3a; border-radius: 5px; font-size: 0.85rem; color: #ffaa00;">
                            <i class="fas fa-info-circle"></i> <strong>Совет:</strong> Если видео не воспроизводится, попробуйте другую раздачу (избегайте AVI, выбирайте MP4/MKV с AAC аудио).
                        </div>
                    </div>
                    <div class="file-list">
                        ${data.files.map((file, index) => {
                            const isWatched = this.isEpisodeWatched(hash, index);
                            return `
                            <div class="file-item ${isWatched ? 'watched' : ''}" data-stream-url="${file.streamUrl}" data-m3u8-url="${file.m3u8Url || file.streamUrl}" data-transcode-url="${file.transcodeUrl || ''}" data-file-name="${this.escapeHtml(file.name)}" data-file-index="${index}">
                                <div class="file-info">
                                    <div class="file-number">${index + 1}</div>
                                    <div class="file-details">
                                        <div class="file-name">${this.escapeHtml(file.name)}</div>
                                        <div class="file-size">${file.sizeFormatted}${isWatched ? ' <i class="fas fa-check-circle" style="color: #4a9eff;"></i>' : ''}</div>
                                    </div>
                                </div>
                            <div class="file-actions">
                                <button class="file-play-btn" title="Воспроизвести">
                                    <i class="fas fa-play"></i>
                                </button>
                            </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>
            `;

            // Добавляем обработчики событий для кнопок воспроизведения
            modalBody.querySelectorAll('.file-play-btn').forEach((btn, index) => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const item = btn.closest('.file-item');
                    const streamUrl = item.dataset.streamUrl;
                    const m3u8Url = item.dataset.m3u8Url;
                    const transcodeUrl = item.dataset.transcodeUrl;
                    const fileName = item.dataset.fileName;
                    const fileIndex = parseInt(item.dataset.fileIndex);
                    
                    // Показываем индикатор проверки
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Проверка...';
                    btn.disabled = true;
                    
                    try {
                        // Проверяем кодек
                        const checkUrl = streamUrl.replace('/api/stream/', '/api/check-codec/');
                        console.log('🔍 Checking codec:', checkUrl);
                        
                        const response = await fetch(checkUrl);
                        const codecInfo = await response.json();
                        
                        console.log('📊 Codec info:', codecInfo);
                        
                        // Восстанавливаем кнопку
                        btn.innerHTML = originalHTML;
                        btn.disabled = false;
                        
                        // Решаем нужен ли транскодинг
                        if (codecInfo.needsTranscode) {
                            console.log(`🔄 ${codecInfo.reason}, switching to transcode`);
                            this.playFile(transcodeUrl, fileName, fileIndex, m3u8Url, true);
                        } else {
                            console.log(`✅ ${codecInfo.reason}, using direct stream`);
                            this.playFile(streamUrl, fileName, fileIndex, m3u8Url, false);
                        }
                    } catch (error) {
                        console.error('Codec check failed:', error);
                        // При ошибке пробуем прямой поток
                        btn.innerHTML = originalHTML;
                        btn.disabled = false;
                        this.playFile(streamUrl, fileName, fileIndex, m3u8Url, false);
                    }
                });
            });


        } catch (error) {
            console.error('Error loading files:', error);
            modalBody.innerHTML = `<div class="error-message">Не удалось загрузить список файлов: ${error.message}</div>`;
        }
    }

    playFile(streamUrl, fileName, index, m3u8Url, isTranscoded = false) {
        const modalBody = document.getElementById('modalBody');
        const modalTitle = document.getElementById('modalTitle');

        console.log('Playing file:', fileName, streamUrl, isTranscoded ? '(TRANSCODED)' : '(DIRECT)');
        console.log('M3U8 URL:', m3u8Url);

        this.currentStreamUrl = streamUrl;
        this.currentFileIndex = index; // Сохраняем текущий индекс
        this.currentIsTranscoded = isTranscoded; // Сохраняем режим
        modalTitle.textContent = `${this.currentTorrent.title} - ${fileName}${isTranscoded ? ' 🎵' : ''}`;

        // Уничтожаем предыдущий HLS экземпляр если есть
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // Отображаем видеоплеер с кнопками навигации
        const hasPrev = index > 0;
        const hasNext = this.currentTorrent.files && index < this.currentTorrent.files.length - 1;
        
        modalBody.innerHTML = `
            <div class="video-container">
                <video class="video-player" id="videoPlayer" controls>
                    Ваш браузер не поддерживает воспроизведение видео.
                </video>
                <div class="video-controls">
                    <button class="episode-nav-btn" id="prevEpisodeBtn" ${!hasPrev ? 'disabled' : ''}>
                        <i class="fas fa-step-backward"></i> Предыдущая
                    </button>
                    <div class="episode-info">
                        Серия ${index + 1} из ${this.currentTorrent.files ? this.currentTorrent.files.length : '?'}
                    </div>
                    <button class="episode-nav-btn" id="nextEpisodeBtn" ${!hasNext ? 'disabled' : ''}>
                        Следующая <i class="fas fa-step-forward"></i>
                    </button>
                </div>
            </div>
        `;

        const videoPlayer = document.getElementById('videoPlayer');
        
        // Проверяем сохраненную позицию воспроизведения
        const savedPosition = this.getPlaybackPosition(this.currentTorrent.hash, index);
        let startFromPosition = 0;
        
        if (savedPosition && !isTranscoded) {
            // Для прямого потока используем встроенный механизм
            startFromPosition = savedPosition.time;
            console.log(`⏩ Resuming from saved position: ${startFromPosition}s`);
        } else if (savedPosition && isTranscoded) {
            // Для транскодинга добавляем параметр seek в URL
            const baseUrl = streamUrl.split('?')[0];
            const params = new URLSearchParams(streamUrl.split('?')[1] || '');
            params.set('seek', savedPosition.time.toString());
            streamUrl = `${baseUrl}?${params.toString()}`;
            console.log(`⏩ Resuming transcoded stream from: ${savedPosition.time}s`);
        }
        
        // Используем ТОЛЬКО прямое воспроизведение, т.к. torrServer возвращает M3U (не M3U8)
        // HLS.js не работает с M3U плейлистами от torrServer
        console.log('Using direct video streaming via proxy');
        
        // Для транскодинга: пытаемся получить длительность из заголовка ответа
        if (isTranscoded) {
            fetch(streamUrl, { method: 'HEAD' })
                .then(response => {
                    const duration = response.headers.get('X-Video-Duration');
                    if (duration) {
                        const durationSeconds = parseInt(duration);
                        console.log(`📏 Got duration from server: ${durationSeconds}s (${Math.floor(durationSeconds/60)}:${(durationSeconds%60).toString().padStart(2,'0')})`);
                        
                        // Сохраняем только длительность, не трогая currentTime
                        const allPositions = this.loadPlaybackPositions();
                        const positionKey = `${this.currentTorrent.hash}_${index}`;
                        
                        if (allPositions[positionKey]) {
                            // Обновляем только duration, сохраняя существующий time
                            allPositions[positionKey].duration = durationSeconds;
                        } else {
                            // Создаем новую запись с duration
                            allPositions[positionKey] = {
                                time: 0,
                                isTranscoded: true,
                                timestamp: Date.now(),
                                duration: durationSeconds
                            };
                        }
                        
                        localStorage.setItem('playback_positions', JSON.stringify(allPositions));
                        console.log(`💾 Duration saved: ${durationSeconds}s for ${positionKey}`);
                    }
                })
                .catch(err => console.warn('Failed to get duration from header:', err));
        }
        
        videoPlayer.src = streamUrl;
        
        // Устанавливаем позицию для прямого потока
        if (startFromPosition > 0 && !isTranscoded) {
            videoPlayer.currentTime = startFromPosition;
        }
        
        videoPlayer.play().catch(error => {
            console.log('Autoplay prevented:', error);
        });
        
        // Периодически сохраняем позицию воспроизведения (каждые 10 секунд)
        let savePositionInterval = setInterval(() => {
            if (videoPlayer && !videoPlayer.paused && !videoPlayer.ended) {
                const currentTime = isTranscoded ? 
                    (videoPlayer.currentTime + (this.transcodeTimeOffset || 0)) : 
                    videoPlayer.currentTime;
                const duration = !isTranscoded && videoPlayer.duration > 0 ? videoPlayer.duration : null;
                this.savePlaybackPosition(this.currentTorrent.hash, index, currentTime, isTranscoded, duration);
            }
        }, 10000);
        
        // Сохраняем позицию при паузе
        videoPlayer.addEventListener('pause', () => {
            const currentTime = isTranscoded ? 
                (videoPlayer.currentTime + (this.transcodeTimeOffset || 0)) : 
                videoPlayer.currentTime;
            const duration = !isTranscoded && videoPlayer.duration > 0 ? videoPlayer.duration : null;
            this.savePlaybackPosition(this.currentTorrent.hash, index, currentTime, isTranscoded, duration);
        });
        
        // Отслеживаем прогресс просмотра
        let hasMarkedAsWatched = false; // Флаг чтобы не помечать несколько раз
        
        // Получаем реальную длительность видео (для транскодинга используем сохраненную)
        let videoDuration = null;
        
        videoPlayer.addEventListener('timeupdate', () => {
            // Для прямого потока используем videoPlayer.duration
            if (!isTranscoded && videoPlayer.duration > 0) {
                videoDuration = videoPlayer.duration;
                const progress = videoPlayer.currentTime / videoDuration;
                
                // Очищаем позицию когда видео досмотрено до конца (последние 30 секунд)
                if (videoDuration - videoPlayer.currentTime < 30) {
                    this.clearPlaybackPosition(this.currentTorrent.hash, index);
                }
                
                // Помечаем как просмотренную при достижении 90%
                if (progress >= 0.9 && !hasMarkedAsWatched) {
                    hasMarkedAsWatched = true;
                    this.markEpisodeAsWatched(this.currentTorrent.hash, index);
                    console.log(`✅ Episode marked as watched (90% progress): ${fileName}`);
                }
            }
            
            // Для транскодинга используем сохраненную длительность из localStorage
            if (isTranscoded) {
                if (!videoDuration) {
                    // Пытаемся получить длительность из сохраненных данных
                    const allPositions = this.loadPlaybackPositions();
                    const positionKey = `${this.currentTorrent.hash}_${index}`;
                    
                    // Если есть сохраненная длительность, используем её
                    if (allPositions[positionKey] && allPositions[positionKey].duration) {
                        videoDuration = allPositions[positionKey].duration;
                        console.log(`📏 Loaded duration from localStorage: ${Math.floor(videoDuration)}s for transcoded video`);
                    }
                }
                
                // Проверяем прогресс с учетом timeOffset
                if (videoDuration) {
                    const realTime = videoPlayer.currentTime + (this.transcodeTimeOffset || 0);
                    const progress = realTime / videoDuration;
                    
                    // Очищаем позицию когда видео досмотрено до конца (последние 30 секунд)
                    if (videoDuration - realTime < 30) {
                        this.clearPlaybackPosition(this.currentTorrent.hash, index);
                    }
                    
                    // Помечаем как просмотренную при достижении 90%
                    if (progress >= 0.9 && !hasMarkedAsWatched) {
                        hasMarkedAsWatched = true;
                        this.markEpisodeAsWatched(this.currentTorrent.hash, index);
                        console.log(`✅ Episode marked as watched (90% progress, transcoded): ${fileName}, realTime: ${Math.floor(realTime)}s / ${Math.floor(videoDuration)}s`);
                    }
                } else {
                    // Если длительности нет, выводим предупреждение раз в 10 секунд
                    if (Math.floor(videoPlayer.currentTime) % 10 === 0 && Math.floor(videoPlayer.currentTime) !== 0) {
                        console.warn(`⚠️ No duration available for transcoded video. Cannot calculate 90% progress. Play the video in direct mode first to save duration.`);
                    }
                }
            }
        });
        
        // Очищаем интервал при закрытии
        videoPlayer.addEventListener('ended', () => {
            clearInterval(savePositionInterval);
            this.clearPlaybackPosition(this.currentTorrent.hash, index);
        });
        
        // Сохраняем ссылку на интервал для очистки
        this.savePositionInterval = savePositionInterval;
        
        // Обработчики событий для отладки
        videoPlayer.onerror = (e) => {
            console.error('Video error:', e, videoPlayer.error);
            if (videoPlayer.error) {
                let errorMessage = 'Ошибка воспроизведения: ';
                const errorCode = videoPlayer.error.code;
                
                switch (errorCode) {
                    case 1:
                        errorMessage += 'Загрузка прервана';
                        break;
                    case 2:
                        errorMessage += 'Сетевая ошибка';
                        break;
                    case 3:
                        errorMessage += 'Ошибка декодирования';
                        break;
                    case 4:
                        errorMessage += 'Формат не поддерживается';
                        break;
                    default:
                        errorMessage += 'Неизвестная ошибка';
                }
                console.error(errorMessage);
                
                // Автоматическое переключение на транскодинг при ошибках декодирования или формата
                if (!isTranscoded && (errorCode === 3 || errorCode === 4)) {
                    console.log('🔄 Автоматическое переключение на транскодинг...');
                    
                    // Получаем transcodeUrl из текущего файла
                    const currentFile = this.currentTorrent.files[index];
                    if (currentFile && currentFile.transcodeUrl) {
                        // Показываем уведомление
                        const modalTitle = document.getElementById('modalTitle');
                        modalTitle.textContent = `${this.currentTorrent.title} - ${fileName} 🔄 Переключение на транскодинг...`;
                        
                        // Перезапускаем с транскодингом
                        setTimeout(() => {
                            this.playFile(currentFile.transcodeUrl, fileName, index, m3u8Url, true);
                        }, 1000);
                    } else {
                        console.error('❌ TranscodeUrl not available');
                    }
                }
            }
        };

        // Автоматическое переключение на следующую серию
        videoPlayer.onended = () => {
            console.log('Video ended, checking for next episode...');
            this.playNextEpisode();
        };

        // Обработчики для кнопок навигации между сериями
        const prevBtn = document.getElementById('prevEpisodeBtn');
        const nextBtn = document.getElementById('nextEpisodeBtn');

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.playPreviousEpisode();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.playNextEpisode();
            });
        }

        // Если транскодинг - добавляем контролы перемотки
        if (isTranscoded) {
            this.addTranscodeControls(videoPlayer, streamUrl);
        }
    }

    addTranscodeControls(videoPlayer, baseStreamUrl) {
        console.log('🎬 Adding transcode controls');
        
        // Проверяем сохраненную позицию для установки начального offset
        const savedPosition = this.getPlaybackPosition(this.currentTorrent.hash, this.currentFileIndex);
        let timeOffset = savedPosition ? savedPosition.time : 0;
        this.transcodeTimeOffset = timeOffset; // Сохраняем в this для доступа из других функций
        
        const videoContainer = videoPlayer.parentElement;
        videoContainer.style.position = 'relative';
        
        // 1. Индикатор времени в правом верхнем углу
        const timeOverlay = document.createElement('div');
        timeOverlay.className = 'time-overlay';
        timeOverlay.textContent = '0:00';
        videoContainer.appendChild(timeOverlay);
        
        // Обновляем индикатор времени
        videoPlayer.addEventListener('timeupdate', () => {
            const currentTime = videoPlayer.currentTime;
            const realTime = Math.floor(currentTime + timeOffset);
            const hours = Math.floor(realTime / 3600);
            const minutes = Math.floor((realTime % 3600) / 60);
            const seconds = realTime % 60;
            
            const timeString = hours > 0 
                ? `${hours}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`
                : `${minutes}:${seconds.toString().padStart(2,'0')}`;
            
            timeOverlay.textContent = timeString;
            
            // Отладка (показываем раз в 5 секунд)
            if (Math.floor(currentTime) % 5 === 0 && Math.floor(currentTime) !== 0) {
                console.log(`⏱️ currentTime: ${Math.floor(currentTime)}s, timeOffset: ${timeOffset}s, realTime: ${realTime}s (${timeString})`);
            }
        });
        
        // 2. Контролы перемотки под видео
        const seekControls = document.createElement('div');
        seekControls.className = 'transcode-seek-controls';
        seekControls.innerHTML = `
            <div class="seek-input-wrapper">
                <label for="seekMinutesInput">Перейти на минуту:</label>
                <input type="number" id="seekMinutesInput" min="0" step="1" placeholder="0" />
                <button class="seek-go-button">
                    <i class="fas fa-play"></i> Перейти
                </button>
            </div>
        `;
        
        videoContainer.appendChild(seekControls);
        
        // Обработчик кнопки перехода
        const seekButton = seekControls.querySelector('.seek-go-button');
        const seekInput = seekControls.querySelector('#seekMinutesInput');
        
        const performSeek = () => {
            const minutes = parseInt(seekInput.value) || 0;
            const seekTime = minutes * 60;
            
            console.log(`🎯 Seeking to ${minutes} min (${seekTime}s)`);
            
            // Формируем новый URL с параметром seek
            const baseUrl = baseStreamUrl.split('?')[0];
            const params = new URLSearchParams(baseStreamUrl.split('?')[1] || '');
            params.set('seek', seekTime.toString());
            const newUrl = `${baseUrl}?${params.toString()}`;
            
            console.log(`📡 New URL: ${newUrl}`);
            console.log(`⏰ Setting timeOffset to ${seekTime}s (${minutes} min)`);
            
            // Показываем загрузку
            videoPlayer.style.opacity = '0.5';
            
            // Перезагружаем поток
            videoPlayer.src = newUrl;
            videoPlayer.load();
            
            // ВАЖНО: Обновляем offset ПОСЛЕ установки src
            timeOffset = seekTime;
            this.transcodeTimeOffset = timeOffset; // Обновляем в this
            
            videoPlayer.onloadeddata = () => {
                console.log(`✅ Loaded from ${minutes} min, timeOffset = ${timeOffset}s`);
                videoPlayer.style.opacity = '1';
                videoPlayer.play().catch(err => console.log('Play error:', err));
                videoPlayer.onloadeddata = null;
            };
        };
        
        seekButton.addEventListener('click', performSeek);
        
        // Enter в поле = переход
        seekInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSeek();
            }
        });
    }

    playPreviousEpisode() {
        if (!this.currentTorrent || !this.currentTorrent.files) {
            console.log('No current torrent or files available');
            return;
        }

        const currentIndex = this.currentFileIndex;
        const prevIndex = currentIndex - 1;

        if (prevIndex >= 0) {
            const prevFile = this.currentTorrent.files[prevIndex];
            console.log(`Playing previous episode: ${prevFile.name}`);
            
            // Воспроизводим предыдущую серию в том же режиме (транскодирование или прямой поток)
            const url = this.currentIsTranscoded ? prevFile.transcodeUrl : prevFile.streamUrl;
            this.playFile(url, prevFile.name, prevIndex, prevFile.m3u8Url, this.currentIsTranscoded);
        } else {
            console.log('This is the first episode');
        }
    }

    playNextEpisode() {
        if (!this.currentTorrent || !this.currentTorrent.files) {
            console.log('No current torrent or files available');
            return;
        }

        const currentIndex = this.currentFileIndex;
        const nextIndex = currentIndex + 1;

        // Отмечаем текущую серию как просмотренную
        if (this.currentTorrent && this.currentTorrent.hash) {
            this.markEpisodeAsWatched(this.currentTorrent.hash, currentIndex);
        }

        if (nextIndex < this.currentTorrent.files.length) {
            const nextFile = this.currentTorrent.files[nextIndex];
            console.log(`Auto-playing next episode: ${nextFile.name}`);
            
            // Воспроизводим следующую серию в том же режиме (транскодирование или прямой поток)
            const url = this.currentIsTranscoded ? nextFile.transcodeUrl : nextFile.streamUrl;
            this.playFile(url, nextFile.name, nextIndex, nextFile.m3u8Url, this.currentIsTranscoded);
        } else {
            console.log('No more episodes, this was the last one');
            
            // Показываем сообщение что это была последняя серия
            const modalBody = document.getElementById('modalBody');
            modalBody.innerHTML = `
                <div class="success-message" style="text-align: center; padding: 60px 20px;">
                    <i class="fas fa-check-circle" style="font-size: 4rem; margin-bottom: 20px;"></i>
                    <h3>Вы досмотрели все серии!</h3>
                    <p>Это была последняя доступная серия.</p>
                </div>
            `;
        }
    }

    openModal(title) {
        const modalOverlay = document.getElementById('modalOverlay');
        const modalTitle = document.getElementById('modalTitle');
        
        modalTitle.textContent = title;
        modalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    async closeModal() {
        const modalOverlay = document.getElementById('modalOverlay');
        const modalBody = document.getElementById('modalBody');
        
        // Очищаем интервал сохранения позиции
        if (this.savePositionInterval) {
            clearInterval(this.savePositionInterval);
            this.savePositionInterval = null;
        }
        
        // Останавливаем видео и сохраняем последнюю позицию
        const videoPlayer = document.getElementById('videoPlayer');
        if (videoPlayer && this.currentTorrent) {
            const currentTime = this.currentIsTranscoded ? 
                (videoPlayer.currentTime + (this.transcodeTimeOffset || 0)) : 
                videoPlayer.currentTime;
            this.savePlaybackPosition(this.currentTorrent.hash, this.currentFileIndex, currentTime, this.currentIsTranscoded);
            videoPlayer.pause();
            videoPlayer.onerror = null; // Удаляем обработчик ошибок перед очисткой src
            videoPlayer.src = '';
        }

        // Уничтожаем HLS экземпляр если есть
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // Если есть текущий торрент, удаляем его с torrServer
        if (this.currentTorrent) {
            try {
                console.log('Removing torrent from torrServer:', this.currentTorrent.hash);
                await fetch(`/api/torrent/remove/${this.currentTorrent.hash}`, {
                    method: 'DELETE'
                });
                console.log('Torrent removed successfully');
            } catch (error) {
                console.error('Error removing torrent:', error);
            }
            this.currentTorrent = null;
        }

        modalOverlay.classList.remove('active');
        modalBody.innerHTML = '';
        document.body.style.overflow = '';
        this.currentStreamUrl = null;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Инициализируем приложение
const app = new TorrentApp();
