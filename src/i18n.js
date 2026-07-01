// src/i18n.js
// Lightweight i18n for Onda — RU / EN, default Russian, persisted to localStorage.
// Exports: LANGUAGES, getLang, setLang, useLang, useT, t
import { useSyncExternalStore } from 'react'

export const LANGUAGES = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
]

const STORAGE_KEY = 'onda.lang'
const DEFAULT_LANG = 'ru'

function readInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && LANGUAGES.some((l) => l.id === saved)) return saved
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG
}

let currentLang = readInitialLang()
const listeners = new Set()

export function getLang() {
  return currentLang
}

export function setLang(lang) {
  if (!LANGUAGES.some((l) => l.id === lang)) return
  if (lang === currentLang) return
  currentLang = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', lang)
  }
  listeners.forEach((fn) => fn(lang))
}

// React hook: re-renders the calling component when language changes.
export function useLang() {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange)
      return () => listeners.delete(onStoreChange)
    },
    () => currentLang,
    () => currentLang,
  )
}

// Translate a key with optional {placeholder} interpolation.
export function t(key, vars) {
  const table = DICT[currentLang] || DICT[DEFAULT_LANG]
  let str = table[key]
  if (str == null) str = (DICT.en && DICT.en[key]) != null ? DICT.en[key] : key
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]))
    }
  }
  return str
}

// React hook: returns a `t` bound to the current language and reactive to changes.
export function useT() {
  useLang() // subscribe for re-render
  return t
}

// ---------------------------------------------------------------------------
// Dictionary
// ---------------------------------------------------------------------------
const DICT = {
  ru: {
    // --- Auth screen ---
    'auth.langPick': 'Язык интерфейса',
    'auth.signin': 'Войти',
    'auth.register': 'Регистрация',
    'auth.totpTitle': 'Двухфакторная защита',
    'auth.totpCode': 'Код из приложения',
    'auth.back': 'Назад',
    'auth.checking': 'Проверяем…',
    'auth.verify': 'Подтвердить',
    'auth.username': 'Имя пользователя',
    'auth.next': 'Далее',
    'auth.name': 'Имя',
    'auth.password': 'Пароль',
    'auth.confirmPassword': 'Повторите пароль',
    'auth.passwordMin': 'Пароль должен быть не короче 10 символов.',
    'auth.passwordMismatch': 'Пароли не совпадают.',
    'auth.hidePassword': 'Скрыть пароль',
    'auth.showPassword': 'Показать пароль',
    'auth.wait': 'Подождите…',
    'auth.createAccount': 'Создать аккаунт',
    'auth.foot': 'Личные сообщения и медиа шифруются перед хранением.',
    'auth.headline1': 'Мессенджер,',
    'auth.headline2': 'который',
    'auth.headlineEm': 'уважает',
    'auth.headline3': 'ваше',
    'auth.headline4': 'внимание.',
    'auth.sub': 'Приватный по умолчанию. Тихий по задумке. Войдите и продолжите беседы с того места, где остановились.',
    'auth.loginPlaceholder': 'Телефон или @юзернейм',
    'auth.or': 'или',
    'auth.privacy': 'Политика конфиденциальности',
    // --- Phone-first auth flow ---
    'auth.phoneEm': 'сначала телефон',
    'auth.phoneNoun': 'мессенджер.',
    'auth.phoneSub': 'Введите номер телефона — Onda пришлёт код для входа.',
    'auth.phonePlaceholder': 'Номер телефона',
    'auth.sendCode': 'Отправить код',
    'auth.continue': 'Продолжить',
    'auth.changePhone': 'Изменить номер',
    'auth.enterCode': 'Введите код',
    'auth.codeForPhone': 'Код для {phone}',
    'auth.codePush': 'Уведомление с кодом отправлено на это устройство.',
    'auth.devCode': 'Локальный dev-код:',
    'auth.loginWithPassword': 'Вход по паролю',
    'auth.loginWithPhone': 'Войти по номеру телефона',
    'auth.passwordLogin': 'Войти',
    'auth.loginOrUsername': 'Логин или @юзернейм',
    'auth.qrLogin': 'Вход по QR-коду',
    'auth.qrScanTitle': 'Войдите через QR-код',
    'auth.qrScanHint': 'Откройте Onda на другом устройстве и отсканируйте этот код.',
    'auth.qrGenerating': 'Генерация кода…',
    'auth.qrFailed': 'Не удалось создать QR',
    'auth.qrExpired': 'QR-код истёк',
    'auth.qrConfirmed': 'Подтверждено',
    'auth.qrRefresh': 'Обновить',
    'auth.qrWaiting': 'Ожидаем сканирования…',
    'auth.qrStep1': 'Откройте Onda на другом устройстве',
    'auth.qrStep2': 'Перейдите в Настройки → Устройства',
    'auth.profileTitle': 'Создание профиля',
    'auth.backToCode': 'Назад к коду',
    'auth.nickname': 'Никнейм',
    'auth.usernamePlaceholder': 'юзернейм',
    'auth.cloudTitle': 'Двухэтапная проверка',
    'auth.cloudHint': 'Подсказка:',
    'auth.cloudPlaceholder': 'Облачный пароль',
    'auth.previewName1': 'Нина Парк',
    'auth.previewText1': 'Профиль готов. Глянешь?',
    'auth.previewName2': 'Вы',
    'auth.previewText2': 'Уже здесь. Тихо и чисто.',
    'auth.previewName3': 'Гильдия дизайна',
    'auth.previewText3': 'Новая ветка запущена.',

    // --- Settings ---
    'set.language': 'Язык',

    // --- Main menu ---
    'menu.newPrivateChat': 'Новый чат',
    'menu.newGroup': 'Новая группа',
    'menu.newChannel': 'Новый канал',
    'menu.myProfile': 'Мой профиль',
    'menu.contacts': 'Контакты',
    'menu.archivedChats': 'Архив',
    'menu.folders': 'Папки',
    'menu.settings': 'Настройки',
    'menu.themeHint': 'Светлая/тёмная тема — в Настройках',
    'menu.light': 'Светлая',
    'menu.dark': 'Тёмная',
    'menu.privacy': 'Конфиденциальность',
    'menu.devices': 'Устройства',
    'menu.chatAppearance': 'Оформление чатов',
    'menu.notifications': 'Уведомления',
    'menu.resetLocal': 'Сбросить локальные данные',
    'menu.deleteAccount': 'Удалить аккаунт',
    'menu.logout': 'Выйти',
    'menu.desktopNotifications': 'Уведомления на рабочем столе',
    'menu.messageSound': 'Звук сообщений',

    // --- Privacy menu ---
    'privacy.exportKey': 'Экспорт ключа шифрования',
    'privacy.importKey': 'Импорт ключа шифрования',
    'privacy.changePassword': 'Сменить пароль',
    'privacy.twoFactor': 'Двухфакторная аутентификация',
    'privacy.encryptionStatus': 'Статус шифрования',
    'privacy.encryptionActive': 'Сквозное шифрование включено',
    'privacy.encryptionMissing': 'Ключ шифрования отсутствует',
    'privacy.fingerprint': 'Отпечаток ключа:',
    'privacy.encryptionHint': 'Сообщения и файлы шифруются на этом устройстве до отправки. Экспортируйте ключ, чтобы читать историю на другом устройстве.',
    'privacy.encryptionRelogin': 'Выйдите и войдите снова, чтобы создать новую пару ключей.',
    'privacy.sessions': 'Активные сеансы',
    'privacy.securityAlerts': 'Оповещения безопасности',
    'privacy.blockedUsers': 'Заблокированные',
    'privacy.terminateOthers': 'Завершить другие сеансы',
    'privacy.markAllRead': 'Отметить все прочитанными',
    'privacy.phone': 'Кто видит мой номер телефона',
    'privacy.lastSeen': 'Кто видит время последнего входа',
    'privacy.avatar': 'Кто видит мой аватар',
    'privacy.everyone': 'Все',
    'privacy.contacts': 'Только контакты',
    'privacy.nobody': 'Никто',
    'privacy.visibilityHeader': 'Видимость профиля',

    'autoDelete.title': 'Автоудаление сообщений',
    'autoDelete.off': 'Выключено',
    'autoDelete.30s': '30 секунд',
    'autoDelete.5m': '5 минут',
    'autoDelete.1h': '1 час',
    'autoDelete.1d': '1 день',
    'autoDelete.1w': '1 неделя',
    'autoDelete.hint': 'Новые сообщения исчезнут через указанное время.',
    'autoDelete.system.set': 'Автоудаление через {timer}',
    'autoDelete.system.off': 'Автоудаление отключено',

    // --- Read receipts ---
    'read.sent': 'Отправлено',
    'read.read': 'Прочитано',

    // --- Appearance ---
    'appearance.wallpaper': 'Обои чата',
    'appearance.liveWall': '✨ Крутые обои — живая стена',
    'appearance.brightness': 'Яркость',
    'appearance.speed': 'Скорость',
    'appearance.wordStream': 'Поток моих слов',
    'appearance.lines': 'Дорожки',
    'appearance.visibility': 'Видимость',
    'appearance.blur': 'Размытие',
    'appearance.wallNote': 'Матрица собирается из слов ваших чатов (только на этом устройстве — на сервер они не уходят) и анонимных посланий со стены, которые видят все.',
    'appearance.wordNote': 'Слова появляются из ваших исходящих сообщений локально. Имена, ссылки, телефоны и чувствительные слова отфильтрованы. Ничего не отправляется на сервер.',
    'appearance.wallPlaceholder': 'Шепнуть что-нибудь доброе…',
    'appearance.wallSend': 'На стену',

    // --- Profile menu ---
    'profile.uploadPhoto': 'Загрузить фото',
    'profile.removePhoto': 'Удалить',

    // --- Search ---
    'search.chats': 'Поиск чатов',
    'search.people': 'Поиск людей',

    // --- Folder tabs ---
    'folders.all': 'Все',
    'folders.unread': 'Непрочитанные',
    'folders.personal': 'Личные',
    'folders.groups': 'Группы',
    'folders.channels': 'Каналы',
    'folders.archived': 'Архив',

    // --- Chat header / list ---
    'chat.back': 'К списку чатов',
    'chat.searchMessages': 'Поиск по сообщениям',
    'chat.audioCall': 'Аудиозвонок',
    'chat.videoCall': 'Видеозвонок',
    'chat.pin': 'Закрепить чат',
    'chat.unpin': 'Открепить чат',
    'chat.mute': 'Без звука',
    'chat.unmute': 'Включить звук',
    'chat.archive': 'В архив',
    'chat.unarchive': 'Из архива',
    'chat.menu': 'Меню чата',
    'chat.noMessages': 'Нет сообщений',
    'chat.dropToSend': 'Отпустите, чтобы отправить файл',
    'chat.blockedByYou': 'Вы заблокировали этого пользователя.',
    'chat.userUnavailable': 'Пользователь недоступен.',
    'chat.unblock': 'Разблокировать',
    'chat.cancel': 'Отмена',
    'chat.selectedCount': 'Выбрано: {count}',
    'chat.forward': 'Переслать',
    'chat.delete': 'Удалить',
    'chat.pinnedMessage': 'Закреплённое сообщение',
    'chat.mediaMessage': 'Медиа-сообщение',
    'chat.unpinMessage': 'Открепить сообщение',
    'chat.emptyTitle': 'Onda',
    'chat.emptySubtitle': 'Выберите чат или начните новый разговор.',
    'chat.newChat': 'Новый чат',

    // --- Composer ---
    'composer.placeholder': 'Сообщение',
    'composer.editing': 'Редактирование',
    'composer.replying': 'Ответ на сообщение',
    'composer.recording': 'Запись…',
    'composer.forwarding': 'Пересылка',

    // --- Statuses ---
    'status.online': 'в сети',
    'status.typing': 'печатает…',
    'status.lastSeenRecently': 'был(а) недавно',
    'status.lastSeenAt': 'был(а) в {time}',
    'status.lastSeenDate': 'был(а) {date}',

    // --- Misc ---
    'menu.theme': 'Тема',
    'menu.noContacts': 'Контакты не найдены.',
    'folders.noCustom': 'Своих папок пока нет.',
    'chat.more': 'Ещё',
    'chat.pinInFolder': 'Закрепить в папке',
    'chat.unpinInFolder': 'Открепить в папке',
    'chat.pushLabel': 'Push-уведомления: {mode}',
    'mute.1h': '1 час',
    'mute.8h': '8 часов',
    'mute.1d': '1 день',
    'mute.1w': '1 неделя',
    'mute.forever': 'Навсегда',
    'push.default': 'По умолчанию',
    'push.all': 'Все сообщения',
    'push.mentions': 'Только упоминания',
    'push.off': 'Выключены',

    // --- Profile panel ---
    'pp.groupProfile': 'Профиль группы',
    'pp.channelProfile': 'Профиль канала',
    'pp.contactProfile': 'Профиль контакта',
    'pp.groupName': 'Название группы',
    'pp.save': 'Сохранить',
    'pp.clickToRename': 'Нажмите, чтобы переименовать',
    'pp.status': 'Статус',
    'pp.username': 'Юзернейм',
    'pp.phone': 'Телефон',
    'pp.about': 'О себе',
    'pp.type': 'Тип',
    'pp.subscribers': 'Подписчики',
    'pp.members': 'Участники',
    'pp.addMember': 'Добавить участника',
    'pp.userIdToAdd': 'ID пользователя',
    'pp.add': 'Добавить',
    'pp.rights': 'Права',
    'pp.removeMember': 'Удалить участника',
    'pp.noMembers': 'Нет участников',
    'pp.adminSettings': 'Управление группой',
    'pp.statistics': 'Статистика',
    'pp.reportUser': 'Пожаловаться',
    'pp.unblockUser': 'Разблокировать',
    'pp.blockUser': 'Заблокировать',
    'pp.bannedUsers': 'Забаненные',
    'pp.noReason': 'Без причины',
    'pp.unban': 'Разбанить',
    'pp.noBans': 'Забаненных нет.',
    'pp.recentAdminActions': 'Действия админов',
    'pp.noAdminActions': 'Действий пока нет.',
    'pp.channelStats': 'Статистика канала',
    'pp.posts': 'Посты',
    'pp.views': 'Просмотры',
    'pp.reposts': 'Репосты',
    'pp.adminLoadFailed': 'Не удалось загрузить данные.',
    'pp.statsLoadFailed': 'Не удалось загрузить статистику.',
    'pp.member': 'Участник',
    'pp.calls': 'Звонки',
    'pp.noCalls': 'Звонков пока не было.',
    'pp.media': 'Медиа',
    'pp.files': 'Файлы',
    'pp.links': 'Ссылки',
    'pp.voice': 'Аудио',
    'pp.voiceMessage': 'Голосовое сообщение',
    'pp.audio': 'Аудио',
    'pp.noSharedMedia': 'Общих медиа пока нет.',
    'pp.noSharedFiles': 'Общих файлов пока нет.',
    'pp.noSharedLinks': 'Общих ссылок пока нет.',
    'pp.noSharedAudio': 'Аудио пока нет.',
    'pp.loading': 'Загрузка…',

    // --- Message actions ---
    'msg.reply': 'Ответить',
    'msg.copy': 'Копировать',
    'msg.react': 'Реакция',
    'msg.forward': 'Переслать',
    'msg.select': 'Выбрать',
    'msg.pin': 'Закрепить',
    'msg.edit': 'Изменить',
    'msg.retry': 'Повторить',
    'msg.report': 'Пожаловаться',
    'msg.delete': 'Удалить',
    'msg.edited': 'изменено',
    'msg.translate': 'Перевести',
    'msg.translating': 'Перевод...',
    'msg.translatedFrom': 'Переведено',
    'msg.translateFailed': 'Не удалось перевести',

    // --- Cloud key backup ---
    'cloudKey.save': 'Сохранить ключ в облако',
    'cloudKey.restore': 'Восстановить ключ из облака',
    'cloudKey.askPassphrase': 'Парольная фраза для ключа (минимум 8 символов). Сервер её не узнает.',
    'cloudKey.repeatPassphrase': 'Повторите парольную фразу',
    'cloudKey.tooShort': 'Фраза слишком короткая — минимум 8 символов.',
    'cloudKey.mismatch': 'Фразы не совпадают.',
    'cloudKey.saved': 'Ключ зашифрован и сохранён в облаке.',
    'cloudKey.saveFailed': 'Не удалось сохранить ключ.',
    'cloudKey.restoreFailed': 'Не удалось восстановить ключ.',

    // --- Errors ---
    'err.noGeo': 'Геолокация не поддерживается этим браузером.',
    'err.geoDenied': 'Доступ к геолокации запрещён.',
    'err.noMic': 'Запись голоса не поддерживается этим браузером.',
    'err.micDenied': 'Доступ к микрофону запрещён.',
    'err.noCamera': 'Запись видеосообщений не поддерживается этим браузером.',
    'err.cameraDenied': 'Доступ к камере запрещён.',
    'err.fileTooLarge': 'Файл слишком большой. Максимум — 100 МБ.',

    // --- Toasts ---
    'toast.wallSent': 'Послание улетело на стену ✨',
    'toast.wallFailed': 'Не получилось отправить на стену.',
    'toast.groupCreated': 'Группа создана.',
    'toast.channelCreated': 'Канал создан.',
    'toast.spaceFailed': 'Не получилось создать пространство.',

    // --- Storage management ---
    'storage.title': 'Управление хранилищем',
    'storage.localStorage': 'Локальные данные',
    'storage.cacheStorage': 'Кэш медиа',
    'storage.cacheStickers': 'Кэш стикеров',
    'storage.cacheGifs': 'Кэш гифок',
    'storage.size': 'Размер',
    'storage.items': 'Записей',
    'storage.clear': 'Очистить',
    'storage.clearAll': 'Очистить все',
    'storage.clearing': 'Очистка…',
    'storage.cacheCleared': 'Кэш очищен',
    'storage.localCleared': 'Локальные данные очищены',
    'storage.calculating': 'Расчёт…',
    'storage.noData': 'Нет данных',
    'storage.estimated': '~{size}',
    'storage.bytes': '{n} Б',
    'storage.kb': '{n} КБ',
    'storage.mb': '{n} МБ',
    'storage.gb': '{n} ГБ',
  },
  en: {
    // --- Auth screen ---
    'auth.langPick': 'Interface language',
    'auth.signin': 'Sign in',
    'auth.register': 'Register',
    'auth.totpTitle': 'Two-factor security',
    'auth.totpCode': 'Authenticator code',
    'auth.back': 'Back',
    'auth.checking': 'Checking…',
    'auth.verify': 'Verify',
    'auth.username': 'Username',
    'auth.next': 'Next',
    'auth.name': 'Name',
    'auth.password': 'Password',
    'auth.confirmPassword': 'Confirm password',
    'auth.passwordMin': 'Password must be at least 10 characters.',
    'auth.passwordMismatch': 'Passwords do not match.',
    'auth.hidePassword': 'Hide password',
    'auth.showPassword': 'Show password',
    'auth.wait': 'Please wait…',
    'auth.createAccount': 'Create account',
    'auth.foot': 'Private messages and media are encrypted before storage.',
    'auth.headline1': 'A messenger',
    'auth.headline2': 'that',
    'auth.headlineEm': 'respects',
    'auth.headline3': 'your',
    'auth.headline4': 'attention.',
    'auth.sub': 'Private by default. Quiet by design. Sign in and pick up your conversations right where you left off.',
    'auth.loginPlaceholder': 'Phone or @username',
    'auth.or': 'or',
    'auth.privacy': 'Privacy policy',
    // --- Phone-first auth flow ---
    'auth.phoneEm': 'phone-first',
    'auth.phoneNoun': 'messenger.',
    'auth.phoneSub': 'Enter your phone number. Onda will give you a login code.',
    'auth.phonePlaceholder': 'Phone number',
    'auth.sendCode': 'Send code',
    'auth.continue': 'Continue',
    'auth.changePhone': 'Change phone',
    'auth.enterCode': 'Enter code',
    'auth.codeForPhone': 'Code for {phone}',
    'auth.codePush': 'A notification with your code was sent to this device.',
    'auth.devCode': 'Local dev code:',
    'auth.loginWithPassword': 'Login with password',
    'auth.loginWithPhone': 'Back to phone login',
    'auth.passwordLogin': 'Sign in',
    'auth.loginOrUsername': 'Login or @username',
    'auth.qrLogin': 'Login via QR code',
    'auth.qrScanTitle': 'Sign in with QR code',
    'auth.qrScanHint': 'Open Onda on another device and scan this code.',
    'auth.qrGenerating': 'Generating code…',
    'auth.qrFailed': 'Failed to generate QR',
    'auth.qrExpired': 'QR code expired',
    'auth.qrConfirmed': 'Confirmed',
    'auth.qrRefresh': 'Refresh',
    'auth.qrWaiting': 'Waiting for scan…',
    'auth.qrStep1': 'Open Onda on another device',
    'auth.qrStep2': 'Go to Settings → Devices',
    'auth.profileTitle': 'Create profile',
    'auth.backToCode': 'Back to code',
    'auth.nickname': 'Nickname',
    'auth.usernamePlaceholder': 'username',
    'auth.cloudTitle': 'Two-step verification',
    'auth.cloudHint': 'Hint:',
    'auth.cloudPlaceholder': 'Cloud password',
    'auth.previewName1': 'Nina Park',
    'auth.previewText1': 'Profile is ready. Check it?',
    'auth.previewName2': 'You',
    'auth.previewText2': 'Already here. Quiet and clean.',
    'auth.previewName3': 'Design guild',
    'auth.previewText3': 'New thread is live.',

    // --- Settings ---
    'set.language': 'Language',

    // --- Main menu ---
    'menu.newPrivateChat': 'New private chat',
    'menu.newGroup': 'New group',
    'menu.newChannel': 'New channel',
    'menu.myProfile': 'My profile',
    'menu.contacts': 'Contacts',
    'menu.archivedChats': 'Archived chats',
    'menu.folders': 'Folders',
    'menu.settings': 'Settings',
    'menu.themeHint': 'Light/dark theme in Settings',
    'menu.light': 'Light',
    'menu.dark': 'Dark',
    'menu.privacy': 'Privacy and security',
    'menu.devices': 'Devices',
    'menu.chatAppearance': 'Chat appearance',
    'menu.notifications': 'Notifications',
    'menu.resetLocal': 'Reset local data',
    'menu.deleteAccount': 'Delete account',
    'menu.logout': 'Log out',
    'menu.desktopNotifications': 'Desktop notifications',
    'menu.messageSound': 'Message sound',

    // --- Privacy menu ---
    'privacy.exportKey': 'Export encryption key',
    'privacy.importKey': 'Import encryption key',
    'privacy.changePassword': 'Change password',
    'privacy.twoFactor': 'Two-factor authentication',
    'privacy.encryptionStatus': 'Encryption status',
    'privacy.encryptionActive': 'End-to-end encryption is active',
    'privacy.encryptionMissing': 'Encryption key is missing',
    'privacy.fingerprint': 'Key fingerprint:',
    'privacy.encryptionHint': 'Messages and media are encrypted on this device before upload. Export the key to read your history on another device.',
    'privacy.encryptionRelogin': 'Sign out and sign in again to generate a new key pair.',
    'privacy.sessions': 'Active sessions',
    'privacy.securityAlerts': 'Security alerts',
    'privacy.blockedUsers': 'Blocked users',
    'privacy.terminateOthers': 'Terminate other sessions',
    'privacy.markAllRead': 'Mark all read',
    'privacy.phone': 'Who can see my phone number',
    'privacy.lastSeen': 'Who can see my last seen',
    'privacy.avatar': 'Who can see my avatar',
    'privacy.everyone': 'Everyone',
    'privacy.contacts': 'Contacts only',
    'privacy.nobody': 'Nobody',
    'privacy.visibilityHeader': 'Profile visibility',

    'autoDelete.title': 'Auto-delete messages',
    'autoDelete.off': 'Off',
    'autoDelete.30s': '30 seconds',
    'autoDelete.5m': '5 minutes',
    'autoDelete.1h': '1 hour',
    'autoDelete.1d': '1 day',
    'autoDelete.1w': '1 week',
    'autoDelete.hint': 'New messages will disappear after the set time.',
    'autoDelete.system.set': 'Auto-delete in {timer}',
    'autoDelete.system.off': 'Auto-delete disabled',

    // --- Read receipts ---
    'read.sent': 'Sent',
    'read.read': 'Read',

    // --- Appearance ---
    'appearance.wallpaper': 'Chat wallpaper',
    'appearance.liveWall': '✨ Cool wallpaper — live wall',
    'appearance.brightness': 'Brightness',
    'appearance.speed': 'Speed',
    'appearance.wordStream': 'My word stream',
    'appearance.lines': 'Lines',
    'appearance.visibility': 'Visibility',
    'appearance.blur': 'Blur',
    'appearance.wallNote': 'The matrix is built from words in your chats (locally on this device only — they never reach the server) and anonymous wall notes that everyone sees.',
    'appearance.wordNote': 'Words appear from your outgoing messages locally. Names, links, phone numbers and sensitive terms are filtered. Nothing is sent to the server.',
    'appearance.wallPlaceholder': 'Whisper something kind…',
    'appearance.wallSend': 'To the wall',

    // --- Profile menu ---
    'profile.uploadPhoto': 'Upload photo',
    'profile.removePhoto': 'Remove',

    // --- Search ---
    'search.chats': 'Search chats',
    'search.people': 'Search people',

    // --- Folder tabs ---
    'folders.all': 'All',
    'folders.unread': 'Unread',
    'folders.personal': 'Personal',
    'folders.groups': 'Groups',
    'folders.channels': 'Channels',
    'folders.archived': 'Archived',

    // --- Chat header / list ---
    'chat.back': 'Back to chats',
    'chat.searchMessages': 'Search messages',
    'chat.audioCall': 'Audio call',
    'chat.videoCall': 'Video call',
    'chat.pin': 'Pin chat',
    'chat.unpin': 'Unpin chat',
    'chat.mute': 'Mute chat',
    'chat.unmute': 'Unmute chat',
    'chat.archive': 'Archive chat',
    'chat.unarchive': 'Unarchive chat',
    'chat.menu': 'Chat menu',
    'chat.noMessages': 'No messages yet',
    'chat.dropToSend': 'Drop to send file',
    'chat.blockedByYou': 'You blocked this user.',
    'chat.userUnavailable': 'This user is not available.',
    'chat.unblock': 'Unblock',
    'chat.cancel': 'Cancel',
    'chat.selectedCount': '{count} selected',
    'chat.forward': 'Forward',
    'chat.delete': 'Delete',
    'chat.pinnedMessage': 'Pinned message',
    'chat.mediaMessage': 'Media message',
    'chat.unpinMessage': 'Unpin message',
    'chat.emptyTitle': 'Onda',
    'chat.emptySubtitle': 'Pick a chat or start a new conversation.',
    'chat.newChat': 'New chat',

    // --- Composer ---
    'composer.placeholder': 'Message',
    'composer.editing': 'Editing message',
    'composer.replying': 'Replying to message',
    'composer.recording': 'Recording…',
    'composer.forwarding': 'Forwarding',

    // --- Statuses ---
    'status.online': 'online',
    'status.typing': 'typing…',
    'status.lastSeenRecently': 'last seen recently',
    'status.lastSeenAt': 'last seen at {time}',
    'status.lastSeenDate': 'last seen {date}',

    // --- Misc ---
    'menu.theme': 'Theme',
    'menu.noContacts': 'No contacts found.',
    'folders.noCustom': 'No custom folders yet.',
    'chat.more': 'More options',
    'chat.pinInFolder': 'Pin in folder',
    'chat.unpinInFolder': 'Unpin in folder',
    'chat.pushLabel': 'Push notifications: {mode}',
    'mute.1h': '1 hour',
    'mute.8h': '8 hours',
    'mute.1d': '1 day',
    'mute.1w': '1 week',
    'mute.forever': 'Forever',
    'push.default': 'Default',
    'push.all': 'All messages',
    'push.mentions': 'Mentions only',
    'push.off': 'Off',

    // --- Profile panel ---
    'pp.groupProfile': 'Group profile',
    'pp.channelProfile': 'Channel profile',
    'pp.contactProfile': 'Contact profile',
    'pp.groupName': 'Group name',
    'pp.save': 'Save',
    'pp.clickToRename': 'Click to rename',
    'pp.status': 'Status',
    'pp.username': 'Username',
    'pp.phone': 'Phone',
    'pp.about': 'About',
    'pp.type': 'Type',
    'pp.subscribers': 'Subscribers',
    'pp.members': 'Members',
    'pp.addMember': 'Add member',
    'pp.userIdToAdd': 'User ID to add',
    'pp.add': 'Add',
    'pp.rights': 'Rights',
    'pp.removeMember': 'Remove member',
    'pp.noMembers': 'No members',
    'pp.adminSettings': 'Admin settings',
    'pp.statistics': 'Statistics',
    'pp.reportUser': 'Report user',
    'pp.unblockUser': 'Unblock user',
    'pp.blockUser': 'Block user',
    'pp.bannedUsers': 'Banned users',
    'pp.noReason': 'No reason',
    'pp.unban': 'Unban',
    'pp.noBans': 'No banned users.',
    'pp.recentAdminActions': 'Recent admin actions',
    'pp.noAdminActions': 'No admin actions yet.',
    'pp.channelStats': 'Channel statistics',
    'pp.posts': 'Posts',
    'pp.views': 'Views',
    'pp.reposts': 'Reposts',
    'pp.adminLoadFailed': 'Could not load admin data.',
    'pp.statsLoadFailed': 'Could not load stats.',
    'pp.member': 'Member',
    'pp.calls': 'Calls',
    'pp.noCalls': 'No calls yet.',
    'pp.media': 'Media',
    'pp.files': 'Files',
    'pp.links': 'Links',
    'pp.voice': 'Audio',
    'pp.voiceMessage': 'Voice message',
    'pp.audio': 'Audio',
    'pp.noSharedMedia': 'No shared media yet.',
    'pp.noSharedFiles': 'No shared files yet.',
    'pp.noSharedLinks': 'No shared links yet.',
    'pp.noSharedAudio': 'No shared audio yet.',
    'pp.loading': 'Loading…',

    // --- Message actions ---
    'msg.reply': 'Reply',
    'msg.copy': 'Copy',
    'msg.react': 'React',
    'msg.forward': 'Forward',
    'msg.select': 'Select',
    'msg.pin': 'Pin',
    'msg.edit': 'Edit',
    'msg.retry': 'Retry',
    'msg.report': 'Report',
    'msg.delete': 'Delete',
    'msg.edited': 'edited',
    'msg.translate': 'Translate',
    'msg.translating': 'Translating...',
    'msg.translatedFrom': 'Translated',
    'msg.translateFailed': 'Translation failed',

    // --- Cloud key backup ---
    'cloudKey.save': 'Save key to cloud',
    'cloudKey.restore': 'Restore key from cloud',
    'cloudKey.askPassphrase': 'Passphrase for the key (at least 8 characters). The server never sees it.',
    'cloudKey.repeatPassphrase': 'Repeat the passphrase',
    'cloudKey.tooShort': 'Passphrase is too short — at least 8 characters.',
    'cloudKey.mismatch': 'Passphrases do not match.',
    'cloudKey.saved': 'Key encrypted and saved to the cloud.',
    'cloudKey.saveFailed': 'Could not save the key.',
    'cloudKey.restoreFailed': 'Could not restore the key.',

    // --- Errors ---
    'err.noGeo': 'Location sharing is not supported in this browser.',
    'err.geoDenied': 'Location permission was denied.',
    'err.noMic': 'Voice recording is not supported in this browser.',
    'err.micDenied': 'Microphone access was denied.',
    'err.noCamera': 'Video message recording is not supported in this browser.',
    'err.cameraDenied': 'Camera access was denied.',
    'err.fileTooLarge': 'File is too large. Maximum size is 100 MB.',

    // --- Toasts ---
    'toast.wallSent': 'Your note flew onto the wall ✨',
    'toast.wallFailed': 'Could not post to the wall.',
    'toast.groupCreated': 'Group created.',
    'toast.channelCreated': 'Channel created.',
    'toast.spaceFailed': 'Could not create the space.',

    // --- Storage management ---
    'storage.title': 'Storage usage',
    'storage.localStorage': 'Local data',
    'storage.cacheStorage': 'Media cache',
    'storage.cacheStickers': 'Sticker cache',
    'storage.cacheGifs': 'GIF cache',
    'storage.size': 'Size',
    'storage.items': 'Items',
    'storage.clear': 'Clear',
    'storage.clearAll': 'Clear all',
    'storage.clearing': 'Clearing…',
    'storage.cacheCleared': 'Cache cleared',
    'storage.localCleared': 'Local data cleared',
    'storage.calculating': 'Calculating…',
    'storage.noData': 'No data',
    'storage.estimated': '~{size}',
    'storage.bytes': '{n} B',
    'storage.kb': '{n} KB',
    'storage.mb': '{n} MB',
    'storage.gb': '{n} GB',
  },
}

// Apply initial <html lang> on load.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', currentLang)
}
