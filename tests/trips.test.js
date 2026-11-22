// Trips (js/trip-logic.js, js/trips.js and the parts of the Planner / Help me choose / Store that know about them):
// date and destination validation, disambiguating places with the same name, the packing checklist (one entry per piece, the
// dates that use it, kept in step when outfits change, saved ticks), and the weather (the destination's forecast only, "Forecast
// not available yet." when it doesn't reach, never the home weather, never an invented estimate).
// Plain Node, no packages: node tests/trips.test.js
const { check, done, assert, read, vm } = require('./_harness');
const T = require('../js/trip-logic.js');

const J = (x) => JSON.parse(JSON.stringify(x));
const TODAY = '2026-11-22';
const dest = (o = {}) => ({ label: 'Paris, Île-de-France, France', name: 'Paris', admin1: 'Île-de-France', country: 'France', countryCode: 'FR', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris', ...o });
const trip = (o = {}) => ({ id: 't1', name: '', destination: dest(), start: '2026-11-24', end: '2026-11-27', packed: {}, createdAt: 1, ...o });
const piece = (id, name, category) => ({ id, name, category, color: '#222222', occasion: 'casual', season: 'all-season', tagged: true });
const CLOSET = [piece('tee', 'White tee', 'tops'), piece('top', 'Navy top', 'tops'), piece('jeans', 'Jeans', 'bottoms'), piece('skirt', 'Black skirt', 'bottoms'), piece('shoes', 'Sneakers', 'shoes'), piece('coat', 'Camel coat', 'outerwear'), piece('dress', 'Green dress', 'dresses'), piece('bag', 'Tote', 'accessories')];
const outfit = (id, itemIds, extra = {}) => ({ id, label: '', itemIds, ...extra });

// ================= dates =================
check('real calendar dates only', () => {
    for (const ok of ['2026-11-22', '2028-02-29', '2026-12-31']) assert.strictEqual(T.isIsoDate(ok), true, ok);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '2026-1-1', '11/22/2026', '', null, undefined, 20261122, '2026-11-22T00:00:00Z']) assert.strictEqual(T.isIsoDate(bad), false, String(bad));
});
check('trip dates run first to last, inclusive, across month and year ends, and are empty for anything invalid', () => {
    assert.deepStrictEqual(T.tripDates('2026-11-24', '2026-11-27'), ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    assert.deepStrictEqual(T.tripDates('2026-11-30', '2026-12-02'), ['2026-11-30', '2026-12-01', '2026-12-02']);
    assert.deepStrictEqual(T.tripDates('2026-12-31', '2027-01-01'), ['2026-12-31', '2027-01-01']);
    assert.deepStrictEqual(T.tripDates('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
    assert.deepStrictEqual(T.tripDates('2026-11-24', '2026-11-24'), ['2026-11-24'], 'a one-day trip');
    assert.deepStrictEqual(T.tripDates('2026-11-27', '2026-11-24'), []);
    assert.deepStrictEqual(T.tripDates('2026-02-30', '2026-03-02'), []);
    assert.deepStrictEqual(T.tripDates(undefined, '2026-03-02'), []);
});
check('dates are described compactly, runs joined', () => {
    assert.strictEqual(T.describeTripDates(['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-29']), 'Nov 24–26, Nov 29');
    assert.strictEqual(T.describeTripDates(['2026-11-24', '2026-11-26']), 'Nov 24, Nov 26');
    assert.strictEqual(T.describeTripDates(['2026-11-30', '2026-12-01']), 'Nov 30–Dec 1');
    assert.strictEqual(T.describeTripDates(['2026-11-26', '2026-11-24', '2026-11-24']), 'Nov 24, Nov 26', 'unordered and repeated input');
    assert.strictEqual(T.describeTripDates([]), '');
    assert.strictEqual(T.tripRangeLabel('2026-11-24', '2026-11-27', TODAY), 'Nov 24 to Nov 27');
    assert.strictEqual(T.tripRangeLabel('2026-12-30', '2027-01-03', TODAY), 'Dec 30 to Jan 3, 2027');
    assert.strictEqual(T.tripWeekdayDate('2026-11-24'), 'Tue, Nov 24');
});

// ================= validating a trip =================
const V = (o) => T.validateTrip({ destination: dest(), start: '2026-11-24', end: '2026-11-27', todayKey: TODAY, ...o });
check('a good trip passes', () => {
    const v = V({});
    assert.strictEqual(v.ok, true);
    assert.deepStrictEqual(v.messages, []);
    assert.strictEqual(V({ start: TODAY, end: TODAY }).ok, true, 'a one-day trip that starts today');
    assert.strictEqual(V({ start: '2026-11-10', end: TODAY }).ok, true, 'one that is under way (it ends today)');
});
check('a destination must have been chosen from the search, with real coordinates', () => {
    for (const destination of [null, undefined, {}, 'Paris', { name: 'Paris' }, dest({ latitude: NaN }), dest({ latitude: 91 }), dest({ longitude: -181 }), dest({ name: '  ' }), dest({ latitude: '48.85' })]) {
        const v = V({ destination });
        assert.strictEqual(v.ok, false, JSON.stringify(destination));
        assert(/choose the right place/.test(v.errors.destination));
    }
});
check('dates: missing, not real, backwards, too long, already over, a typo of a year ahead', () => {
    assert(/Enter the first day/.test(V({ start: '' }).errors.start));
    assert(/Enter the last day/.test(V({ end: '' }).errors.end));
    assert(/first day isn’t a real date/.test(V({ start: '2026-02-30' }).errors.start));
    assert(/last day isn’t a real date/.test(V({ end: '2026-13-01' }).errors.end));
    assert(/can’t be before the first day/.test(V({ start: '2026-11-27', end: '2026-11-24' }).errors.dates));
    assert(/at most 60 days/.test(V({ start: '2026-12-01', end: '2027-02-05' }).errors.dates), '67 days');
    assert.strictEqual(V({ start: '2026-12-01', end: '2027-01-29' }).ok, true, 'exactly 60 days is allowed');
    assert(/at most 60 days/.test(V({ start: '2026-12-01', end: '2027-01-30' }).errors.dates), '61 days');
    assert(/already over/.test(V({ start: '2026-11-10', end: '2026-11-21' }).errors.dates));
    assert(/more than two years away/.test(V({ start: '2029-01-10', end: '2029-01-12' }).errors.dates));
    assert.strictEqual(V({ start: '2028-11-20', end: '2028-11-22' }).ok, true, 'two years ahead is fine');
});
check('several problems are all reported, in a sensible order, with nothing saved when any exists', () => {
    const v = T.validateTrip({ destination: null, start: '', end: '2026-13-40', todayKey: TODAY });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.messages.length, 3);
    assert(/choose the right place/.test(v.messages[0]) && /first day/.test(v.messages[1]) && /last day/.test(v.messages[2]));
});
check('trips cannot overlap (one place per day), and the message names the other trip; touching on one day counts as overlapping', () => {
    const other = trip({ id: 'o1', name: 'Rome', start: '2026-12-01', end: '2026-12-05' });
    const v = V({ start: '2026-12-04', end: '2026-12-08', existingTrips: [other] });
    assert.strictEqual(v.ok, false);
    assert(/overlap your trip “Rome” \(Dec 1 to Dec 5\)/.test(v.errors.dates), v.errors.dates);
    assert.strictEqual(V({ start: '2026-11-28', end: '2026-12-01', existingTrips: [other] }).ok, false, 'sharing Dec 1');
    assert.strictEqual(V({ start: '2026-11-28', end: '2026-11-30', existingTrips: [other] }).ok, true, 'the day before');
    assert.strictEqual(V({ start: '2026-12-06', end: '2026-12-08', existingTrips: [other] }).ok, true, 'the day after');
    assert.strictEqual(V({ start: '2026-12-02', end: '2026-12-03', existingTrips: [other] }).ok, false, 'inside it');
    assert.strictEqual(V({ start: '2026-11-25', end: '2026-12-10', existingTrips: [other] }).ok, false, 'around it');
});
check('editing a trip does not clash with itself, and a trip that already ended can still be edited', () => {
    const me = trip({ id: 'me', start: '2026-12-01', end: '2026-12-05' });
    assert.strictEqual(V({ start: '2026-12-02', end: '2026-12-06', existingTrips: [me], ignoreId: 'me' }).ok, true);
    assert.strictEqual(V({ start: '2026-12-02', end: '2026-12-06', existingTrips: [me] }).ok, false, 'without ignoreId it would clash with itself');
    assert.strictEqual(V({ start: '2026-10-01', end: '2026-10-05', allowPast: true }).ok, true);
    assert.strictEqual(V({ start: '2026-10-01', end: '2026-10-05' }).ok, false);
});
check('the trip title is its name, else "Trip to <place>"', () => {
    assert.strictEqual(T.tripTitle(trip({ name: 'Cousin’s wedding' })), 'Cousin’s wedding');
    assert.strictEqual(T.tripTitle(trip()), 'Trip to Paris');
});

// ================= places with the same name =================
const geo = (results) => ({ results });
const R = (o) => ({ id: 1, name: 'Paris', admin1: 'Île-de-France', admin2: '', country: 'France', country_code: 'FR', latitude: 48.85, longitude: 2.35, timezone: 'Europe/Paris', population: 2138551, ...o });
check('search results are cleaned: places without real coordinates or a name are dropped', () => {
    const list = T.normalizeGeoResults(geo([R({}), R({ id: 2, latitude: null }), R({ id: 3, longitude: 'x' }), R({ id: 4, name: '' }), R({ id: 5, latitude: 123 }), null, 'junk', R({ id: 6, population: undefined })]));
    assert.deepStrictEqual(list.map(p => p.id), [1, 6]);
    assert.strictEqual(list[0].countryCode, 'FR');
    assert.strictEqual(list[1].population, 0);
    assert.deepStrictEqual(T.normalizeGeoResults(null), []);
    assert.deepStrictEqual(T.normalizeGeoResults({}), []);
    assert.deepStrictEqual(T.normalizeGeoResults({ results: 'x' }), []);
});
check('two places with one name get labels that tell them apart', () => {
    const places = T.disambiguatePlaces(T.normalizeGeoResults(geo([
        R({ id: 1 }),
        R({ id: 2, admin1: 'Texas', country: 'United States', country_code: 'US', latitude: 33.66, longitude: -95.55, population: 24782 }),
        R({ id: 3, admin1: 'Tennessee', country: 'United States', country_code: 'US', latitude: 36.3, longitude: -88.3, population: 10150 })
    ])));
    assert.deepStrictEqual(places.map(p => p.label), ['Paris, Île-de-France, France', 'Paris, Texas, United States', 'Paris, Tennessee, United States']);
    assert.strictEqual(new Set(places.map(p => p.label)).size, 3);
});
check('when the region is not enough, the county or district is added; when even that matches, the coordinates', () => {
    const sameRegion = T.disambiguatePlaces(T.normalizeGeoResults(geo([
        R({ id: 1, name: 'Springfield', admin1: 'Missouri', admin2: 'Greene County', country: 'United States', latitude: 37.2, longitude: -93.3 }),
        R({ id: 2, name: 'Springfield', admin1: 'Missouri', admin2: 'Christian County', country: 'United States', latitude: 37.0, longitude: -93.1 })
    ])));
    assert.deepStrictEqual(sameRegion.map(p => p.label), ['Springfield, Greene County, Missouri, United States', 'Springfield, Christian County, Missouri, United States']);
    const same = T.disambiguatePlaces(T.normalizeGeoResults(geo([
        R({ id: 1, name: 'Santa Maria', admin1: 'Cabo Verde', country: 'Cape Verde', latitude: 16.6, longitude: -22.9 }),
        R({ id: 2, name: 'Santa Maria', admin1: 'Cabo Verde', country: 'Cape Verde', latitude: 16.3, longitude: -22.8 })
    ])));
    assert.strictEqual(new Set(same.map(p => p.label)).size, 2);
    assert(same.every(p => /\(\d+\.\d+°[NS], \d+\.\d+°[EW]\)$/.test(p.label)), same.map(p => p.label).join(' | '));
});
check('a single match keeps its plain label, and labels never repeat a part ("Singapore, Singapore")', () => {
    const [p] = T.disambiguatePlaces(T.normalizeGeoResults(geo([R({ id: 1, name: 'Singapore', admin1: 'Singapore', country: 'Singapore' })])));
    assert.strictEqual(p.label, 'Singapore');
    assert.strictEqual(T.disambiguatePlaces(T.normalizeGeoResults(geo([R({})])))[0].label, 'Paris, Île-de-France, France');
});
check('a chosen place becomes a small destination: a name to show and where to ask for the forecast', () => {
    const [p] = T.disambiguatePlaces(T.normalizeGeoResults(geo([R({})])));
    const d = T.destinationFromPlace(p);
    assert.deepStrictEqual(Object.keys(d).sort(), ['admin1', 'country', 'countryCode', 'label', 'latitude', 'longitude', 'name', 'timezone']);
    assert.strictEqual(T.validDestination(d), true);
});

// ================= reading a stored trip =================
check('a stored trip is read back; anything unusable is dropped, never guessed', () => {
    const ok = T.normalizeTrip('x', { name: '  Trip  ', destination: dest(), start: '2026-11-24', end: '2026-11-27', packed: { a: true, b: false, c: 'yes', d: 1 }, createdAt: 5 });
    assert.strictEqual(ok.id, 'x');
    assert.strictEqual(ok.name, 'Trip');
    assert.deepStrictEqual(J(ok.packed), { a: true, b: false }, 'only real ticks');
    for (const bad of [null, {}, { destination: dest(), start: '2026-11-24' }, { destination: dest(), start: '2026-11-27', end: '2026-11-24' }, { destination: dest({ latitude: null }), start: '2026-11-24', end: '2026-11-25' }, { destination: dest(), start: '2026-02-30', end: '2026-03-02' }]) {
        assert.strictEqual(T.normalizeTrip('x', bad), null, JSON.stringify(bad));
    }
    assert.deepStrictEqual(J(T.normalizeTrip('x', { destination: dest(), start: '2026-11-24', end: '2026-11-25' }).packed), {}, 'no packed field: nothing ticked');
});
check('which trip a day belongs to', () => {
    const a = trip({ id: 'a', start: '2026-11-24', end: '2026-11-27' }), b = trip({ id: 'b', start: '2026-12-01', end: '2026-12-03' });
    assert.strictEqual(T.tripOnDate([a, b], '2026-11-24').id, 'a');
    assert.strictEqual(T.tripOnDate([a, b], '2026-11-27').id, 'a');
    assert.strictEqual(T.tripOnDate([a, b], '2026-12-02').id, 'b');
    assert.strictEqual(T.tripOnDate([a, b], '2026-11-28'), null);
    assert.strictEqual(T.tripOnDate([], '2026-11-24'), null);
    assert.strictEqual(T.tripOnDate(undefined, '2026-11-24'), null);
});

// ================= the packing checklist =================
const PACK = (o) => T.buildPackingList({ trip: trip(), closet: CLOSET, ...o });
const names = (r) => r.items.map(i => i.name);
check('one entry per piece, however many outfits and days use it, with each date that uses it', () => {
    const outfits = {
        '2026-11-24': [outfit('a', ['tee', 'jeans', 'shoes'])],
        '2026-11-25': [outfit('b', ['top', 'skirt', 'shoes']), outfit('c', ['jeans', 'shoes'])],            // shoes in two outfits on one day
        '2026-11-26': [outfit('d', ['tee', 'jeans'])]
    };
    const r = PACK({ outfitsByDate: outfits });
    assert.strictEqual(r.total, 5);
    assert.strictEqual(new Set(r.items.map(i => i.id)).size, 5, 'no piece twice');
    const by = Object.fromEntries(r.items.map(i => [i.id, i]));
    assert.deepStrictEqual(by.tee.dates, ['2026-11-24', '2026-11-26']);
    assert.deepStrictEqual(by.jeans.dates, ['2026-11-24', '2026-11-25', '2026-11-26']);
    assert.deepStrictEqual(by.shoes.dates, ['2026-11-24', '2026-11-25'], 'two outfits on one day is one date');
    assert.deepStrictEqual(by.top.dates, ['2026-11-25']);
    assert.strictEqual(by.jeans.datesText, 'Nov 24–26');
    assert.strictEqual(by.tee.datesText, 'Nov 24, Nov 26');
});
check('the same piece listed twice in one outfit, or in several outfits on several days, is still one entry', () => {
    const r = PACK({ outfitsByDate: { '2026-11-24': [outfit('a', ['tee', 'tee']), outfit('b', ['tee'])], '2026-11-25': [outfit('c', ['tee'])], '2026-11-27': [outfit('d', ['tee'])] } });
    assert.strictEqual(r.total, 1);
    assert.deepStrictEqual(r.items[0].dates, ['2026-11-24', '2026-11-25', '2026-11-27']);
});
check('only the trip\'s own days count: days before and after are ignored', () => {
    const r = PACK({ outfitsByDate: { '2026-11-23': [outfit('x', ['coat'])], '2026-11-24': [outfit('a', ['tee'])], '2026-11-28': [outfit('y', ['dress'])], '2027-11-25': [outfit('z', ['bag'])] } });
    assert.deepStrictEqual(names(r), ['White tee']);
});
check('the list is in head-to-toe order, by name within a kind, grouped by kind', () => {
    const r = PACK({ outfitsByDate: { '2026-11-24': [outfit('a', ['bag', 'shoes', 'skirt', 'top', 'tee', 'coat', 'jeans', 'dress'])] } });
    assert.deepStrictEqual(r.groups.map(g => g.category), ['outerwear', 'tops', 'dresses', 'bottoms', 'shoes', 'accessories']);
    assert.deepStrictEqual(names(r), ['Camel coat', 'Navy top', 'White tee', 'Green dress', 'Black skirt', 'Jeans', 'Sneakers', 'Tote']);
    assert.strictEqual(r.groups.reduce((n, g) => n + g.items.length, 0), r.total);
});
check('a piece that is no longer in the closet has nothing to pack and is left out (no placeholder, no error)', () => {
    const r = PACK({ outfitsByDate: { '2026-11-24': [outfit('a', ['tee', 'deleted-piece'])] } });
    assert.deepStrictEqual(names(r), ['White tee']);
});
check('nothing planned: an empty list', () => {
    for (const outfitsByDate of [{}, undefined, { '2026-11-24': [] }, { '2026-11-24': [outfit('a', [])] }]) {
        const r = PACK({ outfitsByDate });
        assert.deepStrictEqual([r.total, r.packed, r.items, r.groups], [0, 0, [], []]);
    }
});
check('ticks: only pieces that are ticked are checked; unticked and unknown are not', () => {
    const outfits = { '2026-11-24': [outfit('a', ['tee', 'jeans', 'shoes'])] };
    const r = PACK({ outfitsByDate: outfits, packed: { tee: true, jeans: false } });
    assert.deepStrictEqual(r.items.map(i => [i.id, i.checked]), [['tee', true], ['jeans', false], ['shoes', false]]);
    assert.strictEqual(r.packed, 1);
    assert.strictEqual(PACK({ outfitsByDate: outfits, packed: { tee: 'yes', jeans: 1 } }).packed, 0, 'only a real true counts');
});
check('ticks come from the trip itself when none are passed', () => {
    const outfits = { '2026-11-24': [outfit('a', ['tee'])] };
    assert.strictEqual(T.buildPackingList({ trip: trip({ packed: { tee: true } }), closet: CLOSET, outfitsByDate: outfits }).packed, 1);
});

// ---- the list stays in step when outfits change ----
check('removing a piece from an outfit removes it from the list; the others keep their ticks and dates', () => {
    const before = { '2026-11-24': [outfit('a', ['tee', 'jeans'])], '2026-11-25': [outfit('b', ['tee', 'skirt'])] };
    const packed = { tee: true, skirt: true };
    assert.deepStrictEqual(names(PACK({ outfitsByDate: before, packed })), ['White tee', 'Black skirt', 'Jeans']);
    const after = { '2026-11-24': [outfit('a', ['tee', 'jeans'])], '2026-11-25': [outfit('b', ['tee'])] };       // the skirt came out
    const r = PACK({ outfitsByDate: after, packed });
    assert.deepStrictEqual(names(r), ['White tee', 'Jeans']);
    assert.strictEqual(r.items.find(i => i.id === 'tee').checked, true);
    assert.strictEqual(r.packed, 1, 'the removed skirt no longer counts as packed');
});
check('moving a piece to another day changes its dates, not its entry', () => {
    const r1 = PACK({ outfitsByDate: { '2026-11-24': [outfit('a', ['tee'])] } });
    const r2 = PACK({ outfitsByDate: { '2026-11-26': [outfit('a', ['tee'])] } });
    assert.deepStrictEqual([r1.total, r1.items[0].dates], [1, ['2026-11-24']]);
    assert.deepStrictEqual([r2.total, r2.items[0].dates], [1, ['2026-11-26']]);
});
check('replacing an outfit with another (what Help me choose does) swaps the pieces and keeps the shared ones', () => {
    const before = { '2026-11-24': [outfit('a', ['tee', 'jeans', 'shoes'])] };
    const after = { '2026-11-24': [outfit('a', ['top', 'jeans', 'shoes'])] };
    assert.deepStrictEqual(names(PACK({ outfitsByDate: before })), ['White tee', 'Jeans', 'Sneakers']);
    assert.deepStrictEqual(names(PACK({ outfitsByDate: after })), ['Navy top', 'Jeans', 'Sneakers']);
});
check('adding a day\'s outfit, then deleting the day, brings the list back to where it was', () => {
    const base = { '2026-11-24': [outfit('a', ['tee'])] };
    const added = { ...base, '2026-11-26': [outfit('b', ['coat'])] };
    assert.deepStrictEqual(names(PACK({ outfitsByDate: added })), ['Camel coat', 'White tee']);
    const { '2026-11-26': gone, ...removed } = added;
    assert.deepStrictEqual(names(PACK({ outfitsByDate: removed })), ['White tee']);
});
check('a tick is remembered for a piece while it is off the plan, and is there again if the piece returns', () => {
    const packed = { skirt: true };
    assert.deepStrictEqual(PACK({ outfitsByDate: { '2026-11-24': [outfit('a', ['tee'])] }, packed }).items.map(i => i.id), ['tee'], 'not listed while unplanned');
    const back = PACK({ outfitsByDate: { '2026-11-24': [outfit('a', ['tee', 'skirt'])] }, packed });
    assert.strictEqual(back.items.find(i => i.id === 'skirt').checked, true);
    assert.strictEqual(back.total, 2, 'and still one entry');
});
check('changing the trip\'s dates changes which days count', () => {
    const outfits = { '2026-11-24': [outfit('a', ['tee'])], '2026-11-29': [outfit('b', ['coat'])] };
    assert.deepStrictEqual(names(T.buildPackingList({ trip: trip({ start: '2026-11-24', end: '2026-11-27' }), closet: CLOSET, outfitsByDate: outfits })), ['White tee']);
    assert.deepStrictEqual(names(T.buildPackingList({ trip: trip({ start: '2026-11-24', end: '2026-11-30' }), closet: CLOSET, outfitsByDate: outfits })), ['Camel coat', 'White tee']);
});
check('building the list changes nothing it is given', () => {
    const t = trip({ packed: { tee: true } }), outfits = { '2026-11-24': [outfit('a', ['tee', 'jeans'])] }, closet = J(CLOSET);
    const before = JSON.stringify([t, outfits, closet]);
    PACK({ trip: t, outfitsByDate: outfits, closet });
    T.tripDaySummaries({ trip: t, outfitsByDate: outfits, closet });
    assert.strictEqual(JSON.stringify([t, outfits, closet]), before);
});
check('the day-by-day view lists what is planned each day, head to toe, and shows empty days as empty', () => {
    const days = T.tripDaySummaries({ trip: trip(), closet: CLOSET, outfitsByDate: { '2026-11-25': [outfit('a', ['shoes', 'jeans', 'tee'], { label: 'Dinner' })] } });
    assert.deepStrictEqual(days.map(d => d.date), ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    assert.deepStrictEqual(days[0].outfits, []);
    assert.deepStrictEqual(J(days[1].outfits), [{ label: 'Dinner', pieces: ['White tee', 'Jeans', 'Sneakers'] }]);
    assert.strictEqual(days[1].label, 'Wed, Nov 25');
});

// ================= weather =================
const W = (o) => T.tripWeatherAvailability({ todayKey: TODAY, destinationName: 'Paris', ...o });
const MAP = { '2026-11-24': { high: 44, low: 35, code: 3 }, '2026-12-07': { high: 40, low: 30, code: 61 } };
check('the destination forecast is used where it has one', () => {
    const a = W({ dateKey: '2026-11-24', forecastMap: MAP, status: 'ok' });
    assert.deepStrictEqual([a.kind, a.text, a.stale], ['available', '', false]);
    assert.strictEqual(W({ dateKey: '2026-11-24', forecastMap: MAP, status: 'failed' }).stale, true, 'an older forecast that could not be refreshed is marked');
});
check('outside its range the day says exactly "Forecast not available yet." (and where the forecast ends), with no number', () => {
    const a = W({ dateKey: '2026-12-20', forecastMap: MAP, status: 'ok' });
    assert.strictEqual(a.kind, 'beyond');
    assert.strictEqual(a.text, 'Forecast not available yet.');
    assert.strictEqual(a.detail, 'The forecast for Paris reaches Dec 7.');
    assert.strictEqual(W({ dateKey: '2027-03-01', forecastMap: {}, status: 'idle' }).text, 'Forecast not available yet.', 'far ahead, nothing fetched at all');
    assert.strictEqual(W({ dateKey: '2026-12-09', forecastMap: {}, status: 'ok' }).kind, 'beyond', '17 days ahead is beyond any forecast');
});
check('inside the range but without a forecast: loading, failed (an error), or missing; never a made-up value', () => {
    assert.strictEqual(W({ dateKey: '2026-11-25', forecastMap: {}, status: 'loading' }).kind, 'loading');
    assert.strictEqual(W({ dateKey: '2026-11-25', forecastMap: {}, status: 'idle' }).kind, 'loading');
    const f = W({ dateKey: '2026-11-25', forecastMap: {}, status: 'failed' });
    assert.strictEqual(f.kind, 'failed');
    assert(/Couldn’t load the forecast for Paris/.test(f.text));
    assert.strictEqual(W({ dateKey: '2026-11-25', forecastMap: MAP, status: 'ok' }).kind, 'missing', 'a gap inside what the request returned');
});
check('past days have no forecast; weather switched off in Settings shows nothing and says why', () => {
    assert.strictEqual(W({ dateKey: '2026-11-20', forecastMap: {}, status: 'ok' }).text, 'No forecast for past dates.');
    const off = W({ dateKey: '2026-11-24', forecastMap: MAP, status: 'ok', weatherEnabled: false });
    assert.deepStrictEqual([off.kind, off.text], ['off', 'Weather is switched off in Settings.']);
});
check('no estimate is ever produced: the unavailable answers carry no temperature at all', () => {
    for (const kind of [{ dateKey: '2026-12-20', forecastMap: MAP, status: 'ok' }, { dateKey: '2026-11-25', forecastMap: {}, status: 'loading' }, { dateKey: '2026-11-25', forecastMap: {}, status: 'failed' }, { dateKey: '2026-11-20', forecastMap: {}, status: 'ok' }]) {
        const a = W(kind);
        assert.strictEqual(Object.keys(a).some(k => /high|low|temp|estimate|average|typical/i.test(k)), false);
        assert(!/\d+\s*°/.test(JSON.stringify(a)), JSON.stringify(a));
    }
});
check('a day of a trip uses ONLY the trip\'s forecast: the home forecast is never a fallback, even when the trip has none', () => {
    const home = { '2026-11-25': { high: 99, low: 90, code: 0 } };
    const trips = [trip({ start: '2026-11-24', end: '2026-11-27' })];
    const onTrip = T.weatherSourceFor({ dateKey: '2026-11-25', trips, tripForecasts: {}, homeMap: home });
    assert.strictEqual(onTrip.source, 'trip');
    assert.deepStrictEqual(J(onTrip.map), {}, 'empty trip forecast stays empty');
    assert.notStrictEqual(onTrip.map, home);
    const withMap = T.weatherSourceFor({ dateKey: '2026-11-25', trips, tripForecasts: { t1: { '2026-11-25': { high: 40, low: 30, code: 3 } } }, homeMap: home });
    assert.strictEqual(withMap.map['2026-11-25'].high, 40);
    const off = T.weatherSourceFor({ dateKey: '2026-12-25', trips, tripForecasts: {}, homeMap: home });
    assert.deepStrictEqual([off.source, off.trip], ['home', null]);
    assert.strictEqual(off.map, home, 'every other day uses the home forecast, as before');
});
check('the destination\'s answer is turned into the same shape as the home forecast, and a bad answer is an error', () => {
    const map = T.parseTripForecast({ daily: { time: ['2026-11-24', '2026-11-25', 'bad', '2026-11-26'], temperature_2m_max: [44.4, 42.6, 1, null], temperature_2m_min: [35.2, 37.5, 1, 2], weathercode: [3, 61, 0, 0] } });
    assert.deepStrictEqual(J(map), { '2026-11-24': { high: 44, low: 35, code: 3 }, '2026-11-25': { high: 43, low: 38, code: 61 } });
    for (const bad of [null, {}, { daily: {} }, { daily: { time: 'x' } }]) assert.throws(() => T.parseTripForecast(bad));
});

// ================= the page side, in a sandbox: weather requests and what the Planner asks =================
function makeTrips({ prefs = { weatherEnabled: true }, fetchImpl, cache = {} } = {}) {
    const calls = { fetch: [], all: [], saveLocation: 0, cacheWrites: [], events: [] };
    const store = {
        getPrefs: () => prefs, getCache: (k) => (k in cache ? cache[k] : null),
        saveCache: (k, v) => { calls.cacheWrites.push(k); cache[k] = v; },
        saveLocation: () => { calls.saveLocation++; }, getLocation: () => { throw new Error('the home location must not be read'); },
        saveTripsLocal() {}, getTripsLocal: () => [], onTripsChange() {}
    };
    const document = { addEventListener() {}, dispatchEvent: (e) => { calls.events.push(e.type); }, getElementById: () => null, querySelectorAll: () => [] };
    const fetchFn = fetchImpl || (async (url) => { return { ok: true, json: async () => ({ daily: { time: ['2026-11-24', '2026-11-25'], temperature_2m_max: [44, 42], temperature_2m_min: [35, 37], weathercode: [3, 61] } }) }; });
    const wrapped = async (url) => { calls.all.push(url); calls.fetch.push(url); return fetchFn(url); };
    const ctx = vm.createContext({ console: { ...console, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, RegExp, Error, Event: class { constructor(t) { this.type = t; } }, document, Store: store, fetch: wrapped, isoDateKey: () => TODAY, setTimeout, window: {} });
    for (const f of ['js/trip-logic.js', 'js/trips.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.Trips = Trips; this.tripForDate = tripForDate; this.tripWeatherFor = tripWeatherFor;', ctx);
    return { ctx, calls, Trips: ctx.Trips, cache };
}
const loaded = (opts, ...trips) => { const m = makeTrips(opts); m.Trips.setTrips(trips); return m; };
const tick = () => new Promise(r => setTimeout(r, 5));
// loading trips starts their forecast requests, exactly as on the page; this waits for them to finish
const settle = () => new Promise(r => setTimeout(r, 25));

check('the destination forecast is requested for the DESTINATION\'s coordinates, saved per trip, and the home location is never touched', async () => {
    const m = loaded({}, trip());
    await settle();
    assert.strictEqual(m.calls.fetch.length, 1);
    assert(/open-meteo\.com\/v1\/forecast\?latitude=48\.85&longitude=2\.35&/.test(m.calls.fetch[0]), m.calls.fetch[0]);
    assert(/timezone=auto/.test(m.calls.fetch[0]));
    assert.strictEqual(m.calls.saveLocation, 0, 'Weather.refresh (which saves the place as home) is not used');
    assert.deepStrictEqual(m.calls.cacheWrites, ['tripwx_t1']);
    assert.deepStrictEqual(m.calls.events.filter(e => e === 'trip-weather').length >= 2, true, 'the page is told it is loading, then loaded');
});
check('asking the Planner for a trip day gives the destination forecast; for any other day, null (the Planner then uses home)', async () => {
    const m = loaded({}, trip());
    await settle();
    const day = m.ctx.tripWeatherFor('2026-11-24');
    assert.strictEqual(day.forecast.high, 44);
    assert.strictEqual(day.trip.id, 't1');
    assert.strictEqual(m.ctx.tripWeatherFor('2026-12-25'), null);
    assert.strictEqual(m.ctx.tripForDate('2026-11-27').id, 't1');
    assert.strictEqual(m.ctx.tripForDate('2026-11-28'), null);
});
check('a trip day beyond the destination forecast says "Forecast not available yet." and has no forecast to use', async () => {
    const m = loaded({}, trip({ start: '2026-11-24', end: '2026-12-20' }));
    await settle();
    const far = m.ctx.tripWeatherFor('2026-12-15');
    assert.strictEqual(far.forecast, null);
    assert.strictEqual(far.avail.text, 'Forecast not available yet.');
});
check('a trip too far ahead for any forecast is not even requested', async () => {
    const t = trip({ start: '2027-03-01', end: '2027-03-05' });
    const m = loaded({}, t);
    await settle();
    assert.strictEqual(m.calls.fetch.length, 0);
    assert.strictEqual(m.ctx.tripWeatherFor('2027-03-02').avail.text, 'Forecast not available yet.');
    const over = trip({ id: 't2', start: '2026-10-01', end: '2026-10-05' });
    const m2 = loaded({}, over);
    await settle();
    assert.strictEqual(m2.calls.fetch.length, 0, 'a trip that is over has no use for a forecast');
});
check('with weather switched off in Settings nothing is requested for a trip and no weather is shown', async () => {
    const m = loaded({ prefs: { weatherEnabled: false } }, trip());
    await settle();
    assert.strictEqual(m.calls.fetch.length, 0);
    const day = m.ctx.tripWeatherFor('2026-11-25');
    assert.strictEqual(day.forecast, null);
    assert.strictEqual(day.avail.kind, 'off');
});
check('if the destination request fails the day says so; it does NOT fall back to anything else', async () => {
    const m = loaded({ fetchImpl: async () => { throw new Error('offline'); } }, trip());
    await settle();
    const day = m.ctx.tripWeatherFor('2026-11-25');
    assert.strictEqual(day.forecast, null);
    assert.strictEqual(day.avail.kind, 'failed');
    assert(/Couldn’t load the forecast for Paris/.test(day.avail.text));
    const bad = loaded({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }, trip());
    await settle();
    assert.strictEqual(bad.ctx.tripWeatherFor('2026-11-25').avail.kind, 'failed');
    const junk = loaded({ fetchImpl: async () => ({ ok: true, json: async () => ({ nope: 1 }) }) }, trip());
    await settle();
    assert.strictEqual(junk.ctx.tripWeatherFor('2026-11-25').avail.kind, 'failed', 'an unexpected answer is a failure, not weather');
});
check('a forecast that is already fresh is not asked for again; "Try again" (force) is', async () => {
    const m = loaded({}, trip());
    await settle();                                                    // loading the trip already asked once
    assert.strictEqual(m.calls.fetch.length, 1);
    await m.Trips.refreshWeather(trip());
    assert.strictEqual(m.calls.fetch.length, 1, 'a forecast younger than 3 hours is not asked for again');
    await m.Trips.refreshWeather(trip(), { force: true });
    assert.strictEqual(m.calls.fetch.length, 2, 'Try again asks again');
});
check('a saved forecast for the SAME place is used at once on the next visit; one saved for a different place is ignored', () => {
    const t = trip();
    const good = { tripwx_t1: { lat: 48.85, lon: 2.35, map: { '2026-11-25': { high: 40, low: 30, code: 3 } }, fetchedAt: Date.now() - 60000 } };
    const a = loaded({ cache: good }, t);
    assert.strictEqual(a.ctx.tripWeatherFor('2026-11-25').forecast.high, 40);
    const wrong = { tripwx_t1: { lat: 35.68, lon: 139.69, map: { '2026-11-25': { high: 99, low: 90, code: 0 } }, fetchedAt: Date.now() } };
    const b = loaded({ cache: wrong }, t);
    assert.strictEqual(b.ctx.tripWeatherFor('2026-11-25').forecast, null, 'Tokyo\'s weather is never shown for Paris');
});
check('a saved forecast that could not be refreshed stays visible, marked as not refreshed', async () => {
    const cache = { tripwx_t1: { lat: 48.85, lon: 2.35, map: { '2026-11-25': { high: 40, low: 30, code: 3 } }, fetchedAt: Date.now() - 6 * 3600 * 1000 } };
    const m = loaded({ cache, fetchImpl: async () => { throw new Error('offline'); } }, trip());
    await settle();
    const day = m.ctx.tripWeatherFor('2026-11-25');
    assert.strictEqual(day.forecast.high, 40);
    assert.strictEqual(day.avail.stale, true);
});
check('the trips code never reads or writes the home location, and never calls the home forecast', () => {
    const src = read('js/trips.js') + read('js/trip-logic.js');
    assert(!/Location\.|saveLocation|getLocation|Weather\.refresh|Weather\.getForecastMap|DEFAULT_LOCATION/.test(src.replace(/\/\/.*$/gm, '')), 'no home location or home weather in trips code');
    assert(/api\.open-meteo\.com\/v1\/forecast/.test(src) && /geocoding-api\.open-meteo\.com/.test(src), 'free Open-Meteo services only');
    assert(!/archive-api|climate-api|estimate/i.test(src.replace(/\/\/.*$/gm, '')), 'no estimate source is used');
});

// ================= the Planner and Help me choose use it =================
check('Planner cells, the day window, the legend and Help me choose all ask for the TRIP weather on a trip day, never home\'s', () => {
    const cal = read('js/calendar.js');
    assert(/const tripDay = typeof tripWeatherFor === 'function' \? tripWeatherFor\(dateKey\) : null;/.test(cal));
    assert(/const weather = tripDay \? tripDay\.forecast : \(prefs\.weatherEnabled \? weatherFor/.test(cal), 'cells');
    assert(/const \{ avail, forecast: weather \} = tripDay \? tripDay : weatherFor\(/.test(cal), 'the day window');
    assert(/\.filter\(k => !\(typeof tripForDate === 'function' && tripForDate\(k\)\)\)/.test(cal), 'the legend is about home days only');
    assert(/Trips\.refreshWeather\(tripDay\.trip, \{ force: true \}\)/.test(cal), '"Try again" on a trip day retries the trip\'s forecast');
    const choose = read('js/help-choose.js');
    assert(/forecastFor: \(k\) => \{ const t = tripDay\(k\); return t \? t\.forecast : weatherFor\(k, forecastMap, todayKey\)\.forecast; \}/.test(choose));
    assert(/weatherPlaceFor/.test(choose) && /no forecast for \$\{ctx\.weatherPlace\} on this day yet/.test(choose));
});
check('Help me choose on a trip day is given the destination\'s weather, or none, and says whose', () => {
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise });
    for (const f of ['js/outfit-suggest.js', 'js/help-choose.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.api = { buildDayContext };', ctx);
    const base = { closet: [piece('a', 'A', 'tops'), piece('b', 'B', 'bottoms')], outfitsByDate: {}, prefs: { weatherEnabled: true } };
    const withTrip = ctx.api.buildDayContext('2026-11-25', { ...base, forecastFor: () => ({ high: 42, low: 37, code: 61 }), weatherPlaceFor: () => 'Paris' });
    assert.strictEqual(withTrip.weather.high, 42);
    assert.strictEqual(withTrip.weatherPlace, 'Paris');
    const none = ctx.api.buildDayContext('2026-12-20', { ...base, forecastFor: () => null, weatherPlaceFor: () => 'Paris' });
    assert.strictEqual(none.weather, null, 'no destination forecast: no weather at all, not the home one');
    assert.strictEqual(ctx.api.buildDayContext('2026-12-20', base).weatherPlace, '', 'an ordinary day names no place');
});
check('the Planner is unchanged for days that are not on a trip', () => {
    const cal = read('js/calendar.js');
    assert(/\} else if \(prefs\.weatherEnabled\) \{\s*if \(avail\.kind !== 'available'\) noteText = avail\.text;/.test(cal), 'the home note logic is still there for ordinary days');
    assert(/Weather\.getFetchedAt\(location\)/.test(cal));
});

// ================= saved ticks =================
function memoryStore() {
    const data = { 'users/u/trips': {}, 'users/u/closet': {}, 'users/u/schedule': {}, 'users/u/savedOutfits': {}, 'users/u/settings': {} };
    const log = [];
    const deepMerge = (a, b) => { const out = { ...a }; for (const k of Object.keys(b)) out[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') ? deepMerge(a[k], b[k]) : b[k]; return out; };
    const snap = (path) => ({ metadata: { fromCache: false }, docs: Object.entries(data[path] || {}).map(([id, d]) => ({ id, data: () => J(d), ref: { path: path + '/' + id } })) });
    const ref = (...s) => ({ path: s.join('/'), parent: s.slice(0, -1).join('/'), id: s[s.length - 1] });
    const dbFns = {
        doc: (_d, ...s) => ref(...s), collection: (_d, ...s) => ({ path: s.join('/') }),
        getDocs: async (c) => snap(c.path),
        setDoc: async (r, d, o) => { log.push(['set', r.path, J(d), o || null]); data[r.parent][r.id] = o && o.merge ? deepMerge(data[r.parent][r.id] || {}, J(d)) : J(d); },
        deleteDoc: async (r) => { log.push(['delete', r.path]); delete data[r.parent][r.id]; },
        writeBatch: () => { const ops = []; return { set() {}, delete: (r) => ops.push(r), commit: async () => { ops.forEach(r => { log.push(['batch-delete', r.path]); delete data[r.parent][r.id]; }); } }; },
        onSnapshot: () => {}
    };
    const win = { Firebase: { db: {}, dbFns }, addEventListener() {} };
    const cacheStore = {};
    const ctx = vm.createContext({ console, Date, Math, JSON, Object, Array, Set, Map, Number, String, Promise, window: win, localStorage: { getItem: (k) => (k in cacheStore ? cacheStore[k] : null), setItem: (k, v) => { cacheStore[k] = String(v); }, removeItem: (k) => { delete cacheStore[k]; } } });
    for (const f of ['js/trip-logic.js', 'js/starter-closet.js', 'js/state.js']) vm.runInContext(read(f), ctx, { filename: f });
    vm.runInContext('this.Store = Store;', ctx);
    ctx.Store.setUid('u');
    return { Store: ctx.Store, data, log, win };
}
check('a trip is saved, read back whole, and deleted', async () => {
    const m = memoryStore();
    await m.Store.saveTrip(trip());
    const [back] = await m.Store.getTrips();
    assert.deepStrictEqual(J(back), J(trip()));
    assert.strictEqual(m.log[0][1], 'users/u/trips/t1');
    await m.Store.deleteTrip('t1');
    assert.deepStrictEqual(await m.Store.getTrips(), []);
});
check('trips come back oldest first, and a damaged stored trip is skipped rather than breaking the list', async () => {
    const m = memoryStore();
    await m.Store.saveTrip(trip({ id: 'b', start: '2026-12-10', end: '2026-12-12' }));
    await m.Store.saveTrip(trip({ id: 'a', start: '2026-11-24', end: '2026-11-27' }));
    m.data['users/u/trips'].broken = { destination: null, start: 'x' };
    assert.deepStrictEqual((await m.Store.getTrips()).map(t => t.id), ['a', 'b']);
});
check('ticking a piece writes only that piece (a merge), so other ticks and other devices are never overwritten', async () => {
    const m = memoryStore();
    await m.Store.saveTrip(trip());
    await m.Store.setTripPacked('t1', 'tee', true);
    await m.Store.setTripPacked('t1', 'jeans', true);
    assert.deepStrictEqual(J(m.log.slice(1).map(l => [l[2], l[3]])), [[{ packed: { tee: true } }, { merge: true }], [{ packed: { jeans: true } }, { merge: true }]]);
    assert.deepStrictEqual(J(m.data['users/u/trips'].t1.packed), { tee: true, jeans: true });
    assert.strictEqual(m.data['users/u/trips'].t1.destination.name, 'Paris', 'the rest of the trip is untouched');
});
check('ticking the same piece again, or unticking it, never makes a second entry', async () => {
    const m = memoryStore();
    await m.Store.saveTrip(trip());
    for (const v of [true, true, false, true, true]) await m.Store.setTripPacked('t1', 'tee', v);
    assert.deepStrictEqual(J(m.data['users/u/trips'].t1.packed), { tee: true });
    await m.Store.setTripPacked('t1', 'tee', false);
    assert.deepStrictEqual(J(m.data['users/u/trips'].t1.packed), { tee: false }, 'unticked is false, still one key');
});
check('persistence: ticks survive a reload (a new read of the stored trip gives the same checked list)', async () => {
    const m = memoryStore();
    await m.Store.saveTrip(trip());
    await m.Store.setTripPacked('t1', 'tee', true);
    await m.Store.setTripPacked('t1', 'shoes', true);
    const [reloaded] = await m.Store.getTrips();                      // what the page reads after a reload
    const list = T.buildPackingList({ trip: reloaded, closet: CLOSET, outfitsByDate: { '2026-11-24': [outfit('a', ['tee', 'jeans', 'shoes'])], '2026-11-25': [outfit('b', ['tee'])] } });
    assert.deepStrictEqual(list.items.map(i => [i.id, i.checked]), [['tee', true], ['jeans', false], ['shoes', true]]);
    assert.strictEqual(list.packed, 2);
});
check('the trips this device last saw are kept per ACCOUNT for the first paint', () => {
    const m = memoryStore();
    m.Store.saveTripsLocal([trip()]);
    assert.strictEqual(m.Store.getTripsLocal()[0].id, 't1');
    m.Store.setUid('someone-else');
    assert.deepStrictEqual(J(m.Store.getTripsLocal()), [], 'another account sees none of them');
});
check('deleting a trip, or editing one, leaves the planner, pieces and saved outfits alone', async () => {
    const m = memoryStore();
    m.data['users/u/schedule']['2026-11-25'] = { outfits: [{ id: 'a', label: '', itemIds: ['tee'] }], itemIds: ['tee'] };
    m.data['users/u/closet'].tee = { name: 'White tee' };
    await m.Store.saveTrip(trip());
    await m.Store.deleteTrip('t1');
    assert.deepStrictEqual(Object.keys(m.data['users/u/schedule']), ['2026-11-25']);
    assert.deepStrictEqual(Object.keys(m.data['users/u/closet']), ['tee']);
});
check('exporting your data includes trips; deleting the account deletes them; clearing the closet keeps the trips themselves', async () => {
    const m = memoryStore();
    await m.Store.saveTrip(trip());
    const exported = await m.Store.exportAllUserData('x@example.test');
    assert.strictEqual(exported.trips.length, 1);
    assert.strictEqual(exported.trips[0].destination.name, 'Paris');
    const src = read('js/state.js');
    assert(/deleteAllUserData\(\) \{\s*return this\._deleteCollections\(\[[^\]]*'trips'[^\]]*\]\)/.test(src), 'account deletion includes trips');
    assert(!/clearClosetData\(\) \{\s*return this\._deleteCollections\(\[[^\]]*'trips'/.test(src), 'clearing the closet does not delete trips');
});

// ================= the page =================
const html = read('index.html');
check('the page has the Trips tab, the form, the days and the checklist', () => {
    assert(/<button class="nav-btn" data-tab="trips-view">Trips<\/button>/.test(html));
    for (const id of ['trips-view', 'trip-add-btn', 'trips-list', 'trips-empty', 'trip-detail', 'trip-detail-title', 'trip-weather-source', 'trip-weather-retry-btn', 'trip-days', 'trip-pack-list', 'trip-pack-summary', 'trip-pack-status', 'trip-modal', 'trip-name', 'trip-dest-input', 'trip-dest-search-btn', 'trip-dest-options', 'trip-start', 'trip-end', 'trip-errors', 'trip-save-btn', 'trip-cancel-btn', 'planning-trip'])
        assert(html.includes(`id="${id}"`), id);
    assert(/id="trip-modal"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="trip-modal-title"/.test(html));
    assert(/<input type="date" id="trip-start">/.test(html) && /<input type="date" id="trip-end">/.test(html));
    assert(/<label for="trip-start">/.test(html) && /<label for="trip-end">/.test(html) && /<label for="trip-dest-input">/.test(html));
});
check('the scripts are on the page in a workable order and cached for offline', () => {
    const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
    const at = (f) => { assert(scripts.includes(f), f); return scripts.indexOf(f); };
    assert(at('js/trip-logic.js') < at('js/trips.js'));
    assert(at('js/calendar.js') < at('js/trips.js') && at('js/closet.js') < at('js/trips.js'));
    assert(at('js/trips.js') < at('js/app.js'));
    const sw = read('sw.js');
    assert(sw.includes("'js/trip-logic.js'") && sw.includes("'js/trips.js'"));
});
check('the Planner tells the Trips tab when pieces or planned days change, so the checklist follows the planner', () => {
    const cal = read('js/calendar.js');
    assert(/Store\.onClosetChange\(\(closet\) => \{ plannerCloset = closet; renderCalendar\(\); if \(typeof Trips !== 'undefined'\) Trips\.refreshView\(\); \}\);/.test(cal));
    assert(/Trips\.refreshView\(\);\s*\/\/ the trip's days and packing checklist follow the planner/.test(cal));
    const trips = read('js/trips.js');
    assert(/buildPackingList\(\{ trip, outfitsByDate: plannerOutfits, closet: plannerCloset/.test(trips), 'the checklist is worked out from the live planner, never stored');
    assert(!/saveTrip\([^)]*itemIds/.test(trips) && !/packingList.*Store\./.test(trips), 'only ticks are stored');
});
check('Plan this day opens the ordinary planning window, so Help me choose and the picker are the existing ones', () => {
    const src = read('js/trips.js');
    assert(/openDayForPlanning\(dateKey\)/.test(src) && /data-tab="calendar-view"/.test(src));
    assert(!/suggestOutfits|HelpChoose/.test(src), 'trips does not reimplement planning or suggestions');
});
check('ticking shows at once and saves with the standard Saving… / Saved / Couldn’t save – try again line', () => {
    const src = read('js/trips.js');
    assert(/createSaveTracker/.test(src) && /createSaveStatusView\(\$\('trip-pack-status'\)/.test(src) && /warnBeforeLeavingWhileSaving\(packSaves\)/.test(src));
    assert(/Store\.setTripPacked\(trip\.id, pieceId, checked\)/.test(src));
});
check('trip text from the person or the search is put on the page as text, never as HTML', () => {
    const src = read('js/trips.js');
    assert(!/innerHTML\s*=\s*[^'"]/.test(src.replace(/innerHTML\s*=\s*''/g, '')), 'no innerHTML built from data in trips.js');
    const cal = read('js/calendar.js');
    assert(/escapeHtml\(tripDay\.trip\.destination\.label\)/.test(cal) && /escapeHtml\(tripDay\.trip\.destination\.name\)/.test(cal));
});

done();
