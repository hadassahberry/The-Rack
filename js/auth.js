// Sign-in gate: shows #auth-screen until signed in, then shows #app-shell.
// Store.setUid() is called here once, and window.waitForAuth() lets other
// files (closet.js, calendar.js) defer their first Firestore read/subscribe
// until a uid actually exists.
let authReadyUid = null;
let authReadyResolvers = [];

window.waitForAuth = function () {
    if (authReadyUid) return Promise.resolve(authReadyUid);
    return new Promise((resolve) => authReadyResolvers.push(resolve));
};

// isInfo = a neutral notice (e.g. "reset email sent") rather than an error.
function showAuthError(message, isInfo = false) {
    const el = document.getElementById('auth-error');
    el.textContent = message;
    el.classList.toggle('is-info', isInfo);
    el.classList.toggle('hidden', !message);
}

// The page opens on a neutral "Loading" screen (#auth-loading). It's replaced by the
// app or the sign-in form only once the first sign-in check has answered, so someone
// who is already signed in never sees the form flash by. If the check never answers,
// the sign-in form appears after this long, with a note, instead of an endless spinner.
const AUTH_CHECK_TIMEOUT_MS = 8000;
let authCheckDone = false;

function showSignedOutScreen(notice) {
    document.getElementById('auth-loading').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('account-menu').classList.add('hidden');
    // Never replace a notice that's already showing (e.g. "your account was deleted").
    if (notice && !document.getElementById('auth-error').textContent) showAuthError(notice, true);
}

const CANT_REACH_SIGN_IN = 'We can’t reach the sign-in service right now. Check your internet connection and reload the page.';

// The buttons wait for Firebase; if it failed to load, say so instead of doing nothing.
function signInServiceAvailable() {
    if (!window.firebaseFailed) return true;
    showAuthError(CANT_REACH_SIGN_IN);
    return false;
}

function friendlyAuthError(err) {
    const code = err && err.code ? err.code : '';
    if (code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('invalid-login-credentials')) return 'Incorrect email or password.';
    if (code.includes('user-not-found')) return 'No account found with that email.';
    if (code.includes('email-already-in-use')) return 'An account with that email already exists — try signing in instead.';
    if (code.includes('weak-password')) return 'Password should be at least 6 characters.';
    if (code.includes('invalid-email')) return 'That email address looks invalid.';
    if (code.includes('popup-closed-by-user')) return '';
    return 'Something went wrong — please try again.';
}

document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');

    // Set by js/account.js just before the page reloads after account deletion.
    try {
        if (sessionStorage.getItem('rack_account_deleted')) {
            sessionStorage.removeItem('rack_account_deleted');
            showAuthError('Your account and all of its data have been deleted.', true);
        }
    } catch (e) { /* sessionStorage unavailable: just skip the notice */ }

    // If Firebase never answers (or its script can't load), don't leave the spinner up.
    const authTimer = setTimeout(() => {
        if (!authCheckDone) showSignedOutScreen('We couldn’t restore your session. Please sign in again.');
    }, AUTH_CHECK_TIMEOUT_MS);
    const onFirebaseFailed = () => {
        if (!authCheckDone) { clearTimeout(authTimer); showSignedOutScreen(CANT_REACH_SIGN_IN); }
    };
    window.addEventListener('firebase-failed', onFirebaseFailed);
    if (window.firebaseFailed) onFirebaseFailed();

    waitForFirebase().then(({ auth, authFns }) => {
        authFns.onAuthStateChanged(auth, (user) => {
            authCheckDone = true;
            clearTimeout(authTimer);
            document.getElementById('auth-loading').classList.add('hidden');
            if (user) {
                Store.setUid(user.uid);
                document.getElementById('auth-screen').classList.add('hidden');
                document.getElementById('app-shell').classList.remove('hidden');
                document.getElementById('account-menu').classList.remove('hidden');
                document.getElementById('account-email').textContent = user.email || '';

                if (authReadyUid === null) {
                    authReadyUid = user.uid;
                    authReadyResolvers.forEach(r => r(user.uid));
                    authReadyResolvers = [];
                } else if (authReadyUid !== user.uid) {
                    // signed in as a different user mid-session — cleanest
                    // reset is a reload rather than unwinding every live
                    // subscription by hand.
                    location.reload();
                }
            } else {
                showSignedOutScreen();
                if (authReadyUid !== null) location.reload();
            }
        }, (err) => {
            // The check itself failed: show sign-in rather than hang.
            console.error('Sign-in check failed', err);
            authCheckDone = true;
            clearTimeout(authTimer);
            showSignedOutScreen('We couldn’t restore your session. Please sign in again.');
        });
    });

    document.getElementById('auth-signin-btn').addEventListener('click', async () => {
        showAuthError('');
        if (!signInServiceAvailable()) return;
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('auth-signup-btn').addEventListener('click', async () => {
        showAuthError('');
        if (!signInServiceAvailable()) return;
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('auth-google-btn').addEventListener('click', async () => {
        showAuthError('');
        if (!signInServiceAvailable()) return;
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.signInWithPopup(auth, new authFns.GoogleAuthProvider());
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('auth-reset-btn').addEventListener('click', async () => {
        showAuthError('');
        if (!signInServiceAvailable()) return;
        if (!emailInput.value.trim()) { showAuthError('Enter your email above first, then click this again.'); return; }
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.sendPasswordResetEmail(auth, emailInput.value.trim());
            showAuthError('Password reset email sent — check your inbox (and your spam folder).', true);
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('sign-out-btn').addEventListener('click', async () => {
        const { auth, authFns } = await waitForFirebase();
        await authFns.signOut(auth);
    });
});
