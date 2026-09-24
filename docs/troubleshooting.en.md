---
title: Troubleshooting
weight: 60
---

# Troubleshooting

[한국어](./troubleshooting.kr.md) | **English**

## Only a "cannot reach the database" notice appears

The signed-in account has not been granted the store (`NEO_BEARING_STORE`). An administrator (SYS) can fix
this from Settings → Data Source → **Grant an account**: pick the account and press the button. Afterwards,
press `Check` and the app resumes without a reload.

If you see this notice *as* SYS, the database does not exist yet — press `Create` on the same card.

## Server monitoring is on but no events appear

The timer can be `RUNNING` and still do nothing. The heartbeat tells them apart:

```sql
SELECT K, VAL FROM NEO_BEARING_STORE.SYS.MONSTATE WHERE K='<account>:__hb';
```

`n` is how many tags were processed. **`n` of 0** means the cycle runs but skips every tag. The usual cause
is data-table grants: listings and the UI work from a plain GRANT, but the monitoring TQL uses rollups, so a
missing `SELECT` on that table ends the cycle silently at zero. `ms` helps too — single-digit milliseconds
means nothing was queried at all.

## The timer list shows the same name several times

Neo does not prevent duplicate timer names. The app deletes every timer with that name before registering
and verifies the deletion, but duplicates created while the timer list itself was failing (for example under
DB load) cannot be caught at that moment. Once the load clears, **toggling server monitoring off and on**
cleans them up. To do it by hand, delete them in the Neo TIMER view — **stop each one first**; deleting a
running timer can leave its runner alive.

## A "Could not load settings" screen appears

The app could not read your saved settings at startup. It does not open any tab in this state — showing defaults and letting you save would overwrite the real settings.

- **Could not load settings** — usually a transient connection problem. The settings are still in the DB; press **Retry**.
- **Cannot read <area> settings** — a save was interrupted and part of that area (for example, Equipment) is damaged. If Retry gives the same result, press **Open <area> with defaults**. Everything else loads as saved and you are taken to that area's settings. Pressing the button saves nothing by itself, so set that area up again and save.

## No equipment cards at all

- If the app shows "no TAG table found in the DB", it connected to Neo but found no TAG table. Check the Neo connection and that a TAG table exists. The app does not substitute mock data, so the screen stays empty.
- If tables exist but there are no cards, you haven't selected a table yet in **Settings → Data Source**. Select the tables to analyze and save.
- "Failed to load data" means a query against a selected table errored; the message includes the cause.
- "Could not load data" means the selected tables could not be queried. The selection is kept and the app retries automatically — see "Could not reload data" below.

## A "Could not reload data" banner appears

A table query failed while re-reading data after a settings save or when a new tag was detected.

- Monitoring does not stop. It **keeps running on the last loaded data** and retries automatically (starting at 10 s and doubling up to 5 min).
- Meanwhile, **newly selected tables are not monitored** (the banner names them). Tables you deselected leave monitoring as soon as you save.
- The selection is already saved, so there is nothing to save again. As soon as one retry succeeds the banner disappears and monitoring is back to normal. To skip the wait, press **Retry now**.
- If it keeps failing (from the third attempt the banner adds a hint), check whether the named table was dropped or its permission revoked, and deselect it under **Settings → Data Source** and save if needed.
- While it is failing, the server monitoring timer is not rebuilt. Rebuilding it from an incomplete list would drop the unread equipment from server monitoring too.

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

## A card shows "Fault pattern: awaiting first measurement" or "Fault pattern: measurement failed"

The fault pattern — the axis that switches the grade on — could not be measured this cycle, so **the previous grade is being held**. Reading a missed cycle as "no pattern = good" would confirm a false "recovered" within seconds on equipment that is in alarm, so judgment is held instead.

- **Awaiting first measurement** — nothing has been measured yet, as right after opening the app. It clears once the first measurement finishes (usually a few seconds, longer with many tags).
- **Measurement failed** — the raw waveform could not be read or there were too few samples. It is measured again next cycle (the pattern/band extraction interval). If it persists, check data collection for that tag.
- Tags that can never be measured because the shaft speed or bearing is missing show **Cannot judge** instead.

## Alarms are off after reopening the app

- The header alarm indicator saves as soon as you click it. If alarms are off when you return, they may have been turned on with the **alarm switch on the Settings tab** and never saved (including choosing **Discard and leave**), or the save failed — a failed save shows an error and flips the indicator back.
- Click the header alarm indicator to turn it back on. No separate save is needed.

## No events are being recorded

First check whether a **monitoring status warning** is showing at the top of the screen. Monitoring having stopped is the most common cause, and most of these are fixed by the **Re-register** button right there.

If there is no warning, check the following.

- Check that **alarms are on**. Evaluation only runs while alarms are enabled.
- **In app monitoring mode the app must be open.** If monitoring must continue with the app closed, switch to **server monitoring**.
- **Nothing is recorded while Good simply continues.** Only Warning-and-worse, plus the return from a bad state, are recorded.
- **Intermediate steps while still bad** (Critical → Danger, for instance) are not recorded separately; one "improved" event represents them.
- A long entry hold deliberately ignores variation shorter than that hold.
- **With RPM or bearing model empty, no events fire at all.** The axis that switches the grade on is the fault-frequency grid, and without shaft speed or geometry that grid cannot be built. The card's coverage indicator reads "cannot judge".
- **High vibration on its own produces no event.** Bearing-fault evidence must stand for the grade to rise. Imbalance, misalignment and looseness are only reported as "amplitude high but no bearing-fault evidence".
- **Baseline and band produce no events.** A breach appears only in the evidence table.
- **Grades are judged once every 10 minutes.** A machine that just deteriorated has to wait for the next cycle.

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

Both server monitoring and in-app judgment **run on the saved settings.** After changing settings, press **Save** for the new criteria to take effect; until then the monitoring screen also shows the previous criteria. Choosing **Discard and leave** when navigating away throws the edits away.

## Notifications don't arrive

1. In **Settings → Alarms → Notifications**, confirm the channel is on and a target (webhook URL) is entered.
2. Press **Test** to verify the send path in isolation. A failure here is a URL or network problem.
3. In **per-severity delivery**, confirm that severity is set to **Immediate**. The default sends Danger and Critical immediately, with Warning set to No notification.
4. If delivery is **No notification**, the event is recorded but nothing is sent.
5. Webhook is the only delivery channel. For email or SMS, relay through an automation tool such as n8n — see [Alarms and events](./alarms.en.md).
6. If it still does not arrive, check whether **an event was recorded at all**. No event means this is a judgment problem, not a delivery one — go to "No events are being recorded" above.
7. **If only signal-loss and instrumentation faults are missing**, check the **Monitoring fault** row in the severity table — it is a separate switch from the three grade rows.
8. If many points went dark but only **one** alert arrived, that is correct — more than five events of the same type in one cycle are bundled. Every individual event is still in the event list.

## Older events are missing from the event list

The list renders only the most recent **200** events. For full history, use **Save** (export) with a period and read the CSV or JSON.

## "Unsafe file" warning when downloading an event file

This is the browser's generic warning for CSV/JSON downloads. Nothing is wrong with the file — keep the download and it saves normally.

## The diagnosis feels inaccurate

- Confirm you registered unit, RPM, and bearing model under **Equipment**. Without a unit there is no defined threshold row to inherit, and without RPM or a bearing, fault-frequency matching is limited.
- Check whether **mounting** is specified. On a magnet mount left unspecified, the mount's resonance (typically 2–5 kHz) can be selected as the fault band, so a ringing mount reads as a bearing fault.
- Check in **Criteria** that the thresholds suit your equipment. Acceleration (`g`) and displacement (`μm`) defaults are general reference values, not standard values, and are meant to be adjusted.
- Learning the normal state adds a "versus normal" note to the evidence table (it does not change the grade).
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

- [Previous: What this tool does and does not do](./scope.en.md)
- [Back to contents](./index.en.md)
