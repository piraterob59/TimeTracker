import struct
import zlib
import math

BG = (37, 99, 235)      # blue-600
FACE = (255, 255, 255)  # white clock face
HAND = (37, 99, 235)    # blue hands


def make_icon(size, corner_radius):
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    cx = cy = size / 2

    def in_rounded_square(x, y):
        r = corner_radius
        if x < r and y < r:
            return (x - r) ** 2 + (y - r) ** 2 <= r * r
        if x >= size - r and y < r:
            return (x - (size - r)) ** 2 + (y - r) ** 2 <= r * r
        if x < r and y >= size - r:
            return (x - r) ** 2 + (y - (size - r)) ** 2 <= r * r
        if x >= size - r and y >= size - r:
            return (x - (size - r)) ** 2 + (y - (size - r)) ** 2 <= r * r
        return True

    face_r = size * 0.34
    ring_w = size * 0.045

    for y in range(size):
        for x in range(size):
            if not in_rounded_square(x + 0.5, y + 0.5):
                pixels[y][x] = None  # transparent
                continue
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = math.sqrt(dx * dx + dy * dy)
            if dist <= face_r:
                pixels[y][x] = FACE
            elif dist <= face_r + ring_w:
                pixels[y][x] = FACE

    # clock hands (minute hand up, hour hand right)
    def draw_line(x0, y0, x1, y1, thickness):
        steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for i in range(steps + 1):
            t = i / steps
            px = x0 + (x1 - x0) * t
            py = y0 + (y1 - y0) * t
            r = thickness / 2
            for oy in range(-int(r) - 1, int(r) + 2):
                for ox in range(-int(r) - 1, int(r) + 2):
                    if ox * ox + oy * oy <= r * r:
                        xx, yy = int(px + ox), int(py + oy)
                        if 0 <= xx < size and 0 <= yy < size:
                            if pixels[yy][xx] is not None:
                                pixels[yy][xx] = HAND

    draw_line(cx, cy, cx, cy - face_r * 0.62, size * 0.045)
    draw_line(cx, cy, cx + face_r * 0.45, cy, size * 0.045)

    # center dot
    for y in range(size):
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            if dx * dx + dy * dy <= (size * 0.03) ** 2:
                if pixels[y][x] is not None:
                    pixels[y][x] = HAND

    return pixels


def write_png(path, pixels, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # no filter
        for x in range(size):
            p = pixels[y][x]
            if p is None:
                raw.extend((0, 0, 0, 0))
            else:
                raw.extend((p[0], p[1], p[2], 255))

    def chunk(tag, data):
        c = tag + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(png)


for size, radius, name in [
    (192, 34, 'icon-192.png'),
    (512, 90, 'icon-512.png'),
    (180, 32, 'apple-touch-icon.png'),
]:
    px = make_icon(size, radius)
    write_png(f'icons/{name}', px, size)
    print(f'wrote icons/{name}')
