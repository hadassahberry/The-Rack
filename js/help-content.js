// The getting-started help, written ONCE. The welcome card (short: just the three steps), the
// "How to use The Rack" window (the steps plus a few plain explanations) and the page tours all read
// from here, so there is never a second copy that could say something different.

const HELP_CONTENT = {
    welcomeTitle: 'Welcome to The Rack',
    helpTitle: 'How to use The Rack',
    steps: [
        'Add clothes to your closet.',
        'Choose a day to plan an outfit.',
        'Mark outfits as worn to track what you wear.'
    ],
    // `link`: whether "Add from a link" exists yet (it only appears once its server is set up).
    details: (link = false) => [
        {
            heading: 'Add clothes',
            text: `Press + Add clothes at the top of the page to upload a photo (or take one${link ? ', or add one from a store’s product page' : ''}). ` +
                'Give each piece a name and check its category, occasion and season. Pieces marked “needs tagging” are waiting for you to check them in the Closet.'
        },
        {
            heading: 'Plan an outfit',
            text: 'In the Planner, click a day (or press Enter on it), then pick pieces from your closet or apply a saved outfit. ' +
                'A day can hold several outfits, each with an optional activity such as “Class”. Planning an outfit does not record that you wore it.'
        },
        {
            heading: 'Mark it as worn',
            text: 'To record a wear, open today or a past day in the Planner and press Mark as worn on that outfit. ' +
                'Future days can’t be marked. Only outfits you mark count, and they are what Wear stats is built from.'
        },
        {
            heading: 'See what you wear',
            text: 'The Wear stats tab shows Total item wears (each piece in a worn outfit counts as one wear), your most-worn pieces and the kind of piece you wear most. ' +
                'Past plans you never marked are not counted; Wear stats lists them and lets you mark them if you did wear them.'
        },
        {
            heading: 'Need this again?',
            text: 'Press the ? Help button at the top of any page, or open Settings and choose How to use The Rack.'
        }
    ]
};

// Draws the help into `container`. full: false = just the three steps (the welcome card);
// true = the steps and the explanations. Built with text nodes, never HTML strings.
function renderGettingStarted(container, { full = false, link = false } = {}) {
    container.textContent = '';
    const list = document.createElement('ol');
    list.className = 'help-steps';
    HELP_CONTENT.steps.forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
    });
    container.appendChild(list);
    if (!full) return;
    HELP_CONTENT.details(link).forEach(d => {
        const block = document.createElement('div');
        block.className = 'help-detail';
        const h = document.createElement('h4');
        h.textContent = d.heading;
        const p = document.createElement('p');
        p.textContent = d.text;
        block.append(h, p);
        container.appendChild(block);
    });
}

if (typeof module !== 'undefined') {
    module.exports = { HELP_CONTENT };
}
