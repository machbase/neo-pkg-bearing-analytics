---
title: Troubleshooting
weight: 60
---

# Troubleshooting

[한국어](./troubleshooting.kr.md) | **English**

## No equipment cards at all

- If the app shows "no TAG table found in the DB", it connected to Neo but found no TAG table. Check the Neo connection and that a TAG table exists. The app does not substitute mock data, so the screen stays empty.
- If tables exist but there are no cards, you haven't selected a table yet in **Settings → Data Source**. Select the tables to analyze and save.
- "Failed to load data" means a query against a selected table errored; the message includes the cause.

## Only some tags appear

Load limits — the app loads at most **60 tags per table** and **100 pieces of equipment overall**, to avoid query storms.

Narrow the scope by selecting only the tables you need, or work through your tags in batches.

## A tag I just added doesn't appear in Data Source

- The data source list reflects the moment you entered it. After adding tags, reopen the settings screen to refresh the list.
- If the data source change banner is showing at the top of the Monitoring screen, press **Reload**.

## Presets (1 hour, 6 hours, …) are disabled

That tag has less data than the preset's length.

- Clicking one shows a "not enough data" notice.
- Use the **All** preset to see that tag's entire data range.
- As more data accumulates the presets re-enable automatically.

## Detail analysis doesn't update live

That's expected. Detail analysis is a **snapshot** frozen at the moment you entered. To see the latest state, press **Refresh**, leave and re-enter detail analysis, or switch tags to re-capture.

## A "Signal anomaly — check the sensor" warning appears

A pattern that **casts doubt on the measurement itself** — such as clipping (saturation) — was detected. Diagnosis enters a **diagnosis withheld** state and the evidence scores of all fault candidates are lowered together.

- Confidence drops for **every** candidate, not just one. A shaky measurement affects the whole spectrum, so lowering only part of it would promote an unverified candidate to first place instead.
- Amplitudes read from a saturated signal come out **lower** than reality — treat the value as a lower bound on the true amplitude.
- Check the sensor, cable, mounting, and grounding before suspecting the machine.

## Alarms are off after reopening the app

- The alarm state is saved. If it's off when you return, the window may have been closed before the setting was saved.
- Click the alarm indicator in the header to turn it back on, then **Save** in the settings screen.

## No events are being recorded

First check whether a **monitoring status warning** is showing at the top of the screen. Monitoring having stopped is the most common cause, and most of these are fixed by the **Re-register** button right there.

If there is no warning, check the following.

- Check that **alarms are on**. Evaluation only runs while alarms are enabled.
- **In app monitoring mode the app must be open.** If monitoring must continue with the app closed, switch to **server monitoring**.
- **Nothing is recorded while Good simply continues.** Only Warning-and-worse, plus the return from a bad state, are recorded.
- **Intermediate steps while still bad** (Critical → Danger, for instance) are not recorded separately; one "improved" event represents them.
- A long entry hold deliberately ignores spikes shorter than that hold.

## "Zero tags evaluated" warning

The timer is running normally, but **no new data is arriving** on the monitored tags. Timer state alone would look healthy, so this is reported separately.

Check the data collection side — sensors, collectors, and the ingest pipeline.

## The machine stopped but no "recovered" notification arrived

That is correct behavior. When the evaluated value falls below 20% of normal, the app treats it as **equipment stopped** and freezes evaluation.

Vibration faults do not heal themselves, so an unexplained drop usually means the machine stopped or the sensor was lost. Announcing "recovered" there would leave people thinking the machine was fixed.

While frozen the previous state is held, so when the machine restarts the fact that it *was* bad is still there.

## A tag keeps improving and worsening at short intervals

When one tag repeatedly worsens and improves, a **flapping notice** appears.

That points less to an equipment problem than to an **RMS window shorter than the machine's load-variation cycle** — the load rising and falling is itself being read as a grade change.

Extend the RMS window to at least the value shown in the notice. Increasing the entry hold also helps.

## Server monitoring is on but certain tags produce no events

Most likely those tables have **no ROLLUP**. Server monitoring only evaluates tables that have one and silently excludes tags on the others.

Create a rollup for that table, or check those tags with app monitoring.

## The Criteria screen asks "same equipment / different equipment"

A tag that had been deleted has reappeared under the same name, and a baseline learned for that name is still stored.

If you temporarily removed and restored the same machine, choose **Same equipment — keep**. If you connected different equipment under the same name, choose **Different equipment — reset**.

Until you confirm, baseline and band evaluation are suspended for that tag. Applying the old reference would mean missing anomalies when the new machine is quieter, and constant alarms when it is louder — while the screen just says "trained". ISO zone evaluation keeps working throughout.

## Band learning doesn't fill the denominator (e.g. 4/9)

That is normal. The denominator is the number of series **measurable on that tag**, and it differs per tag.

- The upper bands cover 1 kHz and above — with a low sample rate those bands are **not measurable in the first place**.
- The envelope fault-frequency series (BPFO·BPFI·BSF) accumulate **only when a bearing part number is set** — add one under equipment info and they start from then on.
- The tooltip next to the training status explains, per series, why it is missing.

Untrained series are excluded from evaluation, and the remaining series work normally.

## Not enough band samples to train

The extraction timer accumulates one band value per interval, so reaching a trainable amount takes time.

- **Backfill past data** computes retroactively from raw data already in the DB, giving you samples immediately.
- **Shortening the extraction interval** accumulates future samples faster.
- Extending the band learning window brings more slots into scope.

The current sample count and whether it is enough to train are shown next to the band learning window.

## I changed alarm settings but server monitoring still uses the old criteria

Server monitoring **runs with the settings as of your last save.** After changing settings, press **Save** for the new criteria to take effect.

## Notifications don't arrive

1. In **Settings → Alarms → Notifications**, confirm the channel is on and a target (webhook URL) is entered.
2. Press **Test** to verify the send path in isolation. A failure here is a URL or network problem.
3. In **per-severity delivery**, confirm that severity is set to **Immediate**. The default sends Danger and Critical immediately, with Warning set to No notification.
4. If delivery is **No notification**, the event is recorded but nothing is sent.
5. Webhook is the only delivery channel. For email or SMS, relay through an automation tool such as n8n — see [Alarms and events](./alarms.en.md).

## Older events are missing from the event list

The list renders only the most recent **200** events. For full history, use **Save** (export) with a period and read the CSV or JSON.

## "Unsafe file" warning when downloading an event file

This is the browser's generic warning for CSV/JSON downloads. Nothing is wrong with the file — keep the download and it saves normally.

## The diagnosis feels inaccurate

- Confirm you registered unit, RPM, and bearing model under **Equipment**. Without a unit there is no defined threshold row to inherit, and without RPM or a bearing, fault-frequency matching is limited.
- Check whether **mounting** is specified. On a magnet mount left unspecified, the mount's resonance (typically 2–5 kHz) can be selected as the fault band, so a ringing mount reads as a bearing fault.
- Check in **Criteria** that the thresholds suit your equipment. Acceleration (`g`) and displacement (`μm`) defaults are general reference values, not standard values, and are meant to be adjusted.
- Learning the normal state adds the relative criterion alongside thresholds.
- Diagnosis is computed from a single-channel, single-direction measurement with no phase information. Fault mechanisms are hypotheses; confirming them requires multi-axis and phase measurement.

If a fault candidate in the report is marked "not observable with this measurement", the stated reason names the information that was missing. Filling that field under **Equipment** brings the candidate back into scope.

## Baseline learning fails

The cause depends on the message.

- **"steady-state samples N (minimum 30 required)"** — too few samples remain after stopped and ramping intervals are excluded. Extend the learning window or retry once more data has accumulated.
- **"the learning window splits into stopped and running levels"** — most of the window is downtime. Learning it would make the stopped state the normal reference, so merely running the machine would fire breach alarms; learning is refused. Pick a period that is mostly continuous operation and retrain.

Even a successful run may report exclusions such as `excluded 12 (idle 8 · transient 4)`. That is normal — it means the baseline was built from what remained after filtering.

## Two reports show different numbers

Compare the **ruleset fingerprint** printed in each report.

- If the fingerprints **match**, the criteria were identical and **the data changed**.
- If the fingerprints **differ**, threshold or criteria settings changed in between.

## LLM opinions aren't generated

- Confirm at least one provider is configured in **Settings → LLM**. Claude · OpenAI · Gemini need an API key; Ollama needs a URL.
- Use **Test connection** to verify the key or URL.
- Confirm a provider is selected in the provider dropdown on the detail-analysis or report screen.
- If you typed a model name, confirm that model actually exists for that provider. Leave it blank to use the default.
- LLM opinions are optional. Rule-based diagnosis and reports work normally without them.

## Navigation

- [Previous: How detection works](./detection.en.md)
- [Back to contents](./index.en.md)
