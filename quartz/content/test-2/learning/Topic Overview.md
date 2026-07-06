---
title: "Topic Overview"
date: "2026-07-06T10:24:52.846Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mr92o5c2_smvyt3k"
learningVersionId: "learning_mr92o5c2_smvyt3k"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Spiking neural networks are neural networks that compute with events in time. Instead of sending a continuously valued activation at every layer update, a spiking neuron emits a discrete spike when its internal state reaches a threshold. That single change shifts the learning problem: information is no longer only "how large is this activation?" but also "when did this event happen?" and "how many events were needed?"

This garden teaches SNNs as a tradeoff-centered way of thinking about neural computation. The central idea is simple: if a network communicates only when spikes occur, then computation can become sparse, timed, and potentially more energy-efficient. That promise matters most in settings where dense, synchronous neural computation is expensive, latency matters, or deployment must happen under strict power constraints.

The goal is not to treat SNNs as a universal replacement for conventional artificial neural networks. The goal is to learn how SNNs work, how they are trained, how they are measured, and how to choose among SNN approaches when accuracy, latency, energy, spike count, and convergence pull in different directions.

## The Learning Spine

Start with the problem SNNs are trying to solve. Conventional artificial neural networks usually pass continuous activations through dense layers in synchronized steps. That style can work well, but it can also demand substantial computation and energy. SNNs begin from a different assumption: a neuron does not need to communicate all the time. It can stay quiet until an event is worth sending.

From there, learn the spike itself. A spike is a discrete event, and a sequence of spikes over time is a spike train. Once timing becomes part of the signal, the network can represent information through temporal patterns, not only through magnitudes. This is why SNNs are naturally tied to event-driven computation and spatiotemporal data.

Next, learn the basic neuron mechanism. A Leaky Integrate-and-Fire neuron accumulates input into a membrane potential, loses some accumulated state through leak, and emits a spike when the membrane potential reaches a threshold. This gives you the core intuition behind spike generation without requiring unsupported biological detail.

Then zoom out from one neuron to a network. Input encoding turns ordinary inputs into spike-based activity. Excitatory neurons respond to patterns in that activity. Lateral inhibition helps shape competition among responses so that the network's activity becomes organized rather than just a collection of isolated spikes.

After the mechanism is clear, learn training. SNNs need specialized strategies because spikes are discrete events, and that makes ordinary gradient-based learning less direct. This garden focuses on three approaches: surrogate gradient training, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity. Each strategy fits a different tradeoff profile.

Finally, learn how SNNs are judged. Accuracy alone is not enough. A model may be accurate but slow, energy-hungry, spike-heavy, or slow to train. SNN evaluation needs several metrics together: accuracy, latency, spike count, total energy, normalized energy efficiency, and convergence time. The results sections use those metrics to compare when surrogate-gradient SNNs, converted SNNs, and STDP-based SNNs are attractive.

## Recommended Reading Order

Read the garden in this order if you are new to SNNs:

1. [[learning/1. Why SNNs Need Events/_index|Why SNNs Need Events]]
   - [[learning/1. Why SNNs Need Events/1.1 Why Spiking Neural Networks Exist|Why Spiking Neural Networks Exist]]
   - [[learning/1. Why SNNs Need Events/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]]
   - [[learning/1. Why SNNs Need Events/1.3 Sparse Events and Low-Power Computation|Sparse Events and Low-Power Computation]]
   - [[learning/1. Why SNNs Need Events/1.4 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
   - [[learning/1. Why SNNs Need Events/1.5 Input Encoding, Excitation, and Lateral Inhibition|Input Encoding, Excitation, and Lateral Inhibition]]

2. [[learning/2. How SNNs Learn/2.1 How SNNs Learn|How SNNs Learn]]
   - [[learning/2. How SNNs Learn/2.1 How SNNs Learn|How SNNs Learn]]
   - [[learning/2. How SNNs Learn/2.2 Surrogate Gradient Training|Surrogate Gradient Training]]
   - [[learning/2. How SNNs Learn/2.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
   - [[learning/2. How SNNs Learn/2.4 Spike-Timing Dependent Plasticity|Spike-Timing Dependent Plasticity]]

3. [[learning/3. The Metrics That Make SNNs Measurable/_index|The Metrics That Make SNNs Measurable]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.1 Accuracy as Correct Predictions|Accuracy as Correct Predictions]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.2 Latency as Decision Time|Latency as Decision Time]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.3 Spike Count as Computational Activity|Spike Count as Computational Activity]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.4 Energy and Normalized Energy Efficiency|Energy and Normalized Energy Efficiency]]
   - [[learning/3. The Metrics That Make SNNs Measurable/3.5 Convergence Time|Convergence Time]]

4. [[learning/5. What the Results Show/_index|What the Results Show]]
   - [[learning/4. What the Results Show/4.1 Continuous Activations and Spike Events|Continuous Activations and Spike Events]]
   - [[learning/4. What the Results Show/4.2 Accuracy, Energy, and Performance Tradeoffs|Accuracy, Energy, and Performance Tradeoffs]]
   - [[learning/4. What the Results Show/4.3 Latency Comparisons Across Models|Latency Comparisons Across Models]]
   - [[learning/5. What the Results Show/5.1 Energy Consumption and Spike Count Comparisons|Energy Consumption and Spike Count Comparisons]]
   - [[learning/5. What the Results Show/5.2 Training Loss and Convergence Behavior|Training Loss and Convergence Behavior]]
   - [[learning/5. What the Results Show/5.3 Training Accuracy Curves|Training Accuracy Curves]]

5. Where SNNs Fit and What Still Blocks Them
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.1 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]]
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.2 Neuromorphic Hardware for SNNs|Neuromorphic Hardware for SNNs]]
   - [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.3 Open Challenges for SNNs|Open Challenges for SNNs]]

If you already understand neural network basics, begin with [[learning/1. Why SNNs Need Events/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]]. If you are mainly interested in deployment decisions, read [[learning/3. The Metrics That Make SNNs Measurable/_index|The Metrics That Make SNNs Measurable]] before the results sections. If you want the practical summary first, read [[learning/6. Where SNNs Fit and What Still Blocks Adoption/6.1 Choosing an SNN Training Strategy|Choosing an SNN Training Strategy]] after learning the metrics.

## How to Learn This Topic

Learn SNNs by keeping three questions active at the same time.

First, ask what is being communicated. In a conventional network, a neuron output is usually a continuous value. In an SNN, communication happens through spike events. That changes the meaning of activity: silence can matter, timing can matter, and fewer events can mean less computation.

Second, ask when computation happens. Dense computation updates many values whether or not something important changed. Event-driven computation updates around spikes. This is the bridge from spike trains to energy efficiency: fewer spike events can reduce unnecessary activity, especially when supported by neuromorphic hardware.

Third, ask what goal the model is serving. A low-latency task may favor a different SNN strategy than an ultra-low-power unsupervised task. A model that looks strong on accuracy may look less attractive after considering energy, spike count, or convergence time. The right question is not "Which SNN is best?" but "Best for which constraint?"

## What This Garden Covers

This garden covers SNNs as event-driven neural systems built around discrete spike events, temporal information, sparse communication, and energy-aware evaluation. It explains the contrast with conventional artificial neural networks, the intuition behind Leaky Integrate-and-Fire neurons, and the role of input encoding, excitatory activity, and lateral inhibition in a simple SNN architecture.

It also covers the main training strategies used here: surrogate gradient training, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity. The comparison is practical rather than promotional. Surrogate-gradient SNNs are treated as strong candidates for accuracy and low-latency goals. Converted SNNs are treated as competitive approaches that may require longer simulation windows or higher spike counts. STDP-based SNNs are treated as attractive for ultra-low-power unsupervised settings, while also carrying convergence tradeoffs.

The evaluation part of the garden is central. You will learn why accuracy, latency, spike count, energy, normalized energy efficiency, and convergence time must be read together. The results sections focus on how these metrics change the interpretation of model quality.

## What This Garden Does Not Cover

This garden does not expand into detailed neuroscience, biological neuron anatomy, cortical circuits, or synapse biology beyond what is needed to understand spike-based computation.

It does not introduce unsupported neuron models such as Hodgkin-Huxley, Izhikevich, or adaptive exponential integrate-and-fire models. The neuron mechanism is limited to the conceptual Leaky Integrate-and-Fire model: membrane potential, leak, threshold crossing, and spike emission.

It does not provide detailed hardware internals for IBM TrueNorth, Intel Loihi, or other neuromorphic systems. Neuromorphic hardware appears here only as the deployment context that can support scalable, low-power, event-driven SNN computation.

It does not invent exact symbolic formulas, energy coefficients, or table values that are not available in the learning materials. Metric formulas are taught from their stated meanings: correctness over total predictions, decision time after stimulus onset, spikes summed across neurons and time steps, energy tied to spikes and synaptic operations, efficiency as accuracy relative to energy consumption, and convergence as reaching a target accuracy by a certain epoch.

It also does not claim that SNNs will replace conventional neural networks. SNNs are best understood as a promising family of methods with specific strengths, measurable tradeoffs, and remaining challenges in scalable training and hardware standardization.