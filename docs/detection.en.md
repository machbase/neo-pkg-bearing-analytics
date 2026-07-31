---
title: How detection works
weight: 50
---

# How detection works

[한국어](./detection.kr.md) | **English**

This document explains **what the app measures, how it grades equipment, and when it records an event**.

For the individual settings and how to receive notifications, see [Alarms & events](./alarms.en.md). This document is for understanding what those settings actually change.

## The flow

```
     Raw vibration data
            │
            ▼
    ① Produce a value         one window RMS
            │
            ▼
    ② Apply three criteria    ISO zone · baseline · band energy
            │
            ▼
    ③ Decide the grade        the worst of the three
            │
            ▼
    ④ Confirm the change      entry / recovery hold
            │
            ▼
        Record event → notify
```

This repeats per tag on every **evaluation interval**.

## ① The evaluated value — window RMS

Evaluation uses **one RMS value covering a whole window**, not the single most recent sample.

Vibration fluctuates moment to moment, so grading on one point makes the grade jitter constantly. Instead, a fixed span of data — "the preceding 10 seconds", say — is combined into a single effective value.

**RMS window** and **evaluation interval** are separate settings.

| Setting | Meaning | Example |
| :--- | :--- | :--- |
| RMS window | How much data is combined into one value | The preceding 10 seconds |
| Evaluation interval | How often to evaluate | Every 10 seconds |

A **longer** window merges short excursions into a single state — fewer false alarms, slower response. If the window is shorter than the interval, data in between never reaches evaluation, and the screen warns you.

On equipment whose load varies cyclically, pick a window longer than that cycle. Too short and the load variation itself registers as an anomaly.

## ② The three criteria

Every tag is evaluated from three angles at once. Each answers a different question.

| Criterion | Question | Needs training |
| :--- | :--- | :---: |
| **ISO zone** | Is it absolutely high by international standard? | No |
| **Baseline** | Is it high compared to this machine's own normal? | Yes |
| **Band energy** | Has one specific frequency band jumped? | Yes |

### ISO zone — the absolute criterion

Grading against the vibration severity zones defined by ISO 10816 (A Good → D Critical). The boundaries depend on the machine class and the sensor's unit.

| Unit | Good↔Warning | Warning↔Danger | Danger↔Critical |
| :--- | ---: | ---: | ---: |
| mm/s · Class I (small, ≤15kW) | 0.71 | 1.8 | 4.5 |
| mm/s · Class II (medium, 15–75kW) | 1.12 | 2.8 | 7.1 |
| mm/s · Class III (large, rigid foundation) | 1.8 | 4.5 | 11.2 |
| mm/s · Class IV (large, flexible foundation) | 2.8 | 7.1 | 18.0 |
| g (acceleration) | 0.5 | 1.0 | 2.0 |
| μm (displacement) | 12 | 25 | 50 |

Velocity (mm/s) values are ISO 10816 reference values. Acceleration and displacement are not quantities the standard defines, so those are **general reference values** meant to be adjusted for your equipment. All of them are editable on the Criteria screen.

> **Band limiting** — ISO zone evaluation measures only the 10–1000 Hz range, because the standard's zone boundaries are themselves numbers derived from measurements over that band. On sensors carrying a lot of high-frequency content the wideband value and the ISO value can differ considerably; the band-limited one is the value that matches the standard.

### Baseline — compared to its own normal

The app learns what the machine looks like when healthy, then watches how far it departs from that.

```
limit = normal level (μ) + k × normal variation (σ)
```

Even while the absolute value is still in the Good zone, a **clear rise above its own normal** is caught. Every machine has a different healthy level, so this catches early changes that a single standard would miss.

`k` is the sensitivity. Smaller reacts sooner; larger reacts only when the change is unmistakable.

On very stable machines the normal variation is tiny, which would place the limit almost on top of the normal level — so a breach must rise **at least 20% above normal**.

### Band energy — per frequency band

This catches changes that overall RMS cannot show. A growing bearing fault barely moves total vibration, but the band where that fault appears jumps several-fold.

Bands are defined relative to rotational frequency (1×).

| Band | Range | What typically appears |
| :--- | :--- | :--- |
| Sub-synchronous | 2 Hz – 0.5× | Oil whirl · looseness · belts |
| 1× band | 0.5× – 1.5× | Imbalance · misalignment |
| Fault band | 1.5× – 10× (up to 1 kHz) | Bearing fault frequencies · gears |
| High | up to 1 kHz | Early bearing faults |
| Very high | above 1 kHz | Impulsiveness · friction |

Each band learns a normal reference the same way the baseline does, and is graded by **how many times over its limit** it sits.

| Ratio to limit | Grade |
| :--- | :--- |
| 1.0 – 1.5× | Warning |
| 1.5 – 3.0× | Danger |
| Over 3.0× | Critical |

Multiple bands breaching at once collapse into **one event per machine**. It is normal for a single fault to show up across several bands, so alarming per band would multiply the noise. Which bands were exceeded, and by how much, is recorded in the event detail.

> On lower sample-rate sensors the upper bands fall outside the measurable range and cannot be trained. Those bands are excluded from evaluation, and the screen shows something like "4 of 5 trained".

### Deciding the grade

A tag's grade is **the worst of the three**. The screen also shows which criterion raised it, so the reason is visible immediately.

With ISO zones alone, a sensor dominated by high-frequency content would keep reading Good even as a bearing degrades. That is why all three run together.

## ③ Events

Only **moments where the state changed** become events. Nothing is recorded while a state simply persists.

| Type | When it occurs |
| :--- | :--- |
| **Threshold exceeded** | The grade got worse |
| **Sustained** | While a bad state continues, at the configured re-notify interval |
| **Improved** | Left the alarm level, but not yet Good |
| **Recovered** | Returned fully to Good |
| **Baseline breach** | Exceeded the limit relative to its own normal |
| **Band breach** | A specific frequency band exceeded its limit |
| **Band recovery** | All bands returned below their limits |
| **Signal lost** | Data stopped arriving |

### Improved vs. recovered

Within one incident, getting better happens in two stages.

| | Meaning | Response |
| :--- | :--- | :--- |
| Improved | The urgent part is over | Lower priority, stand down urgent response |
| Recovered | Fully normal | Close the work order |

They are separated because the operational response differs. Also, equipment that runs near a zone boundary rarely reaches fully Good — such machines still need to signal that they improved.

Each stage is recorded **once per incident**. Improving stepwise from Critical → Danger → Warning → Good still yields one "improved" and one "recovered".

### Recording rules

- **Nothing is recorded while Good simply continues.** Only the return from a bad state records one recovery event.
- **Intermediate steps while still bad** (Critical → Danger, for instance) are not recorded separately; the "improved" event represents them.
- **A tag seen for the first time that is already bad is recorded immediately**, without waiting out the hold time.
- **Baseline and band breaches are evaluated independently of grade changes.** Each records once at the moment of crossing and does not repeat while the breach persists.
- **Events are never auto-deleted.** History is data, so it is preserved.

### Reading event values

The "measured value vs. limit" column means different things per type.

| Type | Measured value | Limit |
| :--- | :--- | :--- |
| Threshold · sustained · improved · recovered | Evaluated value | The zone boundary crossed |
| Baseline breach | Wideband RMS | The learned limit |
| Band breach · recovery | **Ratio to the limit** | 1 |

Only band events show a ratio. Bands differ in magnitude, so no single absolute value compares across them.

## ④ When an alarm doesn't fire immediately

An alarm does not go out the instant a grade changes. A confirmation time is required, differing by direction.

| | Setting | Purpose |
| :--- | :--- | :--- |
| Getting worse | Entry hold | Ignore momentary spikes |
| Getting better | Recovery hold | Prevent boundary flapping |

With an entry hold of 5 minutes, spikes shorter than 5 minutes are deliberately ignored. If an alarm didn't fire, check this setting first.

## Stopped equipment and lost signal

A sudden drop in value does not mean things got better.

- **Equipment stopped** — if the evaluated value falls below 20% of normal, the app treats it as stopped and **freezes** evaluation. Vibration faults do not heal themselves, so an unexplained drop usually means the machine stopped or the sensor was lost. A "recovered" notification there would leave people thinking the machine was fixed. While frozen the previous state is held, so when the machine restarts the fact that it *was* bad is still there.
- **Signal lost** — if no new data arrives for several times the evaluation interval, that is recorded as an event. Simply skipping the tag would leave the screen holding the last value and looking normal.

## Baseline learning

### What is learned

The **normal level (μ)** and **normal variation (σ)** over a healthy operating window. Pick a learning window (1 / 6 / 24 hours) and run learning, and the reference is built from that span.

Estimation uses a median-based method that resists spikes. Momentary impacts occur even during healthy operation, and a plain average would absorb them and inflate the reference.

### Automatically excluded intervals

If the learning window contains stops or startups, the reference comes out too low. Those are removed before learning.

- **Stopped / idle** — below 20% of the running level
- **Startup / shutdown transients** — intervals where the value changes abruptly

Even a successful run reports its exclusions, such as `excluded 12 (idle 8 · transient 4)`. That means the baseline was built from what remained, and is normal.

### When learning is refused

| Situation | Message | What to do |
| :--- | :--- | :--- |
| Too few samples | Steady-state samples below the minimum | Extend the learning window, or retry once more data has accumulated |
| Two levels: stopped ↔ running | Most of the window is downtime | Retrain over a period that is mostly continuous operation |

The second one matters especially. Taking the stopped level as the normal reference means **merely running the machine fires breach alarms** — so learning is refused outright.

### Why there is no automatic retraining

The screen tells you when a baseline is old, but never refreshes it by itself. Retraining while a fault is growing would **absorb that fault as normal**.

If maintenance was performed or operating conditions changed, that is the moment for a person to retrain.

### Tags deleted and recreated

Learned values are stored keyed by the `table:tag` name. Deleting a tag leaves the learned values behind, so attaching **different equipment under the same name later applies the old reference**.

If the new machine is quieter, anomalies are never caught; if louder, alarms fire constantly. On screen it just says "trained", which makes it hard to notice.

Data alone cannot tell whether it is the same machine, so the app asks. The Criteria screen offers **Same equipment — keep** / **Different equipment — reset**, and until you confirm, baseline and band evaluation are suspended for that tag. ISO zones are absolute, so they keep working throughout.

## Band energy extraction

Per-band values require frequency analysis of raw data, so a **separate timer** computes and accumulates them.

- Computation happens on the server, so the trend continues while the app is closed.
- A shorter extraction interval (1 minute – 1 hour) accumulates samples faster, letting you start learning sooner.
- Calculation always anchors to that tag's latest data timestamp, so stale intervals from stopped equipment are never scraped.

### Backfilling past data

Accumulating enough samples to train takes time. If raw data is already in the DB, **backfill** computes past intervals retroactively.

The calculation is identical to the timer's, so backfilled values and newly accumulated values can be trained on together. Progress and estimated time remaining are shown, and stopping partway keeps whatever was filled.

## The ruleset fingerprint

Generated reports carry a **ruleset fingerprint** — a short string computed from the thresholds and criteria used for evaluation.

It resolves why two reports disagree.

- Fingerprints **match** → the criteria were identical, so **the data changed**
- Fingerprints **differ** → **the criteria settings changed** in between

## Navigation

- [Previous: Alarms & events](./alarms.en.md)
- [Back to contents](./index.en.md)
- [Next: Troubleshooting](./troubleshooting.en.md)
