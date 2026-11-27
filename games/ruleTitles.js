'use strict';
/**
 * The title of each how-to-play card: one per paragraph of the game's `rules`, in the same order (tests/rule-titles.test.js keeps the
 * two in step). The card text is the rule itself, so there is one source of truth for what the rules say.
 */
module.exports = {
  wizard: ['The deck', 'Trump', 'Predict, then play', 'Winning a trick', 'Scoring'],
  sudoku: ['The grid', 'Filling in', 'Mistakes', 'Undo', 'Winning', 'Bots'],
  dotsboxes: ['Turns', 'Closing a box', 'Passing the turn', 'Winning'],
  seabattle: ['The seas', 'Firing', 'Hits and sinking', 'Turns', 'Winning'],
  memorymatch: ['Turns', 'Playing alone', 'A pair', 'A miss', 'Winning'],
  fallingblocks: ['The well', 'Playing alone', 'Dropping a block', 'Clearing rows and garbage', 'Topping out and winning', 'Bot speed'],
  twentynine: ['Teams and cards', 'Card points', 'The deal and the bid', 'Trump', 'Playing tricks', 'Marriage', 'Scoring'],
  poker: ['The game', 'Blinds', 'Betting rounds', 'All-in', 'Showdown', 'Hand ranking', 'Winning'],
  themind: ['The cards', 'No talking', 'Mistakes', 'Throwing star', 'Levels and lives', 'Winning', 'About Mind'],
  ludo: ['The board', 'Getting out', 'Moving', 'Capturing', 'Winning'],
  gofish: ['The deal', 'Asking', 'Go Fish', 'Books', 'Sitting out', 'Winning'],
  bingo: ['The card', 'Calling', 'Marking', 'Bingo', 'Bots'],
  snakesladders: ['Rolling', 'Ladders and snakes', 'Bonus rolls', 'Finishing', 'Winning'],
  propertyrivals: ['The world tour', 'Buying and rent', 'Building', 'Cards and taxes', 'Mortgages', 'Going broke'],
  penaltyrows: ['Goal', 'Setup', 'Placing a card', 'Below every row', 'Scoring a round', 'Winning', 'Table options', 'About Take 5'],
  stagerummy: ['Goal', 'Sets and runs', 'Your turn', 'Skip cards', 'Going out', 'The stages', 'Winning', 'About Stage 10'],
  hiddenminers: ['Secret roles', 'The tunnel', 'Your turn', 'Breaking tools', 'Rounds', 'The move log', 'Winning', 'About Hidden Miners'],
  chess: ['Moving', 'The pieces', 'Check and the result', 'Resigning'],
  carrom: ['The board', 'Take the shot', 'Pocketing', 'The queen', 'The striker', 'Winning'],
  colorclash: ['The deck', 'Your turn', 'Action cards', 'One card left', 'Scoring a round', 'Winning', 'About Color Clash'],
  tictactoe: ['Taking turns', 'Winning', 'A draw'],
  fourinarow: ['Dropping discs', 'Winning', 'A draw'],
};
