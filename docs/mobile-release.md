# Onda — выпуск в Play Market и App Store

Приложение упаковано через [Capacitor](https://capacitorjs.com): веб-сборка из `dist/`
кладётся внутрь нативной оболочки. Нативные проекты уже созданы: `android/` и `ios/`.

## Предварительное условие: сервер

Мессенджеру нужен ваш сервер (API + WebSocket + БД) на HTTPS-домене.
Деплой сервера описан в [docs/production.md](production.md) (Docker / docker-compose).

Перед сборкой мобильного приложения укажите адрес сервера:

```bat
set VITE_API_BASE=https://onda.example.com
```

Без него приложение будет искать API на same-origin и в нативной оболочке работать не будет.

## Android (Play Market)

### Что нужно

- Android Studio (или Android SDK + JDK 17)
- Аккаунт Google Play Console ($25 единоразово)

### Сборка

```bat
:: тестовый APK на телефон
build-apk.bat

:: релизный AAB для Play Market
build-apk.bat release
```

Или через Android Studio: `npm run mobile:android` (соберёт веб, синхронизирует и откроет проект).

### Подпись release-сборки

1. Создайте ключ: `keytool -genkey -v -keystore onda.keystore -alias onda -keyalg RSA -keysize 2048 -validity 10000`
2. Создайте `android/keystore.properties`:
   ```
   storeFile=../../onda.keystore
   storePassword=...
   keyAlias=onda
   keyPassword=...
   ```
3. Подключите подпись в `android/app/build.gradle` (signingConfigs → release) — стандартная схема,
   см. [документацию](https://developer.android.com/studio/publish/app-signing).
4. **Храните keystore в надёжном месте** — без него обновления приложения публиковать нельзя.

### Публикация

1. Play Console → Create app → загрузить `app-release.aab`
2. Заполнить: описание, скриншоты (телефон + 7" планшет), иконку 512×512, feature graphic 1024×500
3. Анкета Data safety: приложение передаёт сообщения и медиа с шифрованием приложения, хранит email/логин — указать честно
4. Content rating, target audience, privacy policy URL (обязателен)

## iOS (App Store)

Сборка iOS возможна **только на macOS** с Xcode. Проект `ios/` уже готов и кроссплатформенный —
скопируйте репозиторий на Mac и выполните:

```bash
npm install
export VITE_API_BASE=https://onda.example.com
npm run mobile:ios   # соберёт веб и откроет Xcode
```

В Xcode:
1. Signing & Capabilities → выбрать команду (нужен Apple Developer аккаунт, $99/год)
2. Product → Archive → Distribute App → App Store Connect
3. В App Store Connect: метаданные, скриншоты (6.7" и 5.5"), privacy policy, App Privacy анкета

### Особенности iOS

- Push-уведомления через Web Push в оболочке не работают — нужен плагин
  `@capacitor/push-notifications` + APNs (см. «Что осталось» в отчёте)
- Доступ к микрофону/камере для звонков: ключи `NSMicrophoneUsageDescription` и
  `NSCameraUsageDescription` уже нужны в `ios/App/App/Info.plist` — добавьте тексты на русском

## Иконки и сплэш-экраны

Сгенерировать из одного исходника 1024×1024:

```bash
npm install -D @capacitor/assets
npx capacitor-assets generate --iconBackgroundColor '#F0E9E1'
```

Исходник положите в `assets/icon.png` (и опционально `assets/splash.png` 2732×2732).

## Чек-лист перед загрузкой в сторы

- [ ] Сервер на HTTPS-домене, `/api/health` отвечает
- [ ] `VITE_API_BASE` указан при сборке
- [ ] CORS на сервере разрешает запросы с `https://localhost` (Capacitor) — проверить helmet/CORS настройки
- [ ] Тестовые кнопки входа скрыты: они отключаются автоматически при `NODE_ENV=production`
- [ ] Privacy policy опубликована (обязательна в обоих сторах)
- [ ] Версия в `android/app/build.gradle` (versionCode/versionName) и в Xcode увеличена

## Нативные push-уведомления (FCM)

Web Push в Capacitor-оболочке не работает — приложение использует
`@capacitor/push-notifications` (уже подключён). Чтобы заработало:

1. Создайте проект в [Firebase Console](https://console.firebase.google.com),
   добавьте Android-приложение с package `app.onda.messenger`.
2. Скачайте `google-services.json` → положите в `android/app/`.
3. В `android/build.gradle` подключите `com.google.gms:google-services`,
   в `android/app/build.gradle` примените плагин (стандартная инструкция Firebase).
4. Для iOS: загрузите APNs-ключ в Firebase, добавьте `GoogleService-Info.plist` в Xcode.
5. На сервере: Project Settings → Service accounts → Generate private key,
   затем задайте `FCM_SERVICE_ACCOUNT_FILE=/path/to/key.json` (или
   `FCM_SERVICE_ACCOUNT_JSON` с содержимым) в окружении сервера.

Сервер сам выберет канал: Web Push (VAPID) для браузеров, FCM для мобильных
токенов. Без настроенного FCM мобильная регистрация вернёт понятную ошибку,
всё остальное работает как раньше.
