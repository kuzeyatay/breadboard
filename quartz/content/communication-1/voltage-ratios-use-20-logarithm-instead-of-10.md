---
title: "Voltage Ratios Use 20 Logarithm Instead of 10"
date: "2026-04-26T07:12:08.116Z"
source: "upload"
knowledge_type: "knowledge-topic"
source_document: "988934-english-1"
source_file: "988934_English-1.pdf"
locations: ["Page 2", "Page 3"]
related: ["working-with-decibels-for-power-gain-and-snr", "db-as-a-unitless-ratio", "common-mistake-confusing-db-with-dbm"]
tags: ["voltage-ratio", "power", "20-log", "10-log", "voltage-gain"]
source_images: ["/communication-1/assets/988934-english-1-page-002.png", "/communication-1/assets/988934-english-1-page-003.png"]
---

## Voltage Ratios Use 20 Logarithm Instead of 10

Source: [[988934-english-1|Introduction to Decibels, dBm, and dBW in Engineering]]

Locations: Page 2, Page 3

The lecture distinguishes between decibel calculations for power ratios and for voltage ratios. For power, the factor is 10, but for voltage the rule becomes $$20 \log_{10}\left(\frac{V_{out}}{V_{in}}\right).$$ The source explains that this is not arbitrary: electrical power is proportional to voltage squared, so when voltage replaces power in the logarithmic expression, the exponent 2 comes out of the logarithm as a multiplicative factor, changing 10 into 20. The lecture emphasizes that students should not mix these two forms. It also notes a naming distinction: these voltage-related expressions are described in the lecture as 'dB volts' because they represent voltage gain rather than power gain. The durable idea is that the correct logarithmic multiplier depends on the physical quantity being compared, and that understanding the derivation from $P \propto V^2$ prevents rote misuse.

### Source snapshots

![988934_English-1 Page 2](/communication-1/assets/988934-english-1-page-002.png)

![988934_English-1 Page 3](/communication-1/assets/988934-english-1-page-003.png)

### Page-grounded details

#### Page 2

We'll say the amplifiers 10 DB gain How much is 10 DB gain? If an amplifier is 10
DB gain how how much strong is the signal at the output compared to the input? 100
times one guess more guesses if it the signal at the output is 10 DB stronger Then
it so that there's a 10 billion No Times 10 increase.
Yes, exactly. So 10 DB is 10 times more power Okay How do you know because there's
a formula I didn't I don't invent this Formula and we will use it a lot in this
course and in many many questions also in exams We will use DB To indicate all
sorts of properties For example the gain of an antenna could be in DB right mark
happened before Yes, doesn't yes so if P out divided by P in Yeah, this is the
ratio and it has no units Just the number If I want to express this in DB, I will
take 10 log base 10 of P out divided by P in Okay, so if the power at the output is
double the power the input Double What will be the gain in DB? Take your calculator
practice.
Take your calculator. Take you all have calculators or your laptop So whatever
you're using and try to give me the number roughly.
What is if P out? Is two times P in P out in DB Is P in plus DB About 3 DB.
Thank you By the way, sorry t

[Truncated for analysis]

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

- Voltage ratios use $20 \log_{10}(V_{out}/V_{in})$.
- Power ratios use $10 \log_{10}(P_{out}/P_{in})$.
- The factor 20 comes from the fact that power is proportional to voltage squared.
- The exponent 2 emerges from the logarithm and multiplies the leading 10.
- Voltage-gain expressions must not be confused with power-gain expressions.

### Related topics

- [[working-with-decibels-for-power-gain-and-snr|Power Ratio Formula for Decibels]]
- [[db-as-a-unitless-ratio|dB as a Unitless Ratio]]
- [[common-mistake-confusing-db-with-dbm|Common Mistake: Confusing dB with dBm]]

### Relationships

- contrasts-with: [[working-with-decibels-for-power-gain-and-snr|Power Ratio Formula for Decibels]]
- related: [[db-as-a-unitless-ratio|dB as a Unitless Ratio]]

## Added from [[997203-english|Decibels, Fourier Representation, Digital Sampling, and Nyquist Reconstruction]]

Source label: upload

Locations: Page 1

The lecture highlights that voltage ratios are field quantities and therefore differ from power ratios when expressed in decibels. In the quiz, a voltage ratio of $2:1$ approximately corresponds to $6\,\mathrm{dB}$, not $3\,\mathrm{dB}$. The lecturer emphasizes that the trick in the question is that the ratio refers to voltage rather than power. This distinction matters because doubling a power level gives $3\,\mathrm{dB}$, while doubling a voltage or field quantity gives $6\,\mathrm{dB}$. The point is presented as a common source of mistakes: students performed better on the power and dBm questions than on the voltage-ratio question. The durable lesson is to identify the physical quantity before applying logarithmic conversions.

### Source snapshots

![997203_English Page 1](/communication-1/assets/997203-english-page-001.png)

### New key points

- A voltage ratio of $2:1$ approximately corresponds to $6\,\mathrm{dB}$.
- Voltage is treated as a field quantity rather than a power quantity.
- Doubling a voltage does not produce the same dB increase as doubling a power.
- The lecture explicitly contrasts the voltage-ratio question with the earlier power questions.
- The lower quiz accuracy on the voltage question is used to identify this as a common conceptual trap.
