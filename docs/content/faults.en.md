---
title: Fault types and signatures
weight: 53
---

#

This document sets out **which faults the app distinguishes, on what evidence**, and **what each distinction requires**.

One principle runs through all of it:

> **The equipment configuration decides what the analysis can do.** Without a bearing part number there is nothing to compare fault frequencies against; without a mounting type there is no way to know how far up the spectrum is trustworthy. In those cases the app marks the candidate **"not measurable"** rather than scoring it zero — being unable to see something is not the same as it being unlikely.

## Learning is not a prerequisite for analysis

There are four evaluation axes, and they split into two roles.

| | Axis | Learning | What it does |
| :--- | :--- | :--- | :--- |
| **Grade-forming axes** | Fault pattern · ISO zone | **Not required** | Grades and alerts. Detail analysis and reports are complete on these two alone |
| **Evidence axes** | Baseline · band | Required | "Versus normal" evidence. No grades, no alerts |

A one-off analysis has no "normal" to compare against. Detail analysis and reports therefore work on equipment that has never been trained; trained axes simply **add a layer of evidence** — the grade does not change.

## Two separate questions

| | Asks | Series | Action |
| :--- | :--- | :--- | :--- |
| **Vibration axis** | Has vibration at this point risen | sub-synchronous · 1× band · fault band · high · 1–2 · 2–4 · 4–8 · 8 kHz+ | Balancing · alignment · fastening (hours) |
| **Bearing axis** | Has this bearing degraded | envelope periodicity · BPFO · BPFI · BSF | Parts procurement · teardown (weeks) |

**They must not be collapsed into one.** When a neighboring bearing's damage travels through the shaft, the sensor on a *healthy* bearing can read higher in the high-frequency bands than the one on the *faulty* bearing. "Vibration is high" is true; "this bearing is damaged" is not. Looking at the envelope fault frequencies separates the two.

---

## Rotor group — vibration axis

### Imbalance
Eccentric mass on the rotating assembly.

- **Signature** — 1× synchronous component dominates, few harmonics
- **To confirm** — **phase and axial measurement are required** to separate it from misalignment. A single channel cannot decide this in principle, so the app marks it not measurable
- **Action** — field dynamic balancing

### Misalignment
Coupled shafts whose centers do not line up.

- **Signature** — 2× component prominent, axial vibration present
- **To confirm** — same as imbalance (phase + axial)
- **Action** — laser alignment

### Mechanical looseness
Loose fastening, mounting, or housing.

- **Signature** — **several integer harmonics of 1×** (three or more), synchronous dominant
- **Action** — inspect fastening, mounting, bearing housing

---

## Bearing group — bearing axis

Fault frequencies follow from shaft speed and bearing geometry. **A part number (or geometry) must be entered** for any comparison to happen.

| Signal | Damaged element | Formula (× shaft speed) |
| :--- | :--- | :--- |
| **BPFO** | Outer race | (n/2)(1 − (d/D)cos α) |
| **BPFI** | Inner race | (n/2)(1 + (d/D)cos α) |
| **BSF** | Rolling element | (D/2d)(1 − ((d/D)cos α)²) |
| FTF | Cage | (1/2)(1 − (d/D)cos α) |

### Why envelope analysis is needed
Each impact against a defect rings the housing's **multi-kHz resonance**. The raw spectrum only shows "there is high-frequency content"; **the repetition rate hides inside the amplitude modulation**. Envelope demodulation pulls that rate out as a line.

### The demodulation band is fixed at 1–5 kHz
Picking the most impulsive band automatically (a kurtogram) is not used for judgment. That method latches easily onto signals that are not faults — filter noise at the top of the range, electrical components from inverters — and tends to avoid the band precisely when a fault is clear, so detection dropped sharply in verification on public data.

For the fault pattern that sets the grade and the envelope in detail analysis, the demodulation band is therefore **fixed at 1–5 kHz**. (The envelope trend accumulated by band extraction uses the highest octave below the mounting limit and the sampling limit.) The kurtogram is still computed and shown in detail analysis as **per-band impulsiveness** — which band is most impulsive is diagnostic information in itself. It is **not used for judgment**, however.

When the sampling rate is too low for 1–5 kHz to be valid (5 kHz does not fall within 95% of the highest measurable frequency — a sample rate below about 10.5 kHz), demodulation falls back to the **full band**. The evidence is weak then, and early bearing faults are not detected.

> **Whether this band fits large machines is unknown.** The verification data contains no large machines.
> What actually tends to sit in 1–5 kHz is the **accelerometer mounting resonance** (a few kHz depending
> on attachment), while the bending modes of the bearing ring itself go **down** as the machine grows.
> So "large machines are missed because their resonance is higher" is not physically sound —
> **which direction it fails has never been measured.**

### FTF is not evidence of a fault
**The cage turns in a healthy bearing too.** A healthy channel shows cage-rotation components from the start, so they are recorded as an observation only and contribute no score.

### Oil whirl
The shaft riding on the oil film in a journal bearing.

- **Signature** — non-synchronous component dominant at 0.38–0.48×
- **Important** — **dropped as a candidate once the bearing is specified as a rolling-element type.** The phenomenon requires an oil film, so it cannot occur. If the type is unspecified it stays, because we do not know

### Cage fault (FTF estimate)
- **Signature** — 0.35–0.45× dominant. Possible without a part number, since d/D for rolling bearings is mostly 0.15–0.25, which confines FTF to that range
- **Note** — separate from "FTF is not evidence" above. This one reads the **raw spectrum's dominant order**; that one compares envelope fault frequencies

---

## Drive and load group

### Belt / pulley
- **Signature** — belt passing frequency and its harmonics
- **Requires** — drive type **belt**, both pulley **pitch diameters** (D1 drive · D2 driven) plus belt length. Without the length there is no belt passing frequency to compare
- The pulley ratio alone still resolves the other shaft's 1×, which often closes the attribution of an otherwise unexplained non-synchronous component
- **If the sensor sits across the belt (fan, pump, …)**, set the sensor position to **driven side**. The fault pattern, fault frequencies, and bands are then computed from the **driven-shaft speed** — a measured driven speed if you enter one, otherwise RPM × D1 ÷ D2. If the driven speed cannot be known, that tag does not measure the fault pattern at all — matching against the motor speed would make unrelated frequencies line up by chance

> A driven-shaft speed off by only 1–2% still detects the fault but often names the wrong site. Use pitch diameters rather than outer diameters, or enter a measured speed.

### Vane / blade pass
- **Signature** — vane count × 1×
- **Requires** — impeller vane count

### Gear mesh
- **Signature** — tooth count × 1× (mesh frequency) with **1×-spaced sidebands**
- **A rare case where a negative finding matters** — mesh present but no sidebands is what a *healthy* gear looks like

### Independent rotating source (driven shaft / adjacent machine)
- **Signature** — a **non-synchronous** fundamental with three or more of its own harmonics
- Usually a belt-driven shaft, an adjacent machine, or a gear-driven shaft. A drive layout diagram normally closes the attribution

### Electrical
- **Signature** — components tied to line frequency (120 Hz on a 60 Hz grid) that do not move when speed changes
- **To confirm** — check whether it disappears when power is cut (a stop test)

---

## What each setting unlocks

| Setting | Without it |
| :--- | :--- |
| **Shaft speed (RPM)** | No order analysis at all — every candidate closes, and the fault pattern (grade) and band extraction stop |
| **Bearing part number / geometry** | No fault pattern (grade), no BPFO/BPFI/BSF comparison, no oil-whirl exclusion |
| **Unit** | Treated as velocity (mm/s) — acceleration and displacement sensors get a wrong ISO conversion, so the grade height is off |
| **Class** | Judged with Class II zone boundaries |
| **Mounting** | No trustworthy high-frequency ceiling — bands above it that may be mounting resonance cannot be flagged |
| **Pulley pitch diameters / belt length** | No belt passing frequency, no driven-shaft 1× |
| **Sensor position (belt) / driven-shaft speed** | A driven-side sensor's fault frequencies are computed from the motor speed and miss |
| **Vane count / gear drive** | No vane-pass or mesh frequency |

---

## How far this currently gets

A summary of verification on 383 cases from four public datasets (CWRU, MFPT, Paderborn, XJTU-SY):

| | Result |
| :--- | :--- |
| False positives on healthy | 3 of 100 (3%) |
| Faults detected | 183 of 283 (65%) |
| Faults located correctly, out of all faults | 153 of 283 (about 54%) |

Counting only detected faults makes site accuracy look much higher, but that figure improves as judgment gets more conservative, so it must not be read on its own. What actually reaches the user is **a correct site for a little over one fault in two**. The full tables are in [What this tool does and does not do]({{< relref "scope" >}}).

### By site — only the outer race works well

| | Defect in the load zone | Signal | Result |
| :--- | :--- | :--- | :--- |
| **Outer race** | **stationary** | impacts of constant size → a peak stands | best |
| Inner race | passes in and out with the shaft | spreads into `BPFI ± k·1×` sidebands | middling |
| Rolling element | passes in and out with the cage | spreads into `BSF ± k·FTF` sidebands | **site not asserted** |

Rolling-element faults are detected but **the site is not asserted**. In verification, verdicts naming the rolling element were almost never right, and inner/outer-race faults were sometimes wrongly sent there. Physically a defective element damages the races too, so "site unknown" is the honest statement.

### On the time axis — outer race early, inner race late

Measuring "how long before failure did it first alarm" on run-to-failure data shows that **the outer race buys planning time; the inner race is closer to a notice that it is about to stop.** The figures are in [What this tool does and does not do › Time-axis performance]({{< relref "scope#time-axis-performance--run-to-failure-tests" >}}).

### When the type is left undecided
If the envelope fault-frequency series accumulated by band extraction (BPFO · BPFI · BSF) rise together and the top two are close, the app **lists both candidates and says "insufficient separation"**. The fault pattern that sets the grade picks the single strongest candidate.

**Either way the bearing gets replaced, so the maintenance plan stands on detection alone.** The type matters for **root-cause analysis**: an inner race defect points to overload or misalignment, an outer race defect to the housing or current passage — which is what changes the prevention measure.

## Navigation

- [Previous: How detection works]({{< relref "detection" >}})
- [Back to contents]({{< relref "/" >}})
- [Next: What this tool does and does not do]({{< relref "scope" >}})
