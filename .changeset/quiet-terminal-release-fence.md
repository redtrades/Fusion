---
"@runfusion/fusion": patch
---

summary: Allow released tasks to pause again without spending an extra checkpoint slot.
category: fix
dev: Validate the held terminal checkpoint identity and retire only its terminal replay fence during atomic release.
