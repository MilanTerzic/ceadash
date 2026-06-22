# ceadash

Initial bootstrap of the CEA dashboard repository.

This repo now contains the current Flask dashboard improvement work, including:

- a plain-Python dashboard launcher
- the improved Flask dashboard view logic
- dashboard requirements and offline config
- a Windows launcher script

Recent dashboard improvements included here:

- working daily/monthly granularity behavior
- view-aware chart and table titles
- refresh returning to the dashboard instead of a plain text page
- visible cache build timestamp in the UI

Important note:

This repository started empty. I initialized it with the dashboard core files first so `main` is no longer blank. The larger project assets and remaining modules can be imported next in follow-up commits.
