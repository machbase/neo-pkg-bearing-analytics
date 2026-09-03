---
title: How detection works
weight: 50
---

# How detection works

[한국어](./detection.kr.md) | **English**

This document explains **what the app measures, how it assigns a grade, and when it records an event**.

The individual settings and how to receive alerts are in [Alarms and events](./alarms.en.md). This document is for understanding what those settings actually change.

## In one line

> **The fault pattern switches the grade on; the ISO zone sets its height.**
> If nothing stands at the bearing fault frequencies, the grade stays green no matter how high the
> vibration is — but the screen states separately that the amplitude is high.

**Detail analysis and continuous monitoring use the same rule.** Only the window length and the cadence differ.

## The overall flow

Monitoring runs on **two cadences**. One is fast and cheap; the other is slow and expensive.

```
                     raw vibration data
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
    every 10 s (cheap)              every 10 min (expensive)
    one window RMS                FFT → envelope → fault-frequency grid
          │                                   │
          ├── running / stopped               ├── fault pattern (gate)
          ├── signal lost                     ├── ISO zone (height) ← same waveform
          ├── instrumentation gate            └── band energy (evidence)
          └── baseline breach (evidence)               │
                    │                                  ▼
                    │                     grade rises only when the pattern fires
                    │                                  │
                    └──── freeze judgment ─────────────┤
                          (stopped · lost · bad signal) ▼
                                          two consecutive cycles
                                                       │
                                                       ▼
                                                event → alert
```

**Events come only from the right-hand axis.** The left-hand axis only **stops** judgment (stopped, lost, instrumentation fault) and **fills in evidence**.

### Why two cadences

| | 10-second axis | 10-minute axis |
| :--- | :--- | :--- |
| Computation | one rollup RMS | raw waveform → FFT → envelope |
| Cost | 0.3 ms per tag | 311 ms per tag (server) |
| Answers | "is it running, is data arriving" | "what has gone wrong" |

The fault pattern is far too expensive to run every 10 seconds. Sweeping 91 tags every 10 minutes takes 28 seconds (5% of the interval); at a 10-second cadence the computation would overrun the interval.

And there is **no reason to**. Bearing faults grow over hours and days. A failure that develops in seconds is already past tense at either cadence — that is the job of a protection relay, not condition monitoring.

### Why events come from only one axis

Baseline and band each used to emit their own events. They no longer do, for two reasons.

**① The time axes differ.** The baseline is judged on the 10-second window RMS, while the grade is set by the 10-minute fault pattern. Mixing them into one event stream **blurs what an event timestamp refers to** — the promise of "the result of the 10-minute check" breaks, and re-notification intervals interleave two cadences.

**② Adding axes multiplies false alarms.** The band axis compares eight series against their limits and fires if any one exceeds — a small multiple-comparison problem in itself (13% false positives alone).

Both axes **remain as evidence.** They still appear on the card and in the evidence table, and are used to narrow down which series moved. Only the alert is gone.

> **The cost is explicit.** The baseline is the cleanest axis in the pool — 0% false positives, 28% detection — and it has been removed from alerting. Amplitude rises from non-bearing causes (imbalance, misalignment, looseness) must now be **seen by a person on screen**. See [Limits and alternatives](#limits-and-alternatives) if you need them as alerts.

## ① The judgment value — window RMS

On the 10-second axis, the judgment value is **a single RMS over a whole window**, not the most recent point.

Vibration fluctuates moment to moment, so judging on one point makes the value jitter. Instead a fixed length of data — "the last 10 seconds" — is combined into one effective value.

**RMS window** and **judgment interval** are different settings.

| Setting | Meaning | Default |
| :--- | :--- | :--- |
| RMS window | how much data is combined into one value | last 10 s |
| Judgment interval | how often the judgment runs | every 10 s |
| Pattern/band extraction interval | how often the fault pattern is computed | **every 10 min** |

The first two are adjustable, and the current values are the floor — nothing shorter is available. The third is adjustable too, but only **upward** (10 min – 1 h). Shorter and the server cannot keep up with its own interval.

A **longer** window merges brief excursions into a single state — slower to react, but steadier. If the window is shorter than the interval, data falls between judgments and the screen warns about it.

For machines whose load varies cyclically, choose a window longer than that cycle. A shorter one makes the load variation itself look like an anomaly.

## ② Fault pattern — the axis that switches the grade

### What it looks at

A bearing has a **fixed rolling period for each damaged surface**. Given the shaft speed and the bearing geometry (element count, element diameter, pitch diameter, contact angle) that period can be computed.

| Name | What | Roughly |
| :--- | :--- | :--- |
| **BPFO** | outer race | shaft freq × elements × 0.4 |
| **BPFI** | inner race | shaft freq × elements × 0.6 |
| **BSF** | rolling element | shaft freq × 2–3 |
| **FTF** | cage | shaft freq × 0.4 |

If a fault is present, energy stands at that frequency and its harmonics (2×, 3×, 4×). This axis **matches that grid against the actual spectrum**.

### How it looks — the envelope

Fault impacts **do not appear directly as low-frequency vibration.** The impact excites a high-frequency resonance in the bearing and housing, and that resonance swells and decays at the fault period. The signal is high-frequency, but the information is in its amplitude variation — the envelope.

```
   raw waveform → keep 1–5 kHz → analytic magnitude |x + i·H{x}| → low-freq spectrum
                    (bandpass)      (Hilbert transform)             (the grid goes here)
```

**The band is fixed at 1–5 kHz.** Choosing the band automatically by maximum kurtosis (a kurtogram) was tried and detection collapsed from 54% to 6–11% — maximising kurtosis latches onto anti-aliasing noise and inverter switching bands. The fixed band is far better.

> **Caution on large machines** — 1–5 kHz is the resonance region of the verification pool (small to medium test rigs). What often sits in that band in practice is the **accelerometer mounting resonance** (a few kHz depending on how it is attached); the bending modes of the bearing ring itself go **down** as the machine gets larger. The band may not fit large slow machines, and since the pool contains none, **which way it fails is not yet known.**

### When it fires

Energy at the grid positions is scored against the surrounding noise floor (the global median). If that score crosses the adoption threshold, the gate fires.

| | Window | Adoption threshold |
| :--- | :--- | :--- |
| **Detail analysis** | 100 revolutions | 4.0 |
| **Continuous monitoring** | **25 revolutions** | **3.0** |

Monitoring uses a shorter window because of server cost. The server timer (goja) is 100–400× slower than the browser, so at 100 revolutions one sweep of 91 tags takes 756 seconds and overruns the 10-minute interval (126%). At 25 revolutions it takes 167 seconds (28%).

**The cost is 7 percentage points of detection: 66% → 59%.** A shorter window lowers the whole score distribution, so the threshold drops with it (matched to equal false-positive rate: 3.88 at 100 revolutions, 3.03 at 25).

Monitoring is a **trigger**; confirmation is done by detail analysis at 100 revolutions — a short window is acceptable as long as it does not miss.

### When it cannot judge

Without the shaft speed or the bearing geometry there is no grid to build. In that case the grade **does not rise** — but that is "cannot judge", not "normal".

The screen exposes this as coverage. If the speed or part number is missing, the settings screen says so.

> **The shaft speed is never guessed.** It used to default to 1800 rpm when missing, which threw the whole grid off on 2-pole (3600) and 6-pole (1200) machines while the screen went on producing grades as usual — the worst kind of silent error, so it was removed.

## ③ ISO zone — the axis that sets the height

The vibration severity zones defined by ISO 10816 (A good → D severe). The boundaries depend on the machine class and the sensor unit.

| Unit | good↔caution | caution↔warning | warning↔severe |
| :--- | ---: | ---: | ---: |
| mm/s · Class I (small ≤15 kW) | 0.71 | 1.8 | 4.5 |
| mm/s · Class II (medium 15–75 kW) | 1.12 | 2.8 | 7.1 |
| mm/s · Class III (large, rigid foundation) | 1.8 | 4.5 | 11.2 |
| mm/s · Class IV (large, flexible foundation) | 2.8 | 7.1 | 18.0 |
| g (acceleration) | 0.5 | 1.0 | 2.0 |
| μm (displacement) | 12 | 25 | 50 |

The velocity (mm/s) values are the ISO 10816 figures. Acceleration and displacement are not quantities the standard defines, so those are **general reference values** meant to be adjusted per machine. All values are editable on the judgment-criteria screen.

> **Band limiting** — the ISO zone is measured on the 10–1000 Hz band only, because the zone boundaries in the standard are numbers derived from measurements over that band. On sensors with strong high-frequency content the full-band value and the ISO value can differ considerably; the band-limited one is the value that matches the standard.

### Why ISO is not an independent axis

Split by axis over the 383 verification cases:

| Axis | False positives alone | Detection alone |
| :--- | ---: | ---: |
| **Fault pattern** | **3%** | 65% |
| Baseline | 0% | 28% |
| Band | 13% | 41% |
| **ISO zone** | **69%** | 37% |
| OR of all four | **69%** | 74% |

**Essentially all the false alarms come from the ISO axis.** And under a maximum rule, adding an axis can only raise the grade — so including ISO puts that 69% straight on screen.

Turning it into a gate gives **69% → 3%**. Detection falls from 74% to 66%, eight percentage points.

There is a bonus: **getting the machine class wrong no longer moves the false-positive rate** (3–4% across Classes I, II and III), because ISO no longer fires alarms. Previously one wrong class choice swung it between 49% and 75%.

> **That 69% is not a field false-positive rate.** Every rig in the pool is an accelerated-life test stand — a healthy stand runs under deliberately high load, while a bearing early in a fault still has low broadband velocity. In this pool **the median ISO value of healthy cases (1.33 mm/s) is higher than that of faulted ones (1.21).** It is not a class problem; the standard simply does not apply to this equipment. See [What this tool does](./scope.en.md).

### Which waveform sets the height

In monitoring, the ISO value is measured on **the very waveform the pattern was measured on**. Using the latest 10-second ISO would make the grade move every 10 seconds, out of step with the 10-minute pattern.

If ISO could not be measured during the pattern computation, it falls back to the 10-second value — it never drops the grade to zero.

## ④ Evidence axes — the two that do not set a grade

### Baseline — relative to normal

Learns what the machine looks like when healthy, then measures the departure from it.

```
limit = normal level (μ) + k × normal spread (σ)
```

Even while the absolute value is still in zone A, a **clear rise above normal** is caught. `k` is the sensitivity — smaller reacts sooner, larger only when it is certain.

On very steady machines with almost no normal variation the limit could sit too close to the normal level, so a breach requires **at least +20% above normal**.

A breach **does not raise the grade and does not emit an event.** It appears on the card and in the evidence table as "sharp rise versus normal".

### Band energy — per frequency band

Catches changes invisible in the overall RMS. A growing bearing fault barely moves total vibration, but the band where it appears jumps several-fold.

Bands are divided into five ranges relative to the shaft frequency (1×). The very-high range is subdivided into four octave bands (vh1–vh4), so eight bands are actually stored and judged.

| Band | Range | Typically shows |
| :--- | :--- | :--- |
| Sub-synchronous | 2 Hz – 0.5× | oil whirl · looseness · belts |
| 1× band | 0.5× – 1.5× | imbalance · misalignment |
| Fault band | 1.5× – 10× (max 1 kHz) | bearing fault frequencies · gears |
| High | – 1 kHz | early bearing faults |
| Very high | above 1 kHz | impacts · friction |

Each band learns a normal reference the same way the baseline does, and the evidence table records **how many times over the limit** it is.

> On low-sample-rate sensors the upper bands fall outside the measurement range and are not learned, and without a bearing part number the envelope fault-frequency series never accumulate. Unlearned series are excluded, and the screen shows something like "4/9 series learned".

### Why learned axes are not in the gate

This matters most in detail analysis. Putting a learned axis in the gate makes **the same tag produce different grades depending on whether it has been trained** — measured, 3% false positives before training became 15% after.

A one-off analysis answers "what does this signal look like right now", and must not depend on training state.

### Crest does not raise the grade

Crest factor (peak over RMS) is also excluded from the grade. At low amplitude the denominator is small, so a single spike swings it wildly.

It is reflected in the **verdict wording** instead. If amplitude is normal but crest exceeds its reference, the verdict does not assert "normal operation".

Low RMS with high crest is **both the signature of an early localised fault and the signature of an instrumentation spike** (ESD, cabling, contact). That one number cannot separate them, so it does not move the grade — only states the fact. What separates them is whether the impacts **repeat**: aligned with the fault frequencies in the envelope means a fault, scattered means instrumentation. The recommendation text directs that check.

When an instrumentation gate (clipping, DC drift) is active, the gate wording takes precedence — it already directs an instrumentation check.

## ⑤ Deciding the grade

```
grade = did the fault pattern fire?  →  no  : good
                                     →  yes : max(caution, ISO zone grade)
```

If the pattern fires but ISO is in zone A the grade is **caution**. Naming a cause while leaving the grade green would make the screen contradict itself.

Axes that did not raise the grade **are still reported.** A screen that only says "good" would be lying.

| Situation | Grade | Screen text |
| :--- | :--- | :--- |
| Pattern ○ · ISO warning | warning | outer-race evidence · amplitude in warning zone |
| Pattern ○ · ISO good | **caution** | outer-race evidence · amplitude still low |
| Pattern ✕ · ISO warning | **good** | **amplitude high but no bearing-fault evidence** — check imbalance/alignment/looseness |
| Pattern ✕ · baseline breach | good | sharp rise versus normal |
| Pattern ✕ · band breach | good | high-band breach |
| Speed/geometry missing | good | **cannot judge** (shown in coverage) |

The third row is the central trade-off of this design. **Non-bearing failures do not raise the grade** — this is a bearing diagnosis tool, and imbalance and misalignment cannot be identified in principle without phase (a tachometer) and an axial channel. It is stated in words rather than hidden.

## ⑥ Events

Only **moments where the state changed** are recorded. Nothing is written while a state persists.

| Type | When | Which axis |
| :--- | :--- | :--- |
| **Observation** | first cycle out of the good zone — **before confirmation, no alert** | 10 min (pattern) |
| **Threshold** | the same grade held for **two consecutive cycles** | 10 min (pattern) |
| **Sustained** | a bad state persists, every re-notification interval | 10 min (pattern) |
| **Improved** | out of alarm level but not yet good | 10 min (pattern) |
| **Recovered** | fully back to good | 10 min (pattern) |
| **Instrumentation fault** | clipping · DC drift · flatline | 10 s |
| **Signal lost** | no data arriving | 10 s |

The last two report **whether monitoring is working at all**, not a vibration grade. They are kept because the worst failure mode is a screen that holds its last value and keeps looking normal.

**Baseline and band emit no events.** Their state is still tracked and shown in the evidence table.

### Improved versus recovered

Getting better within one episode has two stages.

| | Meaning | Response |
| :--- | :--- | :--- |
| Improved | the emergency is over | lower the priority, stand down |
| Recovered | fully normal | close the work order |

They are split because the field response differs. And machines that run near a zone boundary rarely reach fully-good — they still need to hear that things improved.

Each stage is recorded **once per episode**. Even stepping down severe → warning → caution → good produces one improved and one recovered.

### Recording rules

- **Nothing is recorded while good persists.** Only the single recovery from a bad state.
- **Intermediate steps that are still bad** (severe → warning) are not recorded separately; they are represented by improved.
- **A newly seen tag that is already bad is recorded immediately** — no hold time.
- **Events are never deleted automatically.** History is data too.

### Reading event values

| Type | Value | Reference | Detail |
| :--- | :--- | :--- | :--- |
| Observation · threshold · sustained · recovered | ISO value of the waveform the pattern was measured on | the zone boundary crossed | **grid score · site · confirmation basis** |
| Instrumentation fault · signal lost | — | — | reason · time without data |

**The detail column answers "why this grade".** The ISO value is not the axis that produced the grade (the gate is the fault pattern), so the number alone misleads.

```
observation   grid 3.2 · outer race (BPFO) · cycle 1 — not confirmed
threshold     grid 3.2 · outer race (BPFO) · confirmed on two consecutive cycles
sustained     grid 4.1 · re-notification
recovered     grid 2.2 · cleared after 4 h 20 min
```

### Every cycle's judgment goes to a time series

Events record only **what changed**. Isolated hits that never reach confirmation, and stretches where the score hovers near the adoption line, live in the **grid score series** instead — one point per 10 minutes in the same table as the band values (`NEO_VIBE_BAND`).

On the trend chart that reads:

```
grid score
 6 ┤                                    ╭────────
 3 ┼━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┿━━━ adoption line
   │  ▲        ▲                        │
 0 ┤──┴────────┴────────────────────────╯
      isolated  isolated              confirmed
```

## ⑦ Confirmation — two consecutive cycles

An alarm does not go out the moment the grade changes. **The same judgment must hold for two consecutive cycles** — going up and coming down alike.

```
cycle 1   grid 3.2 → caution   observation event · no alert
cycle 2   grid 3.2 → caution   threshold · alert sent
cycle 3   grid 2.1 → good      (not recovered yet)
cycle 4   grid 2.0 → good      recovered · alert sent
```

One cycle back the other way breaks the run and the count restarts.

### Why cycles, not minutes

This used to be a minute-based setting (`entry hold`), but judgment runs on the extraction interval (10 minutes), so **1, 2 and 5 minutes all collapsed to "next cycle"** — the choice meant nothing. The setting was removed and the rule fixed to cycles.

### Why two

Measured by replaying NASA IMS at the real cadence (7 healthy points over 158 days, 3 faults).

| Rule | False alarms (per point-month) | Faults detected |
| :--- | ---: | ---: |
| Isolated hit confirms | 14.6 | 3/3 |
| **Two consecutive** | **5.3** | **2/3** |
| Three consecutive | 3.0 | 2/3 |

**All three faults had the same shape: one isolated hit → a long gap → a sustained run.** Going to the machine on that first hit finds nothing (a 2.6-day gap followed it on the outer race, 7 days on the rolling element), and hits of the same character occurred 77 times on healthy bearings.

Discarding isolated hits sounds like it costs lead time; it is the **opposite** — confirmation marks where the real signal begins, giving 3.1 days on the outer race and 25 days on the rolling element.

> **Isolated hits still leave a trace.** They are recorded as `observation` events, and the grid score for every cycle accumulates as a time series shown on the trend chart. Only the alert is withheld.

### Instrumentation faults stay time-based

Signal loss, clipping and DC drift are judged on the **10-second axis**, where cycles do not apply. A single spike must not send "sensor failure", so a 1-minute persistence is required, and 5 minutes to clear. Neither is exposed as a setting — measured, instrumentation faults occurred 4 times in 22 days, too rare to be worth tuning.

## Stopped machines and lost signal

A sudden drop in value does not mean things got better.

- **Machine stopped** — if the judgment value falls below 20% of normal, the machine is treated as stopped and judgment is **frozen**. Vibration faults do not heal themselves, so an unexplained drop usually means the machine stopped or the sensor was lost. A "recovered" alert here would suggest the machine was repaired. While frozen the previous state is held, so the fact that it was bad survives the restart.
- **Signal lost** — if no new data arrives for several times the judgment interval, it is treated as lost and an event is recorded.

## Tags with too few samples

The fault pattern sizes its window by **sample count**, not by time.

Tags whose stored timestamps are spread out (replayed data, intermittent collection) have a wall-clock density different from their sample rate. If 20,480 samples are spread over a minute, that is 341 per second — and a 25-revolution window of 0.75 s fetched by time alone yields only **256 samples**.

In that case the window is widened and re-read (up to twice); if it still cannot reach 4096 samples, the pattern judgment is skipped for that cycle. If it overshoots, only the most recent portion is used — a longer window mixes operating states.

> Without this handling, low-density tags have their judgment **skipped entirely with no error.** The screen goes on looking good.

## Baseline learning

### What is learned

The **normal level (μ)** and **normal spread (σ)** of a healthy operating window. Choose a learning period (1 h / 6 h / 24 h) and run it, and the reference is built from that window's data.

Estimation uses a median-based method that is not swayed by spikes. Momentary impacts occur even in normal operation, and a plain mean absorbs them and inflates the reference.

### Windows filtered out automatically

If a stop or a start-up is mixed into the learning window the reference comes out too low, so they are excluded beforehand.

- **Stopped/idle windows** — below 20% of the operating level
- **Start-up/shutdown transients** — where the value changes sharply

Even a successful run reports exclusions like `excluded 12 (stopped 8 · transient 4)`. That means it learned from what remained, and is normal.

### When learning is refused

| Situation | Message | What to do |
| :--- | :--- | :--- |
| Too few samples | normal-window samples below the minimum | lengthen the period or retry once more data has accumulated |
| Two levels: stopped ↔ running | most of the window is stopped | re-learn over a period that is mostly continuous operation |

The second matters especially. Taking the stopped level as normal means **merely running the machine shows as a breach**.

### Why there is no automatic re-learning

The screen tells you when learning is old, but never refreshes it by itself. Re-learning while a fault is growing **absorbs that fault into normal**.

After maintenance or a change in operating conditions, a person should re-learn deliberately.

### Tags deleted and recreated

Learned values are keyed by `table:tag`. Deleting a tag leaves the learned values behind, so attaching a **different machine under the same name later applies the old reference**.

The data alone cannot tell whether it is the same machine, so the app asks. The judgment-criteria screen offers **same machine — keep** / **different machine — reset**, and until confirmed the baseline and band display for that tag is paused. The fault pattern and ISO zone need no learning and keep working meanwhile.

## Band energy extraction

Band values require frequency analysis of raw data, so they are computed by the **same timer on the same interval** as the fault pattern — both read the raw waveform.

- Computation happens on the server, so the trend continues while the app is closed.
- To avoid scraping old windows of a stopped machine, computation is always anchored to that tag's most recent data time.

### Backfilling history

Accumulating enough samples takes time. If raw data is already in the database, **backfill** computes it retroactively.

The method is identical to the timer's, so backfilled values and newly accumulated ones can be learned together. Progress and an estimated duration are shown, and stopping midway keeps whatever was filled.

## Detail analysis versus monitoring

Same rule; different **window, cadence and anchor**.

| | Detail analysis | Continuous monitoring |
| :--- | :--- | :--- |
| Grade formula | pattern gates, ISO sets height | **identical** |
| Pattern window | 100 revolutions | 25 revolutions |
| Adoption threshold | 4.0 | 3.0 |
| When | when a person picks a period | automatically every 10 min |
| Which moment | the **worst of 8 points** across the period | now |
| Measured FP / detection | 3% / 66% | 4% / 59% |
| Learning required | none | none (evidence display only) |

### Why detail analysis samples eight points

Measuring only the **end** of a period lets that one moment stand for the whole period. In a real outer-race failure, the end of the selected window was already a stopped machine, and the grade came out good.

So the period is divided into eight, each point is judged, and the **worst** is used. Points with no data snap backwards and duplicates are removed. Which point was chosen is shown on screen.

Picking "1 hour" gives **the worst moment within that hour** — not the worst of all time.

## Limits and alternatives

| What you want | Today | Alternative |
| :--- | :--- | :--- |
| Amplitude rises as alerts | evidence display only | check the card and evidence table periodically |
| Non-bearing faults (imbalance, alignment) | not judged | needs phase and an axial channel — a limit in principle |
| Second-scale response | not done | the domain of protection relays and interlocks |
| Early inner-race detection | **not detected** | see [Fault types](./faults.en.md) |

## The judgment fingerprint

Generated reports carry a **judgment fingerprint** — a short string computed from the thresholds and criteria used.

It settles why two reports differ.

- Same fingerprint → the criteria were identical and **the data changed**
- Different fingerprint → **the judgment settings changed** in between

## Navigation

- [Previous: Alarms and events](./alarms.en.md)
- [Back to contents](./index.en.md)
- [Next: Troubleshooting](./troubleshooting.en.md)
