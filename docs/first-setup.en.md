---
title: First setup
weight: 20
---

# First setup

[한국어](./first-setup.kr.md) | **English**

When you first open the app, the **Settings** screen is where you define what to analyze. Settings is split into five sections down the left side.

| Section | Contents | Required |
| :--- | :--- | :---: |
| Data Source | Select TAG table(s) & tags, aliases | Yes |
| Equipment | RPM · bearing model · ISO class | Recommended |
| Criteria | Severity thresholds, baseline learning | Optional |
| Alarms | Per-severity notification routing | Optional |
| LLM | Provider for report/event opinions | Optional |

Changing a setting shows a save prompt at the top; saving reloads live data.

## Data Source

First, choose which data to analyze.

1. TAG tables detected in Neo are listed.
2. Select the table(s) to analyze.
3. From that table's tag list, choose the tags to monitor.

Nothing is selected initially — pick only the tags you actually want to analyze.

### Aliases

Tags are shown as `alias (tag name)`. If the original tag name is long or code-like, set an alias to make it readable. The alias is used across monitoring cards, detail analysis, and reports.

### Data source change detection

If a selected table or tag is removed from the DB or becomes empty, a change-detection banner appears at the top. Update your selection in Data Source when that happens.

## Equipment

Telling the app what equipment each tag belongs to improves diagnostic accuracy. It works without this, but these values make grading and diagnosis more precise:

- **RPM** — rotation speed. The basis for the 1× frequency and bearing fault-frequency calculations.
- **Bearing model** — picking one from the catalog auto-computes its geometry and BPFO / BPFI / BSF / FTF fault frequencies.
- **ISO Class** — selecting the machine class (I–IV) applies the matching ISO 10816 severity zones.

Once a bearing is registered, fault-frequency markers appear on the Detail Analysis FFT so you can match peaks to specific fault types.

## Criteria

This screen reviews and adjusts the thresholds that separate the severity grades (Good · Warning · Danger · Critical).

- Each tag inherits the thresholds of its class or unit row.
- Defaults follow ISO 10816; you can override any threshold manually.

### Baseline learning

Thresholds are **always** applied. On top of that, learning the equipment's normal state adds a **relative reference (baseline)** layer.

- Before learning — events and alarms are judged by threshold breaches only.
- After learning — a threshold breach **or** a baseline deviation is judged together.

Baseline learning catches "different from usual" changes that absolute thresholds miss. Tags that have not been trained keep an untrained marker on the settings screen.

## Alarms

Configure which severities are routed to which channels when an event fires. Per severity, you can enable email · Slack · SMS targets and choose how notifications are sent.

> Alarm judgment itself runs while the app is open. See [Usage › Alarms and events](./usage.en.md#alarms-and-events) for details.

## LLM

To add a narrative opinion to reports and events, configure at least one provider. This is optional — everything else works without it.

- Claude · OpenAI · Gemini take an API key; Ollama takes a `base_url`.
- If several providers are configured, choose the active one from the dropdown.
- Use **Connection test** to verify a setup. The test only validates; the feature is gated on whether a configuration *exists*, not on the test.

## Navigation

- [Back to contents](./index.en.md)
- [Next: Usage](./usage.en.md)
