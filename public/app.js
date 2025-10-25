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
                            <i class="fas fa-info-circle"></i> <strong>Совет:</strong> Если нет звука, попробуйте другую раздачу (избегайте AVI, выбирайте MP4/MKV с AAC аудио).
                        </div>
                    </div>
                    <div class="file-list">
                        ${data.files.map((file, index) => `
                            <div class="file-item" data-stream-url="${file.streamUrl}" data-m3u8-url="${file.m3u8Url || file.streamUrl}" data-file-name="${this.escapeHtml(file.name)}" data-file-index="${index}">
                                <div class="file-info">
                                    <div class="file-number">${index + 1}</div>
                                    <div class="file-details">
                                        <div class="file-name">${this.escapeHtml(file.name)}</div>
                                        <div class="file-size">${file.sizeFormatted}</div>
                                    </div>
                                </div>
                                <button class="file-play-btn">
                                    <i class="fas fa-play"></i>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Добавляем обработчики событий для файлов
            modalBody.querySelectorAll('.file-item').forEach(item => {
                item.addEventListener('click', () => {
                    const streamUrl = item.dataset.streamUrl;
                    const m3u8Url = item.dataset.m3u8Url;
                    const fileName = item.dataset.fileName;
                    const fileIndex = parseInt(item.dataset.fileIndex);
                    this.playFile(streamUrl, fileName, fileIndex, m3u8Url);
                });
            });

            // Если только один файл, автоматически начинаем воспроизведение
            if (data.files.length === 1) {
                setTimeout(() => this.playFile(data.files[0].streamUrl, data.files[0].name, 0, data.files[0].m3u8Url), 500);
            }

        } catch (error) {
            console.error('Error loading files:', error);
            modalBody.innerHTML = `<div class="error-message">Не удалось загрузить список файлов: ${error.message}</div>`;
        }
    }

    playFile(streamUrl, fileName, index, m3u8Url) {
        const modalBody = document.getElementById('modalBody');
        const modalTitle = document.getElementById('modalTitle');

        console.log('Playing file:', fileName, streamUrl);
        console.log('M3U8 URL:', m3u8Url);

        this.currentStreamUrl = streamUrl;
        this.currentFileIndex = index; // Сохраняем текущий индекс
        modalTitle.textContent = `${this.currentTorrent.title} - ${fileName}`;

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
        
        // Используем ТОЛЬКО прямое воспроизведение, т.к. torrServer возвращает M3U (не M3U8)
        // HLS.js не работает с M3U плейлистами от torrServer
        console.log('Using direct video streaming via proxy');
        videoPlayer.src = streamUrl;
        videoPlayer.play().catch(error => {
            console.log('Autoplay prevented:', error);
        });
        
        // Обработчики событий для отладки
        videoPlayer.onerror = (e) => {
            console.error('Video error:', e, videoPlayer.error);
            if (videoPlayer.error) {
                let errorMessage = 'Ошибка воспроизведения: ';
                switch (videoPlayer.error.code) {
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
            
            // Воспроизводим предыдущую серию
            this.playFile(prevFile.streamUrl, prevFile.name, prevIndex, prevFile.m3u8Url);
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

        if (nextIndex < this.currentTorrent.files.length) {
            const nextFile = this.currentTorrent.files[nextIndex];
            console.log(`Auto-playing next episode: ${nextFile.name}`);
            
            // Воспроизводим следующую серию
            this.playFile(nextFile.streamUrl, nextFile.name, nextIndex, nextFile.m3u8Url);
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
        
        // Останавливаем видео
        const videoPlayer = document.getElementById('videoPlayer');
        if (videoPlayer) {
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
