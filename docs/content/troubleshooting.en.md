---
title: Troubleshooting
weight: 60
---

#

The app's screens can be shown in Korean, English, or Japanese; messages are quoted here in English, with the Korean wording where it helps.

## An "API 토큰이 없습니다" (no API token) or "token is not valid" notice appears

This browser has no API token for the account, or the saved token was revoked or expired. Issue a new token with **New token** in the Neo console's shield icon (Security) panel and enter it on the **User info** (유저 정보) card in the settings screen — see [Entering the API token]({{< relref "first-setup#entering-the-api-token" >}}).

- If the page switched to this screen while you were using it, the token was revoked or expired, or **Remove token** (토큰 지우기) was pressed in another tab. Entering a new token reloads the page and carries on.
- If it also says the token check API is missing (이 Neo에는 토큰 확인 API가 없습니다), Neo is older than 8.7.3. Upgrade Neo and open the app again.

## A "this is a token of account ○○" or "the token account differs from the console login" notice appears

The account the token was issued for differs from the account currently signed in to the Neo console. Enter a token of the signed-in account, or sign in to the console as the token's account.

## A "Neo 콘솔에 로그인되어 있지 않습니다" (not signed in to the Neo console) notice appears

The app keeps tokens per console login account. Sign in to the Neo console and open the app again.

## Only a "cannot reach the database" notice appears

This account has not been granted the store (`NEO_BEARING_STORE`). An administrator (SYS) can fix
this from Settings → Data Source → **Package account permissions** (패키지 사용 계정 권한): press **Grant** (권한 주기) on that account's row; the row's status (권한 있음) confirms it. Afterwards,
press `Check status` (상태 확인) and the app resumes without a reload.

If you see this notice *as* SYS, the database does not exist yet — press `Create` (만들기) on the same card.

## Server monitoring is on but no events appear

First check the monitoring-status warnings at the top of the Monitoring screen.

- **"Zero evaluation targets"** — the timer runs but skips every tag. The usual cause is **data-table grants**: even if the list and screens work, server monitoring queries the table directly, so if the registering account lacks `SELECT` on it, each cycle silently ends with nothing. Ask an administrator for `GRANT SELECT ON MACHBASEDB.SYS.<table> TO <account>;`. A table without ROLLUP, or no new data arriving, shows the same warning.
- **"Scanned N machines but measured the fault pattern on none"** — evaluation runs, but the grade-forming axis is empty: RPM or bearing model is missing, or the window has too few samples. Use **Open Equipment** and fill them in.
- If there is no warning, see [No events are being recorded](#no-events-are-being-recorded) below. Grade events come once per extraction interval (10 minutes by default) and need two consecutive cycles to confirm, so they do not appear the moment you switch on.

## The timer list shows the same name several times

Neo does not prevent duplicate timer names. The app deletes every timer with that name before registering
and verifies the deletion, but duplicates created while the timer list itself was failing (for example under
DB load) cannot be caught at that moment. Once the load clears, **toggling server monitoring off and on**
cleans them up. To do it by hand, delete them in the Neo timer screen — **stop each one first**; a timer
deleted without stopping can keep running.

## A "Could not load settings" screen appears

The app could not read your saved settings at startup. It does not open any tab in this state — showing defaults and letting you save would overwrite the real settings.

- **Could not load settings** — usually a transient connection problem. The settings are still in the DB; press **Retry**.
- **Cannot read \<area\> settings** — a save was interrupted and part of that area (for example, Equipment) is damaged. If Retry gives the same result, press **Open \<area\> with defaults**. Everything else loads as saved and you are taken to that area's settings. Pressing the button saves nothing by itself, so set that area up again and save.

## No equipment cards at all

- If the app shows "no TAG table found in the DB", it connected to Neo but found no TAG table. Check the Neo connection and that a TAG table exists. The app does not substitute mock data, so the screen stays empty.
- If tables exist but there are no cards, you haven't selected a table yet in **Settings → Data Source**. Select the tables to analyze and save.
- "No table selected for display" means everything was hidden with the Monitoring screen's **table filter**. Press **Show all** (monitoring keeps running regardless).
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

Load limits — the app loads at most **60 tags per table** and **100 pieces of equipment overall**, to avoid query storms. Tags left out carry an **Excluded from monitoring** (감시 제외) badge in the data source's alias table.

Narrow the scope by selecting only the tables you need, or work through your tags in batches.

## A table cannot be selected in Data Source

A table that is greyed out and cannot be checked uses columns other than `NAME · TIME · VALUE` (the reason is shown). The app queries only the standard column names, so such tables are not supported yet.

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

A pattern that **casts doubt on the measurement itself** — clipping (saturation), a flatline, DC drift, an isolated spike — was detected. Diagnosis enters a **diagnosis withheld** state and the evidence scores of all fault candidates are lowered together.

- Confidence drops for **every** candidate, not just one. A shaky measurement affects the whole spectrum, so lowering only part of it would promote an unverified candidate to first place instead.
- Amplitudes read from a saturated signal come out **lower** than reality — treat the value as a lower bound on the true amplitude.
- Check the sensor, cable, mounting, and grounding before suspecting the machine.
- A grey "DC 성분" (DC component) line without the warning box is not a fault: the sensor has a large but steady mean (MEMS accelerometer gravity axis, proximity displacement probe) and judgment continues. Only a wandering mean — **DC drift** — blocks judgment.

## A card shows an "On hold" badge

The machine is not being graded right now. Hover the badge for the reason and the last confirmed grade.

| Reason | Meaning | What to do |
| :--- | :--- | :--- |
| Cannot judge (판정 못 함) | No RPM or bearing geometry, so the fault pattern cannot be built. Sleeve (journal) bearings belong here too | Enter RPM and bearing model under Equipment (sleeve bearings are not graded) |
| Fault pattern awaiting first measurement | Nothing measured yet, as right after opening the app | Clears once the first measurement finishes (usually seconds, longer with many tags) |
| Fault pattern measurement failed | The raw waveform could not be read or there were too few samples. The previous grade is held | Measured again next cycle. If it persists, check data collection for that tag |
| Waiting (판정 대기) | Waiting for the first evaluation cycle | Wait a moment |
| Stopped (정지) | The machine is standing still, so judgment is frozen | Nothing — judgment resumes when it runs again |
| Signal lost (신호 두절) | No data arriving | Check the collection path |
| Instrumentation fault (계측 이상) | The waveform cannot be trusted | Check sensor, cable, mounting |

Reading a missed cycle as "no pattern = good" would confirm a false "recovered" on equipment that is in alarm, so the app holds judgment and keeps the previous state instead.

## Alarms are off after reopening the app

- The header alarm indicator saves as soon as you click it. If alarms are off when you return, they may have been turned on with the **alarm switch on the Settings tab** and never saved (including choosing **Discard and leave**), or the save failed — a failed save shows an error and flips the indicator back.
- Click the header alarm indicator to turn it back on. No separate save is needed.

## The header badge reads "앱 · 보기 전용" (view only)

Another tab or PC has the app open with the same account, and that page is doing the evaluation and notifications. This is normal — only one place evaluates so notifications are not duplicated.

- Saving settings, learning and reports still work from this tab. After a save, the lead tab applies it within 10 seconds.
- When the lead tab is closed, this tab takes over within a minute and the badge changes to **앱**.

## A "다른 계정으로 로그인되었습니다" (logged in as another account) notice appears

The Neo console login in this browser switched to a different account. This page belongs to the old account, so it has stopped all saving, evaluation and queries.

- To use the new account, click **새로고침** (Reload). If this browser has no API token for the new account, the token entry screen comes first.
- To keep using the old account, log back in as that account — the notice disappears and the page carries on.

## Detail analysis warns that the entered speed differs from the measured one

The entered RPM and the running-speed peak in the spectrum differ by more than 2%. The usual cause is entering the synchronous speed (1800, 3600).

- The fault pattern matches against the entered value with a 1% tolerance, so leaving it risks missing a fault.
- Check the nameplate rated speed and correct it, or press the **Save measured N rpm** button (it saves immediately). The measured value reflects the load at the time of measurement.
- With a **driven-side belt sensor**, the warning reads "driven-shaft speed … (pulley conversion or entered value) differs …". Check belt slip and the pulley diameters (**pitch diameter**, not outer diameter). In that case the save button writes to the **driven-shaft speed** field, not the motor RPM.
- When the running-speed peak overlaps the line frequency (60 or 50 Hz), as on a 2-pole motor, no measurement is taken and this warning never appears — enter the nameplate value exactly.

## Times look off by a few hours

Screen times follow **Settings → Data Source → Display time zone**. The default is this browser's time, so opening the app from another region shows that region's time.

- If everyone must see the same clock, fix the display time zone (for example, to the plant's local time) and save.
- Data is queried independently of time zone, so only the display shifts — nothing is missing.
- Server notification text uses the offset captured when server monitoring was registered. After a daylight-saving change, opening the app once re-registers it with the new offset.

## No events are being recorded

First check whether a **monitoring status warning** is showing at the top of the screen. Monitoring having stopped is the most common cause, and most of these are fixed by the **Re-register** button right there.

If there is no warning, check the following.

- Check that **alarms are on**. Evaluation only runs while alarms are enabled.
- **In app monitoring mode the app must be open.** If monitoring must continue with the app closed, switch to **server monitoring**.
- **Nothing is recorded while Good simply continues.** Only Warning-and-worse, plus the return from a bad state, are recorded.
- **Intermediate steps while still bad** (Critical → Danger, for instance) are not recorded separately; one "improved" event represents them.
- **A grade needs two consecutive cycles to confirm.** A single-cycle hit is recorded only as `observation`.
- **With RPM or bearing model empty, no grade events fire at all.** The axis that switches the grade on is the fault-frequency grid, and without shaft speed or geometry that grid cannot be built. The card reads **On hold** (cannot judge).
- **High vibration on its own produces no event.** Bearing-fault evidence must stand for the grade to rise. Imbalance, misalignment and looseness are only reported in detail analysis as "no bearing-fault signs · vibration magnitude in ISO zone … — checking non-bearing causes such as imbalance, misalignment and looseness is recommended" (베어링 결함 징후 없음 · 진동 크기 ISO … 구간 — 불평형·정렬불량·풀림 등 베어링 외 원인 점검 권장).
- **Baseline and band produce no events.** A breach appears only in the evidence table.
- **Grades are judged once per extraction interval (10 minutes by default).** A machine that just deteriorated has to wait for the next cycle.

## "Zero evaluation targets" warning

The timer is running normally, but it could not evaluate any monitored tag. Timer state alone would look healthy, so this is reported separately.

- Check whether **new data is arriving** on the monitored tags — the data collection side (sensors, collectors, the ingest pipeline).
- In server monitoring, also check the **`SELECT` grant** on the table and whether it has a **ROLLUP** — see [Server monitoring is on but no events appear](#server-monitoring-is-on-but-no-events-appear) above.

## The machine stopped but no "recovered" notification arrived

That is correct behavior. When the evaluated value falls below 20% of normal, the app treats it as **equipment stopped** and freezes evaluation (card: Stopped badge).

Vibration faults do not heal themselves, so an unexplained drop usually means the machine stopped or the sensor was lost. Announcing "recovered" there would leave people thinking the machine was fixed.

While frozen the previous state is held, so when the machine restarts the fact that it *was* bad is still there.

## A tag keeps improving and worsening at short intervals

When a tag crosses the threshold three or more times in the last two hours, the card shows a **Repeated N×** badge.

- The fault evidence is hovering around the adoption line. Load variation can switch the fault signal on and off, and so can an early-stage fault.
- The grade is set by the fault pattern, so lengthening the RMS window does not reduce this repetition.
- Clicking the badge opens detail analysis at the most recent worsening. Use the fault evidence and envelope spectrum to judge whether the fault is real.

## Server monitoring is on but certain tags produce no events

Most likely those tables have **no ROLLUP**. Server monitoring only evaluates tables that have one and excludes tags on the others. Check whether the table carries a **ROLLUP 없음** (no ROLLUP) badge in Settings → Data Source, or whether Settings → Alarms shows an exclusion warning.

Create a rollup for that table, or check those tags with app monitoring.

## The Criteria screen asks "same equipment / different equipment"

A tag that had been deleted has reappeared under the same name, and a baseline learned for that name is still stored.

If you temporarily removed and restored the same machine, choose **Same equipment — keep**. If you connected different equipment under the same name, choose **Different equipment — reset**. With several, **All same equipment — keep** at the top answers them all at once.

Until you confirm, baseline and band evidence is paused for that tag. Applying the old reference would mean missing anomalies when the new machine is quieter, and constant breaches when it is louder — while the screen just says "trained". Grading (fault pattern and ISO zone) keeps working throughout.

## Band learning doesn't fill the denominator (e.g. 4/9)

That is normal. In each tag row's `4/9 계열 학습됨` (4/9 series trained), the denominator is the number of series **measurable on that tag**, and it differs per tag. (The heading's `학습됨 X/Y` counts trained tags out of all tags.)

- The upper bands cover 1 kHz and above — with a low sample rate those bands are **not measurable in the first place**.
- Envelope series drop out when the sample rate or the mounting limit is low.
- The envelope fault-frequency series (BPFO·BPFI·BSF) accumulate **only when a bearing part number is set** — add one under Equipment and they start from then on.
- The tooltip next to the training status explains, per series, why it is missing.

Untrained series are left out of the evidence display, and the remaining series work normally.

## Not enough band samples to train

The extraction timer accumulates one band value per interval, so reaching a trainable amount takes time.

- **Backfill past data** computes retroactively from raw data already in the DB, giving you samples immediately.
- **Shortening the extraction interval** accumulates future samples faster.
- Extending the band learning window brings more samples into scope.

The current sample count and whether it is enough to train are shown next to the band learning window.

## I changed alarm settings but server monitoring still uses the old criteria

Both server monitoring and in-app judgment **run on the saved settings.** After changing settings, press **Save** for the new criteria to take effect; until then the monitoring screen also shows the previous criteria. Choosing **Discard and leave** when navigating away throws the edits away.

## Notifications don't arrive

1. In **Settings → Alarms → Notifications**, confirm the channel is on and a target (webhook URL) is entered.
2. Press **Send test** (테스트 발송) to verify the send path in isolation. A failure here is a URL or network problem.
3. In **per-severity delivery**, confirm that severity is set to **Immediate**. The default is **Immediate on all four rows** (Warning · Danger · Critical · Monitoring fault) — check whether someone changed one to No notification.
4. If delivery is **No notification**, the event is recorded but nothing is sent.
5. Webhook is the only delivery channel. For email or SMS, relay through an automation tool such as n8n — see [Alarms and events]({{< relref "alarms" >}}).
6. If it still does not arrive, check whether **an event was recorded at all**. No event means this is a judgment problem, not a delivery one — go to [No events are being recorded](#no-events-are-being-recorded) above. `observation` events never send an alert.
7. **If only signal-loss and instrumentation faults are missing**, check the **Monitoring fault** row in the severity table — it is a separate switch from the three grade rows.
8. If many points went dark but only **one** alert arrived, that is correct — five or more events of the same type and grade in one cycle are bundled. Every individual event is still in the event list.
9. If the screen shows "Server monitoring could not read the notification settings and did not send N events", use **Open notification settings** and save them again.

## Older events are missing from the event list

- The list shows only the most recent **200** events that match the filters. Narrowing by type or tag reaches further back.
- Events of tables deselected in the data source drop out of the list (they are not deleted).
- For full history, use **Save** (export) with a period and read the CSV or JSON — it includes events of deselected tables.

## "Unsafe file" warning when downloading an event file

This is the browser's generic warning for CSV/JSON downloads. Nothing is wrong with the file — keep the download and it saves normally.

## The diagnosis feels inaccurate

- Confirm you registered RPM and bearing model under **Equipment**. Without them there is no grade at all.
- Confirm the **unit** matches the sensor. Left empty it is treated as velocity (mm/s), so acceleration and displacement values are converted wrongly and the grade height goes off.
- Check whether **mounting** is specified. A magnet mount typically resonates at 2–5 kHz, overlapping the 1–5 kHz band the fault pattern is measured in. Specifying the mounting flags bands above its limit in per-band impulsiveness and band-energy evidence, but the fault pattern itself is computed in the fixed band — so **if a fault pattern appears on a magnet-mounted machine, check the sensor attachment first**.
- Check in **Criteria** that the zone boundaries suit your equipment. The grade height comes from the class rows in velocity (mm/s). The acceleration (`g`) and displacement (`μm`) rows are reference values for displaying sensors in those units.
- Learning the normal state adds a "versus normal" note to the evidence table (it does not change the grade).
- Diagnosis is computed from a single-channel, single-direction measurement with no phase information. Fault mechanisms are hypotheses; confirming them requires multi-axis and phase measurement.

If a fault candidate in the report is marked "not observable with this measurement", the stated reason names the information that was missing. Filling that field under **Equipment** brings the candidate back into scope.

## Baseline learning fails

The cause depends on the message.

- **"steady-state samples N (minimum 30 required)"** — too few samples remain after stopped and ramping intervals are excluded. Samples are counted in RMS-window units, so lengthen the learning window, shorten the RMS window in alarm settings, or retry once more data has accumulated.
- **"the learning window splits into stopped and running levels"** — most of the window is downtime. Learning it would make the stopped state the normal reference, so merely running the machine would show as a breach; learning is refused. Pick a period that is mostly continuous operation and retrain.

Even a successful run may report exclusions such as `excluded 12 (idle 8 · transient 4)` (`제외 12개(정지 8·과도 4)`). That is normal — it means the baseline was built from what remained after filtering.

## Two reports show different numbers

Compare the **judgment fingerprint** printed in each report.

- If the fingerprints **match**, the judgment engine was identical. If the reproducibility section's Thresholds also match, **the data changed**.
- If the fingerprints **differ**, the package (judgment engine) changed in between. Thresholds you changed show up in the Thresholds section, not in the fingerprint.

## LLM opinions aren't generated

- Confirm at least one provider is configured in **Settings → LLM**. Claude · OpenAI · Gemini need an API key; Ollama needs a URL.
- Use **Test connection** to verify the key or URL.
- Confirm a provider is selected in the provider dropdown on the detail-analysis or report screen.
- If you typed a model name, confirm that model actually exists for that provider. Leave it blank to use the default.
- LLM opinions are optional. Rule-based diagnosis and reports work normally without them.

## Navigation

- [Previous: What this tool does and does not do]({{< relref "scope" >}})
- [Back to contents]({{< relref "/" >}})
