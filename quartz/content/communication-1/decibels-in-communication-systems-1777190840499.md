---
title: "Decibels in Communication Systems"
date: "2026-04-26T08:07:20.499Z"
source: "generated-chat"
knowledge_type: "generated-note"
generated_by: "chatmock"
related: ["working-with-decibels-for-power-gain-and-snr", "digital-communication-chain-1777190840499", "common-mistake-confusing-db-with-dbm", "db-as-a-unitless-ratio", "definition-and-use-of-dbm", "adding-dbm-values"]
tags: ["decibels", "dbm", "power-ratio", "mathrm", "communication-systems", "frac-mathrm", "left-frac", "log-left"]
---

## Decibels in Communication Systems

A **decibel** expresses a logarithmic ratio, usually between two powers. Communication systems use decibels because transmitted and received powers can differ by many orders of magnitude, and logarithms turn multiplication into addition.

For a power ratio:

$$
G_{\mathrm{dB}} = 10\log_{10}\left(\frac{P_{\mathrm{out}}}{P_{\mathrm{in}}}\right)
$$

Plain **dB** is relative, not absolute. A gain of $10\,\mathrm{dB}$ means the output power is ten times the input power. A gain of $3\,\mathrm{dB}$ is approximately a doubling of power, because $10\log_{10}(2)\approx3$.

Voltage ratios use a different coefficient when the resistance is the same, because power is proportional to voltage squared:

$$
P \propto V^2
$$

so

$$
G_{\mathrm{dB}} = 20\log_{10}\left(\frac{V_{\mathrm{out}}}{V_{\mathrm{in}}}\right)
$$

A major distinction is between **dB** and **dBm**. While dB is a ratio, dBm is an absolute power level relative to $1\,\mathrm{mW}$:

$$
P_{\mathrm{dBm}} = 10\log_{10}\left(\frac{P}{1\,\mathrm{mW}}\right)
$$

Thus $0\,\mathrm{dBm}=1\,\mathrm{mW}$. Confusing ratios with absolute references leads to serious errors in [[Digital Communication Chain]] calculations.

## Related notes

- [[working-with-decibels-for-power-gain-and-snr|Working with Decibels for Power, Gain, and SNR]]
- [[digital-communication-chain-1777190840499|Digital Communication Chain]]
- [[common-mistake-confusing-db-with-dbm|Common Mistake: Confusing dB with dBm]]
- [[db-as-a-unitless-ratio|dB as a Unitless Ratio]]
- [[definition-and-use-of-dbm|Definition and Use of dBm]]
- [[adding-dbm-values|Adding dBm Values]]
