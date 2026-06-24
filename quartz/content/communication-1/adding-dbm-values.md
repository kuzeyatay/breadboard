---
title: "Adding dBm Values"
date: "2026-04-26T07:24:06.018Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "997203-english"
source_file: "997203_English.pdf"
locations: ["Page 2"]
related: ["definition-and-use-of-dbm", "decibel-power-ratios"]
tags: ["dbm", "milliwatt", "linear-scale", "logarithmic-scale"]
source_images: ["/communication-1/assets/997203-english-page-002.png"]
---

## Adding dBm Values

Source: [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Locations: Page 2

The lecture gives a concrete procedure for adding powers expressed in dBm. The example is $0\,\mathrm{dBm}+0\,\mathrm{dBm}$. The correct method is not to add the logarithmic numbers directly. Instead, each $0\,\mathrm{dBm}$ is first converted to linear scale, giving $1\,\mathrm{mW}$ for each term. The two linear powers are then added to obtain $2\,\mathrm{mW}$. Because $2\,\mathrm{mW}$ is double $1\,\mathrm{mW}$, the increase relative to $0\,\mathrm{dBm}$ is $3\,\mathrm{dB}$, so the total power can also be expressed as $3\,\mathrm{dBm}$. The example also illustrates the difference between dB as a ratio and dBm as an absolute logarithmic power level.

### Source snapshots

![997203_English Page 2](/communication-1/assets/997203-english-page-002.png)

### Page-grounded details

#### Page 2

is actually multiple answer options. So it's not only one correct answer, but two
correct answers. Therefore the statistics is also giving another complete picture.
So you see here what happens if you calculate zero dBm plus zero dBm. What does it
accumulate to? And we have someone who is, yes, we have someone who would like to.
Yeah, and how did you calculate that? I just, I need to repeat it because otherwise
not everybody's hearing. So what you did is you took the zero dBm and converted it
to milliwatt. So you took into linear scale. So zero dBm is one milliwatt. And then
you add them. So you have two times this. So it's in total two milliwatts. So
that's one answer. Yes, exactly. So you have then either you see a media, oh, that
means I double. So it was before it was one milliwatt and I doubled it to two
milliwatts. So you can make the conclusion, oh, it doubled. So it's three dBm.
However, the doubling itself would be expressed in a ratio, so three dB. But you
can also just convert the milliwatt back to a logarithmic scale. And then you get
indeed a three dBm. Yeah, one thing we want to, that's why the question is showing.
You see that next to the answer here, there are squar

[Truncated for analysis]

### Key points

- Do not add dBm values directly in logarithmic scale.
- Convert each dBm value to milliwatts before adding powers.
- $0\,\mathrm{dBm}=1\,\mathrm{mW}$.
- $0\,\mathrm{dBm}+0\,\mathrm{dBm}$ corresponds to $1\,\mathrm{mW}+1\,\mathrm{mW}=2\,\mathrm{mW}$.
- The same result can be expressed as $3\,\mathrm{dBm}$.
- The doubling itself is a ratio and is expressed as $3\,\mathrm{dB}$.

### Related topics

- [[definition-and-use-of-dbm|dBm Reference Power]]
- [[decibel-power-ratios|Decibel Power Ratios]]

### Relationships

- depends-on: [[definition-and-use-of-dbm|dBm Reference Power]]
- applies-to: [[decibel-power-ratios|Decibel Power Ratios]]
