---
title: Alarms and events
weight: 40
---

# Alarms and events

[한국어](./alarms.kr.md) | **English**

Alarms periodically evaluate the selected tags, record state changes as **events**, and notify the channel you configure. Settings live under **Settings → Alarm settings**.

Click the alarm indicator in the header to turn alarms on or off. The state is saved across sessions, and in server monitoring mode a mode badge appears next to it.

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

## Evaluation interval and window

The first item in alarm settings reads as one sentence:

> Evaluate the last **[RMS window]** of data every **[interval]**

| Setting | Options | Meaning |
| :--- | :--- | :--- |
| RMS window | 3s · 10s · 30s · 1m · 5m · 10m · 30m · 1h · custom | How much data one evaluation looks at |
| Interval | 1s · 3s · 5s · 10s · 30s · 1m | How often to evaluate |

- A **longer** window merges short fluctuations into one state — fewer false alarms, slower response.
- If the window is shorter than the interval, some data never enters any evaluation — that combination is blocked with a warning.
- For equipment with periodic load changes, use a window longer than the load cycle; otherwise load swings register as anomalies.
- With many tags and a short interval, a load warning appears.

This setting also governs **the current grade on monitoring cards**. The grade on screen and the grade the alarm judged always share one definition.

## Notifications

One place configures **when** to alarm (entry and recovery holds) and **where and how** to send (channel, per-severity delivery, re-notify).

### When to alarm — entry and recovery holds

These settings reduce noise from momentary spikes and from flapping across a boundary.

| Setting | Options | Meaning |
| :--- | :--- | :--- |
| Entry hold | Immediate · 30s · 1m · 2m · 5m | A **worsened** grade must persist this long before alarming |
| Recovery hold | Immediate · 1m · 5m · 10m | After returning to normal, it must hold this long before a recovery alarm |

If alarms arrive less often than expected, check the entry hold first; if too often, check the recovery hold.

### Where to send — the notification channel

There is one delivery channel: **webhook**. The message format is shaped from the URL to fit the target service, so the services below need nothing but the URL.

| Target | Message shape |
| :--- | :--- |
| Discord | A card with a severity color bar (Warning amber · Danger orange · Critical red · Recovery green) |
| Slack · Microsoft Teams · Google Chat | Three lines of text (title · value · time) |
| Your own endpoint (any other URL) | Everything: subject, plain-text body, HTML body, structured event data |

Enter the URL and press **Test** to send one real message and verify the connection.

> **A webhook URL is a password.** Anyone holding it can post to that channel. If it leaks, delete the webhook in the target service and create a new one — the old URL becomes invalid immediately.

If you need email or SMS, **relay the webhook through an automation tool**. Point the channel at the receiving URL of n8n, Node-RED, Zapier, or a Google Apps Script web app: the custom-endpoint payload carries an email subject (`subject`) and HTML body (`body`), so the receiver can turn it into mail or texts directly.

### Per-severity delivery

For each severity, choose whether to notify, and how often to re-notify while an abnormal state continues.

| Column | Options | Meaning |
| :--- | :--- | :--- |
| Delivery | Immediate · No notification | Whether events of this severity are sent |
| Re-notify while sustained | Off · 30m · 1h · 2h · 6h | How often to notify again while the abnormal state continues |

- The default sends **Danger and Critical immediately**, with Warning set to No notification.
- **No notification** still records the event — only the send is skipped. Re-notify events likewise always land in the history.
- **Recovery notifications** are sent if any of Warning · Danger · Critical is set to Immediate — if you were alarmed, you need to know it cleared.
- If the channel is on but every severity is set to No notification, a warning appears on screen.

## Webhook setup guides

### Discord

You need channel-management permission. We recommend a dedicated alarm channel (e.g. `#vibration-alarms`) — alarms mixed into a chat channel are hard to trace later.

1. Click **⚙️ Edit Channel** next to the channel
2. Open **Integrations** in the left menu
3. **Webhooks → New Webhook** — name and avatar are up to you (e.g. `Vibration Monitor`)
4. **Copy Webhook URL**

The URL looks like `https://discord.com/api/webhooks/…`. Paste it into the app's webhook field and confirm with Test.

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

- The rate limit is about **1 message per second** — the tightest of the three services.
- On the free plan, **messages older than 90 days are hidden.** Keep alarm history in the app's event list, not in Slack — events are never auto-deleted.
- For multiple channels, repeat **Add New Webhook to Workspace** to get a URL per channel. The app has a single webhook field, though, so per-severity channels are not supported.

## Band energy monitoring (optional)

To catch changes where overall vibration barely moves but one frequency band jumps — early bearing faults being the classic case — enable band energy monitoring. It lives under **Settings → Criteria → Band energy trend**.

The order of use:

1. Turn on **band extraction** and set the extraction interval (10m · 30m · 1h).
2. If samples are short, use **backfill past data** to compute retroactively from raw data already in the DB.
3. Once there are enough samples, run **Learn** to build the per-series normal reference.
4. When a trained series exceeds its limit, a **band breach** event is created.

Alongside the eight frequency bands, **envelope series** accumulate and are judged the same way: a periodicity measure, plus BPFO·BPFI·BSF fault-frequency series when a bearing part number is set. Per-channel status shows something like `trained 4/9`, where the denominator is the number of series **measurable on that tag** — low sample rates drop the upper bands and a missing bearing number drops the fault-frequency series. That is normal.

> Train **only when healthy operation is certain.** If a fault is already progressing, that fault becomes the normal reference.

## Events

Evaluation results accumulate as events in Neo and carry across app restarts and timer runs.

Events appear in the list at the bottom of the **Monitoring** tab. Period chips and the tag and type filters narrow the list, and clicking a row opens detail analysis at that moment.

For what each type means and the recording rules, see [How detection works](./detection.en.md).

- The list shows up to the most recent **200** events. For full history use **Save** (export) with a period and read the CSV or JSON.
- Events are never auto-deleted. To remove history of decommissioned equipment, use **Settings → Data management → Clean up by tag**.

## Checking that monitoring is alive

"No events" has two meanings — the equipment is fine, or monitoring is not running. The app distinguishes these and reports at the top of the screen.

| Message | Meaning | Action |
| :--- | :--- | :--- |
| Monitoring timer is not registered | Server monitoring not registered | **Re-register** button |
| Server monitoring is stopped | Timer is stopped (reason shown) | **Re-register** button |
| Last evaluation was N minutes ago | Timer runs but evaluation stalled | **Re-register** button |
| Zero evaluation targets | No new data on monitored tags | Check data ingestion |
| Band extraction is stopped | Band timer stopped | **Re-register** button |
| In-app evaluation stalled for N minutes | Browser deferred evaluation in app mode | Reopen or refresh the tab |

If the judged value flips between worse and better in quick succession, a **flapping notice** appears. That usually means the RMS window is shorter than the equipment's load cycle rather than a real fault — increase the window to at least the suggested value.

## Checklist

To verify alarms end to end, check in this order:

1. The header alarm indicator is **on**; in server mode, the badge is present.
2. No monitoring-status warnings at the top of the screen.
3. Events accumulate under **Monitoring → Events**; narrow with type and tag filters.
4. If notifications don't arrive, isolate the delivery path first with the channel **Test**.
5. If tests arrive but real alarms don't, check **per-severity delivery** and the **entry hold** (the state must persist that long to be confirmed).
6. If only certain tags are silent in server mode, check whether their table has ROLLUP.

## Navigation

- [Previous: Usage](./usage.en.md)
- [Back to index](./index.en.md)
- [Next: How detection works](./detection.en.md)
