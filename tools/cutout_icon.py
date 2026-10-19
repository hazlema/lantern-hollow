# Usage: python3 tools/cutout_icon.py render.png public/art/icons/name.webp
# Cut a cream-background render out to a transparent 256px icon: flood-fill the
# background from the borders, feather the edge, crop to content, pad to square.
import sys
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

def cutout(src, dst, size=256, tol=34, soft=18):
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int32)
    h, w, _ = a.shape
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    near = dist < tol + soft
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and near[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    alpha = np.ones((h, w))
    # reached pixels: fully clear when close to the cream, ramping up across the soft band
    ramp = np.clip((dist - tol) / soft, 0, 1)
    alpha[seen] = ramp[seen]
    al = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    alpha = np.asarray(al) / 255.0
    # pull the cream fringe out of semi-transparent edge pixels
    af = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - bg * (1 - af)) / af, 0, 255)
    rgb = np.where(alpha[..., None] > 0.98, a, rgb)
    out = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
    bbox = out.getchannel('A').point(lambda v: 255 if v > 12 else 0).getbbox()
    out = out.crop(bbox)
    side = int(max(out.size) * 1.06)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(out, ((side - out.width) // 2, (side - out.height) // 2))
    sq.resize((size, size), Image.LANCZOS).save(dst, 'WEBP', quality=90, method=6)

if __name__ == '__main__':
    cutout(sys.argv[1], sys.argv[2])
