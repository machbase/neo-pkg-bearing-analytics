---
title: Bearing Vibration Analysis
weight: 10
---

# Bearing Vibration Analysis

[한국어](./index.kr.md) | **English**

neo-pkg-bearing-analytics turns vibration sensor data stored in Machbase Neo TAG tables into machine-health insight — without writing any SQL or TQL.

Its core is **bearing fault diagnosis** — envelope demodulation, kurtogram band selection, and defect-frequency matching (BPFO / BPFI / BSF / FTF), verified against public run-to-failure datasets.

**A severity grade rises only when there is evidence of a bearing defect.** High vibration on its own does not raise it — that is reported separately as **ISO 10816 severity**. When the spectrum shows common rotating-machinery patterns such as unbalance (1×), misalignment (2×) or mechanical looseness, the app **notes them as "suspected" but does not grade them**: without a phase (tacho) reference or an axial channel, those cannot be confirmed in principle. [What this tool does and does not do](./scope.en.md) draws the full boundary.

> If the terms above (BPFO, envelope, kurtogram) are unfamiliar, read the [Glossary](./glossary.en.md) first — it is a single page.

Open the app in your browser and every piece of equipment is graded against ISO 10816 severity zones in real time. From there you get per-tag waveform and spectrum analysis, rule-based fault diagnosis with recommended actions, and one-click analysis reports — all in one place.

Every analysis is **deterministic**. Grading, diagnosis, and reporting need no LLM. An LLM connects only as an **optional** layer that adds a narrative expert opinion to reports and events.

## Installation

In the Machbase Neo left side panel, select `neo-pkg-bearing-analytics` from the package list and press `Install`. Wait for the installation to finish.

### Uninstall

Select `neo-pkg-bearing-analytics` in the left panel and press **Uninstall** to remove the package. Accumulated data — events, baselines, reports — is preserved. The timers this package registers (monitoring, band extraction, watchdog) live outside the package, so they are cleaned up during uninstall. That cleanup only tries the default port (5654), so if you run Neo on another port, turn alarms off in the app before uninstalling — the app removes the timers first.

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

**The fault pattern switches the grade on; the ISO zone sets its height.**

| Criterion | Question | Role | Needs training |
| :--- | :--- | :--- | :---: |
| **Fault pattern** | Does evidence stand at the bearing fault frequencies? | **gate** — without it the grade stays good | No |
| **ISO zone** | Is it absolutely high by international standard? | **height** — how urgent | No |
| Baseline | Is it high compared to this machine's own normal? | evidence display | Yes |
| Band energy | Has one specific frequency band jumped? | evidence display | Yes |

High vibration alone does not raise the grade — that fact is stated separately on screen. Across the 383 verification cases, putting all four criteria into the grade gives **69%** false positives on healthy machines; this structure gives **3%**.

Neither grade-forming criterion needs training, so **judgment starts as soon as you finish setup**.

[How detection works](./detection.en.md) has the details; [what this tool does and does not do](./scope.en.md) has the measured limits.

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

Everything lives in a dedicated database, `NEO_BEARING_STORE`. An administrator creates it once and grants each account; after that the app creates its own tables.

| Name | Kind | Contents | Per-account separation |
| :--- | :--- | :--- | :--- |
| `SYS.EVENTS` | TAG table | Event history (never auto-deleted) | Row key `<account>:` |
| `SYS.BAND` | TAG table | Band energy trend (when band extraction is on) | Row key `<account>:` |
| `SYS.BASELINE` | LOOKUP table | Learned normal state (μ, σ) | Row key `<account>:` |
| `SYS.MONSTATE` | LOOKUP table | Per-tag evaluation state (continuity, re-notify) | Row key `<account>:` |
| `<account>.CONFIG` | LOOKUP table | All settings — data source, equipment, criteria, alarms, LLM keys | **One table per account** |
| `<account>/vibration-reports/` | Files | Generated report HTML | One folder per account |

The first four tables are shared: one copy, with the account encoded in each row's key. The UI shows names without the prefix. `CONFIG` is the exception — it holds LLM API keys and webhook URLs, and Machbase has no row-level permissions, so only a separate table keeps other accounts from reading it at all.

Settings used to live in JSON files inside the package; they are now in the database. Uninstalling the package leaves settings, events, baselines, and reports in place.

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
| [Glossary](./glossary.en.md) | **Start here if vibration analysis is new** — BPFO, envelope, kurtogram, kurtosis |
| [First setup](./first-setup.en.md) | Data source · equipment · criteria · LLM |
| [Usage](./usage.en.md) | Monitoring · detail analysis · reports |
| [Alarms & events](./alarms.en.md) | Monitoring modes · alarm settings · notification channels |
| [How detection works](./detection.en.md) | What is measured and how grades are decided |
| [What this tool does and does not do](./scope.en.md) | Measured performance · what it cannot do · what was tried and lost |
| [Fault types and signatures](./faults.en.md) | Which faults are distinguished, on what evidence, and what each setting unlocks |
| [Troubleshooting](./troubleshooting.en.md) | Symptoms, causes, and fixes |

## Navigation

- [Next: Glossary](./glossary.en.md)
