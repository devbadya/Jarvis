#!/usr/bin/env python3
"""Generate a print-ready desk cable manager (STL + 3MF) for Bambu Studio."""

from __future__ import annotations

import argparse
import math
import struct
import zipfile
from pathlib import Path

# --- printable millimetres, snapped to 0.2 mm layers ---

DEPTH = 28.0
HEIGHT = 15.6
FRONT_WALL = 4.0
BACK_WALL = 3.6
FLOOR = 2.8
CHAMFER = 1.2
SNAP = 0.76
ARC_SEGMENTS = 20
END_PAD = 6.8
DIVIDER = 4.6

# (label, inner diameter) — sized for common cable jackets
SLOTS: list[tuple[str, float]] = [
    ("4", 4.4),
    ("5", 5.4),
    ("6", 6.4),
    ("7", 7.6),
    ("9", 9.0),
    ("11", 11.2),
]

LENGTH = round(END_PAD * 2 + sum(d for _, d in SLOTS) + DIVIDER * (len(SLOTS) - 1), 2)

# 5x7 bitmap font for raised top labels
FONT: dict[str, list[str]] = {
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "4": ["01010", "01010", "01010", "01111", "00010", "00010", "00010"],
    "5": ["01111", "01000", "01110", "00001", "00001", "01001", "00110"],
    "6": ["00110", "01000", "01110", "01001", "01001", "01001", "00110"],
    "7": ["01111", "00001", "00010", "00010", "00100", "00100", "00100"],
    "9": ["00110", "01001", "01001", "00111", "00001", "00010", "01100"],
}

PIXEL = 0.72
PIXEL_GAP = 0.18
LABEL_RELIEF = 0.6


def _slot_layout() -> list[tuple[str, float, float]]:
    """Return (label, diameter, center_x) for each slot."""
    widths = [d for _, d in SLOTS]
    inner = sum(widths) + DIVIDER * (len(SLOTS) - 1)
    assert abs((END_PAD * 2 + inner) - LENGTH) < 0.05, (END_PAD * 2 + inner, LENGTH)
    x = END_PAD
    placed: list[tuple[str, float, float]] = []
    for label, diameter in SLOTS:
        placed.append((label, diameter, x + diameter / 2.0))
        x += diameter + DIVIDER
    return placed


def _opening(diameter: float) -> float:
    return max(3.2, diameter * SNAP)


def _throat_z(diameter: float) -> float:
    radius = diameter / 2.0
    half_open = _opening(diameter) / 2.0
    center_z = FLOOR + radius
    return center_z - math.sqrt(max(radius * radius - half_open * half_open, 1e-6))


def _outer_box() -> list[tuple[float, float]]:
    """CCW XZ outline of the solid block (no slots)."""
    return [
        (0.0, 0.0),
        (LENGTH, 0.0),
        (LENGTH, HEIGHT - CHAMFER),
        (LENGTH - CHAMFER, HEIGHT),
        (CHAMFER, HEIGHT),
        (0.0, HEIGHT - CHAMFER),
    ]


def _slotted_profile() -> list[tuple[float, float]]:
    """CCW XZ outline of the body with snap-in U-slots cut from the top."""
    poly: list[tuple[float, float]] = [
        (0.0, 0.0),
        (LENGTH, 0.0),
        (LENGTH, HEIGHT - CHAMFER),
        (LENGTH - CHAMFER, HEIGHT),
    ]
    for label, diameter, cx in reversed(_slot_layout()):
        del label
        radius = diameter / 2.0
        half_open = _opening(diameter) / 2.0
        center_z = FLOOR + radius
        z_th = _throat_z(diameter)
        theta_right = math.atan2(z_th - center_z, half_open)
        theta_left = math.atan2(z_th - center_z, -half_open)
        poly.append((cx + half_open, HEIGHT))
        poly.append((cx + half_open, z_th))
        for i in range(1, ARC_SEGMENTS):
            t = i / ARC_SEGMENTS
            theta = theta_right + (theta_left - theta_right) * t
            poly.append((cx + radius * math.cos(theta), center_z + radius * math.sin(theta)))
        poly.append((cx - half_open, z_th))
        poly.append((cx - half_open, HEIGHT))
    poly.append((CHAMFER, HEIGHT))
    poly.append((0.0, HEIGHT - CHAMFER))
    return _clean_poly(poly)


def _clean_poly(poly: list[tuple[float, float]]) -> list[tuple[float, float]]:
    cleaned: list[tuple[float, float]] = []
    for x, z in poly:
        if cleaned and abs(cleaned[-1][0] - x) < 1e-9 and abs(cleaned[-1][1] - z) < 1e-9:
            continue
        cleaned.append((x, z))
    if len(cleaned) > 1 and abs(cleaned[0][0] - cleaned[-1][0]) < 1e-9 and abs(cleaned[0][1] - cleaned[-1][1]) < 1e-9:
        cleaned.pop()
    return cleaned


def _area(poly: list[tuple[float, float]]) -> float:
    total = 0.0
    for i, (x1, z1) in enumerate(poly):
        x2, z2 = poly[(i + 1) % len(poly)]
        total += x1 * z2 - x2 * z1
    return 0.5 * total


def _cross(ax: float, az: float, bx: float, bz: float, cx: float, cz: float) -> float:
    return (bx - ax) * (cz - az) - (bz - az) * (cx - ax)


def _in_triangle(
    px: float,
    pz: float,
    ax: float,
    az: float,
    bx: float,
    bz: float,
    cx: float,
    cz: float,
) -> bool:
    c0 = _cross(ax, az, bx, bz, px, pz)
    c1 = _cross(bx, bz, cx, cz, px, pz)
    c2 = _cross(cx, cz, ax, az, px, pz)
    return (c0 >= -1e-9 and c1 >= -1e-9 and c2 >= -1e-9) or (c0 <= 1e-9 and c1 <= 1e-9 and c2 <= 1e-9)


def triangulate(poly: list[tuple[float, float]]) -> list[tuple[int, int, int]]:
    pts = list(poly)
    if _area(pts) < 0:
        pts.reverse()
        poly[:] = pts
    idx = list(range(len(pts)))
    triangles: list[tuple[int, int, int]] = []
    guard = 0
    while len(idx) > 3:
        guard += 1
        if guard > 10_000:
            raise RuntimeError("ear clipping failed")
        n = len(idx)
        found = False
        for i in range(n):
            i0, i1, i2 = idx[(i - 1) % n], idx[i], idx[(i + 1) % n]
            ax, az = pts[i0]
            bx, bz = pts[i1]
            cx, cz = pts[i2]
            if _cross(ax, az, bx, bz, cx, cz) <= 1e-12:
                continue
            if any(
                j not in (i0, i1, i2) and _in_triangle(pts[j][0], pts[j][1], ax, az, bx, bz, cx, cz)
                for j in idx
            ):
                continue
            triangles.append((i0, i1, i2))
            del idx[i]
            found = True
            break
        if not found:
            raise RuntimeError("no ear found — profile is not a simple polygon")
    triangles.append((idx[0], idx[1], idx[2]))
    return triangles


class Mesh:
    def __init__(self, name: str) -> None:
        self.name = name
        self.vertices: list[tuple[float, float, float]] = []
        self._index: dict[tuple[float, float, float], int] = {}
        self.triangles: list[tuple[int, int, int]] = []

    def _v(self, x: float, y: float, z: float) -> int:
        key = (round(x, 5), round(y, 5), round(z, 5))
        found = self._index.get(key)
        if found is not None:
            return found
        idx = len(self.vertices)
        self._index[key] = idx
        self.vertices.append(key)
        return idx

    def add_tri(
        self,
        a: tuple[float, float, float],
        b: tuple[float, float, float],
        c: tuple[float, float, float],
    ) -> None:
        i, j, k = self._v(*a), self._v(*b), self._v(*c)
        if i == j or j == k or i == k:
            return
        self.triangles.append((i, j, k))

    def add_box(self, x0: float, y0: float, z0: float, x1: float, y1: float, z1: float) -> None:
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if z1 < z0:
            z0, z1 = z1, z0
        if x1 - x0 < 1e-6 or y1 - y0 < 1e-6 or z1 - z0 < 1e-6:
            return
        corners = [
            (x0, y0, z0),
            (x1, y0, z0),
            (x1, y1, z0),
            (x0, y1, z0),
            (x0, y0, z1),
            (x1, y0, z1),
            (x1, y1, z1),
            (x0, y1, z1),
        ]
        faces = (
            (0, 1, 2, 3),
            (4, 7, 6, 5),
            (0, 4, 5, 1),
            (3, 2, 6, 7),
            (0, 3, 7, 4),
            (1, 5, 6, 2),
        )
        for a, b, c, d in faces:
            self.add_tri(corners[a], corners[b], corners[c])
            self.add_tri(corners[a], corners[c], corners[d])

    def extrude(self, poly: list[tuple[float, float]], y0: float, y1: float) -> None:
        if y1 < y0:
            y0, y1 = y1, y0
        tris = triangulate(poly)
        for i, (x0, z0) in enumerate(poly):
            x1, z1 = poly[(i + 1) % len(poly)]
            a = (x0, y0, z0)
            b = (x1, y0, z1)
            c = (x1, y1, z1)
            d = (x0, y1, z0)
            self.add_tri(a, b, c)
            self.add_tri(a, c, d)
        for i0, i1, i2 in tris:
            x0, z0 = poly[i0]
            x1, z1 = poly[i1]
            x2, z2 = poly[i2]
            self.add_tri((x0, y1, z0), (x1, y1, z1), (x2, y1, z2))
            self.add_tri((x0, y0, z0), (x2, y0, z2), (x1, y0, z1))

    def bbox(self) -> tuple[float, float, float, float, float, float]:
        xs = [v[0] for v in self.vertices]
        ys = [v[1] for v in self.vertices]
        zs = [v[2] for v in self.vertices]
        return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)

    def volume(self) -> float:
        vol = 0.0
        for i, j, k in self.triangles:
            ax, ay, az = self.vertices[i]
            bx, by, bz = self.vertices[j]
            cx, cy, cz = self.vertices[k]
            vol += (
                ax * (by * cz - bz * cy)
                - ay * (bx * cz - bz * cx)
                + az * (bx * cy - by * cx)
            )
        return abs(vol) / 6.0

    def open_edges(self) -> int:
        counts: dict[tuple[int, int], int] = {}
        for i, j, k in self.triangles:
            for a, b in ((i, j), (j, k), (k, i)):
                edge = (a, b) if a < b else (b, a)
                counts[edge] = counts.get(edge, 0) + 1
        return sum(1 for n in counts.values() if n != 2)


def _label_boxes(mesh: Mesh) -> None:
    col_w = PIXEL + PIXEL_GAP
    for label, diameter, cx in _slot_layout():
        glyphs = [FONT[ch] for ch in label]
        glyph_w = 5 * col_w - PIXEL_GAP
        total_w = len(glyphs) * glyph_w + max(0, len(glyphs) - 1) * PIXEL
        x0 = cx - total_w / 2.0
        y0 = 0.7
        z0 = HEIGHT
        x = x0
        for glyph in glyphs:
            for row in glyph:
                for c, bit in enumerate(row):
                    if bit != "1":
                        continue
                    mesh.add_box(
                        x + c * col_w,
                        y0,
                        z0,
                        x + c * col_w + PIXEL,
                        y0 + PIXEL + 0.15,
                        z0 + LABEL_RELIEF,
                    )
            x += glyph_w + PIXEL
        del diameter


def build_body() -> Mesh:
    mesh = Mesh("cable-manager-body")
    mesh.extrude(_slotted_profile(), FRONT_WALL, DEPTH - BACK_WALL)
    mesh.extrude(_outer_box(), 0.0, FRONT_WALL)
    mesh.extrude(_outer_box(), DEPTH - BACK_WALL, DEPTH)
    return mesh


def build_labels() -> Mesh:
    mesh = Mesh("cable-manager-labels")
    _label_boxes(mesh)
    return mesh


def write_stl(mesh: Mesh, path: Path) -> None:
    data = bytearray(80)
    data.extend(struct.pack("<I", len(mesh.triangles)))
    for i, j, k in mesh.triangles:
        ax, ay, az = mesh.vertices[i]
        bx, by, bz = mesh.vertices[j]
        cx, cy, cz = mesh.vertices[k]
        nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
        ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
        nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        data.extend(
            struct.pack(
                "<12fH",
                nx / length,
                ny / length,
                nz / length,
                ax,
                ay,
                az,
                bx,
                by,
                bz,
                cx,
                cy,
                cz,
                0,
            )
        )
    path.write_bytes(data)


def _mesh_xml(mesh: Mesh, object_id: int) -> str:
    verts = "\n".join(f'         <vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}" />' for x, y, z in mesh.vertices)
    tris = "\n".join(f'         <triangle v1="{a}" v2="{b}" v3="{c}" />' for a, b, c in mesh.triangles)
    return f"""    <object id="{object_id}" name="{mesh.name}" type="model">
      <mesh>
        <vertices>
{verts}
        </vertices>
        <triangles>
{tris}
        </triangles>
      </mesh>
    </object>"""


def write_3mf(meshes: list[Mesh], path: Path) -> None:
    objects = "\n".join(_mesh_xml(mesh, i + 1) for i, mesh in enumerate(meshes))
    items = "\n".join(f'    <item objectid="{i + 1}" />' for i in range(len(meshes)))
    model = f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">SnapLine Cable Manager</metadata>
  <metadata name="Designer">Jarvis prints</metadata>
  <resources>
{objects}
  </resources>
  <build>
{items}
  </build>
</model>
"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
"""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("3D/3dmodel.model", model)


def write_svg(path: Path) -> None:
    scale = 6.0
    pad = 28
    width = max(LENGTH * scale + pad * 2, 560)
    front_h = HEIGHT * scale + 56
    top_h = DEPTH * scale + 48
    svg_h = front_h + top_h + 120
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{svg_h:.0f}" '
        f'viewBox="0 0 {width:.1f} {svg_h:.1f}">',
        '<rect width="100%" height="100%" fill="#14161a"/>',
        '<text x="28" y="26" fill="#f4f4f5" font-family="ui-sans-serif,sans-serif" font-size="18" font-weight="600">'
        "SnapLine Cable Manager</text>",
        f'<text x="28" y="46" fill="#a1a1aa" font-family="ui-sans-serif,sans-serif" font-size="12">'
        f"{LENGTH:.1f} × {DEPTH:.0f} × {HEIGHT:.1f} mm · 6 snap slots · no supports</text>",
    ]

    def sx(x: float) -> float:
        return pad + x * scale

    def draw_poly(poly: list[tuple[float, float]], y_off: float) -> None:
        cmds = []
        for i, (x, z) in enumerate(poly):
            yy = y_off + (HEIGHT - z) * scale
            cmds.append(("M" if i == 0 else "L") + f"{sx(x):.2f},{yy:.2f}")
        parts.append(
            f'<path d="{" ".join(cmds)} Z" fill="#3f3f46" stroke="#e4e4e7" stroke-width="1.2"/>'
        )

    draw_poly(_slotted_profile(), 64)
    parts.append(
        f'<text x="{sx(LENGTH / 2):.1f}" y="{64 + HEIGHT * scale + 18:.1f}" fill="#a1a1aa" '
        f'text-anchor="middle" font-family="ui-sans-serif,sans-serif" font-size="11">front</text>'
    )
    top_off = front_h + 28
    parts.append(
        f'<rect x="{sx(0):.2f}" y="{top_off:.2f}" width="{LENGTH * scale:.2f}" '
        f'height="{DEPTH * scale:.2f}" rx="5" fill="#3f3f46" stroke="#e4e4e7" stroke-width="1.2"/>'
    )
    for label, diameter, cx in _slot_layout():
        w = _opening(diameter)
        x = sx(cx - w / 2)
        y = top_off + FRONT_WALL * scale
        h = (DEPTH - FRONT_WALL - BACK_WALL) * scale
        parts.append(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w * scale:.2f}" height="{h:.2f}" '
            f'rx="{min(w * scale / 2, 14):.2f}" fill="#18181b" stroke="#a1a1aa"/>'
        )
        parts.append(
            f'<text x="{sx(cx):.2f}" y="{top_off - 6:.1f}" fill="#fafafa" text-anchor="middle" '
            f'font-family="ui-sans-serif,sans-serif" font-size="12">{label}</text>'
        )
    legend = "4 thin USB-C / Lightning   ·   5 USB-C   ·   6 USB-A   ·   7 HDMI   ·   9 DC   ·   11 laptop PSU"
    parts.append(
        f'<text x="28" y="{svg_h - 24:.1f}" fill="#a1a1aa" font-family="ui-sans-serif,sans-serif" '
        f'font-size="11">{legend}</text>'
    )
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")


def validate(body: Mesh, labels: Mesh) -> None:
    for mesh in (body, labels):
        if not mesh.triangles:
            raise SystemExit(f"{mesh.name}: empty mesh")
        open_edges = mesh.open_edges()
        if mesh is body and open_edges > 80:
            raise SystemExit(f"{mesh.name}: {open_edges} open edges (mesh looks broken)")
        if open_edges:
            print(f"note  {mesh.name}: {open_edges} open edges (joined solids; slicer-safe)")
    xmin, ymin, zmin, xmax, ymax, zmax = body.bbox()
    if xmin < -0.05 or ymin < -0.05 or zmin < -0.05:
        raise SystemExit(f"body extends below origin: {body.bbox()}")
    if abs(xmax - LENGTH) > 0.15 or abs(ymax - DEPTH) > 0.15:
        raise SystemExit(f"unexpected body footprint: {body.bbox()}")
    if zmax < HEIGHT - 0.05:
        raise SystemExit(f"body too short: zmax={zmax}")
    vol = body.volume()
    if vol < 8_000 or vol > 40_000:
        raise SystemExit(f"implausible volume {vol:.1f} mm³")
    lx0, ly0, lz0, lx1, ly1, lz1 = labels.bbox()
    if lz0 < HEIGHT - 0.05 or ly0 < 0:
        raise SystemExit(f"labels not on the top face: {labels.bbox()}")
    if lx0 < 0 or lx1 > LENGTH:
        raise SystemExit(f"labels overflow X: {labels.bbox()}")
    print(
        f"ok  body {len(body.triangles)} tris, {vol:.0f} mm³, "
        f"bbox {xmax - xmin:.1f}×{ymax - ymin:.1f}×{zmax - zmin:.1f} mm; "
        f"labels {len(labels.triangles)} tris"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--check", action="store_true", help="validate only after writing")
    args = parser.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    body = build_body()
    labels = build_labels()
    validate(body, labels)

    combined = Mesh("cable-manager")
    combined.vertices = list(body.vertices)
    combined._index = {v: i for i, v in enumerate(combined.vertices)}
    combined.triangles = list(body.triangles)
    offset = len(combined.vertices)
    for v in labels.vertices:
        combined.vertices.append(v)
    for a, b, c in labels.triangles:
        combined.triangles.append((a + offset, b + offset, c + offset))

    write_stl(combined, out / "cable-manager.stl")
    write_3mf([body, labels], out / "cable-manager.3mf")
    write_svg(out / "preview.svg")
    print(f"wrote {out / 'cable-manager.3mf'}")
    print(f"wrote {out / 'cable-manager.stl'}")
    print(f"wrote {out / 'preview.svg'}")
    if args.check:
        return


if __name__ == "__main__":
    main()
