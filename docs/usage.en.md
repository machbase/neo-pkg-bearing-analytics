---
title: Usage
weight: 30
---

# Usage

[한국어](./usage.kr.md) | **English**

Once setup is done, you work across three main tabs — Monitoring · Detail Analysis · Report.

## Monitoring

The at-a-glance view of every piece of equipment.

### Summary bar

The top summary bar shows the total equipment count, counts per severity (Good · Warning · Danger · Critical), and the most recent event. Click a severity cell to filter the card grid to that grade; click again to clear. Clicking the total cell resets the filter.

### Equipment cards

Each selected tag gets one card, showing its alias and tag name, a severity badge, the latest RMS value with unit, a sparkline, the last-seen time, and its class. Click a card to open **Detail Analysis** for that tag.

- The default sort is **worst grade first**. Drag cards to arrange them however you like; that order is saved and restored next time.
- The **card size** slider adjusts grid density.
- A card's grade uses exactly the RMS window defined in **Settings → Alarms** — the grade on screen and the grade the alarm judged are always the same. The active basis is shown to the right of the grid.

### Monitoring status alerts

If monitoring is not running properly, a warning appears at the very top of the screen — the timer stopped, it is running but has nothing to evaluate, or app-side evaluation stalled. Most of these offer a **Re-register** button that fixes them on the spot.

This exists so that "no events" can be told apart: equipment is fine, versus monitoring is dead. See [Alarms & events](./alarms.en.md) for details.

### Event list

The event list below shows recorded events with time · tag · type · measured value vs. limit · grade. Click any row to open detail analysis at the moment that event occurred.

- Period chips and the **tag** and **type** dropdowns narrow the list.
- Only the most recent **200** events are rendered. Use export to see beyond that.
- Beyond threshold exceedances, types include sustained, improved, recovered, instrumentation fault, and signal lost. What each means is laid out in [How detection works](./detection.en.md).

> **Baseline and band produce no events.** A breach never appears in this list — it is displayed on the card and in the evidence table. Events come only from the 10-minute fault-pattern axis.

### Exporting events

Press **Save** in the event list to open a dialog for choosing a period and file format (CSV · JSON), then download the events for that period.

> How alarm evaluation decides when to create events is covered in [Alarms & events](./alarms.en.md).

## Detail Analysis

A deep look at a single tag, entered from a monitoring card or an event row.

Detail analysis is a **snapshot** — it is frozen at the data as of when you entered, and does not keep updating live. To re-capture the latest state, press **Refresh**, or change the tag or period.

### Tag and period selection

- Use the dropdown at the top to switch the tag being analyzed.
- Choose the query period from presets — 1 hour · 6 hours · 24 hours · All · Custom. The default is 1 hour.
- If the tag has less data than a preset's length, that preset is disabled. Clicking it shows "not enough data"; use **All** instead.
- **Custom** lets you set start and end down to the minute. Switching from a preset to custom pre-fills the range that preset covered.

Chart time axes span the whole selected period. Gaps with no data are left empty, so you can see exactly where data actually exists.

### Measurement validity warning

If a measurement anomaly such as clipping (saturation) is detected in the signal, a **Signal anomaly — check the sensor** warning appears at the top and diagnosis enters a **diagnosis withheld** state.

A saturated signal reads lower in amplitude than reality, and a single impulse in the time domain smears across the whole spectrum as broadband content. So while this warning is up, confidence drops for **all** evidence, not just one candidate. Check the sensor, cable, and mounting before suspecting the machine.

### Severity assessment

The top card shows the overall risk grade and a zone-boundary bar, with four headline indicators below it, each with its value, threshold, and change.

### Switching the display unit

The same vibration signal reveals different faults depending on whether you view it as **acceleration (g) · velocity (mm/s) · displacement (μm)**. Switch with the unit buttons at the top; the unit the sensor actually measured is marked `(original)`.

| Unit | What it emphasizes |
| :--- | :--- |
| Acceleration `g` | High frequency — bearing and impulsive faults |
| Velocity `mm/s` | Mid band — the basis for ISO grading |
| Displacement `μm` | Low frequency — imbalance and misalignment |

If you suspect a bearing fault but the velocity waveform shows little, switch to acceleration. The conversion affects display only; grading stays on the original unit.

### Kurtosis saturation warning

When the kurtosis trend falls back from a peak while RMS holds steady or rises, a warning appears under the chart.

Falling kurtosis normally reads as "getting better", but this combination can mean the fault has progressed to where **impacts have become continuous**. An early bearing fault raises kurtosis with sharp impacts; as the fault spreads, the impacts run together and kurtosis drops again. Don't read kurtosis alone as recovery.

### Charts

| Chart | What it shows |
| :--- | :--- |
| Raw waveform | Time-domain vibration waveform |
| RMS · Peak-to-Peak · Crest Factor · Kurtosis trends | Headline indicators over time (the RMS trend also draws ISO zone reference lines) |
| Defect-band energy trend | Per-band energy over time. With band extraction on, envelope series (periodicity, fault frequencies) are drawn too. **View vs. alarm limit** rescales each series by its trained limit — 1.0 is the alarm line, so you see at a glance how close each series is (requires trained band baselines) |
| FFT spectrum | Frequency content. With a bearing registered, markers for 1×/2×/3× and BPFO/BPFI/BSF/FTF |
| ↳ Frequency range | Defaults to the lower range; switch to **full band** to expand out to the sensor's maximum measurable frequency |
| Spectrogram | Time-frequency evolution |
| Fault-band search | Which frequency band is most impulsive — the basis for choosing an envelope band. If a mounting method is specified, bands above its limit are excluded from the search |
| Envelope | Modulation created by impulsive faults |
| Cepstrum | Periodic structure in harmonics and sidebands |

### Diagnosis and recommended actions

Expand **Comprehensive analysis** to see the rule-based diagnosis. It calls out faults such as imbalance, misalignment, bearing inner/outer race, looseness, and gear issues, and presents **supporting evidence** (with the indicator each piece came from) alongside **prioritized recommended actions**.

> This verdict is computed from a single-channel, single-direction measurement with no phase information, using nameplate rotational speed. Fault mechanisms are **hypotheses**; a confirmed diagnosis requires multi-axis and phase measurement plus review by a maintenance engineer.

### LLM opinion (optional)

With an LLM connected, **Generate LLM opinion** produces a narrative expert opinion grounded only in the measured values shown in the charts. Pick the provider from the dropdown next to the button; the model used is noted beneath the opinion.

The tone and judgment rules — suspect the measurement chain first, try to refute your own hypothesis, distinguish "cannot be measured" from "insufficient evidence", spend grades sparingly — are defined in the package's `persona/` documents. They are reference documents you paste into a prompt, so you can adapt them to your site's practice.

Without an LLM connected, the rule-based diagnosis stands on its own.

## Report

Where you turn analysis into a document.

1. Select the **target tags** for the report. (nothing is selected by default; select-all is available)
2. Choose a **period** — the same presets as detail analysis (1 hour · 6 hours · 24 hours · All · Custom). The same range applies to every selected tag.
3. Optionally turn on **Include LLM opinion** and pick a provider.
4. Press **Generate report**.

Generation runs in four steps — query data → compute indicators → generate opinion → save — with progress shown. If it takes too long, **Cancel generation** stops it. Finished reports are saved to `/vibration-reports`.

### Report structure

| Section | Contents |
| :--- | :--- |
| Severity assessment | Grade verdict and position against zones |
| Overall vibration level | Headline indicator levels |
| Statistics · indicator summary | Statistics and indicator values for the period |
| Evidence strength | Evidence score per fault candidate (0–100), highest first = priority |
| In-depth analysis | LLM opinion (when connected) |
| Conclusions and recommendations | Verdict and actions |

A switch at the top of the report toggles between **Summary** and **Full**. Summary is built for a 30-second read; Full expands every chart and all evidence. Printing includes the full content.

Saved reports are **self-contained HTML** with no external references, and their charts are live rather than baked images — wheel zoom, drag, and tooltips work, and they redraw to match the theme. Handing over the single file is enough for someone else to explore it the same way.

Each report carries a **ruleset fingerprint**. If the fingerprint matches but the numbers differ, the data changed; if the fingerprint differs, the evaluation criteria changed.

### Archive

The archive on the right lists saved reports by creation time · target tags · period · type (whether an LLM opinion is included). Preview or delete each one, and page through when there are many.

## Tips

- Start with one or two tags to confirm behavior, then widen the scope.
- For better diagnostic accuracy, register unit, RPM, and bearing model under **Equipment**. Without a unit, there is no defined threshold row to inherit.
- To catch "different from usual" changes, run **baseline learning** while the equipment is healthy.
- If monitoring must continue with the app closed, switch to **server monitoring**.
- Export events periodically with **Save** for separate archiving.
- When you see an extreme indicator, check the measurement validity warning first — a large share of misdiagnoses come from the sensor, not the machine.

## Navigation

- [Previous: First setup](./first-setup.en.md)
- [Back to contents](./index.en.md)
- [Next: Alarms & events](./alarms.en.md)
