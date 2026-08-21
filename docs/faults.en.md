---
title: Fault types and signatures
---

# Fault types and signatures

This document sets out **which faults the app distinguishes, on what evidence**, and **what each distinction requires**.

One principle runs through all of it:

> **The equipment configuration decides what the analysis can do.** Without a bearing part number there is nothing to compare fault frequencies against; without a mounting type there is no way to know how far up the spectrum is trustworthy. In those cases the app marks the candidate **"not measurable"** rather than scoring it zero — being unable to see something is not the same as it being unlikely.

## Learning is not a prerequisite for analysis

There are four evaluation axes, and they split into two kinds.

| | Axis | Learning | Where it is needed |
| :--- | :--- | :--- | :--- |
| **Core** | ISO zone · fault pattern | **Not required** | Detail analysis and reports are complete on these two alone |
| **Supplementary** | Baseline · band | Required | "Compared to normal" is a continuous-monitoring concept |

A one-off analysis has no "normal" to compare against. Detail analysis and reports therefore work on equipment that has never been trained; trained axes simply **add sensitivity**.

## Two separate questions

| | Asks | Series | Action |
| :--- | :--- | :--- | :--- |
| **Vibration axis** | Has vibration at this point risen | sub · 1× · fault band · high · vh1–vh4 | Balancing · alignment · fastening (hours) |
| **Bearing axis** | Has this bearing degraded | envelope BPFO · BPFI · BSF | Parts procurement · teardown (weeks) |

**They must not be collapsed into one.** In measurements a *healthy* bearing read `2–4 kHz ×3.97`, higher than a *faulty* one (`×2.35`) — the neighbouring bearing's damage travelled through the shaft into that sensor. "Vibration is high" was true; "this bearing is damaged" was not. Looking at envelope fault frequencies alone separates them cleanly: healthy max `×1.26` vs faulty min `×1.42`.

---

## Rotor group — vibration axis

### Imbalance
Eccentric mass on the rotating assembly.

- **Signature** — 1× synchronous component dominates, few harmonics
- **To confirm** — **phase and axial measurement are required** to separate it from misalignment. A single channel cannot decide this in principle, so the app marks it not measurable
- **Action** — field dynamic balancing

### Misalignment
Coupled shafts whose centres do not line up.

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
Automatic selection (a kurtogram) is not used. It was tried twice and lost twice.

**① It latches onto anti-aliasing noise.** Just below Nyquist the filter has killed the signal, so only numerical noise remains and its kurtosis explodes, dragging the kurtogram there every time. Without a cap, fault-type identification measured **0/18**; capping at 80% of Nyquist gave **7/18**.

**② Even with a cap it latches onto an electrical component.** Detailed below.

**Rewriting it as a proper spectral kurtosis on the analytic signal changed nothing** — real 6%, complex magnitude 6%, complex SK 7%, all three settling on 12–16 kHz. The problem is the **objective function itself**, not the implementation: kurtosis structurally penalises tonal bands (a pure sinusoid has kurtosis 1.5, below Gaussian 3), so the clearer the fault, the more it avoids that band.

### The kurtogram can also be captured by an electrical component

The Nyquist cap alone is not enough. On an inverter-driven test rig (Paderborn) the kurtogram chose
**12–19 kHz for healthy and faulty bearings alike**, and that band's envelope was dominated by a single component.

Re-measuring the same bearings at a different shaft speed settles what it is:

| Shaft speed | Dominant order | Absolute frequency |
| :--- | :--- | :--- |
| 1500 rpm | 2.10× | **52.5 Hz** |
| 900 rpm | 3.50× | **52.8 Hz** |

**The order changes while the absolute frequency stays put.** Bearing fault frequencies scale with shaft speed,
so this is electrical or structural in origin, not mechanical. Detection fell to **1/104** (and **0/84** at 900 rpm).

The demodulation band is therefore **fixed at 1–5 kHz**. Across all 383 cases detection rises
**10% → 25%**, false positives go 2% → 3%, and type accuracy actually improves 90% → 95%.
The kurtogram is still computed and displayed — which band is most impulsive is diagnostic information in itself.
It is **no longer used for judgment**, however.

> **Whether this band fits large machines is unknown.** The verification pool contains no large machines.
> What actually tends to sit in 1–5 kHz is the **accelerometer mounting resonance** (a few kHz depending
> on attachment), while the bending modes of the bearing ring itself go **down** as the machine grows.
> So "large machines are missed because their resonance is higher" is not physically sound —
> **which direction it fails has never been measured.**

When the sampling rate is too low for 1–5 kHz to be valid (Nyquist cannot reach 5 kHz), demodulation falls back to the **full-band analytic signal**. Older versions fell back to the kurtogram, which was removed for the reasons above. Falling back to rectification is avoided for the same reason — measuring one tag by a different method splits the judgment path in two.

> **A near miss** — this fixed component (52.5 Hz, 2.10×) sits **3% away** from BSF (50.9 Hz, 2.04×).
> Had the BSF tolerance been ±2% instead of ±1%, **every healthy bearing would have read as a ball fault**.
> A 4-pole 1500 rpm inverter drive is a very common configuration.

### FTF is not evidence of a fault
**The cage turns in a healthy bearing too.** In measurements a healthy channel produced `0.45× with 3 harmonics` from day one. It is recorded as an observation only and contributes no score.

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
- **Requires** — **both pulley diameters plus belt length.** Without them there is nothing to compare
- Pulley ratio alone still resolves the driven shaft's 1×, which often closes the attribution of an otherwise unexplained non-synchronous component

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
- **Signature** — components tied to line frequency
- **To confirm** — check whether it disappears when power is cut

---

## What each setting unlocks

| Setting | Without it |
| :--- | :--- |
| **Shaft speed (RPM)** | No order analysis at all — every candidate closes |
| **Unit** | No ISO zone verdict (the standard is velocity, so acceleration and displacement need conversion) |
| **Machine class** | No ISO zone boundaries |
| **Bearing part number / geometry** | No BPFO/BPFI/BSF comparison; no oil-whirl exclusion |
| **Mounting** | No valid high-frequency ceiling — bands above it may be mounting resonance |
| **Pulley diameters / belt length** | No belt passing frequency |
| **Vane count / gear drive** | No vane-pass or mesh frequency |

---

## How far this currently gets

Measured over **383 cases** from four public datasets (CWRU, MFPT, Paderborn, XJTU-SY).

| | Result |
| :--- | :--- |
| **False positives on healthy** | **3/100 (3%)** |
| **Faults detected** | **188/283 (66%)** |
| Site correct among detected | 157/174 |


That last row matters. "83% among detected" improves as adoption gets more conservative, so it must
never be quoted on its own. What actually reaches the user is **one in two faults located correctly**.

### By site — only the outer race works well

| | Defect in the load zone | Signal | Result |
| :--- | :--- | :--- | :--- |
| **Outer race** | **stationary** | impacts of constant size → a peak stands | best |
| Inner race | passes in and out with the shaft | spreads into `BPFI ± k·1×` sidebands | middling |
| Rolling element | passes in and out with the cage | spreads into `BSF ± k·FTF` sidebands | **site not asserted** |

Rolling-element faults are detected but **the site is not asserted**. In measurements, ball-labelled
cases were never attributed to BSF, while seven inner/outer cases were wrongly sent there. Physically a
defective element damages the races too, so "site unknown" is the honest statement.

### On the time axis — outer race early, inner race late

Run-to-failure tests (XJTU-SY, one file per minute) answer **"how long before failure did it first alarm"**.

| Bearing | Site | First alarm |
| :--- | :--- | :--- |
| 3_5 · 2_2 · 1_1 | outer race | with **97% · 67% · 41%** of life remaining |
| 2_1 · 3_3 | inner race | with **8%** of life remaining |
| 1_4 | cage | **never** |

This table is a more honest picture of usefulness than the snapshot rate:
**the outer race buys planning time; the inner race is closer to a notice that it is about to stop.**

### How often does it cry wolf

With the alarm state machine applied (2 consecutive to enter, 5 to clear), healthy operation produced
**12.5 alarms per asset-month**. Both of those alarms are cases that may have been genuine early
degradation, and **four of six bearings were completely silent**. Since these are accelerated-life tests,
"the first half is healthy" is itself shaky — read the figure as a **conservative upper bound**.

### When the type is left undecided
If the top two ratios are close, the app **lists both candidates and says "insufficient separation"**. In measurements `BPFO ×1.42 / BSF ×1.39` — a 2 % gap — was being declared "outer race".

**Either way the bearing gets replaced, so the maintenance plan stands on detection alone.** The type matters for **root-cause analysis**: an inner race defect points to overload or misalignment, an outer race defect to the housing or current passage — which is what changes the prevention measure.
