# neo-pkg-vibe-analytics v0.1.0

A vibration analysis package for monitoring rotating-machinery health from time-series data stored in Machbase Neo.

## Overview

neo-pkg-vibe-analytics turns vibration sensor data in Machbase Neo TAG tables into actionable machine-health insight — without writing a single line of SQL or TQL.

Open the app in your browser and every piece of equipment is graded against ISO 10816 severity zones in real time. Drill into any tag for waveform and spectrum analysis, get rule-based fault diagnosis with prioritized recommended actions, and generate a full analysis report in one click.

All analysis is **deterministic** — no LLM is required for grading, diagnosis, or reporting. An LLM can optionally be connected to add a narrative expert opinion to reports and event explanations.

The app connects to your Neo instance on launch, auto-detects TAG tables, and runs on live data. When no TAG table is available it falls back to a demo state so the UI can still be explored.

## Who is it for?

- **Maintenance / reliability engineers** — watch equipment condition at a glance, catch bearing and alignment faults early, and get concrete recommended actions
- **Data engineers** — serve vibration analytics on top of Machbase Neo without building custom queries, charts, or threshold logic

## Key Features

- **Real-time Monitoring** — equipment card grid with live RMS sparklines, ISO 10816-3 severity grades (양호 / 주의 / 위험 / 심각), a KPI summary bar, and an event feed. A header toggle turns app-side alarm judgment on or off.
- **Detail Analysis** — a frozen snapshot of the selected tag: raw waveform, RMS / Peak-to-Peak / Crest Factor / Kurtosis trends, defect-band energy and band-kurtosis trends, FFT spectrum with bearing fault-frequency markers (1× / 2× / 3×, BPFO / BPFI / BSF / FTF), envelope, cepstrum, and spectrogram — with harmonic / sideband analysis.
- **Rule-based Diagnosis** — automatic fault verdict (imbalance, misalignment, bearing inner/outer race, looseness, gear) with supporting evidence and prioritized recommended actions.
- **Reports** — one-click vibration analysis report generation with a built-in archive and preview.
- **Alarms & Events** — while the app is open, each tag is judged against its thresholds (always) and its learned baseline (once trained). Grade changes and baseline breaches are recorded as events in a Neo LOG table; 양호 (good) is not recorded. Events can be exported to CSV or JSON for a chosen period.
- **Flexible Settings** — TAG table & tag selection with alias mapping, per-equipment RPM and bearing-model catalog (fault frequencies auto-computed), ISO machine-class selection with custom threshold overrides, baseline learning, and alarm severity routing.
- **Optional LLM Findings** — connect Claude / OpenAI / Gemini / Ollama to add a narrative expert opinion to reports and events; everything else works without it.

## Documentation

- [Introduction & contents](docs/index.en.md) ([한국어](docs/index.kr.md))
- [First setup](docs/first-setup.en.md) ([한국어](docs/first-setup.kr.md))
- [Usage](docs/usage.en.md) ([한국어](docs/usage.kr.md))
- [Troubleshooting](docs/troubleshooting.en.md) ([한국어](docs/troubleshooting.kr.md))

## Current Status

v0.1.0 (Phase 1). Runs on live TAG-table data by default, with a demo fallback when no table is present. All analysis is deterministic; the LLM opinion layer is optional.

---
Development: see [frontend/README.md](frontend/README.md) (Vite + Preact).
