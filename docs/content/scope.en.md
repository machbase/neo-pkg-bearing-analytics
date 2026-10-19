---
title: What this tool does and does not do
weight: 56
---

#

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
| **Detail analysis** (one-off) | "what does this signal look like" | 100 revolutions or more (up to 22 s) | when a person picks a period |
| **Continuous monitoring** | "is this machine getting worse" | 25 revolutions | every extraction interval (10 min by default) |

**Neither mode requires learning.** Both axes that build the grade — fault pattern and ISO zone — are absolute references. Baseline and band do require learning, but they **produce neither a grade nor an alert**; they serve as evidence only.

**Lead-time figures come only from continuous monitoring.** A one-off analysis has no time axis.

> If a fault is already progressing during the learning window, **that fault becomes the normal reference.** The automatic filters cannot catch this, so the learning window has to be chosen by a person against the maintenance history. That said, learned axes do not produce grades, so a bad learning window **does not cause false alarms** — only the evidence display is wrong.

---

## Snapshot performance — 383 cases, four public datasets

CWRU, MFPT, Paderborn, XJTU-SY. Only datasets whose bearing geometry (element count,
element diameter, pitch diameter, contact angle) is published in a primary source were used.

| | Result |
| :--- | :--- |
| **False positives on healthy** | **3/100 (3%)** |
| **Faults detected** | **183/283 (65%)** |
| Faults located correctly, out of all faults | 153/283 (about 54%) |
| Site correct among detected | 153/169 (91%) |

Detection counts only cases where the grade turned on (fault pattern adopted). The site-accuracy denominator, 169, is the detected cases with a single fault type out of the 183 detected (the 14 combined outer + inner race faults are excluded, since naming either site would count as correct); 4 of them are rolling-element candidates and go out as site unknown.

**"91% among detected" must never be quoted on its own** — it improves as judgment gets more
conservative. What reaches the user is **a correct site for a little over one fault in two**.

By site: **the outer race stands out clearly, the inner race is middling, and rolling-element
faults are detected without naming the site.**

> **Snapshot and time axis answer differently for one item.** Rolling-element faults are essentially
> missed in a single snapshot, yet in run-to-failure testing one was caught with **72% of life
> remaining — about 25 days** (NASA IMS Set 1 B4). The questions differ: "can this one snapshot be
> **labeled** a ball fault" fails on the geometric overlap, while "is this bearing **getting worse**"
> succeeds. The site cannot be named, but the anomaly still stands.

### What happens when the axes are combined

Split by axis over the same 383 cases:

| Axis | False positives alone | Detection alone |
| :--- | :--- | :--- |
| **Fault pattern** | **3/100 (3%)** | 183/283 (65%) |
| **Baseline** | **0/100 (0%)** | 79/283 (28%) |
| Band | 13/100 (13%) | 117/283 (41%) |
| **ISO zone** | **69/100 (69%)** | 104/283 (37%) |
| **Alarm if any of the four fires** | **69/100 (69%)** | 209/283 (74%) |
| **Current — pattern gates, ISO sets height** | **3/100 (3%)** | **183/283 (65%)** |

If the grade were the maximum of the four axes, adding an axis could only raise it — so the ISO axis's 69% would go straight onto the screen.

That is why the **fault pattern is a gate and ISO sets the height**. False positives fall from 69% to 3%; detection falls from 74% to 65%, nine percentage points. The grade rises only when the fault pattern turns it on, so detection equals the fault pattern on its own.

There is a bonus: **getting the machine class wrong barely moves the false-positive rate** (3–4% across Classes I, II and III), because ISO does not fire alarms.

> **That 69% is not a field false-positive rate — nor is it a machine-class setting problem.**
> Every rig in the pool is an **accelerated-life test stand**. A healthy stand runs under deliberately
> high load, so its vibration is high to begin with, while a bearing early in a fault still has low
> broadband vibration. In this pool the ISO values of healthy and faulted cases are about the same — or healthy
> is even higher — so the ISO value cannot separate damaged from sound. Loosening the class does not help.
>
> ISO 10816/20816 is written for **machines in normal service**, which an accelerated-life rig is not.
> So the table above measures **what happens when ISO limits are applied to equipment they were never
> written for.**

### What this design costs

| Lost | How much |
| :--- | :--- |
| 9 percentage points of detection (74% → 65%) | some of what four axes caught is now missed |
| **Alerts for non-bearing faults** | imbalance, misalignment and looseness do not raise the grade |
| **Alerts from the baseline axis** | the cleanest axis in the pool (0% FP, 28% detection) does not alert |

The third is a time-axis matter — the baseline lives on the fast axis (evaluation interval) while the grade lives on the slow axis (extraction interval), and mixing them into one event stream blurs what an event timestamp means. **The values remain in the evidence table; only the alert is gone.**

---

## Time-axis performance — run-to-failure tests

The NASA IMS run-to-failure sets replayed at the **actual monitoring cadence (10 minutes)** with alerting off
and judgment on. Bearings that stayed healthy to the end ran on the same rig, so the false-alarm
denominator is sound.

### Faulted bearings — at confirmation

| Bearing | Site | First alarm (confirmed on two consecutive cycles) | Test length |
| :--- | :--- | :--- | :--- |
| Set 2 B1 | outer race | **46% of life remaining ≈ 3.1 days** | 6.8 d |
| Set 1 B4 | rolling element | **72% remaining ≈ 25 days** (site not named) | 34.5 d |
| Set 1 B3 | **inner race** | **never** (two late isolated hits only) | 34.5 d |

**2 of 3 detected.** All three faults had the same shape: **one isolated hit → a long gap → a sustained run**. Accepting isolated hits would make it 3 of 3, but the "earlier" alarm that buys is the first hit — nothing to find on site. The inner race stood only twice at the very end of the test, too late for planned maintenance.

### False alarms on healthy bearings — by confirmation rule

Measured on 7 healthy points over 158 days.

| Rule | False alarms per point-month | Faults detected |
| :--- | ---: | ---: |
| Isolated hit confirms | **14.6** | 3/3 (all on isolated hits) |
| **Two consecutive (current)** | **5.3** | **2/3** |
| Three consecutive | 3.0 | 2/3 |

The denominator is **measurement points** — two channels on one bearing alarm independently, so what an operator actually receives scales with points.

Variation between test sets is large. False alarms concentrated in the worst case (Set 2, with a neighboring bearing failing on the same rig); the other set (Set 1) gave **1.1 per point-month** under the two-cycle rule. Normal conditions look like Set 1.

**Isolated hits are not discarded.** They are recorded as `observation` events — only the alert is withheld.

> **Do not convert accelerated-life percentages into field time.** High-load accelerated tests
> compress the propagation phase far more than the initiation phase. **There is no field validation
> of lead time or false-alarm rate yet.**

---

## What it cannot do — named explicitly

| | Why |
| :--- | :--- |
| **Early inner-race detection** | Never detected even over 34.5 days. Modulation spreads energy into `BPFI ± k·1×`, so no peak stands |
| **Naming the site of a ball fault** | The rolling-element fault-frequency grid overlaps the outer-race grid. Detected, but reported as "site unknown" |
| **Cage faults** | Impossible in principle from the fault frequencies, and fracture progresses over minutes with no warning |
| **Imbalance · misalignment · looseness** | Without phase (tachometer) and an axial channel this is **impossible in principle**. High amplitude is reported as a fact; the grade does not rise |
| **Why it failed (failure mode)** | Fatigue, poor lubrication, electrical erosion, wear are not judged. A person narrows it from site + operating history |
| **Stage-1 degradation** | The AE band (20–60 kHz) is beyond the sampling rate |
| **Second-scale incidents** | Grades are judged every extraction interval (10 minutes by default). Sudden fracture or debris ingress is the domain of protection relays and interlocks |
| **Large · slow · variable-speed machines** | Absent from the verification pool (see below) |

> **Whether the demodulation band fits large machines is not yet known.**
> The demodulation band of the fault pattern that sets the grade is fixed at 1–5 kHz. What actually tends to sit there is the **accelerometer mounting
> resonance** (a few kHz, depending on attachment), while the bending modes of the bearing ring
> itself go **down** as the machine gets larger. So the claim "large machines are missed because
> their resonance is higher" is not physically sound. With no large machines in the pool,
> **which direction it fails has never been measured.**

---

## Limits of the sample

- **The time axis is a case study of 14 NASA IMS bearing channels.** Do not quote the percentages without the per-bearing table
- **Accelerated-life bias** — on Paderborn, artificially machined defects scored markedly better than real accelerated-life damage. The same bias may apply to lead time
- The pool contains **no large, low-speed, or variable-speed machines**
- **It has never been measured on a real machine.** The 5.3 figure above is from test rigs — before enabling alerts, run judgment without alerts on your own equipment (a silent parallel run) and measure it yourself

---

## Related documents

- [Fault types and signatures]({{< relref "faults" >}}) — which faults are distinguished, on what evidence
- [How detection works]({{< relref "detection" >}}) — the gate structure and the two cadences
- [Alarms and events]({{< relref "alarms" >}}) — the confirmation rule and notification settings

## Navigation

- [Previous: Fault types and signatures]({{< relref "faults" >}})
- [Back to contents]({{< relref "/" >}})
- [Next: Troubleshooting]({{< relref "troubleshooting" >}})
