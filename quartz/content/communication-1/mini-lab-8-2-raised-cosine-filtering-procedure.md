---
title: "Mini-lab 8.2 raised-cosine filtering procedure"
date: "2026-04-25T10:25:58.869Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "communications-1-coursereader"
source_file: "Communications_1_CourseReader.pdf"
locations: ["Page 96"]
related: ["raised-cosine-nyquist-filtering", "inter-symbol-interference-from-bandwidth-limited-channels", "raised-cosine-pulses-versus-rectangular-pulses-in-a-bandlimited-channel"]
tags: ["raised-cosine-filter", "roll-off-factor", "isi", "channel-passband", "matlab", "lab-2"]
source_images: ["/communication-1/assets/communications-1-coursereader-page-096-2.png"]
---

## Mini-lab 8.2 raised-cosine filtering procedure

Source: [[communications-1-coursereader|Communications 1 Course Reader - Sampling, PAM, PCM, and Noise]]

Locations: Page 96

This mini-lab provides a procedural demonstration of how raised-cosine filtering mitigates ISI. Students first send the input data through the channel, overlay the transmitted signal, and plot the channel output. They then reduce the channel passband from 20000 Hz to 12000 Hz to make ISI visibly worse. After observing the distortion, they enable raised-cosine filtering in the mini-lab and re-upload the input so the filtered signal passes through the same channel. The rolloff factor is then varied, with filtering and plotting repeated after each adjustment. Students are asked to choose a suitable rolloff factor and compare filtered and unfiltered outputs to see how raised-cosine pulses reduce smearing into adjacent time slots. The durable procedure is to diagnose ISI by comparing transmitted and received waveforms under passband limitation, then tune the rolloff factor to trade off bandwidth against time-domain pulse compactness.

### Source snapshots

![Communications_1_CourseReader Page 96](/communication-1/assets/communications-1-coursereader-page-096-2.png)

### Page-grounded details

#### Page 96

Minilab exercise 8.2 - Raised-cosine filtering and ISI
This mini-lab exercise requires you to use Mini-lab 4 - ISI (Intersymbol interference)
When you open Minilab 4 you will be confronted with the following view:
In this minilab exercise, you will experiment with the concept of how raised-cosine
filtering prevents intersymbol interference.
- 1) Start by clicking 'Upload input' to send the data input. Tick 'Overlay
transmitted signal' and then click 'Plot channel output'
- 2) Now decrease the channel passband to 12000 Hz instead of 20000 Hz, and
then click again on 'Plot channel output' to see the effects of ISI. Can you
observe how the pulses are smearing into adjacent timeslots?
- 3) Now to demonstrate the raised-cosine filtering, under the filtering section,
click on raised cosine filtering, then click again on Upload input. Now you
may tune your filter's time response by changing the roll-off factor. For every
change, you should click 'filter' and then 'plot channel output' to observe the
effects.
- 4) Choose a suitable roll-off factor, and apply it to the signal, plot it, and
compare it to the unfiltered pulses, can you see how the raised cosine pulses
minimise ISI? [overlay,a

[Truncated for analysis]

### Key points

- The procedure begins by uploading input and plotting the channel output.
- Overlaying the transmitted signal helps compare sent and received waveforms.
- Reducing the channel passband to 12000 Hz makes ISI visible.
- Raised-cosine filtering is then enabled under the filtering section.
- The rolloff factor is adjusted and the signal is re-filtered and re-plotted.
- Students compare filtered and unfiltered pulses to evaluate ISI reduction.

### Related topics

- [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]
- [[inter-symbol-interference-from-bandwidth-limited-channels|Inter-symbol interference from bandwidth-limited channels]]
- [[raised-cosine-pulses-versus-rectangular-pulses-in-a-bandlimited-channel|Raised-cosine pulses versus rectangular pulses in a bandlimited channel]]

### Relationships

- example-of: [[raised-cosine-nyquist-filtering|Raised-cosine Nyquist filtering]]
