# claimcov

<p align="center">
  <b>Prove your documentation claims in a real browser</b><br/>
  Coverage for what you promised, not just for what you tested
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg">
  <img alt="Tests" src="https://img.shields.io/badge/tests-75%20passing-brightgreen.svg">
  <img alt="Built on" src="https://img.shields.io/badge/built%20on-Kane%20CLI-blue.svg">
</p>

---

## The idea

A README says the product exports to CSV, supports SSO, works offline. Those are
promises a reader trusts and no test guards. `claimcov` proves them in a real
browser and reports the percentage that survive.

**Coverage answers "does the code I wrote work". Claim coverage answers "are the
promises I published true".**

```text
README claims  ──▶  extract use-cases  ──▶  design tests
                                                │
                                                ▼
                                    real Chrome, real flows
                                                │
                                                ▼
                               proven vs owed, per claim
                                                │
                              ┌─────────────────┴─────────────────┐
                              ▼                                   ▼
                     coverage percentage              false claims listed
                                                              │
                                                              ▼
                                                  the agent fixes code or docs
```

## How it works

`claimcov` is a thin orchestrator over Kane CLI, which already does the hard
parts. It adds the layer Kane does not have: map the result to documentation,
compute the percentage, and emit a report an agent can act on.

```mermaid
flowchart LR
    doc([README / PRD]) --> ingest[context ingest]
    ingest --> extract[context extract]
    extract -->|exit 3 paused| answer[--answer q1=1]
    answer --> extract
    extract --> review[context review --approve]
    review -->|exit 2 refused| review
    review --> design[design tests]
    design --> run[testrun run<br/>real Chrome]
    run --> cover[cover --json]
    cover --> pct[claim coverage %]
    cover --> false[false claims]
    false --> agent[the agent fixes<br/>code or docs]

    classDef pub fill:#d1fae5,stroke:#10b981,color:#065f46
    classDef loop fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    class doc,ingest,cover,pct,false pub
    class answer,review,agent loop
```

## The closed loop

Kane signals outcomes through its exit code, which is what makes automation
possible. `claimcov` never parses free text to decide what happened.

| Exit | Meaning | What `claimcov` does |
|---|---|---|
| `0` | complete | continue |
| `2` | refused, e.g. `UC_UNREVIEWED` | read the `next` command, approve, retry |
| `3` | session paused | answer from `recommended_index`, resume |

A pause carries everything needed to continue:

```json
{
  "type": "session_paused",
  "sid": "ext-20261123T114116-3d721eb6-readme",
  "resume": "kane-cli context extract --resume ext-... --mode agent",
  "pending_questions": [
    { "id": "q1", "header": "offline scope",
      "options": [{ "label": "Leave unspecified" }],
      "recommended_index": 0 }
  ]
}
```

`recommended_index` is **0-based**; `--answer q1=M` takes a **1-based** option
number. Getting that off by one silently answers the wrong option, so it is
pinned by a test.

## Verified against the real CLI and a real browser

Run on a headless Sandbox host, against a live demo app, not simulated.

**The loop:**

```text
$ node scripts/verify-loop.mjs doc.md work
ingest: 1 source
extract: paused
paused — q1: offline scope -> General only
answering (1) and resuming
resume -> complete
complete: 6 use-cases derived, 1 question(s) answered automatically
```

**The coverage:**

```text
$ node cli.mjs verify docs/demo/README.md --url https://.../demo/ \
  --tag-values work,home
found 5 claim(s): uc-1..uc-5
design uc-1: complete      (after context review --approve)
variables: filled start_url, tag_name, other_tag_name
testrun: complete
cover: complete

1/5 claims proven · 4 false (21%)
  proven   Create a tag
  failing  Sign in with Google
  failing  Mark a task complete
  failing  Filter tasks by tag
  failing  Export all tasks to CSV
```

The demo app implements the first and none of the rest, so the verdict matches
reality: the one true claim is proven and the four false ones are named.

### Two things this cost

Both were found by running it against a live page, and both are now covered by
tests:

**Kane declares variables it does not fill.** `design tests` writes
`{{start_url}}` into every test body and leaves the value empty. A test with an
empty input fails, and Kane reports it as an ordinary failure — so the whole
document looks like a lie when the real problem is a missing input.
`src/variables.mjs` fills what can be inferred and refuses to invent a secret.

**`testrun` takes `--agent`, not `--mode agent`.** The unknown option is a hard
refusal with exit 2, so the tests never ran and `cover` had nothing to report.

Tag values are never invented: without `--tag-values work,home` (or repeatable
`--var name=value`) the tag variables stay empty and are reported as owed.

Cost of the full cycle: roughly 200 credits of an 11,200 balance.

## Install

Requires Node 20+ and Kane CLI:

```bash
npm install -g @testmuai/kane-cli
kane-cli login
```

No shared project is needed: Kane keeps a local store in `.context/`.

## Tests

```bash
npm test
```

75 tests, none of which need Kane, a browser or credits. The spawn path is
exercised through a stub binary that reproduces the real NDJSON stream and exit
codes.

## Status

| | |
|---|---|
| M1 closed loop (exit 0/2/3) | done |
| M2 claim coverage | next |
| M3 demo project with false claims | pending |
| M4 presentation | pending |
| M5 submission | pending |

## Limits

- **It cannot prove a claim about an app that does not exist.** Kane reports
  `missing start URL` until the product is reachable.
- Claims that need credentials or fixtures the operator has not supplied are
  reported as owed, never as proven.
- Browser only in v1; no iOS simulator or Android emulator.

## License

MIT. See [LICENSE](LICENSE).

Kane CLI is a product of TestMu AI and is licensed separately.
