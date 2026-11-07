'use strict';
/**
 * Property Rivals: the board and the two card decks (data only).
 * An original 40-square world tour: 22 city properties in 8 colour groups, 4 ports, 2 utilities, 2 taxes, 2 card squares
 * and four corners. Money is plain "coins". Names, texts and layout are this game's own.
 *
 * Property rows are [price, rent with no houses, 1 house, 2, 3, 4, hotel]; a house costs `house` coins in its group.
 */
const GROUPS = {
  brown: { name: 'Brown', color: '#8b5a3c', house: 50 },
  sky: { name: 'Sky blue', color: '#6cc3e8', house: 50 },
  pink: { name: 'Pink', color: '#e86ca8', house: 100 },
  orange: { name: 'Orange', color: '#f09a3e', house: 100 },
  red: { name: 'Red', color: '#e04646', house: 150 },
  yellow: { name: 'Yellow', color: '#f2cf4a', house: 150 },
  green: { name: 'Green', color: '#3fae67', house: 200 },
  navy: { name: 'Navy', color: '#2f4fb8', house: 200 },
};

const city = (name, group, price, rents) => ({ type: 'city', name, group, price, rents });
const port = (name) => ({ type: 'port', name, price: 200 });
const utility = (name) => ({ type: 'utility', name, price: 150 });

const SQUARES = [
  { type: 'start', name: 'Start' },
  city('Lagos', 'brown', 60, [2, 10, 30, 90, 160, 250]),
  { type: 'fund', name: 'Community Fund' },
  city('Nairobi', 'brown', 60, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Income Tax', amount: 200 },
  port('Rotterdam Port'),
  city('Lima', 'sky', 100, [6, 30, 90, 270, 400, 550]),
  { type: 'surprise', name: 'Surprise' },
  city('Bogotá', 'sky', 100, [6, 30, 90, 270, 400, 550]),
  city('Santiago', 'sky', 120, [8, 40, 100, 300, 450, 600]),
  { type: 'lockup', name: 'Lockup (just visiting)' },
  city('Hanoi', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  utility('Solar Grid'),
  city('Bangkok', 'pink', 140, [10, 50, 150, 450, 625, 750]),
  city('Jakarta', 'pink', 160, [12, 60, 180, 500, 700, 900]),
  port('Singapore Port'),
  city('Cairo', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  { type: 'fund', name: 'Community Fund' },
  city('Istanbul', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  city('Athens', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
  { type: 'rest', name: 'Rest Stop' },
  city('Mexico City', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  { type: 'surprise', name: 'Surprise' },
  city('Buenos Aires', 'red', 220, [18, 90, 250, 700, 875, 1050]),
  city('Rio', 'red', 240, [20, 100, 300, 750, 925, 1100]),
  port('Dubai Port'),
  city('Madrid', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  city('Rome', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
  utility('Water Works'),
  city('Vienna', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
  { type: 'golockup', name: 'Go to Lockup' },
  city('Seoul', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  city('Mumbai', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
  { type: 'fund', name: 'Community Fund' },
  city('Shanghai', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
  port('Los Angeles Port'),
  { type: 'surprise', name: 'Surprise' },
  city('Paris', 'navy', 350, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Luxury Tax', amount: 100 },
  city('Tokyo', 'navy', 400, [50, 200, 600, 1400, 1700, 2000]),
];
const SIZE = SQUARES.length; // 40
const LOCKUP = 10;
const START_SALARY = 200;
const LOCKUP_FINE = 50;

const buyable = (sq) => sq.type === 'city' || sq.type === 'port' || sq.type === 'utility';
const groupSquares = (group) => SQUARES.map((s, i) => (s.group === group ? i : -1)).filter((i) => i >= 0);
const portSquares = SQUARES.map((s, i) => (s.type === 'port' ? i : -1)).filter((i) => i >= 0);
const utilitySquares = SQUARES.map((s, i) => (s.type === 'utility' ? i : -1)).filter((i) => i >= 0);
const mortgageValue = (idx) => SQUARES[idx].price / 2;
const unmortgageCost = (idx) => Math.ceil(mortgageValue(idx) * 1.1);

/**
 * Card effects (applied by the engine):
 *  { gain: n } / { pay: n }               the bank pays you / you pay the bank
 *  { goto: i, collect: true }             advance to square i (collect the Start salary if you pass Start)
 *  { back: 3 }                            move back three squares
 *  { lockup: true }                       go straight to the lockup
 *  { keep: true }                         a "get out of lockup free" card you may keep
 *  { repairs: [perHouse, perHotel] }      pay for every building you own
 *  { fromEach: n } / { toEach: n }        collect from / pay to every other player
 *  { nearest: 'port' }                    advance to the nearest port; if owned pay the owner double rent
 */
const SURPRISE = [
  { text: 'Tailwind! Advance to Start and collect your salary.', goto: 0, collect: true },
  { text: 'A flight to Tokyo: advance there.', goto: 39, collect: true },
  { text: 'Advance to Rome. If you pass Start, collect your salary.', goto: 27, collect: true },
  { text: 'Advance to the nearest port. Pay the owner double rent, or buy it if it is free.', nearest: 'port' },
  { text: 'Your start-up pays a dividend: collect 50.', gain: 50 },
  { text: 'A lucky find at the market: collect 100.', gain: 100 },
  { text: 'Roadworks! Go back three squares.', back: 3 },
  { text: 'You were caught in a customs mix-up: go to the lockup.', lockup: true },
  { text: 'Get out of lockup free. Keep this card until you need it.', keep: true },
  { text: 'Repairs: pay 25 for each house and 100 for each hotel you own.', repairs: [25, 100] },
  { text: 'Speeding fine: pay 15.', pay: 15 },
  { text: 'It is your birthday: collect 20 from every other player.', fromEach: 20 },
  { text: 'You host a dinner: pay every other player 30.', toEach: 30 },
  { text: 'Conference fee: pay 75.', pay: 75 },
];
const FUND = [
  { text: 'A bank error in your favour: collect 200.', gain: 200 },
  { text: 'Doctor’s fee: pay 50.', pay: 50 },
  { text: 'Tax refund: collect 20.', gain: 20 },
  { text: 'You sell some old furniture: collect 45.', gain: 45 },
  { text: 'Advance to Start and collect your salary.', goto: 0, collect: true },
  { text: 'Go to the lockup. Do not pass Start.', lockup: true },
  { text: 'Get out of lockup free. Keep this card until you need it.', keep: true },
  { text: 'Insurance matures: collect 100.', gain: 100 },
  { text: 'Hospital fees: pay 100.', pay: 100 },
  { text: 'School fees: pay 50.', pay: 50 },
  { text: 'You inherit 100.', gain: 100 },
  { text: 'Neighbourhood repairs: pay 40 for each house and 115 for each hotel you own.', repairs: [40, 115] },
  { text: 'Your neighbours chip in: collect 10 from every other player.', fromEach: 10 },
  { text: 'You win second prize in a quiz: collect 10.', gain: 10 },
];

// How long a token takes per square on every client, and the pause after it lands (kept in step with public/games/propertyrivals.js)
const WALK_STEP_MS = 480, WALK_SETTLE_MS = 2200;

module.exports = { WALK_STEP_MS, WALK_SETTLE_MS, GROUPS, SQUARES, SIZE, LOCKUP, START_SALARY, LOCKUP_FINE, SURPRISE, FUND, buyable, groupSquares, portSquares, utilitySquares, mortgageValue, unmortgageCost };
