---
title: "Quantization as Digitization"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["digital-communication-as-analog-to-digital-to-analog-transfer", "pcm-signaling-and-line-coding", "pulse-code-modulation-and-quantization-process"]
tags: ["quantization", "digitization", "sampling", "pcm-signaling"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## Quantization as Digitization

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

Quantization is shown as the transmitter-side digitization step that follows sampling. In the communication chain, sampling first converts the analog message into discrete-time form, while quantization turns those sampled values into discrete digital levels. The diagram labels quantization directly as "Digitization," emphasizing that it is the point where continuous-valued information becomes representable by digital symbols. The output of this process participates in the creation of binary sequences shown in the diagram, including grouped code-like fragments such as 101, 010, 110, 001, and 010. Quantization is necessary before PCM signaling or line coding because PCM operates on discrete digital representations. The map associates this area with topic letters D,E, indicating a course unit tied to digitization and possibly coding foundations.

### Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)

### Page-grounded details

#### Page 1

Sampling
(Analog-to-digital
conversion)
Quantization
(Digitization) PCM Signaling
(Line coding)
Modulation
(optional step)
Physical transmission
(ex. antenna or fiber optic)
PHYSICAL CHANNEL
Physical receiver
(ex. antenna
or fiber optic)
TRANSMITTER
RECEIVER
PCM Decoding 	Error detection
and correction
Signal reconstruction
(Digital-to-analog)
Message
101
010
110
001
010 	101011010
1 0 1 0 1 1 0 1 0 	1 0 1 0 1 1 0 1 0
or
Message
(wired or wireless)
V_t 	1
0
001011011
001011011
Error detected
101011010
DAC	101011010
LPF
Hello world
Hello world
Communications 1 (5ETC0)
Topic Map
Raised-cosine filter 	ISI
+
Noise
Signal
Noisy
signal
STARTS FROM
HERE
B,C 	D,E 	E 	i,H 	J,K
J,K 	D,E 	G 	B,C
F,J,K

### Key points

- Quantization is explicitly labeled as "Digitization."
- Quantization follows sampling in the transmitter processing chain.
- Quantization converts sampled information into digital levels.
- Quantization enables later PCM signaling and line coding.
- The diagram connects digitized information to binary code groups.
- The stage is associated with topic letters D,E.

### Related topics

- [[digital-communication-as-analog-to-digital-to-analog-transfer|Sampling as Analog-to-Digital Conversion]]
- [[pcm-signaling-and-line-coding|PCM Signaling and Line Coding]]
- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation Bitstream Example]]

### Relationships

- enables: [[pcm-signaling-and-line-coding|PCM Signaling and Line Coding]]
