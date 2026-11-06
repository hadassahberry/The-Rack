// "Delete account": required by both the App Store and Google Play for any app
// that lets people create an account. Flow:
//   1. re-confirm identity (password, or Google sign-in) — Firebase requires a
//      recent sign-in before it will delete a login, and it's a safeguard anyway
//   2. delete the user's data (closet, schedule, saved outfits)
//   3. delete the login itself
// Data is deleted BEFORE the login but only AFTER re-confirming, so a wrong
// password can never leave someone with a half-deleted account.
document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    const modal = $('delete-account-modal');
    const errorBox = $('delete-account-error');
    const confirmBtn = $('delete-account-confirm-btn');
    const cancelBtn = $('delete-account-cancel-btn');
    const passwordSection = $('delete-password-section');
    const passwordInput = $('delete-password');
    const googleNote = $('delete-google-note');
    let busy = false;

    function showError(message) {
        errorBox.textContent = message;
        errorBox.classList.toggle('hidden', !message);
    }

    function setBusy(isBusy) {
        busy = isBusy;
        confirmBtn.disabled = isBusy;
        cancelBtn.disabled = isBusy;
        passwordInput.disabled = isBusy;
        confirmBtn.textContent = isBusy ? 'Deleting…' : 'Delete my account';
    }

    function friendlyError(err) {
        const code = (err && err.code) || '';
        if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'That password isn\'t right.';
        if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
        if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return '';
        if (code.includes('popup-blocked')) return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
        if (code.includes('requires-recent-login')) return 'For security, please sign out, sign back in, and try again.';
        return 'Something went wrong. Please try again.';
    }

    async function openModal() {
        const { auth } = await waitForFirebase();
        const user = auth.currentUser;
        if (!user) return;
        const providers = user.providerData.map(p => p.providerId);
        const usesPassword = providers.includes('password');
        passwordSection.classList.toggle('hidden', !usesPassword);
        googleNote.classList.toggle('hidden', usesPassword || !providers.includes('google.com'));
        passwordInput.value = '';
        showError('');
        setBusy(false);
        modal.classList.remove('hidden');
        if (usesPassword) passwordInput.focus();
    }

    function closeModal() {
        if (busy) return;
        modal.classList.add('hidden');
        passwordInput.value = '';
        showError('');
    }

    async function confirmDelete() {
        if (busy) return;
        const { auth, authFns } = await waitForFirebase();
        const user = auth.currentUser;
        if (!user) return;
        const providers = user.providerData.map(p => p.providerId);

        if (providers.includes('password') && !passwordInput.value) {
            showError('Enter your password to confirm.');
            return;
        }

        showError('');
        setBusy(true);
        try {
            // 1) Re-confirm identity.
            if (providers.includes('password')) {
                const credential = authFns.EmailAuthProvider.credential(user.email, passwordInput.value);
                await authFns.reauthenticateWithCredential(user, credential);
            } else if (providers.includes('google.com')) {
                await authFns.reauthenticateWithPopup(user, new authFns.GoogleAuthProvider());
            }

            // 2) Delete everything stored for this user.
            await Store.deleteAllUserData();

            // Leave a note for the sign-in screen and clear this device's saved
            // location/cache. Set BEFORE deleting the login: signing out reloads the page.
            sessionStorage.setItem('rack_account_deleted', '1');
            Object.keys(localStorage).filter(k => k.startsWith('rack_')).forEach(k => localStorage.removeItem(k));

            // 3) Delete the login. The app reloads to the sign-in screen after this.
            try {
                await authFns.deleteUser(user);
            } catch (err) {
                sessionStorage.removeItem('rack_account_deleted');
                throw err;
            }
        } catch (err) {
            setBusy(false);
            showError(friendlyError(err));
        }
    }

    $('delete-account-btn').addEventListener('click', openModal);
    cancelBtn.addEventListener('click', closeModal);
    confirmBtn.addEventListener('click', confirmDelete);
    passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmDelete(); } });
    closeOnBackdrop(modal, closeModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });

    // ---- Your data: export a copy, or clear the closet (account and settings stay) ----
    const dataStatus = $('data-status');
    const setDataStatus = (text, isError = false) => {
        dataStatus.textContent = text;
        dataStatus.classList.toggle('is-error', isError);
    };
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    $('export-data-btn').addEventListener('click', async () => {
        setDataStatus('Preparing your download…');
        try {
            const { auth } = await waitForFirebase();
            const data = await Store.exportAllUserData(auth.currentUser && auth.currentUser.email);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `the-rack-export-${isoDateKey(new Date())}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            setDataStatus(`Downloaded ${plural(data.closet.length, 'item')}, ${plural(Object.keys(data.schedule).length, 'planned day')} and ${plural(data.savedOutfits.length, 'saved outfit')}.`);
        } catch (err) {
            console.error(err);
            setDataStatus('Couldn\'t prepare the download. Please try again.', true);
        }
    });

    const clearModal = $('clear-data-modal');
    const clearError = $('clear-data-error');
    const clearConfirmBtn = $('clear-data-confirm-btn');
    const clearCancelBtn = $('clear-data-cancel-btn');
    let clearBusy = false;

    function openClearModal() {
        // Counts come from the live data the app already has on screen.
        const items = liveCloset.length, days = Object.keys(plannerSchedule).length, outfits = plannerSavedOutfits.length;
        const empty = items + days + outfits === 0;
        $('clear-data-summary').textContent = empty
            ? 'Your closet is already empty.'
            : `This permanently removes ${plural(items, 'item')}, ${plural(days, 'planned day')} and ${plural(outfits, 'saved outfit')}.`;
        clearConfirmBtn.disabled = empty;
        clearError.classList.add('hidden');
        clearModal.classList.remove('hidden');
    }

    function closeClearModal() {
        if (clearBusy) return;
        clearModal.classList.add('hidden');
    }

    async function confirmClear() {
        if (clearBusy) return;
        clearBusy = true;
        clearConfirmBtn.disabled = true;
        clearCancelBtn.disabled = true;
        clearConfirmBtn.textContent = 'Clearing…';
        clearError.classList.add('hidden');
        try {
            await Store.clearClosetData();
            clearBusy = false;
            clearModal.classList.add('hidden');
            setDataStatus('Your closet has been cleared.');
        } catch (err) {
            console.error(err);
            clearBusy = false;
            clearError.textContent = 'Something went wrong. Please try again.';
            clearError.classList.remove('hidden');
            clearConfirmBtn.disabled = false;
        } finally {
            clearCancelBtn.disabled = false;
            clearConfirmBtn.textContent = 'Clear everything';
        }
    }

    $('clear-data-btn').addEventListener('click', openClearModal);
    clearCancelBtn.addEventListener('click', closeClearModal);
    clearConfirmBtn.addEventListener('click', confirmClear);
    closeOnBackdrop(clearModal, closeClearModal);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !clearModal.classList.contains('hidden')) closeClearModal();
    });
});
