document.addEventListener('DOMContentLoaded', () => {
    const navButtons = document.querySelectorAll('.nav-btn');
    const viewSections = document.querySelectorAll('.view-section');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active state from all tabs and sections
            navButtons.forEach(b => b.classList.remove('active'));
            viewSections.forEach(v => v.classList.remove('active'));

            // Add active state to the clicked tab and its matching section
            btn.classList.add('active');
            const targetView = document.getElementById(btn.dataset.tab);
            if (targetView) targetView.classList.add('active');
        });
    });
});
