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
> If nothing stands at the bearing fault frequencies, the grade stays Good no matter how high the
> vibration is — but the screen states separately that the amplitude is high.

**Detail analysis and continuous monitoring use the same rule.** Only the window length and the cadence differ.

## The overall flow

Monitoring runs on **two cadences**. One is fast and light; the other is slow and heavy.

```
                     raw vibration data
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
  every evaluation interval        every extraction interval
       (default 3 s)                   (default 10 min)
    one window RMS                FFT → envelope → fault-frequency grid
          │                                   │
          ├── running / stopped               ├── fault pattern (gate)
          ├── signal lost                     ├── ISO zone (height) ← same waveform
          ├── instrumentation fault           └── band energy (evidence)
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

**Grade events come only from the right-hand axis.** The left-hand axis only **stops** judgment (stopped, lost, instrumentation fault), **fills in evidence**, and produces the monitoring-health events (signal lost, instrumentation fault, instrumentation restored).

### Why two cadences

| | Fast axis | Slow axis |
| :--- | :--- | :--- |
| Computation | one window RMS | raw waveform → FFT → envelope |
| Weight | light | heavy (frequency analysis of the raw waveform) |
| Answers | "is it running, is data arriving" | "what has gone wrong" |

The fault pattern needs frequency analysis of the raw waveform, which is far too heavy to run every few seconds. With many tags the computation would overrun the interval.

And there is **no reason to**. Bearing faults grow over hours and days. A failure that develops in seconds is already past tense at either cadence — that is the job of a protection relay, not condition monitoring.

### Why grade events come from only one axis

Baseline and band emit no events, for two reasons.

**① The time axes differ.** The baseline is judged on the fast axis's window RMS, while the grade is set by the slow axis's fault pattern. Mixing them into one event stream **blurs what an event timestamp refers to**, and re-notification intervals interleave two cadences.

**② Adding axes multiplies false alarms.** The band axis compares many series against their limits and fires if any one exceeds, so it produces many false positives on its own.

Both axes **remain as evidence.** They still appear on the card and in the evidence table, and are used to narrow down which series moved. Only the alert is gone.

> **The cost is explicit.** The baseline is the axis with the fewest false positives, and it has been removed from alerting. Amplitude rises from non-bearing causes (imbalance, misalignment, looseness) must be **seen by a person on screen**. See [Limits and alternatives](#limits-and-alternatives).

## The fast axis's judgment value — window RMS

On the fast axis, the judgment value is **a single RMS over a whole window**, not the most recent point.

Vibration fluctuates moment to moment, so judging on one point makes the value jitter. Instead a fixed length of data — "the last 10 seconds" — is combined into one effective value.

**RMS window** and **evaluation interval** are different settings.

| Setting | Meaning | Default | Where |
| :--- | :--- | :--- | :--- |
| RMS window | how much data is combined into one value | last 10 s | Alarms |
| Evaluation interval | how often the judgment runs | every 3 s | Alarms |
| Extraction interval | how often the fault pattern is computed | **every 10 min** | Criteria → Band energy trend |

The first two range over 3 s – 1 h (window) and 1 s – 1 min (interval). The extraction interval is 10 min · 30 min · 1 h; with many tags, intervals shorter than one computation cycle are blocked.

A **longer** window merges brief excursions into a single state — slower to react, but steadier. If the window is shorter than the interval, data falls between judgments and the screen warns about it.

For machines whose load varies cyclically, choose a window longer than that cycle. A shorter one makes the load variation itself look like a stop or a breach.

## Fault pattern — the axis that switches the grade

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
   raw waveform → keep 1–5 kHz → extract amplitude variation (envelope) → low-freq spectrum
                    (bandpass)                                            (the grid goes here)
```

**The band is fixed at 1–5 kHz.** Choosing the most impulsive band automatically (a kurtogram) latched onto anti-aliasing noise or inverter electrical bands in verification on public data, and detection dropped sharply. So the kurtogram is shown only as a reference in detail analysis (**per-band impulsiveness**) and never used for judgment.

Sensors whose sample rate is too low for the 1–5 kHz band are demodulated over the full band. The card tooltip then notes that the evidence is weak and early bearing faults will not be detected.

> **Caution on large machines** — 1–5 kHz is the resonance region of the small-to-medium test rigs used for verification. What often sits in that band in practice is the **accelerometer mounting resonance** (a few kHz depending on how it is attached); the bending modes of the bearing ring itself go **down** as the machine gets larger. The band may not fit large slow machines, and since the verification data contains none, **which way it fails is not yet known.**

### When it fires

Energy at the grid positions is scored against the surrounding noise level (the grid score). If that score crosses the adoption threshold, the gate fires.

| | Window | Adoption threshold |
| :--- | :--- | :--- |
| **Detail analysis** | 100 revolutions | 4.0 |
| **Continuous monitoring** | **25 revolutions** | **3.0** |

Monitoring uses a shorter window because of server cost. A shorter window lowers scores overall, so the threshold drops with it. The price is that monitoring catches slightly less than detail analysis (detection 66% → 59% on public data).

Monitoring is a **trigger**; confirmation is done by detail analysis at 100 revolutions — a short window is acceptable as long as it does not miss.

### When it cannot judge

Without the shaft speed or the bearing geometry there is no grid to build. In that case the grade **does not rise** — but that is "cannot judge", not "normal".

The screen does not hide it. Monitoring cards show **On hold** (cannot judge) instead of a grade, detail analysis shows "criteria n/N (… not applied)", and the Equipment screen flags it with a **Cannot judge** badge. Sleeve (journal) bearings fall here too, having no rolling elements.

> **The shaft speed is never guessed.** A grid built on a wrong speed produces a silently wrong grade.

## ISO zone — the axis that sets the height

The vibration severity zones defined by ISO 10816 (A Good → D Critical). The boundaries depend on the equipment class (Equipment).

| Class | Good↔Warning | Warning↔Danger | Danger↔Critical |
| :--- | ---: | ---: | ---: |
| Class I (small ≤15 kW) | 0.71 | 1.8 | 4.5 |
| Class II (medium 15–75 kW) | 1.12 | 2.8 | 7.1 |
| Class III (large, rigid foundation) | 1.8 | 4.5 | 11.2 |
| Class IV (large, flexible foundation) | 2.8 | 7.1 | 18.0 |

Values are mm/s (velocity RMS), the ISO 10816 figures, editable on the Criteria screen. An empty class is judged as Class II.

**Acceleration (g) and displacement (μm) sensors are converted to velocity and judged against the same class boundaries.** The g and μm rows on the Criteria screen (defaults 0.5/1.0/2.0 g, 12/25/50 μm) are general reference values, not quantities the standard defines, and are used only for the RMS-trend reference lines and period statistics of sensors in that unit. That is why leaving the unit empty (treated as velocity) throws off the grade height for acceleration and displacement sensors.

> **Band limiting** — the ISO zone is measured on the 10–1000 Hz band only, because the zone boundaries in the standard are numbers derived from measurements over that band. On sensors with strong high-frequency content the full-band value and the ISO value can differ considerably (hover the card's number to see both); the band-limited one is the value that matches the standard.

### Why ISO is not an independent axis

Firing alerts from the ISO zone alone flagged 69% of healthy machines in verification on 383 public-dataset cases. Using the fault pattern as the gate flags 3% (with slightly lower detection). As a bonus, picking the wrong machine class barely moves the false-positive rate — ISO does not fire alarms.

That 69% is not a field false-positive rate; it comes from the accelerated-life test rigs used for verification. See [What this tool does and does not do](./scope.en.md#what-happens-when-the-axes-are-combined).

### Which waveform sets the height

In monitoring, the ISO value is measured on **the very waveform the pattern was measured on**. Using the latest fast-axis ISO would make the grade move every few seconds, out of step with the 10-minute pattern.

If ISO could not be measured during the pattern computation, it falls back to the fast-axis value — it never drops the grade to zero.

## Evidence axes — the two that do not set a grade

### Baseline — relative to normal

Learns what the machine looks like when healthy, then measures the departure from it.

```
limit = normal level (μ) + k × normal spread (σ)
```

Even while the absolute value is still in zone A, a **clear rise above normal** is caught. `k` is the sensitivity — smaller reacts sooner, larger only when it is certain.

On very steady machines with almost no normal variation the limit could sit too close to the normal level, so a breach requires **at least +20% above normal**.

A breach **does not raise the grade and does not emit an event.** It appears on the card (hover the number) and in the evidence table as "sharp rise versus normal". How to train it is in [First setup › Baseline learning](./first-setup.en.md#baseline-learning).

### Band energy — per frequency band

Catches changes invisible in the overall RMS. A growing bearing fault barely moves total vibration, but the band where it appears jumps several-fold.

Bands are divided into five ranges relative to the shaft frequency (1×). The very-high range is subdivided into 1–2 · 2–4 · 4–8 · 8 kHz+, so eight frequency bands actually accumulate.

1× is measured from the waveform at every extraction. Only a peak **within ±5% of the entered RPM** counts as 1×, a peak at the line frequency (the 50/60 Hz setting) is excluded, and if none is found the entered RPM is used — the same rule as the measured 1× in detail analysis. A wider window catches peaks from other rotating parts, such as a belt-coupled motor, and shifts every band edge. So if the entered RPM is more than 5% off, the band edges are off too — enter the rated speed accurately.

| Band | Range | Typically shows |
| :--- | :--- | :--- |
| Sub-synchronous | 2 Hz – 0.5× | oil whirl · looseness · belts |
| 1× band | 0.5× – 1.5× | imbalance · misalignment |
| Fault band | 1.5× – 10× (max 1 kHz) | bearing fault frequencies · gears |
| High | – 1 kHz | early bearing faults |
| Very high | above 1 kHz (1–2 · 2–4 · 4–8 · 8 kHz+) | impacts · friction |

Each band learns a normal reference the same way the baseline does, and the evidence table records **how many times over the limit** it is. A breach in a band above the mounting's trustworthy limit is marked **(provisional)** — the rise is real, but it cannot be told apart from sensor-mount resonance.

> On low-sample-rate sensors the upper bands fall outside the measurement range and are not learned, and without a bearing part number the envelope fault-frequency series never accumulate. Unlearned series are left out, and the screen shows something like "4/9 계열 학습됨" (4/9 series trained).

### Why learned axes are not in the gate

This matters most in detail analysis. Putting a learned axis in the gate makes **the same tag produce different grades depending on whether it has been trained**, and false positives rose sharply in verification.

A one-off analysis answers "what does this signal look like right now", and must not depend on training state.

### Crest does not raise the grade

Crest factor (peak over RMS) is also excluded from the grade. At low amplitude the denominator is small, so a single spike swings it wildly.

It is reflected in the **verdict wording** instead. If amplitude is normal but crest exceeds its reference, the verdict does not assert "normal operation". The reference is set where noise alone almost never crosses it, and impulsiveness is not judged when a long period is viewed through minute- or hour-level summaries (load changes alone inflate the maximum there).

Low RMS with high crest is **both the signature of an early localised fault and the signature of an instrumentation spike** (ESD, cabling, contact). That one number cannot separate them, so it does not move the grade — only states the fact. What separates them is whether the impacts **repeat**: aligned with the fault frequencies in the envelope means a fault, scattered means instrumentation. The recommendation text directs that check.

When an instrumentation fault (clipping, DC drift) is active, that warning's wording takes precedence — it already directs an instrumentation check.

## Deciding the grade

```
grade = did the fault pattern fire?  →  no  : Good
                                     →  yes : max(Warning, ISO zone grade)
```

If the pattern fires but ISO is in zone A the grade is **Warning**. Naming a cause while leaving the grade Good would make the screen contradict itself.

Axes that did not raise the grade **are still reported.** A screen that only says "Good" would be lying.

| Situation | Grade | Screen text |
| :--- | :--- | :--- |
| Pattern ○ · ISO Danger | Danger | outer-race evidence · amplitude in the danger zone |
| Pattern ○ · ISO Good | **Warning** | outer-race evidence · amplitude still low |
| Pattern ✕ · ISO Danger | **Good** | **amplitude high but no bearing-fault evidence** — check imbalance/alignment/looseness |
| Pattern ✕ · baseline breach | Good | sharp rise versus normal |
| Pattern ✕ · band breach | Good | high-band breach |
| Speed/geometry missing | not graded | **On hold (cannot judge)** |

The third row is the central trade-off of this design. **Non-bearing failures do not raise the grade** — this is a bearing diagnosis tool, and imbalance and misalignment cannot be identified in principle without phase (a tachometer) and an axial channel. It is stated in words rather than hidden.

## Events

Only **moments where the state changed** are recorded. Nothing is written while a state persists.

| Type | When | Which axis |
| :--- | :--- | :--- |
| **Observation** | first cycle out of Good — **before confirmation, no alert** | slow (pattern) |
| **Threshold** | the same grade held for **two consecutive cycles** | slow (pattern) |
| **Sustained** | a bad state persists, every re-notification interval | slow (pattern) |
| **Improved** | out of alarm level but not yet Good | slow (pattern) |
| **Recovered** | fully back to Good | slow (pattern) |
| **Instrumentation fault** | clipping · DC drift · flatline and the like, lasting 1 minute | fast |
| **Instrumentation restored** | the instrumentation fault clears and stays normal for 5 minutes | fast |
| **Signal lost** | no data arriving | fast |

The last three report **whether monitoring is working at all**, not a vibration grade. The worst failure mode is a screen that holds its last value and keeps looking normal.

**Baseline and band emit no events.** Their state is still tracked and shown in the evidence table.

### Improved versus recovered

Getting better within one episode has two stages.

| | Meaning | Response |
| :--- | :--- | :--- |
| Improved | the emergency is over | lower the priority, stand down |
| Recovered | fully normal | close the work order |

They are split because the field response differs. And machines that run near a zone boundary rarely reach fully Good — they still need to hear that things improved.

Each stage is recorded **once per episode**. Even stepping down Critical → Danger → Warning → Good produces one improved and one recovered.

### Recording rules

- **Nothing is recorded while Good persists.** Only the single recovery from a bad state.
- **Intermediate steps that are still bad** (Critical → Danger) are not recorded separately; they are represented by improved.
- **A newly seen tag that is already bad** gets an `observation` right away, and is confirmed if the next cycle agrees. It is not confirmed on the first cycle so that switching monitoring on does not fire alarms for every bad tag at once.
- **Events are never deleted automatically.** History is data too.

### Reading event values

A grade event's value is **the ISO value that set the grade height** (measured on the very waveform the fault pattern was measured on). But ISO is not the axis that switched the grade on (the gate is the fault pattern), so the number alone can mislead. "Why this grade" is answered by the fault-pattern evidence.

| Where | What you see |
| :--- | :--- |
| The "detail" cell of the monitoring event list | velocity sensors: `ISO value · limit (zone boundary crossed)` / acceleration and displacement sensors: `value in the original unit · ISO <zone> 구간 · 결함 패턴 <site>` / signal lost: `N분 무수신` / instrumentation fault · recovery: the reason (e.g. `플랫라인`; hover for the explanation) |
| The "detail" column of exports (CSV/JSON) and notification text | the fault pattern's grid score · site · cycle, and the reason for an instrumentation fault |

Examples from the export's "detail" column:

```
observation   격자 3.2 · 외륜(BPFO) · 1회차 — 확정 전        (grid 3.2 · outer race · cycle 1, not confirmed)
threshold     격자 3.2 · 외륜(BPFO) · 2회 연속 확정          (confirmed on two consecutive cycles)
sustained     격자 4.1 · 지속 재알림                          (re-notification)
recovered     격자 2.2 · 4시간 20분 만에 복귀                 (cleared after 4 h 20 min)
```

## Confirmation — two consecutive cycles

An alarm does not go out the moment the grade changes. **The same judgment must hold for two consecutive cycles** — going up and coming down alike.

```
cycle 1   grid 3.2 → Warning   observation event · no alert
cycle 2   grid 3.2 → Warning   threshold · alert sent
cycle 3   grid 2.1 → Good      (not recovered yet)
cycle 4   grid 2.0 → Good      recovered · alert sent
```

One cycle back the other way breaks the run and the count restarts. Because judgment runs on the extraction interval, confirmation counts **cycles**, not minutes.

### Why two

Replaying public run-to-failure data at the real monitoring cadence showed that faults usually took the shape **"one isolated hit → a long gap → a sustained run"**, and going to the machine on that first hit found nothing. Isolated hits of the same character also occurred often on healthy bearings.

Requiring two consecutive cycles cuts false alarms sharply compared with confirming on isolated hits, and the alarm lands where the real signal begins. The figures are in [What this tool does and does not do › Time-axis performance](./scope.en.md#time-axis-performance--run-to-failure-tests).

> **Isolated hits still leave a trace.** Hits that never reach confirmation are recorded as `observation` events. Only the alert is withheld.

### Instrumentation faults stay time-based

Signal loss, clipping and DC drift are judged on the **fast axis**, where cycles do not apply. A single spike must not send "sensor failure", so a 1-minute persistence is required, and 5 minutes to clear. Neither is a setting.

### DC — a constant DC does not block

A MEMS accelerometer's vertical axis (1 g of gravity) or a proximity displacement probe (gap voltage) carries a mean far larger than the vibration even when healthy. Judgment values go through band filtering and mean removal and are unaffected by that DC, so **a constant DC does not block judgment**; detail analysis and reports only note it (a grey "DC 성분" line, separate from the warning box).

What blocks is a **wandering 1-second mean** (the means wander by more than half the vibration's spread, enough to inflate the judged RMS): a sensor bias or cable fault, or a magnetic mount rotating so the gravity component changes.

- It is checked only when the shaft speed is known and gives at least 10 revolutions per second (600 rpm or more). On slow machines real vibration moves the 1-second mean.
- Slow value tags with fewer than 4 samples per revolution (transmitter values logged a few times a second) are not checked — they are not waveforms to begin with.

## Stopped machines and lost signal

A sudden drop in value does not mean things got better.

- **Machine stopped** — if the judgment value falls below 20% of the normal operating level, the machine is treated as stopped and judgment is **frozen**. Vibration faults do not heal themselves, so an unexplained drop usually means the machine stopped or the sensor was lost. A "recovered" alert here would suggest the machine was repaired. While frozen the previous state is held, so the fact that it was bad survives the restart. The card shows a **Stopped** badge.
- **Signal lost** — if no new data arrives for 6 × the evaluation interval (at least 1 minute), it is treated as lost and an event is recorded. The card shows a **Signal lost** badge and the sparkline dims.

## Tags with too few samples

The fault pattern sizes its window by **sample count relative to shaft speed**, not by time.

Tags whose stored timestamps are spread out (replayed data, intermittent collection) have fewer samples in the same span. In that case the window is widened and re-read (up to twice); if it still falls short, the pattern judgment is skipped for that cycle. If it overshoots, only the most recent portion is used — a longer window mixes operating states.

A skipped cycle shows on the card as **On hold** (fault pattern measurement failed), with the previous grade held — so it never quietly reads as "Good".

## Baseline learning

The app learns the **normal level (μ)** and **normal spread (σ)** of a healthy operating window. It uses median-based estimates that spikes do not sway, excludes stopped and start-up intervals automatically, and refuses a window that is mostly downtime.

It **never relearns automatically.** Relearning while a fault is growing would absorb that fault into normal. After maintenance or a change in operating conditions, a person should relearn deliberately.

Confirmation when different equipment appears under the same name (same equipment — keep / different equipment — reset), when learning is refused, and the rest are in [First setup › Baseline learning](./first-setup.en.md#baseline-learning). Until confirmed, only that tag's baseline and band evidence pause; the fault pattern and ISO zone need no learning and keep working.

## Band energy extraction

Band values require frequency analysis of raw data, so the **server's band extraction timer** computes and accumulates them at every extraction interval.

- Computation happens on the server, so the trend continues while the app is closed.
- To avoid scraping old windows of a stopped machine, computation is always anchored to that tag's most recent data time.
- The fault pattern is measured on the same interval but separately from band extraction — by the app in app monitoring, and by the server monitoring timer in server monitoring. **Grading continues even with band extraction off.**

### Backfilling history

Accumulating enough samples takes time. If raw data is already in the database, **backfill past data** computes it retroactively.

The method is identical to the timer's, so backfilled values and newly accumulated ones can be learned together. Progress and an estimated duration are shown, and stopping midway keeps whatever was filled.

## Detail analysis versus monitoring

Same rule; different **window, cadence and moment**.

| | Detail analysis | Continuous monitoring |
| :--- | :--- | :--- |
| Grade formula | pattern gates, ISO sets height | **identical** |
| Pattern window | 100 revolutions | 25 revolutions |
| Adoption threshold | 4.0 | 3.0 |
| When | when a person picks a period | automatically every extraction interval |
| Which moment | the **worst** of several points (up to 8) across the period | now |
| Learning required | none | none (evidence display only) |

### Why detail analysis samples several points

Measuring only the **end** of a period lets that one moment stand for the whole period. In a real outer-race failure, the end of the selected window was already a stopped machine, and the grade came out Good.

So the period is divided, each point is judged, and the **worst** is used. Points with no data snap backwards and duplicates are removed. Which point was chosen is shown as the "judgment time" next to the grade.

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
- [Next: Fault types and signatures](./faults.en.md)
