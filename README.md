# local-audio-visualization

A local audio visualizer for music playing in Firefox (works for Pandora or any
other source). Because Pandora streams DRM-protected audio, the browser will
not hand the tab's audio to a script, so instead we capture **system loopback
audio** (what your speakers are playing) and stream the spectrum to a local
web page that renders randomized patterns and colors.

Everything runs on `127.0.0.1` only — nothing leaves your machine.

## How it works

```
Pandora in Firefox -> speakers + loopback capture -> capture_server.py (FFT)
    -> Server-Sent Events on http://127.0.0.1:8080/stream -> visualizer.js (canvas)
```

- `capture_server.py` captures audio, computes a 128-bin spectrum at 30 fps,
  does beat detection, and broadcasts frames over SSE.
- `visualizer.js` picks a random pattern (bars, mirror, radial, wave,
  particles, tunnel, mountains) every 5–14 s with a crossfade, generates a
  random color palette each switch (mono / analogous / complementary /
  triadic / neon / fully random), drifts the hue over time, and pulses on
  detected beats.

## Setup

```bash
pip install -r requirements.txt
python capture_server.py --list-devices     # find your loopback device
python capture_server.py --device "CABLE"   # or index, e.g. --device 3
```

Then open **http://127.0.0.1:8080/** in Firefox and click the page for
fullscreen. Play Pandora. Use `--demo` to try it with synthesized audio and
no audio hardware at all.

### Getting loopback audio per OS

Firefox follows the system default output, so set the system output to the
virtual device, then capture its input side:

- **Windows**: either enable *Stereo Mix* (Settings > Sound > More sound
  settings > Recording > right-click > Show disabled devices > Enable) and
  capture "Stereo Mix", or install [VB-CABLE](https://vb-audio.com/Cable/),
  set the default playback device to "CABLE Input", and run with
  `--device "CABLE Output"`.
- **macOS**: install [BlackHole 2ch](https://existential.audio/blackhole/),
  create a *Multi-Output Device* (Audio MIDI Setup) containing your speakers
  plus BlackHole, set it as the system output, and run with
  `--device "BlackHole 2ch"`.
- **Linux (PulseAudio/PipeWire)**: capture the monitor of your sink, e.g.
  `pactl list sources | grep -i monitor`, then
  `--device "alsa_output...monitor"` (or just use the default input if it is
  already the monitor).

## Options

```
python capture_server.py --help
  --demo            synthesized audio, no capture device needed (testing)
  --device NAME     device index or name substring
  --list-devices    print all input devices
  --host / --port   default 127.0.0.1:8080
```

Tip: run it with `--demo` first to confirm the visuals, then switch to your
real loopback device.
