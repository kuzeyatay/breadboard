---
title: "Topic Overview"
date: "2026-07-09T16:32:31.044Z"
knowledge_type: "topic-overview"
breadboardType: "topic_overview"
gardenId: "test-2"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mrdq580k_lysshxn"
learningVersionId: "learning_mrdq580k_lysshxn"
sourceSetHash: "da4e4aa8c56753a3b736ce67191e566a20546815fb4beba56b78a636c1861ef5"
---

# Spiking Neural Networks

Spiking Neural Networks, or SNNs, are neural networks that compute with discrete spike events instead of continuously passing dense numerical activations from layer to layer. A conventional artificial neural network usually represents activity as values that are available at every layer update. An SNN represents activity as spikes that occur at particular times. That one shift changes the whole learning problem: information is no longer only "how large is this activation?" but also "when did this event happen?"

The central idea is simple: a neuron can stay quiet until its input is strong enough, then emit a spike. Quiet periods matter because they avoid unnecessary activity. Timing matters because the sequence of spikes can carry information about changing signals. This makes SNNs especially important for thinking about efficient, event-driven computation, low-power inference, temporal data, and neuromorphic hardware.

A good way to learn SNNs is to avoid starting with algorithms. Start with the computational reason SNNs exist. Then learn what a spike is, how a spiking neuron turns accumulated input into an event, how layers pass spike activity forward, and only then compare training methods. The main theme of this garden is tradeoff-aware evaluation: an SNN method is not "best" just because it has high accuracy. It must also be judged by latency, energy, spike count, and convergence behavior.

## What This Garden Is About

This garden teaches SNNs as event-driven neural systems. The learning spine is:

1. **Dense continuous computation has a cost.** Conventional neural networks can perform well, but they often compute with dense activations whether or not every part of the network needs to be active.
2. **Spike events change the cost structure.** An SNN neuron communicates only when it spikes, so sparse activity can reduce unnecessary computation.
3. **Time becomes part of the representation.** A spike train is not just a value; it is a pattern of events across time.
4. **A spiking neuron needs internal state.** A Leaky Integrate-and-Fire neuron accumulates input as membrane potential, loses some potential through leak, and emits a spike when the threshold is crossed.
5. **Training SNNs creates a tension.** Spikes are discrete, but many high-performing learning methods depend on smooth optimization. Surrogate gradients, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity solve this tension differently.
6. **Evaluation must be multi-metric.** Accuracy, latency, spike count, energy, normalized energy efficiency, and convergence time answer different questions.
7. **The right SNN strategy depends on the constraint.** Low-latency, high-accuracy settings point toward one method; ultra-low-power or unsupervised settings may point toward another.

By the end, you should be able to explain why SNNs are not just "ANNs with spikes." You should be able to read SNN results as a set of tradeoffs: what the model gains, what it spends, and which deployment goal it serves.

## How To Learn This Garden

Read the garden in order the first time. Each section depends on a small set of ideas from earlier sections.

Begin with intuition, not formulas. The early pages explain why events and timing matter. The middle pages introduce training methods. The metric pages then give you the language needed to compare methods carefully. The final pages synthesize those comparisons into practical choices.

When you reach a formula page, read the formula as a measurement tool rather than as something to memorize. For example, accuracy measures the fraction of correct predictions, latency measures elapsed decision time, and total spike count measures how much event activity occurred. Each metric exists because accuracy alone cannot describe whether an SNN is fast, sparse, energy-efficient, or easy to train.

When you reach a result-comparison page, ask three questions:

- **What is being optimized?** Accuracy, latency, energy, spike count, convergence, or some combination?
- **What is being paid?** More spikes, longer simulation windows, slower convergence, or lower biological plausibility?
- **What deployment constraint would make this tradeoff reasonable?** Real-time inference, ultra-low-power operation, competitive classification, or unsupervised learning?

## Recommended Reading Order

1. [[learning/1. Why SNNs Need Events/_index|1. Why SNNs Need Events]]
   Start here to understand why spike-based computation exists and why sparse event activity changes the computational budget.

2. Why SNNs Need Events/Why Spiking Neural Networks Exist
   Learn the motivation for moving from conventional neural networks to event-driven, brain-inspired computation.

3. Why SNNs Need Events/Event-Driven Temporal Processing
   Learn why time is part of the signal in an SNN, not merely an iteration counter.

4. Why SNNs Need Events/The Leaky Integrate-and-Fire Neuron
   Learn how membrane potential, leak, threshold, and spike emission work together.

5. Why SNNs Need Events/Input Encoding and Spiking Layers
   Learn how external inputs become spike activity and how excitatory and inhibitory layers shape spike flow.

6. What the Results Show/Continuous Activations and Discrete Spikes
   Compare ANN-style continuous activations with SNN-style spike trains.

7. What the Results Show/Three Ways to Build or Train SNNs
   Meet the three main SNN approaches: surrogate gradient training, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity.

8. How SNNs Learns/Surrogate Gradient Training
   Learn how SNNs can be trained for high accuracy despite discrete spike events.

9. How SNNs Learns/ANN-to-SNN Conversion
   Learn why converting a trained ANN can preserve competitive performance while introducing temporal and spike-count costs.

10. How SNNs Learns/Spike-Timing Dependent Plasticity
   Learn how relative spike timing can drive local learning and support low-power behavior.

11. The Metrics That Make SNNs Measurable/Accuracy as a Performance Metric
   Learn what accuracy measures and why it cannot be the only comparison metric.

12. The Metrics That Make SNNs Measurable/Latency as Decision Time
   Learn how SNN decision speed is measured from stimulus onset to decision time.

13. The Metrics That Make SNNs Measurable/Spike Count as Activity Cost
   Learn why total spike count connects sparse activity to computational cost.

14. The Metrics That Make SNNs Measurable/Energy and Energy Efficiency
   Learn how spike costs, synaptic operation costs, total energy, and normalized energy efficiency fit together.

15. The Metrics That Make SNNs Measurable/Convergence Time and Learning Curves
   Learn how training loss, training accuracy, target accuracy, and convergence epoch describe learning speed.

16. What the Results Show/Reading Multi-Metric Results
   Learn how to read accuracy, latency, energy, spike count, and convergence as one tradeoff picture.

17. Where SNNs Fits and What Still Blocks It/Low-Latency and High-Accuracy Choices
   Learn when surrogate-gradient SNNs are a strong choice.

18. Where SNNs Fits and What Still Blocks It/Ultra-Low-Power and Unsupervised Choices
   Learn when STDP-based SNNs are a strong choice.

19. Where SNNs Fits and What Still Blocks It/Neuromorphic Hardware Context
   Learn why event-driven computation matters for low-power neuromorphic engineering.

20. Where SNNs Fits and What Still Blocks It/Limits of Current SNN Systems
   Learn why scalable training and hardware standardization still limit SNN adoption.

21. Where SNNs Fits and What Still Blocks It/Choosing an SNN Training Strategy
   Finish by choosing among surrogate training, conversion, and STDP using constraints rather than a single headline metric.

## What This Garden Covers

This garden covers SNNs as sparse, event-driven neural systems. It focuses on the conceptual difference between continuous activations and spike trains, the Leaky Integrate-and-Fire neuron, input encoding, excitatory and inhibitory spiking layers, and three major ways to build or train SNNs: surrogate gradient training, ANN-to-SNN conversion, and Spike-Timing Dependent Plasticity.

It also covers the metrics needed to evaluate SNNs responsibly:

- **Accuracy:** the fraction of predictions that are correct.
- **Latency:** the time from stimulus onset to decision.
- **Total spike count:** the sum of spike events across neurons and time steps.
- **Total energy:** the energy associated with spikes and synaptic operations.
- **Normalized energy efficiency:** useful performance relative to energy consumption.
- **Convergence time:** the earliest training epoch at which a target accuracy is reached.

The garden treats SNN methods as choices under constraints. Surrogate-gradient SNNs are important for low-latency and high-accuracy goals. Converted SNNs are important when competitive ANN-like performance is desired, though they can require more spikes and longer simulation windows. STDP-based SNNs are important for ultra-low-power and unsupervised settings where sparse activity and local timing-based learning are valuable.

## What This Garden Does Not Cover

This garden does not teach detailed biological neuroscience such as ion channels, cortical microcircuits, or biological neuron taxonomies. It uses only the neuron intuition needed to understand spike events, membrane potential, leak, threshold crossing, and spike timing.

This garden does not derive advanced training mathematics for backpropagation-through-time, surrogate-gradient estimators, or full STDP update equations. It explains these methods at the level needed to compare their tradeoffs.

This garden does not provide implementation tutorials, code examples, simulator setup, or framework comparisons. It focuses on conceptual understanding and metric-based comparison rather than hands-on engineering recipes.

This garden does not make broad claims about every SNN benchmark, every neuromorphic chip, or every possible training algorithm. Neuromorphic hardware appears here only as context for why event-driven sparse computation can matter in low-power systems, including platforms such as IBM TrueNorth and Intel Loihi.

The purpose is not to memorize a list of SNN facts. The purpose is to learn a way of thinking: spikes turn computation into timed events, timed events create new training challenges, and SNN evaluation only becomes meaningful when accuracy is read beside latency, energy, spike count, and convergence.