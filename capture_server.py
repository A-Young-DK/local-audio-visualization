#!/usr/bin/env python3
import argparse
import json
import math
import queue
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
SR = 48000
BLOCK = 2048
FFT_SIZE = 2048
NBINS = 128
FPS = 30

subscribers = []
subs_lock = threading.Lock()


def broadcast(frame):
    data = "data: " + json.dumps(frame) + "\n\n"
    with subs_lock:
        for q in subscribers:
            q.put(data)


class DemoSource:
    def __init__(self, sr, block):
        self.sr = sr
        self.block = block
        self.t = 0.0
        self.beat_clock = 0.0
        self.freqs = [110.0, 220.0, 330.0, 440.0, 660.0, 880.0]
        self.rng = np.random.default_rng(7)

    def read(self):
        n = self.block
        t = self.t + np.arange(n) / self.sr
        self.t += n / self.sr
        self.beat_clock = (self.beat_clock + n / self.sr) % 0.5
        env = 0.0
        if self.beat_clock < 0.12:
            env = (1 - self.beat_clock / 0.12) ** 2
        sig = np.zeros(n)
        for i, f in enumerate(self.freqs):
            f2 = f * (1 + 0.15 * math.sin(self.t * (0.3 + i * 0.11)))
            sig += (0.22 / (i + 1)) * np.sin(2 * math.pi * f2 * t + i)
        sig += 0.35 * env * np.sin(2 * math.pi * 55 * t)
        sig += 0.55 * env * self.rng.standard_normal(n)
        sig += 0.02 * self.rng.standard_normal(n)
        return (sig * 0.8).astype(np.float64)


class LoopbackSource:
    def __init__(self, device):
        import sounddevice as sd

        self.q = queue.Queue(maxsize=8)
        self.stream = sd.InputStream(
            device=device,
            channels=1,
            dtype="float32",
            callback=self._cb,
        )
        self.stream.start()

    def _cb(self, indata, frames, time_info, status):
        mono = indata[:, 0]
        try:
            self.q.put_nowait(mono.astype(np.float64))
        except queue.Full:
            pass

    def read(self):
        return self.q.get()


WINDOW = np.hanning(FFT_SIZE)
EDGES = np.linspace(0, FFT_SIZE // 2, NBINS + 1).astype(int)


def spectrum(block):
    block = np.asarray(block, dtype=np.float64)[:FFT_SIZE] * WINDOW
    mag = np.abs(np.fft.rfft(block))
    logm = np.log1p(mag * 8.0)
    pooled = np.array(
        [logm[EDGES[i]:EDGES[i + 1]].max() for i in range(NBINS)]
    )
    return pooled


def producer(src, stop):
    smoothed = np.zeros(NBINS)
    peak = 1e-6
    energy_hist = deque(maxlen=45)
    last_beat = 0.0
    while not stop.is_set():
        block = src.read()
        if block is None or len(block) < FFT_SIZE:
            block = np.zeros(FFT_SIZE)
        pooled = spectrum(block)
        peak = max(peak * 0.995, pooled.max(), 1e-6)
        norm = np.clip(pooled / peak, 0.0, 1.0)
        smoothed = np.maximum(norm, smoothed * 0.92)
        energy = float(norm.mean())
        energy_hist.append(energy)
        beat = False
        now = time.monotonic()
        if len(energy_hist) > 20:
            avg = (sum(energy_hist) - energy) / (len(energy_hist) - 1)
            if energy > avg * 1.35 and energy > 0.03 and now - last_beat > 0.28:
                beat = True
                last_beat = now
        frame = {
            "bins": [round(float(x), 4) for x in smoothed],
            "beat": beat,
            "energy": round(energy, 4),
        }
        broadcast(frame)
        time.sleep(1.0 / FPS)


STATIC = {
    "/": ("index.html", "text/html"),
    "/index.html": ("index.html", "text/html"),
    "/visualizer.js": ("visualizer.js", "application/javascript"),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q = queue.Queue(maxsize=240)
            with subs_lock:
                subscribers.append(q)
            try:
                self.wfile.write(b"retry: 1000\n\n")
                self.wfile.flush()
                while True:
                    try:
                        data = q.get(timeout=15)
                    except queue.Empty:
                        data = ": ping\n\n"
                    self.wfile.write(data.encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                with subs_lock:
                    if q in subscribers:
                        subscribers.remove(q)
            return
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        if self.path not in STATIC:
            self.send_response(404)
            self.end_headers()
            return
        name, ctype = STATIC[self.path]
        try:
            body = (ROOT / name).read_bytes()
        except OSError:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def list_devices():
    import sounddevice as sd

    for i, d in enumerate(sd.query_devices()):
        print(
            f"{i}: {d['name']}  inputs={d['max_input_channels']} "
            f"outputs={d['max_output_channels']} sr={d['default_samplerate']}"
        )


def resolve_device(spec):
    import sounddevice as sd

    if spec is None:
        return None
    if spec.isdigit():
        return int(spec)
    for i, d in enumerate(sd.query_devices()):
        if spec.lower() in d["name"].lower() and d["max_input_channels"] > 0:
            return i
    raise SystemExit(f"No input device matching {spec!r}. Run with --list-devices.")


def main():
    ap = argparse.ArgumentParser(
        description="Local loopback audio capture streamed to a web visualizer"
    )
    ap.add_argument("--demo", action="store_true",
                    help="synthesize audio instead of capturing (no device needed)")
    ap.add_argument("--device", default=None,
                    help="input device index or name substring (cable / stereo mix / monitor)")
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()

    if args.list_devices:
        list_devices()
        return

    if args.demo:
        src = DemoSource(SR, BLOCK)
        print("Demo mode: synthesized audio")
    else:
        dev = resolve_device(args.device)
        src = LoopbackSource(dev)
        print(f"Capturing input device: {dev}")

    stop = threading.Event()
    threading.Thread(target=producer, args=(src, stop), daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Open http://{args.host}:{args.port}/ in Firefox")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        stop.set()


if __name__ == "__main__":
    main()
