---
title: Glossary
weight: 15
---

# Glossary

[한국어](./glossary.kr.md) | **English**

Every term these documents use, explained in order. If vibration analysis is new to you, this page is enough to follow the rest.

---

## Basics

### Vibration sensors and RMS

A sensor mounted on a machine measures shaking thousands to tens of thousands of times per second. **RMS** (root mean square) collapses all those numbers into one. A plain average would cancel out to near zero, since the shaking goes up as much as it goes down, so the values are squared, averaged, and square-rooted instead. Read it as **"how much is this machine shaking right now", in a single number**.

### Shaft speed and 1×

How many turns the shaft makes per second is its **rotational frequency**. At 1800 RPM that is 1800 turns per minute, so 30 turns per second: 30 Hz.

Vibration analysis uses that as the yardstick: **1×** means "at shaft speed", **2×** means twice that, and so on. Machines run at different speeds, so multiples of shaft speed compare across machines in a way that absolute frequencies (Hz) do not.

> This is why the app **asks for the shaft speed**. Without it there is no 1×, and without 1× most of the criteria have nothing to stand on.

### Spectrum

A chart that re-plots shaking as **strength per frequency**, showing where in the frequency range the energy sits.

Two machines can shake equally hard, one at 30 Hz and one at 150 Hz, and have entirely different problems. The spectrum is how you tell them apart.

### Harmonics

Whole-number multiples of 1× — 2×, 3×, 4× … — standing in a row. Faults that strike several times per revolution, such as mechanical looseness, produce this pattern.

---

## Bearings

### Defect frequencies (BPFO · BPFI · BSF · FTF)

A damaged bearing produces an impact **every time something passes over the damage**. How many impacts per second that is can be computed from the bearing's geometry (ball count, diameter, pitch) and the shaft speed. The value differs by which part is damaged — so reading off **which frequency the impacts land on tells you which part is damaged.**

| Abbreviation | Stands for | Damaged part |
| :--- | :--- | :--- |
| **BPFO** | Ball Pass Frequency, Outer race | Outer race |
| **BPFI** | Ball Pass Frequency, Inner race | Inner race |
| **BSF** | Ball Spin Frequency | The rolling element itself |
| **FTF** | Fundamental Train Frequency | The cage holding the balls |

> This is why the app asks for the **bearing part number**. With it, those four values can be computed and checked against the measurement; without it there is no grid to check against.

### Envelope demodulation

Bearing impacts are **small and fast**, and they hide under the much larger shaking of the rotating shaft. In a plain spectrum they are easy to miss.

Envelope demodulation extracts **only the outline** of the signal. The fast oscillation itself is discarded and only "how often it strikes" survives — which brings the buried impact rate into view, where it can be matched against the defect frequencies above.

By analogy: to hear a distant, regular hammering, you **count the beat rather than listen to the pitch**.

This app keeps **only the 1–5 kHz band** before extracting the envelope — the band where impacts ring the housing's high-frequency resonance.

### Kurtogram (per-band impulsiveness)

A tool that sweeps frequency ranges and shows **where impulsiveness is most pronounced**. The **per-band impulsiveness** chart in detail analysis is this.

In this app it is shown **for reference only**. The automatically picked range is often captured by signals that are not faults (filter noise, electrical components), so the envelope used for judgment comes from the fixed 1–5 kHz band, not from the kurtogram's pick.

### Sidebands

Small peaks standing at **regular intervals on either side** of a defect frequency. They appear when the damaged spot moves in and out of load as the shaft turns.

Sidebands are evidence that the impacts are **genuinely tied to rotation** rather than random noise.

### Pitch diameter · driven shaft

- **Pitch diameter** — for a bearing, the diameter of the circle through the ball centres; for a belt pulley, the diameter where the belt rides. A pulley's pitch diameter is slightly smaller than its outer diameter and is stamped on the pulley or listed in its catalog.
- **Driven shaft (driven side)** — on a belt-driven machine, the shaft on the far side from the motor (fan, pump, …). If the sensor sits on a bearing there, set the sensor position to **driven side** so the fault frequencies are computed from that shaft's speed.

---

## Signal character

### Kurtosis

A measure of **how spiky** the shaking is. Steady rumbling scores low; an otherwise quiet signal with occasional hard strikes scores high. Early bearing damage looks exactly like the latter, so kurtosis tends to rise first.

### Crest factor

The largest instantaneous value divided by RMS. Like kurtosis, it measures **impulsiveness**.

> Both also spike on **measurement accidents** — a knocked sensor, a loose cable. When either runs to an extreme, the app suspects an instrumentation problem before a bearing fault.

### Instrumentation fault

A state where **the measurement itself is hard to trust** — clipping (saturation), a flatline (the value barely changes), DC drift (the mean wanders), an isolated spike. Detail analysis then shows a "signal anomaly — check the sensor" warning and **withholds diagnosis**, and monitoring stops grading that machine (card: On hold · instrumentation fault).

A sensor with a large but steady mean (a MEMS accelerometer's gravity axis, for example) is not an instrumentation fault — it only gets a grey "DC component" note.

---

## Terms used in grading

### Fault pattern · grid score · adoption line

The **fault pattern** checks whether energy stands at the bearing defect frequencies (and their harmonics) in the envelope spectrum. Those positions together are the **grid**, and how many times stronger the energy there is than the surrounding noise is the **grid score**. When the grid score crosses the **adoption line** (3.0 in monitoring, 4.0 in detail analysis), the fault pattern "fires" — and **that is what switches the grade on.**

### ISO 10816 zones

An international standard's **absolute scale for vibration magnitude**, dividing RMS into four bands by machine class.

| Zone | Shown as | Meaning |
| :--- | :--- | :--- |
| A | Good (양호) | As-new condition |
| B | Warning (주의) | Acceptable for long-term operation |
| C | Danger (위험) | Short-term operation only; plan an intervention |
| D | Critical (심각) | Damage may be progressing |

It reports **only how hard the machine shakes**, never why. That is why this package shows the ISO zone separately, raises a grade only when the fault pattern fires, and uses the ISO zone to set how high.

### Cycle · observation

A **cycle** is one measurement of the fault pattern (the extraction interval, 10 minutes by default). A grade is confirmed — and the alarm sent — only when the same judgment holds for **two consecutive cycles**. The first cycle out of Good is only recorded as an **observation** event, with no alert.

### On hold · cannot judge

**On hold** (판정 보류) means the machine is not being graded right now. It appears in the grade position on the card, with reasons such as stopped · signal lost · instrumentation fault · fault-pattern measurement failed · **cannot judge**.

**Cannot judge** (판정 못 함) means there is no RPM or bearing geometry, so the fault pattern cannot be computed at all. It means "unknown", not "normal". Sleeve (journal) bearings fall here too.

### Baseline (compared to its own normal)

Learning what a given machine **usually** reads, then watching how far it drifts from that. The absolute scale (ISO) says "that is large in general"; a baseline says **"that is odd for this machine"**.

It shows slow-developing changes before they cross an absolute threshold. In this app it makes no grade or alert — it is **evidence only**. The cost is time — **you cannot know "usual" without history**, so this axis is unavailable for a one-off analysis.

### Band energy

Splitting the spectrum into a few ranges and **tracking each one separately**. A single overall RMS cannot tell you which part of the range grew; bands make changes like "only the high frequencies rose" visible. Like the baseline, this app uses it as **evidence only**.

### Not measurable

A state where the app **leaves a score blank rather than scoring it zero** — for example when no bearing part number means no defect frequencies to check, or no shaft speed means no 1× reference.

> **"Cannot see it" is not the same as "unlikely".** Filling in a zero would look reassuring while carrying no information, so the app leaves it empty and tells you what to supply.

### Judgment fingerprint

A short string printed on every report, computed from the thresholds and criteria used. If two reports share a fingerprint, the criteria were the same and the data changed; if not, the judgment settings changed in between.

---

## Navigation

- [Previous: Package overview](./index.en.md)
- [Next: First setup](./first-setup.en.md)
