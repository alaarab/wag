# A pack for the made-up page

A pack tells a live session about one app: where it is, what its buttons say, how its words are
spoken, and what whoever answers questions should know. This one is for the made-up snack budget
page that ships with wag, so there is something to try.

```sh
npm run make guided && npm run build   # the guided deck's walk, and the built decks
npm run dev                            # serves the made-up page (leave it running)
# a browser with --remote-debugging-port=9333, then:
npx wag live examples/snack --walk guided
npx wag rehearse examples/snack guided
```

For your own app, copy this folder somewhere outside the repo and change `pack.json`. The fields
are listed at the top of `bin/wag.mjs`.
