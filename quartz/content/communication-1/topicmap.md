---
title: "Communications 1 (5ETC0) Topic Map"
date: "2026-04-26T07:58:41.833Z"
source: "Topic map for the full course"
knowledge_type: "source-document"
source_type: "pdf"
source_file: "TopicMap.pdf"
generated_by: "chatmock"
topics: ["mini-lab-5-2-communication-chain-and-robustness-comparison", "digital-communication-as-analog-to-digital-to-analog-transfer", "quantization-as-digitization", "pcm-signaling-and-line-coding", "pulse-code-modulation-and-quantization-process", "modulation-as-an-optional-step", "transmission-media-symbols-and-detection", "physical-channel", "isi-and-noise", "raised-cosine-nyquist-filtering", "physical-receiver", "pcm-decoding", "error-sources-and-error-correction-in-communication", "signal-reconstruction-with-dac-and-lpf", "receiver-processing-and-message-recovery", "course-topic-letter-map"]
tags: ["sampling", "quantization", "pcm-signaling", "line-coding", "modulation", "physical-channel", "raised-cosine-filter", "isi", "noise", "dac"]
source_images: ["/communication-1/assets/topicmap-page-001.png"]
source_pdf: "/communication-1/assets/topicmap-source.pdf"
---

## Summary

The source is a one-page topic map for the Communications 1 (5ETC0) course. It presents the end-to-end communication chain from an original message through transmitter processing, physical channel transmission, receiver processing, and message recovery. The transmitter side includes sampling for analog-to-digital conversion, quantization for digitization, PCM signaling or line coding, optional modulation, and physical transmission through media such as antennas or fiber optics. The physical channel is shown as wired or wireless and introduces impairments including intersymbol interference and noise, producing a noisy signal from the transmitted signal. The receiver side includes physical reception, PCM decoding, error detection and correction, digital-to-analog signal reconstruction using a DAC and LPF, and recovery of the message. The map also identifies raised-cosine filtering as related to controlling ISI and marks topic clusters with letter references such as B,C, D,E, F,J,K, G, H, I, J, and K.

## Knowledge tree

- [[mini-lab-5-2-communication-chain-and-robustness-comparison|End-to-End Digital Communication Chain]] (Page 1)
- [[digital-communication-as-analog-to-digital-to-analog-transfer|Sampling as Analog-to-Digital Conversion]] (Page 1)
- [[quantization-as-digitization|Quantization as Digitization]] (Page 1)
- [[pcm-signaling-and-line-coding|PCM Signaling and Line Coding]] (Page 1)
- [[pulse-code-modulation-and-quantization-process|Pulse Code Modulation Bitstream Example]] (Page 1)
- [[modulation-as-an-optional-step|Modulation as an Optional Step]] (Page 1)
- [[transmission-media-symbols-and-detection|Physical Transmission Media]] (Page 1)
- [[physical-channel|Physical Channel]] (Page 1)
- [[isi-and-noise|ISI and Noise]] (Page 1)
- [[raised-cosine-nyquist-filtering|Raised-Cosine Filter]] (Page 1)
- [[physical-receiver|Physical Receiver]] (Page 1)
- [[pcm-decoding|PCM Decoding]] (Page 1)
- [[error-sources-and-error-correction-in-communication|Error Detection and Correction]] (Page 1)
- [[signal-reconstruction-with-dac-and-lpf|Signal Reconstruction with DAC and LPF]] (Page 1)
- [[receiver-processing-and-message-recovery|Receiver Processing and Message Recovery]] (Page 1)
- [[course-topic-letter-map|Course Topic Letter Map]] (Page 1)

## Source material

# Page 1

# TopicMap

## Communications 1 (5ETC0)

## Topic Map

```text
Message
  |
Sampling
(Analog-to-digital conversion)
  |
Quantization
(Digitization)
  |
PCM Signaling
(Line coding)
  |
Modulation
(optional step)
  |
Physical transmission
(ex. antenna or fiber optic)
  |
PHYSICAL CHANNEL
(wired or wireless)
  |
Physical receiver
(ex. antenna or fiber optic)
  |
PCM Decoding
  |
Error detection and correction
  |
Signal reconstruction
(Digital-to-analog)
  |
Message
```

## Transmitter

```text
TRANSMITTER

Message
Hello world

Sampling
(Analog-to-digital conversion)

Quantization
(Digitization)

PCM Signaling
(Line coding)

101
010
110
001
010

101011010

1 0 1 0 1 1 0 1 0

V_t
1
0
```

## Physical Channel

```text
PHYSICAL CHANNEL

Modulation
(optional step)

Physical transmission
(ex. antenna or fiber optic)

(wired or wireless)

001011011
```

## Receiver

```text
RECEIVER

Physical receiver
(ex. antenna or fiber optic)

1 0 1 0 1 1 0 1 0

or

001011011

Error detected

101011010

PCM Decoding

101011010

Error detection and correction

DAC

Signal reconstruction
(Digital-to-analog)

LPF

Hello world
```

## Raised-Cosine Filter

```text
Raised-cosine filter

Signal
+
Noise
=
Noisy signal

ISI
```

## Starts From Here

```text
STARTS FROM HERE

B,C    D,E    E      i,H    J,K
J,K    D,E    G      B,C
F,J,K
```

## Source snapshots

![TopicMap Page 1](/communication-1/assets/topicmap-page-001.png)
