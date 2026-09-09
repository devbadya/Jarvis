# SnapLine Cable Manager

Desk cable comb for Bambu Studio. Open `cable-manager.3mf` in the **Prepare** tab, then **Slice plate**.

**80.6 × 28.0 × 15.6 mm** · six snap-in slots · prints flat, no supports

## Slots

Cables drop in from the top. The opening is narrower than the jacket, so they click in.

| Label | Opening | Typical cable              |
| ----- | ------- | -------------------------- |
| 4     | 4.4 mm  | thin USB-C, Lightning, aux |
| 5     | 5.4 mm  | USB-C / Lightning jackets  |
| 6     | 6.4 mm  | USB-A, thicker USB-C       |
| 7     | 7.6 mm  | HDMI, DisplayPort          |
| 9     | 9.0 mm  | DC barrel, chunky USB      |
| 11    | 11.2 mm | laptop power brick         |

Raised numbers sit on the front edge and are a second object in the `.3mf` — assign them a contrast filament on the H2C (white or pink on black).

## Print (H2C)

- Printer: Bambu Lab H2C
- Plate: Textured PEI
- Profile: `0.20mm Standard @BBL H2C`
- Material: PLA (PETG is fine)
- Supports: off
- Infill: 15 %
- Walls: 2 or 3
- Brim: off
- Stick-down: double-sided tape on the flat bottom

About 12–18 g of PLA. One colour works; two colours need no AMS if you map body → left nozzle and labels → right nozzle.

## Files

| File                | Use                                   |
| ------------------- | ------------------------------------- |
| `cable-manager.3mf` | Open this in Bambu Studio             |
| `cable-manager.stl` | Geometry only, if you slice elsewhere |
| `preview.svg`       | Front + top drawing                   |
| `generate.py`       | Rebuild after changing sizes          |

```bash
python3 prints/cable-manager/generate.py --check
```

Slot diameters and the snap ratio live at the top of `generate.py`.
