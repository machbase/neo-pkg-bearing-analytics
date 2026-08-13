---
title: First setup
weight: 20
---

# First setup

[한국어](./first-setup.kr.md) | **English**

When you first open the app, the **Settings** screen is where you define what to analyze. Settings is split into six sections down the left side.

| Section | Contents | Required |
| :--- | :--- | :---: |
| Data Source | Select TAG table(s) & tags, aliases | Yes |
| Equipment | Unit · Class · RPM · bearing model · measurement & drive | Recommended |
| Criteria | Machine class, severity thresholds, baseline learning | Optional |
| Alarms | Monitoring mode, evaluation interval/window, alarm behavior, notifications | Optional |
| LLM | Provider for report and event opinions | Optional |
| Data management | Storage usage, ranged & per-tag data deletion | Optional |

Changing a setting shows a save prompt at the bottom of the screen; pressing **Save** reloads live data. Navigating away with unsaved changes prompts for confirmation. If setup items are still missing, the ⚙ button in the header shows an amber dot.

## Data Source

First choose which data to analyze.

1. Tables detected in Neo are listed with a kind badge.
2. Select the tables to analyze. **Multiple tables** can be selected at once.
3. Tags from the selected tables appear in the alias table below.

Nothing is selected initially. Select only the tables you actually want to analyze.

### Column layout

Queries use the Machbase TAG table standard column names (`NAME` · `TIME` · `VALUE`). TAG tables with different column names are not supported yet.

### Aliases

Tags are shown as `alias (tag name)`. If the original tag name is long or code-like, set an alias to make it readable. Aliases are used on monitoring cards, in detail analysis, in reports, and in notification messages. Leave it blank and the original tag name (`NAME`) is shown as-is. Use the search box when you have many tags.

### Load limits

To avoid query storms, the app loads at most **60 tags per table** and **100 pieces of equipment overall**. With more tags than that, some will not appear on screen — narrow the scope by selecting only the tables you need.

### Data source change detection

If a selected table or tag is removed from the DB or becomes empty, a change banner appears at the top of the Monitoring screen. Use **Reload** to refresh or **Dismiss** to close it.

## Equipment

Telling the app what each tag actually is improves diagnostic accuracy. It works without this, but these values make grading and diagnosis more precise. Tags left unset are marked with an amber dot.

| Field | Description |
| :--- | :--- |
| Unit | `mm/s` (velocity) · `g` (acceleration) · `μm` (displacement). Determines which threshold row is inherited |
| Class | Equipment class (I–IV). Applies ISO 10816 severity zones |
| RPM | Rotational speed — the basis for 1× and bearing fault frequency calculation (defaults to 1800) |
| Bearing model | Pick from the catalog and geometry plus fault frequencies are computed automatically |

Hovering the <kbd>?</kbd> next to each field name shows what the value is, where to find it, and what happens if you leave it empty.

**Leave fields you don't know empty.** Only the faults judged from that field are reported as "not observable with this measurement"; the rest of the diagnosis proceeds normally. Filling a field by guessing is worse — the guess becomes evidence.

### ISO class reference

| Class | Applies to |
| :---: | :--- |
| I | Small machines (≤ 15 kW) |
| II | Medium machines (15–75 kW) |
| III | Large machines · rigid foundation |
| IV | Large machines · flexible foundation |

### Bearings and fault frequencies

Selecting a bearing model from the catalog fills in geometry (ball count, ball diameter, pitch diameter, contact angle) and computes BPFO / BPFI / BSF / FTF together with RPM. Press the **Settings** button on the right of the table to inspect the computed values.

- **Bearing not in the catalog** — enter ball count `n`, ball diameter `Bd`, pitch diameter `Pd`, and contact angle `φ` directly in the settings panel.
- **Sleeve (journal) bearings** — with no rolling elements, BPFO/BPFI/BSF/FTF are undefined. Diagnosis uses only 1× and 2× rotational frequency.

Once a bearing is registered, fault-frequency markers appear on the detail-analysis FFT so you can match peaks to specific faults.

### Measurement and drive

The **Settings** button on the right of the table opens the fault frequencies and geometry along with fields for measurement and drive details. The `n/N` on the button is an input-completeness count.

| Field | What it does for diagnosis |
| :--- | :--- |
| Mounting | Sets the upper frequency limit the measurement can be trusted to — stud 10 · adhesive 5 · magnet 2 · handheld probe 1 kHz |
| Drive type | Direct · belt · gear. For belt drives the pulley ratio yields the driven shaft speed |
| Vane / tooth count | Vane count × rotational frequency = vane pass frequency |
| Belt specification | Pulley diameters D1·D2 and belt length. Used to judge belt faults (cracks, missing chunks) |

All of these are optional — but **mounting is worth specifying whenever you can.**

An accelerometer's trustworthy frequency range depends heavily on how it is attached. This package automatically searches for the frequency band with the strongest impulsiveness and runs envelope analysis there, and a magnet mount's resonance (typically 2–5 kHz) **looks exactly like a fault** to that search. Specifying the mounting excludes bands above the limit from the search, eliminating the error of reading a ringing mount as a bearing fault. Left empty, the full band is trusted without any limit.

When a band has been excluded, the report prints that fact alongside the diagnostic evidence.

### Line frequency

Electrical faults appear at twice the line frequency (120 Hz on a 60 Hz grid) and, unlike mechanical faults, do not move when speed changes — that is what distinguishes them. Korea runs a single 60 Hz grid, so this is fixed at the default and the control is normally hidden. If entered RPM values match another grid's synchronous speeds (3000 · 1500 · 1000 rpm for 50 Hz), the selector appears with a warning.

## Criteria

Two independent criteria decide severity (Good · Warning · Danger · Critical).

- **Absolute thresholds** — zone boundaries from the ISO 10816 machine class. Always applied.
- **Relative baseline** — a learned per-equipment normal state. Applied only to tags that have been trained.

### Machine class and zone boundaries

Choosing a machine class shows a preview of that class's zone boundaries. Each tag inherits the thresholds of its Class row (velocity, `mm/s`) or its unit row (`g` · `μm`).

- Velocity (`mm/s`) defaults are **ISO 10816 reference values**.
- Acceleration (`g`) and displacement (`μm`) defaults are **general reference values** — these are not quantities the standard defines, so they are meant to be adjusted for your equipment.

Thresholds can be edited directly in the table and restored with **Reset to defaults**.

### Baseline learning

Thresholds always apply. On top of that, learning the equipment's normal state adds a second, relative criterion.

The app learns the center (μ) and typical variation (σ) of RMS over a normal operating window, then raises a **baseline breach** event when a value exceeds the limit. This catches a jump relative to normal even when the absolute value is still inside the Good zone.

| Setting | Values | Description |
| :--- | :--- | :--- |
| Learning window | last 1 hour / 6 hours / 24 hours | Longer windows cover more normal states, making the baseline more robust |
| k (σ multiplier) | number | Breach sensitivity. At `k=3` roughly 99.7% of normal data falls inside the limit. Leave it at 3 unless you have a reason |

- Train tags individually with **Learn**, or all at once with **Learn all**. Learned values can be **deleted**.
- If a tag has less data than the learning window, only what exists is used.
- Learning happens in **the same unit as the alarm's RMS window**. The reference only describes the distribution of actual evaluated values if it was learned the same way they are measured. After changing the window, retrain.
- The count of untrained tags is shown at the top of the section. Threshold detection works normally before any training.

#### When a baseline gets old

If a tag was trained more than a month ago, a notice appears at the top of the section and each row carries a training-age badge.

The app **never retrains automatically.** Relearning while a fault is growing would absorb that fault as the normal reference. When maintenance is performed or operating conditions change, press **Learn** yourself to refresh it.

#### Tags deleted and recreated

Learned values are keyed by the `table:tag` name, so attaching different equipment under the same name applies the old reference. If the new machine is quieter, anomalies are never caught; if louder, alarms fire constantly — and on screen it just says "trained".

When the app detects this, the row offers **Same equipment — keep** / **Different equipment — reset**. Until you confirm, baseline evaluation is suspended for that tag; ISO zone evaluation keeps running throughout.

#### When the learning data isn't clean

A learning window rarely contains nothing but normal operation, so learning handles three things automatically.

**Momentary spikes don't shift the result.** Center and variation are estimated with median-based statistics rather than mean and standard deviation. With just 3 spikes in 60 samples, the standard-deviation approach inflates the limit to several times the normal value — **the criterion meant to catch breaches ends up hiding them.** Median-based estimates hold even when half the sample is contaminated.

**Stopped and ramping intervals are excluded.** Buckets that fall below 20% of the operating level (stopped or idle) and buckets that change sharply against their neighbors (startup and shutdown ramps) are dropped from learning. What was excluded is shown in the completion notice and status line as `excluded 12 (idle 8 · transient 4)`.

**A window that is mostly downtime is refused.** If most of the window is stopped, "stopped" becomes the learned normal and merely running the machine triggers breach alarms. Learning fails in that case with a prompt to retrain over a period that is mostly normal operation.

On top of this, for signals that barely vary the limit is kept at **at least 1.2 × μ**, so noise-level fluctuation doesn't fire alarms repeatedly.

> None of this filters out a period where a fault is already developing. Learn over such a window and the faulty state becomes the normal reference. Choosing a window that is **genuinely normal operation** remains your responsibility.

### Band energy trend (optional)

A third criterion, for changes where overall RMS barely moves but one frequency band jumps — early bearing faults being the classic case. It sits at the bottom of the Criteria screen.

Bands are split into five ranges relative to rotational frequency (sub-synchronous · 1× band · fault band · high · very high); the very-high range is further subdivided into four octave bands, so eight bands are stored and judged in total. Each is judged by how many times above its own normal it sits.

Setup is three steps.

1. **Band extraction** — turn it on and set the extraction interval (10 minutes – 1 hour). These values require frequency analysis of raw data, so they are computed on the server on their own schedule, separate from evaluation. A shorter interval accumulates samples faster.
2. **Backfill past data** — rather than waiting for samples to accumulate, compute past intervals retroactively from raw data already in the DB. Progress and estimated time are shown, and stopping partway keeps whatever was filled.
3. **Learn the normal reference** — once there are enough samples, train per band. This works like overall RMS learning and applies the same automatic filters.

Per-channel status shows something like `trained 4/9`. The denominator is the number of series measurable on that tag — low sample rates drop the upper bands, and a missing bearing part number drops the fault-frequency series. That is normal. Untrained series are excluded from evaluation.

> Train bands **only when healthy operation is certain**, for the same reason as above — a fault already in progress becomes the normal reference.

## Alarms

This section covers monitoring mode (app vs. server), evaluation interval and RMS window, and notifications (entry and recovery hold, the webhook channel, per-severity delivery and re-notify). For webhook setup walkthroughs, see the guides in [Alarms & events](./alarms.en.md).

It has enough depth to warrant its own page → [Alarms & events](./alarms.en.md)

## LLM

To add narrative opinions to reports and events, configure at least one provider. This is optional — everything else works without it.

1. Pick a provider (Claude · OpenAI · Gemini · Ollama).
2. Enter the **API key** and **model**. Leave the model blank to use that provider's default.
3. For Ollama, enter the **Ollama URL** instead of an API key.
4. Use **Test connection** to verify the configuration.

You can configure several providers and choose between them from the dropdown on the detail-analysis and report screens. The connection test is only for verification — the feature activates based on whether a configuration exists.

> The tone and judgment rules for opinions are defined in the package's `persona/` documents. See [Usage › LLM opinion](./usage.en.md#llm-opinion-optional) for details.

## Navigation

- [Back to contents](./index.en.md)
- [Next: Usage](./usage.en.md)
