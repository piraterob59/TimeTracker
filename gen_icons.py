# Generates the three PWA icon PNGs (icon-192, icon-512, apple-touch-icon)
# from scratch, using only Python's standard library — no Pillow/image
# libraries. This was used to create the original placeholder clock icon
# before the app got a custom-designed one via tools/icon-designer.html.
# Kept around as a reference / fallback generator.

import struct   # for packing integers into the exact byte layout PNG requires
import zlib     # PNG compresses pixel data with zlib (DEFLATE), and CRC32 checksums

BG = (37, 99, 235)      # blue-600 (RGB) — icon background
FACE = (255, 255, 255)  # white clock face
HAND = (37, 99, 235)    # blue clock hands (same as background)


def make_icon(size, corner_radius):
    """Build a 2D grid of pixels (size x size) representing a simple clock icon.

    Each pixel is either an (r, g, b) tuple or None (meaning transparent —
    used for the corners outside the rounded-square shape).
    """
    # Start with every pixel filled in with the background color.
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    cx = cy = size / 2  # center of the icon, used for circles/lines below

    def in_rounded_square(x, y):
        """True if (x, y) falls inside a square whose 4 corners are rounded.

        Each corner is checked against a circle of radius `corner_radius`
        centered just inside that corner; pixels outside all 4 corner
        circles (but inside the square) are also included via the final
        `return True`.
        """
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

    face_r = size * 0.34   # radius of the white clock face, relative to icon size
    ring_w = size * 0.045  # thickness of the ring around the face

    # Pass 1: carve out the rounded-square silhouette and paint the clock face.
    for y in range(size):
        for x in range(size):
            if not in_rounded_square(x + 0.5, y + 0.5):
                pixels[y][x] = None  # outside the rounded square -> transparent
                continue
            # distance from this pixel to the icon's center
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = (dx * dx + dy * dy) ** 0.5
            if dist <= face_r + ring_w:
                pixels[y][x] = FACE  # inside the face circle or its ring

    # Pass 2: draw the clock hands as short lines from the center.
    def draw_line(x0, y0, x1, y1, thickness):
        """Draw a line from (x0,y0) to (x1,y1) by stamping a small filled
        circle ("brush") at many points along the line — a cheap way to
        get a line with thickness without a real vector-graphics library.
        """
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
                            if pixels[yy][xx] is not None:  # don't paint transparent corners
                                pixels[yy][xx] = HAND

    # Minute hand points straight up, hour hand points right.
    draw_line(cx, cy, cx, cy - face_r * 0.62, size * 0.045)
    draw_line(cx, cy, cx + face_r * 0.45, cy, size * 0.045)

    # Pass 3: small center dot where the hands pivot.
    for y in range(size):
        for x in range(size):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            if dx * dx + dy * dy <= (size * 0.03) ** 2:
                if pixels[y][x] is not None:
                    pixels[y][x] = HAND

    return pixels


def write_png(path, pixels, size):
    """Encode a pixel grid as a real PNG file, byte by byte.

    A PNG file is: an 8-byte magic signature, followed by a series of
    "chunks" (IHDR = header/metadata, IDAT = the actual image data,
    IEND = end marker). Each chunk is: 4-byte length, 4-byte type tag,
    the data itself, then a 4-byte CRC32 checksum of (tag + data).
    """
    # Build the raw, uncompressed pixel bytes PNG expects: for each row,
    # a filter-type byte (0 = "no filtering") followed by 4 bytes (RGBA)
    # per pixel.
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0 = none
        for x in range(size):
            p = pixels[y][x]
            if p is None:
                raw.extend((0, 0, 0, 0))       # fully transparent pixel
            else:
                raw.extend((p[0], p[1], p[2], 255))  # opaque RGB pixel

    def chunk(tag, data):
        """Pack one PNG chunk: length + type + data + CRC32."""
        c = tag + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)

    sig = b'\x89PNG\r\n\x1a\n'  # fixed 8-byte signature every PNG file starts with

    # IHDR fields: width, height, bit depth (8), color type (6 = RGBA),
    # compression method, filter method, interlace method (all 0/default).
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)

    # IDAT holds the zlib-compressed raw pixel bytes built above.
    idat = zlib.compress(bytes(raw), 9)  # 9 = max compression level

    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

    with open(path, 'wb') as f:
        f.write(png)


# Generate all three icon sizes the PWA manifest/HTML reference.
# (radius is the rounded-corner amount in pixels, scaled per icon size)
for size, radius, name in [
    (192, 34, 'icon-192.png'),
    (512, 90, 'icon-512.png'),
    (180, 32, 'apple-touch-icon.png'),
]:
    px = make_icon(size, radius)
    write_png(f'icons/{name}', px, size)
    print(f'wrote icons/{name}')
