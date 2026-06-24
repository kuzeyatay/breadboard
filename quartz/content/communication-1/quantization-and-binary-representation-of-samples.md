---
title: "Quantization and Binary Representation of Samples"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 6", "Page 7"]
related: ["sampling-as-the-first-step-of-digitization", "transmission-media-symbols-and-detection", "communication-system-block-flow"]
tags: ["quantization", "binary-representation", "encoding", "bits", "voltage"]
source_images: ["/communication-1/assets/988929-english-3-page-006.png", "/communication-1/assets/988929-english-3-page-007.png"]
---

## Quantization and Binary Representation of Samples

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 6, Page 7

After sampling, the signal is not yet digital because each sample may still have a continuous-valued amplitude. The lecture names the next essential step as quantization: converting discrete analog values into binary representation. This is the point where the sampled analog amplitudes are mapped to bits, producing a truly digital description. The instructors also use the term encoding in discussion, but explicitly identify quantization as the process by which voltage samples become binary digits. The durable idea is that a digital signal requires discreteness in both time and amplitude representation, and quantization is what closes the gap between sampled measurements and bit sequences.

### Source snapshots

![988929_English-3 Page 6](/communication-1/assets/988929-english-3-page-006.png)

![988929_English-3 Page 7](/communication-1/assets/988929-english-3-page-007.png)

### Page-grounded details

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

#### Page 7

one one because the second bit has flipped if can happen and then I try to
Reconstruct the waveform we'll talk about the construction later. The value I will
get is this Because this is one one one one. This is not one zero one one It's a
big one and then I will somehow create a waveform that here at this point has a
higher value for example we May want we don't have to we may want to decide that if
there is a problem with the way the bits are received We can correct for this. This
is called error correction and we will explain a bit of our error correction It is
very important and another thing that we should know all communication channels are
using error corrections all of them because it's so powerful and You know that
you're using whatever you're doing has error correction even USB Transfer with the
hard drive has on the bits that are on the cable error correction everywhere all
the time So yes error correction.
So we talked about transmission we talked about Okay, okay, it's time to flash the
topic map I think that will be the most This is our course this this picture is the
course we're going to teach you everything here Everything here. We're going to be
discussing in this

[Truncated for analysis]

### Key points

- A sampled signal is not digital if sample amplitudes remain continuous-valued.
- Discrete-in-time values can still be analog amplitudes such as voltages.
- The conversion of sample values into bits is called quantization.
- Quantization turns discrete analog values into binary representation.
- Only after this step does the system have bit-level digital information.

### Related topics

- [[sampling-as-the-first-step-of-digitization|Sampling as the First Step of Digitization]]
- [[transmission-media-symbols-and-detection|Transmission Media, Symbols, and Detection]]
- [[communication-system-block-flow|Communication System Block Flow]]

### Relationships

- depends-on: [[transmission-media-symbols-and-detection|Transmission Media, Symbols, and Detection]]
- part-of: [[communication-system-block-flow|Communication System Block Flow]]
