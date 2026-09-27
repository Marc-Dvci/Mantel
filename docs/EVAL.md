# Evaluation

Two parts of Mantel make decisions that can be measured: the matcher, which decides which of the family's answers a sentence gets, and the Change Signal, which decides when to tell the family about a sudden change. Everything else is tested for behaviour (93 tests, plus 5 on the DynamoDB engine and 8 Android unit tests).

## Kind Answers

### What counts as a failure

A **wrong answer** is the failure that matters: answering "When is Sarah coming?" with Robert's topic, or answering TV dialogue at all. An unknown reply is safe: the TV shows the Today screen and the question goes to the family. So every table separates:

- **answered right**: the answerable sentences that got their topic
- **wrong topic**: an answerable sentence answered with another topic
- **false answers**: a sentence with no topic (unanswerable questions, conversation, television) that got an answer anyway

### The sets, in commit order

| Commit | What happened |
|---|---|
| `5f5d1ea` | dev set (99 sentences) and the matcher, tuned on the dev set only |
| `9e7b582` | first held-out set (92 sentences), written against that frozen matcher and committed before it was scored |
| | first read, kept verbatim in [eval/holdout_read_1.txt](eval/holdout_read_1.txt) |
| `8ac928a` | fixes after the first read (a wrong synonym, "leave" read as "go"); the first held-out set becomes development data |
| `87ece9c` | second held-out set (73 sentences), written against `8ac928a`, committed before it was scored |
| | second read, kept verbatim in [eval/holdout2_read_1.txt](eval/holdout2_read_1.txt) |
| `f754249` | two phrase fixes after the second read ("be here" as "come", and "tea" no longer read as dinner) |

Both held-out sets were written by the author of the matcher. The commit order shows they were written before being scored, and says nothing about how real people phrase questions.

### First reads

| Set | Answered right | Wrong topic | False answers |
|---|---|---|---|
| first held-out, read once at `9e7b582` | 53 of 57 (93.0%) | **0** | 2 of 35 |
| second held-out, read once at `87ece9c` | 36 of 43 (83.7%) | **0** | 2 of 30 |

The four false answers were all true statements from the clock, the plan or the home line: "where did I leave my glasses" got "You're at home, on Maple Street", "what's for lunch" got the meal answer, "can I have a cup of tea" got the meal answer, and "what year was I born" got the date. None named a person or stated something false.

### Current matcher, typed and spoken

`pnpm eval`. The spoken rows are every sentence said by four synthetic voices (US and UK, female and male), resampled to 16 kHz and recognised by the Vosk small English model the TV ships (`tools/eval/spoken.py`); the matcher then scores what the recogniser heard. The spoken held-out rows were produced after the fixes above, so they measure recognition noise on development data, not a fresh read.

| Set | Sentences | Answered right | Wrong topic | False answers |
|---|---|---|---|---|
| dev | 99 | 65 of 67 (97.0%) | 0 | 0 of 32 |
| first held-out | 92 | 55 of 57 (96.5%) | 0 | 1 of 35 |
| second held-out | 73 | 37 of 43 (86.0%) | 0 | 1 of 30 |
| dev, spoken | 396 | 239 of 268 (89.2%) | 0 | 0 of 128 |
| first held-out, spoken | 368 | 199 of 228 (87.3%) | 0 | 3 of 140 |
| second held-out, spoken | 292 | 140 of 172 (81.4%) | 0 | 4 of 120 |

Across the 1,056 recognised utterances, no sentence was answered with another topic's answer. Recognition errors mostly cost coverage: "what month are we in" came back as "what month or we end", which the matcher leaves unknown.

Only the dev set gates `pnpm verify`: a wrong answer there fails the run. The held-out and spoken sets are reported and never gated.

### The rules that keep wrong topics at zero

- Names gate topics: a sentence naming a person is only matched against topics about that person, and a sentence naming nobody never matches a topic about somebody.
- A sentence with "he" or "she" and no name is unknown.
- The best topic must clear 0.5 and beat the runner-up by 0.08.
- A statement ("I want to see Robert") must share two content words with an example.

## The Change Signal

### The question

Does the rule catch a sudden change within 48 hours without alerting a family every few weeks for nothing?

### The simulation

`packages/core/src/sim.ts`. Each simulated household has its own daily question rate with over-dispersion (negative binomial), one to three visit days a week, a slow progression of up to 3% a week, restless nights at its own rate, and its own waking time and spread. Confounders that should not alert: a family stay the family marked unusual half the time and forgot to mark the other half, a single bad night, a single busy day. Episodes arrive over one or two days, last three to ten days, and touch a random subset of the series, at three intensities:

| Intensity | Questions | Night | First seen |
|---|---|---|---|
| strong | x3 | +90 min, 80% of nights | +90 min |
| moderate | x2 | +45 min, 60% of nights | +60 min |
| subtle | x1.5 | +20 min, 40% of nights | +30 min |

Every household is generated twice from the same seed, with and without its episode: the matched null shares everything before onset. Each seed contributes one household per intensity, 90 days each.

### The rule

Frozen at `4c3bc14` before the held-out seeds were generated: each series against the person's own last 28 usual days (median and scaled MAD; mean and standard deviation for the two night series, which are mostly zero); alert when two series reach z = 3 on the same day, or one series reaches 3 after reaching 2.5 the day before; then three quiet days. The comparison rule alerts whenever questions alone reach z = 3.

The dev seeds (1-40) chose the 28-day window over 14 days, which halved false alerts, and the mean-and-SD baseline for the night series, whose median and MAD were zero and made every restless night look extreme.

### Held-out result

Seeds 1001-1040, read once: [eval/signal_holdout_read_1.txt](eval/signal_holdout_read_1.txt).

| Rule | Strong | Moderate | Subtle | Median delay | False alerts per household-month (nulls) |
|---|---|---|---|---|---|
| Mantel | **28/40 (70.0%)** | 11/40 (27.5%) | 5/40 (12.5%) | 1 care day | **0.148** |
| questions only | 21/40 (52.5%) | 13/40 (32.5%) | 14/40 (35.0%) | 0 | 0.780 |

Mantel's rule catches more strong changes with about a fifth of the false alerts, about 1.8 a year for a household. It catches fewer subtle ones: asking for two series trades sensitivity to a small rise in questions for far fewer alerts on ordinary busy days.

This is a simulation of the method. It says nothing about how often delirium looks like any of these episodes in a real home, and makes no clinical claim.

## Reproduce

```bash
pnpm eval                         # every question set, typed and spoken
pnpm bench --dev                  # Change Signal, dev seeds
pnpm bench --holdout              # Change Signal, held-out seeds
.media-venv/Scripts/python tools/eval/spoken.py   # regenerate the spoken transcripts
```
