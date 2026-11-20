// Switches for features that need something set up first.
//
// linkImport: "Add from a link" needs the server function in /functions (see functions/README.md),
// which needs the paid Firebase Blaze plan, so it is OFF until that has been set up and approved.
// While it is off the button is hidden, so nobody meets a feature that can't work yet.
// To turn it on for everyone: set `linkImport: true` below after deploying the function.
//
// visionCheck: "Help me choose" can ask a vision model (Google Gemini, via the function in /functions) whether the
// pieces in each idea look good together. It needs the same Firebase Blaze plan and a Gemini API key kept as a
// server secret (functions/README.md), so it is OFF until those are set up and approved. While it is off,
// "Help me choose" works exactly as before and nothing is ever sent anywhere.
const RACK_FEATURES = {
    linkImport: false,
    visionCheck: false
};

// A feature is on when it is switched on above, or when this browser has it switched on for testing
// (localStorage 'rack_feature_<name>' = '1'). The testing switch only SHOWS the button; without the
// server function behind it the feature just explains that it isn't available.
function featureEnabled(name) {
    try { if (localStorage.getItem('rack_feature_' + name) === '1') return true; } catch (e) { /* storage unavailable */ }
    return !!RACK_FEATURES[name];
}

if (typeof module !== 'undefined') {
    module.exports = { RACK_FEATURES, featureEnabled };
}
