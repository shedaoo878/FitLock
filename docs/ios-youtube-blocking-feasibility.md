# iOS YouTube Smart Blocking — Feasibility Assessment

## Context

FitLock is currently a **Chrome extension** that blocks distracting websites until the user
completes their daily Strava running goal. It has a sophisticated "Smart Lock" feature for
YouTube that:

1. Intercepts YouTube video navigation (via content scripts on `youtube.com`)
2. Scrapes video metadata (title, channel, description) from the DOM
3. Sends metadata to Chrome's built-in Gemini Nano AI model for on-device classification
4. Classifies videos as "Productive" or "Distraction"
5. Blocks distracting videos with an overlay while allowing productive ones through

**Key files**: `youtube_content.js` (analysis pipeline), `youtube_ai_bridge.js` (AI inference),
`smartlock_logger.js` (logging), `youtube_content.css` (overlay UI)

The question: **Can this same smart, per-video blocking be replicated on iOS?**

---

## Short Answer

**No — not with the same level of granularity.** iOS fundamentally prevents a third-party app
from knowing which specific YouTube video a user is watching inside the YouTube app, and
therefore cannot run an AI model to classify and selectively block individual videos. However,
there are partial approaches and a promising new iOS 26 API.

---

## Detailed Analysis

### 1. Can a separate iOS app know which YouTube videos are being clicked on?

**No.** iOS sandboxing prevents apps from observing other apps' activity:

- **App sandbox**: Each iOS app runs in its own sandbox. A FitLock iOS app has zero visibility
  into what the YouTube app is doing — no access to its DOM, its URLs, its view hierarchy, or
  its network traffic.
- **HTTPS encryption**: Even at the network level, YouTube traffic is encrypted. A network filter
  can see that traffic goes to `youtube.com` but **cannot** see the specific video URL path
  (`/watch?v=XYZ`) because it's encrypted inside TLS.
- **No content script equivalent**: Unlike Chrome extensions that can inject JavaScript into web
  pages, iOS has no mechanism to inject code into another app's UI or webview.

### 2. Screen Time API (FamilyControls / ManagedSettings / DeviceActivity)

These frameworks allow **whole-app blocking**, not content-level filtering:

| Capability | Supported? |
|---|---|
| Block the entire YouTube app | Yes |
| Block YouTube at specific times | Yes (DeviceActivity schedules) |
| Block specific YouTube videos | **No** |
| Know which video the user is watching | **No** |
| Programmatically apply/remove shields | Yes (ManagedSettingsStore) |

**Critical limitations:**
- The API uses **opaque tokens** — your app never knows which specific apps are selected, only
  that the user picked them via `FamilyActivityPicker`
- Users can **easily revoke** Screen Time authorization for third-party apps via a simple Settings
  toggle (unlike passcode-protected native Screen Time)
- Token instability: iOS randomly changes app tokens, causing blocking rules to break
- Requires Apple entitlement approval (`com.apple.developer.family-controls`)

### 3. Network Extension Content Filter (NEFilterDataProvider)

This is the closest to network-level inspection, but still insufficient:

- **Can see**: Hostname/SNI (e.g., `youtube.com`), IP addresses, port numbers
- **Cannot see**: Full URL paths, query parameters, request bodies (all encrypted via TLS)
- **Result**: Can block ALL of YouTube, but cannot distinguish between different videos
- **iOS restriction**: Content filter network extensions require **supervised devices** (via
  MDM/Apple Configurator) — not viable for consumer App Store distribution

### 4. iOS 26 URL Filter API (WWDC 2025)

The most promising development, but with major caveats:

**What it does:**
- Filters system-wide HTTP/HTTPS requests based on the **full URL** (including path and query)
- Works on both managed and unmanaged devices
- Uses privacy-preserving cryptography (Bloom filters + PIR + Privacy Pass + OHTTP Relay)

**The catch — your app NEVER sees the URLs:**
- Filtering happens at the system level using a pre-compiled blocklist
- Your app provides a static dataset of URLs to block (like a Bloom filter)
- Your app does **not** execute in the filtering path
- **No dynamic AI classification possible** — only blocks URLs you know about in advance

**Could support**: A curated/updated blocklist of specific YouTube channel or video URLs.
**Cannot support**: Real-time AI-based classification of arbitrary new videos.

### 5. On-Device CoreML + Screen Time

CoreML can run on-device inference and trigger ManagedSettingsStore shields. But the **input
problem** remains:

- CoreML needs **input data** (video title, description) to classify
- On iOS, there's no way to get that input data from the YouTube app
- Without knowing what the user is watching, there's nothing for the model to classify

Only viable for **time/usage-pattern blocking** (e.g., "30 minutes on YouTube → block"), NOT
content-based blocking.

### 6. Safari/WebKit Content Blockers

If the user watches YouTube in **Safari** (not the YouTube app):

- Safari Content Blockers can block specific URL patterns (including YouTube video URLs)
- But they use static rule lists — no dynamic AI classification
- YouTube in Safari has a degraded experience (no background play, no PiP)
- Most users use the YouTube app, not Safari

---

## Feasibility Summary

| Approach | Detect Video Content? | Block Selectively? | App Store? | AI Classification? |
|---|---|---|---|---|
| Screen Time API | No | Whole app only | Yes | No (no input) |
| NEFilterDataProvider | Hostname only | Whole domain | No (supervised) | No |
| iOS 26 URL Filter | Full URL | Specific URLs | Yes | No (static list) |
| Safari Content Blocker | URL patterns | URL rules | Yes | No (static rules) |
| Safari Web Extension | Yes (DOM) | Per-video | Yes | Yes (on-device) |
| **Chrome Extension (current)** | **Yes (DOM)** | **Per-video** | **N/A** | **Yes (Gemini Nano)** |

---

## Realistic iOS Strategies

### Strategy A: Whole-App YouTube Blocking (Achievable Now)
Use Screen Time API to block/unblock the entire YouTube app based on Strava goal completion.
Same as current site-level blocking, just on iOS. No content-level intelligence — all or nothing.

### Strategy B: Safari Web Extension (Closest to Current UX)
Build a Safari Web Extension (similar architecture to current Chrome extension). Safari Web
Extensions can inject content scripts into web pages, scrape YouTube metadata, and run AI
classification. **Limitation**: Only works in Safari, not the YouTube app.

### Strategy C: Hybrid — Block Native App + Safari Smart Lock
Block the YouTube native app entirely via Screen Time API, then build a Safari Web Extension for
smart per-video blocking. Users are forced into Safari-YouTube where AI classification works.
This gives the closest experience to the current Chrome extension.

### Strategy D: iOS 26 URL Filter with Curated Blocklist (Fall 2025+)
Maintain a server-side database of "distraction" YouTube channel/video URL patterns. Push
updated Bloom filter to the app periodically. Block matching URLs system-wide via the new URL
Filter API. **Limitation**: Can't classify arbitrary new videos; only blocks known patterns.

---

## Recommendation

iOS's security model intentionally prevents the exact workflow that makes FitLock's Chrome Smart
Lock powerful (inject into YouTube → scrape metadata → classify with AI → block/allow).

**Most viable path forward:**
1. **Short term**: Whole-app YouTube blocking via Screen Time API (Strategy A)
2. **Medium term**: Hybrid approach — block YouTube app + Safari Web Extension (Strategy C)
3. **Long term**: iOS 26 URL Filter for curated blocklist (Strategy D)

---

## Sources
- [Apple Screen Time API Documentation](https://developer.apple.com/documentation/screentimeapidocumentation)
- [Developer's Guide to Screen Time APIs](https://medium.com/@juliusbrussee/a-developers-guide-to-apple-s-screen-time-apis-familycontrols-managedsettings-deviceactivity-e660147367d7)
- [Screen Time API Issues (2024)](https://riedel.wtf/state-of-the-screen-time-api-2024/)
- [iOS 26 URL Filter API](https://discuss.privacyguides.net/t/ios-26-will-have-network-level-traffic-filtering-for-all-apps/29903)
- [NEFilterDataProvider Documentation](https://developer.apple.com/documentation/networkextension/nefilterdataprovider)
- [Building an iOS App Blocker](https://medium.com/@jc_builds/building-a-powerful-ios-app-blocker-with-screen-time-apis-the-complete-guide-f6272bd00fc4)
