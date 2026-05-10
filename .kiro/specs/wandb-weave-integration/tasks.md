# Implementation Plan: Weights & Biases Weave Integration

## Overview

This implementation plan integrates the Weights & Biases Weave observability framework into the FitLock Chrome extension to track AI inference performance, prompt quality, and model behavior. The integration will instrument two inference paths: local AI models (Ollama/LM Studio/GPT4All) and Gemini Nano built-in AI.

## Tasks

- [ ] 1. Install Weave SDK and create configuration module
  - Install `@wandb/weave` npm package as a dependency
  - Create `chrome-extension/src/background/weave-config.js` with configuration object (project name, API key, enabled flag)
  - Export configuration with clear comments explaining each field
  - _Requirements: 1.1, 1.2, 13.1, 13.2, 13.3, 13.4, 13.5_

- [ ] 2. Initialize Weave client in background script
  - [ ] 2.1 Import Weave SDK and configuration in background.js
    - Add import statements for Weave SDK and configuration module
    - _Requirements: 1.1, 13.1_
  
  - [ ] 2.2 Create Weave initialization function with error handling
    - Implement `initWeave()` function that initializes Weave client with project identifier
    - Add try-catch block to handle initialization failures gracefully
    - Log initialization status (success or failure) to console
    - Set global flag to disable Weave logging if initialization fails
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 10.1, 10.3, 10.4, 10.5_
  
  - [ ] 2.3 Call initialization on background script startup
    - Call `initWeave()` at the top level of background.js
    - _Requirements: 1.1, 1.4_

- [ ] 3. Checkpoint - Verify Weave initialization
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Instrument local AI inference tracking
  - [ ] 4.1 Create Weave logging wrapper for localAiInference
    - Wrap `localAiInference` function to capture start time
    - Log input parameters: model name, system prompt, user prompt (title and description)
    - Log output: raw response text, parsed JSON verdict, inference duration
    - Log metadata: server type (ollama/lmstudio/gpt4all), timestamp, success/failure status
    - Add try-catch to ensure logging failures don't break inference
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 10.1, 10.3_
  
  - [ ] 4.2 Add JSON parsing quality metrics
    - Track whether JSON parsing succeeded
    - Log parsing method used (json_match, includes_fallback, or failed)
    - Log raw response text when parsing fails
    - Track whether response contained expected verdict field
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [ ]* 4.3 Write unit tests for local AI inference tracking
    - Test successful inference logging
    - Test failed inference logging
    - Test parsing failure scenarios
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 5. Checkpoint - Verify local AI tracking
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Gemini Nano inference tracking
  - [ ] 6.1 Add tracking data collection in AI bridge
    - Modify `youtube_ai_bridge.js` to capture inference start time
    - Capture input parameters: video title, description, system prompt
    - Capture output: raw response text, inference duration
    - Send tracking data via postMessage to content script
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [ ] 6.2 Forward tracking data from content script to background
    - Modify `youtube_content.js` to listen for tracking data from AI bridge
    - Forward tracking data to background script via chrome.runtime.sendMessage
    - _Requirements: 3.2_
  
  - [ ] 6.3 Create Weave logging handler in background script
    - Add message listener in background.js for Gemini Nano tracking data
    - Parse isProductive boolean from response
    - Tag inference with category "gemini_nano_youtube_classification"
    - Log all data to Weave with error handling
    - _Requirements: 3.3, 3.4, 3.5, 10.1, 10.3_
  
  - [ ]* 6.4 Write unit tests for Gemini Nano tracking
    - Test tracking data flow from bridge to background
    - Test successful Gemini inference logging
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 7. Implement performance metrics tracking
  - [ ] 7.1 Add latency and throughput metrics
    - Log inference duration in milliseconds for all inference types
    - Log time-to-first-token when available from streaming responses
    - Log total tokens processed when available from model response metadata
    - Calculate and log tokens per second when both token count and duration are available
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ] 7.2 Add queue wait time tracking
    - Track queue wait time when inference is delayed due to rate limiting
    - _Requirements: 4.5_

- [ ] 8. Implement cache performance tracking
  - [ ] 8.1 Add cache hit/miss tracking in YouTube content script
    - Modify `analyzeCurrentVideo` to log whether verdict came from cache
    - Send cache hit/miss events to background script
    - _Requirements: 6.1_
  
  - [ ] 8.2 Implement cache metrics aggregation in background script
    - Maintain counters for cache hits and misses per session
    - Calculate cache hit rate as a percentage
    - Log cache size (number of cached verdicts) periodically
    - Tag cached verdicts with "source: cache" in Weave logs
    - _Requirements: 6.2, 6.3, 6.4, 6.5_
  
  - [ ]* 8.3 Write unit tests for cache tracking
    - Test cache hit logging
    - Test cache miss logging
    - Test cache hit rate calculation
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 9. Checkpoint - Verify performance and cache tracking
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement metadata scraping performance tracking
  - [ ] 10.1 Add scraping duration tracking in YouTube content script
    - Modify `scrapeMetadata` to measure scraping duration in milliseconds
    - Track retry count and source selector used
    - Track whether DOM was ready immediately or required retries
    - Send scraping metrics to background script
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  
  - [ ] 10.2 Add scraping failure tracking
    - Log failure reason when scraping fails after max retries
    - _Requirements: 14.5_
  
  - [ ]* 10.3 Write unit tests for metadata scraping tracking
    - Test successful scraping metrics
    - Test scraping failure logging
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 11. Implement inference trigger context tracking
  - [ ] 11.1 Add trigger context to all inference calls
    - Log trigger type (initial_load, spa_navigation, mutation_observer, cache_hit)
    - Log URL or video ID that triggered the inference
    - Log whether user was on /watch page or other YouTube page
    - Log time elapsed since previous inference call
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  
  - [ ]* 11.2 Write unit tests for trigger context tracking
    - Test trigger type logging for different scenarios
    - Test time elapsed calculation
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 12. Implement model configuration change tracking
  - [ ] 12.1 Add configuration change logging
    - Listen for storage changes in background script
    - Log when user selects different local AI server
    - Log when user selects different model
    - Log previous and new configuration values
    - Tag subsequent inference calls with active configuration
    - Log AI backend type (gemini or ollama) at initialization
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [ ]* 12.2 Write unit tests for configuration change tracking
    - Test server change logging
    - Test model change logging
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 13. Create evaluation dataset and runner
  - [ ] 13.1 Create evaluation dataset module
    - Create `chrome-extension/src/background/evaluation-dataset.js`
    - Define hardcoded dataset with 10-15 example videos
    - Include title, description, expected verdict (productive/distracting), category for each example
    - Include diverse examples: clearly productive, clearly distracting, edge cases
    - Export dataset as JSON array
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [ ] 13.2 Implement evaluation runner in background script
    - Add message listener for "runEvaluation" action
    - Execute inference on all evaluation dataset examples
    - Compare model verdict with expected verdict for each example
    - Calculate accuracy as (correct predictions / total examples)
    - Log evaluation results to Weave with timestamp and model configuration
    - Return evaluation results to caller
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [ ]* 13.3 Write unit tests for evaluation runner
    - Test evaluation execution
    - Test accuracy calculation
    - Test evaluation result logging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 14. Checkpoint - Verify evaluation system
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Add Weave dashboard link to popup UI
  - [ ] 15.1 Modify popup UI to include dashboard link
    - Add link to Weave project dashboard in popup.html
    - Link should open "https://wandb.ai/shivhedaoo7-none/Fitlock/weave" in new tab
    - Display link in Config section with text "View Inference Analytics"
    - Style link consistently with other popup UI elements
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  
  - [ ]* 15.2 Write UI tests for dashboard link
    - Test link opens correct URL
    - Test link styling
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 16. Implement session-level metrics aggregation
  - [ ] 16.1 Create session metrics tracker
    - Track parse success rate aggregated over session
    - Track total inference count per session
    - Track inference count by type (local AI, Gemini Nano)
    - Log session summary metrics periodically
    - _Requirements: 5.5_
  
  - [ ]* 16.2 Write unit tests for session metrics
    - Test parse success rate calculation
    - Test inference count tracking
    - _Requirements: 5.5_

- [ ] 17. Add comprehensive error handling and logging
  - [ ] 17.1 Wrap all Weave logging calls with try-catch
    - Ensure no Weave logging call can throw unhandled exceptions
    - Log errors to console when Weave logging fails
    - Do not retry failed Weave logging calls
    - _Requirements: 10.1, 10.2, 10.3_
  
  - [ ] 17.2 Add Weave disabled warning
    - Log warning message when Weave logging is disabled due to initialization failure
    - _Requirements: 10.5_
  
  - [ ]* 17.3 Write unit tests for error handling
    - Test graceful handling of Weave initialization failures
    - Test graceful handling of Weave logging failures
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 18. Final checkpoint and integration testing
  - [ ] 18.1 Test complete integration end-to-end
    - Test local AI inference tracking with Ollama
    - Test Gemini Nano inference tracking (if available)
    - Verify all metrics are logged to Weave dashboard
    - Verify cache tracking works correctly
    - Verify evaluation runner works correctly
    - _Requirements: All_
  
  - [ ] 18.2 Verify graceful degradation
    - Test extension works when Weave initialization fails
    - Test extension works when Weave logging fails
    - Verify core functionality is not affected by tracking failures
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- All Weave logging must be wrapped in try-catch to ensure graceful degradation
- The integration should never break core extension functionality
- Focus on comprehensive observability across both inference paths (local AI and Gemini Nano)
