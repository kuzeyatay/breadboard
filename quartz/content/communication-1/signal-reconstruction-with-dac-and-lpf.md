---
title: "Signal Reconstruction with DAC and LPF"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "knowledge-topic"
source_document: "topicmap"
source_file: "TopicMap.pdf"
locations: ["Page 1"]
related: ["digital-communication-as-analog-to-digital-to-analog-transfer", "error-sources-and-error-correction-in-communication", "receiver-processing-and-message-recovery"]
tags: ["signal-reconstruction", "digital-to-analog", "dac", "lpf", "sampling"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
---

## Signal Reconstruction with DAC and LPF

Source: [[topicmap|Communications 1 (5ETC0) Topic Map]]

Locations: Page 1

Signal reconstruction is the final technical conversion stage before the recovered message. The topic map labels it as "Digital-to-analog" and shows two specific components: a DAC and an LPF. The DAC converts the corrected digital sequence back into an analog signal, while the LPF, or low-pass filter, is shown after the DAC as part of smoothing or reconstructing the signal. The bitstream "101011010" appears before this reconstruction area, indicating that the digital data is used as the input to the reconstruction process. The final result is the recovered message "Hello world," mirroring the original message at the transmitter. This stage is the receiver-side inverse of the initial sampling and digitization stages.

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

- Signal reconstruction is labeled "Digital-to-analog."
- The diagram explicitly includes a DAC block.
- The diagram explicitly includes an LPF block.
- A digital bitstream "101011010" appears before reconstruction.
- The reconstructed output is shown as "Hello world."
- Signal reconstruction reverses the earlier analog-to-digital conversion path.

### Related topics

- [[digital-communication-as-analog-to-digital-to-analog-transfer|Sampling as Analog-to-Digital Conversion]]
- [[error-sources-and-error-correction-in-communication|Error Detection and Correction]]
- [[receiver-processing-and-message-recovery|Receiver Processing and Message Recovery]]

### Relationships

- part-of: [[receiver-processing-and-message-recovery|Receiver Processing and Message Recovery]]
