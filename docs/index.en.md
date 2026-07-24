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

Select `neo-pkg-vibe-analytics` in the left panel and press **Uninstall** to remove the package. Data accumulated so far (events, reports) is preserved.

## How it works

On launch the app connects to Neo, auto-detects TAG tables, and runs on live data. If no TAG table is available, it falls back to a demo (mock data) state so the UI can still be explored.

All analysis is computed deterministically inside the package (CGI). Signal processing — RMS, FFT, envelope, kurtosis, bearing fault frequencies — and ISO 10816 grading run in the browser and CGI with no external calls.

## Screen layout

There are three main tabs plus a Settings (⚙) entry point.

| Tab | Purpose |
| :--- | :--- |
| Monitoring | Equipment card grid, severity grades, KPI summary, event list, alarm toggle |
| Detail Analysis | Snapshot of the selected tag — waveform, trends, FFT, envelope, cepstrum, spectrogram, rule-based diagnosis |
| Report | Generate, preview, and archive vibration analysis reports |
| Settings | Data Source · Equipment · Criteria · Alarms · LLM |

## LLM providers (optional)

Used only to add a narrative opinion to reports and events. Four providers are supported.

| Provider | API | Local |
| :--- | :--- | :---: |
| Claude | Anthropic API | No |
| OpenAI | OpenAI API | No |
| Gemini | Google Gemini API | No |
| Ollama | Ollama REST API | Yes |

Grading, diagnosis, and reporting all work even without a provider connected.

## Basic workflow

1. Install the package in Neo and open the app.
2. In **Settings → Data Source**, select the TAG table(s) and tags to analyze.
3. In **Settings → Equipment**, register RPM, bearing model, and ISO class. (optional)
4. In **Settings → Criteria**, review thresholds and optionally learn the normal baseline.
5. Check equipment condition on the **Monitoring** tab and turn alarms on if needed.
6. Click any card that looks abnormal to open **Detail Analysis**.
7. In **Report**, pick target tags and generate an analysis report.

## Documents

- [First setup](./first-setup.en.md)
- [Usage](./usage.en.md)
- [Troubleshooting](./troubleshooting.en.md)

## Navigation

- [Next: First setup](./first-setup.en.md)
