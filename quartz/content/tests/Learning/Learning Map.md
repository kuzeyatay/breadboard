---
title: "Learning Map"
date: "2026-07-04T06:43:33.739Z"
knowledge_type: "learning-map"
breadboardType: "learning_map"
gardenId: "tests"
generatedBy: "learn_button"
generated_by: "learn_button"
learningVersion: "learning_mr5zvrbj_91s9yvx"
learningVersionId: "learning_mr5zvrbj_91s9yvx"
sourceSetHash: "8705b0381f2a9e4ceb25037fd6b47299155c58d7bb5b60b707cef6c515b8a7c4"
---

# Learning Map

## Section Order

- 1. Why Spiking Neural Networks Exist
  - 1.1 [[Learning/1. Why Spiking Neural Networks Exist/1.1 Continuous Activations, Dense Computation, and the Energy Problem|Continuous Activations, Dense Computation, and the Energy Problem]]
  - 1.2 [[Learning/1. Why Spiking Neural Networks Exist/1.2 Spikes, Timing, and Event-Driven Computation|Spikes, Timing, and Event-Driven Computation]]
  - 1.3 [[Learning/1. Why Spiking Neural Networks Exist/1.3 Neuromorphic Hardware and Application Pressure|Neuromorphic Hardware and Application Pressure]]
  - 1.4 [[Learning/1. Why Spiking Neural Networks Exist/1.4 Why a Unified Comparison Is Needed|Why a Unified Comparison Is Needed]]
- 2. How Spiking Neural Networks Are Structured
  - 2.1 [[Learning/2. How Spiking Neural Networks Are Structured/2.1 The Leaky Integrate-and-Fire Neuron|The Leaky Integrate-and-Fire Neuron]]
  - 2.2 [[Learning/2. How Spiking Neural Networks Are Structured/2.2 Input Encoding, Excitation, Inhibition, and Winner-Take-All Competition|Input Encoding, Excitation, Inhibition, and Winner-Take-All Competition]]
- 3. How Spiking Neural Networks Learn
  - 3.1 [[Learning/3. How Spiking Neural Networks Learn/3.1 Surrogate Gradient Descent|Surrogate Gradient Descent]]
  - 3.2 [[Learning/3. How Spiking Neural Networks Learn/3.2 ANN-to-SNN Conversion|ANN-to-SNN Conversion]]
  - 3.3 [[Learning/3. How Spiking Neural Networks Learn/3.3 Spike-Timing Dependent Plasticity|Spike-Timing Dependent Plasticity]]
- 4. How SNN Performance Is Measured
  - 4.1 [[Learning/4. How SNN Performance Is Measured/4.1 Accuracy, Latency, Spike Count, Energy, and Convergence|Accuracy, Latency, Spike Count, Energy, and Convergence]]
  - 4.2 [[Learning/4. How SNN Performance Is Measured/4.2 Normalized Energy Efficiency|Normalized Energy Efficiency]]
- 5. What the Results Say About Tradeoffs
  - 5.1 [[Learning/5. What the Results Say About Tradeoffs/5.1 Accuracy and Performance Across Models|Accuracy and Performance Across Models]]
  - 5.2 [[Learning/5. What the Results Say About Tradeoffs/5.2 Latency and Real-Time Response|Latency and Real-Time Response]]
  - 5.3 [[Learning/5. What the Results Say About Tradeoffs/5.3 Energy Use and Spike Efficiency|Energy Use and Spike Efficiency]]
  - 5.4 [[Learning/5. What the Results Say About Tradeoffs/5.4 Loss Convergence Across Training Paradigms|Loss Convergence Across Training Paradigms]]
  - 5.5 [[Learning/5. What the Results Say About Tradeoffs/5.5 Accuracy Learning Curves Over Time|Accuracy Learning Curves Over Time]]
- 6. Choosing an SNN Training Strategy
  - 6.1 [[Learning/6. Choosing an SNN Training Strategy/6.1 When to Prefer Surrogate, Conversion, or STDP|When to Prefer Surrogate, Conversion, or STDP]]
  - 6.2 [[Learning/6. Choosing an SNN Training Strategy/6.2 Open Challenges in Scalable Neuromorphic Deployment|Open Challenges in Scalable Neuromorphic Deployment]]

## Prerequisite Chain

- Start here -> Why Spiking Neural Networks Exist
- Why Spiking Neural Networks Exist -> How Spiking Neural Networks Are Structured
- How Spiking Neural Networks Are Structured -> How Spiking Neural Networks Learn
- How Spiking Neural Networks Learn -> How SNN Performance Is Measured
- How SNN Performance Is Measured -> What the Results Say About Tradeoffs
- What the Results Say About Tradeoffs -> Choosing an SNN Training Strategy

## Trunk, Branch, Leaf Concepts

- Trunk: Why Spiking Neural Networks Exist
  - Branch/leaf: Continuous Activations, Dense Computation, and the Energy Problem
  - Branch/leaf: Spikes, Timing, and Event-Driven Computation
  - Branch/leaf: Neuromorphic Hardware and Application Pressure
  - Branch/leaf: Why a Unified Comparison Is Needed
- Trunk: How Spiking Neural Networks Are Structured
  - Branch/leaf: The Leaky Integrate-and-Fire Neuron
  - Branch/leaf: Input Encoding, Excitation, Inhibition, and Winner-Take-All Competition
- Trunk: How Spiking Neural Networks Learn
  - Branch/leaf: Surrogate Gradient Descent
  - Branch/leaf: ANN-to-SNN Conversion
  - Branch/leaf: Spike-Timing Dependent Plasticity
- Trunk: How SNN Performance Is Measured
  - Branch/leaf: Accuracy, Latency, Spike Count, Energy, and Convergence
  - Branch/leaf: Normalized Energy Efficiency
- Trunk: What the Results Say About Tradeoffs
  - Branch/leaf: Accuracy and Performance Across Models
  - Branch/leaf: Latency and Real-Time Response
  - Branch/leaf: Energy Use and Spike Efficiency
  - Branch/leaf: Loss Convergence Across Training Paradigms
  - Branch/leaf: Accuracy Learning Curves Over Time
- Trunk: Choosing an SNN Training Strategy
  - Branch/leaf: When to Prefer Surrogate, Conversion, or STDP
  - Branch/leaf: Open Challenges in Scalable Neuromorphic Deployment

## Bridge Concepts

- Bridges are introduced where adjacent subsections share source anchors or concept tags.

## Warnings

- Readable continuous prose is available only through page 2 and is truncated there; later planning relies heavily on figure, table, graph, and formula metadata.
- Exact symbolic equations, variable names, graph axes, numerical series, and most table values are unavailable and must not be reconstructed.
- The LIF section is intentionally limited to the named model plus its membrane-potential visual; full governing equations and parameter derivations are deferred.
- Training paradigm sections must avoid algorithmic internals for surrogate gradients, ANN-to-SNN conversion, and STDP because the provided source map does not supply those procedures.
- Comparative claims should remain qualitative except for abstract-level values explicitly given in the source, including within 1-2% ANN accuracy, latency as low as 10 milliseconds, and STDP energy as low as 5 millijoules per inference.
- All central source visuals are assigned exactly once in `sourceVisualsToEmbed`; none are deliberately omitted.
- Interactive visuals are selective and should remain conceptual rather than numeric, because the source does not provide enough hidden detail for faithful simulation or exact curve reconstruction.
