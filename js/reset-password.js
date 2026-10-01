// Handles the password-reset link from the email (?mode=resetPassword&oobCode=...).
// This page is set as the Action URL in Firebase Console > Authentication >
// Templates > Password reset, replacing Firebase's default unbranded page.
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const oobCode = params.get('oobCode');

    const subtitle = document.getElementById('reset-subtitle');
    const errorBox = document.getElementById('reset-error');
    const formSection = document.getElementById('reset-form-section');
    const successSection = document.getElementById('reset-success-section');
    const submitBtn = document.getElementById('reset-submit-btn');

    function showError(message) {
        errorBox.textContent = message;
        errorBox.classList.remove('hidden');
    }

    if (mode !== 'resetPassword' || !oobCode) {
        subtitle.textContent = 'Invalid link';
        showError('This password reset link is invalid. Request a new one from the sign-in screen.');
        return;
    }

    const { auth, authFns } = await waitForFirebase();

    let email;
    try {
        email = await authFns.verifyPasswordResetCode(auth, oobCode);
    } catch (err) {
        subtitle.textContent = 'Link expired';
        showError('This reset link has expired or was already used. Request a new one from the sign-in screen.');
        return;
    }

    subtitle.textContent = `Set a new password for ${email}`;
    formSection.classList.remove('hidden');

    submitBtn.addEventListener('click', async () => {
        const pw1 = document.getElementById('new-password').value;
        const pw2 = document.getElementById('confirm-password').value;
        errorBox.classList.add('hidden');

        if (pw1.length < 6) { showError('Password should be at least 6 characters.'); return; }
        if (pw1 !== pw2) { showError("Passwords don't match."); return; }

        try {
            await authFns.confirmPasswordReset(auth, oobCode, pw1);
            formSection.classList.add('hidden');
            subtitle.textContent = 'Password changed';
            successSection.classList.remove('hidden');
        } catch (err) {
            showError('Something went wrong — request a new reset link and try again.');
        }
    });
});
