---
title: What this tool does and does not do
---

# What this tool does and does not do

> **It does not replace a human diagnosis.**
> It covers the gap between scheduled inspections, ranks what to look at first, and puts the
> spectrum the inspector needs on screen before they arrive.

In ISO 18436 terms: **it automates Category I (screening and data collection) and prints the
evidence for entering Category II (fault diagnosis). A person makes the call.**

Every figure below is measured on public datasets. Detection rates are always written
**together with the false-positive rate and the population** — a number missing any of the three
cannot be compared with anything.

---

## What kind of tool this is

**A bearing diagnosis tool.** The grade rises only when evidence stands at the bearing fault frequencies.

High vibration alone does not raise the grade — that fact is stated separately on screen. Non-bearing causes such as imbalance, misalignment and looseness are **not judged**, and never will be: they cannot be identified in principle without phase (a tachometer) and an axial channel.

The reasoning behind this choice is in [What happens when the axes are combined](#what-happens-when-the-axes-are-combined) below.

---

## The two modes

| | Asks | Window | When |
| :--- | :--- | :--- | :--- |
| **Detail analysis** (one-off) | "what does this signal look like" | 100 revolutions | when a person picks a period |
| **Continuous monitoring** | "is this machine getting worse" | 25 revolutions | every 10 minutes |

**Neither mode requires learning.** Both axes that build the grade — fault pattern and ISO zone — are absolute references. Baseline and band do require learning, but they **produce neither a grade nor an alert**; they serve as evidence only.

**Lead-time figures come only from continuous monitoring.** A one-off analysis has no time axis.

> If a fault is already progressing during the learning window, **that fault becomes the normal reference.** The automatic filters cannot catch this, so the learning window has to be chosen by a person against the maintenance history. That said, learned axes no longer produce grades, so a bad learning window **no longer causes false alarms** — only the evidence display is wrong.

---

## Snapshot performance — 383 cases, four public datasets

CWRU, MFPT, Paderborn, XJTU-SY. Only datasets whose bearing geometry (element count,
element diameter, pitch diameter, contact angle) is published in a primary source were used.

| | Result |
| :--- | :--- |
| **False positives on healthy** | **3/100 (3%)** |
| **Faults detected** | **188/283 (66%)** |
| Site correct among detected | 157/174 |

**"90% among detected" must never be quoted on its own** — it improves as adoption gets more
conservative. What reaches the user is **how often a fault is both caught and correctly located**.

By site: **the outer race stands out clearly, the inner race is middling, and rolling-element
faults are detected without naming the site.**

> **Snapshot and time axis answer differently for one item.** Rolling-element faults are essentially
> missed in a single snapshot, yet in run-to-failure testing one was caught with **72% of life
> remaining — about 25 days** (NASA IMS Set 1 B4). The questions differ: "can this one snapshot be
> **labelled** a ball fault" fails on the geometric overlap, while "is this bearing **getting worse**"
> succeeds. The site cannot be named, but the anomaly still stands.

### What happens when the axes are combined

Split by axis over the same 383 cases (the two learned axes trained leave-one-out on other healthy
cases in the same set):

| Axis | False positives alone | Detection alone |
| :--- | :--- | :--- |
| **Fault pattern** | **3/100 (3%)** | 183/283 (65%) |
| **Baseline** | **0/100 (0%)** | 79/283 (28%) |
| Band | 13/100 (13%) | 117/283 (41%) |
| **ISO zone** | **69/100 (69%)** | 104/283 (37%) |
| **OR of all four** | **69/100 (69%)** | 209/283 (74%) |
| **Current — pattern gates, ISO sets height** | **3/100 (3%)** | **188/283 (66%)** |

The grade used to be the **maximum** of four axes. Under a maximum rule, adding an axis can only raise the grade — so the ISO axis's 69% went straight onto the screen.

Today the **fault pattern is a gate and ISO sets the height**. False positives fall from 69% to 3%; detection falls from 74% to 66%, eight percentage points.

There is a bonus: **getting the machine class wrong no longer moves the false-positive rate** (3–4% across Classes I, II and III), because ISO no longer fires alarms. Previously one wrong class choice swung it between 49% and 75%.

> **That 69% is not a field false-positive rate — nor is it a machine-class setting problem.**
> Every rig in the pool is an **accelerated-life test stand**. A healthy stand runs under deliberately
> high load, so its vibration is high to begin with, while a bearing early in a fault still has low
> broadband velocity. The result: **the median ISO value of the healthy cases (1.33 mm/s) is higher than
> that of the faulted ones (1.21)** — in this pool the ISO value cannot separate damaged from sound.
>
> Loosening the class does not help: at Class IV (2.80 mm/s, the widest ISO class) 36% of healthy cases
> still exceed zone A, and reaching a 3% false-positive rate would need a boundary of 5.59 mm/s — twice
> the widest ISO class — at which point detection collapses to 30%.
>
> ISO 10816/20816 is written for **machines in normal service**, which an accelerated-life rig is not.
> So the table above measures **what happens when ISO limits are applied to equipment they were never
> written for.**

### What this design costs

| Lost | How much |
| :--- | :--- |
| 8 percentage points of detection (74% → 66%) | some of what four axes caught is now missed |
| **Alerts for non-bearing faults** | imbalance, misalignment and looseness do not raise the grade |
| **Alerts from the baseline axis** | the cleanest axis in the pool (0% FP, 28% detection) no longer alerts |

The third is a time-axis matter — the baseline lives on the 10-second axis while the grade lives on the 10-minute axis, and mixing them into one event stream blurs what an event timestamp means. **The values remain in the evidence table; only the alert is gone.**

---

## Time-axis performance — NASA IMS silent parallel run

The run-to-failure sets replayed at the **actual monitoring cadence (10 minutes)** with alerting off
and judgment on. Bearings that stayed healthy to the end ran on the same rig, so the false-alarm
denominator is sound.

> **A coarse replay cadence makes false alarms disappear.** An initial run at a 3-hour cadence gave
> 0.92 per point-month — but that is 1/18 of the real judgment count, so it skipped most of the
> scattered false hits. Re-running the same tags and periods at 10 minutes gave **13× more**.
> Every figure below is at the 10-minute cadence.

### Confirmation rule — two consecutive cycles

A grade is confirmed only when **the same judgment holds for two consecutive cycles**. Cycles, not
minutes, because judgment runs on the extraction interval (10 minutes by default) — every minute-based
setting collapsed to "next cycle" and meant nothing.

**All three faults had the same shape: one isolated hit → a long gap → a sustained run.**

| Bearing | First isolated hit | Then | Sustained run begins |
| :--- | :--- | :--- | :--- |
| Set 2 B1 (outer) | day 1.11 | **2.6-day gap** | **day 3.70** |
| Set 1 B4 (element) | day 0.10 | **7-day gap** | **day 9.8** |
| Set 1 B3 (inner) | day 33.3 | — | never |

Going to the machine on that first hit finds nothing. Hits of the same character occurred **77 times
across 7 healthy bearings**, and an operator cannot tell the two apart.

### Faulted bearings — at confirmation

| Bearing | Site | First alarm | Test length |
| :--- | :--- | :--- | :--- |
| Set 2 B1 | outer race | **46% of life remaining ≈ 3.1 days** | 6.8 d |
| Set 1 B4 | rolling element | **72% remaining ≈ 25 days** (site not named) | 34.5 d |
| Set 1 B3 | **inner race** | **never** (two late isolated hits only) | 34.5 d |

**2 of 3 detected.** Accepting isolated hits would make it 3 of 3, but the "earlier" alarm that buys
is the first hit in the table above — nothing to find on site. The inner race stood only on days 33.3
and 34.1, too late for planned maintenance.

### False alarms on healthy bearings — by confirmation rule

Measured on 7 healthy points over 158 days (Sets 1 and 2).

| Rule | False alarms | Per point-month | Faults detected |
| :--- | ---: | ---: | ---: |
| Isolated hit confirms | 77 | **14.6** | 3/3 (all on isolated hits) |
| **Two consecutive** | **28** | **5.3** | **2/3** |
| Three consecutive | 19 | 3.0 | 2/3 |

The denominator is **measurement points** — two channels on one bearing alarm independently, so what an operator actually receives scales with points.

Variation between sets is large. **Set 1 (4 healthy points, 138 days) gives 1.1 per point-month**
under the two-cycle rule; Set 2 gives 34 — Set 2 is the worst case, with a neighbouring bearing
failing on the same rig. Normal conditions look like Set 1.

**Isolated hits are not discarded.** They are recorded as `observation` events, and the grid score for
every cycle accumulates as its own time series and appears on the trend chart — only the alert is withheld.

> **Do not convert accelerated-life percentages into field time.** High-load accelerated tests
> compress the propagation phase far more than the initiation phase. **There is no field validation
> of lead time or false-alarm rate yet.**

### Threshold stability (LODO)

Checked whether the monitoring adoption threshold of 3.0 is fitted to one particular dataset: hold out each dataset, pick the threshold on the rest, then measure false positives on the held-out set.

| Held out | Threshold picked | FP on that set |
| :--- | ---: | ---: |
| CWRU · MFPT · Paderborn · Paderborn (900 rpm) | **3.05** (all four folds agree) | **0/55** |
| XJTU | 2.43 | 13/45 |

Four of five folds agree with the whole-pool value (3.03), so **the threshold is stable.**

The one dissenting fold comes from XJTU's "healthy" label — it uses the **early portion** of bearings being run to destruction under 12 kN. Holding that set out drops the threshold to 2.43, and its own early-stage cases then trip it. This is a labelling issue, not threshold overfitting.

---

## What it cannot do — named explicitly

| | Why |
| :--- | :--- |
| **Early inner-race detection** | Never detected even over 34.5 days. Modulation spreads energy into `BPFI ± k·1×`, so no peak stands |
| **Naming the site of a ball fault** | `BPFO = n × FTF` is an **exact identity**, so the rolling-element grid coincides with the outer race. Detected, but reported as "site unknown" |
| **Cage faults** | Impossible in principle from the fault frequencies, and fracture progresses over minutes with no warning |
| **Imbalance · misalignment · looseness** | Without phase (tachometer) and an axial channel this is **impossible in principle**. High amplitude is reported as a fact; the grade does not rise |
| **Why it failed (failure mode)** | Fatigue, poor lubrication, electrical erosion, wear are not judged. A person narrows it from site + operating history |
| **Stage-1 degradation** | The AE band (20–60 kHz) is beyond the sampling rate |
| **Second-scale incidents** | Judgment runs every 10 minutes. Sudden fracture or debris ingress is the domain of protection relays and interlocks |
| **Large · slow · variable-speed machines** | Absent from the verification pool (see below) |

> **Whether the demodulation band fits large machines is not yet known.**
> The band is fixed at 1–5 kHz. What actually tends to sit there is the **accelerometer mounting
> resonance** (a few kHz, depending on attachment), while the bending modes of the bearing ring
> itself go **down** as the machine gets larger. So the claim "large machines are missed because
> their resonance is higher" is not physically sound. With no large machines in the pool,
> **which direction it fails has never been measured.**

---

## Limits of the sample

- **The time axis is a case study of 14 bearing channels (NASA IMS).** Do not quote the percentages without the per-bearing table
- **Accelerated-life bias** — on Paderborn, artificially machined defects scored markedly better than real accelerated-life damage. The same bias may apply to lead time
- The pool contains **no large, low-speed, or variable-speed machines**
- **It has never been measured on a real machine.** The 5.3 figure above is from test rigs — measure it in silent parallel operation on your own equipment before enabling alerts

---

## Things that were tried and lost

Compared at a fixed false-positive rate. **Read this table before trying any of them again.**

> The detection rates below are relative comparisons measured on the pool and configuration in use at the time. Do not compare them against the current 66% — compare each only against the "current at the time" row.

| Attempt | Detection | Why it failed |
| :--- | :--- | :--- |
| Current at the time | **54%** | — |
| Kurtogram picks the demodulation band | 6–11% | Maximising kurtosis latches onto anti-aliasing noise and inverter switching bands. **Rewriting it as a proper spectral kurtosis on the analytic signal changes nothing** — real 6%, magnitude 6%, complex SK 7%, all three settling on 12–16 kHz. The objective function is the problem, not the implementation |
| Fault frequencies from measured 1× | 31% | Measurement jitter is amplified ninefold at BPFI (≈9×). A nameplate value is wrong but *consistently* wrong |
| Cepstrum pre-whitening | 29% | The bandpass already removed discrete shaft components; the remaining 1× is **modulation**, not a discrete line |
| Suppressing integer shaft orders in the envelope | 45–48% | A 16-ball BPFO sits at 7.09×, 1.3% from an integer — removing the shaft family removes real evidence |
| Two-band hybrid | tie | With Šidák correction the gain disappears — the low band alone is enough |
| Nominating judgment anchors by rollup RMS | 72% | Evidence gets much stronger but it also finds the loudest transient on healthy machines. At an equal false-positive rate, even spacing wins at 89% |
| Local noise-floor normalisation | 50% | Dividing by the median of ±64 bins around the target means **the stronger the fault, the more its own sidebands lift the floor**, eroding the very evidence being measured |
| Stouffer z combination | 52% | Making uninformative sites neutral ought to favour the inner race, but neither overall nor inner-race detection moved |
| Squared envelope (SES) | 52% | Splitting the product terms sounds cleaner, but it **manufactures harmonics that are not there** — on a synthetic AM signal the 2nd/1st ratio is 0.15 |
| Requiring anchor persistence (K or more) | 56–72% | False alarms drop, but **a real fault that stands on a single anchor dies with them** |
| Lowering the band edge to 200 Hz | worse | Shaft-rotation components and their modulation enter the band and coincide with the grid by chance |
| **Maximum of four axes (the old rule)** | **74% at 69% FP** | Adding axes can only raise the grade, so the ISO axis's false positives land directly on screen |
| **Putting learned axes in the gate** | FP 3% → 15% | **The same tag produces different grades depending on training state** — a one-off analysis must not depend on it |
| 50-revolution monitoring window | detection unchanged (59%) | Same detection as 25 revolutions at twice the computation cost |

---

## Related documents

- [Fault types and signatures](./faults.en.md) — which faults are distinguished, on what evidence
- [How detection works](./detection.en.md) — the gate structure and the two cadences
- [Alarms and events](./alarms.en.md) — the alarm state machine and suppression
