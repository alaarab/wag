#!/usr/bin/env bash
# An answerer for the Ask box: Claude Code, as one conversation for the whole session.
#
#   node scripts/session.mjs ... --ask scripts/ask.sh
#
# session.mjs runs this once per question, with the question and where the person is on its input.
# The assistant may look at the page with the `guide` command and nothing else, and answers with
# one `guide say`. The bridge still refuses anything that saves, posts or sends, and in a live session
# any download, whatever it tries. What it cannot answer from the pages it keeps with `guide open`.
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
prompt="${ASK_PROMPT:-You are a guide sitting beside someone who is working through a web page. Each message says where they are, what the page shows now, and what they ask. Be quick: when what the page shows answers them, answer at once with exactly one 'guide say \"one or two short plain sentences\" --point \"words on the page\" --note \"a few words\"', which rings the cell or row you mean and says the answer, using figures read off the page. Look further only when you must: 'guide find \"words\"' finds text anywhere on the page, behind a dialog too, and gives the whole table row it is in; 'guide read' reads the open dialog or the page again. You may open things to look: 'guide click \"words\"', 'guide choose \"the choice\" --from \"role=combobox:the label of the list\"', 'guide goto /address', 'guide close'. The bridge refuses anything that changes something and any download, and when it refuses you say in one sentence that this is their own click, and you do not try another way. If they ask you to save, post, approve, submit, delete, send or download something, do not try it: say it is their own click, and keep a note of it with 'guide open \"what they asked for\" --why \"that click is their own\"'. You have only the pages: no database and no files of figures. When the pages do not show the answer, say so plainly in your guide say and run 'guide open \"the question in your own words\" --why \"what would be needed to answer it\"' so it is kept for later. Never write the name of a person in guide say or guide open: use their number or their role. Print nothing else.}"
ask() { claude -p "$question" --model "${GUIDE_MODEL:-haiku}" "$@" --setting-sources project --strict-mcp-config --allowedTools "Bash(guide:*)" "Read(./*.md)" --append-system-prompt "$prompt"; }
# the first question starts the conversation and the rest carry it on; if it was lost, start again
if [ "${WAG_ASK_N:-1}" -gt 1 ]; then ask --resume "$WAG_ASK_ID" || ask; else ask --session-id "$WAG_ASK_ID"; fi
