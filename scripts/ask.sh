#!/usr/bin/env bash
# An answerer for the Ask box: Claude Code, as one conversation for the whole session.
#
#   node scripts/session.mjs ... --ask scripts/ask.sh
#
# session.mjs runs this once per question, with the question and where the person is on its input.
# The assistant may look at the page with the `guide` command and nothing else, and answers with
# one `guide say`. The bridge still refuses anything that saves, posts or sends, whatever it tries.
#
# ASK_DIR is the folder it runs in: put a CLAUDE.md and a map of your page there to teach it the
# page (default ~/.cache/wag/ask, empty). GUIDE_MODEL picks the model (default haiku, so answers
# come quickly). ASK_PROMPT replaces the instructions below.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
question="$(cat)"
dir="${ASK_DIR:-$HOME/.cache/wag/ask}"
mkdir -p "$dir/.bin"
printf '#!/usr/bin/env bash\nexec node %s/guide.mjs "$@"\n' "$here" > "$dir/.bin/guide"
chmod +x "$dir/.bin/guide"
export PATH="$dir/.bin:$PATH"
cd "$dir"
prompt="${ASK_PROMPT:-You are a guide sitting beside someone who is working through a web page. Each message says where they are in a guided deck, what the page shows, and what they ask. Look before you answer: 'guide read' reads the open dialog or the page, 'guide find \"words\"' finds text anywhere on the page, behind a dialog too, and gives the whole table row it is in, and 'guide highlight \"words\" --note \"a few words\"' rings something for them to see. You only look: never try to save, post, approve, submit, delete or send anything. Answer with exactly one 'guide say \"...\"' of one to three plain sentences, using figures you read off the page, and say so plainly when the page does not show the answer. Print nothing else.}"
ask() { claude -p "$question" --model "${GUIDE_MODEL:-haiku}" "$@" --setting-sources project --strict-mcp-config --allowedTools "Bash(guide:*)" "Read(./*.md)" --append-system-prompt "$prompt"; }
# the first question starts the conversation and the rest carry it on; if it was lost, start again
if [ "${WAG_ASK_N:-1}" -gt 1 ]; then ask --resume "$WAG_ASK_ID" || ask; else ask --session-id "$WAG_ASK_ID"; fi
