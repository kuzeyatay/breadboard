---
title: "Dimensionality Theorem Worked Example"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 32"]
related: ["dimensionality-theorem-for-band-limited-signals", "pulse-code-modulation-and-quantization-process", "bit-rate-and-spectral-efficiency-in-pcm"]
tags: ["dimensionality-theorem", "symbols", "bits-per-symbol", "bandwidth"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-032-2.png"]
---

## Dimensionality Theorem Worked Example

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 32

The worked example applies the dimensionality theorem to a signal with bandwidth $B = 64\text{ kHz}$ over a duration $T = 10\text{ s}$. Using the formula $N = 2BT$, the text computes the number of independent symbols required for exact reconstruction as $N = 2 \times 64\text{ kHz} \times 10\text{ s} = 1280\text{ kSymbols}$. This means that 1.28 million independent symbol values are needed to describe the signal over the full interval. The example then adds a simple information calculation: if each symbol carries 4 bits, the total information is $I = 1280\text{ kSymbols} \times 4\text{ bits/symbol} = 5120\text{ kBits}$. The pedagogical value is that it translates an abstract theorem into a count of reconstruction symbols and a total bit quantity. It also previews later sections where symbol representation and bits per symbol become central to digital transmission. The example reinforces that symbol count is set by bandwidth-time product, while total bit content additionally depends on how much information each symbol encodes.

### Source snapshots

![Communications_1_CourseReader Page 32](/communication-1/assets/communications-1-coursereader-page-032-2.png)

### Page-grounded details

#### Page 32

3.5 Dimensionality theorem
The dimensionality theorem describes the number of independent pieces of information,
which can describe a real waveform. That number N is mathematically described as




N = 2BT0 (45)
where B is the bandwidth of the waveform and T0 is the time span over which the signal is to
be described (sampled). Essentially, through the dimensionality theorem, we are connecting
the number of data points (pieces of information) to the sampling frequency and the time
interval of sampling. It tells us that we cannot get more information by adding more
points (oversampling) since then the information in these additional points is no longer
independent!
In other words, the information that can be conveyed by a band-limited waveform (with a
bandwidth B) or a band-limited communication system is proportional to the product of
the bandwidth of that signal/system and the time allowed for transmission of the informa-
tion.
Exercise 3: Dimensionality thorem
Consider a signal with a bandwidth of
B = 64 kHz,
and suppose we wish to reconstruct this signal over a duration of
T = 10 seconds.
Determine:
1. The number of symbols (independent pieces of information) required for rec

[Truncated for analysis]

### Key points

- Given $B = 64\text{ kHz}$ and $T = 10\text{ s}$, the theorem gives $N = 1280\text{ kSymbols}$.
- The formula used is $N = 2BT$.
- The result means 1280 thousand independent symbols represent the signal.
- If each symbol carries 4 bits, total information is $5120\text{ kBits}$.
- Symbol count comes from bandwidth and time; bit count additionally depends on bits per symbol.

### Related topics

- [[dimensionality-theorem-for-band-limited-signals|Dimensionality Theorem for Band-Limited Signals]]
- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation and Quantization Process]]
- [[bit-rate-and-spectral-efficiency-in-pcm|Bit Rate and Spectral Efficiency in PCM]]

### Relationships

- example-of: [[dimensionality-theorem-for-band-limited-signals|Dimensionality Theorem for Band-Limited Signals]]
