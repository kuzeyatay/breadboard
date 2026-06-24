---
title: "PCM Signaling and Line Coding"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["quantization-as-digitization", "pulse-code-modulation-and-quantization-process", "pcm-decoding", "modulation-as-an-optional-step"]
tags: ["pcm-signaling", "line-coding", "pcm-decoding", "v-t"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## PCM Signaling and Line Coding

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

PCM signaling is shown as a transmitter-side stage and is identified with line coding. In the topic map, PCM signaling follows quantization and precedes optional modulation, meaning it converts digitized information into a coded sequence suitable for transmission. The diagram includes binary streams such as 101011010 and a line of separated bits "1 0 1 0 1 1 0 1 0," illustrating how information is represented as a binary waveform or bit sequence. A small waveform-style axis labeled $V_t$ with binary levels 1 and 0 suggests line coding as a voltage-versus-time representation of bits. PCM signaling therefore acts as the bridge between abstract digital data and a physical signal that can be sent through a channel. On the receiver side, PCM decoding is the corresponding inverse operation.

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

- PCM signaling is labeled as "Line coding."
- It follows quantization and comes before optional modulation.
- The diagram shows PCM information as bitstreams such as 101011010.
- Separated bits are shown as "1 0 1 0 1 1 0 1 0."
- A $V_t$ sketch indicates binary signal levels 1 and 0 over time.
- PCM decoding appears at the receiver as the reverse stage.

### Related topics

- [[quantization-as-digitization|Quantization as Digitization]]
- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation Bitstream Example]]
- [[pcm-decoding|PCM Decoding]]
- [[modulation-as-an-optional-step|Modulation as an Optional Step]]

### Relationships

- applies-to: [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation Bitstream Example]]
- contrasts-with: [[pcm-decoding|PCM Decoding]]
