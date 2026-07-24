---
title: Troubleshooting
weight: 40
---

# Troubleshooting

[한국어](./troubleshooting.kr.md) | **English**

## No equipment cards at all

- If the app shows "no TAG table found in the DB", it connected to Neo but found no TAG table. Check the Neo connection and that a TAG table exists.
- If a table exists but there are no cards, you have not selected any tags yet in **Settings → Data Source**. Select the tags to monitor and save.

## A tag I just added doesn't appear in Data Source

- The Data Source list reflects the moment you entered it. If you added a tag afterward, reopen the settings screen to refresh the list.
- If the data-source change banner is showing at the top, your selection is stale. Update the selection and save.

## Presets (1 hour, 6 hours, …) are disabled

It means the tag's data is shorter than the preset's length.

- Clicking it shows a "not enough data" hint.
- Use the **All** preset to see the tag's full data range.
- As more data accumulates, presets turn back on automatically.

## Detail Analysis doesn't update live

This is expected. Detail Analysis is a **snapshot** frozen at the moment you enter. To see the latest state, leave and re-enter Detail Analysis, or switch tags to re-capture.

## Alarms are off after reopening the app

- Alarm state is persisted. If it is off after reopening, the window may have been closed before the setting was saved after you turned it on.
- Click the alarm indicator in the header to turn it back on.

## Events are not being recorded

- Check that **alarms are on**. Judgment runs only while alarms are enabled.
- The **app must be open**. Alarms watch while the app is open, not persistently in the background.
- **Good (normal) is not recorded as an event.** Only Warning and above are logged.

## "Unsafe file" warning when downloading an event file

This is a generic browser warning shown for CSV·JSON downloads. It is not a problem with the file itself — keep the download and it saves normally.

## Diagnosis feels inaccurate

- Check that RPM and bearing model are registered in **Equipment**. Without them, fault-frequency matching is limited.
- Verify the thresholds fit the equipment in **Criteria**, and adjust if needed.
- Learning the normal state adds a relative-reference judgment on top.

## LLM opinion is not generated

- Check that at least one provider is configured in **Settings → LLM**.
- Use **Connection test** to verify the API key or Ollama URL.
- Make sure the provider you want is selected in the Detail Analysis / Report provider dropdown.
- The LLM opinion is optional. Rule-based diagnosis and reports work without it.

## Navigation

- [Previous: Usage](./usage.en.md)
- [Back to contents](./index.en.md)
