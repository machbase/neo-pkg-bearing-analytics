---
title: Vibration Data Analysis
weight: 10
---

# Vibration Data Analysis

[한국어](./index.kr.md) | **English**

neo-pkg-vibe-analytics turns vibration sensor data stored in Machbase Neo TAG tables into machine-health insight — without writing any SQL or TQL.

Open the app in your browser and every piece of equipment is graded against ISO 10816 severity zones in real time. From there you get per-tag waveform and spectrum analysis, rule-based fault diagnosis with recommended actions, and one-click analysis reports — all in one place.

Every analysis is **deterministic**. Grading, diagnosis, and reporting need no LLM. An LLM connects only as an **optional** layer that adds a narrative expert opinion to reports and events.

## Installation

In the Machbase Neo left side panel, select `neo-pkg-vibe-analytics` from the package list and press `Install`. Wait for the installation to finish.

### Uninstall

Select `neo-pkg-vibe-analytics` in the left panel and press **Uninstall** to remove the package. Accumulated data — events, baselines, reports — is preserved. The server-side monitoring timer is registered outside the package, so it is cleaned up during uninstall.

## How it works

On launch the app connects to Neo, auto-detects TAG tables, and runs on live data. If no TAG table is available, the app stays empty with an explanatory message — it does **not** substitute mock data, so every value on screen is a value that actually exists in the DB.

All analysis is computed deterministically inside the package. Signal processing — RMS, FFT, envelope, kurtosis, bearing fault frequencies — and ISO 10816 grading run in the browser and in package code with no external calls.

## Screen layout

There are three main tabs plus a Settings (⚙) entry point. The header also holds the alarm toggle and a theme switch.

| Tab | Purpose |
| :--- | :--- |
| Monitoring | Equipment card grid, severity grades, KPI summary, event list, alarm toggle |
| Detail Analysis | Snapshot of the selected tag — waveform, trends, FFT, envelope, cepstrum, spectrogram, fault-band search, rule-based diagnosis |
| Report | Generate, preview, and archive vibration analysis reports |
| Settings | Data Source · Equipment · Criteria · Alarms · LLM |

## How detection works

Every tag is evaluated from three angles at once, and **the worst result becomes that machine's grade**.

| Criterion | Question | Needs training |
| :--- | :--- | :---: |
| ISO zone | Is it absolutely high by international standard? | No |
| Baseline | Is it high compared to this machine's own normal? | Yes |
| Band energy | Has one specific frequency band jumped? | Yes |

With ISO zones alone, a sensor dominated by high-frequency content keeps reading Good even as a bearing degrades. That is why all three run together. See [How detection works](./detection.en.md) for the full picture.

## Monitoring modes

Alarm evaluation runs in one of two modes, selected in **Settings → Alarms**.

| Mode | Evaluated by | When the app is closed |
| :--- | :--- | :--- |
| App monitoring (default) | The app open in your browser | Evaluation stops |
| Server monitoring | A Neo timer | Keeps evaluating and recording events |

Both modes use identical evaluation rules, so switching modes produces the same results from the same data. See [Alarms & events](./alarms.en.md) for details.

## LLM providers (optional)

Used only to add a narrative opinion to reports and events. Four providers are supported.

| Provider | API | Local |
| :--- | :--- | :---: |
| Claude | Anthropic API | No |
| OpenAI | OpenAI API | No |
| Gemini | Google Gemini API | No |
| Ollama | Ollama REST API | Yes |

Grading, diagnosis, and reporting all work even without a provider connected.

## What gets stored

The package creates and writes the following in Neo, automatically, as you save settings and run alarm evaluation.

| Name | Kind | Contents |
| :--- | :--- | :--- |
| `NEO_VIBE_EVENTS` | LOG table | Event history (never auto-deleted) |
| `NEO_VIBE_MONSTATE` | LOOKUP table | Per-tag evaluation state (continuity, re-notify) |
| `NEO_VIBE_BASELINE` | LOOKUP table | Learned normal state (μ, σ) |
| `NEO_VIBE_BAND` | TAG table | Band energy trend (when band monitoring is on) |
| `/vibration-reports` | Files | Generated report HTML |

Settings are stored not in the DB but as JSON files inside the package (`cgi-bin/config/`) — one file each for data source, equipment, criteria, alarms, and LLM. Uninstalling the package removes those setting files, but the events, baselines, and reports above remain.

## Basic workflow

1. Install the package in Neo and open the app.
2. In **Settings → Data Source**, select the TAG table(s) and tags to analyze.
3. In **Settings → Equipment**, register unit, RPM, bearing model, and ISO class. (recommended)
4. In **Settings → Criteria**, review the machine class and thresholds, and optionally learn the normal baseline.
5. In **Settings → Alarms**, choose a monitoring mode and evaluation interval/window, then turn alarms on.
6. Check equipment condition on the **Monitoring** tab.
7. Click any card that looks abnormal to open **Detail Analysis**.
8. In **Report**, pick target tags and a period, then generate an analysis report.

## Documents

| Document | Contents |
| :--- | :--- |
| [First setup](./first-setup.en.md) | Data source · equipment · criteria · LLM |
| [Usage](./usage.en.md) | Monitoring · detail analysis · reports |
| [Alarms & events](./alarms.en.md) | Monitoring modes · alarm settings · notification channels |
| [How detection works](./detection.en.md) | What is measured and how grades are decided |
| [Troubleshooting](./troubleshooting.en.md) | Symptoms, causes, and fixes |

## Navigation

- [Next: First setup](./first-setup.en.md)
