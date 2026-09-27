# Product feedback

Every tool, API and SDK Mantel uses, what it was used for, what worked, what needs work, how onboarding felt, and whether I would build with it again.

---

## Fire TV (Fire OS)

**Used for:** the product's main surface. A Kotlin app (minSdk 25) with a full-screen WebView running the React TV interface from the APK's assets, CameraX presence from a USB webcam, on-device speech, text-to-speech, screen dimming, and a care-mode library.

**What worked well.** Fire OS behaves like Android, so the AndroidX stack (WebView asset loader, CameraX) applies unchanged, and a web interface inside a WebView made the 10-foot UI fast to iterate in a desktop browser and identical on the TV. The Cube's UVC webcam support, made for video calling, is exactly the hardware a presence feature needs.

**What needs work.**
- Vega tooling on Windows, and an emulator for Fire OS: friction log 1 and 2.
- Developer documentation for external cameras on the Cube: friction log 3.
- A care or assisted-living mode, and an app-level speech API: friction log 4 and 5. For accessibility apps these are the difference between a demo and a product a family can install.

**Onboarding.** The first build ran on the Android TV emulator after two fixes, both about the WebView: the asset loader strips its path prefix before looking up a file, and a page served from the APK's https origin needs mixed content allowed to reach a household server on plain http. Most of the setup effort went into deciding between Vega and Fire OS on Windows.

**Would I build with it again?** Yes. The TV is the screen older people face most, and Fire TV reaches it with a normal Android toolchain. A care mode would make it the obvious platform for this category.

## Vega OS (documentation)

**Used for:** reading. The Vega API overview, the Vega developer guide and the forum answered the platform questions (speech recognition, hardware access) that decided the Fire OS path.

**What worked well.** The forum answered directly and quickly, with an Amazon engineer stating what the platform does not expose, which is the answer a developer needs to plan.

**What needs work.** Windows support for the Vega Developer Tools (friction log 1).

## Ring Partner API

**Used for:** the doorbell press (`button_press`), outside-door contact sensors (`contact_sensor_faulted` and `_cleared`), and the image download for the frame at the press.

**What worked well.** The webhook contract is specific: HMAC-SHA256 over the raw body in `X-Signature`, idempotency on `meta.request_id`, a five-second budget, and complete v1.1 payload examples for each event. Building a simulator that speaks the same contract was straightforward, so the demo exercises the production webhook path over HTTP. The two-step image download (303 to a pre-signed URL) is well explained, including the warning to always name the camera module on multi-camera devices.

**What needs work.** The whole reference is one very long page; a per-event page (or anchors that survive in search results) would make the payload examples easier to reach.

**Would I build with it again?** Yes. A doorbell press with a snapshot is the right primitive for "who is at the door, and was anyone expected".

## Amazon Bedrock

**Used for:** drafts in the family app: photo captions from the facts typed, and a calmer wording of an answer a family member wrote. Through the Bedrock API endpoint (chat completions with a bearer token from `@aws/bedrock-token-generator`) with `openai.gpt-oss-120b`, and the runtime SDK's `Converse` as the alternative path.

**What worked well.** The API endpoint takes the OpenAI-compatible request shape, so the client is a few lines; bearer tokens minted locally from the normal credential chain need no extra secret. Latency of 1.3 to 4 seconds suits a draft a person then reads.

**What needs work.** The empty answer at a normal token budget (friction log 6). And a finding for product builders: a model given counts to summarise replaced them with "many" and added readings no count supports, so Mantel's digest stays a template ([MODEL.md](MODEL.md)).

**Would I build with it again?** Yes, for drafts a person approves.

## Amazon Polly

**Used for:** the household voice: answers a family member wrote but did not record, synthesised once per line and cached.

**What worked well.** Neural voices read times naturally ("four o'clock", "half past four"), which matters when the listener is confused. 410 ms for a sentence, so first-time synthesis during an answer is acceptable and every repeat is a cache hit.

**What needs work.** Nothing blocked.

**Would I build with it again?** Yes.

## Amazon DynamoDB, AWS Lambda, API Gateway, S3, CloudFront, EventBridge, Secrets Manager, AWS CDK

**Used for:** the deployable backend ([AWS.md](AWS.md)). One DynamoDB table with version-checked household documents and a TTL on Ring receipts; Lambda behind an HTTP API holding the TV's 20-second long-poll; S3 for media and the web apps behind CloudFront; EventBridge for the five-minute tick; Secrets Manager for the Ring signing secret; everything in CDK with assertion tests.

**What worked well.** DynamoDB Local ran the store's tests against the real engine, including concurrent conditional writes. CDK's `NodejsFunction` bundled the TypeScript server to ESM with esbuild and copied the demo fixtures in a bundling hook, and the bundle ran unchanged when invoked locally with API Gateway v2 events.

**What needs work.** `NodejsFunction`'s ESM output needs a `createRequire` banner for CommonJS dependencies, which is easy to miss; a flag for it would help.

**Would I build with it again?** Yes.
