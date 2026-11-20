# Разработка и проверка

`custom_components/hmi_panel` — устанавливаемая часть интеграции. В ней находятся
все необходимые во время работы файлы; дополнительных библиотек Python нет.
`frontend` — исходники карточки, `android` — независимое приложение киоска.

Сборка карточки после изменения исходников:

```text
python scripts/build_frontend.py
python -m unittest discover -s tests -v
```

Серверные тесты подменяют интерфейсы HA: проверяют регистрацию статического
каталога и модуля, повторную настройку, выгрузку и форму интеграции.
Они не заменяют испытание на настоящем HA. Сверялись интерфейсы HA 2026.11.2:
`async_register_static_paths`, `add_extra_js_url`, `remove_extra_js_url`.

Для браузерной проверки откройте `tests/preview.html` через локальный HTTP-сервер:

```text
python -m http.server 8765
```

Затем перейдите на `http://localhost:8765/tests/preview.html`. Это автономный
стенд с вымышленными сущностями: он не подключается к умному дому.
Он проверяет создание новой карточки без сущностей, часовой пояс HA,
подхват единиц датчиков, редактор, меню, экраны и отмену/возврат изменений.

Для автоматического запуска браузерной проверки нужен Playwright и установленный
Chromium: `npm install --no-save playwright`, `npx playwright install chromium`,
затем `node tests/browser-portability.cjs http://localhost:8765/tests/preview.html`.
Снимки в инструкции получены на этом автономном стенде с вымышленными данными.

HTML-инструкция уже включена в пакет. Для её обновления из Markdown нужен
`marked`: `npm install --no-save marked`, затем `node scripts/build_docs.cjs`.

Java-тесты `PinAccessTest` и `PanelUrlTest` запускаются с обычным JDK, без Android.

Перед новым выпуском меняйте версию одновременно в `manifest.json` и `const.py`:
версия входит в URL модуля и обновляет кэш браузера. Для APK меняйте versionCode
и versionName в AndroidManifest и Gradle, не меняйте ключ подписи при обновлении.

## Следующая проверка перед публикацией

1. Чистая установка интеграции и её удаление на тестовом HA 2026.11.x.
2. Повторная загрузка HA и браузера, обновление поверх предыдущей версии.
3. Киоск на чистом Android: адрес, PIN, вход, Device Owner, защита и перезагрузка.
4. Другой дом: выбор новых сущностей, импорт макета, отсутствие обращений к первому дому.
5. Проверки HACS/hassfest и автоматические тесты GitHub Actions.

Официальные справочники:
- https://www.hacs.xyz/docs/publish/integration/
- https://developers.home-assistant.io/docs/config_entries_config_flow_handler/
- https://developers.home-assistant.io/blog/2024/06/18/async_register_static_paths/
- https://developer.android.com/work/dpc/dedicated-devices/cookbook

## Мастер Android

Серверный код `custom_components/hmi_panel/provision.py` общий для HA и
`scripts/setup_android.py`. Весь блокирующий ADB-ввод-вывод выполняется в executor.
WebSocket-команда проверяет администратора и состояние интеграции до создания
менеджера. Проверка устройства выдаёт одноразовое разрешение на пять минут,
привязанное к пользователю, IP, порту и серийному номеру. PIN через API не принимается.

Тесты используют имитацию Android, не реальную панель. Для браузерных тестов:
`npm install`, `npx playwright install chromium`, `npm run test:browser`.
Для диагностики с установленным Chromium можно задать переменную `CHROME_PATH`.
Подробная модель действий и хранения данных — `docs/android-setup.md`.

APK находится внутри устанавливаемой интеграции в `kiosk/`; контрольная сумма
и версия — в `kiosk/manifest.json`. После изменения Android пересоберите APK
постоянным ключом и обновите обе копии APK и этот манифест. Ключ подписи не публикуется.
