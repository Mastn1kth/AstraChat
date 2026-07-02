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

## Известное ограничение: расшифровка голосовых на iOS 15.0–16.3

Расшифровка голосовых сообщений (Whisper, `src/utils/speechTranscription.js`,
`src/workers/whisperWorker.js`) требует WebAssembly SIMD — WASM-бинарь, который
грузит onnxruntime-web (через `@huggingface/transformers`), собран только в
SIMD-варианте, без не-SIMD фолбэка. Chromium (Android System WebView, которая
обновляется через Play Store независимо от `minSdkVersion` проекта) получил
поддержку WASM SIMD ещё в версии 91 (2021) — на Android эта функция работает
на практике на всех актуальных устройствах. Но WKWebView (iOS) получил
поддержку WASM SIMD только в Safari/WebKit **16.4** (март 2023), а
`IPHONEOS_DEPLOYMENT_TARGET` этого проекта — **15.0** (см.
`ios/App/App.xcodeproj/project.pbxproj`). На iOS 15.0–16.3 попытка
инициализировать WASM-модуль завершится ошибкой компиляции.

Фикс — не полифилл (SIMD либо есть в движке, либо нет), а честный фичедетект:
`isSpeechTranscriptionSupported()` теперь проверяет поддержку SIMD через
`WebAssembly.validate()` с тем же тестовым модулем, что использует сам
onnxruntime-web внутри себя, и на не поддерживающих SIMD движках кнопка
«Расшифровать» просто не показывается (вместо зависающей/падающей кнопки).
Пользователи iOS 15.0–16.3 в Capacitor-оболочке не увидят кнопку расшифровки;
пользователи iOS 16.4+ и Android — увидят, и функция должна работать (см.
оговорку про непроверенность на реальном устройстве ниже). Разница в
источнике WASM-рантайма между платформами:

- **Android** (не-Safari ветка `@huggingface/transformers`): WASM-бинарь
  `ort-wasm-simd-threaded.asyncify.wasm` (~23.5МБ) собирается Vite прямо в
  `dist/assets/` и упаковывается внутрь APK/AAB — грузится локально, без сети.
- **iOS/WKWebView** (ветка `apis.IS_SAFARI` в `transformers.js` — детектится по
  `navigator.vendor` содержащему `"Apple"` и UA без `Chrome`/`Android`, что
  верно матчит WKWebView): WASM-рантайм НЕ упакован локально, а грузится в
  рантайме с `cdn.jsdelivr.net`. Плюс на обеих платформах — одноразовая
  загрузка весов модели (~150МБ, fp32) с `huggingface.co`.

CSP тут не помеха ни для одного из хостов: упакованный `index.html` не
содержит CSP-meta-тега, `helmet` CSP из `server/index.js` относится только к
HTTP-ответам самого сервера (не к локально упакованным ассетам Capacitor), и
`capacitor.config.json` не задаёт `server.allowNavigation` (который в любом
случае ограничивает только top-level навигацию, а не `fetch`/`Worker`).

**Не проверено на реальном устройстве/эмуляторе** — в текущем окружении нет
доступного iOS-устройства/симулятора и нет Android-эмулятора/подключённого
устройства (Android SDK установлен, но без образов эмулятора). Вывод основан
на статическом анализе кода onnxruntime-web/transformers.js, официальных
таблицах поддержки WebAssembly SIMD (caniuse) и архитектуры Capacitor
(`androidScheme: 'https'`, отсутствие CSP meta-тега в `index.html`, отсутствие
кастомных WebView-оверрайдов в `MainActivity.java`), а не на подтверждённом
запуске на телефоне.
