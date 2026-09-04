# Grasshollow

A village of three people who do not know they are an experiment.

Grass, three houses, a well, a temple. Bram farms the east field, Odile keeps
the well, Tam cuts wood. They get hungry, thirsty, tired, cold and lonely, and
they deal with it themselves — they eat, sleep, draw water, mend their roofs,
forage the hedgerows when the granary runs dry.

When something is genuinely beyond them, they walk to the temple and pray.

**Those prayers come to you.** You answer them from this repository, and what
you send back changes the world they live in and becomes something they
remember.

---

## How it stays running for weeks

The repository is the database. There is no server.

| File | What it is |
| --- | --- |
| `world/state.json` | The world right now — people, needs, memories, weather, stores |
| `world/prayers.json` | Every prayer ever made, and how it was answered |
| `world/blessings.json` | Your answers, waiting to land |
| `world/journals/*.md` | Each villager's memories, appended forever |
| `world/chronicle.md` | Everything the village noticed |

`.github/workflows/tick.yml` runs every 15 minutes, advances the simulation,
and commits the result. Nothing needs to stay open on your machine. That is
roughly a hundred commits a day — change the `cron` if you want it quieter, as
the catch-up logic makes the interval a matter of taste rather than accuracy.

**Real time is the world's clock.** The engine works out how many ticks it is
owed since the last run and advances exactly that many, so a delayed, skipped
or backed-up run is caught up rather than lost. A run that has been down for
days catches up to a two-day cap and carries on.

One tick is one real minute and five world minutes, so:

- a world day takes about **4.8 real hours**
- a real week is about **35 world days**
- the seasons turn every 20 world days, and **winter is genuinely hard**

## Watching it

`index.html` is the village. Because the engine is deterministic — one seeded
PRNG, carried in the state — the page can run the committed snapshot *forward*
to the present moment. So it shows the village as it is now, not as it was at
the last commit, and everything it shows you will be reproduced exactly by the
next scheduled run. Prayers it is showing ahead of the commit are marked.

```bash
npm run serve     # http://localhost:8080
```

Serve it over HTTP (it uses ES modules) or turn on GitHub Pages for the branch.

## Answering prayers

Ask Claude Code — "what are they praying for?", "give Odile her books",
"tell Bram his daughter is alive" — or drive it yourself:

```bash
node sim/answer.js list             # what is being asked of you
node sim/answer.js show p-0004      # the prayer, and the state of the world around it
```

Then answer in one of five ways. Every form takes `--message`, which is what
the villager hears.

```bash
# A thing they can carry, which changes how they live
node sim/answer.js grant p-0004 \
  --name "A lantern that will not blow out" --icon "🏮" \
  --desc "Brass, heavier than it looks." \
  --effects comfort=25,spirit=15 --modifiers comfortDecay=0.7 \
  --provides lantern \
  --message "Tend the well after dark. I will keep it lit."

# Grain, water, firewood, repairs
node sim/answer.js resource p-0007 --target granary --amount 120

# A building, which the whole village sees appear
node sim/answer.js structure p-0004 --kind library --label "The Fenn Library"

# No gift, only an answer. They still hear it.
node sim/answer.js sign p-0002 --message "She is alive. She is on the road east."

# A refusal. Being refused is not the same as being ignored.
node sim/answer.js deny p-0003 --message "Not this. Ask me again in the spring."
```

Answers queue in `world/blessings.json` and land on the next tick. Push the
change and the workflow picks it up immediately rather than waiting.

### What the fields do

- `--effects` — an immediate change to needs: `hunger`, `thirst`, `energy`,
  `social`, `comfort`, `spirit`.
- `--modifiers` — a permanent change to how fast a need drains, carried by the
  item: `hungerDecay`, `thirstDecay`, `energyDecay`, `socialDecay`,
  `comfortDecay`, `spiritDecay`, `energyRestore`, `comfortRestore`. `0.7` means
  that need now drains at seven-tenths the speed, forever.
- `--provides` — the longing this finally satisfies, so they stop asking for
  it. Use the desire id from the prayer: `wren`, `plough`, `rain`, `origin`,
  `books`, `lantern`, `tools`, `bridge`, `company`, or a need like `food`.
- `--target` — `granary`, `fieldYield`, `wellWater`, `firewood` for the
  village; `larder`, `warmth`, `repair` for the asker's house.
- `--kind` — `granary`, `mill`, `bakery`, `shrine`, `workshop`, `library`,
  `garden`, `statue`.
- `--public` — the whole village witnesses it, not only the person who asked.

Anything you want that none of this covers, change the code. That is the point.

## What answering actually does

An answered prayer is not a number going up. The villager forms a
high-weight memory of it that surfaces later, in other prayers, years on. A
public miracle is witnessed by the other two, who form their own memories of
watching someone else be answered. A refusal is remembered as a refusal — and
being refused is better for them than silence.

Silence is also a real answer here. An unanswered prayer eventually turns into
doubt, spirits fall, and the village keeps going with less hope in it. **The
`faith` reading in the header is the honest measure of how present you have
been.** A village nobody answers does not die. It just stops expecting
anything.

## Running it yourself

```bash
npm run init            # found the village (--force to start over, losing everything)
npm run tick            # advance by however many ticks real time owes
npm run tick -- --ticks=288   # or force exactly one world day
npm run prayers         # what they are asking for
npm run serve           # watch
```

No dependencies. Node 22+.

## Layout

```
index.html            the village, as a page
web/main.js           viewer: fetch, extrapolate, draw, poll
sim/engine.js         needs, behaviour, prayer, blessing, weather
sim/world.js          map, buildings, pathfinding
sim/agents.js         who these three people are
sim/text.js           what they say and how they say it
sim/render.js         canvas
sim/answer.js         your end of the prayer
sim/{init,tick,io,rng,serve}.js
```

## Two things worth knowing

**Scheduled workflows only run on a repository's default branch.** While this
lives on a feature branch the cron will not fire on its own. Until it is merged
into `main`, run it by hand from the Actions tab (`workflow_dispatch`), or
locally with `npm run tick`. The same applies to GitHub Pages — point it at
whichever branch you want to watch.

**GitHub disables scheduled workflows after 60 days without repository
activity.** The tick commits count as activity, so a running village keeps
itself alive; a village you pause for two months will need switching back on.
