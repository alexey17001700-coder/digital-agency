# Локальный Three.js для 3D-офиса

Положи сюда файл `three.module.js` (версия 0.160) — тогда 3D-офис будет
работать **без интернета и без CDN**, прямо с GitHub Pages.

## Как скачать (на сервере Ubuntu/Termux)

```bash
cd ~/digital-agency
mkdir -p lib
curl -L -o lib/three.module.js \
  https://raw.githubusercontent.com/mrdoob/three.js/r160/build/three.module.js
ls -lh lib/three.module.js   # должно быть ≈ 1.2 MB
git add lib/three.module.js
git commit -m "three.js локально"
git push
```

Если `raw.githubusercontent.com` тоже недоступен — попробуй зеркала:

```bash
curl -L -o lib/three.module.js https://cdn.statically.io/gh/mrdoob/three.js/r160/build/three.module.js
curl -L -o lib/three.module.js https://raw.githack.com/mrdoob/three.js/r160/build/three.module.js
curl -L -o lib/three.module.js https://unpkg.com/three@0.160.0/build/three.module.js
```

## Как работает загрузчик

`office3d.js` перебирает источники по порядку:

1. `./lib/three.module.js` — локальный файл (быстрее всего, работает офлайн)
2. rawcdn.githack / statically / jsDelivr / unpkg / fastly / esm.sh / cdnjs

Если локальный файл появится — он подхватится автоматически, править код не нужно.
Проверить размер: файл должен быть около **1.2 МБ**, а не 0 байт.
