---
title: "Definition and Use of dBm"
date: "2026-04-26T07:12:08.116Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988934-english-1"
source_file: "988934_English-1.pdf"
locations: ["Page 3"]
related: ["db-as-a-unitless-ratio", "why-decibel-arithmetic-is-useful-in-rf-engineering", "dbw-as-absolute-power-relative-to-1-watt", "common-mistake-confusing-db-with-dbm"]
tags: ["dbm", "milliwatt", "power", "rf-system", "wi-fi"]
source_images: ["/communication-1/assets/988934-english-1-page-003.png"]
---

## Definition and Use of dBm

Source: [[988934-english-1|Introduction to Decibels, dBm, and dBW in Engineering]]

Locations: Page 3

The lecture defines dBm as an absolute power level referenced to 1 milliwatt. The formula given is $$\mathrm{dBm} = 10 \log_{10}\left(\frac{P}{1\text{ mW}}\right).$$ Unlike plain dB, which is just a ratio, dBm tells you the actual power level relative to a fixed reference. This distinction is important in RF and communication systems, where very small powers are common. The lecture uses several examples to anchor the concept: 0 dBm equals 1 mW, not zero power; -10 dBm equals 0.1 mW; and signal levels around -70 dBm are typical for received wireless signals such as Wi‑Fi or mobile phone signals. The durable lesson is that dBm is an absolute logarithmic power unit and that negative dBm values are not problematic; they simply indicate powers below 1 mW. Students are expected to become comfortable moving between milliwatts and dBm when analyzing system power levels.

### Source snapshots

![988934_English-1 Page 3](/communication-1/assets/988934-english-1-page-003.png)

### Page-grounded details

#### Page 3

sometimes always something goes wrong with the DB and DB So I'm really sorry, but
this is important because in the in the exams that also so that mentioned DBV so
the DB volt DBV And we so far we discussed DB DB Which is a ratio? But it's not a
power yet.
We are talking about pass But it's not a power yet when we in this course. We
talked then about DB M's yes, and DB watts yes, and The only difference is a DB is
just a ratio between it's a multiplication So it's oh, it's a factor of two. It's a
factor of five. It's a factor of whatever That's a ratio on how much power that you
gained if you what it makes it so easy if you work with the beast Then you get out
of a multiplication, so it's three times the power you can just Add five words it
and then you add it so then then it's a much easier calculation And you will see in
this course. We will do a lot with DB. However This is unitless This has you this
is a power you cannot convert DB to DB M.
I see that every time that students argued discuss or whatever Oh, I converted that
to that no way possible.
You can convert DB M to DB watt, but we will make clear That there's always an add-
on DB is a unitless Value we are not using that t

[Truncated for analysis]

### Key points

- dBm is defined relative to 1 milliwatt.
- The formula is $10 \log_{10}(P/1\text{ mW})$.
- 0 dBm equals 1 mW.
- -10 dBm equals 0.1 mW.
- Negative dBm values indicate powers below 1 mW.
- dBm is widely used for RF and wireless signal levels.

### Related topics

- [[db-as-a-unitless-ratio|dB as a Unitless Ratio]]
- [[why-decibel-arithmetic-is-useful-in-rf-engineering|Why Decibel Arithmetic Is Useful in RF Engineering]]
- [[dbw-as-absolute-power-relative-to-1-watt|dBW as Absolute Power Relative to 1 Watt]]
- [[common-mistake-confusing-db-with-dbm|Common Mistake: Confusing dB with dBm]]

### Relationships

- contrasts-with: [[db-as-a-unitless-ratio|dB as a Unitless Ratio]]

## Added from [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Source label: upload

Locations: Page 1, Page 2

The lecture distinguishes dBm from ordinary dB by treating dBm as a logarithmic power level referenced to one milliwatt. In the quiz recap, $0\,\mathrm{dBm}$ is converted from logarithmic scale to linear scale, and the correct value is $1\,\mathrm{mW}$. This reference is essential because dBm is not merely a ratio; it is an absolute power level expressed relative to the milliwatt reference. The lecture later uses this fact when discussing how to add two powers given in dBm. Since dBm values are logarithmic, they cannot be added directly in the logarithmic domain. Instead, each dBm value must be converted to milliwatts, added in linear scale, and then converted back to dBm if needed.

### Source snapshots

![997203_English Page 1](/communication-1/assets/997203-english-page-001.png)

![997203_English Page 2](/communication-1/assets/997203-english-page-002.png)

### New key points

- $0\,\mathrm{dBm}$ corresponds to $1\,\mathrm{mW}$.
- dBm is a logarithmic power scale referenced to one milliwatt.
- A dBm value must be converted to linear power before ordinary arithmetic addition.
- The lecture treats dBm conversion as a basic skill for communication-system calculations.
- The dBm reference is later used to explain why $0\,\mathrm{dBm}+0\,\mathrm{dBm}$ gives $2\,\mathrm{mW}$ or $3\,\mathrm{dBm}$.
