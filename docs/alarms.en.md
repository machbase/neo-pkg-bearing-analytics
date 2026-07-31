---
title: Alarms & events
weight: 40
---

# Alarms & events

[한국어](./alarms.kr.md) | **English**

Alarms periodically evaluate the selected tags, record state changes as **events**, and notify the channels you configure. Settings live under **Settings → Alarms**.

Click the alarm indicator in the header to turn alarms on or off. The state is saved and survives reopening the app; in server monitoring mode the indicator also carries a mode badge.

> How grades and events are actually computed is covered in [How detection works](./detection.en.md). This document covers configuration and operation.

## Monitoring mode

First choose **who** performs the evaluation.

| Mode | Evaluated by | When the app is closed |
| :--- | :--- | :--- |
| App monitoring (default) | The app open in your browser | Evaluation stops |
| Server monitoring | A Neo timer | Keeps evaluating and recording events |

### App monitoring

While the app is open, it evaluates the selected tags on every evaluation interval. It works immediately with no extra setup, but closing the window means no evaluation happens in the meantime.

This is the convenient choice when you don't need round-the-clock monitoring, or while you are still trying out settings.

### Server monitoring

**Saving** registers the current evaluation settings as a Neo timer, so evaluation continues with the app closed. In this mode the app screen only **displays** results; the server does the evaluating.

Both modes use identical evaluation rules, so switching modes produces the same results from the same data.

Worth knowing:

- **Changing settings requires saving again.** The timer runs with the settings as of the last save.
- **Only tables with a ROLLUP are evaluated.** Tags on tables without one are silently excluded from server monitoring — check those with app monitoring.
- **Turning server mode off deletes the timer.** It is also cleaned up when the package is uninstalled.
- **If no tags are being monitored, no timer is created.**

## Interval and window

The first setting reads as a sentence.

> Evaluate the preceding **[RMS window]** of data every **[evaluation interval]**

| Setting | Options | Meaning |
| :--- | :--- | :--- |
| RMS window | 3s · 10s · 30s · 1m · 5m · 10m · 30m · 1h · custom | How much data one evaluation looks at |
| Evaluation interval | 1s · 3s · 5s · 10s · 30s · 1m | How often to evaluate |

- A **longer** window merges short excursions into one state — fewer false alarms, slower response.
- If the window is shorter than the interval, data in between never reaches evaluation — that combination is blocked and a warning is shown.
- On equipment whose load varies cyclically, pick a window longer than that cycle. Too short and load variation registers as an anomaly.
- With many tags and a short interval, a load warning appears.

This setting also governs **the current grade on monitoring cards**. The grade on screen and the grade the alarm judged always share one definition.

## Alarm behavior

These settings reduce noise from momentary spikes and from flapping across a boundary.

| Setting | Options | Meaning |
| :--- | :--- | :--- |
| Entry hold | Immediate · 30s · 1m · 2m · 5m | A **worsened** grade must persist this long before alarming |
| Recovery hold | Immediate · 1m · 5m · 10m | After returning to normal, it must hold this long before a recovery alarm |
| Sustained re-notify | Off · 30m · 1h · 2h · 6h | How often to re-notify while an abnormal state continues (per severity) |

With sustained re-notify **Off**, notifications only fire on state changes.

If alarms arrive less often than expected, check the entry hold first; if too often, check the recovery hold and re-notify interval.

## Band energy monitoring (optional)

To catch changes where overall vibration barely moves but one frequency band jumps — early bearing faults being the classic case — enable band energy monitoring. It lives under **Settings → Criteria → Band energy trend**.

The order of use:

1. Turn on **band extraction** and set the extraction interval. A shorter interval accumulates samples faster.
2. If samples are short, use **backfill past data** to compute retroactively from raw data already in the DB.
3. Once there are enough samples, run **Learn** to build the per-band normal reference.
4. When a trained band exceeds its limit, a **band breach** event is created.

Per-channel status shows something like `trained 4/5`. Lower sample-rate sensors cannot measure the upper bands, so filling all five is not always possible — that is normal.

> Train **only when healthy operation is certain.** If a fault is already progressing, that fault becomes the normal reference.

## Events

Evaluation results accumulate as events in Neo and carry across app restarts and timer runs.

Events appear in the list at the bottom of the **Monitoring** tab. Period chips and the tag and type filters narrow the list, and clicking a row opens detail analysis at that moment.

For what each type means and the recording rules, see [How detection works](./detection.en.md).

- The list shows up to the most recent **200** events. For full history use **Save** (export) with a period and read the CSV or JSON.
- Events are never auto-deleted.

## Notifications

Configure which channels to notify and the per-severity policy for sending.

### Channels

| Channel | Status | Target |
| :--- | :--- | :--- |
| Webhook | Available | Slack · Teams · Discord · your own endpoint URL |
| Email | In preparation | Via internal SMTP relay |
| SMS | In preparation | Via provider API |

Enter a webhook URL and press **Test** to send one real message and verify the connection. The message format is shaped from the URL to fit the target service, so Slack, Teams, and Discord need nothing but the URL. Custom endpoints also receive a subject, body, and structured event data.

### Per-severity routing

For each severity, choose which channels receive it and how it is delivered (Immediate · Ignore).

- The default sends **Danger and Critical only**, with Warning off.
- Setting delivery to **Ignore** still records the event but sends no notification.
- **Recovery notifications** are sent if any of Warning · Danger · Critical is routed to that channel — if you were alarmed, you need to know it cleared.
- If a channel is on but no severity is routed to it, a warning appears on screen.

## Checking that monitoring is alive

"No events" has two meanings — the equipment is fine, or monitoring is not running. The app distinguishes these and reports at the top of the screen.

| Message | Meaning | Action |
| :--- | :--- | :--- |
| Monitoring timer is not registered | Server monitoring was never registered | **Re-register** button |
| Server monitoring is stopped | The timer is in a stopped state (reason shown) | **Re-register** button |
| Last evaluation was N minutes ago | The timer runs but evaluation has stalled | **Re-register** button |
| Zero tags evaluated | No new data on the monitored tags | Check data collection |
| Band extraction is stopped | The band monitoring timer stopped | **Re-register** button |
| App evaluation has been stalled for N minutes | The browser is throttling evaluation in app mode | Reopen the tab or refresh |

If the evaluated value repeatedly worsens and improves at short intervals, a **flapping notice** appears. That points less to an equipment problem than to an RMS window shorter than the machine's load-variation cycle — extend the window to at least the value shown in the notice.

## Verification order

To check that alarms behave as intended, work through this order.

1. Is the header alarm indicator **on**, and in server mode does it carry the badge?
2. Are there any monitoring-status warnings at the top of the screen?
3. Are results accumulating in **Monitoring → Events**? Narrow with the type and tag filters.
4. If notifications don't arrive, use the channel **Test** to isolate the send path first.
5. If only certain tags are quiet in server mode, check whether their table has a ROLLUP.

## Navigation

- [Previous: Usage](./usage.en.md)
- [Back to contents](./index.en.md)
- [Next: How detection works](./detection.en.md)
