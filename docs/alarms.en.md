---
title: Alarms and events
weight: 40
---

# Alarms and events

[한국어](./alarms.kr.md) | **English**

Alarms periodically evaluate the selected tags, record state changes as **events**, and notify the channel you configure. Settings live under **Settings → Alarms**.

Click the alarm indicator in the header to turn alarms on or off. The click saves that one value immediately, so it persists across sessions — unsaved edits on the Settings tab are not saved along with it. While alarms are on, a monitoring-mode badge (**서버 상시** server / **앱** in-app / **앱 · 보기 전용** in-app, view only) appears next to it. When off, cards still show grades, but events are no longer recorded or sent (the server monitoring timer is removed too).

> For how grades and events are computed, see [How detection works](./detection.en.md). This document covers configuration and operation.

## Monitoring mode

First choose **who** performs the evaluation.

| Mode | Evaluator | When the app is closed |
| :--- | :--- | :--- |
| In-app (default) | The app open in your browser | Evaluation stops |
| Server monitoring | A Neo timer | Keeps evaluating and recording events |

### In-app monitoring

While the app is open, the selected tags are evaluated at every interval. It works with no extra setup, but nothing is evaluated while the window is closed.

If you don't need around-the-clock coverage, or you are still tuning settings, this is the convenient mode.

### Server monitoring

**Saving** registers the current evaluation settings as a Neo timer, so evaluation continues after you close the app. In this mode the app screen only **displays** results; the server does the judging.

Both modes share the same rules, so switching modes yields the same results on the same data.

Things to know:

- **Changed settings take effect only after saving again.** The timer runs with the settings as of the last save.
- **Only tables with ROLLUP are evaluated.** Tags in tables without rollups are silently excluded from server monitoring; check those with in-app monitoring.
- **Turning server mode off deletes the timer.** Removing the package also cleans it up.
- **No timer is created when there are no tags to monitor.**
- If the timer stops by itself, the app **re-registers it automatically** while it is open (up to three times). A notice then reminds you that the gap was not actually confirmed as "no anomaly".

### Opening the app in several tabs or PCs with the same account

However many places the same account opens the app, only **one of them (the lead)** evaluates and sends notifications. The others only display results, so notifications are never duplicated.

- **In-app monitoring** — only the lead tab evaluates and notifies. In the other tabs the header badge changes to **앱 · 보기 전용** (view only), and events recorded by the lead show up through the list's 30-second refresh. When the lead tab is closed, a remaining tab takes over within a minute.
- **Server monitoring** — the server does the evaluation, so nothing changes. Only background chores such as re-registering the timer and automatic recovery are left to the lead tab.
- **Settings and learning work from any tab.** After a save, the other tabs pick up the new settings within 10 seconds. If a tab was in the middle of editing settings, its edits are kept and a "settings were saved elsewhere" warning appears — saving those edits overwrites the change that was just saved.

### When the login switches to another account

If the Neo console login in the same browser switches to a different account, any app page already open belongs to the old account, so it **stops all saving, evaluation and queries** and shows a full-screen "logged in as another account" (다른 계정으로 로그인되었습니다) notice.

- Click **새로고침** (Reload) to reopen the app as the new account. It never reloads by itself.
- Logging back in as the original account dismisses the notice and the page carries on.
- The old account's server monitoring runs as a Neo timer and continues unaffected. With in-app monitoring, that tab's evaluation stops; if another PC has the app open as the old account, that page takes over.

## Evaluation interval and window

> **First, know this — monitoring runs on two cadences.**
>
> | | What it does | Interval | Where to set it |
> | :--- | :--- | :--- | :--- |
> | Fast axis | running/stopped · signal lost · instrumentation faults · versus normal (baseline) | the **evaluation interval** (default 3 s) | Alarms (below) |
> | Slow axis | **fault pattern — grades and grade events come from here** | the **extraction interval** (default 10 min) | the **extraction interval** under Criteria → Band energy trend, or **Change interval** on the notification card below |
>
> The settings below configure the **fast axis**. Grades actually change on the slow axis, so
> shortening the evaluation interval to 1 second does not make alarms arrive sooner.
> See [How detection works](./detection.en.md) for the full picture.

The first item in alarm settings reads as one sentence:

> Evaluate the last **[RMS window]** of data every **[interval]**

| Setting | Options | Meaning |
| :--- | :--- | :--- |
| RMS window | 3s · 10s · 30s · 1m · 5m · 10m · 30m · 1h · custom (minutes) | How much data one evaluation looks at (default 10 s) |
| Interval | 1s · 3s · 5s · 10s · 30s · 1m | How often to evaluate (default 3 s) |

- A **longer** window merges short fluctuations into one state — fewer false alarms, slower response.
- If the window is shorter than the interval, some data never enters any evaluation — that combination is blocked with a warning.
- For equipment with periodic load changes, use a window longer than the load cycle; otherwise load swings register as stops or breaches.
- With many tags and a short interval, a load warning appears.

This setting also defines the card's running state (stopped, signal lost, instrumentation fault) and the versus-normal evidence. **The grade does not come from this value — the fault pattern and ISO zone set it at every extraction interval.**

## Notifications

One place configures **when** to alarm (the confirmation rule) and **where and how** to send (channel, per-severity delivery, re-notify, bundling).

### When to alarm — two consecutive cycles

**This is a fixed rule, not a setting.** A grade is confirmed only when the same judgment holds for two consecutive cycles, and the alarm goes out then. Going up and coming down alike.

```
cycle 1   Warning   observation event · no alert
cycle 2   Warning   threshold · alert sent
cycle 3   Good      (not recovered yet)
cycle 4   Good      recovered · alert sent
```

The cycle interval follows the **extraction interval** (10 minutes by default). Set that to 30 minutes and confirmation takes 60. The cycle table at the top of the notification card shows when alerts go out with the current settings, and its **Change interval** button changes it directly.

Monitoring-health events are judged on the fast axis by time (not configurable).

| Event | Condition |
| :--- | :--- |
| Instrumentation fault | Confirmed after the anomaly persists for **1 minute** — so a single spike does not send "sensor failure" |
| Instrumentation restored | After **5 minutes** of normal signal |
| Signal lost | No new data for 6 × the evaluation interval (at least 1 minute). When data returns, evaluation simply resumes; there is no separate recovery event |

### Where to send — the notification channel

There is one delivery channel: **webhook**. The message format is shaped from the URL to fit the target service, so the services below need nothing but the URL.

| Target | Recognized URL | Message shape |
| :--- | :--- | :--- |
| Discord | `discord.com/api/webhooks/…` | A card with a severity color bar (Warning amber · Danger orange · Critical red · otherwise green) |
| Slack | `hooks.slack.com/…` | Three lines of text (title · value · time) |
| Microsoft Teams | `…webhook.office.com/…`, `…office.com/webhookb2/…`, `…logic.azure.com/…` | Three lines of text |
| Google Chat | `chat.googleapis.com/…` | Three lines of text |
| Your own endpoint (any other URL) | — | Everything: subject, plain-text body, HTML body, structured event data |

Enter the URL and press **Send test** (테스트 발송) to send one real message and verify the connection.

> **A webhook URL is a password.** Anyone holding it can post to that channel. If it leaks, delete the webhook in the target service and create a new one — the old URL becomes invalid immediately.

If you need email or SMS, **relay the webhook through an automation tool**. Point the channel at the receiving URL of n8n, Node-RED, Zapier, or a Google Apps Script web app: the custom-endpoint payload carries an email subject (`subject`) and HTML body (`body`), so the receiver can turn it into mail or texts directly.

### Per-severity delivery

For each severity, choose whether to notify, and how often to re-notify while an abnormal state continues.

| Column | Options | Meaning |
| :--- | :--- | :--- |
| Delivery | Immediate · No notification | Whether events of this severity are sent |
| Re-notify while sustained | Off · 30m · 1h · 2h · 6h | How often to notify again while the abnormal state continues |

Below the three grade rows there is one more: **Monitoring fault** (감시 이상).

| Row | What | Delivery default | Re-notify default |
| :--- | :--- | :--- | :--- |
| Warning (주의) | A fault pattern was matched (amplitude still low) | Immediate | 2h |
| Danger (위험) | Fault pattern + ISO danger zone | Immediate | 1h |
| Critical (심각) | Fault pattern + ISO critical zone | Immediate | 30m |
| **Monitoring fault** | signal lost · instrumentation fault · instrumentation restored | Immediate | none (`—`) |

**The default is Immediate on all four rows.**

- **Warning is on by default too.** In this app, Warning means "a fault pattern was matched", so turning it off buries most of what this tool detects in the list with no alert.
- **Re-notification is on by default.** Silence after confirmation leaves "was that just a blip?" unanswered. A healthy machine rarely confirms at all, so re-notification adds almost nothing there; it only accumulates while a real fault persists.
- **A monitoring fault is not a machine grade** — it answers "can this value be trusted", not "how bad is this machine". That is why it has its own switch: a monitor gone blind with nobody told is the worst failure mode.
- The monitoring-fault row has no re-notify. While the state persists **no further events are produced**, so there is nothing to re-alert.
- **No notification** still records the event — only the send is skipped. Re-notify events likewise always land in the history.
- **Recovery notifications** are sent if any of Warning · Danger · Critical is set to Immediate — if you were alarmed, you need to know it cleared.
- If the channel is on but all **three grade rows** (Warning · Danger · Critical) are set to No notification, a warning appears on screen (the monitoring-fault row is not counted).

### When many fire at once — bundled delivery

If **five or more events of the same type and grade** occur in one judgment cycle, they are **sent as a single message**.

```
[주의] 신호 두절 91대
PUMP_A 38 · FAN_B 25 · LINE_3 16 · 외 12
6분 무수신
```

When collection stops, every tag reports signal loss in the same cycle. Sent one by one they exceed the channel rate limit (Slack 1/s, Discord 5 per 2 s) and **only an arbitrary subset arrives** — "91 lost" arriving as "8 random lost" is worse than nothing, because the rest look healthy.

Four or fewer are sent individually — for two or three machines the tag, value and reference are more useful.

**History is always stored per event.** Bundling is a delivery format only; the event list and CSV export are unchanged.

## Webhook setup guides

### Discord

You need channel-management permission. We recommend a dedicated alarm channel (e.g. `#vibration-alarms`) — alarms mixed into a chat channel are hard to trace later.

1. Click **⚙️ Edit Channel** next to the channel
2. Open **Integrations** in the left menu
3. **Webhooks → New Webhook** — name and avatar are up to you (e.g. `Vibration Monitor`)
4. **Copy Webhook URL**

The URL looks like `https://discord.com/api/webhooks/…`. Paste it into the app's webhook field and confirm with Send test.

Notifications arrive as cards with a severity color bar. The rate limit is about 5 requests per 2 seconds per webhook — normal operation never gets close.

### Google Chat (Spaces)

**Workspace (company/organization) accounts only** — personal `@gmail.com` accounts have no webhook menu. Webhooks attach to Spaces only (not DMs).

1. [chat.google.com](https://chat.google.com) → **Spaces → + Create a space** (e.g. `vibration-alarms`)
2. Click the space name → **Apps & integrations**
3. **Webhooks → Add webhook** — enter a name (e.g. `Vibration Monitor`), avatar URL optional → **Save**
4. **Copy the URL**

The URL looks like `https://chat.googleapis.com/v1/spaces/…`. The rate limit is 60 messages per minute per space.

If the webhook menu is missing, you are on a personal account or your Workspace admin has disabled webhooks (needs enabling under Admin console → Chat settings).

### Slack

In Slack, webhooks live inside an "app", so you create one first. It takes about five minutes.

**1) Create the app — [api.slack.com/apps](https://api.slack.com/apps)**

1. Sign in with your workspace account → **Create New App**
2. Choose **From scratch**
3. Enter an app name (e.g. `Vibration Monitor`) → pick the **workspace** → **Create App**

**2) Enable Incoming Webhooks**

From here you work **inside the app's settings page**. [api.slack.com/apps](https://api.slack.com/apps) itself is the app list and has no such menu — click your app's name to enter it.

1. Left sidebar: **Features → Incoming Webhooks** (if you can't find it, open the "Add features and functionality" accordion on **Basic Information** — the Incoming Webhooks card leads to the same page)
2. Flip the toggle **On**
3. Click **Add New Webhook to Workspace** at the bottom
4. Pick the **channel** to receive alarms (e.g. `#vibration-alarms`) → **Allow**
5. **Copy the Webhook URL**

The URL looks like `https://hooks.slack.com/services/T…/B…/…`.

**Shortcut** — to skip creating an app: in the Slack client, workspace name → **Tools & settings → Manage apps** → search **"Incoming WebHooks"** → **Add to Slack** → pick a channel. Slack labels it legacy, but it behaves the same.

Things to know:

- The rate limit is about **1 message per second** — the tightest of the services in this guide.
- On the free plan, **messages older than 90 days are hidden.** Keep alarm history in the app's event list, not in Slack — events are never auto-deleted.
- For multiple channels, repeat **Add New Webhook to Workspace** to get a URL per channel. The app has a single webhook field, though, so per-severity channels are not supported.

### Microsoft Teams

Create a webhook URL in a Teams channel and paste it into the app's webhook field. The app recognizes these address forms as Teams and sends a text message:

- `https://….webhook.office.com/…` or `…office.com/webhookb2/…` (a channel's Incoming Webhook connector)
- `https://….logic.azure.com/…` (a webhook trigger from Teams Workflows / Power Automate)

Which menu creates a webhook in Teams, and whether it is allowed at all, depends on your organization's Teams policy. If you cannot find it, ask your Teams administrator. After entering the URL, always confirm actual delivery with **Send test** — depending on how the workflow is set up, it may not accept plain text messages.

## Band energy evidence (optional)

To see, as evidence, changes where overall vibration barely moves but one frequency band jumps — early bearing faults being the classic case — turn band extraction on. It lives under **Settings → Criteria → Band energy trend**.

The order of use:

1. Turn on the **band & fault-pattern extraction** switch and set the extraction interval (10m · 30m · 1h).
2. If samples are short, use **backfill past data** to compute retroactively from raw data already in the DB.
3. Once there are enough samples, run **Learn** to build the per-series normal reference.
4. When a trained series exceeds its limit, it is shown on the card (hover the number) and in the evidence table as a **multiple of the limit**.

> **Bands do not raise alerts.** The structure fires when any one of many series exceeds its limit, so false positives are common, and its time axis differs from the grade's.
> Band values are used as **evidence for narrowing down which band moved**, not as alerts.
> Baseline breaches are silent for the same reason — displayed only.

Alongside the eight frequency bands, **envelope series** accumulate and are learned the same way: a periodicity measure, plus BPFO·BPFI·BSF fault-frequency series when a bearing part number is set. In each tag row's `4/9 계열 학습됨` (4/9 series trained), the denominator is the number of series **measurable on that tag** — a low sample rate or mounting limit drops the upper bands, and a missing bearing number drops the fault-frequency series. That is normal. See [First setup › Band & fault-pattern extraction](./first-setup.en.md#band--fault-pattern-extraction) for the setup.

> Train **only when healthy operation is certain.** If a fault is already progressing, that fault becomes the normal reference.

## Events

Evaluation results accumulate as events in Neo and carry across app restarts and timer runs.

Events appear in the list at the bottom of the **Monitoring** tab. Period chips and the tag and type filters narrow the list, and clicking a row opens detail analysis at that moment. What each column shows is in [Usage › Event list](./usage.en.md#event-list); what each type means and the recording rules are in [How detection works › Events](./detection.en.md#events).

- The list is re-read every 30 seconds, so events recorded by server monitoring appear without a page reload.
- The list and its count cover **only the tags currently monitored**. Events of tables deselected in the data source drop out of the list but are not deleted.
- The tag and type filters are query conditions — the list shows the most recent **200** matching events, and the count is every matching event. The header's **recent event** cell ignores the filters.
- For full history use **Save** (export) with a period and read the CSV or JSON. It includes events of deselected tables.
- Events are never auto-deleted. To remove history of decommissioned equipment, use **Settings → Data management → Clean up by tag**.

## Checking that monitoring is alive

"No events" has two meanings — the equipment is fine, or monitoring is not running. The app distinguishes these and reports at the top of the Monitoring screen. The messages appear in Korean; the English below is a translation.

**Server monitoring**

| Message | Meaning | Action |
| :--- | :--- | :--- |
| Server monitoring timer is not registered | Server monitoring not registered | **Re-register** button |
| Server monitoring is stopped | Timer is stopped (reason shown) | **Re-register** button (re-registered automatically up to three times while the app is open) |
| Last evaluation was N minutes ago | Timer runs but evaluation stalled | **Re-register** button |
| Server monitoring stopped N ago and recovered automatically | Revived by automatic re-registration. "No anomaly" during the gap was not actually confirmed | If needed, check that period in detail analysis |
| … did not recover after N automatic attempts | It keeps stopping after re-registration | Check the reason shown |
| Cannot check the monitoring timer state | The Neo timer list could not be read | Check the Neo connection |
| Zero evaluation targets | No new data on monitored tags | Check data ingestion |
| Scanned N machines but measured the fault pattern on none | The grade-forming axis is empty, so no alarm can fire — missing speed or bearing, or too few samples in the window | **Open Equipment** → enter RPM and bearing |
| One server monitoring cycle takes N seconds | The cycle is close to or over the interval, so some cycles are skipped | **Open settings** → lengthen the interval or monitor fewer tags |
| Server monitoring could not read the notification settings and did not send N events | At send time the timer could not read the account's notification settings. The events are still recorded | **Open notification settings** → save them again |
| Skipped a cycle because the previous judgment state could not be read | Judging without the previous state would repeat alerts, so that cycle is not judged | Check the DB connection. The next cycle retries automatically |
| N tags failed | Only those tags could not be judged or saved (the rest were processed). The reason is shown | Check the reason. The next cycle retries automatically |
| The cycle ended with an error | The whole cycle ended in an error. The reason is shown | Check the reason. If it persists, **Re-register** |

**Band extraction**

| Message | Meaning | Action |
| :--- | :--- | :--- |
| Band extraction timer is not registered / Band extraction is stopped | The band timer is missing or stopped | **Re-register** button |
| Band extraction has not finished a cycle for N | The band timer is running but its cycle record has stalled for over 3× the extraction interval (30 min minimum) | Re-registered automatically. If it persists, check the reason |
| Band extraction is on but no tag qualifies, so it does not run | No tag has RPM (and sample-rate information). The reason is shown | Enter RPM under Equipment |

**App-wide**

| Message | Meaning | Action |
| :--- | :--- | :--- |
| In-app evaluation stalled for N | Browser deferred evaluation in app mode (a background tab, for example) | Reopen or refresh the tab |
| M of N machines cannot measure the fault pattern, so no grade forms | Some tags have no RPM or bearing type | Fill in Equipment |
| N tags hit the display limit (60 per table · 100 overall) … | Tags beyond the limit are left out of monitoring | Narrow the data source |
| Could not reload data | A table query failed while re-reading data (after a settings save, for example). Monitoring continues on the last loaded data and retries automatically (from 10 s, backing off to 5 min). Newly selected tables are not monitored until a retry succeeds | Usually clears on its own. **Retry now** button. If it keeps failing, check whether the table was dropped or permission was revoked, and deselect it in settings if needed |

If a grade keeps worsening at short intervals (three or more threshold events in the last two hours), the card shows a **Repeated N×** badge. The fault evidence is hovering around the adoption line — load variation can cause it, and so can an early-stage fault. Clicking the badge opens detail analysis at the most recent worsening — check the fault evidence and envelope spectrum instead of hiding it with settings.

## Checklist

To verify alarms end to end, check in this order:

1. The header alarm indicator is **on**; in server mode, the badge is present.
2. No monitoring-status warnings at the top of the screen.
3. Events accumulate under **Monitoring → Events**; narrow with type and tag filters.
4. If notifications don't arrive, isolate the delivery path first with the channel **Send test**.
5. If tests arrive but real alarms don't, check **per-severity delivery**. Also note that a grade needs **two consecutive cycles** to confirm — a single-cycle hit is recorded as `observation` only, with no alert.
6. If only certain tags are silent in server mode, check whether their table has ROLLUP.
7. If vibration is clearly high but no alarm fires at all, check that the **shaft speed and bearing part number** are filled in — without either, the fault pattern cannot be computed, the grade never rises, and the card reads **On hold** (cannot judge).

## Navigation

- [Previous: Usage](./usage.en.md)
- [Back to contents](./index.en.md)
- [Next: How detection works](./detection.en.md)
