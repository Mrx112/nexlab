"""Generate the multi-size NexLab Windows icon without external dependencies."""
import argparse
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIZES = (16, 24, 32, 48, 64, 128, 256)
SCALE = 3


def rounded_box_distance(x, y, center, half_size, radius):
    qx = abs(x - center) - (half_size - radius)
    qy = abs(y - center) - (half_size - radius)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0)


def segment_distance(x, y, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length_squared = dx * dx + dy * dy
    amount = max(0, min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / length_squared))
    nearest = (start[0] + amount * dx, start[1] + amount * dy)
    return math.hypot(x - nearest[0], y - nearest[1]), amount


def png_chunk(kind, data):
    body = kind + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)


def make_png(size, pixels):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        start = y * size * 4
        rows.extend(pixels[start:start + size * 4])
    return (
        b'\x89PNG\r\n\x1a\n'
        + png_chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + png_chunk(b'IDAT', zlib.compress(bytes(rows), 9))
        + png_chunk(b'IEND', b'')
    )


def render_icon(size):
    extent = size * SCALE
    center = extent / 2
    unit = extent / 256
    points = [(77 * unit, 178 * unit), (77 * unit, 78 * unit),
              (179 * unit, 178 * unit), (179 * unit, 78 * unit)]
    segments = list(zip(points, points[1:]))
    stroke = 14 * unit
    radius = 11 * unit
    canvas = bytearray(extent * extent * 4)

    for y in range(extent):
        py = y + 0.5
        row_offset = y * extent * 4
        for x in range(extent):
            px = x + 0.5
            edge = rounded_box_distance(px, py, center, center - 3 * unit, 47 * unit)
            if edge > 0:
                continue

            diagonal = (px + py) / (2 * extent)
            glow = max(0, 1 - math.hypot(px - center, py - center) / (extent * 0.72))
            color = [
                int(12 + diagonal * 5 + glow * 5),
                int(22 + diagonal * 24 + glow * 13),
                int(48 + diagonal * 28 + glow * 30),
            ]

            if edge > -1.5 * unit:
                color = [min(255, c + int(v * 0.45)) for c, v in zip(color, (40, 100, 145))]

            nearest_distance = float('inf')
            nearest_amount = 0
            nearest_index = 0
            for index, (start, end) in enumerate(segments):
                distance, amount = segment_distance(px, py, start, end)
                if distance < nearest_distance:
                    nearest_distance, nearest_amount, nearest_index = distance, amount, index

            if nearest_distance < stroke * 1.8:
                halo = max(0, 1 - nearest_distance / (stroke * 1.8)) * 0.28
                color = [min(255, c + int(v * halo)) for c, v in zip(color, (33, 180, 255))]
            if nearest_distance < stroke / 2:
                blend = (nearest_index + nearest_amount) / len(segments)
                line_color = (64 + int(39 * blend), 224 - int(24 * blend), 255)
                color = list(line_color)

            for node_x, node_y in (points[0], points[1], points[2], points[3]):
                distance = math.hypot(px - node_x, py - node_y)
                if distance < radius:
                    color = [76, 232, 255] if distance < radius * 0.56 else [36, 155, 226]

            offset = row_offset + x * 4
            canvas[offset:offset + 4] = bytes((*color, 255))

    return canvas, extent


def downsample(source, source_size, destination_size):
    factor = source_size // destination_size
    pixels = bytearray(destination_size * destination_size * 4)
    sample_count = factor * factor
    for y in range(destination_size):
        for x in range(destination_size):
            totals = [0, 0, 0, 0]
            for sy in range(y * factor, (y + 1) * factor):
                offset = (sy * source_size + x * factor) * 4
                for sx in range(factor):
                    for channel in range(4):
                        totals[channel] += source[offset + sx * 4 + channel]
            target = (y * destination_size + x) * 4
            pixels[target:target + 4] = bytes(value // sample_count for value in totals)
    return pixels


def create_ico(destination):
    rendered, extent = render_icon(256)
    images = [(size, make_png(size, downsample(rendered, extent, size))) for size in SIZES]
    header_size = 6 + len(images) * 16
    offset = header_size
    directory = bytearray()
    payload = bytearray()
    for size, image in images:
        directory.extend(struct.pack(
            '<BBBBHHII', size if size < 256 else 0, size if size < 256 else 0,
            0, 0, 1, 32, len(image), offset,
        ))
        payload.extend(image)
        offset += len(image)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(struct.pack('<HHH', 0, 1, len(images)) + directory + payload)
    print(f'Created NexLab icon: {destination}')


def main():
    parser = argparse.ArgumentParser(description='Generate the NexLab Windows application icon.')
    parser.add_argument('--output', type=Path, default=ROOT / 'build' / 'nexlab.ico')
    args = parser.parse_args()
    create_ico(args.output.resolve())


if __name__ == '__main__':
    main()
