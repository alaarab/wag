"""Keeps Kyutai's pocket-tts loaded and says lines as they come, for `npm run make` with WAG_TTS=pocket.

    python pocket.py VOICE      VOICE: one of its own voices (alba, marius, ...) or a wav to sound like

One JSON object per line on stdin: {"id": "...", "text": "...", "out": "/path/file.wav"}
One JSON object per line on stdout: {"ready": true} once, then {"id": "..."} or {"id": "...", "error": "..."}
"""
import json
import sys

try:
    import scipy.io.wavfile
    from pocket_tts import TTSModel

    model = TTSModel.load_model()
    state = model.get_state_for_audio_prompt(sys.argv[1])
except Exception as error:  # say why, so the one who asked can tell the person
    print(json.dumps({"failed": str(error)}), flush=True)
    sys.exit(1)

print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    ask = {}
    try:
        ask = json.loads(line)
        audio = model.generate_audio(state, ask["text"])
        scipy.io.wavfile.write(ask["out"], model.sample_rate, audio.numpy())
        print(json.dumps({"id": ask["id"]}), flush=True)
    except Exception as error:  # keep serving: one bad line must not end the run
        print(json.dumps({"id": ask.get("id"), "error": str(error)}), flush=True)
