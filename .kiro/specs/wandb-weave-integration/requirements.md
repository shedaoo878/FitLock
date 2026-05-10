# Requirements Document

## Introduction

This document specifies the requirements for integrating Weights & Biases (wandb) Weave into the FitLock Chrome extension to track and analyze AI inference efficiency and prompt quality. FitLock uses AI models (Gemini Nano or local models via Ollama/LM Studio/GPT4All) to classify YouTube videos as productive or distracting. The integration will provide observability into inference performance, prompt effectiveness, and model behavior to enable data-driven optimization.

## Glossary

- **Weave**: Weights & Biases' lightweight observability framework for tracking LLM applications
- **Inference_Call**: A single request to an AI model (Gemini Nano or local model) to classify content
- **Content_Script**: JavaScript code injected into YouTube web pages that triggers AI analysis
- **Background_Script**: Chrome extension service worker that handles local AI inference via HTTP
- **AI_Bridge**: Main-world script that accesses Gemini Nano API (blocked in extension context)
- **Verdict_Cache**: Session-scoped map storing AI classification results to avoid redundant inference
- **Local_AI_Server**: HTTP server running locally (Ollama, LM Studio, or GPT4All) providing inference endpoints
- **Smart_Lock**: Feature that blocks distracting content until fitness goals are met
- **Weave_Client**: wandb Weave SDK instance initialized with project configuration
- **Traced_Function**: Function decorated with `@weave.op` to automatically log inputs, outputs, and metadata
- **Evaluation_Metric**: Quantitative measure of inference quality (latency, token count, accuracy)

## Requirements

### Requirement 1: Initialize Weave Client

**User Story:** As a developer, I want Weave to initialize when the extension starts, so that all inference calls are tracked from the beginning of the session.

#### Acceptance Criteria

1. WHEN the Chrome extension background script loads, THE Weave_Client SHALL initialize with project identifier "shivhedaoo7-none/Fitlock"
2. THE Weave_Client SHALL use API key "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" for authentication
3. IF Weave initialization fails, THEN THE Background_Script SHALL log the error and continue operation without tracking
4. THE Weave_Client SHALL remain active for the lifetime of the background script process

### Requirement 2: Track Local AI Inference Calls

**User Story:** As a developer, I want to track all local AI inference calls (Ollama/LM Studio/GPT4All), so that I can analyze performance and prompt effectiveness.

#### Acceptance Criteria

1. WHEN the `localAiInference` function is called, THE Background_Script SHALL log the inference request to Weave
2. THE Background_Script SHALL capture input parameters: model name, system prompt, user prompt (title and description)
3. THE Background_Script SHALL capture output: raw response text, parsed JSON verdict, inference duration in milliseconds
4. THE Background_Script SHALL capture metadata: server type (ollama/lmstudio/gpt4all), timestamp, success/failure status
5. IF inference fails, THEN THE Background_Script SHALL log the error message and error type to Weave

### Requirement 3: Track Gemini Nano Inference Calls

**User Story:** As a developer, I want to track Gemini Nano inference calls from the AI bridge, so that I can compare built-in AI performance with local models.

#### Acceptance Criteria

1. WHEN the AI_Bridge receives an inference request, THE AI_Bridge SHALL send tracking data to the Content_Script
2. THE Content_Script SHALL forward tracking data to the Background_Script for Weave logging
3. THE Background_Script SHALL capture input parameters: video title, description, system prompt
4. THE Background_Script SHALL capture output: raw response text, parsed isProductive boolean, inference duration in milliseconds
5. THE Background_Script SHALL tag the inference with category "gemini_nano_youtube_classification"

### Requirement 4: Log Inference Performance Metrics

**User Story:** As a developer, I want to track inference latency and throughput, so that I can identify performance bottlenecks.

#### Acceptance Criteria

1. FOR ALL inference calls, THE Background_Script SHALL log inference duration in milliseconds
2. THE Background_Script SHALL log time-to-first-token when available from streaming responses
3. THE Background_Script SHALL log total tokens processed when available from model response metadata
4. THE Background_Script SHALL log tokens per second when token count and duration are both available
5. THE Background_Script SHALL log queue wait time when inference is delayed due to rate limiting

### Requirement 5: Log Prompt Quality Metrics

**User Story:** As a developer, I want to track prompt parsing success rates, so that I can identify when models produce unparseable responses.

#### Acceptance Criteria

1. FOR ALL inference calls, THE Background_Script SHALL log whether JSON parsing succeeded
2. THE Background_Script SHALL log the parsing method used (json_match, includes_fallback, or failed)
3. IF JSON parsing fails, THEN THE Background_Script SHALL log the raw response text for debugging
4. THE Background_Script SHALL log whether the response contained the expected verdict field (isProductive)
5. THE Background_Script SHALL calculate and log a "parse_success_rate" metric aggregated over the session

### Requirement 6: Track Verdict Cache Performance

**User Story:** As a developer, I want to track cache hit rates, so that I can measure how effectively caching reduces redundant inference calls.

#### Acceptance Criteria

1. WHEN a video is analyzed, THE Content_Script SHALL log whether the verdict came from cache or required inference
2. THE Background_Script SHALL maintain a counter of cache hits and cache misses per session
3. THE Background_Script SHALL calculate and log cache hit rate as a percentage
4. THE Background_Script SHALL log the cache size (number of cached verdicts) periodically
5. THE Background_Script SHALL tag cached verdicts with "source: cache" in Weave logs

### Requirement 7: Create Basic Evaluation Dataset

**User Story:** As a developer, I want to create a small evaluation dataset with known-good classifications, so that I can measure model accuracy.

#### Acceptance Criteria

1. THE Background_Script SHALL define a hardcoded evaluation dataset with 10-15 example videos
2. FOR EACH example, THE dataset SHALL include: title, description, expected verdict (productive/distracting), category
3. THE dataset SHALL include diverse examples: clearly productive, clearly distracting, edge cases
4. THE dataset SHALL be stored as a JSON array in a separate evaluation module
5. THE evaluation dataset SHALL be version-controlled and updatable without code changes

### Requirement 8: Run Basic Evaluation on Demand

**User Story:** As a developer, I want to run evaluations on demand, so that I can test model accuracy after configuration changes.

#### Acceptance Criteria

1. WHEN a "runEvaluation" message is received, THE Background_Script SHALL execute inference on all evaluation dataset examples
2. FOR EACH example, THE Background_Script SHALL compare the model verdict with the expected verdict
3. THE Background_Script SHALL calculate accuracy as (correct predictions / total examples)
4. THE Background_Script SHALL log evaluation results to Weave with timestamp and model configuration
5. THE Background_Script SHALL return evaluation results to the caller (popup or content script)

### Requirement 9: Log Model Configuration Changes

**User Story:** As a developer, I want to track when users change AI models or servers, so that I can correlate configuration with performance metrics.

#### Acceptance Criteria

1. WHEN a user selects a different local AI server, THE Background_Script SHALL log the change to Weave
2. WHEN a user selects a different model, THE Background_Script SHALL log the change to Weave
3. THE Background_Script SHALL log the previous and new configuration values
4. THE Background_Script SHALL tag subsequent inference calls with the active configuration
5. THE Background_Script SHALL log AI backend type (gemini or ollama) at initialization

### Requirement 10: Handle Weave Logging Failures Gracefully

**User Story:** As a developer, I want the extension to continue working if Weave logging fails, so that tracking issues don't break core functionality.

#### Acceptance Criteria

1. IF a Weave logging call fails, THEN THE Background_Script SHALL log the error to console and continue execution
2. THE Background_Script SHALL NOT retry failed Weave logging calls to avoid performance degradation
3. THE Background_Script SHALL NOT throw exceptions from Weave logging code that would crash the background script
4. IF Weave initialization fails, THEN THE Background_Script SHALL disable all Weave logging for the session
5. THE Background_Script SHALL log a warning message when Weave logging is disabled

### Requirement 11: Provide Weave Dashboard Access

**User Story:** As a developer, I want easy access to the Weave dashboard, so that I can view tracked metrics without searching for URLs.

#### Acceptance Criteria

1. THE extension popup SHALL display a link to the Weave project dashboard
2. THE link SHALL open "https://wandb.ai/shivhedaoo7-none/Fitlock/weave" in a new tab when clicked
3. THE link SHALL be visible in the Config section of the popup
4. THE link SHALL display the text "View Inference Analytics" or similar
5. THE link SHALL be styled consistently with other popup UI elements

### Requirement 12: Log Inference Trigger Context

**User Story:** As a developer, I want to know what triggered each inference call, so that I can understand user behavior patterns.

#### Acceptance Criteria

1. FOR ALL inference calls, THE Background_Script SHALL log the trigger type (initial_load, spa_navigation, mutation_observer, cache_hit)
2. THE Background_Script SHALL log the URL or video ID that triggered the inference
3. THE Background_Script SHALL log whether the user was on a /watch page or other YouTube page
4. THE Background_Script SHALL log the time elapsed since the previous inference call

### Requirement 13: Export Weave Configuration

**User Story:** As a developer, I want Weave configuration to be easily modifiable, so that I can change project names or API keys without editing multiple files.

#### Acceptance Criteria

1. THE Background_Script SHALL load Weave configuration from a dedicated configuration object
2. THE configuration object SHALL include: project name, API key, enabled flag
3. THE configuration object SHALL be defined at the top of the background script file
4. THE configuration object SHALL include comments explaining each field
5. WHERE Weave is disabled via configuration, THE Background_Script SHALL skip all Weave initialization and logging

### Requirement 14: Track Metadata Scraping Performance

**User Story:** As a developer, I want to track how long metadata extraction takes, so that I can optimize scraping logic if it becomes a bottleneck.

#### Acceptance Criteria

1. WHEN metadata is scraped from a YouTube page, THE Content_Script SHALL measure scraping duration in milliseconds
2. THE Content_Script SHALL log scraping duration, retry count, and source selector used to Weave
3. THE Content_Script SHALL log whether the DOM was ready immediately or required retries
4. THE Content_Script SHALL log the video ID being scraped
5. IF scraping fails after max retries, THEN THE Content_Script SHALL log the failure reason to Weave
