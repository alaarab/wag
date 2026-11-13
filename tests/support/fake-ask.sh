#!/usr/bin/env bash
# A stand-in answerer for the tests: it looks, points and says with the guide command, as a real one
# does, and for some questions it tries what a guide may not do, so the refusal can be seen.
question="$(cat)"
here="$(cd "$(dirname "$0")" && pwd)"
g() { node "$here/../../scripts/guide.mjs" "$@" >/dev/null 2>&1 || true; }
[ -n "${WAG_TEST_ASKED:-}" ] && printf '%s\n' "$WAG_ASK_CONTEXT" >> "$WAG_TEST_ASKED"
# only what they asked: the message also carries the page's own words
asked="${question##*They ask: }"
case "$asked" in
  *"start the walk"*) g walk start guided; g say "Starting the walkthrough." ;;
  *"show marzember"*) g goto "/app.html?month=marzember"; g say "This is Marzember." --point "Biscuits bought on the tea budget" --note "The first item" ;;
  *"post it"*) g click "Post entry"; g say "Posting is your own click." ;;
  *"download it"*) g click "Download the entry"; g say "A download is your own click." ;;
  *"last year"*) g open "What the snack budget was last year" --why "the page only shows two months"; g say "The page does not show last year." ;;
  *"the refund"*) g close; g click "Tea refund on the old shelf code"; g say "The tea refund is minus 38.00." --point "css=#headline" ;;
  *) g say "This is the amount the entry has to move." --point "css=#headline" ;;
esac
