---
title: "Learning Map"
date: "2026-07-03T07:28:13.610Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "test-3"
internal: "true"
generatedBy: "learn_button"
generated_by: "learn_button"
textbookVersion: "textbook_mr4m0tt7_21gtzv6"
textbookVersionId: "textbook_mr4m0tt7_21gtzv6"
sourceSetHash: "1a8c69e9b052968ea2e755389c511804d1ce94c20dbb841dad31dfcb2910f645"
---

# Learning Map

## Section Order

- 1. Why Spiking Neural Networks Exist
  - 1.1 [[1. Why Spiking Neural Networks Exist/1.1 Limits of Synchronous Continuous Networks|Limits of Synchronous Continuous Networks]]
  - 1.2 [[1. Why Spiking Neural Networks Exist/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]]
  - 1.3 [[1. Why Spiking Neural Networks Exist/1.3 Neuromorphic Hardware and Real-Time Applications|Neuromorphic Hardware and Real-Time Applications]]
- 2. Spikes, Neurons, and Network Architecture
  - 2.1 [[2. Spikes, Neurons, and Network Architecture/2.1 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 2.2 [[2. Spikes, Neurons, and Network Architecture/2.2 Spiking Network Architecture and Lateral Inhibition|Spiking Network Architecture and Lateral Inhibition]]
- 3. How Spiking Neural Networks Learn
  - 3.1 [[3. How Spiking Neural Networks Learn/3.1 Why Training Strategy Is the Central Comparison|Why Training Strategy Is the Central Comparison]]
  - 3.2 [[3. How Spiking Neural Networks Learn/3.2 Surrogate Gradient Training|Surrogate Gradient Training]]
  - 3.3 [[3. How Spiking Neural Networks Learn/3.3 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
  - 3.4 [[3. How Spiking Neural Networks Learn/3.4 Spike-Timing Dependent Plasticity|Spike-Timing Dependent Plasticity]]
- 4. How Spiking Neural Networks Are Evaluated
  - 4.1 [[4. How Spiking Neural Networks Are Evaluated/4.1 Accuracy and Latency|Accuracy and Latency]]
  - 4.2 [[4. How Spiking Neural Networks Are Evaluated/4.2 Spike Count and Total Energy|Spike Count and Total Energy]]
  - 4.3 [[4. How Spiking Neural Networks Are Evaluated/4.3 Normalized Energy Efficiency and Convergence Time|Normalized Energy Efficiency and Convergence Time]]
- 5. Accuracy, Latency, Energy, and Learning Tradeoffs
  - 5.1 [[5. Accuracy, Latency, Energy, and Learning Tradeoffs/5.1 Accuracy and Energy Comparison Across Models|Accuracy and Energy Comparison Across Models]]
  - 5.2 [[5. Accuracy, Latency, Energy, and Learning Tradeoffs/5.2 Latency Differences Across Training Strategies|Latency Differences Across Training Strategies]]
  - 5.3 [[5. Accuracy, Latency, Energy, and Learning Tradeoffs/5.3 Energy Consumption and Spike Count Tradeoffs|Energy Consumption and Spike Count Tradeoffs]]
  - 5.4 [[5. Accuracy, Latency, Energy, and Learning Tradeoffs/5.4 Convergence Behavior Over Training|Convergence Behavior Over Training]]
- 6. Choosing an SNN Training Strategy
  - 6.1 [[6. Choosing an SNN Training Strategy/6.1 Matching Tradeoffs to Deployment Needs|Matching Tradeoffs to Deployment Needs]]
  - 6.2 [[6. Choosing an SNN Training Strategy/6.2 Open Challenges in Scalable Neuromorphic Learning|Open Challenges in Scalable Neuromorphic Learning]]

## Prerequisite Chain

- Start here -> Why Spiking Neural Networks Exist
- Why Spiking Neural Networks Exist -> Spikes, Neurons, and Network Architecture
- Spikes, Neurons, and Network Architecture -> How Spiking Neural Networks Learn
- How Spiking Neural Networks Learn -> How Spiking Neural Networks Are Evaluated
- How Spiking Neural Networks Are Evaluated -> Accuracy, Latency, Energy, and Learning Tradeoffs
- Accuracy, Latency, Energy, and Learning Tradeoffs -> Choosing an SNN Training Strategy

## Trunk, Branch, Leaf Concepts

- Trunk: Why Spiking Neural Networks Exist
  - Branch/leaf: Limits of Synchronous Continuous Networks
  - Branch/leaf: Spikes, Timing, and Event-Driven Computation
  - Branch/leaf: Neuromorphic Hardware and Real-Time Applications
- Trunk: Spikes, Neurons, and Network Architecture
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: Spiking Network Architecture and Lateral Inhibition
- Trunk: How Spiking Neural Networks Learn
  - Branch/leaf: Why Training Strategy Is the Central Comparison
  - Branch/leaf: Surrogate Gradient Training
  - Branch/leaf: ANN-to-SNN Conversion
  - Branch/leaf: Spike-Timing Dependent Plasticity
- Trunk: How Spiking Neural Networks Are Evaluated
  - Branch/leaf: Accuracy and Latency
  - Branch/leaf: Spike Count and Total Energy
  - Branch/leaf: Normalized Energy Efficiency and Convergence Time
- Trunk: Accuracy, Latency, Energy, and Learning Tradeoffs
  - Branch/leaf: Accuracy and Energy Comparison Across Models
  - Branch/leaf: Latency Differences Across Training Strategies
  - Branch/leaf: Energy Consumption and Spike Count Tradeoffs
  - Branch/leaf: Convergence Behavior Over Training
- Trunk: Choosing an SNN Training Strategy
  - Branch/leaf: Matching Tradeoffs to Deployment Needs
  - Branch/leaf: Open Challenges in Scalable Neuromorphic Learning

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- Only pages 1-2 are available as direct prose, and page 2 is truncated; later sections must be interpreted conservatively from figure, table, graph, and formula metadata.
- The page 6 formulas support caption-level meanings only; exact symbolic notation, variable names, and normalization details are not available.
- Pages 7-11 support qualitative comparison structure and abstract-level findings, not exact numeric reconstruction of tables, axes, legends, or plotted values.
- MNIST and CIFAR-10 are supported only as caption-named comparison datasets, so later content should not add unsupported dataset details.
- The relationship between 'direct SNN' and 'surrogate gradient SNN' is unresolved in the available evidence and should remain unresolved in later garden stages.
- The claims 'within 1-2%', '10 milliseconds', and '5 millijoules per inference' are supported at the abstract-summary level and should be presented only at that level.
- No later section should expand LIF, STDP, surrogate gradients, conversion pipelines, hardware internals, or experimental protocol beyond what these anchors explicitly support.
