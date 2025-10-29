# Исправление: Длинные названия файлов скрывали кнопку "Плей"

## Проблема

При длинных названиях файлов типа:
```
La.Disparue.De.Compostelle.s01.WEBRip.XviD.Rus.RuDub.tv/La.Disparue.De.Compostelle.s01e01.WEBRip.XviD.Rus.RuDub.tv.avi
```

Название выходило за пределы контейнера и выталкивало кнопку "Плей" за пределы видимости.

## Причина

Flexbox элементы не имели правильных ограничений на сжатие:
- `.file-details` мог занимать всё пространство
- `.file-actions` мог сжиматься и уходить за пределы
- Не было `min-width: 0` для корректного overflow

## Решение

### 1. Фиксированная ширина для кнопок

```css
.file-actions {
    display: flex;
    gap: 10px;
    flex-shrink: 0; /* Предотвращаем сжатие кнопок */
    margin-left: 10px; /* Отступ от названия */
}

.file-play-btn {
    /* ... */
    white-space: nowrap; /* Текст кнопки не переносится */
    flex-shrink: 0; /* Кнопка не сжимается */
}
```

### 2. Правильное сжатие текстовой части

```css
.file-info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 15px;
    padding-bottom: 8px;
    min-width: 0; /* Позволяет сжиматься */
    overflow: hidden; /* Обрезаем контент */
}

.file-details {
    flex: 1;
    min-width: 0; /* Позволяет flex-элементу сжиматься меньше содержимого */
    overflow: hidden; /* Обрезаем выходящий контент */
}
```

### 3. Фиксированный номер серии

```css
.file-number {
    /* ... */
    flex-shrink: 0; /* Номер не сжимается */
}
```

### 4. Правильная обрезка названия

```css
.file-name {
    font-size: 0.95rem;
    font-weight: 500;
    color: #fff;
    margin-bottom: 4px;
    word-wrap: break-word;
    overflow-wrap: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2; /* Стандартное свойство */
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-overflow: ellipsis;
}
```

## Результат

### До исправления:
```
[1] La.Disparue.De.Compostelle.s01.WEBRip.XviD.Rus.RuDub.tv.avi [кнопка уехала вправо →→→]
```

### После исправления:
```
[1] La.Disparue.De.Compostel...  [▶️ Плей]
    le.s01.WEBRip.XviD.Rus.Ru...
```

Название обрезается до 2 строк с многоточием, кнопка "Плей" всегда видна справа.

## Файлы изменены

- `public/index.html` - CSS стили для `.file-item`, `.file-info`, `.file-details`, `.file-actions`, `.file-play-btn`, `.file-number`

## Дата исправления

29 октября 2025

## Статус

✅ **ИСПРАВЛЕНО** - Кнопка "Плей" теперь всегда видна, независимо от длины названия файла

