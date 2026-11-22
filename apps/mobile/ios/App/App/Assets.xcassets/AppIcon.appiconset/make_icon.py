#!/usr/bin/env python3
"""Generate AppIcon.png (1024x1024) matching the Android launcher mark."""
import struct, zlib

S = 1024
BG = (255, 248, 238, 255)      # #FFF8EE
BROWN = (198, 139, 89, 255)    # #C68B59

# Mark geometry (scaled from the Android 108-unit vector, s=15)
CX, CY = 512, 512
SQ_HW, SQ_HH, SQ_R = 420, 390, 120   # rounded square (56x52 units @15)
CIR_X, CIR_Y, CIR_R = 512, 332, 105  # keyhole head
TRAP = [(452, 542), (572, 542), (602, 722), (422, 722)]  # keyhole slot

px = [[BG for _ in range(S)] for _ in range(S)]

def blend(x, y, color, cov):
    if cov <= 0: return
    base = px[y][x]
    if cov >= 1:
        px[y][x] = color
    else:
        px[y][x] = tuple(int(base[i] * (1 - cov) + color[i] * cov) for i in range(4))

# Rounded square (SDF coverage)
for y in range(max(0, CY - SQ_HH - 2), min(S, CY + SQ_HH + 3)):
    for x in range(max(0, CX - SQ_HW - 2), min(S, CX + SQ_HW + 3)):
        dx = abs(x - CX) - (SQ_HW - SQ_R)
        dy = abs(y - CY) - (SQ_HH - SQ_R)
        ox, oy = max(dx, 0), max(dy, 0)
        sdf = (ox * ox + oy * oy) ** 0.5 + min(max(dx, dy), 0) - SQ_R
        cov = min(max(0.5 - sdf, 0.0), 1.0)
        blend(x, y, BROWN, cov)

# Keyhole head (circle)
for y in range(max(0, CIR_Y - CIR_R - 2), min(S, CIR_Y + CIR_R + 3)):
    for x in range(max(0, CIR_X - CIR_R - 2), min(S, CIR_X + CIR_R + 3)):
        d = ((x - CIR_X) ** 2 + (y - CIR_Y) ** 2) ** 0.5 - CIR_R
        cov = min(max(0.5 - d, 0.0), 1.0)
        blend(x, y, BG, cov)

# Keyhole slot (convex quad: max of inward edge distances)
n = len(TRAP)
minx = min(p[0] for p in TRAP) - 2; maxx = max(p[0] for p in TRAP) + 3
miny = min(p[1] for p in TRAP) - 2; maxy = max(p[1] for p in TRAP) + 3
edges = []
for i in range(n):
    ax, ay = TRAP[i]; bx, by = TRAP[(i + 1) % n]
    ex, ey = bx - ax, by - ay
    ln = (ex * ex + ey * ey) ** 0.5
    # inward normal (quad listed clockwise in y-down coords)
    nx, ny = -ey / ln, ex / ln
    edges.append((ax, ay, nx, ny))
for y in range(max(0, miny), min(S, maxy)):
    for x in range(max(0, minx), min(S, maxx)):
        dmin = min((x - ax) * nx + (y - ay) * ny for ax, ay, nx, ny in edges)
        cov = min(max(0.5 + dmin, 0.0), 1.0)
        blend(x, y, BG, cov)

raw = b"".join(b"\x00" + b"".join(struct.pack("4B", *p) for p in row) for row in px)

def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9))
       + chunk(b"IEND", b""))
open("AppIcon.png", "wb").write(png)
print("wrote AppIcon.png", len(png), "bytes")
