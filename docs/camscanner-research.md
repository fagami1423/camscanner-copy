# CamScanner: public-source research notes

Date written: 2026-10-17. Subject: CamScanner, the document-scanner app from INTSIG.

**Scope boundary.** No CamScanner binary (APK/IPA) was obtained or analysed. Everything below comes from public web pages. Each claim about CamScanner ends with `[public: URL]` (the page was fetched and the claim read there) or `[unknown — needs binary]`. Pages are live and change; the privacy policy was read on 2026-10-17. Section 4 describes our own project and needs no citation.

## 1. Scan pipeline

- CamScanner's developer page says its API "automatically detect[s] page borders and smartly remove[s] background". [public: https://dev.camscanner.com/]
- The same page says it offers "up to five modes" to make content clearer and more readable. [public: https://dev.camscanner.com/]
- The page lists "Scan documents offline" as a feature but does not say where processing runs. [public: https://dev.camscanner.com/]
- Algorithms used for edge detection (classical vs. learned), perspective correction, enhancement, and OCR in the app: [unknown — needs binary]
- Whether OCR runs on-device or on servers in the app: [unknown — needs binary]. The privacy policy says uploaded content is processed for storage and technical functions "such as OCR recognition", which indicates at least some server-side processing of files users upload. [public: https://v3.camscanner.com/web/privacy]

Typical approach, not confirmed for CamScanner: grayscale, blur, Canny edges, contour finding, a four-corner polygon, perspective warp, then background normalisation and thresholding for "black and white" output. Our spec uses this approach (spec section 3), chosen as a generic technique, not as a reconstruction of CamScanner.

## 2. Network/API and cloud model

- Account: registration uses a password plus email or phone, or a linked social login (Google, Facebook, Apple ID). Login tokens are kept for 3 months from login. [public: https://v3.camscanner.com/web/privacy]
- Cloud sync: files the user chooses to sync are copied to CamScanner's servers and kept until the user deletes them or the account. [public: https://v3.camscanner.com/web/privacy]
- Third-party sync/export targets named: Dropbox, Evernote, Google Drive, OneDrive/OneNote, Box; payments via Apple Pay and Google Pay. [public: https://v3.camscanner.com/web/privacy]
- Analytics/ads: Firebase is named as an SDK provider for analytics; advertising partners including Google may receive non-identifying data such as the advertising ID. [public: https://v3.camscanner.com/web/privacy]
- Data location: EEA user data is stored in Ireland, US user data in the United States. [public: https://v3.camscanner.com/web/privacy]
- Policy version read: last updated 2026-07-20, effective 2026-08-19. [public: https://v3.camscanner.com/web/privacy]
- A separate developer API exists. [public: https://dev.camscanner.com/] Its endpoints and payloads, and those of the consumer app: [unknown — needs binary]
- Complete SDK inventory of current app versions (the policy names only some): [unknown — needs binary]
- Which data is sent when the user does not sync (telemetry, device identifiers, images): [unknown — needs binary]

## 3. Privacy and security history

- On 2019-08-27 Kaspersky (Securelist, Igor Golovin and Anton Kivva) reported that CamScanner for Android contained "an advertising library... that contains a malicious dropper component", detected as `Trojan-Dropper.AndroidOS.Necro.n`. [public: https://securelist.com/dropper-in-google-play/92496/]
- Per Kaspersky, on launch the dropper decrypts and runs code from a resource file (`mutter.zip`), decrypts a configuration file (`comparison`) holding server addresses, and downloads and runs a further module. That module's job is to download and launch a payload. [public: https://securelist.com/dropper-in-google-play/92496/]
- Kaspersky listed possible payloads, including intrusive advertising and charging paid subscriptions, and presented them as possible uses, not confirmed observations. [public: https://securelist.com/dropper-in-google-play/92496/]
- Kaspersky said a similar module had earlier been found in preinstalled malware on Chinese-made phones, and suggested the library may have come from a partnership with an unscrupulous advertiser. [public: https://securelist.com/dropper-in-google-play/92496/]
- Kaspersky reported the findings to Google and wrote that the app "was promptly removed from the Google Play". [public: https://securelist.com/dropper-in-google-play/92496/]
- Security Affairs (reporting the same story) wrote that the developers removed the malicious code in the latest update, that versions vary by device so some may still contain it, that the paid version lacked the third-party ad library, and cited more than 100 million Google Play downloads. [public: https://securityaffairs.com/90454/malware/camscanner-app-malware.html]
- A statement from INTSIG itself: none was found in the fetched pages. The Securelist article contains no developer statement. [unknown — needs binary]
- Exact affected version numbers: not given in the fetched sources. [unknown — needs binary]
- Whether any current version contains comparable components: [unknown — needs binary]

## 4. How this clone differs

See `docs/superpowers/specs/2026-10-16-web-doc-scanner-design.md`.

- Local-only storage; no accounts, cloud sync, or subscriptions.
- A CSP blocks all non-self network requests, enforced by response header where the host supports it (config shipped: a generated `_headers` file and an nginx snippet in `docs/deploy.md`); page-level meta otherwise. The app works offline after first load (offline PWA).
- No third-party SDKs, analytics, or ad libraries.
- Edge detection, warp, enhancement and OCR run on-device (OpenCV.js and Tesseract.js in workers, self-hosted; the CSP allows only `wasm-unsafe-eval` for script).
- OpenCV.js (embind) generates some helper functions with `new Function`, which a CSP without `'unsafe-eval'` forbids. `build/opencvNoEval.ts` rewrites those four code-generation sites (`createNamedFunction`, `makeDynCaller`, `craftInvokerFunction`, `__emval_get_method_caller`) into closures at build time, and fails the build if a site is missing or any `new Function`/`eval(` remains in the OpenCV chunk. This was chosen over loosening the CSP.

## 5. Open questions and how to resolve them with an APK

Open questions: pipeline algorithms and models; on-device vs. server OCR; endpoints and payloads; SDK inventory; data sent without sync; current-version status of the 2019 issue.

Suggested method, for auditing an app you have installed and are entitled to inspect (no circumvention of protections, licensing or DRM):

1. **Obtain the APK** from the device you installed it on (for example `adb shell pm path <package>` then `adb pull`), and record version and SHA-256.
2. **Manifest and permissions**: decode the manifest (apktool or `aapt dump badging`); list permissions, exported components, and declared services/receivers. Library names in the manifest give a first SDK inventory.
3. **Static review**: open the APK in JADX; list third-party package namespaces, search for hard-coded hostnames and URL paths, and locate native libraries (`lib/*.so`) used for image processing. Compare any ad-library code against the behaviours Kaspersky described (encrypted resource, config file, downloaded module).
4. **Network capture on a device you control**: route traffic through a proxy such as mitmproxy or a local VPN-based capture, with a fresh account. Run scenarios (offline scan only, signed-out, signed-in without sync, sync enabled) and log hosts, request frequency and payload types. Where the app pins certificates and traffic is unreadable, record destination hosts and sizes only and treat contents as unknown.
5. **Record findings** in this document, replacing `[unknown — needs binary]` tags with an evidence note (tool, version, date).
