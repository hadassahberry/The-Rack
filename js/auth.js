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

function showAuthError(message) {
    const el = document.getElementById('auth-error');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
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

    waitForFirebase().then(({ auth, authFns }) => {
        authFns.onAuthStateChanged(auth, (user) => {
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
                document.getElementById('auth-screen').classList.remove('hidden');
                document.getElementById('app-shell').classList.add('hidden');
                document.getElementById('account-menu').classList.add('hidden');
                if (authReadyUid !== null) location.reload();
            }
        });
    });

    document.getElementById('auth-signin-btn').addEventListener('click', async () => {
        showAuthError('');
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('auth-signup-btn').addEventListener('click', async () => {
        showAuthError('');
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.createUserWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('auth-google-btn').addEventListener('click', async () => {
        showAuthError('');
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.signInWithPopup(auth, new authFns.GoogleAuthProvider());
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('auth-reset-btn').addEventListener('click', async () => {
        showAuthError('');
        if (!emailInput.value.trim()) { showAuthError('Enter your email above first, then click this again.'); return; }
        try {
            const { auth, authFns } = await waitForFirebase();
            await authFns.sendPasswordResetEmail(auth, emailInput.value.trim());
            showAuthError('Password reset email sent — check your inbox.');
        } catch (err) {
            showAuthError(friendlyAuthError(err));
        }
    });

    document.getElementById('sign-out-btn').addEventListener('click', async () => {
        const { auth, authFns } = await waitForFirebase();
        await authFns.signOut(auth);
    });
});
