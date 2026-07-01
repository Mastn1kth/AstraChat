Сделай полноценный Telegram-подобный мессенджер. Не копировать название Telegram, логотип, фирменные иконки и бренд напрямую. Нужно сделать самостоятельный продукт, но по логике, структуре, UX и набору функций максимально близкий к Telegram.

Это не лендинг. Первым экраном должно быть само приложение.

Цель:
Создать масштабируемый мессенджер с личными чатами, группами, каналами, стикерами, реакциями, медиа, звонками, настройками, темами, уведомлениями, поиском, профилями, безопасностью и архитектурой, готовой к backend, WebSocket, базе данных, файлам и production-развитию.

Основные разделы приложения:
- экран авторизации;
- основной список чатов;
- личные чаты;
- группы;
- супергруппы;
- каналы;
- обсуждения каналов;
- сохраненные сообщения;
- архив;
- папки чатов;
- контакты;
- звонки;
- настройки;
- профиль пользователя;
- профиль собеседника;
- профиль группы;
- профиль канала;
- медиагалерея чата;
- поиск;
- панель стикеров/эмодзи/GIF;
- модальные окна создания чатов, групп, каналов;
- админские настройки групп и каналов.

Авторизация:
- вход по номеру телефона;
- ввод кода подтверждения;
- повторная отправка кода;
- вход по QR-коду;
- двухфакторный пароль;
- восстановление доступа;
- создание профиля после первого входа;
- имя, фамилия, username, аватар, bio;
- управление активными сессиями;
- список устройств;
- завершение сессии;
- выход из аккаунта;
- удаление аккаунта;
- блокировка приложения паролем/биометрией как UI-сценарий.

Главный интерфейс:
- левый сайдбар со списком чатов;
- верхняя панель с кнопкой меню;
- поиск по чатам;
- фильтры/папки чатов;
- список чатов с аватаром, названием, последним сообщением, временем, статусом доставки, счетчиком непрочитанных;
- индикаторы pinned, muted, archived, verified;
- выбранный чат подсвечивается;
- справа область переписки;
- адаптивный мобильный режим: список чатов и чат открываются отдельными экранами;
- поддержка светлой и темной темы.

Личные чаты:
- отправка текстовых сообщений;
- входящие и исходящие сообщения;
- время сообщения;
- статусы: отправляется, отправлено, доставлено, прочитано;
- typing indicator;
- online/offline/last seen;
- reply на сообщение;
- quote/цитирование части сообщения;
- forward;
- edit своего сообщения;
- delete for me;
- delete for everyone;
- copy text;
- pin message;
- реакции;
- выбор нескольких сообщений;
- пересылка выбранных сообщений;
- очистка истории;
- экспорт истории как UI-сценарий;
- mute/unmute;
- block user;
- report user;
- поиск внутри чата;
- медиагалерея;
- общие ссылки;
- общие файлы;
- голосовые сообщения;
- видеосообщения;
- вложения;
- drag-and-drop файлов;
- предпросмотр ссылок;
- черновики сообщений;
- scheduled messages;
- silent messages;
- disappearing messages как отдельная настройка;

Группы:
- создание группы;
- добавление участников;
- удаление участников;
- роли: owner, admin, moderator, member;
- права админов;
- права участников;
- публичная/приватная группа;
- invite link;
- join requests;
- список участников;
- поиск участников;
- описание группы;
- аватар группы;
- закрепленные сообщения;
- правила группы;
- slow mode;
- anti-spam настройки;
- mute группы;
- report message/user;
- ban/kick;
- temporary ban;
- история действий админов;
- упоминания через @username;
- mention всех админов;
- replies;
- threads/topics;
- отдельные темы внутри группы;
- счетчики непрочитанных по темам;
- pinned topic;
- закрытие/открытие темы;
- polls;
- quiz polls;
- реакции;
- медиа;
- файлы;
- голосовые сообщения;
- групповые звонки;
- видеочаты;
- демонстрация экрана как UI-сценарий.

Каналы:
- создание канала;
- публичный/приватный канал;
- username канала;
- invite link;
- подписчики;
- админы канала;
- роли и права админов;
- публикация постов;
- редактирование постов;
- удаление постов;
- отложенные посты;
- тихие посты;
- закрепленные посты;
- реакции к постам;
- просмотры постов;
- счетчик репостов;
- подпись автора поста;
- комментарии через привязанную группу обсуждений;
- статистика канала;
- рост подписчиков;
- охват постов;
- публичные ссылки на посты;
- пересылка постов;
- защита от копирования как настройка;
- модерация комментариев.

Сообщения:
- plain text;
- multiline text;
- форматирование: bold, italic, underline, strikethrough, spoiler, code, pre/code block, quote;
- ссылки;
- link preview;
- отключение link preview;
- emoji;
- custom emoji;
- stickers;
- animated stickers;
- video stickers;
- GIF;
- фото;
- видео;
- альбомы;
- файлы;
- документы;
- аудио;
- voice message;
- video message;
- location;
- live location;
- contact card;
- poll;
- quiz;
- service messages: user joined, user left, pinned message, changed photo, changed title;
- reactions;
- message read status;
- message selection;
- context menu;
- message search;
- jump to message;
- scroll to bottom;
- unread separator;
- date separators.

Стикеры, эмодзи и GIF:
- панель эмодзи;
- поиск эмодзи;
- категории эмодзи;
- recent emoji;
- favorite emoji;
- custom emoji;
- панель стикеров;
- sticker packs;
- animated stickers;
- video stickers;
- favorite stickers;
- recent stickers;
- установка sticker pack;
- удаление sticker pack;
- поиск стикеров;
- recommended/trending sticker packs;
- GIF search;
- recent GIFs;
- отправка GIF;
- реакции на основе emoji/custom emoji;

Вложения и медиа:
- кнопка attach;
- выбор фото;
- выбор видео;
- выбор файла;
- выбор контакта;
- выбор геолокации;
- предпросмотр перед отправкой;
- подпись к медиа;
- отправка альбомом;
- прогресс загрузки;
- отмена загрузки;
- скачивание;
- download manager;
- просмотр фото в lightbox;
- просмотр видео;
- аудиоплеер;
- voice player;
- waveform для голосовых;
- скорость воспроизведения;
- мини-плеер;
- галерея медиа в профиле чата;
- shared files;
- shared links;
- shared voice/audio.

Звонки:
- личный аудиозвонок;
- личный видеозвонок;
- входящий звонок;
- исходящий звонок;
- принять/отклонить;
- mute microphone;
- camera on/off;
- speaker;
- screen sharing как UI;
- group voice chat;
- group video chat;
- участники звонка;
- качество соединения;
- история звонков.
Если backend/WebRTC пока не реализован, сделать интерфейс и состояния, но честно пометить как mock.

Истории:
- stories пользователя;
- stories контактов;
- список stories сверху;
- просмотр story;
- фото/video story;
- текст/emoji overlay как UI;
- реакции на story;
- reply на story;
- privacy stories: everyone, contacts, close friends, selected users;
- скрытие stories;
- архив stories;
- истечение stories по времени.
Если stories не реализуются полноценно на первом этапе, сделать UI и локальную имитацию.

Вне продукта:
- bot accounts, Bot API, inline bots, bot keyboards, bot callbacks и bot payment flows не реализуются и не планируются;
- mini apps, WebView apps, JS bridge, mini-app permissions и mini-app меню не реализуются и не планируются.
- платежи, Stars, Premium-монетизация, paid subscriptions, paid media, подарки, цифровые товары, internal balance, транзакции и checkout flows не реализуются и не планируются.

Контакты:
- список контактов;
- поиск контактов;
- добавление контакта;
- удаление контакта;
- импорт контактов как mock;
- приглашение пользователя;
- username search;
- people nearby как опциональный mock;
- blocked users;
- настройки видимости телефона.

Профиль пользователя:
- avatar;
- first name;
- last name;
- username;
- bio;
- phone;
- online status;
- настройка аватара;
- несколько фото профиля как UI;
- emoji status;
- дата рождения как optional;
- privacy controls.

Профиль чата/собеседника:
- аватар;
- имя;
- username;
- phone если доступен;
- bio;
- online/last seen;
- shared media;
- shared files;
- shared links;
- notifications;
- block/report;
- delete chat;
- clear history;
- call/video call buttons.

Настройки:
- edit profile;
- notifications and sounds;
- privacy and security;
- data and storage;
- chat folders;
- devices;
- language;
- appearance;
- theme;
- dark/light/system mode;
- font size;
- message bubble style;
- wallpapers;
- stickers and emoji;
- help/FAQ;
- logout.

Приватность и безопасность:
- who can see phone number;
- who can see last seen;
- who can see profile photo;
- who can call me;
- who can add me to groups/channels;
- blocked users;
- two-step verification;
- passcode lock;
- active sessions;
- disappearing messages;
- report spam;
- rate limits;
- suspicious login alert.

Поиск:
- глобальный поиск по чатам;
- поиск пользователей;
- поиск групп;
- поиск каналов;
- поиск сообщений;
- фильтр по медиа;
- фильтр по файлам;
- фильтр по ссылкам;
- фильтр по дате;
- поиск внутри конкретного чата;
- подсветка найденного текста;
- переход к найденному сообщению.

Папки и архив:
- All chats;
- Unread;
- Personal;
- Groups;
- Channels;
- Bots;
- Archived;
- Custom folders;
- создание папки;
- редактирование папки;
- включение/исключение чатов из папки;
- archived chats;
- pinned chats внутри папок.

Уведомления:
- unread counters;
- mute chat;
- mute until date;
- notification settings per chat;
- sound settings как UI;
- desktop notifications как optional;
- push notifications через backend в будущем;
- mentions counter;
- replies counter.

Админка и модерация:
- admin panel для системного администратора;
- список пользователей;
- поиск пользователя;
- блокировка пользователя;
- жалобы;
- просмотр reported messages;
- управление публичными каналами/группами;
- антиспам;
- rate limit config;
- audit log;
- системные метрики.
Не показывать эту админку обычному пользователю.

Backend-архитектура:
- REST API или GraphQL для базовых операций;
- WebSocket для real-time сообщений;
- база данных для пользователей, чатов, участников, сообщений, реакций, файлов, настроек;
- object storage для файлов;
- CDN для медиа;
- Redis/cache для online status, typing status, sessions, rate limits;
- message queue для фоновых задач;
- push notification service;
- idempotency keys для отправки сообщений;
- pagination/cursor для истории сообщений;
- optimistic UI;
- retry отправки;
- offline queue;
- conflict resolution для редактирования/удаления;
- soft delete сообщений;
- audit logs для админских действий.

Модели данных:
- User;
- Session;
- Contact;
- Chat;
- PrivateChat;
- Group;
- Channel;
- Topic;
- ChatMember;
- Message;
- MessageAttachment;
- MessageReaction;
- StickerPack;
- Sticker;
- Emoji;
- Poll;
- Call;
- NotificationSetting;
- Folder;
- InviteLink;
- Report;

UI/UX требования:
- интерфейс похож по структуре на Telegram;
- не делать маркетинговый hero;
- не делать декоративные блоки вместо приложения;
- быстрый, плотный, рабочий интерфейс;
- аккуратные hover/active/focus состояния;
- плавные переходы;
- нормальная пустая область, если чат не выбран;
- empty state для поиска;
- skeleton/loading states;
- error states;
- toast notifications;
- context menus;
- keyboard shortcuts;
- drag-and-drop файлов;
- responsive desktop/tablet/mobile;
- на мобильном: список чатов и чат отдельными экранами;
- не должно быть placeholder-ощущения.

Технологии:
- frontend: React + Vite;
- TypeScript желательно;
- state management: Zustand/Redux Toolkit или аккуратный local state на MVP;
- routing: React Router;
- icons: lucide-react или аналог;
- styling: CSS Modules/Tailwind/plain CSS, но единая дизайн-система;
- backend: Node.js/NestJS/Express или другой выбранный стек;
- database: PostgreSQL;
- realtime: WebSocket;
- storage: S3-compatible;
- auth: JWT + refresh tokens/sessions;
- tests: unit + integration + e2e.

Компоненты frontend:
- AppShell;
- AuthScreen;
- Sidebar;
- MainMenu;
- ChatFolders;
- ChatList;
- ChatItem;
- ChatWindow;
- ChatHeader;
- MessageList;
- MessageBubble;
- MessageContextMenu;
- Composer;
- AttachmentMenu;
- EmojiStickerGifPanel;
- SearchPanel;
- ProfilePanel;
- GroupProfilePanel;
- ChannelProfilePanel;
- SettingsModal;
- ContactsModal;
- CreateGroupModal;
- CreateChannelModal;
- CallModal;
- StoryViewer;
- MediaViewer;
- AdminPanel.

Что обязательно работает хотя бы локально в MVP:
- переключение чатов;
- отправка сообщений;
- редактирование сообщений;
- удаление сообщений;
- ответы;
- реакции;
- поиск по чатам;
- поиск по сообщениям;
- создание личного чата;
- создание группы;
- создание канала;
- отправка стикера;
- отправка emoji;
- mock-вложение;
- закрепление чата;
- архивирование чата;
- mute/unmute;
- смена темы;
- открытие профиля;
- открытие настроек;
- мобильная адаптация.

Что можно имитировать, если нет backend:
- звонки;
- видеозвонки;
- real-time от других пользователей;
- загрузка файлов;
- push notifications;
- stories;
- импорт контактов.

Важно:
- если функция требует backend, WebRTC, шифрования или внешнего API, не врать, что она реально работает;
- сделать UI, состояние и архитектурную заготовку;
- явно разделить реальные функции и mock-функции;
- код должен быть расширяемым;
- не делать один огромный компонент;
- не использовать бренд Telegram напрямую;
- не обещать production-безопасность без настоящей реализации.

После выполнения подробно объяснить:
- что сделано;
- какие функции реально работают;
- какие функции являются mock;
- как устроена структура проекта;
- почему выбрана такая архитектура;
- какие модели данных нужны;
- какой backend нужен дальше;
- какие риски есть;
- что делать следующим этапом.
