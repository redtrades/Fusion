---
"@runfusion/fusion": patch
---

summary: Keep workflow terminal dispositions paused so restart and heartbeat recovery cannot redispatch them.
category: fix
dev: Atomically persists native pause and existing reason with the fenced overlay terminal receipt; release remains separate.
