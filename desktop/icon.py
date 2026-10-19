#!/usr/bin/env python3
"""Генерация иконок приложения из набора SVG-фигур (конь на тёмно-синем фоне).

Запуск:  python3 desktop/icon.py
Нужен Pillow. Создаёт:
  desktop/icons/icon-512.png, icon-192.png, icon-64.png, icon-32.png, icon-16.png
  desktop/icons/icon.icns  (если доступен iconutil/pnge2icns, иначе пропускается)
  desktop/icons/icon.ico   (набор размеров для Windows)
  desktop/icons/icon.svg   (векторная версия для Tauri/Linux)
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PIECES = os.path.join(ROOT, 'pieces')
OUT = os.path.join(HERE, 'icons')

BG_TOP = (26, 32, 56)        # #1a2038
BG_BOTTOM = (11, 14, 28)     # #0b0e1c
ACCENT = (122, 162, 255)     # #7aa2ff


def piece_paths(name):
    """Достаёт внутренности SVG-фигуры (набор Cburnett)."""
    with open(os.path.join(PIECES, name + '.svg'), encoding='utf-8') as f:
        raw = f.read()
    return re.sub(r'^<svg[^>]*>|</svg>\s*$', '', raw, flags=re.S)


def build_svg():
    """Векторная иконка: скруглённый квадрат с градиентом и белым конём."""
    knight = piece_paths('wN')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#2b3560"/>
      <stop offset="1" stop-color="#0b0e1c"/>
    </linearGradient>
    <clipPath id="round">
      <rect x="0" y="0" width="512" height="512" rx="104" ry="104"/>
    </clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect x="10" y="10" width="492" height="492" rx="96" ry="96" fill="none"
          stroke="{ACCENT[0]},{ACCENT[1]},{ACCENT[2]}" stroke-opacity="0.35" stroke-width="6"/>
    <g transform="translate(56 56) scale(8.9)">
      {knight}
    </g>
  </g>
</svg>
'''


def build_png(svg_path, sizes):
    """Растеризует иконку. Пробует rsvg-convert / inkscape / cairosvg,
    а если ничего нет — рисует упрощённую версию через Pillow."""
    os.makedirs(OUT, exist_ok=True)
    biggest = max(sizes)

    def try_cmd(cmd, out):
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=90)
            return os.path.exists(out)
        except Exception:
            return False

    tmp = os.path.join(OUT, '_master.png')
    rendered = (
        try_cmd(['rsvg-convert', '-w', str(biggest), '-h', str(biggest), svg_path, '-o', tmp], tmp) or
        try_cmd(['inkscape', svg_path, '-w', str(biggest), '-h', str(biggest), '-o', tmp], tmp)
    )
    if not rendered:
        try:
            import resvg_py
            with open(svg_path, encoding='utf-8') as f:
                data = resvg_py.svg_to_bytes(svg_string=f.read(), width=biggest, height=biggest)
            with open(tmp, 'wb') as f:
                f.write(data)
            rendered = os.path.exists(tmp) and os.path.getsize(tmp) > 100
            if rendered:
                print('  растеризовано через resvg (встроенный Rust-рендерер)')
        except Exception as e:
            print('  (resvg недоступен: %s)' % e.__class__.__name__)
    if not rendered:
        try:
            import cairosvg
            cairosvg.svg2png(url=svg_path, write_to=tmp, output_width=biggest, output_height=biggest)
            rendered = os.path.exists(tmp)
        except Exception as e:
            print('  (векторный растеризатор недоступен: %s)' % e.__class__.__name__)

    if not rendered:
        tmp = draw_fallback(biggest)

    from PIL import Image
    # tmp — путь к файлу (после внешнего растеризатора) или уже готовое изображение (запасной вариант)
    master = tmp if hasattr(tmp, 'convert') else Image.open(tmp).convert('RGBA')
    master = master.convert('RGBA')
    for s in sizes:
        p = os.path.join(OUT, f'icon-{s}.png')
        master.resize((s, s), Image.LANCZOS).save(p)
        print('  записан', os.path.relpath(p, ROOT))
    if isinstance(tmp, str) and os.path.exists(tmp) and tmp.endswith('_master.png'):
        os.remove(tmp)
    return master


def draw_fallback(size):
    """Запасной вариант без растеризатора SVG: градиентный квадрат с буквой-конём."""
    from PIL import Image, ImageDraw
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * 0.203)
    for y in range(size):
        t = y / size
        col = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=col + (255,))
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    img.putalpha(mask)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([size * 0.02, size * 0.02, size * 0.98, size * 0.98],
                        radius=int(r * 0.96), outline=ACCENT + (90,), width=max(2, size // 128))
    # схематичный конь: тело + голова + грива
    cx, cy = size * 0.5, size * 0.56
    u = size * 0.30
    white = (248, 248, 248, 255)
    d.ellipse([cx - u, cy - u * 0.72, cx + u, cy + u * 0.86], fill=white)          # тело
    d.polygon([(cx - u * 0.24, cy - u * 0.42), (cx - u * 0.92, cy - u * 1.42),
               (cx + u * 0.16, cy - u * 1.06), (cx + u * 0.30, cy - u * 0.34)], fill=white)  # шея/голова
    d.polygon([(cx - u * 0.92, cy - u * 1.42), (cx - u * 1.30, cy - u * 0.98),
               (cx - u * 0.98, cy - u * 0.86)], fill=white)                        # морда
    d.ellipse([cx - u * 1.02, cy - u * 1.20, cx - u * 0.88, cy - u * 1.06], fill=(30, 30, 40, 255))  # глаз
    d.rectangle([cx - u * 0.98, cy + u * 0.60, cx + u * 0.98, cy + u * 0.94], fill=white)            # подставка
    return img


def build_ico(master):
    from PIL import Image
    p = os.path.join(OUT, 'icon.ico')
    master.save(p, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('  записан', os.path.relpath(p, ROOT))


def build_icns():
    """macOS: нужен iconutil (есть только на macOS)."""
    iconset = os.path.join(OUT, 'icon.iconset')
    try:
        os.makedirs(iconset, exist_ok=True)
        from PIL import Image
        for s in (16, 32, 64, 128, 256, 512):
            src = os.path.join(OUT, f'icon-{s}.png')
            if not os.path.exists(src):
                Image.open(os.path.join(OUT, 'icon-512.png')).resize((s, s), Image.LANCZOS).save(src)
            Image.open(src).resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}.png'))
            Image.open(src).resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f'icon_{s}x{s}@2x.png'))
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(OUT, 'icon.icns')],
                       check=True, capture_output=True)
        print('  записан desktop/icons/icon.icns')
    except Exception as e:
        print('  icon.icns пропущен (нужен macOS с iconutil):', e.__class__.__name__)
    finally:
        subprocess.run(['rm', '-rf', iconset], capture_output=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    svg_path = os.path.join(OUT, 'icon.svg')
    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(build_svg())
    print('  записан', os.path.relpath(svg_path, ROOT))
    sizes = [16, 32, 64, 192, 512]
    try:
        master = build_png(svg_path, sizes)
    except ImportError:
        print('Pillow не установлен — растровые иконки не созданы. Установите: pip install Pillow')
        return 1
    build_ico(master)
    build_icns()
    return 0


if __name__ == '__main__':
    sys.exit(main())
