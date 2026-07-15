#!/usr/bin/env python3
"""Rebuild Day 2 silent demo MP4 from Sprint Room captures. Intermediates → _build/."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BUILD = HERE / "_build"
W, H = 1440, 1080
BG = (0, 0, 0)
TEAL = (56, 189, 168)
WHITE = (245, 248, 250)
MUTED = (170, 178, 186)
ACCENT = (120, 220, 200)
CARD_SECS = 4
CONTENT_SECS = 6
FULL_SECS = 7
OUT = HERE / "day-02-multiplayer-workspace-demo.mp4"

# Product stills (John → Zack → inputs → top → bottom → result)
SRC = {
    "john": HERE / "room-01-john.png",
    "multi": HERE / "room-02-multi.png",
    "inputs": HERE / "room-03-inputs.png",
    "top": HERE / "room-04-top.png",
    "bottom": HERE / "room-05-bottom.png",
    "result": HERE / "room-06-result.png",
}


def font(size: int, bold: bool = False):
    candidates = [
        "/usr/share/fonts/montserrat-fonts/Montserrat-Bold.ttf"
        if bold
        else "/usr/share/fonts/montserrat-fonts/Montserrat-Regular.ttf",
        "/usr/share/fonts/google-noto/NotoSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/google-noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/abattis-cantarell/Cantarell-Bold.otf"
        if bold
        else "/usr/share/fonts/abattis-cantarell/Cantarell-Regular.otf",
        "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_centered(draw, lines, gap: int = 18) -> None:
    measured = []
    total_h = 0
    for text, fnt, color in lines:
        bbox = draw.textbbox((0, 0), text, font=fnt)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        measured.append((text, fnt, color, tw, th))
        total_h += th + gap
    total_h -= gap
    y = (H - total_h) // 2
    for text, fnt, color, tw, th in measured:
        draw.text(((W - tw) // 2, y), text, font=fnt, fill=color)
        y += th + gap


def black_card(path: Path, lines) -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, 8], fill=TEAL)
    draw.rectangle([0, H - 8, W, H], fill=TEAL)
    draw_centered(draw, lines)
    img.save(path)


def fit_on_black(src_path: Path, out_path: Path) -> None:
    src = Image.open(src_path).convert("RGBA")
    scale = min(W / src.width, H / src.height)
    nw, nh = max(1, int(src.width * scale)), max(1, int(src.height * scale))
    src = src.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (W, H), BG)
    canvas.paste(src, ((W - nw) // 2, (H - nh) // 2), src)
    canvas.save(out_path)


def pick_encoder() -> str:
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-encoders"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if "libx264" in out:
        return "libx264"
    if "libopenh264" in out:
        return "libopenh264"
    raise SystemExit("No H.264 encoder (need libx264 or libopenh264)")


def build_assets() -> None:
    BUILD.mkdir(exist_ok=True)
    title_f = font(64, True)
    sub_f = font(36, True)
    body_f = font(32)

    black_card(
        BUILD / "title.png",
        [
            ("Sprint Room", title_f, WHITE),
            ("Day 2 · multiplayer workspace", sub_f, ACCENT),
            ("Kiro Birthday 2026", body_f, MUTED),
        ],
    )
    black_card(
        BUILD / "card-john.png",
        [
            ("John joins", title_f, WHITE),
            ("one human + Sprint AI", body_f, ACCENT),
        ],
    )
    black_card(
        BUILD / "card-zack.png",
        [
            ("Zack joins", title_f, WHITE),
            ("multiplayer", body_f, ACCENT),
        ],
    )
    black_card(
        BUILD / "card-inputs.png",
        [
            ("Shared inputs", title_f, WHITE),
            ("ideas sync for everyone", body_f, ACCENT),
        ],
    )
    black_card(
        BUILD / "card-top.png",
        [
            ("Room · top", title_f, WHITE),
            ("presence · inputs · clarify", body_f, ACCENT),
        ],
    )
    black_card(
        BUILD / "card-bottom.png",
        [
            ("Room · bottom", title_f, WHITE),
            ("tasks · notes · export", body_f, ACCENT),
        ],
    )
    black_card(
        BUILD / "card-result.png",
        [
            ("Sprint packet", title_f, WHITE),
            ("goal · scope · tasks", body_f, ACCENT),
        ],
    )
    black_card(
        BUILD / "end.png",
        [
            ("Built with Kiro", title_f, WHITE),
            ("#BuildWithKiro #TeamKiro @kirodotdev", body_f, WHITE),
        ],
    )

    for key, src in SRC.items():
        if not src.exists():
            raise SystemExit(f"Missing source capture: {src.name}")
        fit_on_black(src, BUILD / f"slide-{key}.png")


def run_ffmpeg(encoder: str) -> None:
    inputs = [
        ("title.png", CARD_SECS),
        ("card-john.png", CARD_SECS),
        ("slide-john.png", CONTENT_SECS),
        ("card-zack.png", CARD_SECS),
        ("slide-multi.png", CONTENT_SECS),
        ("card-inputs.png", CARD_SECS),
        ("slide-inputs.png", CONTENT_SECS),
        ("card-top.png", CARD_SECS),
        ("slide-top.png", FULL_SECS),
        ("card-bottom.png", CARD_SECS),
        ("slide-bottom.png", FULL_SECS),
        ("card-result.png", CARD_SECS),
        ("slide-result.png", FULL_SECS),
        ("end.png", CARD_SECS),
    ]

    cmd: list[str] = ["ffmpeg", "-y"]
    for name, secs in inputs:
        cmd += ["-loop", "1", "-t", str(secs), "-i", name]

    n = len(inputs)
    filters = []
    for i in range(n):
        filters.append(f"[{i}:v]scale={W}:{H},setsar=1,fps=30,format=yuv420p[v{i}]")
    concat_in = "".join(f"[v{i}]" for i in range(n))
    filters.append(f"{concat_in}concat=n={n}:v=1:a=0[outv]")
    filter_complex = ";".join(filters)

    cmd += [
        "-filter_complex",
        filter_complex,
        "-map",
        "[outv]",
        "-an",
        "-c:v",
        encoder,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(OUT),
    ]
    if encoder == "libx264":
        i = cmd.index("libx264")
        cmd[i + 1 : i + 1] = ["-preset", "medium", "-crf", "20"]
    else:
        cmd += ["-b:v", "2500k"]

    print(f"Encoding {n} segments → {OUT.name}")
    subprocess.run(cmd, cwd=BUILD, check=True)
    print(f"Wrote {OUT}")


def main() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH")
    encoder = pick_encoder()
    print(f"Using encoder: {encoder}")
    build_assets()
    run_ffmpeg(encoder)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.returncode)
