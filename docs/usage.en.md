---
title: Usage
weight: 30
---

# Usage

[한국어](./usage.kr.md) | **English**

Once setup is done, you work across three main tabs — Monitoring · Detail Analysis · Report.

## Monitoring

The at-a-glance view of all equipment.

### Summary bar

The top summary bar shows the total equipment count, the count per severity (Good · Warning · Danger · Critical), and the most recent event. Click a severity cell to filter the card grid to that grade; click again to clear the filter.

### Equipment cards

Each selected tag gets one card showing its alias, latest RMS value with a sparkline, and a severity grade badge. Click a card to open that tag's **Detail Analysis**.

### Event list

The event list below shows recently recorded events by time · tag · type · metric · grade. Click a row to open Detail Analysis at the moment that event occurred.

### Exporting events

The **Save** button on the event list opens a popup where you choose a period and file format (CSV · JSON). Events in that period are downloaded as a file.

## Alarms and events

Click the alarm indicator in the header to turn alarms on or off. This state is persisted and survives reopening the app.

While alarms are on, the app periodically judges the selected tags for as long as it is open.

- **Threshold judgment is always on** — a grade change (e.g. Good→Warning) is recorded as an event.
- **Baseline judgment applies once learned** — for tags whose normal state has been trained, a baseline deviation is recorded too.

Judgment results accumulate as events in a Neo LOG table (`NEO_VIBE_EVENTS`).

- **Good (normal) is not recorded** — only Warning and above remain.
- **Events are never auto-deleted** — history is data too, so it is preserved. Use event export to archive it when needed.

> Alarms run only while the app is open. This is lightweight monitoring for the time the screen is open, not a persistent background watcher.

## Detail Analysis

A deep look at a single tag, entered from a monitoring card or an event row.

Detail Analysis is a **snapshot** — it freezes on the data at the moment you enter and does not keep changing live. To see the latest state, re-enter or switch tags.

### Tag & period selection

- Use the dropdown at the top to switch the tag being analyzed.
- Choose the period with a preset — 1 hour · 6 hours · 24 hours · All · Custom. The default is 1 hour.
- If the tag's data is shorter than a preset's length, that preset is disabled. Clicking it shows a "not enough data" hint; use **All** in that case.
- **Custom** lets you set start and end down to the minute.

Chart time axes span the whole selected period. Gaps with no data are left blank, so you see exactly where data actually exists.

### Charts

| Chart | What it shows |
| :--- | :--- |
| Raw waveform | Time-domain vibration waveform |
| RMS · Peak-to-Peak · Crest Factor · Kurtosis trends | How the headline metrics change over time |
| Defect-band energy · band-kurtosis trends | Energy and impulsiveness in the bearing defect band |
| FFT spectrum | Frequency content; with a bearing registered, 1×/2×/3× and BPFO/BPFI/BSF/FTF markers |
| Envelope | Modulation produced by impulsive faults |
| Cepstrum · spectrogram | Periodic components and time–frequency changes |

### Diagnosis and recommended actions

Below the charts is a rule-based diagnosis. It judges faults such as imbalance · misalignment · bearing inner/outer race · looseness · gear, and presents the supporting evidence with prioritized recommended actions.

### LLM opinion (optional)

If an LLM is connected, you can generate a narrative expert opinion grounded in the measured values of every chart in Detail Analysis. Pick the provider from the on-screen dropdown. Without a provider, the rule-based diagnosis is enough on its own.

## Report

Where you capture analysis results as a document.

1. Select the target tags for the report. (nothing selected by default)
2. Press **Generate report** to build a vibration analysis report, saved under `vibration-reports/`.
3. Preview or delete saved reports from the archive.

With an LLM connected, the report also includes a sectioned narrative summary. Without one, the metric- and chart-based report is still generated normally.

## Tips

- Start with one or two tags to confirm behavior, then widen the selection.
- Register RPM and bearing model in **Equipment** to raise diagnostic accuracy.
- Learn the **normal baseline** while healthy to catch "different from usual" changes.
- Export events with **Save** periodically to keep an external archive.

## Navigation

- [Previous: First setup](./first-setup.en.md)
- [Back to contents](./index.en.md)
- [Next: Troubleshooting](./troubleshooting.en.md)
