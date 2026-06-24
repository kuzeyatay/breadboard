---
title: "Sampling as the First Step of Digitization"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 5", "Page 6"]
related: ["digital-communication-as-analog-to-digital-to-analog-transfer", "quantization-and-binary-representation-of-samples", "communication-system-block-flow"]
tags: ["sampling", "nyquist-criteria", "time-domain", "continuous-in-time", "discrete"]
source_images: ["/communication-1/assets/988929-english-3-page-005.png", "/communication-1/assets/988929-english-3-page-006.png"]
---

## Sampling as the First Step of Digitization

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 5, Page 6

Sampling is introduced as the first necessary operation when converting a continuous-time analog waveform into a form that can eventually be digitized. Because an analog waveform is continuous in time, the system must choose moments in time to capture rather than attempting to send the whole waveform directly. The lecture stresses that sampling is not arbitrary and references the Nyquist criterion from earlier signals-and-systems study. In the drawn example, equally spaced time samples are taken from a waveform, producing discrete-time points. However, the lecture carefully distinguishes this result from being digital: sampled values are discrete in time, but their amplitudes can still be analog-valued quantities such as 1.3 V or 1.25 V.

### Source snapshots

![988929_English-3 Page 5](/communication-1/assets/988929-english-3-page-005.png)

![988929_English-3 Page 6](/communication-1/assets/988929-english-3-page-006.png)

### Page-grounded details

#### Page 5

might propose an exam question from last year Just one small hint already So even
after two lectures you will be already able to solve an exam question. So that's
that's how that goes And we we try to keep you engaged in the instant But if you
have the impression that this is not working for you also, let us know so we are
quite adaptive to Feedback. Yeah, and because we have two teachers what we have
decided to do is that if I will give the main lecture Then mark will start every
session we meet by doing a recap of the previous lecture and He can use whatever he
learned from your online quiz at home or we will do it interactively doesn't matter
But he will also just go to the main points that we discussed last time So you'll
have a refresher at the beginning so you're not landing from nowhere So if you miss
something and you can ask questions The intention of this recap is not to quickly
run for everything so we can move forward We feel that we have enough time in the
way this course is organized in the number of hours We have available to teach that
we can take our time. We're not rushing through anything If you want us if you have
questions, please ask them. We encourage you to

[Truncated for analysis]

#### Page 6

something The first thing is you need to capture not the entire because the analog
waveform is continuous in time Yeah, that doesn't surprise you if you want to send
some information you need to decide I'm not gonna send the entire waveform because
that will be analog again I'll try to capture moments in time of That analog
information which I can then use to send the information You've done the course
signals and systems, I guess so, you know that sampling is not something you just
do There are criteria for sampling Yes, you all heard about Nyquist criteria We'll
we'll we'll share an extra tear and maybe we'll explain why it's so important in a
different way But definitely so sampling is important next. What else do we need to
be able to do? ideas So I took the analog waveform I sample it now. I have a bunch
of samples maybe yes, please Send to the other party.
Okay, so we need to but is are the samples good enough? So I will draw it so I'll
make it clear for you. So I will take a waveform and As our colleague has told us
we will sample it I'm trying to draw them equally distance because that's usually
how we sample. So this is the time domain and I've sampled it. So now I have no

[Truncated for analysis]

### Key points

- Sampling captures selected moments of a continuous-time waveform.
- The goal is not to send the entire analog waveform directly.
- Sample points are typically taken at equal time intervals.
- Sampling is constrained by criteria such as Nyquist.
- Sampling creates discrete-time values, but not yet a digital signal.

### Related topics

- [[digital-communication-as-analog-to-digital-to-analog-transfer|Digital Communication as Analog-to-Digital-to-Analog Transfer]]
- [[quantization-and-binary-representation-of-samples|Quantization and Binary Representation of Samples]]
- [[communication-system-block-flow|Communication System Block Flow]]

### Relationships

- depends-on: [[quantization-and-binary-representation-of-samples|Quantization and Binary Representation of Samples]]
- part-of: [[communication-system-block-flow|Communication System Block Flow]]
