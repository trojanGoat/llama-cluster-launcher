# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Added minimize/collapse toggles to all major configuration panels ("Binaries & Model", "GPU & Context", "Additional Flags", and the Terminal).
- Added `.collapsed` CSS classes and animations for smoother UI interactions.

### Changed
- Reorganized the main GUI layout for better ergonomics:
  - Moved the **Launch Master** button directly below the "Tokens Today" counter for easier access.
  - Moved **System Preferences**, **Broadcast Monitor**, **Execution Modes**, and **Network** controls to the bottom of the main form area, just above the Command Preview.
- Improved terminal parsing: the UI terminal now properly stream-buffers `llama.cpp` standard output and correctly handles carriage returns (`\r`), preventing the DOM from lagging/freezing when thousands of progress dots are output during massive model loads (like Gemma 26B).

### Fixed
- Fixed an issue where the "Save Preset" button failed silently. The `setupBroadcastServer` and `syncClusterState` functions were incorrectly nested, causing initialization errors that broke the preset saving logic.
- Fixed a critical token counting bug where the "Tokens Today" counter was double (or triple) counting tokens. The regex parser now strictly matches the `print_timings: total time` output block instead of incorrectly adding `n_decoded`, `tokens_predicted`, and `eval time` logs from the same request.
