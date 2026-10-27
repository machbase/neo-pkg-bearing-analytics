# neo-pkg-bearing-analytics v1.0.0

[English](README.md) | [한국어](README.kr.md) | [日本語](README.ja.md)

A bearing-focused vibration analysis package for rotating machinery, built on time-series data stored in Machbase Neo.

> **It does not replace a human diagnosis.** It covers the gap between scheduled inspections, ranks
> what to look at first, and puts the spectrum the inspector needs on screen before they arrive.
> See [what this tool does and does not do](https://machbase.github.io/neo-pkg-bearing-analytics/scope/) for measured performance and named limits.

## Overview

neo-pkg-bearing-analytics turns vibration sensor data in Machbase Neo TAG tables into actionable machine-health insight — without writing a single line of SQL or TQL.

Its core is **bearing fault diagnosis**: envelope demodulation in a fixed 1–5 kHz band and defect-frequency matching (BPFO / BPFI / BSF / FTF), verified against public run-to-failure datasets.

A severity grade rises only when there is evidence of a bearing defect. High vibration on its own does not raise it — that is reported separately as **ISO 10816 severity**. Common rotating-machinery patterns (imbalance, misalignment, looseness) are surfaced as *suspected* findings rather than graded, because confirming them needs a phase reference or an axial channel this package does not assume.

Open the app in your browser and every piece of equipment is graded in real time — the fault pattern decides whether there is a grade, the ISO 10816 zone decides how high. Drill into any tag for waveform and spectrum analysis, get rule-based fault diagnosis with prioritized recommended actions, and generate analysis reports in one click.

All analysis is **deterministic** — no LLM is required for grading, diagnosis, or reporting. An LLM can optionally be connected to add a narrative expert opinion to detail analysis and reports.

The app connects to your Neo instance on launch, auto-detects TAG tables, and runs on live data. When no TAG table is available it stays empty with an explanatory message rather than substituting mock data — every value on screen is a value that exists in the DB.

## Who is it for?

- **Maintenance / reliability engineers** — watch equipment condition at a glance, catch bearing faults early (with imbalance, misalignment, and looseness flagged as suspected), and get what to do now with concrete action details
- **Data engineers** — serve vibration analytics on top of Machbase Neo without building custom queries, charts, or threshold logic

## Key Features

- **Real-time Monitoring** — equipment card grid with live sparklines, pattern-gated grades (Good / Warning / Danger / Critical; the UI is in Korean: 양호 / 주의 / 위험 / 심각), an **On hold** count for machines that cannot be graded right now (stopped, signal lost, instrumentation fault, missing RPM or bearing), a KPI summary bar that doubles as a filter, a table filter, drag-to-reorder cards, and a filterable event feed. A header toggle turns alarm judgment on or off.
- **Detail Analysis** — a snapshot of the selected tag: raw waveform, RMS / Peak-to-Peak / Crest Factor / Kurtosis trends, defect-band energy trends, FFT spectrum with bearing fault-frequency markers (1× / 2× / 3×, BPFO / BPFI / BSF / FTF), envelope, cepstrum, spectrogram, and per-band impulsiveness (kurtogram) — with harmonic / sideband analysis. The envelope drives the bearing verdict; the kurtogram, cepstrum, and spectrogram are shown for context and deliberately kept out of the grade (see [what this tool does and does not do](https://machbase.github.io/neo-pkg-bearing-analytics/scope/)).
- **Pattern-gated Grading** — the fault pattern (evidence standing at a bearing fault frequency) switches the grade on, and the ISO zone (absolute, band-limited to 10–1000 Hz as the standard defines) sets its height. A learned baseline (relative to its own normal) and per-band energy (relative, per frequency band) are tracked and shown as supporting evidence but never raise the grade, so a tag grades the same whether or not it has been trained. Neither gating axis needs training, so grading is complete as soon as RPM and the bearing are entered. Detail analysis and monitoring use the same rule ([how detection works](https://machbase.github.io/neo-pkg-bearing-analytics/detection/)).
- **Rule-based Diagnosis** — automatic fault verdict (imbalance, misalignment, bearing inner/outer race, looseness, gear) with sourced supporting evidence, evidence scores, and what to do now plus action details (each with its reason). Faults the current measurement cannot resolve are marked "not observable" with the reason, rather than scored low.
- **Measurement-validity Gate** — clipping, flatline, DC drift, and isolated-spike patterns put the whole diagnosis into a "withheld" state and lower every candidate's evidence score together, because a shaky measurement affects the entire spectrum. A steady DC offset (a MEMS gravity axis, a proximity probe's gap voltage) is noted but does not block judgment.
- **App or Server Monitoring** — evaluate in the open app, or register the evaluation settings as a Neo timer so events keep accruing with the app closed. Both modes run the *same* judgment rules, and the app reports when monitoring has stopped, stalled, or has nothing left to evaluate — so "no events" never quietly means "monitoring is dead". Several tabs or PCs on one account share the work: only one evaluates and notifies.
- **Alarms & Events** — eight event types: five for the grade (observation, threshold, sustained, improved, recovered) and three for monitoring health (signal lost, instrumentation fault, instrumentation restored). A grade change must hold for two consecutive cycles before it alerts, and per-severity re-notify and bundled delivery keep the channel quiet; stopped equipment freezes evaluation rather than reading as a recovery. Events are stored in a TAG table in the package database (`NEO_BEARING_STORE`) and can be exported to CSV or JSON.
- **Band Energy Trend** — an optional server-side timer extracts per-band energy (sub-synchronous / 1× / fault / high / very high) and envelope series so degradation invisible to overall RMS still surfaces as evidence. Past intervals can be backfilled to start learning immediately.
- **Reports** — one-click generation with a cancellable progress flow, one self-contained HTML file per selected tag, and a paged archive (created · report name · period · type). Report charts stay live — wheel zoom, drag, tooltips, theme-aware redraw — with a summary/full toggle and a judgment fingerprint that tells you whether a number changed because the data moved or because the judgment engine (package) changed.
- **Flexible Settings** — multi-table selection with alias editing, per-equipment unit / class / RPM / bearing (catalog with auto-computed fault frequencies, or custom designation and geometry; sleeve bearings supported), belt drives with driven-side sensor support, ISO machine-class thresholds, baseline learning, webhook notification routing, and data management (usage and ranged / per-tag cleanup).
- **Optional LLM Findings** — connect Claude / OpenAI / Gemini / Ollama to add a narrative expert opinion to detail analysis and reports; everything else works without it.

## Requirements

- Machbase Neo 8.7.3 or later.
- Each account that uses the app has a Neo API token (issued with **New token** in the Neo console's shield icon / Security panel) and enters it in the app once per browser — see [Entering the API token](https://machbase.github.io/neo-pkg-bearing-analytics/first-setup/#entering-the-api-token).
- An administrator (SYS) creates the package database `NEO_BEARING_STORE` and grants each account once, from the app's Settings → Data Source screen, and grants `SELECT` on the data tables to analyze.
- TAG tables with the standard `NAME · TIME · VALUE` columns.
- ROLLUP on the data tables is recommended. Tables without one still work, but the app aggregates raw data directly, so trend charts are limited to a recent span (the last 2 hours in Detail Analysis and reports) and server monitoring skips them. The settings screen marks these tables.

## Documentation

- [Introduction & contents](https://machbase.github.io/neo-pkg-bearing-analytics/)
- [Glossary](https://machbase.github.io/neo-pkg-bearing-analytics/glossary/)
- [First setup](https://machbase.github.io/neo-pkg-bearing-analytics/first-setup/)
- [Usage](https://machbase.github.io/neo-pkg-bearing-analytics/usage/)
- [Alarms & events](https://machbase.github.io/neo-pkg-bearing-analytics/alarms/)
- [How detection works](https://machbase.github.io/neo-pkg-bearing-analytics/detection/) — what is measured and how grades are decided
- [Fault types and signatures](https://machbase.github.io/neo-pkg-bearing-analytics/faults/)
- [What this tool does and does not do](https://machbase.github.io/neo-pkg-bearing-analytics/scope/) — measured performance and limits
- [Troubleshooting](https://machbase.github.io/neo-pkg-bearing-analytics/troubleshooting/)

## Current Status

v1.0.0. Runs on live TAG-table data only; there is no mock/demo mode. All analysis is deterministic; the LLM opinion layer is optional. Notifications go out over a single webhook channel (Slack, Discord, Google Chat, or your own endpoint); email or SMS is reached by relaying that webhook through an automation tool such as n8n.

---
Development: see [frontend/README.md](frontend/README.md) (Vite + Preact).
