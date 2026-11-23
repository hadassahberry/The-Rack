# The Rack: Android app (Trusted Web Activity)

Built with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) from the live manifest
(`https://the-rack-5787.web.app/manifest.webmanifest`). Package name: `com.therack`.

Tracked in git: `twa-manifest.json` (no secrets) and this file. **Everything else here is generated or secret and is
git-ignored: never commit or push it**, especially `android.keystore` (the signing key). Keep a backup of the keystore
and its passwords outside this repository: without them the app can never be updated on Google Play.

Rebuild (after `npm i -g @bubblewrap/cli`, once, with the JDK and Android SDK that `bubblewrap doctor` sets up):

    bubblewrap build        # asks for the keystore password; writes app-release-bundle.aab (upload this to Play)

Notes from the first build: `minSdkVersion` is 24 (the browser-helper library requires it); on a network that re-signs
HTTPS, run Java with `JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStoreType=Windows-ROOT`; the signing certificate's SHA-256
fingerprint goes in `../.well-known/assetlinks.json` (plus Google Play's app-signing key once the app is on Play).
