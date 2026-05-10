# Design Document: Weights & Biases Weave Integration

## Overview

This design document specifies the integration of Weights & Biases (W&B) Weave observability framework into the FitLock Chrome extension. The integration will provide comprehensive tracking and analysis of AI inference performance, prompt quality, and model behavior across three inference paths: local AI models (Ollama/LM Studio/GPT4All), Reddit NSFW classification, and Gemini Nano built-in AI.

### Goals

- **Observability**: Track all AI inference calls with detailed metrics (latency, token usage, parsing success)
- **Performance Analysis**: Identify bottlenecks in metadata scraping, inference execution, and response parsing
- **Prompt Quality**: Measure parsing success rates and identify when models produce unparseable responses
- **Cache Efficiency**: Track cache hit rates to measure redundant inference reduction
- **Model Comparison**: Enable data-driven comparison between Gemini Nano and local AI models
- **Graceful Degradation**: Ensure tracking failures never break core extension functionality

### Non-Goals

- Real-time streaming of inference data (batch logging is sufficient)
- User-facing analytics dashboard (Weave UI provides this)
- Automatic model selection based on performance metrics
- Training or fine-tuning of AI models

## Architecture

### High-Level Architecture

```mermaid
graph TB
    subgraph "Content Scripts"
        YT[YouTube Content Script]
        RD[Reddit Content Script]
        BR[AI Bridge Main World]
    end
    
    subgraph "Background Script"
        BG[Background Service Worker]
        WC[Weave Client]
        LA[Local AI Inference]
        RA[Reddit AI Inference]
    end
    
    subgraph "External Services"
        OL[Ollama/LM Studio/GPT4All]
        GN[Gemini Nano API]
        WB[W&B Weave Backend]
    end
    
    YT -->|metadata + request| BR
    BR -->|inference via postMessage| GN
    BR -->|tracking data| YT
    YT -->|tracking data| BG
    
    RD -->|inference request| BG
    
    BG -->|HTTP inference| LA
    LA -->|HTTP| OL
    
    BG -->|HTTP inference| RA
    RA -->|HTTP| OL
    
    BG -->|log traces| WC
    WC -->|HTTPS| WB
    
    style WC fill:#e1f5ff
    style WB fill:#e1f5ff
