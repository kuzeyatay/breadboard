---
title: "Error Sources and Error Correction in Communication"
date: "2026-04-26T07:08:26.047Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988929-english-3"
source_file: "988929_English-3.pdf"
locations: ["Page 6", "Page 7"]
related: ["transmission-media-symbols-and-detection", "communication-system-block-flow", "quantization-and-binary-representation-of-samples"]
tags: ["bit-errors", "error-correction", "noise", "distortion", "usb"]
source_images: ["/communication-1/assets/988929-english-3-page-006.png", "/communication-1/assets/988929-english-3-page-007.png"]
---

## Error Sources and Error Correction in Communication

Source: [[988929-english-3|Communication 1 Course Introduction and Foundations of Digital Communication]]

Locations: Page 6, Page 7

The lecture explains that transmitted bits may change during communication, producing bit errors, and that this is a routine rather than exceptional phenomenon. A concrete example is given: if the transmitted word $1011$ is detected as $1111$ because one bit flips, reconstructing the original analog value will produce the wrong amplitude. From this example, the need for error correction is motivated. Error correction is presented as a universal feature of practical communication systems, from large-scale channels to USB cable transfers and hard-drive links. The durable lesson is that communication theory must account not only for how to represent and send information, but also for how to detect and repair corruption introduced by the channel.

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

- Bit errors happen regularly in communication channels.
- A changed bit sequence can reconstruct the wrong analog value.
- Error correction is introduced as a way to compensate for received errors.
- Different transmission methods are more or less prone to errors.
- Error correction is said to be used in all communication channels.
- The lecture also mentions distortion and noise as channel effects.

### Related topics

- [[transmission-media-symbols-and-detection|Transmission Media, Symbols, and Detection]]
- [[communication-system-block-flow|Communication System Block Flow]]
- [[quantization-and-binary-representation-of-samples|Quantization and Binary Representation of Samples]]

### Relationships

- part-of: [[communication-system-block-flow|Communication System Block Flow]]

## Added from [[topicmap|Communications 1 (5ETC0) Topic Map]]

Source label: Topic map for the full course

Locations: Page 1

Error detection and correction is shown as a receiver-side operation after PCM decoding. Its role is illustrated by the appearance of a received bitstream "001011011" and the label "Error detected," contrasting with the transmitted or intended stream "101011010" shown elsewhere in the diagram. This stage exists because the physical channel can introduce ISI and noise, causing the received data to differ from what was sent. Error detection identifies that an inconsistency exists, and correction attempts to recover the intended data before final signal reconstruction. The topic map places this step before digital-to-analog reconstruction, showing that the receiver should repair digital errors before converting data back into a recovered message.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### New key points

- Error detection and correction occurs after PCM decoding.
- The diagram explicitly shows "Error detected."
- The received stream "001011011" appears near the error-detection label.
- The stream "101011010" appears as another referenced bitstream in the chain.
- The need for error handling is caused by channel impairments such as ISI and noise.
- Correction happens before signal reconstruction.
