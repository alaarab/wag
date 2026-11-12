"""Keeps a Piper voice loaded and speaks lines as they come, so a live session does not wait for the voice to start.

One JSON object per line on stdin: {"id": "...", "text": "...", "out": "/path/file.wav"}
One JSON object per line on stdout: {"id": "...", "seconds": 4.2} or {"id": "...", "error": "..."}
Run with the Python that has piper-tts installed:  python voice.py /path/voice.onnx
"""
import json
import sys
import wave

from piper import PiperVoice

voice = PiperVoice.load(sys.argv[1])
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        ask = json.loads(line)
        with wave.open(ask["out"], "wb") as out:
            voice.synthesize_wav(ask["text"], out)
        with wave.open(ask["out"], "rb") as made:
            seconds = made.getnframes() / made.getframerate()
        print(json.dumps({"id": ask["id"], "seconds": round(seconds, 2)}), flush=True)
    except Exception as error:  # keep serving: one bad line must not end the session
        print(json.dumps({"id": ask.get("id") if isinstance(ask, dict) else None, "error": str(error)}), flush=True)
