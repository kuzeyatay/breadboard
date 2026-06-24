---
title: "Decibel Power Ratios"
date: "2026-04-26T08:13:18.352Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_by: "chatmock"
related: ["decibels-in-communication-systems-1777190840499", "dbw-as-absolute-power-relative-to-1-watt", "working-with-decibels-for-power-gain-and-snr", "decibel-power-ratios", "common-mistake-confusing-db-with-dbm", "definition-and-use-of-dbm"]
tags: ["decibels", "dbm", "dbw", "power-ratio", "mathrm", "power", "frac-mathrm", "left-frac"]
---

## Decibel Power Ratios

A **decibel** expresses a logarithmic ratio, most commonly a power ratio. For power quantities:

$$
G_{\mathrm{dB}} = 10\log_{10}\left(\frac{P_{\mathrm{out}}}{P_{\mathrm{in}}}\right)
$$

Plain **dB** is not an absolute power; it is a relative gain or loss. A value of $10\,\mathrm{dB}$ means ten times the power. A value of $0\,\mathrm{dB}$ means equal powers, not zero power. A negative dB value means attenuation relative to the reference quantity.

Voltage ratios require a different coefficient when the resistance is the same, because power is proportional to voltage squared:

$$
P \propto V^2
$$

Thus:

$$
G_{\mathrm{dB}} = 20\log_{10}\left(\frac{V_{\mathrm{out}}}{V_{\mathrm{in}}}\right)
$$

A crucial distinction is between **dB**, **dBm**, and **dBW**. Plain dB is relative. **dBm** is absolute power relative to $1\,\mathrm{mW}$:

$$
P_{\mathrm{dBm}} = 10\log_{10}\left(\frac{P}{1\,\mathrm{mW}}\right)
$$

So $0\,\mathrm{dBm}=1\,\mathrm{mW}$. **dBW** is relative to $1\,\mathrm{W}$, and $1\,\mathrm{W}=30\,\mathrm{dBm}=0\,\mathrm{dBW}$. Confusing ratios with absolute references leads to serious errors in [[Digital Communication Chain]] calculations.

## Related notes

- [[decibels-in-communication-systems-1777190840499|Decibels in Communication Systems]]
- [[dbw-as-absolute-power-relative-to-1-watt|dBW as Absolute Power Relative to 1 Watt]]
- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
- [[decibel-power-ratios|Decibel Power Ratios]]
- [[common-mistake-confusing-db-with-dbm|Common Mistake: Confusing dB with dBm]]
- [[definition-and-use-of-dbm|Definition and Use of dBm]]
