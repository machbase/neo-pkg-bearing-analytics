# neo-pkg-vibe-analytics v0.1.0

A vibration analysis package for monitoring rotating-machinery health from time-series data stored in Machbase Neo.

## Overview

neo-pkg-vibe-analytics turns vibration sensor data in Machbase Neo TAG tables into actionable machine-health insight — without writing a single line of SQL or TQL.

Open the app in your browser and every piece of equipment is graded against ISO 10816 severity zones in real time. Drill into any tag for waveform and spectrum analysis, get rule-based fault diagnosis with prioritized recommended actions, and generate a full analysis report in one click.

All analysis is **deterministic** — no LLM is required for grading, diagnosis, or reporting. An LLM can optionally be connected to add a narrative expert opinion to reports and event explanations.

The app connects to your Neo instance on launch, auto-detects TAG tables, and runs on live data. When no TAG table is available it stays empty with an explanatory message rather than substituting mock data — every value on screen is a value that exists in the DB.

## Who is it for?

- **Maintenance / reliability engineers** — watch equipment condition at a glance, catch bearing and alignment faults early, and get concrete recommended actions
- **Data engineers** — serve vibration analytics on top of Machbase Neo without building custom queries, charts, or threshold logic

## Key Features

- **Real-time Monitoring** — equipment card grid with live RMS sparklines, ISO 10816-3 severity grades (양호 / 주의 / 위험 / 심각), a KPI summary bar that doubles as a severity filter, drag-to-reorder cards, and a filterable event feed. A header toggle turns alarm judgment on or off.
- **Detail Analysis** — a snapshot of the selected tag: raw waveform, RMS / Peak-to-Peak / Crest Factor / Kurtosis trends, defect-band energy trends, FFT spectrum with bearing fault-frequency markers (1× / 2× / 3×, BPFO / BPFI / BSF / FTF), fault-band search, envelope, cepstrum, and spectrogram — with harmonic / sideband analysis.
- **Three-criteria Grading** — every tag is judged against the ISO zone (absolute, band-limited to 10–1000 Hz as the standard defines), a learned baseline (relative to its own normal), and per-band energy (relative, per frequency band). The worst of the three becomes the grade, and the screen shows which one raised it.
- **Rule-based Diagnosis** — automatic fault verdict (imbalance, misalignment, bearing inner/outer race, looseness, gear) with sourced supporting evidence, evidence scores, and prioritized recommended actions. Faults the current measurement cannot resolve are marked "not observable" with the reason, rather than scored low.
- **Measurement-validity Gate** — clipping and saturation patterns put the whole diagnosis into a "withheld" state and lower every candidate's evidence score together, because a shaky measurement affects the entire spectrum. Misdiagnosis starts with trusting a bad measurement.
- **App or Server Monitoring** — evaluate in the open app, or register the evaluation settings as a Neo timer so events keep accruing with the app closed. Both modes run the *same* judgment rules, and the app reports when monitoring has stopped, stalled, or has nothing left to evaluate — so "no events" never quietly means "monitoring is dead".
- **Alarms & Events** — eight event types covering worsening, sustained, improved, recovered, baseline and band breaches, and signal loss. Entry/recovery hold and per-severity re-notify suppress spike and flapping noise; stopped equipment freezes evaluation rather than reading as a recovery. Events land in a Neo LOG table and can be exported to CSV or JSON.
- **Band Energy Trend** — an optional server-side timer extracts per-band RMS (sub-synchronous / 1× / fault / high / very high) so degradation invisible to overall RMS still surfaces. Past intervals can be backfilled to start learning immediately.
- **Reports** — one-click generation with a cancellable progress flow and a paged archive. Saved reports are self-contained HTML whose charts stay live — wheel zoom, drag, tooltips, theme-aware redraw — plus a summary/full toggle and a ruleset fingerprint that tells you whether a number changed because the data moved or because the criteria did.
- **Flexible Settings** — multi-table selection with column mapping and alias editing, per-equipment unit / RPM / bearing catalog (fault frequencies auto-computed, custom geometry and journal bearings supported), ISO machine-class selection with editable thresholds, baseline learning, and webhook notification routing.
- **Optional LLM Findings** — connect Claude / OpenAI / Gemini / Ollama to add a narrative expert opinion to reports and events; everything else works without it.

## Documentation

- [Introduction & contents](docs/index.en.md) ([한국어](docs/index.kr.md))
- [First setup](docs/first-setup.en.md) ([한국어](docs/first-setup.kr.md))
- [Usage](docs/usage.en.md) ([한국어](docs/usage.kr.md))
- [Alarms & events](docs/alarms.en.md) ([한국어](docs/alarms.kr.md))
- [How detection works](docs/detection.en.md) ([한국어](docs/detection.kr.md)) — what is measured and how grades are decided
- [Troubleshooting](docs/troubleshooting.en.md) ([한국어](docs/troubleshooting.kr.md))

Two expert personas — identity, reasoning order, judgment rules, and copy-paste system prompts — are documented separately in [persona/](persona/README.md): a rotating-machinery diagnostician who reviews what a report claims, and a monitoring-UI engineer who reviews the screen that carries it.

## Current Status

v0.1.0. Runs on live TAG-table data only; there is no mock/demo mode. All analysis is deterministic; the LLM opinion layer is optional. Of the notification channels, webhook is functional — email and SMS are still in preparation.

---
Development: see [frontend/README.md](frontend/README.md) (Vite + Preact).
