---
title: "Transmission Media, Symbols, and Detection"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 6"]
related: ["quantization-and-binary-representation-of-samples", "error-sources-and-error-correction-in-communication", "communication-system-block-flow"]
tags: ["symbols", "fiber", "detection", "signaling"]
source_images: ["/communication-1/assets/988929-english-3-page-006.png"]
---

## Transmission Media, Symbols, and Detection

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 6

Once bits have been created, they still must be mapped into a physical form suitable for transmission. The lecture lists several media, including wires, wireless channels, and optical fiber, and explains that bits must be converted into something that can be sent through these media. The instructors call these transmissible entities symbols. This topic marks the transition from source representation to channel use: a communication system must map bit sequences onto sendable waveforms or states, propagate them through the medium, and detect them at the receiver. The lecture does not yet derive modulation schemes in detail, but clearly establishes signaling and detection as distinct required steps.

### Source snapshots

![988929_English-3 Page 6](/communication-1/assets/988929-english-3-page-006.png)

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

### Key points

- Bits cannot be sent directly without being mapped into a physical transmission form.
- Transmission media mentioned include wire, wireless links, and glass fiber.
- Bits are converted into sendable symbols.
- The receiver must detect the transmitted information as well as the transmitter sending it.
- Symbol mapping is part of the signaling process in communication.

### Related topics

- [[quantization-and-binary-representation-of-samples|Quantization and Binary Representation of Samples]]
- [[error-sources-and-error-correction-in-communication|Error Sources and Error Correction in Communication]]
- [[communication-system-block-flow|Communication System Block Flow]]

### Relationships

- causes: [[error-sources-and-error-correction-in-communication|Error Sources and Error Correction in Communication]]
- part-of: [[communication-system-block-flow|Communication System Block Flow]]

## Added from [[topicmap|Communications 1 (5ETC0) Topic Map]]

Source label: Topic map for the full course

Locations: Page 1

Physical transmission is the stage that injects the prepared communication signal into the physical channel. The topic map gives examples of physical transmission devices or media as "antenna or fiber optic," showing that the course considers both wireless and wired physical-layer implementations. This stage follows optional modulation on the transmitter side and precedes propagation through the physical channel. The same examples, antenna and fiber optic, appear again at the receiver side under physical receiver, indicating that transmission and reception are paired operations around the physical channel. Physical transmission is where abstract bitstreams and line-coded signals become real physical signals subject to channel effects such as ISI and noise.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### New key points

- Physical transmission occurs after optional modulation.
- Examples include antenna and fiber optic transmission.
- This stage connects the transmitter to the physical channel.
- The channel may be wired or wireless.
- The receiver has a corresponding physical receiver stage.
- Transmission through the physical channel exposes the signal to ISI and noise.
